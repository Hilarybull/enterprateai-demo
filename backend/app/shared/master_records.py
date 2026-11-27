"""Links between employee master records and recorded expenses."""
from __future__ import annotations


def prepare_employee_expenses(patch: dict, stored: dict) -> None:
    from app.shared.supplier_costs import prepare_supplier_costs
    prepare_supplier_costs(patch, stored)
    import math
    import re
    from app.modules.agent import business as bz
    for section in ("employees", "vendors"):
        prior_records = {str(row.get("id")): row for row in (stored.get("catalogue") or {}).get(section) or [] if isinstance(row, dict)}
        for record in (patch.get("catalogue") or {}).get(section) or []:
            if not isinstance(record, dict):
                continue
            previous = prior_records.get(str(record.get("id")), {})
            raw = str(record.get("currency") or previous.get("currency") or bz.currency_of(stored)).strip().upper()
            match = re.fullmatch(r"([A-Z]{3})", raw) or re.search(r"\(([A-Z]{3})\)$", raw)
            if not match:
                raise ValueError("Choose a valid currency for employee pay and vendor prices.")
            record["currency"] = match.group(1)
    for employee in (patch.get("catalogue") or {}).get("employees") or []:
        if not isinstance(employee, dict):
            continue
        for key in ("salary_amount", "benefits_monthly"):
            value = employee.get(key)
            if value not in (None, ""):
                try:
                    valid = math.isfinite(float(value)) and float(value) >= 0
                except (ValueError, TypeError):
                    valid = False
                if not valid:
                    raise ValueError("Employee salary and benefits must be non-negative amounts.")
        if employee.get("salary_frequency") not in (None, "", "monthly", "weekly", "annual"):
            raise ValueError("Choose monthly, weekly or annual salary.")
    financials = patch.get("financials")
    if not isinstance(financials, dict) or not isinstance(financials.get("expenses"), list):
        return
    catalogue = {**(stored.get("catalogue") or {}), **(patch.get("catalogue") or {})}
    employees = {str(e.get("id")): e for e in catalogue.get("employees") or [] if isinstance(e, dict) and e.get("id")}
    prior = {str(e.get("id")): e for e in (stored.get("financials") or {}).get("expenses") or [] if isinstance(e, dict)}
    for expense in financials["expenses"]:
        if not isinstance(expense, dict):
            continue
        kind = expense.get("expense_type")
        if kind == "staff_payments":
            employee = employees.get(str(expense.get("employee_id") or ""))
            old = prior.get(str(expense.get("id")), {})
            if employee is None:
                raise ValueError("Choose an employee from this business's Master records.")
            if employee.get("archived") and old.get("employee_id") != expense.get("employee_id"):
                raise ValueError("Choose an active employee for a new staff payment.")
            expense.update(category="payroll", employee_name=employee.get("name") or "Employee", party_name=employee.get("name") or "Employee", party_type="employee", vendor_name="")
        elif kind in ("operations", "other"):
            category = str(expense.get("expense_type_other") or "").strip() if kind == "other" else "operations"
            if not category:
                raise ValueError("Enter the type of expense for Other.")
            expense.update(category=category, employee_id="", employee_name="")
