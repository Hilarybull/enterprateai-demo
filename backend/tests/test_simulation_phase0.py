"""Simulation audit, Phase 0: hand-calculated reference cases and accounting checks.

Every expected figure below is worked out by hand in the comment beside it, so a reviewer can check the arithmetic
without trusting the code. See docs/simulation-audit/01-baseline-findings.md (findings F1-F13) and 02-phase0-changes.md.

Conventions under test (projection.py): month 1 is the first full month after today; the projection opens on today's
cash; new sales are collected after the payment terms; money already owed is collected when due (index 0 = this month or
overdue -> month 1); costs are paid in the month incurred.
"""
import asyncio
import itertools

import pytest

from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence.projection import (
    collection_profile,
    compare_projections,
    project,
    run_rate_snapshot,
)
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

# The business from the baseline evidence (E1): £20,000 revenue, £8,000 expenses + £4,000 cost of sales, £30,000 cash,
# customers pay in 30 days.
BUSINESS = dict(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
                starting_cash=30000, payment_terms_days=30)


def cash(rows):
    return [r["cash_balance"] for r in rows]


# ---------------------------------------------------------------------------------------------------------------------
# Timing of collections
# ---------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("days, expected", [
    (0, {0: 1.0}),
    (30, {1: 1.0}),
    (45, {1: 0.5, 2: 0.5}),
    (60, {2: 1.0}),
    (None, {1: 1.0}),       # unknown terms: 30 days, and the run says it assumed so
])
def test_collection_profile(days, expected):
    got = collection_profile(days)
    assert got.keys() == expected.keys()
    for k, v in expected.items():
        assert got[k] == pytest.approx(v)
    assert sum(got.values()) == pytest.approx(1.0)


# ---------------------------------------------------------------------------------------------------------------------
# F1: money owed to the business is collected
# ---------------------------------------------------------------------------------------------------------------------

def test_F1_money_owed_is_collected_and_a_profitable_business_stays_healthy():
    """Baseline evidence E1 showed this business reaching -£42,000 and "critical". By hand:
    month 1: in = 25,000 owed (due now) + 0 new sales (30-day terms) ; out = 12,000 -> 30,000 + 13,000 = 43,000
    month 2: in = 20,000 (month 1 sales) ; out 12,000 -> 51,000 ; then +8,000 a month -> 59, 67, 75, 83 thousand.
    Cross-check: 30,000 + 6 x 8,000 profit + 5,000 fall in receivables (25,000 -> 20,000) = 83,000."""
    rows, summary = project(S(**BUSINESS, pending_receivables_schedule=[25000]), "do_nothing_projection", {}, 6)
    assert cash(rows) == [43000, 51000, 59000, 67000, 75000, 83000]
    assert [r["accruals"] for r in rows] == [20000] * 6           # one month of sales owed at each month end
    assert all(r["profit"] == 8000 for r in rows)
    assert {r["state_label"] for r in rows} <= {"tight", "stable"}
    assert summary["closing_cash"] == 83000 and summary["min_cash"] == 30000


def test_F1_being_owed_money_is_never_worse_than_being_owed_nothing():
    """Same business, nothing owed: month 1 in = 0, out = 12,000 -> 18,000; then +8,000 a month -> 58,000.
    Cross-check: 30,000 + 48,000 profit - 20,000 of sales not yet paid for at the end = 58,000.
    The invoice owed makes the business exactly £25,000 better off in cash, as it should."""
    _r, owed = project(S(**BUSINESS, pending_receivables_schedule=[25000]), "do_nothing_projection", {}, 6)
    rows, none = project(S(**BUSINESS), "do_nothing_projection", {}, 6)
    assert cash(rows) == [18000, 26000, 34000, 42000, 50000, 58000]
    assert owed["closing_cash"] - none["closing_cash"] == 25000


def test_F1_bills_owed_are_paid_when_due():
    """£5,000 of bills due next month (index 1 -> month 1) and £3,000 due in two months (month 2), immediate payers:
    month 1: 30,000 + 20,000 - 12,000 - 5,000 = 33,000 ; month 2: 33,000 + 8,000 - 3,000 = 38,000 ; then +8,000."""
    rows, _s = project(S(**{**BUSINESS, "payment_terms_days": 0}, pending_payables_schedule=[0, 5000, 3000]),
                       "do_nothing_projection", {}, 4)
    assert cash(rows) == [33000, 38000, 46000, 54000]


def test_F1_a_balance_with_no_due_dates_is_collected_on_normal_terms():
    """Older records: £10,000 owed with no schedule, 30-day terms -> collected in month 2 (1 month after month 1).
    month 1: 30,000 - 12,000 = 18,000 ; month 2: 18,000 + 20,000 + 10,000 - 12,000 = 36,000."""
    rows, summary = project(S(**BUSINESS, accrued_revenue_total=10000), "do_nothing_projection", {}, 3)
    assert cash(rows)[:2] == [18000, 36000]
    assert summary["opening_receivables"] == 10000


# ---------------------------------------------------------------------------------------------------------------------
# F2: a delayed payment is delayed once
# ---------------------------------------------------------------------------------------------------------------------

def test_F2_a_selected_invoice_paid_two_months_late_moves_once():
    """£25,000 invoice due in month 1 (index 1), paid 2 months late -> month 3.
    month 1: 30,000 - 12,000 = 18,000 ; month 2: +20,000 - 12,000 = 26,000 ; month 3: +20,000 + 25,000 - 12,000 = 59,000
    then 67, 75, 83 thousand. By month 6 the cash is the same as if it had been paid on time (83,000), because the money
    arrived within the period: a one-off delay changes timing, not the total."""
    state = S(**BUSINESS, pending_receivables_schedule=[0, 25000])
    rows, scen = project(state, "payment_delay", {"delay_months": 2, "selected_pending_receivable_amount": 25000}, 6)
    _b, base = project(state, "do_nothing_projection", {}, 6)
    assert cash(rows) == [18000, 26000, 59000, 67000, 75000, 83000]
    assert base["closing_cash"] == 83000 and scen["closing_cash"] == 83000
    v = compare_projections(base, scen)
    assert v["outcome"] == "no_material_change" and v["state_result"] == "neutral"


def test_F2_every_customer_paying_two_months_later():
    """All payments 2 months later (the agent's "customers paid 60 days late"), £25,000 owed now:
    owed 25,000 -> month 3 ; month m's sales (normally m+1) -> m+3, so months 4-6 receive 20,000 each.
    cash: 18,000, 6,000, 6,000 + 25,000 - 12,000 = 19,000, 27,000, 35,000, 43,000.
    Against 83,000 if nothing changes: £40,000 less cash, same profit -> worse.
    Receivables at the end: 25,000 + 6 x 20,000 - (25,000 + 3 x 20,000) = 60,000 (three months of sales)."""
    state = S(**BUSINESS, pending_receivables_schedule=[25000])
    rows, scen = project(state, "payment_delay", {"delay_months": 2}, 6)
    _b, base = project(state, "do_nothing_projection", {}, 6)
    assert cash(rows) == [18000, 6000, 19000, 27000, 35000, 43000]
    assert scen["closing_receivables"] == 60000
    v = compare_projections(base, scen)
    assert v["closing_cash_change"] == -40000 and v["cumulative_profit_change"] == 0 and v["state_result"] == "worse"


# ---------------------------------------------------------------------------------------------------------------------
# F7: the verdict follows the money, judged the same way for every scenario
# ---------------------------------------------------------------------------------------------------------------------

def test_F7_a_price_rise_that_more_than_doubles_profit_is_improved_not_neutral():
    """Baseline evidence E2: +50% price, profit 8,000 -> 18,000 a month, stability score unchanged -> was "neutral".
    Immediate payers, no ramp: 6 x 18,000 = 108,000 profit against 6 x 8,000 = 48,000 -> improved."""
    state = S(**{**BUSINESS, "payment_terms_days": 0})
    # Phase 1 (F6): customers respond to price by default; elasticity 0 reproduces the Phase 0 hand calculation
    _rows, metrics = svc._timeline(state, "price_change", {"price_change_pct": 50, "price_elasticity": 0}, 6)
    v = metrics["verdict"]
    assert v["cumulative_profit_change"] == 60000 and v["state_result"] == "improved"


def test_F7_losing_the_only_client_that_takes_cash_below_zero_is_worse():
    """£10,000 revenue, £9,000 expenses, £2,000 cash, immediate payers; the only client (100%) leaves over 2 months.
    month 1: revenue 5,000 -> cash 2,000 + 5,000 - 9,000 = -2,000. Doing nothing never goes below 2,000."""
    state = S(revenue_monthly=10000, expenses_monthly=9000, costs_monthly=9000, starting_cash=2000,
              payment_terms_days=0, top_client_share_pct=100, clients_count=1)
    _rows, metrics = svc._timeline(state, "client_loss", {"client_loss_pct": 100}, 6)
    v = metrics["verdict"]
    assert v["cash_shortfall_introduced"] and v["state_result"] == "worse" and "month 1" in v["reason"]


def test_F7_a_change_below_one_percent_of_revenue_is_not_material():
    """Costs up 0.5%: 12,000 -> 12,060 a month from month 2 (2-month ramp: month 1 +0.25%).
    Profit falls by 30 + 5 x 60 = 330 over 6 months; materiality = 1% of 120,000 revenue = 1,200 -> no material change."""
    _rows, metrics = svc._timeline(S(**BUSINESS), "cost_increase", {"cost_increase_pct": 0.5}, 6)
    v = metrics["verdict"]
    assert v["materiality_threshold"] == 1200 and v["cumulative_profit_change"] == -360
    assert v["outcome"] == "no_material_change"


def test_F7_every_scenario_is_judged_at_the_end_of_the_same_period():
    """Monthly figures for the "after" side come from the last projection month for every scenario (no more month 12 for
    losses and month 1 for everything else). Costs up 10% with a 2-month ramp: month 1 would show 12,600; month 6 13,200."""
    _rows, metrics = svc._timeline(S(**BUSINESS), "cost_increase", {"cost_increase_pct": 10}, 6)
    assert metrics["scenario_metrics"]["monthly_costs"] == 13200


# ---------------------------------------------------------------------------------------------------------------------
# Accounting checks that must hold for every scenario and input
# ---------------------------------------------------------------------------------------------------------------------

SCENARIOS = [
    ("do_nothing_projection", {}),
    ("client_loss", {"client_loss_pct": 60}),
    ("revenue_drop", {"revenue_drop_pct": 25}),
    ("price_change", {"price_change_pct": 12, "effective_month": 2}),
    ("cost_increase", {"cost_increase_pct": 15}),
    ("hire_staff", {"employee_count": 2, "employee_monthly_cost": 3100}),
    ("contractor_addition", {"employee_count": 1, "contractor_monthly_cost": 2500}),
    ("reduce_fixed_cost", {"cost_reduction_pct": 20}),
    ("delay_hiring", {"employee_count": 1, "employee_monthly_cost": 1500}),
    ("service_launch", {"revenue_uplift_pct": 30, "cost_uplift_pct": 10}),
    ("payment_delay", {"delay_months": 2}),
    ("payment_delay", {"delay_months": 1, "selected_pending_receivable_amount": 7000}),
]
STATES = [
    S(**BUSINESS),
    S(**BUSINESS, pending_receivables_schedule=[9000, 4000, 0, 6000], pending_payables_schedule=[2500, 0, 1200]),
    S(revenue_monthly=3000, expenses_monthly=4200, costs_monthly=4200, starting_cash=1500, payment_terms_days=45,
      pending_receivables_schedule=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 800]),
    S(revenue_monthly=55000, expenses_monthly=21000, cost_of_sales_monthly=26000, costs_monthly=47000, starting_cash=-4000,
      payment_terms_days=14, accrued_revenue_total=18000),
]


@pytest.mark.parametrize("state, scenario", list(itertools.product(STATES, SCENARIOS)))
def test_cash_and_receivables_always_reconcile(state, scenario):
    scenario_type, params = scenario
    rows, s = project(state, scenario_type, params, 12)
    # Phase 1 added a third check (balance_sheet_balances); every check must hold
    assert {"cash_reconciles", "receivables_reconcile", "balance_sheet_balances"} <= set(s["checks"]) and all(s["checks"].values())
    # Cash: opening + everything received - everything paid = closing
    assert s["opening_cash"] + s["total_cash_in"] - s["total_cash_out"] == pytest.approx(s["closing_cash"], abs=0.02)
    # Receivables: opening + sales - collections = closing
    assert s["opening_receivables"] + s["total_revenue"] - s["total_cash_in"] == pytest.approx(s["closing_receivables"], abs=0.02)
    # Profit is revenue less costs, and the last row agrees with the totals
    assert s["total_revenue"] - s["total_costs"] == pytest.approx(s["cumulative_profit"], abs=0.02)
    assert rows[-1]["cumulative_profit"] == pytest.approx(s["cumulative_profit"], abs=0.01)
    assert rows[-1]["cash_balance"] == pytest.approx(s["closing_cash"], abs=0.01)
    # Indirect method: change in cash = profit - increase in receivables - opening bills paid
    bills_paid = s["total_cash_out"] - s["total_costs"]
    assert s["closing_cash"] - s["opening_cash"] == pytest.approx(
        s["cumulative_profit"] - (s["closing_receivables"] - s["opening_receivables"]) - bills_paid, abs=0.05)


def test_a_projection_states_its_assumptions():
    _r, s = project(S(**{**BUSINESS, "payment_terms_days": None}), "do_nothing_projection", {}, 6)
    text = " ".join(s["assumptions"])
    # Phase 1: tax, VAT, loans and inflation are now modelled (or said to be off); what is still outside is "Not modelled"
    assert "30 days (assumed" in text and "Not modelled" in text and "month 1" in text.lower()


# ---------------------------------------------------------------------------------------------------------------------
# F3 / F4: engine scores come from the business, and nothing is invented
# ---------------------------------------------------------------------------------------------------------------------

def _engines(state, scenario_type, params, months=6):
    from app.modules.scenario_intelligence.orchestration_service import run_scenario_with_all_engines
    _r, base = project(state, "do_nothing_projection", {}, months)
    _r, scen = project(state, scenario_type, params, months)
    return asyncio.run(run_scenario_with_all_engines(
        scenario_id="t", business_id="b", tenant_id="t",
        baseline_end_state=run_rate_snapshot(state, "do_nothing_projection", {}, months, cash=base["closing_cash"]),
        scenario_end_state=run_rate_snapshot(state, scenario_type, params, months, cash=scen["closing_cash"]),
        scenario_type=scenario_type, timeline_months=months, verdict=compare_projections(base, scen)))


def test_F3_the_same_scenario_moves_different_businesses_differently():
    """Baseline evidence E3: a strong and a weak business got identical score changes from a fixed table."""
    strong = S(revenue_monthly=50000, expenses_monthly=20000, costs_monthly=20000, starting_cash=200000, payment_terms_days=0)
    weak = S(revenue_monthly=10000, expenses_monthly=11000, costs_monthly=11000, starting_cash=12000, payment_terms_days=0)
    # Phase 1 (F6): elasticity 0 keeps this a test of F3 (with no cost of sales, a unit-elastic price rise changes nothing)
    rise = {"price_change_pct": 10, "price_elasticity": 0}
    d_strong = _engines(strong, "price_change", rise)["scenario"]["engine_deltas"]["survival"]
    d_weak = _engines(weak, "price_change", rise)["scenario"]["engine_deltas"]["survival"]
    assert d_strong["change"] == 0          # already at the top of every survival band: a price rise changes nothing
    assert d_weak["change"] > 0 and d_weak["direction"] == "better"      # stops burning cash: survival improves


def test_F3_no_fixed_table_ranking_or_drawn_timeline_remains():
    import inspect
    from app.engines.scenario import orchestrator
    src = inspect.getsource(orchestrator)
    assert "_SCENARIO_BASE_IMPACT" not in src
    out = _engines(S(**BUSINESS), "hire_staff", {"employee_count": 1, "employee_monthly_cost": 3000})["scenario"]
    assert out["scenario_ranking_score"] is None and out["timeline"] == []


def test_F4_engines_without_data_are_not_assessed_and_say_why():
    from app.modules.scenario_intelligence.orchestration_service import run_full_engine_suite
    out = asyncio.run(run_full_engine_suite(S(**BUSINESS)))
    assert out["coverage"]["assessed"] == ["survival"]
    for engine in ("viability", "stability", "growth", "fragility", "master"):
        assert out[engine]["assessed"] is False and out[engine]["reason"] and out[engine]["scores"] is None
    assert out["master"]["bi_score"] is None


def test_F4_survival_counts_cost_of_sales_in_the_burn():
    """£10,000 revenue, £2,000 expenses, £9,000 cost of sales: losing £1,000 a month. Survival used to be given expenses
    only (net +£8,000, no burn)."""
    from app.modules.scenario_intelligence.orchestration_service import run_full_engine_suite
    out = asyncio.run(run_full_engine_suite(S(revenue_monthly=10000, expenses_monthly=2000, cost_of_sales_monthly=9000,
                                              costs_monthly=11000, starting_cash=6000)))
    assert out["survival"]["metrics"]["burn_rate"] == 1000 and out["survival"]["metrics"]["runway_months"] == 6


# ---------------------------------------------------------------------------------------------------------------------
# F9: break-even is a margin of safety, not months
# ---------------------------------------------------------------------------------------------------------------------

def test_F9_break_even_is_reported_and_scored_as_margin_of_safety():
    """Price 100, variable cost 40, fixed 2,000: break-even = 2,000 / 60 = 33.33 sales a month.
    Planning 50: ratio 0.667, margin of safety 33.3% -> score 85.
    Planning 10: needs 3.33x the plan -> score 15. The old bands read 3.33 as "months" and scored it 85."""
    from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
    ok = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000,
                                               variable_cost_per_unit=40, starting_cash=0))
    m = ok["metrics"]
    assert "break_even_months" not in m
    assert m["break_even_units"] == pytest.approx(33.333, abs=0.001)
    assert m["margin_of_safety_pct"] == pytest.approx(33.333, abs=0.001)
    assert ok["dimension_scores"]["break_even"] == 85
    short = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=10, fixed_costs_monthly=2000,
                                                  variable_cost_per_unit=40, starting_cash=0))
    assert short["dimension_scores"]["break_even"] == 15
    assert "below break-even" in short["dimension_explanations"]["break_even"]
