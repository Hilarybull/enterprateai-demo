"""Accuracy across all businesses: is the model still right, and does its confidence mean what it says?
Simulation audit, Phase 7 (model projection-1.6). Pure calculation; the admin endpoint loads the runs and the records.

For every saved run whose forecast months have since completed, the forecast revenue is compared with what the
business's records show for those months (accuracy.tracked_accuracy: the accepted scenario's forecast, else the
no-change forecast). Reported:
* pooled WAPE and bias overall, by model version and by confidence level (calibration: "high" should have the smallest
  error), and by business type is left for when there is enough data;
* range coverage: the share of runs whose actual revenue over the compared months fell inside the forecast's revenue range
  (forecast x (1 -/+ the revenue range used for that run)); the range is a 90% range, so about 90% is expected;
* alerts against the monitoring thresholds in MODEL.md section 9 (WAPE above 25% or bias outside +/-10% over 6 or more
  completed months; coverage below 80%; confidence not ordered).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from app.modules.scenario_intelligence.accuracy import run_record, tracked_accuracy

WAPE_LIMIT, BIAS_LIMIT, MIN_MONTHS, COVERAGE_FLOOR = 25.0, 10.0, 6, 80.0


def _measures(pairs: List[Dict[str, float]]) -> Dict[str, Any]:
    total = sum(p["actual"] for p in pairs)
    if not pairs or total <= 0:
        return dict(months=len(pairs), wape_pct=None, bias_pct=None)
    return dict(months=len(pairs), wape_pct=round(sum(abs(p["forecast"] - p["actual"]) for p in pairs) / total * 100, 1),
                bias_pct=round(sum(p["forecast"] - p["actual"] for p in pairs) / total * 100, 1))


def evaluate(runs_by_business: Dict[str, List[Dict[str, Any]]], revenue_by_business: Dict[str, Dict[str, float]],
             decisions: Optional[Dict[str, str]] = None, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    decisions = decisions or {}
    pooled: List[Dict[str, float]] = []
    by_version: Dict[str, List[Dict[str, float]]] = {}
    by_confidence: Dict[str, List[Dict[str, float]]] = {}
    covered = judged = 0
    businesses_with_data = 0
    runs_compared = 0
    for business_id, runs in runs_by_business.items():
        history = revenue_by_business.get(business_id) or {}
        any_here = False
        for run in runs:
            rec = run_record(run, decisions.get(run.get("scenario_run_id")))
            t = tracked_accuracy([rec], history, today)
            if not t["runs"]:
                continue
            pairs = t["runs"][0]["pairs"]
            any_here = True
            runs_compared += 1
            pooled += pairs
            version = t["runs"][0].get("model_version") or "unknown"
            by_version.setdefault(version, []).extend(pairs)
            level = (((run.get("scenario_metrics") or {}).get("uncertainty") or {}).get("confidence") or {}).get("level") or "unknown"
            by_confidence.setdefault(level, []).extend(pairs)
            swing = (((run.get("scenario_metrics") or {}).get("uncertainty") or {}).get("ranges") or {}).get("drivers", {}).get("revenue_swing_pct")
            if swing is not None:
                f, a = sum(p["forecast"] for p in pairs), sum(p["actual"] for p in pairs)
                judged += 1
                covered += 1 if f * (1 - swing / 100) <= a <= f * (1 + swing / 100) else 0
        businesses_with_data += 1 if any_here else 0
    overall = _measures(pooled)
    coverage = round(covered / judged * 100, 1) if judged else None
    conf = {k: _measures(v) for k, v in by_confidence.items()}
    alerts: List[str] = []
    if overall["months"] >= MIN_MONTHS and overall["wape_pct"] is not None and overall["wape_pct"] > WAPE_LIMIT:
        alerts.append(f"Forecast error (WAPE) {overall['wape_pct']}% is above the {WAPE_LIMIT:.0f}% review threshold.")
    if overall["months"] >= MIN_MONTHS and overall["bias_pct"] is not None and abs(overall["bias_pct"]) > BIAS_LIMIT:
        alerts.append(f"Bias {overall['bias_pct']:+}% is outside the ±{BIAS_LIMIT:.0f}% review threshold "
                      f"({'forecasts too high' if overall['bias_pct'] > 0 else 'forecasts too low'}).")
    if coverage is not None and judged >= 10 and coverage < COVERAGE_FLOOR:
        alerts.append(f"Only {coverage}% of runs had actual revenue inside their 90% range (below {COVERAGE_FLOOR:.0f}%): widen the range.")
    order = [conf.get(k, {}).get("wape_pct") for k in ("high", "medium", "low")]
    known = [w for w in order if w is not None]
    calibrated = None
    if len(known) >= 2:
        calibrated = all(a <= b for a, b in zip(known, known[1:]))
        if not calibrated:
            alerts.append("Confidence is not ordered: 'high' confidence runs are not the most accurate. Review the confidence rule.")
    status = ("not enough data yet" if overall["months"] < MIN_MONTHS else ("review needed" if alerts else "within thresholds"))
    return dict(as_of=today.isoformat(), status=status, businesses=len(runs_by_business), businesses_with_completed_months=businesses_with_data,
                runs_compared=runs_compared, overall=overall, range_coverage_pct=coverage, runs_judged_for_coverage=judged,
                by_model_version={k: _measures(v) for k, v in sorted(by_version.items())}, by_confidence=conf,
                confidence_ordered=calibrated, alerts=alerts,
                thresholds=dict(wape_pct=WAPE_LIMIT, bias_pct=BIAS_LIMIT, min_months=MIN_MONTHS, coverage_floor_pct=COVERAGE_FLOOR),
                method=("Each run's forecast revenue for the months that have since completed, against the business's recorded "
                        "revenue for those months (by invoice date, excluding VAT). WAPE = total absolute error / total actual; "
                        "bias = total error / total actual."))
