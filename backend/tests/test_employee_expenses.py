import pytest
from datetime import date
from app.shared.master_records import prepare_employee_expenses
from app.modules.scenario_intelligence.records import build


def test_staff_payment_uses_the_business_employee_and_is_counted_once_as_payroll():
    stored = {"catalogue": {"employees": [{"id": "e1", "name": "Ada"}]}}
    patch = {"financials": {"expenses": [{"id": "x", "expense_type": "staff_payments", "employee_id": "e1", "employee_name": "Wrong name", "amount": 2000, "date": "2026-11-20", "status": "paid"}]}}
    prepare_employee_expenses(patch, stored)
    expense = patch["financials"]["expenses"][0]
    assert expense["employee_name"] == "Ada" and expense["category"] == "payroll"
    records = build({**stored, **patch}, date(2026, 11, 24))
    assert records["histories"]["expenses_by_month"]["2026-11"] == 2000
    assert records["fills"]["payroll_in_recorded_expenses"] is True
    assert records["counts"]["employees"] == 1


def test_an_employee_from_another_business_cannot_be_linked():
    with pytest.raises(ValueError, match="this business"):
        prepare_employee_expenses({"financials": {"expenses": [{"expense_type": "staff_payments", "employee_id": "foreign"}]}}, {"catalogue": {"employees": []}})


def test_other_requires_a_description_and_operations_removes_staff_link():
    with pytest.raises(ValueError, match="type of expense"):
        prepare_employee_expenses({"financials": {"expenses": [{"expense_type": "other"}]}}, {})
    patch = {"financials": {"expenses": [{"expense_type": "operations", "employee_id": "e1"}]}}
    prepare_employee_expenses(patch, {})
    assert patch["financials"]["expenses"][0]["employee_id"] == ""
