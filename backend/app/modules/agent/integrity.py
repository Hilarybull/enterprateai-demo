"""Checks that the books agree with what the Agent has already told customers.

A receipt that was approved and emailed must still be on the payment it was issued for.
If the record is missing (for example, erased by a save from a stale copy of the page),
the business believes no receipt exists while the customer holds one. This check finds
those cases, and any receipt number that reached more than one payment.
"""
from __future__ import annotations

import logging
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent.models import APPROVAL_CONSUMED

logger = logging.getLogger(__name__)


def _payment(data: dict, invoice_id: str, payment_id: str) -> tuple[dict | None, dict | None]:
    inv = bz.find((data.get("financials") or {}).get("invoices") or [], invoice_id)
    return inv, bz.find((inv or {}).get("payments") or [], payment_id)


def receipt_issues(data: dict, approvals: list[dict], history: list[dict]) -> list[dict[str, Any]]:
    """Problems with receipts, from consumed send_receipt approvals and the issue history."""
    issues: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for a in approvals:
        if a.get("tool_id") != "send_receipt" or a.get("status") != APPROVAL_CONSUMED:
            continue
        p = a.get("payload") or {}
        key = (str(p.get("invoice_id")), str(p.get("payment_id")))
        if key in seen:
            continue
        seen.add(key)
        inv, payment = _payment(data, *key)
        base = {"invoice_id": key[0], "payment_id": key[1], "invoice_reference": p.get("invoice_reference"),
                "receipt_number": p.get("receipt_number"), "amount": p.get("amount"), "sent_to": p.get("to_email"),
                "approval_id": a.get("id"), "run_id": a.get("run_id"), "approved_at": a.get("decided_at")}
        receipt = (payment or {}).get("receipt") or {}
        if not inv or not payment:
            issues.append({**base, "issue": "payment_missing",
                           "detail": "A receipt was sent for a payment that is no longer on the invoice."})
        elif not receipt.get("number"):
            issues.append({**base, "issue": "receipt_record_missing",
                           "detail": "A receipt was approved and sent, but the payment shows no receipt."})
        elif receipt.get("number") != p.get("receipt_number"):
            issues.append({**base, "issue": "receipt_number_mismatch", "recorded_number": receipt.get("number"),
                           "detail": "The receipt on the payment has a different number from the one that was sent."})

    by_number: dict[str, list[dict]] = {}
    for h in history:
        if h.get("number"):
            by_number.setdefault(h["number"], []).append(h)
    for number, rows in sorted(by_number.items()):
        payments = {(r.get("invoice_id"), r.get("payment_id")) for r in rows}
        if len(payments) > 1:
            issues.append({"issue": "duplicate_receipt_number", "receipt_number": number,
                           "detail": "This receipt number was issued for more than one payment.",
                           "payments": [{"invoice_id": r.get("invoice_id"), "payment_id": r.get("payment_id"),
                                         "sent_to": r.get("sent_to"), "sent_at": r.get("sent_at")} for r in rows]})
    return issues


def _describe(issue: dict) -> str:
    """One log line that names the records involved."""
    kind = issue["issue"]
    if kind == "duplicate_invoice_number":
        held = ", ".join(f"{x.get('invoice_id')} ({x.get('customer_name') or '?'}, {x.get('status') or '?'})" for x in issue.get("invoices") or [])
        return f"{kind}: invoice number {issue.get('invoice_number')} is on {len(issue.get('invoices') or [])} invoices: {held}"
    if kind == "duplicate_receipt_number":
        held = ", ".join(f"invoice {x.get('invoice_id')} payment {x.get('payment_id')}" for x in issue.get("payments") or [])
        return f"{kind}: receipt {issue.get('receipt_number')} was issued for {len(issue.get('payments') or [])} payments: {held}"
    return (f"{kind}: receipt {issue.get('receipt_number')} for invoice {issue.get('invoice_reference') or issue.get('invoice_id')} "
            f"payment {issue.get('payment_id')}. {issue.get('detail') or ''}").strip()


def duplicate_receipts(data: dict) -> list[dict[str, Any]]:
    """Receipt numbers that sit on more than one payment in the books, oldest holder first."""
    held: dict[str, list[dict]] = {}
    for inv in (data.get("financials") or {}).get("invoices") or []:
        for p in (inv.get("payments") or []) if isinstance(inv, dict) else []:
            receipt = (p or {}).get("receipt") or {}
            if receipt.get("number"):
                held.setdefault(receipt["number"], []).append({
                    "invoice_id": str(inv.get("id")), "payment_id": str(p.get("id")), "customer_name": inv.get("customer_name"),
                    "amount": p.get("amount"), "created_at": str(receipt.get("created_at") or ""), "sent_to": receipt.get("sent_to"),
                    "sent_at": receipt.get("sent_at"), "message_id": receipt.get("message_id")})
    return [{"receipt_number": number, "payments": sorted(rows, key=lambda r: r["created_at"])} for number, rows in sorted(held.items()) if len(rows) > 1]


async def repair_duplicate_receipts(rt, business_id: str, apply: bool = False) -> list[dict[str, Any]]:
    """Give every receipt its own number. The payment the ledger records for a number keeps it
    (else the earliest); each later one is given the next free number from the ledger, and keeps
    the old one as `replaces` so the copy the customer holds can still be traced.
    Returns what was (or, without `apply`, would be) changed."""
    data = await rt.business.load(business_id) or {}
    history = await rt.store.receipt_history(business_id)
    changes: list[dict[str, Any]] = []
    for dup in duplicate_receipts(data):
        number = dup["receipt_number"]
        holders = sorted((h for h in history if h.get("number") == number), key=lambda h: str(h.get("created_at") or ""))
        keeper = holders[0] if holders else None      # the first payment the number was issued for
        keep = next((p for p in dup["payments"] if keeper and (p["invoice_id"], p["payment_id"]) == (str(keeper.get("invoice_id")), str(keeper.get("payment_id")))),
                    dup["payments"][0])
        for p in dup["payments"]:
            if p is keep:
                continue
            change = {"receipt_number": number, "invoice_id": p["invoice_id"], "payment_id": p["payment_id"], "customer_name": p["customer_name"],
                      "amount": p["amount"], "kept_by": keep["customer_name"], "new_number": None}
            if apply:
                when = bz._moment(p["created_at"]) or rt.clock()
                issued = await rt.store.issue_receipt(business_id, p["invoice_id"], p["payment_id"], when, {
                    "amount": bz.money(p["amount"]), **{k: p[k] for k in ("sent_at", "sent_to", "message_id") if p.get(k)}}, replacing=number)
                if issued["number"] == number:
                    raise RuntimeError(f"Receipt {number} could not be given a new number; it needs putting right by hand.")
                new = issued["number"]

                def _renumber(d: dict, p=p, new=new) -> None:
                    inv, payment = _payment(d, p["invoice_id"], p["payment_id"])
                    if payment and (payment.get("receipt") or {}).get("number") == number:
                        payment["receipt"].update({"number": new, "replaces": number, "renumbered_at": rt.clock().isoformat()})
                        inv["updated_at"] = rt.clock().isoformat()
                await rt.business.mutate(business_id, _renumber)
                change["new_number"] = new
            changes.append(change)
    return changes


async def _main(argv: list[str]) -> None:
    """python -m app.modules.agent.integrity [--apply] [business_id ...]
    Lists receipts that share a number and what each would become. Changes nothing without --apply."""
    from app.modules.agent.router import get_orchestrator
    rt = get_orchestrator().rt
    apply = "--apply" in argv
    wanted = [a for a in argv if not a.startswith("--")]
    if not wanted:
        from app.core.supabase import sb_select
        wanted = [w["id"] for w in await sb_select("workspaces", columns="id", limit=5000) or []]
    total = 0
    for business_id in wanted:
        for c in await repair_duplicate_receipts(rt, business_id, apply=apply):
            total += 1
            print(f"{business_id}: receipt {c['receipt_number']} for {c['customer_name']} ({c['amount']}) "
                  f"{'is now ' + c['new_number'] if c['new_number'] else 'would get a new number'}; {c['kept_by']} keeps {c['receipt_number']}")
    print(f"{total} receipt(s) {'renumbered' if apply else 'to renumber (nothing changed: run again with --apply)'}")


async def check_business(rt, business_id: str) -> list[dict[str, Any]]:
    data = await rt.business.load(business_id)
    approvals = await rt.store.list_approvals(business_id=business_id, status=APPROVAL_CONSUMED)
    history = await rt.store.receipt_history(business_id)
    from app.shared.invoice_numbers import duplicate_numbers
    return receipt_issues(data or {}, approvals, history) + duplicate_numbers(((data or {}).get("financials") or {}).get("invoices") or [])


async def check_all_at_startup(rt) -> dict[str, list[dict]]:
    """Logs a warning for every business whose receipts don't match what was sent. Never raises."""
    found: dict[str, list[dict]] = {}
    try:
        approvals = await rt.store.list_approvals(status=APPROVAL_CONSUMED)
        businesses = sorted({a["business_id"] for a in approvals if a.get("tool_id") == "send_receipt"})
        for business_id in businesses:
            try:
                issues = await check_business(rt, business_id)
            except Exception:      # noqa: BLE001 - one unreadable business must not hide the rest
                logger.warning("receipt integrity: could not check business %s", business_id, exc_info=True)
                continue
            if issues:
                found[business_id] = issues
                for i in issues:
                    logger.warning("integrity: business=%s %s", business_id, _describe(i))
        if not found:
            logger.info("receipt integrity: %d business(es) checked, no problems", len(businesses))
    except Exception:      # noqa: BLE001 - a check, never a reason to fail startup
        logger.warning("receipt integrity check could not run", exc_info=True)
    return found


if __name__ == "__main__":
    import asyncio
    import sys
    asyncio.run(_main(sys.argv[1:]))
