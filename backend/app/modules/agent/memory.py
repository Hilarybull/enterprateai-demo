"""What the assistant knows about one business beyond a single question.

Three things, all scoped to the business and never shared across businesses:
  * saved facts: short statements the owner has confirmed ("We don't work weekends");
  * the business's records, handed to the assistant as separate, labelled sources, masked
    the same way the pages mask them on the owner's plan;
  * what has happened lately: requests received, quotations answered, invoices overdue,
    and the Agent's own recent tasks and how they ended.

Nothing here is guessed or generated: every line comes from a record.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent.models import new_id

KEY = "agent_memory"
MAX_FACTS = 30
MAX_LENGTH = 300

# The three ways of asking for something to be kept. Anything else ("note for this chat: …",
# "keep in mind…") is part of the conversation, not a request to save.
_REMEMBER = re.compile(r"^\s*(?:please\s+)?remember\s+(?:that\s+|this:\s*)?(.{3,})$", re.I | re.S)
_STANDING = re.compile(r"^\s*(?:please\s+)?((?:always|from now on)\b[\s,]+.{3,})$", re.I | re.S)

CANT_SEE = "I can't see that in this workspace."


class MemoryError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def fact_in(text: str | None) -> str | None:
    """The fact in "remember that …", "always …" or "from now on …"; None for anything else.
    Asking is not saving: the owner confirms first."""
    m = _REMEMBER.match(text or "") or _STANDING.match(text or "")
    if not m:
        return None
    fact = " ".join(m.group(1).split()).rstrip(".")
    return fact[:MAX_LENGTH] if len(fact) >= 3 else None


def facts(data: dict) -> list[dict]:
    return [f for f in (data.get(KEY) or []) if isinstance(f, dict) and str(f.get("text") or "").strip()]


async def add(orch, business_id: str, user_id: str, text: str, email: str | None = None) -> dict:
    """Save a fact for this business. Only the owner confirms what is remembered."""
    actor, _ = await orch.actor_for(user_id, business_id, email)
    if not actor.is_owner:
        raise MemoryError("owner_only", "Only the workspace owner can save what the assistant remembers.")
    clean = " ".join(str(text or "").split())[:MAX_LENGTH]
    if len(clean) < 3:
        raise MemoryError("empty", "Write the fact to remember.")
    now = orch.rt.clock().isoformat()

    def _apply(data: dict) -> dict:
        rows = data.setdefault(KEY, [])
        same = next((f for f in rows if isinstance(f, dict) and str(f.get("text") or "").strip().lower() == clean.lower()), None)
        if same:
            return same
        if len(rows) >= MAX_FACTS:
            raise MemoryError("full", f"The assistant keeps up to {MAX_FACTS} facts for a business. Remove one to add another.")
        fact = {"id": new_id(), "text": clean, "saved_by": user_id, "saved_at": now}
        rows.append(fact)
        return fact

    return await orch.rt.business.mutate(business_id, _apply)


async def remove(orch, business_id: str, user_id: str, fact_id: str, email: str | None = None) -> bool:
    actor, _ = await orch.actor_for(user_id, business_id, email)
    if not actor.is_owner:
        raise MemoryError("owner_only", "Only the workspace owner can change what the assistant remembers.")

    def _apply(data: dict) -> bool:
        rows = data.get(KEY) or []
        kept = [f for f in rows if not (isinstance(f, dict) and f.get("id") == fact_id)]
        data[KEY] = kept
        return len(kept) != len(rows)

    return await orch.rt.business.mutate(business_id, _apply)


# ── the labelled sources ──────────────────────────────────────────────────────

def _day(value: Any) -> str:
    d = bz.parse_day(value)
    return d.isoformat() if d else ""


def _items(row: dict) -> list[str]:
    return [f"{i.get('quantity') or 1} x {i.get('name')}" for i in row.get("items") or [] if isinstance(i, dict) and i.get("name")]


def inbound_requests(data: dict) -> dict:
    """Requests for a quotation buyers sent to this business. When the plan locks them, only
    how many there are and when they arrived: no name, address, item or message."""
    rows = [r for r in (data.get("financials") or {}).get("rfq_requests") or [] if isinstance(r, dict)]
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    waiting = sum(1 for r in rows if bz.status_of(r) == "pending")
    if any(r.get("locked") for r in rows):
        return {"locked": True, "count": len(rows), "waiting_for_a_reply": waiting, "received": [_day(r.get("created_at")) for r in rows[:10]],
                "note": ("Who sent these and what they asked for are locked on this plan. Say how many are waiting and that "
                         "upgrading shows them. Never state or guess a buyer's name, email address, items or message.")}
    return {"locked": False, "count": len(rows), "waiting_for_a_reply": waiting, "requests": [{
        "from": r.get("customer_company") or r.get("customer_name"), "contact": r.get("customer_name"), "email": r.get("customer_email"),
        "asked_for": _items(r), "message": r.get("message"), "needed_by": r.get("needed_by"), "received": _day(r.get("created_at")),
        "status": {"approved": "answered with a quotation", "rejected": "declined", "pending": "waiting for a reply"}.get(bz.status_of(r), bz.status_of(r)),
    } for r in rows[:10]]}


_RUN_WORDS = {"succeeded": "finished", "failed": "stopped and needs attention", "cancelled": "cancelled",
              "awaiting_approval": "waiting for approval", "running": "in progress", "created": "in progress"}


def agent_tasks(runs: list[dict]) -> list[dict]:
    rows = sorted(runs or [], key=lambda r: str(r.get("created_at") or ""), reverse=True)[:12]
    return [{"task": r.get("title"), "state": _RUN_WORDS.get(r.get("status"), r.get("status")), "outcome": r.get("summary") or r.get("next_action"),
             "started": _day(r.get("created_at")), "finished": _day(r.get("completed_at")) or None} for r in rows]


def events(data: dict, runs: list[dict], policy: dict, now: datetime) -> list[str]:
    """What has happened lately in the other parts of the product, each line from a record."""
    out: list[str] = []
    fin = data.get("financials") or {}
    requests = inbound_requests(data)
    if requests["waiting_for_a_reply"]:
        n = requests["waiting_for_a_reply"]
        out.append(f"{n} Marketplace request{'s' if n != 1 else ''} for a quotation {'are' if n != 1 else 'is'} waiting for a reply"
                   + (" (details locked on this plan)." if requests["locked"] else "."))
    for q in bz.quotes_of(data)[:40]:
        ref = q.get("reference") or q.get("quotation_id") or "a quotation"
        who = q.get("customer_name") or "the customer"
        if bz.status_of(q) in ("accepted", "won"):
            out.append(f"{who} accepted quotation {ref}" + (f" on {_day(q.get('responded_at'))}." if _day(q.get("responded_at")) else "."))
        elif bz.status_of(q) in ("rejected", "declined", "lost"):
            out.append(f"{who} declined quotation {ref}" + (f": {q['declined_reason']}." if q.get("declined_reason") else "."))
    today: date = now.date()
    for inv in bz.overdue_invoices(data, today)[:10]:
        due = bz.parse_day(inv.get("due_date"))
        out.append(f"Invoice {inv.get('reference') or ''} for {inv.get('customer_name') or 'a customer'} is overdue"
                   + (f" by {(today - due).days} days." if due else "."))
    for inv in [i for i in fin.get("invoices") or [] if isinstance(i, dict)][:60]:
        unreceipted = [p for p in inv.get("payments") or [] if isinstance(p, dict) and not (p.get("receipt") or {}).get("sent_at")]
        if unreceipted:
            out.append(f"A payment on invoice {inv.get('reference') or ''} has no receipt sent yet.")
    for r in agent_tasks(runs)[:5]:
        if r["state"] in ("finished", "stopped and needs attention", "waiting for approval"):
            out.append(f"Agent task “{r['task']}” {r['state']}" + (f": {r['outcome']}" if r["outcome"] else "."))
    return out[:25]


def sources(data: dict, runs: list[dict], policy: dict, now: datetime) -> dict[str, Any]:
    """The business's records as separate sources, each labelled with what it is, so a question
    about one is never answered from another. `data` is already masked for the owner's plan."""
    fin = data.get("financials") or {}
    cat = data.get("catalogue") or {}
    cur = bz.currency_of(data)
    return {
        "SAVED FACTS (confirmed by the owner, about this business only)": [f["text"] for f in facts(data)],
        "INBOUND REQUESTS FOR QUOTATION (buyers asking THIS business for a quote, through the Marketplace; also called RFQs)": inbound_requests(data),
        "QUOTATIONS THIS BUSINESS SENT TO ITS CUSTOMERS (outgoing documents, NOT requests)": [{
            "reference": q.get("reference") or q.get("quotation_id"), "customer": q.get("customer_name"), "total": bz.invoice_total(q), "currency": cur,
            "status": bz.status_of(q), "sent": _day(q.get("sent_at")) or None, "answers_a_marketplace_request": bool(q.get("rfq_id")),
        } for q in bz.quotes_of(data)[:15]],
        "REQUESTS THIS BUSINESS SENT TO SUPPLIERS (outgoing)": [{
            "to": r.get("recipient_company_name"), "asked_for": _items(r), "status": bz.status_of(r), "sent": _day(r.get("created_at")),
        } for r in (fin.get("sent_rfqs") or [])[:10] if isinstance(r, dict)],
        "INVOICES": [{
            "reference": i.get("reference"), "customer": i.get("customer_name"), "total": bz.invoice_total(i), "outstanding": bz.invoice_outstanding(i),
            "currency": cur, "status": bz.status_of(i), "due": _day(i.get("due_date")) or None,
        } for i in (fin.get("invoices") or [])[:20] if isinstance(i, dict)],
        "CATALOGUE (what this business sells, and its customers)": {
            "products_and_services": [{"name": p.get("name"), "price": float(p.get("base_price") or 0) or None} for p in (cat.get("products") or [])[:40] if isinstance(p, dict)],
            "customers": [c.get("name") for c in (cat.get("customers") or [])[:40] if isinstance(c, dict)],
        },
        "AGENT TASKS (what the Agent has done for this business, newest first)": agent_tasks(runs),
        "RECENT EVENTS": events(data, runs, policy, now),
    }


def without_sourced(data: dict) -> dict:
    """The rest of the workspace record, with the parts already given as labelled sources taken out
    so they can't be read a second time without their label."""
    fin = {k: v for k, v in (data.get("financials") or {}).items() if k not in ("quotes", "quotations", "invoices", "rfq_requests", "sent_rfqs")}
    return {k: v for k, v in data.items() if k not in ("financials", "catalogue", KEY)} | {"financials": fin}


RULES = (
    "The business's records are given as separate labelled sources. Answer from the source the question is about. "
    "A 'request for quotation', 'quotation request' or 'RFQ' the business received means INBOUND REQUESTS FOR QUOTATION; "
    "never answer it from the quotations the business sent. "
    f"If the labelled source does not contain the answer, say \"{CANT_SEE}\" and say what is missing. Never guess. "
    "Never state a name, email address, price, date or reference that does not appear in the sources. "
    "If a source says it is locked on this plan, say so and that upgrading shows it; give none of its details. "
    "Use SAVED FACTS as things the owner told you about this business. Use AGENT TASKS and RECENT EVENTS for what has happened lately."
)
