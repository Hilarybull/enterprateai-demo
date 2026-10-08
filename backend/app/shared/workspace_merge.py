"""Keep facts written by the server when a client saves a stale copy of the workspace.

Business Operations saves the whole financials document from its own copy. If the
Agent (or a customer) changed a record after that copy was loaded, a plain save would
erase it: a receipt the Agent issued and sent, a reminder it recorded, or a customer's
acceptance of a quotation. These facts can only be added by the server, never removed
by an ordinary edit, so they are carried over from the stored document.
"""
from __future__ import annotations

from typing import Any


def _by_id(rows: Any) -> dict[str, dict]:
    return {str(r["id"]): r for r in rows or [] if isinstance(r, dict) and r.get("id")}


def _keep_receipts(incoming_payments: list, stored_payments: list) -> None:
    stored = _by_id(stored_payments)
    for p in incoming_payments or []:
        if not isinstance(p, dict):
            continue
        s = stored.get(str(p.get("id") or ""))
        if not s or not isinstance(s.get("receipt"), dict):
            continue
        mine = p.get("receipt") if isinstance(p.get("receipt"), dict) else {}
        # Stored receipt facts win: a client can't un-issue or un-send a receipt.
        p["receipt"] = {**mine, **s["receipt"]}


_INVOICE_STATE = ("status", "status_reason", "status_date", "status_changed_at", "status_changed_by", "status_before",
                  "reopened_from")


def _keep_invoice_state(incoming: dict, stored: dict) -> None:
    """Disputed / voided / cancelled / credited (and reopening) are set through the API and
    stamped with `status_changed_at`. A copy of the page loaded before that change must not
    put the old status back."""
    stamp = str(stored.get("status_changed_at") or "")
    if stamp and stamp > str(incoming.get("status_changed_at") or ""):
        for k in _INVOICE_STATE:
            if k in stored:
                incoming[k] = stored[k]
            else:
                incoming.pop(k, None)


_CUSTOMER_RESPONSE = ("status", "responded_at", "acceptance", "declined_reason")


_CATALOGUE_LISTS = ("customers", "products", "vendors")
_FINANCIAL_LISTS = ("invoices", "quotes", "quotations", "contracts", "expenses", "proposals", "purchase_orders", "credit_notes", "supplier_bills")


def _server_made(record: dict) -> bool:
    """Written by the Agent (or another server process), not typed into a page."""
    return bool(record.get("agent_run_id") or record.get("created_by_agent") or str(record.get("source") or "").startswith("EnterprateAI"))


def _keep_what_was_added(incoming: dict, stored: dict) -> None:
    """The Catalogue and Business Operations pages each save their whole section from the copy they
    loaded. A customer the Agent added, or a document it prepared, after that copy was loaded is
    not in it, and a plain save would erase it. Here those records are carried over.

    Catalogue: a page never removes a live item (it archives, and only purges what is already
    archived), so a stored live item missing from the save can only be one the page never saw.
    Documents: a page does delete, so it now names what it deleted (`deleted_ids`); a record the
    server made that is missing and was not named is kept. Whole lists the page doesn't know
    about (proposals, purchase orders, credit notes) are kept too."""
    cat_in, cat_st = incoming.get("catalogue"), stored.get("catalogue")
    if isinstance(cat_in, dict) and isinstance(cat_st, dict):
        for key in _CATALOGUE_LISTS:
            if not isinstance(cat_st.get(key), list):
                continue
            if not isinstance(cat_in.get(key), list):
                cat_in[key] = list(cat_st[key])
                continue
            have = {str(r.get("id")) for r in cat_in[key] if isinstance(r, dict)}
            cat_in[key].extend(r for r in cat_st[key] if isinstance(r, dict) and r.get("id") and str(r["id"]) not in have and not r.get("archived"))
    fin_in, fin_st = incoming.get("financials"), stored.get("financials")
    if isinstance(fin_in, dict) and isinstance(fin_st, dict):
        deleted = {str(x) for x in fin_in.pop("deleted_ids", None) or []}      # said by the page; never stored
        for key, rows in fin_st.items():
            if key not in _FINANCIAL_LISTS or not isinstance(rows, list):
                continue
            if not isinstance(fin_in.get(key), list):
                fin_in[key] = [r for r in rows if not (isinstance(r, dict) and str(r.get("id")) in deleted)]
                continue
            have = {str(r.get("id")) for r in fin_in[key] if isinstance(r, dict)} | {str(r.get("legacy_id")) for r in fin_in[key] if isinstance(r, dict) and r.get("legacy_id")}
            fin_in[key].extend(r for r in rows if isinstance(r, dict) and r.get("id") and str(r["id"]) not in have and str(r["id"]) not in deleted and _server_made(r))
    elif isinstance(fin_in, dict):
        fin_in.pop("deleted_ids", None)


def preserve_server_fields(incoming: dict, stored: dict) -> dict:
    """`incoming` (the new workspace data) with server-written facts carried over from `stored`."""
    if isinstance(incoming, dict) and isinstance(stored, dict):
        _keep_what_was_added(incoming, stored)
    fin_in = incoming.get("financials") if isinstance(incoming, dict) else None
    fin_st = stored.get("financials") if isinstance(stored, dict) else None
    if not isinstance(fin_in, dict) or not isinstance(fin_st, dict):
        return incoming

    stored_invoices = _by_id(fin_st.get("invoices"))
    for inv in fin_in.get("invoices") or []:
        if not isinstance(inv, dict):
            continue
        s = stored_invoices.get(str(inv.get("id") or ""))
        if not s:
            continue
        _keep_receipts(inv.get("payments") or [], s.get("payments") or [])
        _keep_invoice_state(inv, s)
        for k in ("last_reminder_at", "next_reminder_not_before"):      # the reminder interval is the server's
            if s.get(k) and str(s[k]) > str(inv.get(k) or ""):
                inv[k] = s[k]
        if len(s.get("reminders") or []) > len(inv.get("reminders") or []):
            inv["reminders"] = s["reminders"]

    stored_quotes = _by_id(fin_st.get("quotes"))
    for q in fin_in.get("quotes") or []:
        if not isinstance(q, dict):
            continue
        s = stored_quotes.get(str(q.get("id") or ""))
        if not s:
            continue
        if s.get("responded_at") and str(s.get("status") or "").lower() in ("accepted", "rejected") and not q.get("responded_at"):
            for k in _CUSTOMER_RESPONSE:      # the customer's answer outranks a stale "sent"
                if k in s:
                    q[k] = s[k]
        if len(s.get("customer_questions") or []) > len(q.get("customer_questions") or []):
            q["customer_questions"] = s["customer_questions"]
            q["has_open_question"] = s.get("has_open_question")
    return incoming
