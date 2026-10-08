"""What an open task says, built when it is read.

A task that is waiting (for an answer, for an approval, or for something to be put right)
stored its question or message when it stopped. Wording improves and records change after
that, so the stored sentence can be out of date: it may name no customer, ask for something
the profile now holds, or still describe a stop the task has since got past.

So the text shown for an open task is worked out from its state and the records as they are
now. The stored text is the fallback, never the source. Nothing here sends or starts anything;
the only thing it may do to a task is ask it to look at the profile again, which re-asks its
own question.
"""
from __future__ import annotations

import logging

from app.modules.agent import business as bz

logger = logging.getLogger(__name__)

_THEN = {"payment_followup": "prepare the reminder", "receipt_send": "send the receipt", "enquiry_to_quote": "send the quotation",
         "quote_to_cash": "send the invoice"}
_ASKS_ABOUT_THE_BUSINESS = ("idea_validation", "market_size", "business_plan_draft")


def _record(data: dict, state: dict) -> dict | None:
    """The document the task is about: its invoice, else its quotation."""
    fin = data.get("financials") or {}
    if state.get("invoice_id"):
        return bz.find([i for i in fin.get("invoices") or [] if isinstance(i, dict)], state["invoice_id"])
    if state.get("quote_id"):
        return bz.find(bz.quotes_of(data), state["quote_id"])
    return None


def document_number(rec: dict | None, data: dict, state: dict | None = None) -> str:
    """The number a document is known by. An invoice saved without one has the number Business
    Operations and the dashboard give it (from its creation day), so every page names it alike."""
    rec, state = rec or {}, state or {}
    if rec and (state.get("invoice_id") or "payments" in rec or "due_date" in rec):
        from app.modules.agent.dashboard import invoice_label, invoice_labels
        label = invoice_label(rec, invoice_labels(data))
        if label and label != "Invoice (no number)":
            return label
    return str(rec.get("reference") or rec.get("quotation_id") or rec.get("invoice_number") or state.get("invoice_reference")
               or state.get("quote_reference") or "").strip()


def _receipt_number(rec: dict | None) -> str | None:
    """The receipt this task is preparing: the newest one on the invoice that hasn't been sent."""
    payments = [p for p in (rec or {}).get("payments") or [] if isinstance(p, dict) and (p.get("receipt") or {}).get("number")]
    waiting = [p for p in payments if not p["receipt"].get("sent_at")] or payments
    return waiting[-1]["receipt"]["number"] if waiting else None


def refresh_texts(run: dict, data: dict) -> dict:
    """The task as it should read now. Returns a copy; nothing is saved."""
    out = {**run, "state": dict(run.get("state") or {})}
    state = out["state"]
    rec = _record(data, state)
    if out.get("status") == "failed" and out.get("reason_code") == "invalid_customer_destination":
        # Whose address is missing, and for which document, from the document itself.
        who = str((rec or {}).get("customer_name") or (state.get("email_needed") or {}).get("customer") or "This customer").strip()
        ref = document_number(rec, data, state) or str((state.get("email_needed") or {}).get("reference") or "").strip()
        then = _THEN.get(out.get("workflow_key"), "carry on")
        text = f"{who} has no email on record" + (f" for {ref}" if ref else "") + f". Add it and I'll {then}."
        state["email_needed"] = {"customer": who, "reference": ref or None}
        out.update({"error": text, "summary": text, "next_action": text})
    if out.get("workflow_key") == "receipt_send" and not state.get("receipt_number"):
        number = _receipt_number(rec)
        if number:
            state["receipt_number"] = number      # so "what happened" can name the receipt
    return out


_OLD_EMAIL_TEXT = ("no valid email address", "Fix the customer's email")


def refresh_steps(steps: list[dict], stored: dict, shown: dict) -> list[dict]:
    """A step's note or error is the sentence the task stopped with. Where the task's own text
    has been rebuilt, the step that carries the old sentence shows the rebuilt one too."""
    old = {t for t in (stored.get("error"), stored.get("summary"), stored.get("next_action")) if isinstance(t, str) and t}
    new = shown.get("error") or shown.get("summary")
    if not new or shown.get("reason_code") != "invalid_customer_destination":
        return steps
    out = []
    for s in steps:
        s = dict(s)
        for field in ("note", "error"):
            text = s.get(field)
            if isinstance(text, str) and text != new and (text in old or any(m in text for m in _OLD_EMAIL_TEXT) or " has no email on record" in text):
                s[field] = new
        out.append(s)
    return out


async def recheck_against_profile(orch, run: dict, data: dict) -> dict:
    """An idea task is waiting on a question about the business. If the profile now answers it,
    the task carries on; if the profile now offers a guess, the open question becomes the
    "Is this right?" form. Either way the task simply asks itself again."""
    from app.modules.agent.workflows import idea_of
    asked = run.get("pending_question") if run.get("status") == "running" else None
    if asked and run.get("workflow_key") == "enquiry_to_quote" and asked.get("question") == "Who is this quotation for?" \
            and {f.get("key") for f in asked.get("fields") or []} == {"customer_name", "customer_email"} \
            and any(isinstance(c, dict) and c.get("id") and c.get("name") for c in (data.get("catalogue") or {}).get("customers") or []):
        # Asked before the form could offer the customers on record and the items: it asks itself again.
        try:
            return await orch.advance(run["id"]) or run
        except Exception:      # noqa: BLE001
            logger.warning("could not re-ask task %s", run.get("id"), exc_info=True)
            return run
    q = asked if run.get("workflow_key") in _ASKS_ABOUT_THE_BUSINESS else None
    if q and "_launch" not in data:
        from app.modules.agent import modules
        data["_launch"] = await modules.launch_facts(orch, run["business_id"])      # a launch plan may already say who it is for
    field = ((q or {}).get("fields") or [{}])[0]
    key = field.get("key")
    if not q or not key:
        return run
    known = idea_of(data, (run.get("state") or {}).get("answers") or {})
    if not known.get(key):
        return run                                    # still nothing on record: the question stands
    guessed = bool(known.get(f"{key}_guessed"))
    if field.get("confirm") and guessed and field.get("default") == known[key]:
        return run                                    # already the confirm form for this guess
    try:
        return await orch.advance(run["id"]) or run
    except Exception:      # noqa: BLE001 - reading a task never fails because it couldn't be refreshed
        logger.warning("could not re-check task %s against the profile", run.get("id"), exc_info=True)
        return run


async def open_runs(orch, business_id: str, runs: list[dict], recheck: bool = False) -> list[dict]:
    """Tasks for one business as they should read now (one read of the business's records)."""
    if not runs:
        return runs
    try:
        data = await orch.rt.business.load(business_id)
    except Exception:      # noqa: BLE001
        return runs
    if recheck and any(r.get("workflow_key") in _ASKS_ABOUT_THE_BUSINESS and r.get("status") == "running" and r.get("pending_question") for r in runs):
        from app.modules.agent import modules
        data["_launch"] = await modules.launch_facts(orch, business_id)      # a launch plan may already say who it is for
    out = []
    for r in runs:
        if recheck:
            r = await recheck_against_profile(orch, r, data)
        out.append(refresh_texts(r, data) if r.get("status") not in ("succeeded", "cancelled") else r)
    return out
