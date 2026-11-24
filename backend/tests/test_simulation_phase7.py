"""Simulation audit, Phase 7: accuracy across businesses, calibration, the standards register, the release gate.
docs/simulation-audit/11-phase7-changes.md."""
import importlib
from datetime import date

import pytest


@pytest.mark.parametrize("relative", ["evaluate.py", "holdout/evaluate_holdout.py"])
def test_registered_evidence_accepts_line_endings_but_rejects_changed_data(relative, tmp_path, monkeypatch):
    import hashlib
    import importlib.util
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    path = root / "docs/simulation-audit/evidence/mock_production" / relative
    spec = importlib.util.spec_from_file_location("simulation_evidence_evaluator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "HERE", str(tmp_path))
    registered = hashlib.sha256(b'{\r\n "value": 1\r\n}').hexdigest()
    (tmp_path / "PREREGISTRATION.txt").write_text(f"truth.json  {registered}\n", encoding="utf-8")
    data = tmp_path / "truth.json"
    data.write_bytes(b'{\n "value": 1\n}')
    assert module.load("truth.json") == ({"value": 1}, registered)
    data.write_bytes(b'{\n "value": 2\n}')
    with pytest.raises(AssertionError, match="changed after pre-registration"):
        module.load("truth.json")

from app.modules.scenario_intelligence import monitoring as M
from app.modules.scenario_intelligence import standards as ST
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

TODAY = date(2026, 12, 15)


def _run(run_id, forecast, level="high", swing=10.0, version="projection-1.6"):
    proj = {"forecast_by_month": {k: {"revenue": v} for k, v in forecast.items()}, "model_version": version, "as_of": "2026-09-20"}
    return {"scenario_run_id": run_id, "baseline_metrics": {"projection": proj}, "scenario_metrics": {
        "projection": proj, "uncertainty": {"confidence": {"level": level}, "ranges": {"drivers": {"revenue_swing_pct": swing}}}}}


def test_accuracy_across_businesses_by_hand():
    """Business A: forecast 1,000 for Oct and Nov, actual 900 and 1,100 -> errors 100 + 100. Business B: forecast 2,000 for
    Oct, Nov, actual 2,000 and 2,400 -> errors 0 + 400. Pooled: 600 / 6,400 = 9.4% WAPE; bias (100 - 100 + 0 - 400) / 6,400
    = -6.25% (shown -6.2). Range coverage: A total 2,000 against 2,000 (inside ±10%); B total 4,000 against 4,400 (inside ±10%: 3,600-4,400)."""
    runs = {"A": [_run("a1", {"2026-10": 1000, "2026-11": 1000})], "B": [_run("b1", {"2026-10": 2000, "2026-11": 2000}, level="medium")]}
    actual = {"A": {"2026-10": 900, "2026-11": 1100}, "B": {"2026-10": 2000, "2026-11": 2400}}
    r = M.evaluate(runs, actual, today=TODAY)
    assert r["overall"] == dict(months=4, wape_pct=9.4, bias_pct=-6.2)
    assert r["range_coverage_pct"] == 100.0 and r["runs_compared"] == 2 and r["businesses_with_completed_months"] == 2
    assert r["by_confidence"]["high"]["wape_pct"] == 10.0 and r["by_confidence"]["medium"]["wape_pct"] == 9.1
    assert r["confidence_ordered"] is False and any("not ordered" in a for a in r["alerts"])
    assert r["status"] == "not enough data yet"      # 4 months compared, 6 needed for the thresholds


def test_thresholds_raise_alerts_with_enough_months():
    """Six months forecast 1,000, actual 700: WAPE 300 x 6 / 4,200 = 42.9%, bias +42.9%: both alerts."""
    months = {f"2026-{m:02d}": 1000 for m in range(5, 11)}
    r = M.evaluate({"A": [_run("a", months)]}, {"A": {k: 700 for k in months}}, today=TODAY)
    assert r["overall"]["wape_pct"] == 42.9 and r["status"] == "review needed"
    assert any("above the 25% review threshold" in a for a in r["alerts"]) and any("forecasts too high" in a for a in r["alerts"])


def test_months_not_yet_complete_are_not_judged():
    r = M.evaluate({"A": [_run("a", {"2026-12": 1000, "2027-01": 1000})]}, {"A": {"2026-12": 50}}, today=TODAY)
    assert r["runs_compared"] == 0 and r["overall"]["months"] == 0


# ── Standards register ───────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("item", ST.STANDARDS, ids=lambda s: s["name"])
def test_every_registered_standard_equals_the_value_in_the_code(item):
    module, constant = item["code"].split(".")
    actual = getattr(importlib.import_module(f"app.modules.scenario_intelligence.{module}"), constant)
    assert actual == pytest.approx(item["value"]), f"{item['name']}: register {item['value']} but code {actual}"
    assert item["evidence"] in ("published", "calibrated", "practice", "own choice") and item["source"]


def test_reviews_fall_due_after_twelve_months():
    assert ST.overdue(date(2027, 11, 20)) == [] and len(ST.overdue(date(2027, 11, 21))) == len(ST.STANDARDS)
    reg = ST.register()
    assert sum(reg["by_evidence"].values()) == len(ST.STANDARDS)


# ── The admin endpoint ───────────────────────────────────────────────────────────────────────────────────────────────

def test_the_accuracy_dashboard_is_for_admins_only(world):  # noqa: F811
    _env, _s, client, who = world
    who["user"] = OWNER
    assert client.get("/v1/scenario-intelligence/admin/accuracy").status_code == 403
    who["user"] = "tech.support@enterprateai.com"
    r = client.get("/v1/scenario-intelligence/admin/accuracy")
    assert r.status_code == 200 and "status" in r.json() and r.json()["thresholds"]["wape_pct"] == 25.0
