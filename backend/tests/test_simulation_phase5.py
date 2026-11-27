"""Simulation audit, Phase 5 (model projection-1.4): the further factors of a standard forecast.
docs/simulation-audit/08-phase5-changes.md. Every figure worked out by hand in the test's comment."""
from datetime import date, timedelta

import pytest

from app.modules.scenario_intelligence import factors as F
from app.modules.scenario_intelligence import projection as P
from app.modules.scenario_intelligence import router as si
from app.modules.scenario_intelligence import uncertainty as U
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

BASE = "do_nothing_projection"


def _plain(**kw):
    """Revenue 10,000, cost of sales 2,000, expenses 3,000 a month; customers pay at once; cash 5,000; no date."""
    return S(**{**dict(revenue_monthly=10000, cost_of_sales_monthly=2000, expenses_monthly=3000, starting_cash=5000,
                       payment_terms_days=0), **kw})


# ── Funding, owners, equipment and bad debts together ─────────────────────────────────────────────────────────────

def test_equity_drawings_equipment_and_bad_debts_by_hand():
    """3 months. Equity 20,000 in month 2; drawings 1,000 a month; equipment 6,000 bought in month 1 over 12 months
    (500 a month depreciation); 5% of sales never collected (500 a month, collected 9,500).
    Profit a month = 10,000 - 2,000 - 3,000 - 500 depreciation - 500 bad debts = 4,000 -> 12,000.
    Cash: m1 5,000 + 9,500 - 5,000 - 6,000 - 1,000 = 2,500; m2 + 9,500 - 5,000 + 20,000 - 1,000 = 26,000;
    m3 + 9,500 - 5,000 - 1,000 = 29,500. Equipment at the end 6,000 - 1,500 = 4,500.
    Balance: change in cash 24,500 + equipment 4,500 = 29,000 = profit 12,000 + equity 20,000 - drawings 3,000."""
    st = _plain(funding_events=[{"type": "equity", "amount": 20000, "month": 2}], owner_drawings_monthly=1000,
                capital_purchases=[{"amount": 6000, "month": 1, "life_months": 12}], bad_debt_pct=5)
    rows, s = P.project(st, BASE, {}, 3)
    assert [r["cash_balance"] for r in rows] == [2500, 26000, 29500]
    assert s["cumulative_profit"] == 12000 and s["closing_fixed_assets"] == 4500 and s["closing_receivables"] == 0
    assert s["total_depreciation"] == 1500 and s["total_bad_debts"] == 1500
    assert s["total_funding_in"] == 20000 and s["total_owner_payments"] == 3000
    assert all(s["checks"].values())
    assert rows[0]["expenses"] == 3000 + 500 + 500      # operating expenses + depreciation + bad debts


def test_a_grant_is_income_and_cash_not_sales():
    """A 5,000 grant in month 1 (3 months, the minimum horizon): profit 3 x 5,000 + 5,000 = 20,000; revenue (sales)
    unchanged, the grant shown as other income."""
    rows, s = P.project(_plain(funding_events=[{"type": "grant", "amount": 5000, "month": 1}]), BASE, {}, 3)
    assert rows[0]["revenue"] == 10000 and rows[0]["other_income"] == 5000 and rows[0]["profit"] == 10000
    assert s["total_grants"] == 5000 and s["cumulative_profit"] == 20000 and all(s["checks"].values())


def test_dividends_reduce_cash_not_profit():
    """3 months: profit 15,000 whatever is paid out; cash after month 2 = 5,000 + 2 x 5,000 - 4,000."""
    rows, s = P.project(_plain(dividends=[{"amount": 4000, "month": 2}]), BASE, {}, 3)
    assert s["cumulative_profit"] == 15000 and rows[1]["cash_balance"] == 5000 + 2 * 5000 - 4000 and all(s["checks"].values())


# ── Payroll by country ────────────────────────────────────────────────────────────────────────────────────────────

def test_uk_employer_costs_by_hand():
    """£3,000 a month: NI 15% x (3,000 - 5,000/12 = 2,583.33) = 387.50; pension 3% x (3,000 - 6,240/12 = 2,480) = 74.40."""
    c = F.employer_cost_per_person("United Kingdom", 3000)
    assert (c["ni_or_tax"], c["pension"], c["total"]) == (387.5, 74.4, 461.9)
    high = F.employer_cost_per_person("GB", 6000)     # pension capped at qualifying earnings: 3% x (50,270 - 6,240) / 12 = 110.08
    assert high["pension"] == 110.08 and high["ni_or_tax"] == 837.5


def test_nigeria_and_us_employer_costs_by_hand():
    """Nigeria N200,000: pension 10% 20,000 + NSITF 1% 2,000 + ITF 1% 2,000 = 24,000.
    US $5,000: FICA 7.65% 382.50 + FUTA 0.6% x 7,000 / 12 = 3.50 -> 386.00."""
    ng = F.employer_cost_per_person("Nigeria", 200000)
    us = F.employer_cost_per_person("US", 5000)
    assert (ng["pension"], ng["other"], ng["total"]) == (20000, 4000, 24000)
    assert (us["ni_or_tax"], us["other"], us["total"]) == (382.5, 3.5, 386.0)
    other = F.employer_cost_per_person("France", 2000)
    assert other["total"] == 300 and "standard figure" in other["basis"]


def test_payroll_settings_add_staff_costs_unless_already_recorded():
    """2 staff at £3,000 in the UK: 2 x (3,000 + 461.90) = 6,923.80 a month on top of expenses; 3 months 20,771.40. If
    salaries are already in the recorded expenses, nothing is added (no double counting)."""
    st = _plain(tax_country="GB", payroll_staff_count=2, payroll_gross_monthly_per_person=3000)
    rows, s = P.project(st, BASE, {}, 3)
    assert rows[0]["expenses"] == pytest.approx(3000 + 6923.80) and s["total_payroll"] == pytest.approx(20771.40)
    _r, recorded = P.project(st.model_copy(update={"payroll_in_recorded_expenses": True}), BASE, {}, 3)
    assert recorded["total_payroll"] == 0


def test_a_hire_uses_the_country_rules_when_no_on_cost_is_entered():
    """UK hire at £3,000: on-costs 461.90 / 3,000 = 15.397%; an entered 20% still wins."""
    st = _plain(tax_country="GB")
    rows, _s = P.project(st, "hire_staff", {"employee_count": 1, "employee_monthly_cost": 3000}, 3)
    assert rows[1]["expenses"] == pytest.approx(3000 + 3461.90)
    rows2, _ = P.project(st, "hire_staff", {"employee_count": 1, "employee_monthly_cost": 3000, "employer_oncost_pct": 20}, 3)
    assert rows2[1]["expenses"] == pytest.approx(3000 + 3600)
    labels = {i["input"]: i for i in U.inputs(st, "hire_staff", {"employee_count": 1, "employee_monthly_cost": 3000},
                                              P.build_baseline(st, None))}
    assert labels["Employer on-costs (%)"]["label"] == "country rules" and labels["Employer on-costs (%)"]["value"] == 15.4


# ── Corporation tax ───────────────────────────────────────────────────────────────────────────────────────────────

def test_uk_corporation_tax_bands_by_hand():
    """40,000 x 19% = 7,600. 100,000: 25,000 - 3/200 x 150,000 = 22,750. 300,000 x 25% = 75,000."""
    assert F.uk_corporation_tax(40000) == pytest.approx(7600)
    assert F.uk_corporation_tax(100000) == pytest.approx(22750)
    assert F.uk_corporation_tax(300000) == pytest.approx(75000)


def test_uk_tax_on_a_year_with_losses_brought_forward():
    """Profit 10,000 a month for 12 months (120,000). Losses brought forward 20,000 -> taxable 100,000 -> 22,750.
    Without the losses: 120,000 -> 30,000 - 3/200 x 130,000 = 28,050."""
    st = S(revenue_monthly=20000, expenses_monthly=10000, starting_cash=0, payment_terms_days=0, profit_tax_regime="uk_corporation_tax")
    _r, s = P.project(st, BASE, {}, 12)
    assert s["closing_tax_owed"] == pytest.approx(28050, abs=0.01)
    _r, s2 = P.project(st.model_copy(update={"tax_losses_brought_forward": 20000}), BASE, {}, 12)
    assert s2["closing_tax_owed"] == pytest.approx(22750, abs=0.01) and all(s2["checks"].values())


def test_a_flat_rate_also_uses_losses_brought_forward():
    """20% on (120,000 - 20,000) = 20,000."""
    st = S(revenue_monthly=20000, expenses_monthly=10000, payment_terms_days=0, profit_tax_rate_pct=20, tax_losses_brought_forward=20000)
    assert P.project(st, BASE, {}, 12)[1]["closing_tax_owed"] == pytest.approx(20000)


# ── The two new scenarios ─────────────────────────────────────────────────────────────────────────────────────────

def test_raising_investment_is_better_but_says_why():
    _r, b = P.project(_plain(), BASE, {}, 12)
    _r, s = P.project(_plain(), "raise_investment", {"funding_amount": 50000, "funding_month": 2, "funding_type": "equity"}, 12)
    v = P.compare_projections(b, s)
    assert v["outcome"] == "improved" and v["funding_effect"] == 50000 and "not because the business earns more" in v["reason"]


def test_buying_equipment_that_saves_costs_by_hand():
    """Revenue 20,000, cost of sales 5,000, expenses 6,000, cash 30,000, 12 months. Equipment 24,000 in month 1 over 48 months
    (500 a month), saving 1,500 a month. Profit a month 9,000 -> 10,000 (+12,000 over the year). Cash: 30,000 + 12 x 9,000
    = 138,000 without; 30,000 + 12 x 10,500 - 24,000 = 132,000 with (-6,000). Cash never below zero (month 1: 16,500).
    Profit up, cash down: a trade-off -> mixed."""
    st = S(revenue_monthly=20000, cost_of_sales_monthly=5000, expenses_monthly=6000, starting_cash=30000, payment_terms_days=0)
    _r, b = P.project(st, BASE, {}, 12)
    _r, s = P.project(st, "buy_equipment", {"equipment_cost": 24000, "purchase_month": 1, "useful_life_months": 48,
                                            "cost_saving_monthly": 1500}, 12)
    v = P.compare_projections(b, s)
    assert (b["closing_cash"], s["closing_cash"]) == (138000, 132000) and v["cumulative_profit_change"] == 12000
    assert v["outcome"] == "mixed" and s["closing_fixed_assets"] == 18000 and all(s["checks"].values())


def test_new_templates_are_listed():
    from app.modules.scenario_intelligence.service import template_list
    ids = {t.scenario_template_id for t in template_list()}
    assert {"tmpl_raise_investment", "tmpl_buy_equipment"} <= ids


# ── The business's own records ────────────────────────────────────────────────────────────────────────────────────

def _records(country="Nigeria"):
    today = date(2026, 11, 24).isoformat()
    exp = [{"category": "Subcontractor", "price": 3000, "status": "paid", "date": today},
           {"category": "Rent", "price": 1000, "status": "paid", "date": today},
           {"category": "Salaries", "price": 2000, "status": "paid", "date": today},
           {"category": "Subcontractor", "price": 9999, "status": "paid", "date": (date(2026, 11, 24) - timedelta(days=200)).isoformat()}]
    return {"workspace_profile": {"country": country}, "financials": {"expenses": exp}}


def test_direct_costs_payroll_and_country_from_the_records():
    """Current-month costs remain actuals and are one input to the next rolling three-month mean."""
    st = S(revenue_monthly=10000, expenses_monthly=6000)
    out = si._phase5_from_records(st, _records(), {"expenses_monthly": 6000.0}, date(2026, 11, 24))
    assert out["tax_country"] == "NG" and out["payroll_in_recorded_expenses"] is True
    assert (out["cost_of_sales_monthly"], out["expenses_monthly"], out["costs_monthly"]) == (1000, 1000, 2000)
    assert out["current_month_recorded"]["cost_of_sales"] == 3000
    assert out["current_month_recorded"]["expenses"] == 3000
    assert "2026-09 to 2026-11" in out["figure_sources"]["cost_of_sales_monthly"]


def test_the_larger_of_product_costs_and_direct_costs_is_cost_of_sales():
    """Recognise the larger cost once, then divide the closed-calendar window by three."""
    data = _records()
    for expense in data["financials"]["expenses"][:3]:
        expense["date"] = "2026-10-24"
    data["financials"]["invoices"] = [{"issued_at":"2026-10-24", "total_amount":9000, "cost_of_sales":1500}]
    out = si._phase5_from_records(S(revenue_monthly=10000, expenses_monthly=6000, cost_of_sales_monthly=500), data,
                                 {"expenses_monthly":6000.0}, date(2026,11,24))
    assert (out["cost_of_sales_monthly"], out["expenses_monthly"]) == (1000, 1000)
    high = si._phase5_from_records(S(revenue_monthly=10000, expenses_monthly=6000, cost_of_sales_monthly=4200), data,
                                   {"expenses_monthly":6000.0}, date(2026,11,24))
    assert (high["cost_of_sales_monthly"], high["expenses_monthly"]) == (1000, 1000)



def test_the_owner_s_own_country_is_kept():
    out = si._phase5_from_records(S(tax_country="GB"), _records("Nigeria"), {})
    assert "tax_country" not in out


# ── Nothing changes for a business that sets none of this ─────────────────────────────────────────────────────────

def test_without_the_new_settings_results_are_unchanged():
    rows, s = P.project(_plain(), BASE, {}, 3)
    assert [r["cash_balance"] for r in rows] == [10000, 15000, 20000] and s["cumulative_profit"] == 15000
    assert s["total_payroll"] == s["total_depreciation"] == s["total_bad_debts"] == s["total_funding_in"] == 0
    major, minor = (int(x) for x in P.MODEL_VERSION.removeprefix("projection-").split("."))
    assert (major, minor) >= (1, 4)


# ── Invariants with every new factor switched on (fixed seed) ─────────────────────────────────────────────────────

import random as _random

_rng = _random.Random(20261121)


def _random_case(i):
    r = _rng
    R = r.uniform(1000, 80000)
    st = dict(revenue_monthly=round(R, 2), cost_of_sales_monthly=round(R * r.uniform(0, .6), 2), expenses_monthly=round(r.uniform(0, 50000), 2),
              starting_cash=round(r.uniform(-20000, 100000), 2), payment_terms_days=r.choice([None, 0, 14, 30, 45, 60, 90]),
              pending_receivables_schedule=[round(r.uniform(0, 10000), 2) for _ in range(r.randint(0, 3))],
              pending_payables_schedule=[round(r.uniform(0, 8000), 2) for _ in range(r.randint(0, 2))],
              tax_country=r.choice([None, "GB", "NG", "US", "France"]),
              profit_tax_regime=r.choice([None, "flat", "uk_corporation_tax"]), profit_tax_rate_pct=r.choice([None, 20, 30]),
              tax_payment_month=r.choice([None, 4, 9]), tax_losses_brought_forward=r.choice([None, 0, 15000]),
              sales_tax_rate_pct=r.choice([None, 0, 20]), sales_tax_on_costs_pct=r.choice([None, 50]),
              existing_loan_balance=r.choice([None, 30000]), existing_loan_annual_rate_pct=8, existing_loan_monthly_repayment=r.choice([None, 900]),
              funding_events=[{"type": r.choice(["equity", "owner_capital", "grant"]), "amount": r.choice([5000, 40000]), "month": r.randint(1, 12)}
                              for _ in range(r.randint(0, 2))],
              owner_drawings_monthly=r.choice([None, 0, 1500]), dividends=[{"amount": 3000, "month": r.randint(1, 12)}] if r.random() < .3 else [],
              capital_purchases=[{"amount": r.choice([2000, 25000]), "month": r.randint(1, 6), "life_months": r.choice([1, 12, 60])}
                                 for _ in range(r.randint(0, 2))],
              bad_debt_pct=r.choice([None, 0, 3, 15]), payroll_staff_count=r.choice([None, 0, 3]),
              payroll_gross_monthly_per_person=r.choice([None, 2500, 7000]), payroll_in_recorded_expenses=r.choice([None, True, False]),
              employer_pension_pct=r.choice([None, 5]))
    kind = r.choice(["do_nothing_projection", "raise_investment", "buy_equipment", "hire_staff", "take_loan", "price_change"])
    params = {"raise_investment": {"funding_amount": 25000, "funding_month": r.randint(1, 6), "funding_type": r.choice(["equity", "grant"])},
              "buy_equipment": {"equipment_cost": 18000, "purchase_month": r.randint(1, 4), "useful_life_months": 36,
                                "extra_revenue_monthly": r.choice([0, 2000]), "cost_saving_monthly": r.choice([0, 800])},
              "hire_staff": {"employee_count": 2, "employee_monthly_cost": 3200},
              "take_loan": {"loan_amount": 20000, "loan_annual_rate_pct": 9, "loan_term_months": 24},
              "price_change": {"price_change_pct": 10}}.get(kind, {})
    as_of = r.choice([None, date(2026, 11, 20)])
    return S(**st), kind, params, r.choice([3, 6, 12, 24]), as_of


@pytest.mark.parametrize("i", range(200))
def test_every_check_holds_with_all_the_new_factors(i):
    st, kind, params, months, as_of = _random_case(i)
    rows, s = P.project(st, kind, params, months, as_of=as_of)
    assert s["checks"] == {"cash_reconciles": True, "receivables_reconcile": True, "balance_sheet_balances": True}
    assert sum(r["revenue"] for r in rows) == pytest.approx(s["total_revenue"], abs=0.05 * len(rows) + 0.05 + (abs(s["stub"]["revenue"]) if s.get("stub") else 0))
    assert rows[-1]["cash_balance"] == pytest.approx(s["closing_cash"], abs=0.01)
    assert s["closing_receivables"] >= -0.01 and s["closing_fixed_assets"] >= -0.01
    assert P.project(st, kind, params, months, as_of=as_of)[1]["closing_cash"] == s["closing_cash"]      # same inputs, same answer
