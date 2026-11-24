"""The simulation's inputs, built from the business's own records. Simulation audit, Phase 6 (model projection-1.5).

The owner enters invoices, expenses, customers and settings elsewhere in EnterprateAI; the simulation reads them here so
nothing has to be entered twice, and every part of the product sees the same figures. Before this, the Simulation page
built its own partial copy (expense history missed every expense dated with `date`; payment terms were a plain average of
the terms typed on customer records; the history of sales was by payment date).

Standards applied (each explained in MODEL.md, section 2a):
* **Revenue is recognised when earned** (accrual basis, IFRS 15 in principle): by invoice date, excluding VAT
  (`subtotal_amount`). Drafts, cancelled and void invoices are not sales.
* **Cost of sales** = the product costs carried on invoices, or the expenses in direct-cost categories, whichever is
  larger in each month (the two describe the same purchases; taking both would double-count, taking the smaller would
  under-count). Running costs = the other expenses.
* **Days sales outstanding (DSO)**, the standard measure of how fast customers pay: the amount-weighted average of
  (payment date - invoice date) over paid invoices in the last 12 months, with at least 3 of them. Otherwise the
  amount-weighted terms on the invoices; otherwise none (the model then assumes 30 days and says so).
* **VAT**: the amount-weighted rate on invoices in the last 12 months; the share of costs carrying VAT from the
  expenses. Used only when the owner has not set VAT.
Pure calculation on the workspace data; no database or network calls.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from app.modules.scenario_intelligence import factors

NOT_SALES = {"draft", "cancelled", "canceled", "void", "voided", "rejected", "deleted"}
MIN_PAID_FOR_DSO = 3


def _day(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def invoice_date(inv: Dict[str, Any]) -> Optional[date]:
    return _day(inv.get("issued_at") or inv.get("date") or inv.get("issue_date") or inv.get("created_at"))


def expense_date(exp: Dict[str, Any]) -> Optional[date]:
    return _day(exp.get("date") or exp.get("expense_date") or exp.get("issued_at") or exp.get("paid_at") or exp.get("created_at"))


def invoice_net(inv: Dict[str, Any]) -> float:
    """The invoice's value excluding VAT."""
    if inv.get("subtotal_amount") not in (None, ""):
        return _num(inv.get("subtotal_amount"))
    total = _num(inv.get("total_amount") or inv.get("amount"))
    return max(0.0, total - _num(inv.get("vat_amount")))


def invoice_product_cost(inv: Dict[str, Any]) -> float:
    if inv.get("cost_of_sales") not in (None, ""):
        return _num(inv.get("cost_of_sales"))
    return sum((_num(li.get("qty")) or 1.0) * _num(li.get("cost_of_sales")) for li in inv.get("line_items") or [] if isinstance(li, dict))


def expense_net(exp: Dict[str, Any]) -> float:
    """The expense excluding VAT: the recorded amount, less its VAT amount when one is recorded (amounts are taken as
    excluding VAT otherwise, the same convention the projection uses)."""
    gross = _num(exp.get("price") or exp.get("amount") or exp.get("total_amount"))
    return max(0.0, gross - _num(exp.get("vat_amount")))


def _status(rec: Dict[str, Any]) -> str:
    return str(rec.get("status") or "").strip().lower()


def build(data: Dict[str, Any] | None, today: date) -> Dict[str, Any]:
    """Everything the records say, with where each figure came from."""
    data = data or {}
    fin = data.get("financials") or {}
    invoices = [i for i in fin.get("invoices") or [] if isinstance(i, dict) and not i.get("archived") and _status(i) not in NOT_SALES]
    expenses = [e for e in fin.get("expenses") or [] if isinstance(e, dict) and not e.get("archived") and _status(e) not in NOT_SALES]
    out: Dict[str, Any] = {"histories": {}, "fills": {}, "sources": {}, "counts": {}}

    revenue: Dict[str, float] = {}
    product_cost: Dict[str, float] = {}
    for inv in invoices:
        d = invoice_date(inv)
        if not d or d > today:
            continue
        k = _key(d)
        revenue[k] = revenue.get(k, 0.0) + invoice_net(inv)
        product_cost[k] = product_cost.get(k, 0.0) + invoice_product_cost(inv)

    direct: Dict[str, float] = {}
    running: Dict[str, float] = {}
    payroll_seen = False
    for exp in expenses:
        d = expense_date(exp)
        if not d or d > today:
            continue
        k, kind, amt = _key(d), factors.expense_kind(exp), expense_net(exp)
        if kind == "direct":
            direct[k] = direct.get(k, 0.0) + amt
        else:
            running[k] = running.get(k, 0.0) + amt
            payroll_seen = payroll_seen or (kind == "payroll" and d >= today - timedelta(days=92))

    months = sorted(set(revenue) | set(product_cost) | set(direct) | set(running))
    if months:
        r2 = lambda v: round(v, 2)      # noqa: E731
        out["histories"] = {
            "revenue_by_month": {m: r2(revenue.get(m, 0.0)) for m in months},
            "cost_of_sales_by_month": {m: r2(max(product_cost.get(m, 0.0), direct.get(m, 0.0))) for m in months},
            "expenses_by_month": {m: r2(running.get(m, 0.0)) for m in months},
        }
        out["direct_costs_by_month"] = {m: r2(direct.get(m, 0.0)) for m in months if direct.get(m)}
        out["product_costs_by_month"] = {m: r2(product_cost.get(m, 0.0)) for m in months if product_cost.get(m)}
        out["sources"]["histories"] = (f"{len(invoices)} invoices (by invoice date, excluding VAT) and {len(expenses)} expenses "
                                       "from your records")
    out["counts"] = {"invoices": len(invoices), "expenses": len(expenses)}

    # Days sales outstanding: how fast customers actually pay
    year_ago = today - timedelta(days=365)
    paid = []
    for inv in invoices:
        d0, d1 = invoice_date(inv), _day(inv.get("paid_at"))
        if d0 and d1 and d1 >= d0 and d1 >= year_ago:
            paid.append(((d1 - d0).days, invoice_net(inv) or _num(inv.get("total_amount"))))
    weight = sum(w for _d, w in paid)
    if len(paid) >= MIN_PAID_FOR_DSO and weight > 0:
        dso = sum(days * w for days, w in paid) / weight
        out["fills"]["payment_terms_days"] = int(round(dso))
        out["sources"]["payment_terms_days"] = (f"days sales outstanding: your customers paid {len(paid)} invoices in the last "
                                                f"12 months after {dso:.0f} days on average (weighted by amount)")
    else:
        terms = [(_num(i.get("payment_terms")), invoice_net(i)) for i in invoices
                 if str(i.get("payment_terms") or "").strip() not in ("", "0") and _num(i.get("payment_terms")) > 0]
        tw = sum(w for _t, w in terms)
        if terms and tw > 0:
            t = sum(a * w for a, w in terms) / tw
            out["fills"]["payment_terms_days"] = int(round(t))
            out["sources"]["payment_terms_days"] = f"the terms on your invoices: {t:.0f} days on average (weighted by amount)"

    # VAT from the invoices and expenses of the last 12 months
    vat_inv = [(_num(i.get("vat_rate")), invoice_net(i)) for i in invoices if (invoice_date(i) or date.min) >= year_ago]
    charged = [(r, w) for r, w in vat_inv if r > 0]
    if charged and sum(w for _r, w in charged) > 0:
        rate = sum(r * w for r, w in charged) / sum(w for _r, w in charged)
        out["fills"]["sales_tax_rate_pct"] = round(rate, 2)
        out["sources"]["sales_tax_rate_pct"] = f"VAT charged on {len(charged)} of your invoices in the last 12 months"
        exp_year = [e for e in expenses if (expense_date(e) or date.min) >= year_ago]
        total_cost = sum(expense_net(e) for e in exp_year)
        if total_cost > 0:
            with_vat = sum(expense_net(e) for e in exp_year if _num(e.get("vat_rate")) > 0)
            out["fills"]["sales_tax_on_costs_pct"] = round(with_vat / total_cost * 100, 1)
            out["sources"]["sales_tax_on_costs_pct"] = "the share of your expenses in the last 12 months recorded with VAT"
    profile = data.get("workspace_profile") or {}
    if profile.get("vat_number"):
        out["vat_registered"] = True
    if payroll_seen:
        out["fills"]["payroll_in_recorded_expenses"] = True
        out["sources"]["payroll_in_recorded_expenses"] = "salaries found in your recorded expenses (last 92 days)"
    country = factors.country_code(profile.get("country"))
    if country:
        out["fills"]["tax_country"] = country
        out["sources"]["tax_country"] = f"your business profile ({profile.get('country')})"

    # Phase 6: what the data quality check needs from the raw records
    seen_inv, dup_inv = {}, 0
    for inv in invoices:
        k = (str(inv.get("customer_id") or inv.get("customer_name") or "").lower(), round(invoice_net(inv), 2), str(invoice_date(inv)))
        if k[1] > 0:
            dup_inv += 1 if k in seen_inv else 0
            seen_inv[k] = True
    seen_exp, dup_exp = {}, 0
    for exp in expenses:
        k = (str(exp.get("employee_id") or ""), str(exp.get("category") or "").lower(), str(exp.get("description") or "").lower(), round(expense_net(exp), 2), str(expense_date(exp)))
        if k[3] > 0:
            dup_exp += 1 if k in seen_exp else 0
            seen_exp[k] = True
    out["checks"] = dict(
        possible_duplicate_invoices=dup_inv, possible_duplicate_expenses=dup_exp,
        uncategorised_expenses=sum(1 for e in expenses if not str(e.get("category") or "").strip()),
        future_dated=sum(1 for i in invoices if (invoice_date(i) or date.min) > today) + sum(1 for e in expenses if (expense_date(e) or date.min) > today),
        undated=sum(1 for i in invoices if not invoice_date(i)) + sum(1 for e in expenses if not expense_date(e)),
        invoices=len(invoices), expenses=len(expenses))

    # This month so far
    cm = _key(today)
    out["current_month"] = dict(month=cm, revenue=round(revenue.get(cm, 0.0), 2),
                                cost_of_sales=round(max(product_cost.get(cm, 0.0), direct.get(cm, 0.0)), 2),
                                expenses=round(running.get(cm, 0.0), 2),
                                invoices=sum(1 for i in invoices if (d := invoice_date(i)) and _key(d) == cm),
                                expense_records=sum(1 for e in expenses if (d := expense_date(e)) and _key(d) == cm))
    employees = (data.get("catalogue") or {}).get("employees")
    if isinstance(employees, list):
        out["counts"]["employees"] = sum(1 for employee in employees if isinstance(employee, dict) and not employee.get("archived"))
    return out
