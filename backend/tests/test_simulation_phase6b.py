"""Simulation audit, Phase 6 part 2 (model projection-1.6): data quality check, combined scenarios, reproducing a saved
run, side-by-side comparison, model-update information. docs/simulation-audit/10-phase6-part2-changes.md."""
import asyncio
from datetime import date

import pytest

from app.modules.scenario_intelligence import model_info
from app.modules.scenario_intelligence import projection as P
from app.modules.scenario_intelligence import quality as Q
from app.modules.scenario_intelligence import router as si
from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence import uncertainty as U
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S
from test_agent import OUTSIDER, OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

TODAY = date(2026, 11, 21)


def test_complete_run_survives_restart_without_new_database_columns(monkeypatch):
    import copy
    saved = {}
    async def insert(table, docs):
        if table == "scenario_runs":
            assert "risk_signals" not in docs and "multi_engine" not in docs
            saved[docs["scenario_run_id"]] = copy.deepcopy(docs)
        assert table != "scenario_timelines", "new timeline fields belong in the existing JSON snapshot"
        return True
    async def select(table, **kwargs):
        if table == "scenario_runs":
            return copy.deepcopy(saved.get(kwargs["filters"][0][2]))
        return []
    monkeypatch.setattr(svc, "_safe_insert", insert)
    monkeypatch.setattr(svc, "_safe_select", select)
    async def scenario():
        result = await svc.create_scenario_run("tenant", "business", "v1", "tmpl_revenue_drop", "manual", "Revenue down",
            "revenue_drop", {"revenue_drop_pct": 10, "timeline_months": 6},
            S(revenue_monthly=10000, expenses_monthly=5000, costs_monthly=5000, starting_cash=20000), as_of=TODAY)
        run_id = result["scenario_run_id"]
        svc._MEM_RUNS.pop(run_id, None)
        svc._MEM_TIMELINES.pop(run_id, None)
        loaded = await svc.get_scenario_run(run_id)
        timeline = await svc.get_scenario_timeline(run_id)
        assert timeline == saved[run_id]["scenario_metrics"]["_saved_result"]["timeline"]
        assert timeline and loaded["multi_engine"] is not None
        assert loaded["scenario_metrics"]["verdict"] == saved[run_id]["scenario_metrics"]["verdict"]
        assert "_saved_result" not in loaded["scenario_metrics"]
    asyncio.run(scenario())


# ── Data quality ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_unusual_month_by_modified_z_score_by_hand():
    """Months 100, 102, 98, 101, 99, 100, 160. Median 100; absolute deviations 0, 2, 2, 1, 1, 0, 60 -> MAD 1.
    160: z = 0.6745 x 60 / 1 = 40.5 > 3.5, flagged. 102: z = 1.35, not flagged."""
    series = [((2026, m), v) for m, v in zip(range(1, 8), [100, 102, 98, 101, 99, 100, 160])]
    odd = Q.unusual_months(series)
    assert odd == [dict(month="2026-07", value=160, modified_z=40.5)]


def test_the_check_finds_each_kind_of_problem():
    hist = {f"2026-{m:02d}": (0 if m == 4 else 1000 + m) for m in range(1, 11)}
    st = S(revenue_monthly=1000, revenue_by_month=hist, starting_cash=0, excluded_fx_items=2,
           record_checks=dict(possible_duplicate_invoices=1, possible_duplicate_expenses=0, uncategorised_expenses=3, undated=1, future_dated=0))
    codes = {i["code"]: i["severity"] for i in Q.check(st, TODAY, 24)["issues"]}
    # the empty April is both a gap and an unusual month (0 against about 1,000: modified z far above 3.5)
    assert codes == {"limited_history": "info", "gaps": "warning", "unusual_months": "warning", "no_costs": "serious", "no_cash": "warning",
                     "duplicate_invoices": "warning", "uncategorised": "info", "dates": "info", "currency": "warning", "long_horizon": "info"}


def test_costs_recorded_only_as_history_count_as_costs():
    """Regression found by the release gate: costs present only as monthly history were reported as 'no costs'."""
    hist = {f"2026-{m:02d}": 1000 for m in range(1, 11)}
    st = S(revenue_by_month=hist, expenses_by_month={k: 300 for k in hist}, starting_cash=1000)
    assert "no_costs" not in {i["code"] for i in Q.check(st, TODAY, 6)["issues"]}


def test_clean_data_has_nothing_to_report():
    hist = {f"{y}-{m:02d}": 1000 + (m % 3) for y in (2025, 2026) for m in range(1, 13) if (y, m) <= (2026, 10)}
    st = S(revenue_monthly=1000, expenses_monthly=400, revenue_by_month=hist, starting_cash=5000)
    q = Q.check(st, TODAY, 6)
    assert q["issues"] == [] and q["summary"] == "No data problems found."


def test_serious_problems_lower_confidence_and_every_run_carries_the_check():
    """Short history (serious) and no costs (serious): -2 on top of the history's own -1."""
    st = S(revenue_monthly=1000, revenue_by_month={"2026-10": 1000}, payment_terms_days=30)
    rows, s = P.project(st, "do_nothing_projection", {}, 6, as_of=TODAY)
    assert s["data_quality"]["serious"] == 2
    u = U.analyse(st, "do_nothing_projection", {}, 6, TODAY, s, rows)
    assert any("serious data problem" in r for r in u["confidence"]["reasons"]) and u["confidence"]["level"] == "low"


# ── Combined scenarios ───────────────────────────────────────────────────────────────────────────────────────────────

def test_a_price_rise_and_a_hire_together_by_hand():
    """Revenue 20,000, cost of sales 6,000, expenses 7,000, customers pay at once, no date, 12 months, UK.
    +10% price with sensitivity 1: revenue 20,000 x 1.1 x 1.1^-1 = 20,000; cost of sales 6,000 / 1.1 = 5,454.55 (-545.45).
    One hire at 3,000: + 3,000 + 461.90 employer costs = 3,461.90. Monthly change -2,916.45; 12 months -34,997.35."""
    st = S(revenue_monthly=20000, cost_of_sales_monthly=6000, expenses_monthly=7000, starting_cash=25000, payment_terms_days=0, tax_country="GB")
    steps = {"steps": [{"scenario_type": "price_change", "params": {"price_change_pct": 10}},
                       {"scenario_type": "hire_staff", "params": {"employee_count": 1, "employee_monthly_cost": 3000}}]}
    _r, b = P.project(st, "do_nothing_projection", {}, 12)
    _r, c = P.project(st, "combined", steps, 12)
    v = P.compare_projections(b, c)
    assert v["cumulative_profit_change"] == pytest.approx(-34997.35, abs=0.02) and v["outcome"] == "worse" and all(c["checks"].values())


def test_combined_with_a_loan_and_equipment_handles_both():
    """A 20,000 loan and 12,000 of equipment in one scenario: cash +20,000 - 12,000 in month 1 (before repayments start)."""
    st = S(revenue_monthly=10000, expenses_monthly=10000, starting_cash=0, payment_terms_days=0)
    steps = {"steps": [{"scenario_type": "take_loan", "params": {"loan_amount": 20000, "loan_annual_rate_pct": 0, "loan_term_months": 10}},
                       {"scenario_type": "buy_equipment", "params": {"equipment_cost": 12000, "purchase_month": 1, "useful_life_months": 12}}]}
    rows, s = P.project(st, "combined", steps, 3)
    assert rows[0]["cash_balance"] == 8000 and s["closing_fixed_assets"] == 9000 and all(s["checks"].values())


def test_unknown_or_nested_steps_are_ignored():
    assert P.combined_steps("combined", {"steps": [{"scenario_type": "combined"}, {"scenario_type": "nope"},
                                                   {"scenario_type": "cost_increase", "params": {"cost_increase_pct": 5}}]}) == \
        [("cost_increase", {"cost_increase_pct": 5})]


# ── Reproducing a saved run ──────────────────────────────────────────────────────────────────────────────────────────

def _saved_run(monkeypatch):
    async def nothing(*_a, **_k):
        return None
    monkeypatch.setattr(svc, "_safe_insert", nothing)
    st = S(revenue_monthly=20000, cost_of_sales_monthly=6000, expenses_monthly=7000, starting_cash=25000, payment_terms_days=21,
           revenue_by_month={f"2026-{m:02d}": 19000 + 150 * m for m in range(1, 11)}, sales_tax_rate_pct=20, owner_drawings_monthly=500)
    return asyncio.run(svc.create_scenario_run("t", "b", "v", "tmpl_price_increase", "manual", "Price +8%", "price_change",
                                               {"price_change_pct": 8, "timeline_months": 12}, st, as_of=TODAY))


def test_a_saved_run_reproduces_exactly(monkeypatch):
    r = svc.reproduce(_saved_run(monkeypatch))
    assert r["reproduced"] is True and r["verdict_now"] == r["verdict_saved"] and all(c["same"] for c in r["compared"])
    assert r["model_version_saved"] == r["model_version_now"] == P.MODEL_VERSION


def test_a_run_from_an_earlier_model_says_what_changed(monkeypatch):
    run = _saved_run(monkeypatch)
    run["scenario_metrics"]["projection"]["model_version"] = "projection-1.4"
    run["scenario_metrics"]["projection"]["closing_cash"] += 100      # as if the earlier rules had given a different figure
    r = svc.reproduce(run)
    assert r["reproduced"] is False and "the model has changed" in r["explanation"]
    assert "Figures come straight from your invoices" in r["explanation"]


def test_model_information_lists_every_version_newest_first():
    i = model_info.info()
    assert i["version"] == P.MODEL_VERSION == i["changes"][0]["version"]
    assert [c["version"] for c in i["changes"]][-1] == "projection-1.0"
    assert model_info.changes_since(P.MODEL_VERSION) == []


# ── The endpoints ────────────────────────────────────────────────────────────────────────────────────────────────────

def test_compare_and_reproduce_check_access(world, monkeypatch):  # noqa: F811
    _env, _s, client, who = world
    run = _saved_run(monkeypatch)
    run["business_id"] = "A"

    async def get_run(run_id):
        return {**run, "scenario_run_id": run_id}
    monkeypatch.setattr(si, "get_scenario_run", get_run)
    who["user"] = OUTSIDER
    assert client.post("/v1/scenario-intelligence/scenario-runs/r1/reproduce").status_code == 404
    assert client.post("/v1/scenario-intelligence/compare", json={"run_ids": ["r1", "r2"]}).status_code == 404
    who["user"] = OWNER
    rep = client.post("/v1/scenario-intelligence/scenario-runs/r1/reproduce").json()
    assert rep["reproduced"] is True
    cmp = client.post("/v1/scenario-intelligence/compare", json={"run_ids": ["r1", "r2"]}).json()
    assert len(cmp["runs"]) == 2 and cmp["runs"][0]["outcome"] in ("improved", "worse", "mixed", "no_material_change")
    assert client.post("/v1/scenario-intelligence/compare", json={"run_ids": ["r1"]}).status_code == 422
    assert client.get("/v1/scenario-intelligence/model").json()["version"] == P.MODEL_VERSION


def test_runs_are_stamped_with_model_1_6():
    assert P.MODEL_VERSION == "projection-1.6"
