"""Simulation audit, Phase 1: an integrated model. Hand-calculated reference cases.

Every expected figure is worked out in the comment beside it. See docs/simulation-audit/03-phase1-changes.md and MODEL.md.
Covers: baseline from complete months with trend and seasonality (F8), the rest of the current month, price response
(F6), hiring and launch costs (F10), tax, VAT, loans, inflation, the balance check, 24-month horizon, the 13-week view,
and the hand-offs to other modules (Live Plan, Agent, shared figures).
"""
import asyncio
import itertools
from datetime import date

import pytest

from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence.baseline import (
    backtest,
    build_baseline,
    complete_months,
    damped_steps,
    seasonal_indices,
)
from app.modules.scenario_intelligence.projection import (
    annuity_payment,
    compare_projections,
    project,
)
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

# £20,000 revenue, £8,000 expenses + £4,000 cost of sales, £30,000 cash, immediate payers (keeps the arithmetic short)
CASH_BUSINESS = dict(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
                     starting_cash=30000, payment_terms_days=0)
MONTH_END = date(2026, 11, 30)      # no days left in the month: no "rest of this month" period


def cash(rows):
    return [r["cash_balance"] for r in rows]


# ---------------------------------------------------------------------------------------------------------------------
# F8: the baseline comes from complete months
# ---------------------------------------------------------------------------------------------------------------------

def test_baseline_uses_complete_months_only():
    """17 Nov: November is in progress and left out. Aug 9,000, Sep 10,000, Oct 11,000 -> average 10,000.
    The old rule took the latest month on record: November's 2,000."""
    state = S(revenue_monthly=2000, revenue_by_month={"2026-08": 9000, "2026-09": 10000, "2026-10": 11000, "2026-11": 2000})
    b = build_baseline(state, date(2026, 11, 17))["revenue"]
    assert b["level"] == 10000 and b["months_used"] == ["2026-08", "2026-09", "2026-10"]
    assert b["trend_applied"] is False and "6 needed" in b["trend_note"]      # 3 months: too few to judge a trend


def test_months_with_nothing_recorded_count_as_zero():
    """July 6,000, nothing in August or September, October 6,000: the last three complete months average 2,000."""
    hist = complete_months({"2026-07": 6000, "2026-10": 6000}, date(2026, 11, 17))
    assert [v for _ym, v in hist] == [6000, 0, 0, 6000]
    assert build_baseline(S(revenue_by_month={"2026-07": 6000, "2026-10": 6000}), date(2026, 11, 17))["revenue"]["level"] == 2000


def test_the_shared_figure_stays_the_level_when_there_is_one():
    """R-4 coordination: the figure the dashboard, risk check and Agent show (agent/figures.py) is the starting level;
    history adds trend and seasonality only."""
    state = S(revenue_monthly=12345, figure_sources={"revenue_monthly": "money received on your invoices over the last 3 months"},
              revenue_by_month={"2026-08": 9000, "2026-09": 10000, "2026-10": 11000})
    b = build_baseline(state, date(2026, 11, 17))["revenue"]
    assert b["level"] == 12345 and b["source"].startswith("shared figure")


def test_a_significant_trend_is_applied_and_damped():
    """12 months rising exactly 500 a month (10,000 ... 15,500, Nov 2025 - Oct 2026): t is unbounded -> significant.
    Level = mean of the last three (14,500, 15,000, 15,500) = 15,000. Month 1 is 3 months from the centre of those three:
    15,000 + 500 x (0.9 + 0.81 + 0.729) = 15,000 + 1,219.50 = 16,219.50."""
    hist = {f"{2025 + (10 + k) // 12}-{(10 + k) % 12 + 1:02d}": 10000 + 500 * k for k in range(12)}
    state = S(revenue_by_month=hist)
    b = build_baseline(state, date(2026, 11, 17))["revenue"]
    assert b["level"] == 15000 and b["trend_per_month"] == 500 and b["trend_applied"]
    assert damped_steps(3) == pytest.approx(2.439)
    rows, _s = project(state, "do_nothing_projection", {}, 3, as_of=date(2026, 11, 17))
    assert rows[0]["revenue"] == 16219.5


def test_noise_is_not_mistaken_for_a_trend():
    """Alternating 9,000 / 11,000 for 12 months: slope is small and not significant -> flat."""
    hist = {f"{2025 + (10 + k) // 12}-{(10 + k) % 12 + 1:02d}": 9000 if k % 2 else 11000 for k in range(12)}
    b = build_baseline(S(revenue_by_month=hist), date(2026, 11, 17))["revenue"]
    assert b["trend_applied"] is False and b["trend_note"] == "no significant trend"


def test_seasonality_needs_two_years_and_follows_the_calendar():
    """24 months (Nov 2024 - Oct 2026), 10,000 a month except December 20,000. Every centred 2x12 moving average is
    (0.5 x 10,000 + 10 x 10,000 + 20,000 + 0.5 x 10,000) / 12 = 10,833.33, so December's index is 20,000 / 10,833.33
    = 1.8462 and every other month 0.9231 (they average 1). Deseasonalised level = 10,000 / 0.9231 = 10,833.33.
    Month 1 (December 2026) = 10,833.33 x 1.8462 = 20,000; month 2 (January) = 10,000."""
    hist = {}
    for k in range(24):
        y, m = 2024 + (10 + k) // 12, (10 + k) % 12 + 1
        hist[f"{y}-{m:02d}"] = 20000 if m == 12 else 10000
    idx = seasonal_indices(complete_months(hist, date(2026, 11, 17)))
    assert idx[12] == pytest.approx(1.8462, abs=1e-4) and idx[1] == pytest.approx(0.9231, abs=1e-4)
    rows, s = project(S(revenue_by_month=hist), "do_nothing_projection", {}, 3, as_of=date(2026, 11, 17))
    assert [r["revenue"] for r in rows[:2]] == pytest.approx([20000, 10000], abs=0.05)
    assert s["baseline"]["revenue"]["seasonality_applied"] is True
    # 23 months: not enough
    hist.pop("2024-11")
    assert seasonal_indices(complete_months(hist, date(2026, 11, 17))) is None


# ---------------------------------------------------------------------------------------------------------------------
# The rest of the current month
# ---------------------------------------------------------------------------------------------------------------------

def test_the_rest_of_this_month_is_included():
    """20 Nov: 10 of November's 30 days remain (1/3). Profit 8,000 a month -> 2,666.67 in the rest of November.
    Cash 30,000 -> 32,666.67 at the end of November -> month 1 (December) 40,666.67."""
    rows, s = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 3, as_of=date(2026, 11, 20))
    assert s["stub"]["days"] == 10 and s["stub"]["profit"] == 2666.67 and s["stub"]["closing_cash"] == 32666.67
    assert cash(rows) == [40666.67, 48666.67, 56666.67]


def test_scenario_changes_start_from_month_1_not_in_the_rest_of_this_month():
    """Costs +50% from month 1: the rest of November is the same in both, so the stubs match."""
    _r, base = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 3, as_of=date(2026, 11, 20))
    _r, scen = project(S(**CASH_BUSINESS), "cost_increase", {"cost_increase_pct": 50}, 3, as_of=date(2026, 11, 20))
    assert base["stub"] == scen["stub"]


# ---------------------------------------------------------------------------------------------------------------------
# F6: customers respond to price
# ---------------------------------------------------------------------------------------------------------------------

def test_price_rise_with_default_elasticity():
    """+10%, elasticity -1 (the default): price x 1.1, volume x 1/1.1 -> revenue stays 20,000; cost of sales follows
    volume: 4,000 / 1.1 = 3,636.36. Profit 20,000 - 3,636.36 - 8,000 = 8,363.64 (was shown as 10,000 with no response)."""
    rows, s = project(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10}, 3)
    assert rows[0]["revenue"] == 20000 and rows[0]["cost_of_sales"] == 3636.36 and rows[0]["profit"] == 8363.64
    assert any("elasticity -1" in a and "assumed" in a for a in s["assumptions"])


def test_a_price_rise_can_lose_money_when_customers_are_sensitive():
    """+10%, elasticity -2: volume x 1.1^-2 = 0.8264. Revenue 20,000 x 1.1 x 0.8264 = 18,181.82; cost of sales
    4,000 x 0.8264 = 3,305.79; profit 6,876.03, below the 8,000 of doing nothing -> worse."""
    rows, s = project(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10, "price_elasticity": -2}, 3)
    assert rows[0]["revenue"] == 18181.82 and rows[0]["profit"] == 6876.03
    _r, base = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 3)
    assert compare_projections(base, s)["state_result"] == "worse"


def test_price_change_on_selected_products_only():
    """Selected products sell 5,000 of the 20,000 (a quarter). +20%, elasticity -0.5: volume x 1.2^-0.5 = 0.91287.
    Revenue = 15,000 + 5,000 x 1.2 x 0.912871 = 20,477.23; cost of sales = 3,000 + 1,000 x 0.912871 = 3,912.87."""
    rows, _s = project(S(**CASH_BUSINESS), "price_change",
                       {"price_change_pct": 20, "price_elasticity": -0.5, "selected_product_revenue_monthly": 5000}, 3)
    assert rows[0]["revenue"] == 20477.23 and rows[0]["cost_of_sales"] == 3912.87


# ---------------------------------------------------------------------------------------------------------------------
# F10: hiring and launches
# ---------------------------------------------------------------------------------------------------------------------

def test_hiring_includes_on_costs_recruitment_start_month_and_ramp():
    """One hire at 3,000 a month, default 15% on-costs (3,450), 2,000 recruitment, starting month 2, bringing in 6,000
    a month at full output over 3 months, cost of sales at the current 20% ratio.
    Month 1: as now, profit 8,000.
    Month 2: revenue 20,000 + 2,000 = 22,000; cost of sales 4,000 + 400 = 4,400; expenses 8,000 + 3,450 + 2,000 = 13,450
             -> profit 4,150.
    Month 3: revenue 24,000; cost of sales 4,800; expenses 11,450 -> profit 7,750.
    Month 4: revenue 26,000; cost of sales 5,200; expenses 11,450 -> profit 9,350."""
    params = {"employee_count": 1, "employee_monthly_cost": 3000, "recruitment_cost_per_hire": 2000, "start_month": 2,
              "revenue_per_hire_monthly": 6000}
    rows, s = project(S(**CASH_BUSINESS), "hire_staff", params, 4)
    assert [r["profit"] for r in rows] == [8000, 4150, 7750, 9350]
    assert any("15% employer on-costs (assumed" in a for a in s["assumptions"])


def test_delaying_a_hire_saves_pay_and_on_costs():
    """Cancelling one 2,000 hire with 10% on-costs saves 2,200 a month: expenses 8,000 -> 5,800."""
    rows, _s = project(S(**CASH_BUSINESS), "delay_hiring",
                       {"employee_count": 1, "employee_monthly_cost": 2000, "employer_oncost_pct": 10}, 3)
    assert rows[0]["expenses"] == 5800


def test_service_launch_costs():
    """+30% revenue over 3 months, +10% overheads over 3 months, 5,000 launch cost in month 1.
    Month 1 (a third of the way): extra revenue 2,000 with cost of sales 400 (20%); expenses 8,000 x 1.0333 = 8,266.67
    plus 5,000 = 13,266.67. Profit 22,000 - 4,400 - 13,266.67 = 4,333.33.
    Month 3 (fully launched): revenue 26,000, cost of sales 5,200, expenses 8,800 -> profit 12,000."""
    rows, _s = project(S(**CASH_BUSINESS), "service_launch",
                       {"revenue_uplift_pct": 30, "cost_uplift_pct": 10, "launch_cost": 5000}, 3)
    assert rows[0]["profit"] == 4333.33 and rows[2]["profit"] == 12000


# ---------------------------------------------------------------------------------------------------------------------
# Tax, VAT, loans, inflation
# ---------------------------------------------------------------------------------------------------------------------

def test_tax_on_profit_set_aside_and_paid():
    """20% of 8,000 = 1,600 set aside a month; profit after tax 6,400; 6 x 6,400 = 38,400.
    Paid in month 6: 9,600 -> closing cash 30,000 + 48,000 - 9,600 = 68,400, nothing owed.
    Not paid in the period: closing cash 78,000 with 9,600 still owed."""
    _r, paid = project(S(**CASH_BUSINESS, profit_tax_rate_pct=20, tax_payment_month=6), "do_nothing_projection", {}, 6)
    assert paid["cumulative_profit"] == 38400 and paid["closing_cash"] == 68400 and paid["closing_tax_owed"] == 0
    _r, owed = project(S(**CASH_BUSINESS, profit_tax_rate_pct=20), "do_nothing_projection", {}, 6)
    assert owed["closing_cash"] == 78000 and owed["closing_tax_owed"] == 9600


def test_losses_reduce_tax_set_aside():
    """Month 1 loses 5,000 (one-off launch 13,000 on top), later months earn: tax is on the running total, never below 0.
    Plain check: a business that only loses money sets nothing aside."""
    _r, s = project(S(revenue_monthly=1000, expenses_monthly=3000, costs_monthly=3000, starting_cash=50000,
                      payment_terms_days=0, profit_tax_rate_pct=25), "do_nothing_projection", {}, 6)
    assert s["total_tax_set_aside"] == 0 and s["cumulative_profit"] == -12000


def test_vat_collected_reclaimed_and_paid_quarterly():
    """VAT 20%, quarterly, half of costs carry VAT. Each month: 4,000 on 20,000 of sales, 1,200 reclaimed on 6,000 of
    costs -> 2,800 net. Months 1-3 (8,400) paid in month 4; months 4-6 (8,400) still owed.
    Closing cash = 30,000 + 48,000 profit + 6 x 2,800 - 8,400 = 86,400."""
    _r, s = project(S(**CASH_BUSINESS, sales_tax_rate_pct=20, sales_tax_on_costs_pct=50), "do_nothing_projection", {}, 6)
    assert s["closing_cash"] == 86400 and s["closing_sales_tax_owed"] == 8400
    assert [d["vat_paid"] for d in s["monthly_detail"]] == [0, 0, 0, 8400, 0, 0]


def test_existing_loan_interest_is_a_cost_and_repayment_is_cash_only():
    """12,000 at 12% a year (1% a month), 1,120 a month. Month 1: interest 120, repaid 1,000 -> profit 7,880,
    cash 30,000 + 8,000 - 1,120 = 36,880. Month 2: interest 110, repaid 1,010."""
    rows, s = project(S(**CASH_BUSINESS, existing_loan_balance=12000, existing_loan_annual_rate_pct=12,
                        existing_loan_monthly_repayment=1120), "do_nothing_projection", {}, 3)
    assert rows[0]["profit"] == 7880 and rows[0]["cash_balance"] == 36880
    assert s["monthly_detail"][1]["interest"] == 110 and s["monthly_detail"][1]["loan_repaid"] == 1010
    assert s["closing_loans"] == pytest.approx(12000 - 1000 - 1010 - 1020.1, abs=0.01)


def test_annuity_payment():
    """10,000 over 12 months at 12% a year: 10,000 x 0.01 / (1 - 1.01^-12) = 888.49. At 0%: 10,000 / 12."""
    assert round(annuity_payment(10000, 12, 12), 2) == 888.49
    assert annuity_payment(12000, 0, 12) == 1000


def test_a_loan_is_judged_on_net_cash_not_cash_received():
    """Borrowing 100,000 at 12% (1% a month) over 12 months for a business that never runs short: cash at the end is
    higher, but so is the debt; the real change is the interest, 1,000 in month 2 falling to about 600 in month 6
    (about 4,100 in all), above the 1,200 materiality line. Net cash and profit both fall -> worse. Judged on cash alone
    it would look "better"."""
    params = {"loan_amount": 100000, "loan_annual_rate_pct": 12, "loan_term_months": 12}
    _r, base = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 6)
    _r, scen = project(S(**CASH_BUSINESS), "take_loan", params, 6)
    v = compare_projections(base, scen)
    assert v["closing_cash_change"] > 0 and v["net_cash_change"] < 0 and v["state_result"] == "worse"


def test_a_loan_that_prevents_running_out_of_cash_is_better():
    """Losing 2,000 a month from 3,000 cash runs out in month 2. A 20,000 loan (0%, 24 months, 833.33 a month from month
    2): month 1 cash 21,000, then 2,833.33 less each month -> 6,833.33 in month 6, never below zero -> improved."""
    weak = S(revenue_monthly=10000, expenses_monthly=12000, costs_monthly=12000, starting_cash=3000, payment_terms_days=0)
    _r, base = project(weak, "do_nothing_projection", {}, 6)
    _r, scen = project(weak, "take_loan", {"loan_amount": 20000, "loan_annual_rate_pct": 0, "loan_term_months": 24}, 6)
    assert base["first_negative_cash_month"] == 2 and scen["min_cash"] > 0 and scen["closing_cash"] == 6833.33
    assert compare_projections(base, scen)["state_result"] == "improved"


def test_cost_inflation_applies_to_costs_without_their_own_trend():
    """12% a year on 8,000 expenses and 4,000 cost of sales: month 12 costs 12,000 x 1.12 = 13,440."""
    rows, _s = project(S(**CASH_BUSINESS, cost_inflation_pct=12), "do_nothing_projection", {}, 12)
    assert rows[11]["costs"] == 13440 and rows[0]["costs"] == pytest.approx(12000 * 1.12 ** (1 / 12), abs=0.01)


# ---------------------------------------------------------------------------------------------------------------------
# The model balances, for every scenario and setting
# ---------------------------------------------------------------------------------------------------------------------

SCENARIOS = [
    ("do_nothing_projection", {}),
    ("client_loss", {"client_loss_pct": 60}),
    ("price_change", {"price_change_pct": 12, "effective_month": 2}),
    ("cost_increase", {"cost_increase_pct": 15}),
    ("hire_staff", {"employee_count": 2, "employee_monthly_cost": 3100, "recruitment_cost_per_hire": 900,
                    "revenue_per_hire_monthly": 4000, "start_month": 3}),
    ("service_launch", {"revenue_uplift_pct": 30, "cost_uplift_pct": 10, "launch_cost": 7000}),
    ("payment_delay", {"delay_months": 2}),
    ("payment_delay", {"delay_months": 1, "selected_pending_receivable_amount": 7000}),
    ("take_loan", {"loan_amount": 25000, "loan_annual_rate_pct": 9, "loan_term_months": 18, "loan_start_month": 2}),
]
SETTINGS = [
    {},
    dict(profit_tax_rate_pct=19, tax_payment_month=9, sales_tax_rate_pct=20, sales_tax_on_costs_pct=40,
         existing_loan_balance=15000, existing_loan_annual_rate_pct=8, existing_loan_monthly_repayment=700, cost_inflation_pct=5),
]
STATES = [
    dict(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000, starting_cash=30000,
         payment_terms_days=45, pending_receivables_schedule=[9000, 4000, 0, 6000], pending_payables_schedule=[2500, 0, 1200]),
    dict(revenue_monthly=3000, expenses_monthly=4200, costs_monthly=4200, starting_cash=1500, payment_terms_days=14,
         revenue_by_month={"2026-05": 2000, "2026-06": 2600, "2026-07": 2900, "2026-08": 3100, "2026-09": 3500, "2026-10": 3800}),
]


@pytest.mark.parametrize("base, settings, scenario, as_of", list(itertools.product(
    STATES, SETTINGS, SCENARIOS, [None, date(2026, 11, 17)])))
def test_every_period_balances(base, settings, scenario, as_of):
    scenario_type, params = scenario
    rows, s = project(S(**base, **settings), scenario_type, params, 24, as_of=as_of)
    assert all(s["checks"].values()), s["checks"]
    assert len(rows) == 24
    # Cash bridge over the whole horizon
    assert s["opening_cash"] + s["total_cash_in"] - s["total_cash_out"] == pytest.approx(s["closing_cash"], abs=0.05)
    # Balance sheet over the whole horizon: change in (cash + receivables) - change in liabilities = profit
    d_assets = (s["closing_cash"] - s["opening_cash"]) + (s["closing_receivables"] - s["opening_receivables"])
    d_liab = ((s["closing_payables"] - s["opening_payables"]) + s["closing_tax_owed"] + s["closing_sales_tax_owed"]
              + (s["closing_loans"] - s["opening_loans"]))
    assert d_assets - d_liab == pytest.approx(s["cumulative_profit"], abs=0.1)
    if as_of:
        assert s["thirteen_week"]["reconciles"] and len(s["thirteen_week"]["weeks"]) == 13


# ---------------------------------------------------------------------------------------------------------------------
# Horizon and the 13-week view
# ---------------------------------------------------------------------------------------------------------------------

def test_horizon_up_to_24_months():
    rows, s = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 30)
    assert len(rows) == 24 and s["months"] == 24


def test_thirteen_week_view_matches_the_monthly_projection():
    """30 Nov: no days left in November. 13 weeks = 1 Dec - 1 Mar (91 days). Cash at the end of February is month 3's
    54,000; 1 March adds a day of March's 8,000 profit: 8,000 / 31 = 258.06 -> 54,258.06."""
    _rows, s = project(S(**CASH_BUSINESS), "do_nothing_projection", {}, 6, as_of=MONTH_END)
    weeks = s["thirteen_week"]["weeks"]
    assert weeks[0]["start"] == "2026-12-01" and weeks[-1]["end"] == "2027-03-01"
    assert weeks[-1]["closing_cash"] == pytest.approx(54258.06, abs=0.02)


def test_thirteen_week_view_uses_due_dates_when_given():
    """An invoice of 5,000 due this week arrives in week 1, not spread through the month."""
    _r, s = project(S(**CASH_BUSINESS, pending_receivables_schedule=[5000], pending_receivables_weekly=[5000]),
                    "do_nothing_projection", {}, 6, as_of=MONTH_END)
    w1 = s["thirteen_week"]["weeks"][0]
    # Week 1 (1-7 Dec): 7 days of December's 20,000 sales in and 12,000 costs out, plus the 5,000 invoice
    assert w1["cash_in"] == pytest.approx(20000 * 7 / 31 + 5000, abs=0.02)
    assert s["thirteen_week"]["uses_due_dates"] is True


# ---------------------------------------------------------------------------------------------------------------------
# Hand-offs to other modules
# ---------------------------------------------------------------------------------------------------------------------

def test_scenario_metrics_carry_what_the_live_plan_reads():
    """live_plan.adopt_scenario reads revenue_monthly, gross_margin_pct, cash_runway_months and clients_count."""
    _rows, metrics = svc._timeline(S(**CASH_BUSINESS, clients_count=7), "revenue_drop", {"revenue_drop_pct": 10}, 6)
    m = metrics["scenario_metrics"]
    assert m["revenue_monthly"] == 18000 and m["gross_margin_pct"] == 80 and m["clients_count"] == 7
    assert "cash_runway_months" in m


def test_adopting_a_scenario_keeps_live_plan_targets_it_does_not_set(monkeypatch):
    """A scenario with no runway figure (cash is not running down) used to blank the plan's runway target."""
    from app.modules.live_plan import service as lp
    inserted = []

    async def fake_select(table, **kw):
        if table == "scenario_runs":
            return {"scenario_run_id": "r1", "scenario_name": "x", "scenario_type": "revenue_drop",
                    "scenario_metrics": {"revenue_monthly": 18000, "gross_margin_pct": 80, "cash_runway_months": None}}
        return []

    async def fake_insert(table, doc):
        inserted.append((table, doc))
        return True

    async def fake_plan(**kw):
        return {"id": "plan1"}

    async def fake_current(plan):
        return {"id": "v1", "version_number": 1}

    async def fake_kpis(plan_id, version_id):
        return [{"code": "cash_runway_months", "target_value_json": 6}, {"code": "monthly_revenue_target", "target_value_json": 20000}]

    async def fake_get(**kw):
        return {"ok": True}

    monkeypatch.setattr(lp, "_safe_select", fake_select)
    monkeypatch.setattr(lp, "_safe_insert", fake_insert)
    monkeypatch.setattr(lp, "ensure_live_plan", fake_plan)
    monkeypatch.setattr(lp, "_get_current_version", fake_current)
    monkeypatch.setattr(lp, "_latest_kpi_rows", fake_kpis)
    monkeypatch.setattr(lp, "get_live_plan", fake_get)
    asyncio.run(lp.adopt_scenario(user_id="u", business_id="b", scenario_id="r1"))
    targets = {d["code"]: d["target_value_json"] for t, d in inserted if t == "plan_kpis"}
    assert targets == {"cash_runway_months": 6, "monthly_revenue_target": 18000}


def test_the_agent_card_and_the_saved_run_use_the_same_date(monkeypatch):
    """chat_actions computes the answer with _timeline and saves the run with create_scenario_run: both get one as_of."""
    import inspect
    from app.modules.agent import chat_actions
    src = inspect.getsource(chat_actions)
    assert "as_of = sis._today()" in src and "as_of=as_of))" in src


def test_service_runs_from_today_with_the_rest_of_the_month(monkeypatch):
    monkeypatch.setattr(svc, "_today", lambda: date(2026, 11, 20))
    monkeypatch.setattr(svc, "_safe_insert", lambda *a, **k: asyncio.sleep(0, result=True))
    run = asyncio.run(svc.create_scenario_run("t", "b", "v", "tmpl_cost_increase", "manual", "x", "cost_increase",
                                              {"cost_increase_pct": 5}, S(**CASH_BUSINESS)))
    proj = run["scenario_metrics"]["projection"]
    assert proj["as_of"] == "2026-11-20" and proj["stub"]["days"] == 10 and proj["thirteen_week"] is not None
    assert run["baseline_metrics"]["projection"]["stub"] == proj["stub"]


# ---------------------------------------------------------------------------------------------------------------------
# Backtest helper (used in Phase 3 reporting)
# ---------------------------------------------------------------------------------------------------------------------

def test_backtest_on_a_flat_business_is_exact():
    hist = {f"2026-{m:02d}": 10000 for m in range(1, 11)}
    bt = backtest(hist, date(2026, 11, 17))
    assert bt["wape_pct"] == 0 and len(bt["months"]) == 3


def test_price_sensitivity_is_the_page_form_of_elasticity():
    """The page asks "sales fall X% for each 1% price rise" (a positive number): sensitivity 2 = elasticity -2, the same
    18,181.82 revenue as above; sensitivity 1 equals the default and is still disclosed as the standard figure."""
    rows, _s = project(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10, "price_sensitivity": 2}, 3)
    assert rows[0]["revenue"] == 18181.82
    _r, s = project(S(**CASH_BUSINESS), "price_change", {"price_change_pct": 10, "price_sensitivity": 1}, 3)
    assert any("assumed: the standard" in a for a in s["assumptions"])


def test_when_both_run_short_the_timing_decides():
    """Losing 2,000 a month from 3,000 cash: short in month 2. A 30,000 loan at 9% over 24 months (about 1,370 a month)
    keeps cash up until about month 10, at the cost of interest -> mixed (time bought at a cost). Losing a further
    1,000 a month brings the shortfall forward to month 1 -> worse."""
    weak = S(revenue_monthly=10000, expenses_monthly=12000, costs_monthly=12000, starting_cash=3000, payment_terms_days=0)
    _r, base = project(weak, "do_nothing_projection", {}, 12)
    _r, loan = project(weak, "take_loan", {"loan_amount": 30000, "loan_annual_rate_pct": 9, "loan_term_months": 24}, 12)
    assert base["first_negative_cash_month"] == 2 and loan["first_negative_cash_month"] > 2
    v = compare_projections(base, loan)
    assert v["outcome"] == "mixed" and "later" in v["reason"]
    _r, worse = project(weak, "cost_increase", {"cost_increase_pct": 25}, 12)
    v = compare_projections(base, worse)
    assert v["state_result"] == "worse" and "sooner" in v["reason"]
