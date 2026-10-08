"""Invoice numbers: unique per business, issued by the server.

Invoices live inside the workspace document, which the Business Operations page saves as
a whole. Left to the browser, a new invoice was numbered by counting the invoices it
happened to have loaded, and two invoices could end up with the same number. Now:

  * new invoices get their number from a per-business sequence (migration 030) when saved;
  * a number typed by hand is refused if another invoice already has it;
  * every number in use is kept in a ledger with a unique constraint on
    (business_id, invoice_number), so the database itself rejects a duplicate;
  * invoices saved with a browser-made "local:" id get a server id (the old id is kept as
    `legacy_id` so earlier references still resolve).

Until migration 030 is applied, uniqueness is enforced against the workspace document only.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

_PATTERN = re.compile(r"^INV-(\d+)(\d{6})$")
_ledger_available: bool | None = None      # None = not yet known


def key_of(number: Any) -> str:
    """How numbers are compared: case and surrounding space don't make a number different."""
    return str(number or "").strip().upper()


def number_of(inv: dict) -> str:
    return str(inv.get("invoice_number") or inv.get("reference") or "").strip()


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return any(code in text for code in ("PGRST205", "PGRST202", "42P01", "42883")) or "Could not find the" in text


def _duplicate(number: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "duplicate_invoice_number", "invoice_number": number,
                "message": f"Invoice number {number} is already used by another invoice. "
                           "Enter a different number, or leave it blank to get the next one automatically."})


async def _claim(business_id: str, number: str, invoice_id: str) -> bool:
    """Record that `invoice_id` holds `number`. False if another invoice already does."""
    global _ledger_available
    if _ledger_available is False:
        return True
    from app.core import supabase as sb
    row = {"business_id": business_id, "invoice_number": key_of(number), "invoice_id": str(invoice_id)}
    try:
        await sb.sb_insert("business_invoice_numbers", row)
        _ledger_available = True
        return True
    except Exception as exc:
        if _missing(exc):
            _ledger_available = False
            logger.warning("invoice number ledger not found: run migration 030_invoice_numbers.sql. "
                           "Invoice numbers are being checked against the workspace only.")
            return True
        # The unique constraint refused it: fine if this same invoice already holds the number.
        try:
            held = await sb.sb_select("business_invoice_numbers", single=True, filters=[
                ("business_id", "eq", business_id), ("invoice_number", "eq", key_of(number))])
        except Exception:
            raise exc
        if not held:
            raise
        return str(held.get("invoice_id")) == str(invoice_id)


async def _next_seq(business_id: str, day: str, floor: int) -> int:
    global _ledger_available
    if _ledger_available is not False:
        from app.core import supabase as sb
        try:
            n = await sb.sb_rpc("next_business_doc_seq", {"p_business": business_id, "p_type": "invoice", "p_day": day})
            _ledger_available = True
            return int(n[0] if isinstance(n, list) else n)
        except Exception as exc:
            if not _missing(exc):
                raise
            _ledger_available = False
            logger.warning("invoice number sequence not found: run migration 030_invoice_numbers.sql")
    return floor + 1


async def next_number(business_id: str, now: datetime, taken: set[str], invoice_id: str | None = None) -> str:
    """The next free invoice number for the business, reserved in the ledger."""
    day = now.strftime("%d%m%y")
    used = {key_of(t) for t in taken or ()}
    floor = max((int(m.group(1)) for m in (_PATTERN.match(u) for u in used) if m and m.group(2) == day), default=0)
    holder = invoice_id or f"reserved:{uuid4()}"
    for _ in range(200):
        n = await _next_seq(business_id, day, floor)
        floor = max(floor, n)
        number = f"INV-{n}{day}"
        if key_of(number) in used:
            continue
        if await _claim(business_id, number, holder):
            return number
        used.add(key_of(number))
    raise RuntimeError("Could not allocate an invoice number.")


async def prepare_invoices_for_save(business_id: str, incoming: dict, stored: dict, now: datetime) -> None:
    """Make the invoices in a workspace save safe to store. Changes `incoming` in place;
    raises 409 with a clear message when a typed number duplicates another invoice."""
    invoices = incoming.get("invoices")
    if not isinstance(invoices, list):
        return
    stored_list = [i for i in (stored or {}).get("invoices") or [] if isinstance(i, dict)]
    stored_by_id = {str(i.get("id")): i for i in stored_list if i.get("id")}
    by_legacy = {str(i["legacy_id"]): i for i in stored_list if i.get("legacy_id")}

    # Server ids: nothing is stored under a browser-made "local:" id.
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        current = str(inv.get("id") or "")
        if current in by_legacy:                       # a stale copy of an invoice that already has its server id
            inv["legacy_id"] = current
            inv["id"] = by_legacy[current]["id"]
        elif not current or current.startswith("local:"):
            if current:
                inv["legacy_id"] = current
            inv["id"] = str(uuid4())

    holders: dict[str, set[str]] = {}                  # number -> the invoices that have it after this save
    for inv in invoices:
        if isinstance(inv, dict) and number_of(inv) and not inv.get("number_auto"):
            holders.setdefault(key_of(number_of(inv)), set()).add(str(inv["id"]))

    to_number: list[dict] = []
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        before = stored_by_id.get(str(inv["id"])) or (stored_by_id.get(str(inv.get("legacy_id"))) if inv.get("legacy_id") else None)
        number = number_of(inv)
        auto = bool(inv.pop("number_auto", False))
        if before is None and (auto or not number):
            to_number.append(inv)                      # new, and the number wasn't chosen by hand
            continue
        if not number:
            if before is not None and number_of(before):      # a number can be changed, not removed
                inv["invoice_number"] = inv["reference"] = number_of(before)
            continue
        changed = before is None or key_of(number_of(before)) != key_of(number)
        if not changed:
            continue                                   # untouched: older duplicates don't block unrelated saves
        if len(holders.get(key_of(number), ())) > 1 or not await _claim(business_id, number, str(inv["id"])):
            raise _duplicate(number)
        inv["invoice_number"] = inv["reference"] = number

    taken = set(holders) | {key_of(number_of(i)) for i in stored_list if number_of(i)}
    for inv in to_number:
        number = await next_number(business_id, now, taken, invoice_id=str(inv["id"]))
        inv["invoice_number"] = inv["reference"] = number
        taken.add(key_of(number))


def duplicate_numbers(invoices: list[dict]) -> list[dict]:
    """Invoice numbers held by more than one invoice (for the integrity check)."""
    seen: dict[str, list[dict]] = {}
    for inv in invoices or []:
        if isinstance(inv, dict) and number_of(inv) and not inv.get("archived"):
            seen.setdefault(key_of(number_of(inv)), []).append(inv)
    return [{"issue": "duplicate_invoice_number", "invoice_number": number_of(rows[0]),
             "detail": "This invoice number is used by more than one invoice.",
             "invoices": [{"invoice_id": r.get("id"), "customer_name": r.get("customer_name"), "status": r.get("status"),
                           "total": r.get("total_amount") or r.get("amount"), "created_at": r.get("created_at")} for r in rows]}
            for rows in seen.values() if len(rows) > 1]
