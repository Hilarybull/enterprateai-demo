"""Simulation audit, Phase 2: trust and transparency. Hand-calculated reference cases.

Ranges (low / base / high), robustness of the verdict, sensitivity, where each input came from, data confidence,
standard KPIs (uncertainty.py), and missing data in Idea Validation no longer scored as acceptable (finding F5).
See docs/simulation-audit/04-phase2-changes.md.
"""
import asyncio
from datetime import date

import pytest

from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence.projection import project
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S
from app.modules.scenario_intelligence.uncertainty import (
    analyse,
    confidence,
    inputs,
    kpis,
    ranges,
    sensitivity,
    typical_swing,
)

CASH_BUSINESS = dict(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
                     starting_cash=30000, payment_terms_days=0)
MONTH_END = date(2026, 11, 30)


# ---------------------------------------------------------------------------------------------------------------------
# How much the figures move
# ---------------------------------------------------------------------------------------------------------------------

def test_typical_swing_is_measured_from_the_business_own_months():
    """Aug-Oct and Jul: 9,000 / 11,000 / 9,000 / 11,000. Mean 10,000; sample deviation sqrt(4 x 1,000^2 / 3) = 1,154.70
    -> 11.5% of the mean."""
    swing, basis = typical_swing({"2026-07": 9000, "2026-08": 11000, "2026-09": 9000, "2026-10": 11000}, MONTH_END, 0.15)
    assert swing == pytest.approx(0.11547, abs=1e-5) and "last 4 complete months" in basis


def test_typical_swing_falls_back_and_says_so():
    swing, basis = typical_swing({"2026-10": 10000}, MONTH_END, 0.15)
    assert swing == 0.15 and "assumed" in basis
    flat, _ = typical_swing({f"2026-{m:02d}": 10000 for m in range(1, 11)}, MONTH_END, 0.15)
    assert flat == 0.03      # never treated as perfectly certain


# ---------------------------------------------------------------------------------------------------------------------
# Low / base / high
# ---------------------------------------------------------------------------------------------------------------------

def test_range_for_the_business_as_it_is():
    """No history: revenue swing 15%, costs 10%, assumed. Immediate payers, 6 months, no days left this month.
    Base: 30,000 + 6 x 8,000 = 78,000.
    Low: revenue 17,000, cost of sales 3,400 (follows revenue), expenses 8,800 -> profit 4,800 a month (28,800).
         Customers pay 15 days later: half of each month's sales next month, so 8,500 still owed at the end.
         Cash 30,000 + 28,800 - 8,500 = 50,300.
    High: revenue 23,000, cost of sales 4,600, expenses 7,200 -> profit 11,200 a month -> 30,000 + 67,200 = 97,200."""
    r = ranges(S(**CASH_BUSINESS), "do_nothing_projection", {}, 6, MONTH_END)
    assert [r["cases"][c]["baseline"]["closing_cash"] for c in ("low", "base", "high")] == [50300, 78000, 97200]
    assert r["drivers"]["revenue_swing_pct"] == 15 and "assumed" in r["drivers"]["revenue_swing_basis"]
    # Model 1.3 (Phase 4): revenue and costs move by a 90% forecast range; the whole range is described as cautious
    assert "90% forecast range" in r["note"] and "cautious" in r["note"]


def test_a_verdict_that_holds_in_every_case_is_robust():
    """Costs up 20%: worse in the low, base and high cases alike."""
    r = ranges(S(**CASH_BUSINESS), "cost_increase", {"cost_increase_pct": 20}, 6, MONTH_END)
    assert r["robust"] is True and {v["outcome"] for v in r["verdicts"].values()} == {"worse"}


def test_a_price_rise_that_depends_on_customers_is_not_robust():
    """+10% with the standard sensitivity is better than doing nothing; with sensitive customers (the low case, sensitivity
    2) it loses money. The verdict is shown as depending on the assumptions, naming the case that changes it."""
    r = ranges(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10, "price_sensitivity": 1}, 6, MONTH_END)
    assert r["verdicts"]["base"]["outcome"] == "improved" and r["verdicts"]["low"]["outcome"] == "worse"
    assert r["robust"] is False and "low case worse than doing nothing" in r["robustness"]


def test_a_price_cut_is_judged_the_other_way_round():
    """For a 10% price cut, the adverse case is customers who barely react (sensitivity 0.5)."""
    r = ranges(S(**CASH_BUSINESS), "price_change", {"price_change_pct": -10, "price_sensitivity": 1}, 6, MONTH_END)
    assert r["verdicts"]["low"]["net_cash_change"] < r["verdicts"]["high"]["net_cash_change"]


# ---------------------------------------------------------------------------------------------------------------------
# Sensitivity
# ---------------------------------------------------------------------------------------------------------------------

def test_sensitivity_ranks_drivers_by_their_effect_on_the_decision():
    out = sensitivity(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10}, 6, MONTH_END)
    swings = [d["swing"] for d in out]
    assert swings == sorted(swings, reverse=True)
    assert out[0]["driver"] == "Customer price sensitivity"      # the decision turns on how customers react
    assert {d["driver"] for d in out} >= {"Revenue ±10%", "Operating expenses ±10%", "Customers pay 15 days later / sooner"}
    assert sensitivity(S(**CASH_BUSINESS), "do_nothing_projection", {}, 6, MONTH_END) == []


def test_operating_expenses_do_not_change_a_price_decision():
    """Expenses are the same with and without the price change, so moving them doesn't move the comparison."""
    out = {d["driver"]: d for d in sensitivity(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10}, 6, MONTH_END)}
    assert out["Operating expenses ±10%"]["swing"] == 0


# ---------------------------------------------------------------------------------------------------------------------
# Where each input came from
# ---------------------------------------------------------------------------------------------------------------------

def _labels(state, scenario_type="do_nothing_projection", params=None, as_of=MONTH_END):
    _r, s = project(state, scenario_type, params or {}, 6, as_of=as_of)
    return {i["input"]: i["label"] for i in inputs(state, scenario_type, params or {}, s["baseline"])}, s


def test_every_input_says_where_it_came_from():
    state = S(**{**CASH_BUSINESS, "payment_terms_days": None}, profit_tax_rate_pct=19,
              figure_sources={"revenue_monthly": "money received on your invoices over the last 3 months"},
              expenses_by_month={"2026-08": 8000, "2026-09": 8000, "2026-10": 8000})
    labels, _s = _labels(state, "price_change", {"price_change_pct": 10, "price_sensitivity": 1})
    assert labels["Monthly revenue"] == "shared figure"
    assert labels["Monthly operating expenses"] == "from your history"
    assert labels["Customer payment terms (days)"] == "assumed"
    assert labels["Tax on profit (%)"] == "entered by you" and labels["VAT / sales tax (%)"] == "not set"
    assert labels["Customer price sensitivity"] == "standard figure" and labels["Price change (%)"] == "entered by you"


def test_an_estimate_is_labelled_an_estimate():
    labels, _s = _labels(S(**CASH_BUSINESS), "do_nothing_projection", {"basis": "estimate", "estimate_basis": "£70 x 25 a month"})
    assert labels["Monthly revenue"] == "estimate"


# ---------------------------------------------------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------------------------------------------------

def test_confidence_is_high_with_a_year_of_records():
    hist = {f"{2025 + (10 + k) // 12}-{(10 + k) % 12 + 1:02d}": 20000 for k in range(12)}
    state = S(**CASH_BUSINESS, revenue_by_month=hist)
    labels_list = None
    _r, s = project(state, "do_nothing_projection", {}, 6, as_of=MONTH_END)
    labels_list = inputs(state, "do_nothing_projection", {}, s["baseline"])
    c = confidence(state, "do_nothing_projection", {}, s["baseline"], labels_list)
    assert c["level"] == "high" and "12 complete months" in c["reasons"][0]


def test_confidence_is_low_with_no_history_assumed_terms_and_standard_figures():
    """No history (-1), payment terms assumed (-1), standard price sensitivity (-1) = -3 -> low, with each reason."""
    state = S(**{**CASH_BUSINESS, "payment_terms_days": None})
    params = {"price_change_pct": 10}
    _r, s = project(state, "price_change", params, 6, as_of=MONTH_END)
    c = confidence(state, "price_change", params, s["baseline"], inputs(state, "price_change", params, s["baseline"]))
    assert c["level"] == "low" and c["points"] == -3 and len(c["reasons"]) == 3


# ---------------------------------------------------------------------------------------------------------------------
# Standard KPIs
# ---------------------------------------------------------------------------------------------------------------------

def test_kpis_for_the_business_as_it_is():
    """Revenue 20,000, cost of sales 4,000, expenses 8,000, immediate payers.
    Gross margin 80%; operating margin 40%; contribution ratio 0.8 -> break-even revenue 8,000 / 0.8 = 10,000 a month,
    margin of safety 50%; nothing owed at the end -> 0 days' sales outstanding; cash rising -> no burn, no runway limit."""
    rows, s = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 6)
    k = kpis(rows, s)
    assert (k["gross_margin_pct"], k["operating_margin_pct"], k["break_even_revenue_monthly"], k["margin_of_safety_pct"]) == (80, 40, 10000, 50)
    assert k["days_sales_outstanding"] == 0 and k["monthly_burn"] == 0 and k["runway_months"] is None
    assert k["average_monthly_cash_flow"] == 8000 and "definitions" in k


def test_kpis_for_a_business_burning_cash():
    """Losing 2,000 a month from 30,000: burn 2,000, runway at the end 18,000 / 2,000 = 9 months.
    30-day terms: last month's 10,000 still owed -> 30 days' sales outstanding."""
    rows, s = project(S(revenue_monthly=10000, expenses_monthly=12000, costs_monthly=12000, starting_cash=30000,
                        payment_terms_days=30, accrued_revenue_total=10000), "do_nothing_projection", {}, 6)
    k = kpis(rows, s)
    assert k["monthly_burn"] == 2000 and k["runway_months"] == 9 and k["days_sales_outstanding"] == 30


# ---------------------------------------------------------------------------------------------------------------------
# It reaches the run and the page
# ---------------------------------------------------------------------------------------------------------------------

def test_a_saved_run_carries_its_range_inputs_confidence_and_kpis(monkeypatch):
    monkeypatch.setattr(svc, "_today", lambda: MONTH_END)
    monkeypatch.setattr(svc, "_safe_insert", lambda *a, **k: asyncio.sleep(0, result=True))
    run = asyncio.run(svc.create_scenario_run("t", "b", "v", "tmpl_price_increase", "manual", "x", "price_change",
                                              {"price_change_pct": 10}, S(**CASH_BUSINESS)))
    u = run["scenario_metrics"]["uncertainty"]
    assert set(u) == {"ranges", "sensitivity", "inputs", "confidence", "kpis"}
    assert set(u["kpis"]) == {"baseline", "scenario"} and u["ranges"]["robust"] in (True, False)


def test_the_do_nothing_projection_carries_them_too(monkeypatch):
    out = asyncio.run(svc.do_nothing_projection("t", "b", "v", S(**CASH_BUSINESS), 6, as_of=MONTH_END))
    u = out["summary"]["uncertainty"]
    assert u["ranges"]["cases"]["base"]["baseline"]["closing_cash"] == out["summary"]["closing_cash"]
    assert u["sensitivity"] == [] and "robust" not in u["ranges"]


def test_analyse_base_case_matches_the_projection():
    state = S(**CASH_BUSINESS)
    rows, base = project(state, "do_nothing_projection", {}, 6, as_of=MONTH_END)
    srows, scen = project(state, "cost_increase", {"cost_increase_pct": 5}, 6, as_of=MONTH_END)
    u = analyse(state, "cost_increase", {"cost_increase_pct": 5}, 6, MONTH_END, base, rows, scen, srows)
    assert u["ranges"]["cases"]["base"]["scenario"]["closing_cash"] == scen["closing_cash"]


# ---------------------------------------------------------------------------------------------------------------------
# F5: missing data is not scored as acceptable (Idea Validation)
# ---------------------------------------------------------------------------------------------------------------------

def test_viability_leaves_out_what_was_not_given():
    """Only the money figures given: capacity, payment terms, sales cycle and client concentration are not assessed
    (they used to score 60, 85, 85 and 75). Score over what was given: unit economics 65 (25%), break-even 85 (15%),
    runway 100 (15%), proof 10 (12%) -> 45.2 / 0.67 = 67. Coverage 67% -> medium confidence."""
    from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
    r = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000,
                                              variable_cost_per_unit=40, starting_cash=5000))
    assert set(r["not_assessed"]) == {"capacity", "cash_timing", "sales_cycle", "concentration"}
    assert all(r["dimension_scores"][k] is None for k in r["not_assessed"])
    assert r["score"] == 67 and r["data_coverage_pct"] == 67 and r["confidence"] == "medium"
    assert r["rubric_version"] == "v0.5" and "Not assessed" in r["dimension_explanations"]["capacity"]


def test_viability_with_everything_given_is_high_confidence():
    from app.modules.idea_validation.calculations import (CapacityInputs, ConcentrationInputs, FinancialInputs,
                                                          evaluate_viability_v3)
    r = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000,
                                              variable_cost_per_unit=40, starting_cash=5000),
                              payment_terms_days=30, sales_cycle_days=20, capacity=CapacityInputs(50, 1, 80),
                              concentration=ConcentrationInputs(30, 6))
    assert r["not_assessed"] == {} and r["data_coverage_pct"] == 100 and r["confidence"] == "high"


def test_idea_validation_without_research_does_not_assume_market_scores():
    """Market evidence (was 40 from an assumed demand of 50) and trend (was an assumed 60) are not assessed without
    research; the other 70% of the weighting decides the score."""
    from app.modules.idea_validation.idea_validation_engine import IdeaValidationInputs, evaluate_idea_validation_v3
    r = evaluate_idea_validation_v3(IdeaValidationInputs("a", "b", "small bakeries in leeds", "p", "severe", "x", "short", "uk"))
    assert r["dimension_scores"]["market_evidence"] is None and r["dimension_scores"]["trend_strength"] is None
    assert r["data_coverage_pct"] == 70 and r["confidence"] == "medium"
    # severity 100 (20%), clarity 95 (15%), demand 15 (20%), differentiation 40 (15%): 43.25 / 0.70 = 61.8 -> 62
    assert r["score"] == 62


def test_other_modules_get_a_run_in_brief(monkeypatch):
    """The business assistant passes up to 8 runs to its model within a size limit; it gets each run's verdict, reason,
    confidence and robustness in brief instead of the whole run."""
    monkeypatch.setattr(svc, "_today", lambda: MONTH_END)
    monkeypatch.setattr(svc, "_safe_insert", lambda *a, **k: asyncio.sleep(0, result=True))
    run = asyncio.run(svc.create_scenario_run("t", "b", "v", "tmpl_cost_increase", "manual", "x", "cost_increase",
                                              {"cost_increase_pct": 20, "basis": "estimate"}, S(**CASH_BUSINESS)))
    d = svc.run_digest(run)
    assert d["verdict"]["outcome"] == "worse" and d["confidence"] in ("high", "medium", "low") and d["basis"] == "estimate"
    assert d["robustness"].startswith("The verdict is the same")
    import json
    assert len(json.dumps(d)) < 1500 < len(json.dumps(run, default=str))
