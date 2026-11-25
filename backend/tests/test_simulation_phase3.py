"""Simulation audit, Phase 3: validation and governance.

1. Invariants checked on 300 randomly generated businesses and scenarios (fixed seed, so any failure can be reproduced):
   the accounting identities, the 13-week view, determinism, and properties any sound model must have (more cash in
   the bank never means less cash later; a "change" of 0% is no change; more revenue never lowers profit...).
2. Forecast accuracy against actual results (accuracy.py), worked out by hand.
See docs/simulation-audit/05-phase3-changes.md and MODEL.md.
"""
import asyncio
import random
from datetime import date

import pytest

from app.modules.scenario_intelligence import service as svc
from app.modules.scenario_intelligence.accuracy import accuracy_report, tracked_accuracy
from app.modules.scenario_intelligence.projection import MAX_MONTHS, MODEL_VERSION, compare_projections, project
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

SEED = 20261117
SCENARIOS = {
    "do_nothing_projection": lambda r: {},
    "client_loss": lambda r: {"client_loss_pct": r.uniform(0, 100)},
    "revenue_drop": lambda r: {"revenue_drop_pct": r.uniform(0, 100)},
    "price_change": lambda r: {"price_change_pct": r.uniform(-30, 50), "price_sensitivity": r.uniform(0, 3),
                               "effective_month": r.randint(1, 4)},
    "cost_increase": lambda r: {"cost_increase_pct": r.uniform(0, 60)},
    "hire_staff": lambda r: {"employee_count": r.randint(1, 4), "employee_monthly_cost": r.uniform(500, 6000),
                             "employer_oncost_pct": r.uniform(0, 30), "recruitment_cost_per_hire": r.uniform(0, 5000),
                             "start_month": r.randint(1, 6), "revenue_per_hire_monthly": r.choice([0, r.uniform(0, 9000)])},
    "contractor_addition": lambda r: {"employee_count": r.randint(1, 3), "contractor_monthly_cost": r.uniform(200, 5000)},
    "reduce_fixed_cost": lambda r: {"cost_reduction_pct": r.uniform(0, 80)},
    "delay_hiring": lambda r: {"employee_count": r.randint(1, 3), "employee_monthly_cost": r.uniform(500, 5000)},
    "service_launch": lambda r: {"revenue_uplift_pct": r.uniform(0, 80), "cost_uplift_pct": r.uniform(0, 40),
                                 "launch_cost": r.uniform(0, 20000)},
    "payment_delay": lambda r: {"delay_months": r.randint(0, 4),
                                "selected_pending_receivable_amount": r.choice([0, r.uniform(0, 20000)])},
    "take_loan": lambda r: {"loan_amount": r.uniform(1000, 100000), "loan_annual_rate_pct": r.uniform(0, 20),
                            "loan_term_months": r.randint(3, 48), "loan_start_month": r.randint(1, 6)},
}


def random_state(r: random.Random) -> dict:
    revenue = r.choice([0, r.uniform(500, 200000)])
    cos = revenue * r.uniform(0, 0.8)
    expenses = r.uniform(0, 150000)
    state = dict(revenue_monthly=round(revenue, 2), cost_of_sales_monthly=round(cos, 2), expenses_monthly=round(expenses, 2),
                 costs_monthly=round(cos + expenses, 2), starting_cash=round(r.uniform(-20000, 300000), 2),
                 payment_terms_days=r.choice([None, 0, 7, 14, 30, 45, 60, 90]),
                 pending_receivables_schedule=[round(r.uniform(0, 30000), 2) for _ in range(r.randint(0, 6))],
                 pending_payables_schedule=[round(r.uniform(0, 20000), 2) for _ in range(r.randint(0, 6))])
    if r.random() < 0.5:
        state["revenue_by_month"] = {f"{2024 + (k + 10) // 12}-{(k + 10) % 12 + 1:02d}": round(revenue * r.uniform(0.6, 1.4), 2)
                                     for k in range(r.randint(1, 26))}
    if r.random() < 0.5:
        state.update(profit_tax_rate_pct=r.uniform(0, 35), tax_payment_month=r.choice([None, r.randint(1, 12)]),
                     sales_tax_rate_pct=r.choice([None, 5, 20]), sales_tax_on_costs_pct=r.uniform(0, 100),
                     existing_loan_balance=r.choice([None, r.uniform(0, 80000)]), existing_loan_annual_rate_pct=r.uniform(0, 15),
                     existing_loan_monthly_repayment=r.choice([None, r.uniform(0, 4000)]), cost_inflation_pct=r.uniform(0, 15))
    return state


def cases(n=300):
    r = random.Random(SEED)
    out = []
    for i in range(n):
        scenario_type = r.choice(list(SCENARIOS))
        out.append((i, random_state(r), scenario_type, SCENARIOS[scenario_type](r), r.randint(3, MAX_MONTHS),
                    r.choice([None, date(2026, r.randint(1, 12), r.randint(1, 28))])))
    return out


CASES = cases()


@pytest.mark.parametrize("i, state, scenario_type, params, months, as_of", CASES, ids=[f"case{c[0]}-{c[2]}" for c in CASES])
def test_invariants_hold_for_any_business(i, state, scenario_type, params, months, as_of):
    st = S(**state)
    rows, s = project(st, scenario_type, params, months, as_of=as_of)
    # Every period reconciles: cash, receivables, balance sheet
    assert all(s["checks"].values()), s["checks"]
    assert len(rows) == months and [r["month_index"] for r in rows] == list(range(1, months + 1))
    # Whole-period bridges
    assert s["opening_cash"] + s["total_cash_in"] - s["total_cash_out"] == pytest.approx(s["closing_cash"], abs=0.05)
    d_assets = (s["closing_cash"] - s["opening_cash"]) + (s["closing_receivables"] - s["opening_receivables"])
    d_liab = ((s["closing_payables"] - s["opening_payables"]) + s["closing_tax_owed"] + s["closing_sales_tax_owed"]
              + (s["closing_loans"] - s["opening_loans"]))
    assert d_assets - d_liab == pytest.approx(s["cumulative_profit"], abs=0.2)
    # Nothing negative that can't be
    assert all(r["revenue"] >= 0 and r["cost_of_sales"] >= 0 for r in rows)
    assert s["closing_receivables"] >= -0.05 and s["closing_loans"] >= -0.05
    # The last row agrees with the summary
    assert rows[-1]["cash_balance"] == pytest.approx(s["closing_cash"], abs=0.01)
    assert rows[-1]["cumulative_profit"] == pytest.approx(s["cumulative_profit"], abs=0.01)
    # Same inputs, same answer
    assert project(st, scenario_type, params, months, as_of=as_of)[1]["closing_cash"] == s["closing_cash"]
    # The weekly view reconciles whenever it is produced
    if as_of:
        assert s["thirteen_week"]["reconciles"] and len(s["thirteen_week"]["weeks"]) == 13
        assert s["model_version"] == MODEL_VERSION and len(s["forecast_by_month"]) == months


@pytest.mark.parametrize("i, state, scenario_type, params, months, as_of", CASES[:120], ids=[f"case{c[0]}" for c in CASES[:120]])
def test_more_cash_today_is_exactly_more_cash_later(i, state, scenario_type, params, months, as_of):
    """No interest is earned on cash, so 10,000 more today is 10,000 more in every month, and profit is unchanged."""
    _r, a = project(S(**state), scenario_type, params, months, as_of=as_of)
    _r, b = project(S(**{**state, "starting_cash": state["starting_cash"] + 10000}), scenario_type, params, months, as_of=as_of)
    assert b["closing_cash"] - a["closing_cash"] == pytest.approx(10000, abs=0.02)
    assert b["cumulative_profit"] == pytest.approx(a["cumulative_profit"], abs=0.01)


@pytest.mark.parametrize("i, state, scenario_type, params, months, as_of", CASES[:120], ids=[f"case{c[0]}" for c in CASES[:120]])
def test_more_revenue_never_lowers_profit_and_more_costs_never_raise_it(i, state, scenario_type, params, months, as_of):
    st = S(**state)
    _r, base = project(st, scenario_type, params, months, as_of=as_of)
    _r, more_rev = project(st, scenario_type, params, months, as_of=as_of, adjust={"revenue": 1.1, "cost_of_sales": 1.0})
    _r, more_cost = project(st, scenario_type, params, months, as_of=as_of, adjust={"expenses": 1.1})
    assert more_rev["total_revenue"] >= base["total_revenue"] - 0.01
    # Before tax: tax set aside can only take part of any gain
    assert more_rev["cumulative_profit"] + more_rev["total_tax_set_aside"] >= base["cumulative_profit"] + base["total_tax_set_aside"] - 0.01
    assert more_cost["cumulative_profit"] <= base["cumulative_profit"] + 0.01


@pytest.mark.parametrize("scenario_type, params", [
    ("price_change", {"price_change_pct": 0}), ("cost_increase", {"cost_increase_pct": 0}),
    ("revenue_drop", {"revenue_drop_pct": 0}), ("reduce_fixed_cost", {"cost_reduction_pct": 0}),
    ("payment_delay", {"delay_months": 0}), ("service_launch", {"revenue_uplift_pct": 0, "cost_uplift_pct": 0}),
    ("client_loss", {"client_loss_pct": 0}),
])
def test_a_change_of_nothing_is_no_change(scenario_type, params):
    r = random.Random(SEED + 1)
    for _ in range(25):
        state = S(**{**random_state(r), "top_client_share_pct": None})
        as_of = date(2026, 11, 17)
        _r, base = project(state, "do_nothing_projection", {}, 12, as_of=as_of)
        _r, scen = project(state, scenario_type, params, 12, as_of=as_of)
        assert scen["closing_cash"] == base["closing_cash"] and scen["cumulative_profit"] == base["cumulative_profit"]
        assert compare_projections(base, scen)["outcome"] == "no_material_change"


# ---------------------------------------------------------------------------------------------------------------------
# Forecast accuracy against what actually happened
# ---------------------------------------------------------------------------------------------------------------------

def _run(name, forecast, decision=None, scenario_forecast=None, as_of="2026-07-20"):
    return dict(scenario_run_id=name, scenario_name=name, decision_status=decision,
                baseline_projection={"as_of": as_of, "model_version": MODEL_VERSION, "forecast_by_month": forecast},
                scenario_projection={"as_of": as_of, "forecast_by_month": scenario_forecast or {}})


ACTUAL = {"2026-08": 9000, "2026-09": 10000, "2026-10": 11000, "2026-11": 3000}      # November in progress


def test_tracked_accuracy_by_hand():
    """Forecast 10,000 for Aug, Sep, Oct and Nov; actual 9,000, 10,000, 11,000 (November not complete: left out).
    WAPE = (1,000 + 0 + 1,000) / 30,000 = 6.7%; bias = (1,000 + 0 - 1,000) / 30,000 = 0%."""
    f = {m: {"revenue": 10000} for m in ("2026-08", "2026-09", "2026-10", "2026-11")}
    out = tracked_accuracy([_run("r1", f)], ACTUAL, date(2026, 11, 17))
    assert out["overall"] == {"months": 3, "wape_pct": 6.7, "bias_pct": 0.0}
    assert out["runs"][0]["compared"] == "no-change forecast"


def test_an_accepted_scenario_is_judged_on_its_own_forecast():
    """Accepted: the scenario's forecast (12,000 a month) is compared against 9,000, 10,000, 11,000.
    Bias = (3,000 + 2,000 + 1,000) / 30,000 = +20% (forecasts too high)."""
    base = {m: {"revenue": 10000} for m in ("2026-08", "2026-09", "2026-10")}
    scen = {m: {"revenue": 12000} for m in ("2026-08", "2026-09", "2026-10")}
    out = tracked_accuracy([_run("r1", base, "accepted", scen)], ACTUAL, date(2026, 11, 17))
    assert out["runs"][0]["compared"] == "scenario (accepted)" and out["overall"]["bias_pct"] == 20.0


def test_nothing_to_compare_yet_says_so():
    out = tracked_accuracy([_run("r1", {"2026-12": {"revenue": 1}})], ACTUAL, date(2026, 11, 17))
    assert out["runs"] == [] and out["overall"]["wape_pct"] is None and "No earlier forecast" in out["note"]


def test_backtest_needs_four_months():
    out = accuracy_report([], {"2026-09": 1, "2026-10": 1}, date(2026, 11, 17))
    assert out["backtest"]["wape_pct"] is None and "4 complete months" in out["backtest"]["note"]


def test_backtest_compares_with_the_naive_method():
    """Steady growth of 500 a month, Jan-Oct (10,000 ... 14,500). The last three months tested are Aug 13,500, Sep 14,000
    and Oct 14,500; the naive method is 500 short each time: 1,500 / 42,000 = 3.6%. The baseline
    method (3-month average plus a damped trend, once 6 months are on record) is closer."""
    hist = {f"2026-{m:02d}": 10000 + 500 * (m - 1) for m in range(1, 11)}
    out = accuracy_report([], hist, date(2026, 11, 17))["backtest"]
    assert out["naive_wape_pct"] == pytest.approx(3500 / 91000 * 100, abs=0.05)
    assert out["wape_pct"] == 3.9 and out["skill"] == "worse than the naive method"
    assert len(out["months"]) == 7


def test_saved_runs_are_tracked_end_to_end(monkeypatch):
    """A run made at the end of July forecasts Aug onwards; by 17 November, Aug-Oct can be checked."""
    monkeypatch.setattr(svc, "_safe_insert", lambda *a, **k: asyncio.sleep(0, result=False))      # kept in memory
    monkeypatch.setattr(svc, "_safe_select", lambda *a, **k: asyncio.sleep(0, result=None))
    state = S(revenue_monthly=10000, expenses_monthly=6000, costs_monthly=6000, starting_cash=5000, payment_terms_days=0)
    asyncio.run(svc.create_scenario_run("tA", "bA", "v", "tmpl_cost_increase", "manual", "x", "cost_increase",
                                        {"cost_increase_pct": 5, "timeline_months": 6}, state, as_of=date(2026, 7, 31)))
    out = asyncio.run(svc.forecast_accuracy("tA", "bA", S(revenue_by_month=ACTUAL), as_of=date(2026, 11, 17)))
    run = out["tracked"]["runs"][0]
    assert [p["month"] for p in run["pairs"]] == ["2026-08", "2026-09", "2026-10"]
    assert run["wape_pct"] == pytest.approx(2000 / 30000 * 100, abs=0.1) and run["model_version"] == MODEL_VERSION
