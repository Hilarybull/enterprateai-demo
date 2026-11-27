"""Vendor-linked invoice costs become one supplier expense, in the same workspace write."""
import math
import re
from datetime import date, timedelta


def prepare_supplier_costs(patch: dict, stored: dict) -> None:
    financials = patch.get("financials")
    if not isinstance(financials, dict) or not isinstance(financials.get("invoices"), list):
        return
    catalogue = {**(stored.get("catalogue") or {}), **(patch.get("catalogue") or {})}
    vendors = {str(v.get("id")): v for v in catalogue.get("vendors") or [] if isinstance(v, dict)}
    prior = {str(e.get("id")): e for e in (stored.get("financials") or {}).get("expenses") or [] if isinstance(e, dict)}
    expenses = {str(e.get("id")): dict(e) for e in financials.get("expenses", list(prior.values())) if isinstance(e, dict)}
    linked = False
    for invoice in financials["invoices"]:
        for index, line in enumerate(invoice.get("line_items") or []):
            if not isinstance(line, dict) or not line.get("vendor_id"):
                continue
            vendor = vendors.get(str(line["vendor_id"]))
            if not vendor or vendor.get("archived"):
                raise ValueError("Choose an active vendor from this business's Master records.")
            amount = float(line.get("qty") or 1) * float(line.get("cost_of_sales") or 0)
            if not math.isfinite(amount) or amount <= 0:
                raise ValueError("A linked supplier bill needs a positive cost of sales.")
            amount = round(amount, 2)
            issued = str(invoice.get("issued_at") or invoice.get("date") or date.today().isoformat())[:10]
            due = str(line.get("supplier_due_date") or "")[:10]
            if not due:
                terms = str(vendor.get("payment_terms", vendor.get("payment_terms_days", "")))
                match = re.search(r"\d+", terms)
                days = int(match.group()) if match else 0 if re.search(r"cash|immediate|on receipt", terms, re.I) else None
                if days is None:
                    raise ValueError("Add vendor payment terms or enter the supplier due date.")
                due = (date.fromisoformat(issued) + timedelta(days=days)).isoformat()
            date.fromisoformat(due)
            line_id = line.get("id") or f"line-{index}"
            bill_id = str(line.get("supplier_bill_id") or f"cos-{invoice['id']}-{line_id}")
            old = prior.get(bill_id) or expenses.get(bill_id) or {}
            incoming = expenses.get(bill_id) or {}
            if old and old.get("source_invoice_id") != invoice["id"]:
                raise ValueError("This supplier bill belongs to a different invoice.")
            if old.get("status") == "paid" and (round(float(old.get("price") or old.get("amount") or 0), 2) != amount or old.get("vendor_id") != vendor["id"]):
                raise ValueError("Review the paid supplier bill before changing its amount or vendor.")
            if bill_id in prior:
                previous_amount = round(float(prior[bill_id].get("price") or prior[bill_id].get("amount") or 0), 2)
                bill_amount = round(float(incoming.get("price") or incoming.get("amount") or previous_amount), 2)
                if bill_amount != previous_amount and amount == previous_amount:
                    if prior[bill_id].get("status") == "paid" or bill_amount <= 0 or not math.isfinite(bill_amount):
                        raise ValueError("Review the supplier bill before changing its amount.")
                    amount = bill_amount
                    line["cost_of_sales"] = amount / float(line.get("qty") or 1)
                elif bill_amount != previous_amount and bill_amount != amount:
                    raise ValueError("The supplier bill and invoice cost disagree. Review them before saving.")
                previous_due = prior[bill_id].get("due_date")
                if incoming.get("due_date") != previous_due and due == previous_due:
                    due = incoming["due_date"]
                    date.fromisoformat(due)
            expenses[bill_id] = {**old, **expenses.get(bill_id, {}), "id": bill_id, "source_invoice_id": invoice["id"], "source_line_id": line_id,
                                "vendor_id": vendor["id"], "vendor_name": vendor.get("name") or vendor.get("vendor_name"),
                                "category": "cost_of_sales", "expense_type": "cost_of_sales", "price": amount, "amount": amount, "total_amount": amount,
                                "description": line.get("description") or "Invoice delivery cost", "date": issued, "due_date": due,
                                "currency": invoice.get("currency"), "status": incoming.get("status") or old.get("status") or "pending"}
            line.update(id=line_id, supplier_bill_id=bill_id, supplier_due_date=due)
            linked = True
        if any(isinstance(line, dict) and line.get("supplier_bill_id") for line in invoice.get("line_items") or []):
            invoice["cost_of_sales"] = round(sum(float(line.get("qty") or 1) * float(line.get("cost_of_sales") or 0) for line in invoice["line_items"]), 2)
    if linked:
        financials["expenses"] = list(expenses.values())
