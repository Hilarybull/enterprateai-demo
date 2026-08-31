from __future__ import annotations

_DOC_TYPE_LABELS: dict[str, str] = {
    "invoice": "Invoice",
    "invoice_template": "Invoice",
    "receipt": "Receipt",
    "business_plan": "Business Plan",
    "live_plan": "Live Business Plan",
    "quotation": "Quotation",
    "sales_quotation": "Quotation",
    "contract": "Contract",
    "expense": "Expense",
    "report": "Report",
}


def doc_label(document_type: str | None) -> str:
    raw = str(document_type or "").strip()
    # quotation_acceptance::workspace_id::rfq_id::quote_id
    if raw.startswith("quotation_acceptance::"):
        return "Quotation"
    return _DOC_TYPE_LABELS.get(raw.lower(), "Document")
