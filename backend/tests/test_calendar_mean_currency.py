from datetime import date
from app.modules.scenario_intelligence.records import build
from app.modules.agent.fx import currencies_used
from app.shared.master_records import prepare_employee_expenses

TODAY = date(2026, 11, 27)

def test_mean_includes_all_three_closed_calendar_months_and_excludes_today():
    data = {"financials": {"invoices": [
        {"issued_at": "2026-07-01", "total_amount": 9999},
        {"issued_at": "2026-09-01", "total_amount": 300},
        {"issued_at": "2026-10-01", "total_amount": 600},
        {"issued_at": "2026-11-01", "total_amount": 9000},
    ]}}
    result = build(data, TODAY)
    assert result["levels"]["revenue_monthly"] == 300
    assert "2026-08 to 2026-10" in result["sources"]["revenue_monthly"]
    assert any("No records in 2026-08" in note for note in result["figure_notes"])
    assert result["current_month"]["revenue"] == 9000

def test_current_month_only_does_not_become_the_forecast_mean():
    result = build({"financials": {"invoices": [{"issued_at": "2026-11-01", "total_amount": 9000}]}}, TODAY)
    assert result["levels"]["revenue_monthly"] == 0
    assert any("2026-08, 2026-09, 2026-10" in note for note in result["figure_notes"])

def test_foreign_salary_and_benefits_are_converted_before_payroll_aggregation():
    data = {"settings": {"currency": "GBP"}, "fx_rates": {"base": "GBP", "rates": {"NGN": .001}},
        "catalogue": {"employees": [{"salary_amount": 200000, "salary_frequency": "monthly", "benefits_monthly": 10000, "currency": "NGN"}],
                      "vendors": [{"currency": "USD"}]}}
    result = build(data, TODAY)
    assert result["fills"]["payroll_gross_monthly_per_person"] == 200
    assert result["fills"]["employee_benefits_monthly"] == 10
    assert currencies_used(data) == {"NGN", "USD"}
    data.pop("fx_rates")
    result = build(data, TODAY)
    assert "payroll_gross_monthly_per_person" not in result["fills"]
    assert any("NGN" in note and "excluded" in note for note in result["figure_notes"])

def test_employee_and_vendor_currency_default_to_workspace_and_keep_explicit_choice():
    patch={"catalogue":{"employees":[{"id":"e","salary_amount":200000}],"vendors":[{"id":"v","price":30,"currency":"USD"}]}}
    prepare_employee_expenses(patch,{"settings":{"currency":"Nigerian Naira (NGN)"}})
    assert patch["catalogue"]["employees"][0]["currency"] == "NGN"
    assert patch["catalogue"]["vendors"][0]["currency"] == "USD"
