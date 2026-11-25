"""Independent fixed-date acceptance cases for the 24 November accuracy brief."""
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.agent import business, figures
from app.modules.scenario_intelligence import projection as P, records, router, service
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S

TODAY = date(2026, 11, 24)


def invoice(due, **extra):
    return dict(total_amount=100, status="sent", date="2026-11-01", due_date=due, **extra)


def test_six_open_three_overdue_one_approaching():
    data = {"financials": {"invoices": [invoice("2026-11-01"), invoice("2026-11-22"), invoice("2026-11-23"),
                                              invoice("2026-11-28"), invoice("2026-12-15"), invoice(None)]}}
    groups = business.receivable_timing(data, TODAY)
    assert {k: len(v) for k, v in groups.items()} == {"overdue": 3, "approaching": 1, "open_not_due": 2}
    shared = figures.of(data, TODAY)
    assert (shared["overdue"], shared["approaching"]) == (3, 1)
    assert shared["simulation_inputs"]["overdue_receivables_count"] == 3


def test_not_due_and_paid_or_credited_do_not_raise_overdue_signal():
    data = {"financials": {"invoices": [invoice("2026-12-15"), invoice("2026-11-01", payments=[{"amount": 100}]),
                                              invoice("2026-11-01", credit_notes=[{"amount": 100}])]}}
    assert not business.receivable_timing(data, TODAY)["overdue"]
    signals = service.detect_risks(S(revenue_monthly=1000, expenses_monthly=100, overdue_receivables_count=0))
    assert not any(s["reason_code"] == "RECEIVABLES_OVERDUE" for s in signals)


@pytest.mark.parametrize("key,value", [("timeline_months", 2), ("timeline_months", 25), ("timeline_months", ""),
    ("revenue_drop_pct", -1), ("client_loss_pct", 101), ("cost_increase_pct", 101), ("cost_reduction_pct", -1),
    ("price_change_pct", -51), ("price_change_pct", 201), ("effective_month", 7), ("start_month", 0),
    ("employee_count", 101), ("employee_count", 1.5), ("loan_amount", -1), ("loan_annual_rate_pct", 101),
    ("loan_term_months", 361), ("loan_term_months", 0), ("equipment_cost", -2), ("cost_increase_pct", "NaN")])
def test_api_rejects_invalid_parameters(key, value):
    app = FastAPI()
    app.include_router(router.router)
    from app.shared.auth.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": "qa"}
    payload = dict(tenant_id="qa", business_id="qa", state_version="1", scenario_template_id="tmpl_revenue_drop",
                   scenario_mode="adaptive", scenario_name="QA", parameters={"timeline_months": 6, key: value}, state={})
    result = TestClient(app).post("/v1/scenario-intelligence/scenario-runs", json=payload)
    assert result.status_code == 422
    assert key.replace("_", " ") in result.text.lower()


@pytest.mark.parametrize("key", ["profit_tax_rate_pct", "sales_tax_rate_pct", "sales_tax_on_costs_pct",
    "existing_loan_annual_rate_pct", "cost_inflation_pct", "bad_debt_pct"])
@pytest.mark.parametrize("value", [-1, 101])
def test_settings_percentage_bounds(key, value):
    with pytest.raises(ValueError):
        S(**{key: value})


def test_payment_terms_weighted_window_and_minimum_five_paid():
    inv = [dict(date="2026-10-01", subtotal_amount=100, payment_terms=10, paid_at="2026-10-06", status="paid") for _ in range(4)]
    inv += [dict(date="2026-10-01", subtotal_amount=600, payment_terms=40, status="sent"),
            dict(date="2024-10-01", subtotal_amount=10000, payment_terms=1, status="sent")]
    data = {"financials": {"invoices": inv}}
    assert records.build(data, TODAY)["fills"]["payment_terms_days"] == 28
    inv.append(dict(date="2026-10-01", subtotal_amount=100, payment_terms=10, paid_at="2026-10-06", status="paid"))
    assert records.build(data, TODAY)["fills"]["payment_terms_days"] == 5


def test_same_invoice_basis_for_revenue_and_cost_of_sales():
    inv = [dict(date=f"2026-{m:02d}-01", subtotal_amount=10000, cost_of_sales=1200, status="sent") for m in (8, 9, 10)]
    data = {"financials": {"invoices": inv}}
    level = records.build(data, TODAY)["levels"]
    assert level["revenue_monthly"] == 10000 and level["cost_of_sales_monthly"] == 1200
    assert figures.of(data, TODAY)["simulation_inputs"]["cost_of_sales_monthly"] == 1200
    assert router._phase5_from_records(S(), data, {}, TODAY)["cost_of_sales_monthly"] == 1200


@pytest.mark.parametrize("kind,key,expected", [("client_loss", "client_loss_pct", (900, 200, 90)),
    ("revenue_drop", "revenue_drop_pct", (900, 200, 90)), ("cost_increase", "cost_increase_pct", (1000, 220, 110)),
    ("reduce_fixed_cost", "cost_reduction_pct", (1000, 180, 100))])
def test_percent_changes_apply_in_full_in_first_month(kind, key, expected):
    st = S(revenue_monthly=1000, expenses_monthly=200, cost_of_sales_monthly=100, sales_cycle_days=90)
    assert P._monthly_projection_values(st, kind, {key: 10}, 1) == pytest.approx(expected)


def test_contractor_classification_and_stub_interest():
    st = S(revenue_monthly=1000, expenses_monthly=200, cost_of_sales_monthly=100)
    assert P._monthly_projection_values(st, "contractor_addition", {"contractor_monthly_cost": 50}, 1) == (1000, 250, 100)
    assert P._monthly_projection_values(st, "contractor_addition", {"contractor_monthly_cost": 50, "cost_classification": "direct"}, 1) == (1000, 200, 150)
    st = S(existing_loan_balance=20000, existing_loan_annual_rate_pct=6)
    _, summary = P.project(st, "do_nothing_projection", {}, 6, as_of=TODAY)
    assert summary["stub"]["costs"] == 20


@pytest.mark.parametrize("kind", P.COMBINABLE)
def test_golden_dataset_accounting_and_determinism(kind):
    # Fixed, synthetic acceptance fixture; it does not claim to reproduce the private QA2 account.
    st = S(revenue_monthly=10000, expenses_monthly=3000, cost_of_sales_monthly=1200, starting_cash=30000,
           payment_terms_days=28, profit_tax_rate_pct=19, sales_tax_rate_pct=20, sales_tax_on_costs_pct=80,
           existing_loan_balance=20000, existing_loan_annual_rate_pct=6, existing_loan_monthly_repayment=500)
    params = dict(revenue_drop_pct=10, client_loss_pct=10, cost_increase_pct=10, cost_reduction_pct=10,
                  price_change_pct=10, employee_count=1, employee_monthly_cost=1000, contractor_monthly_cost=500,
                  loan_amount=1000, loan_term_months=12, loan_annual_rate_pct=6, revenue_uplift_pct=10,
                  cost_uplift_pct=5, equipment_cost=1000, funding_amount=2000)
    rows, summary = P.project(st, kind, params, 6, as_of=TODAY)
    assert (rows, summary) == P.project(st, kind, params, 6, as_of=TODAY)
    assert all(summary["checks"].values())
    assert summary["cash_after_vat_owed"] == round(summary["closing_cash"] - summary["closing_sales_tax_owed"], 2)
    assert summary["cumulative_profit"] == pytest.approx(summary["stub"]["profit"] + sum(r["profit"] for r in rows), abs=.05)
    for row in rows:
        assert abs(row["revenue"] - row["costs"] - row["profit"]) <= .02


@pytest.mark.parametrize("kind", P.COMBINABLE)
def test_zero_change_matches_baseline_for_all_templates(kind):
    st = S(revenue_monthly=10000, expenses_monthly=3000, cost_of_sales_monthly=1200,
           starting_cash=30000, payment_terms_days=28, top_client_share_pct=40)
    baseline, _ = P.project(st, "do_nothing_projection", {}, 6, as_of=TODAY)
    zero = dict(client_loss_pct=0, revenue_drop_pct=0, cost_increase_pct=0, cost_reduction_pct=0, price_change_pct=0,
                employee_count=1, employee_monthly_cost=0, contractor_monthly_cost=0, employer_oncost_pct=0,
                recruitment_cost_per_hire=0, revenue_per_hire_monthly=0, delay_months=0,
                revenue_uplift_pct=0, cost_uplift_pct=0, launch_cost=0, loan_amount=0, funding_amount=0, equipment_cost=0)
    actual, _ = P.project(st, kind, zero, 6, as_of=TODAY)
    assert actual == baseline


def test_high_bad_debt_percentage_is_used_without_a_hidden_fifty_percent_cap():
    st = S(revenue_monthly=1000, starting_cash=0, payment_terms_days=0, bad_debt_pct=70)
    rows, _ = P.project(st, "do_nothing_projection", {}, 3)
    assert rows[0]["cash_balance"] == 300 and rows[0]["profit"] == 300


def test_combined_changes_cannot_override_the_parent_horizon():
    from app.modules.scenario_intelligence.validation import validate_parameters
    with pytest.raises(ValueError, match="overall timeline"):
        validate_parameters({"timeline_months": 6, "steps": [{"scenario_type": "hire_staff",
            "params": {"timeline_months": 24, "start_month": 12}}]})
