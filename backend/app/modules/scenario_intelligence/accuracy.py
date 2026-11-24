"""How accurate have the projections been? Forecasts measured against what actually happened.

Simulation audit, Phase 3 (17 Nov 2026), scorecard criterion 14. Pure calculation.

Two measures, both reported with the number of months behind them:

* **Tracked accuracy.** Every projection run since Phase 3 stores what it forecast for each calendar month
  (``projection.forecast_by_month``). Once those months are complete, the forecasts are compared with the recorded
  figures. When the owner accepted the scenario, its forecast is compared; otherwise the no-change forecast is.
* **Backtest.** The baseline method is re-run on the business's own history as if it were each of the last few months,
  and compared with what happened, alongside the naive method ("next month = last month"). It is available straight away
  from history, before any tracked forecast has matured.

Error measures (standard for small-volume business series, where percentage errors on single months blow up):
  WAPE = sum |forecast - actual| / sum actual          (0% = perfect)
  bias = sum (forecast - actual) / sum actual          (positive = forecasts too high)
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from app.modules.scenario_intelligence.baseline import backtest, complete_months


def _measures(pairs: List[Dict[str, float]]) -> Dict[str, Any]:
    total = sum(p["actual"] for p in pairs)
    if not pairs or total <= 0:
        return dict(months=len(pairs), wape_pct=None, bias_pct=None)
    return dict(
        months=len(pairs),
        wape_pct=round(sum(abs(p["forecast"] - p["actual"]) for p in pairs) / total * 100, 1),
        bias_pct=round(sum(p["forecast"] - p["actual"] for p in pairs) / total * 100, 1),
    )


def tracked_accuracy(runs: List[Dict[str, Any]], revenue_history: Dict[str, Any] | None, as_of: date) -> Dict[str, Any]:
    """`runs`: [{scenario_run_id, scenario_name, created_at, decision_status, baseline_projection, scenario_projection}].
    Only months that are complete now, and that a run forecast, are compared."""
    actual = {f"{y:04d}-{m:02d}": v for (y, m), v in complete_months(revenue_history, as_of)}
    per_run, pooled = [], []
    for r in runs:
        accepted = r.get("decision_status") == "accepted"
        proj = (r.get("scenario_projection") if accepted else r.get("baseline_projection")) or {}
        forecast = proj.get("forecast_by_month") or {}
        pairs = [dict(month=k, forecast=float((v or {}).get("revenue") or 0), actual=float(actual[k]))
                 for k, v in sorted(forecast.items()) if k in actual]
        if not pairs:
            continue
        pooled.extend(pairs)
        per_run.append(dict(scenario_run_id=r.get("scenario_run_id"), scenario_name=r.get("scenario_name"),
                            run_on=proj.get("as_of"), compared="scenario (accepted)" if accepted else "no-change forecast",
                            model_version=proj.get("model_version"), pairs=pairs, **_measures(pairs)))
    return dict(runs=per_run, overall=_measures(pooled),
                note=("Revenue forecasts from earlier runs against your recorded revenue for the months that have since "
                      "completed." if per_run else
                      "No earlier forecast has reached a completed month yet. Accuracy is tracked automatically as months complete."))


def accuracy_report(runs: List[Dict[str, Any]], revenue_history: Dict[str, Any] | None, as_of: date) -> Dict[str, Any]:
    bt = backtest(revenue_history, as_of)
    return dict(
        as_of=as_of.isoformat(),
        tracked=tracked_accuracy(runs, revenue_history, as_of),
        backtest=bt or dict(months=[], wape_pct=None, bias_pct=None, naive_wape_pct=None, skill=None,
                            note="At least 4 complete months of revenue are needed to test the method on your history."),
        definitions=dict(wape_pct="sum of |forecast - actual| / sum of actual (0% = perfect)",
                         bias_pct="sum of (forecast - actual) / sum of actual (positive = forecasts too high)",
                         naive_wape_pct="the same for 'next month = last month', the benchmark a method should beat"),
    )


def run_record(run: Dict[str, Any], decision_status: Optional[str]) -> Dict[str, Any]:
    """What accuracy tracking needs from a saved run."""
    return dict(
        scenario_run_id=run.get("scenario_run_id"),
        scenario_name=run.get("scenario_name"),
        created_at=run.get("created_at"),
        decision_status=decision_status,
        baseline_projection=(run.get("baseline_metrics") or {}).get("projection"),
        scenario_projection=(run.get("scenario_metrics") or {}).get("projection"),
    )
