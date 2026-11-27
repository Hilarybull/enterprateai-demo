"""Simulation audit, Phase 6 (model projection-1.5): inputs from the business's own records, the current month, and
how every figure was calculated. docs/simulation-audit/09-phase6-changes.md."""
import random
import re
from datetime import date

import pytest

from app.modules.scenario_intelligence import projection as P
from app.modules.scenario_intelligence import records as R
from app.modules.scenario_intelligence import router as si
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

TODAY = date(2026, 11, 21)


def _data():
    """Three customers' invoices (net of VAT in subtotal_amount), expenses dated with `date` (the field the page missed)."""
    inv = [
        dict(date="2026-08-05", subtotal_amount=1000, vat_rate=20, vat_amount=200, total_amount=1200, status="paid", paid_at="2026-08-25"),
        dict(date="2026-09-10", subtotal_amount=2000, vat_rate=20, vat_amount=400, total_amount=2400, status="paid", paid_at="2026-10-10"),
        dict(date="2026-10-02", subtotal_amount=3000, vat_rate=0, total_amount=3000, status="paid", paid_at="2026-10-12"),
        dict(date="2026-11-03", subtotal_amount=500, vat_rate=20, vat_amount=100, total_amount=600, status="sent", cost_of_sales=50),
        dict(date="2026-11-04", subtotal_amount=9999, status="draft"),                          # not a sale
    ]
    exp = [
        dict(date="2026-09-01", price=400, category="Materials", status="paid", vat_rate=20),
        dict(date="2026-09-01", price=600, category="Rent", status="paid"),
        dict(date="2026-10-01", price=600, category="Rent", status="paid"),
        dict(date="2026-11-02", price=300, category="Subcontractor", status="paid", vat_rate=20),
        dict(date="2026-11-02", price=1500, category="Salaries", status="paid"),
    ]
    return {"financials": {"invoices": inv, "expenses": exp}, "workspace_profile": {"country": "United Kingdom", "vat_number": "GB123"}}


# ── Records ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_histories_from_the_records_by_hand():
    """Revenue by invoice date, excluding VAT, drafts left out: Aug 1,000; Sep 2,000; Oct 3,000; Nov 500.
    Cost of sales = larger of product costs and direct costs: Sep 400 (materials); Nov max(50, 300) = 300.
    Running costs: Sep 600, Oct 600, Nov 1,500 (salaries)."""
    r = R.build(_data(), TODAY)["histories"]
    assert r["revenue_by_month"] == {"2026-08": 1000, "2026-09": 2000, "2026-10": 3000, "2026-11": 500}
    assert r["cost_of_sales_by_month"] == {"2026-08": 0, "2026-09": 400, "2026-10": 0, "2026-11": 300}
    assert r["expenses_by_month"] == {"2026-08": 0, "2026-09": 600, "2026-10": 600, "2026-11": 1500}


def test_days_sales_outstanding_by_hand():
    """Paid invoices: 20 days on 1,000; 30 days on 2,000; 10 days on 3,000. Weighted: (20,000 + 60,000 + 30,000) / 6,000
    = 18.3 -> 18 days."""
    data = _data()
    # Five observations: split two invoices without changing total weights or payment lags.
    for idx in (1, 0):
        half = {**data["financials"]["invoices"][idx]}
        for key in ("subtotal_amount", "total_amount", "vat_amount"):
            half[key] = half.get(key, 0) / 2
            data["financials"]["invoices"][idx][key] = half[key]
        data["financials"]["invoices"].append(half)
    b = R.build(data, TODAY)
    assert b["fills"]["payment_terms_days"] == 18 and "days sales outstanding" in b["sources"]["payment_terms_days"]


def test_dso_needs_five_paid_invoices_else_invoice_terms():
    data = {"financials": {"invoices": [dict(date="2026-10-01", subtotal_amount=1000, status="paid", paid_at="2026-10-05"),
                                        dict(date="2026-10-01", subtotal_amount=3000, status="sent", payment_terms="45"),
                                        dict(date="2026-10-01", subtotal_amount=1000, status="sent", payment_terms="15")]}}
    b = R.build(data, TODAY)
    assert b["fills"]["payment_terms_days"] == 38      # (45 x 3,000 + 15 x 1,000) / 4,000 = 37.5 -> 38
    assert "terms on your invoices" in b["sources"]["payment_terms_days"]


def test_vat_found_in_the_records_by_hand():
    """Invoices with VAT: 20% on 1,000, 2,000 and 500 -> 20%. Expenses in the last 12 months 3,400; with VAT 700 -> 20.6%."""
    f = R.build(_data(), TODAY)["fills"]
    assert f["sales_tax_rate_pct"] == 20 and f["sales_tax_on_costs_pct"] == 20.6
    assert f["tax_country"] == "GB" and f["payroll_in_recorded_expenses"] is True


def test_this_month_so_far():
    cm = R.build(_data(), TODAY)["current_month"]
    expected = dict(month="2026-11", revenue=500, cost_of_sales=300, expenses=1500, invoices=1, expense_records=2)
    assert {key: cm[key] for key in expected} == expected


def test_owner_settings_win_but_payment_terms_come_from_the_records():
    """The owner set VAT at 5%: kept. The page sent 50-day terms (an average of typed customer terms): replaced by DSO 18."""
    st = S(revenue_monthly=2000, expenses_monthly=600, sales_tax_rate_pct=5, payment_terms_days=50)
    out = si._phase5_from_records(st, _data(), {}, TODAY)
    assert "sales_tax_rate_pct" not in out and out["payment_terms_days"] == 30
    assert out["revenue_by_month"]["2026-10"] == 3000 and out["current_month_recorded"]["revenue"] == 500


def test_a_dashboard_revenue_figure_outside_the_usual_variation_is_not_used():
    """The first forecast uses September-November recorded activity, including November actual-to-date,
    regardless of a stale dashboard figure. Revenue 5,500 / 3; cost of sales 700 / 3."""
    st = S(revenue_monthly=3800, expenses_monthly=600)
    out = si._phase5_from_records(st, _data(), {"revenue_monthly": 3800.0, "figure_sources": {"revenue_monthly": "shared"}}, TODAY)
    assert out["revenue_monthly"] == pytest.approx(5500 / 3, abs=.01) and "2026-09 to 2026-11" in out["figure_sources"]["revenue_monthly"]
    assert out["cost_of_sales_monthly"] == pytest.approx(700 / 3, abs=.01)
    kept = si._phase5_from_records(S(revenue_monthly=2100), _data(), {"revenue_monthly": 2100.0, "figure_sources": {"revenue_monthly": "shared"}}, TODAY)
    assert kept["revenue_monthly"] == pytest.approx(5500 / 3, abs=.01) and "invoice-date" in kept["figure_sources"]["revenue_monthly"]


# ── The current month and how it was calculated ──────────────────────────────────────────────────────────────────────

def test_the_current_month_view_by_hand():
    """21 Nov: recorded so far 500 revenue, 300 + 1,500 costs. Rest of the month: 9 of 30 days at 3,000 revenue and 1,000
    costs a month (flat, customers pay at once) = 900 and 300. Total 1,400 revenue, 2,100 costs, -700 profit.
    Cash 5,000 today + 900 - 300 = 5,600 at the month end."""
    st = S(revenue_monthly=3000, expenses_monthly=1000, starting_cash=5000, payment_terms_days=0,
           current_month_recorded=dict(month="2026-11", revenue=500, cost_of_sales=300, expenses=1500, invoices=1, expense_records=2))
    _rows, s = P.project(st, "do_nothing_projection", {}, 3, as_of=TODAY)
    cm = s["current_month"]
    assert cm["recorded_so_far"]["costs"] == 1800 and cm["rest_of_month"] == dict(days=0, revenue=0, costs=0, profit=0)
    assert cm["month_total"]["revenue"] == 500 and cm["month_total"]["profit"] == -1300
    assert (cm["cash_today"], cm["cash_at_month_end"]) == (5000, None) and cm["label"] == "Nov 2026"


def _amounts(text):
    return [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*\.\d\d", text)]


@pytest.mark.parametrize("seed", range(60))
def test_every_cash_explanation_adds_up_exactly(seed):
    """For random businesses with every factor, each month's cash line reads 'opening + ins - outs = cash', and it adds up."""
    rng = random.Random(seed)
    st = S(revenue_monthly=rng.uniform(2000, 60000), cost_of_sales_monthly=rng.uniform(0, 8000), expenses_monthly=rng.uniform(0, 20000),
           starting_cash=rng.uniform(-5000, 60000), payment_terms_days=rng.choice([0, 21, 45]),
           revenue_by_month={f"2025-{m:02d}": rng.uniform(5000, 9000) for m in range(1, 13)} | {f"2026-{m:02d}": rng.uniform(5000, 9000) for m in range(1, 11)},
           pending_receivables_schedule=[rng.uniform(0, 4000) for _ in range(2)], sales_tax_rate_pct=rng.choice([None, 20]),
           existing_loan_balance=rng.choice([None, 20000]), existing_loan_annual_rate_pct=7, existing_loan_monthly_repayment=700,
           owner_drawings_monthly=rng.choice([None, 900]), funding_events=[{"type": "grant", "amount": 4000, "month": 2}],
           capital_purchases=[{"amount": 6000, "month": 1, "life_months": 24}], bad_debt_pct=rng.choice([None, 3]),
           payroll_staff_count=rng.choice([None, 2]), payroll_gross_monthly_per_person=2600, tax_country="GB", profit_tax_rate_pct=19,
           tax_payment_month=rng.choice([None, 2]))
    rows, s = P.project(st, rng.choice(["do_nothing_projection", "price_change"]), {"price_change_pct": 10}, rng.choice([3, 6, 12]), as_of=TODAY)
    months = s["how_calculated"]["months"]
    assert len(months) == len(rows)
    for m in months:
        cash_line = m["cash"]
        opening, rest = cash_line.split(" + ", 1)
        amounts = _amounts(rest)
        ins_part, outs_part = rest.split(" - ", 1)
        ins = _amounts(ins_part)
        outs = _amounts(outs_part)[:-1]
        closing = _amounts(outs_part)[-1]
        assert float(opening.replace(",", "")) + sum(ins) - sum(outs) == pytest.approx(closing, abs=0.02), cash_line
        cost = _amounts(m["costs"])
        assert cost[-1] == pytest.approx(rows[m["month_index"] - 1]["profit"], abs=0.01)
    assert len(s["how_calculated"]["methods"]) >= 8 and all(x["standard"] for x in s["how_calculated"]["methods"])


def test_the_starting_point_says_why_each_level_trend_and_season_was_chosen():
    """34 complete months (Jan 2024 - Oct 2026), 30% higher every June-August: the seasonal test passes and is reported."""
    hist = {f"{y}-{m:02d}": 1000 * (1 + 0.3 * (m in (6, 7, 8))) for y in (2024, 2025, 2026) for m in range(1, 13) if (y, m) <= (2026, 10)}
    st = S(revenue_monthly=0, revenue_by_month=hist, expenses_monthly=400, payment_terms_days=30)
    _r, s = P.project(st, "do_nothing_projection", {}, 3, as_of=TODAY)
    text = " ".join(s["how_calculated"]["starting_point"])
    assert "Revenue:" in text and "Seasonal pattern applied (F =" in text and "Payment time: 30 days" in text


def test_runs_are_stamped_with_model_1_5_or_later():
    major, minor = (int(x) for x in P.MODEL_VERSION.removeprefix("projection-").split("."))
    assert (major, minor) >= (1, 5)
