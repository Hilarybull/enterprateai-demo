"""Agent API (s19). Endpoint names follow the PRD's conceptual contracts.

Every route resolves the caller's authority inside the business first; a user
with no access gets 404 for that business, never data.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.modules.agent import summary as summary_mod
from app.modules.agent.models import AgentRequest, new_id
from app.modules.agent.orchestrator import AccessDenied, Conflict, Orchestrator, Runtime
from app.modules.agent.tools import describe_tools
from app.modules.agent.workflows import INVENTORY, WORKFLOWS
from app.shared.auth.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent"])


@lru_cache(maxsize=1)
def get_orchestrator() -> Orchestrator:
    from app.modules.agent.business import SupabaseBusiness
    from app.modules.agent.services import CreditMeter, LLMClassifier, ModuleStudio, ResendComms
    from app.modules.agent.store import SupabaseStore
    return Orchestrator(Runtime(store=SupabaseStore(), business=SupabaseBusiness(), comms=ResendComms(),
                                meter=CreditMeter(), classifier=LLMClassifier(), studio=ModuleStudio()))


def _known_id(*values: str) -> None:
    """Run and approval ids are UUIDs: anything else can't exist, so it's a 404, not a database error."""
    for value in values:
        try:
            uuid.UUID(str(value))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


# Channels a signed-in user may use. "business_event" and "api" are reserved for trusted
# system and service actors (scheduler, integrations), which call the orchestrator
# directly rather than through this user-authenticated endpoint (s8).
USER_CHANNELS = {"text", "ui_action", "voice"}


def _conflict(e: Conflict) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": e.code, "message": e.message})


def _denied(e: Exception) -> HTTPException:
    msg = str(e) or "Not found."
    if "role" in msg or "plan" in msg:
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


_AUDIT_TEXT = {
    "workflow_started": "Task started",
    "approval_requested": "Approval requested",
    "approval_granted": "Approved",
    "approval_rejected": "Declined",
    "approval_invalidated": "Earlier approval cancelled because the action changed",
    "approval_expired": "Approval expired",
    "input_provided": "Information provided",
    "tool_executed": "Action completed",
    "duplicate_prevented": "Duplicate action prevented",
    "guardrail_stop": "Paused",
    "workflow_retried": "Retried",
    "workflow_succeeded": "Completed",
    "workflow_failed": "Stopped",
    "workflow_cancelled": "Cancelled",
    "items_priced": "Items priced",
    "draft_edited": "Draft edited",
    "duplicate_request": "Repeated request recognised (no new task started)",
}
_TOOL_TEXT = {
    "create_customer_draft": "Customer record created", "create_quotation_draft": "Quotation draft prepared",
    "send_quotation": "Quotation sent", "record_quotation_acceptance": "Quotation acceptance confirmed",
    "create_contract_draft": "Contract draft prepared", "send_contract": "Contract sent",
    "record_contract_acceptance": "Contract marked as signed", "create_invoice_draft": "Invoice draft prepared",
    "send_invoice": "Invoice sent", "send_payment_reminder": "Payment reminder sent",
    "create_receipt": "Receipt created", "send_receipt": "Receipt sent",
}


_SPEND_TEXT = {
    "agent_classify": "Reading the enquiry", "agent_quote_draft": "Preparing the quotation", "agent_contract_draft": "Preparing the contract",
    "agent_invoice_draft": "Preparing the invoice", "agent_send": "Sending the document", "agent_reminder": "Sending the reminder",
    "agent_receipt": "Issuing the receipt", "agent_analyse": "Risk or scenario analysis", "rfq_response": "Replying to the marketplace request",
}


_PREPARED = {"receipt_send": "receipt", "payment_followup": "reminder", "enquiry_to_quote": "quotation", "quote_to_cash": "invoice"}


def _what_happened(run: dict) -> str | None:
    """A task that stopped and has since got further may still hold the text of the stop as its
    summary (tasks retried before that text was replaced on retry). It is never shown as what
    happened once the task has moved on."""
    text = run.get("summary")
    stale = isinstance(text, str) and any(m in text for m in ("stopped part-way", "Retry to carry on", "It's safe to retry", "have another go shortly"))
    if not stale or run.get("status") in ("failed", "cancelled"):
        return text
    state = run.get("state") or {}
    thing = _PREPARED.get(run.get("workflow_key"), "work")
    ref = state.get("receipt_number") or state.get("invoice_reference") or state.get("quote_reference") or ""
    named = f"{thing} {ref}".strip() if thing == "receipt" and state.get("receipt_number") else (f"{thing} for {ref}" if ref else f"the {thing}")
    if run.get("status") == "awaiting_approval":
        return f"Prepared {named} after a retry. Waiting for your approval."
    if run.get("status") == "succeeded":
        return f"Finished {named} after a retry."
    return "Picked up again after a retry and carrying on."


_DOING = {
    ("enquiry_to_quote", "classify"): "Reading the request…", ("enquiry_to_quote", "customer"): "Matching the customer…",
    ("enquiry_to_quote", "items"): "Pricing items…", ("enquiry_to_quote", "draft"): "Drafting the quotation…",
    ("enquiry_to_quote", "send"): "Sending the quotation…",
    ("new_invoice", "details"): "Matching the customer and pricing items…", ("new_invoice", "draft"): "Drafting the invoice…",
    ("new_invoice", "send"): "Getting the invoice ready to send…",
    ("new_contract", "details"): "Matching the customer…", ("new_contract", "draft"): "Drafting the contract…",
    ("new_contract", "send"): "Getting the contract ready to send…",
    ("receipt_send", "payment"): "Recording the payment…", ("receipt_send", "send"): "Preparing the receipt…",
    ("payment_followup", "check"): "Checking the invoice…", ("payment_followup", "send"): "Drafting the reminder…",
    ("quote_to_cash", "invoice_draft"): "Drafting the invoice…", ("quote_to_cash", "contract_draft"): "Drafting the contract…",
    ("new_proposal", "details"): "Matching the customer…", ("new_proposal", "draft"): "Drafting the proposal…", ("new_proposal", "send"): "Getting the proposal ready to send…",
    ("new_purchase_order", "details"): "Matching the supplier…", ("new_purchase_order", "draft"): "Drafting the purchase order…",
    ("new_purchase_order", "send"): "Getting the purchase order ready to send…",
    ("credit_note", "details"): "Checking the invoice…", ("credit_note", "draft"): "Drafting the credit note…", ("credit_note", "send"): "Getting the credit note ready to send…",
}


def _step_of(run: dict) -> dict | None:
    """Where the task is in its plan: "Step 2 of 5"."""
    wf = WORKFLOWS.get(run.get("workflow_key"))
    keys = [s.key for s in wf.steps] if wf else []
    if run.get("current_step") not in keys:
        return None
    at = keys.index(run["current_step"])
    title = wf.steps[at].title
    return {"index": at + 1, "total": len(keys), "title": title,
            # What the Agent is doing at this step, for the line shown while it works.
            "doing": _DOING.get((run["workflow_key"], run["current_step"])) or f"{title}…"}


def _public_run(run: dict) -> dict:
    """User-facing view of a run. Internal working state is not exposed (s18.3)."""
    state = run.get("state") or {}
    return {
        **{k: run.get(k) for k in ("id", "business_id", "workflow_key", "workflow_version", "capability", "family", "title",
                                   "status", "substatus", "reason_code", "goal", "source_channel", "source_reference",
                                   "recommendation_id", "current_step", "summary", "next_action", "pending_question",
                                   "error", "created_at", "updated_at", "completed_at", "requester_id")},
        "summary": _what_happened(run),
        "step": _step_of(run),
        "bucket": summary_mod.bucket_of(run),
        "retrying": run.get("status") == "failed" and summary_mod.bucket_of(run) == "active",      # the Agent is trying again itself
        "next_attempt_at": (lambda due: due.isoformat() if due else None)(get_orchestrator().next_attempt_at(run)),
        # What this task has cost so far, and what each charge was for.
        "credits_used": sum(int(c.get("credits") or 0) for c in state.get("credits") or []),
        **({"question_title": summary_mod.question_title(run)["title"], "question_detail": summary_mod.question_title(run)["detail"]} if run.get("pending_question") else {}),
        "credits": [{"what": _SPEND_TEXT.get(c.get("feature"), "Agent work"), "credits": int(c.get("credits") or 0), "at": c.get("at")}
                    for c in state.get("credits") or []],
        "email_needed": state.get("email_needed") if run.get("reason_code") == "invalid_customer_destination" else None,
        # The last change made to the draft while it waited: who, which version, and what changed.
        "last_edit": state.get("last_edit") if run.get("status") == "awaiting_approval" else None,
        "outcome": state.get("outcome") or {},
        "delivery_question": {k: (state.get("delivery_question") or {}).get(k) for k in ("tool", "to", "first_attempt_at")}
        if state.get("delivery_question") else None,
        "refs": {k: state.get(k) for k in ("enquiry_id", "quote_id", "quote_reference", "contract_id", "invoice_id", "invoice_reference") if state.get(k)},
        "steps_planned": [{"key": s.key, "title": s.title} for s in WORKFLOWS[run["workflow_key"]].steps] if run["workflow_key"] in WORKFLOWS else [],
    }


def _public_audit(a: dict) -> dict:
    d = a.get("detail") or {}
    text = _AUDIT_TEXT.get(a["event_type"], a["event_type"].replace("_", " ").capitalize())
    if a["event_type"] == "tool_executed":
        text = _TOOL_TEXT.get(d.get("tool"), text)
    return {"id": a["id"], "type": a["event_type"], "text": text, "actor": a.get("actor_id"), "at": a.get("created_at"),
            "note": d.get("message") or d.get("summary") or None}


def _result(res: dict) -> dict:
    out = dict(res)
    if out.get("run"):
        out["run"] = _public_run(out["run"])
    if out.get("runs"):
        out["runs"] = [_public_run(r) for r in out["runs"]]
    if out.get("results"):      # several requests in one message: each result in the same public shape
        out["results"] = [_result(r) for r in out["results"]]
    return out


# ── Requests (canonical AgentRequest intake) ─────────────────────────────────

class TurnIn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class AgentRequestIn(BaseModel):
    # The conversation so far in this business, oldest first. It gives a written answer its
    # context ("and what about last month?"); it never starts or authorises anything by itself.
    history: list[TurnIn] = Field(default_factory=list, max_length=40)
    business_id: str
    text: str | None = Field(default=None, max_length=8000)
    capability: str | None = Field(default=None, max_length=64)
    source_channel: str = Field(default="text", max_length=32)
    source_reference: str | None = Field(default=None, max_length=200)
    recommendation_id: str | None = Field(default=None, max_length=200)
    params: dict[str, Any] = Field(default_factory=dict)
    transcript_confidence: float | None = None
    confirmed: bool = False
    locale: str = "en-GB"
    background: bool = False      # return as soon as the task exists; the caller watches it


@router.post("/agent/requests")
async def submit_request(body: AgentRequestIn, user=Depends(get_current_user)):
    """One entry point for the Assistant, dashboard actions, events and future voice (s4, s8)."""
    if body.source_channel not in USER_CHANNELS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "channel_not_allowed",
            "message": "That request channel is reserved for system integrations.",
        })
    from app.shared import people
    called = people.call_me(body.text) if body.text and not body.capability else None
    if called:
        from app.core.supabase import sb_update
        try:
            await sb_update("users", filters=[("id", "eq", user["id"])], payload={"name": called["full_name"]})
            try:
                await sb_update("users", filters=[("id", "eq", user["id"])], payload={"first_name": called["first_name"]})
            except Exception:      # noqa: BLE001 - before migration 040: the name itself is saved
                pass
        except Exception:      # noqa: BLE001
            return _result({"kind": "answer", "message": "I couldn't save that just now. Please try again in a moment."})
        return _result({"kind": "answer", "message": f"Got it, I'll call you {called['first_name']}.", "first_name": called["first_name"], "full_name": called["full_name"]})
    try:
        res = await get_orchestrator().submit(AgentRequest(
            requesting_actor_id=user["id"], business_id=body.business_id, source_channel=body.source_channel,
            source_reference=body.source_reference, raw_input=body.text, requested_capability=body.capability,
            params=body.params, transcript_confidence=body.transcript_confidence, confirmed=body.confirmed,
            locale=body.locale, recommendation_id=body.recommendation_id, background=body.background,
        ), email=user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    if res.get("kind") == "assistant" and (body.text or "").strip():
        res = await _converse(user, body)
    return _result(res)


async def _converse(user: dict, body: AgentRequestIn) -> dict:
    """No task fits and the records don't answer it directly: the Agent answers in writing, from
    this business's labelled, plan-masked records and the conversation so far. This is the one
    place a model writes the reply, and the one place a chat answer is charged."""
    from app.modules.business_assistant.schemas import BusinessAssistantChatRequest
    from app.modules.business_assistant.service import chat_about_business
    turns = [{"role": t.role, "content": t.content} for t in body.history[-18:]] + [{"role": "user", "content": body.text.strip()}]
    try:
        out = await chat_about_business(user_id=user["id"], payload=BusinessAssistantChatRequest(messages=turns, workspace_id=body.business_id))
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, dict) else {}
        why = detail.get("error")
        if e.status_code == 402:
            if why == "INSUFFICIENT_CREDITS":
                return {"kind": "blocked", "reason_codes": ["credits_exhausted"], "upgrade": True,
                        "message": f"You're out of AI Credits: a written answer needs {detail.get('required', 2)} and you have {detail.get('available', 0)}. "
                                   "Nothing was charged. Top up or upgrade and ask again."}
            return {"kind": "blocked", "reason_codes": ["pricing_unavailable"], "upgrade": False,
                    "message": "Written answers aren't available right now because their price isn't set up. Nothing was charged; please tell support."}
        if e.status_code in (403, 404):
            raise
        return {"kind": "answer", "message": "I couldn't write an answer just now. Nothing was charged; please ask again."}
    except Exception:      # noqa: BLE001 - the model or its provider failed: the held credits were released
        logger.warning("agent written answer failed", exc_info=True)
        return {"kind": "answer", "message": "I couldn't write an answer just now. Nothing was charged; please ask again."}
    return {"kind": "answer", "message": out.answer, "conversational": True}


class StartWorkflowIn(BaseModel):
    workflow_key: str
    params: dict[str, Any] = Field(default_factory=dict)
    source_channel: str = "ui_action"
    source_reference: str | None = None
    recommendation_id: str | None = None


@router.post("/businesses/{business_id}/workflows")
async def start_workflow(business_id: str, body: StartWorkflowIn, user=Depends(get_current_user)):
    if body.workflow_key not in WORKFLOWS:
        raise HTTPException(status_code=400, detail="Unknown workflow.")
    return await submit_request(AgentRequestIn(
        business_id=business_id, capability=body.workflow_key, params=body.params, source_channel=body.source_channel,
        source_reference=body.source_reference, recommendation_id=body.recommendation_id), user=user)


# ── Runs ─────────────────────────────────────────────────────────────────────

@router.get("/workflow-runs/{run_id}")
async def read_run(run_id: str, user=Depends(get_current_user)):
    _known_id(run_id)
    orch = get_orchestrator()
    # Everything the page shows, fetched together rather than one after another (nothing is
    # returned until the access check below has passed).
    first = await asyncio.gather(orch.rt.store.get_run(run_id), orch.rt.store.list_steps(run_id), orch.rt.store.list_approvals(run_id=run_id),
                                 orch.rt.store.list_audit(run_id), return_exceptions=True)
    if isinstance(first[0], dict) and first[0].get("business_id"):
        await asyncio.gather(orch.rt.store.get_policy(first[0]["business_id"]), orch.rt.business.record(first[0]["business_id"]), return_exceptions=True)
    try:
        run, actor = await orch._owned_run(run_id, user["id"], user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    # An open task reads as it should now: its question re-checked against the profile, and its
    # messages built from its records as they are, not from the sentence stored when it stopped.
    from app.modules.agent import current
    stored = run
    run = (await current.open_runs(orch, run["business_id"], [run], recheck=True))[0]
    now = orch.rt.clock()
    steps = current.refresh_steps(await orch.rt.store.list_steps(run_id), stored, run)
    approvals = await orch.rt.store.list_approvals(run_id=run_id)
    audit = await orch.rt.store.list_audit(run_id)
    attempts = [{k: s.get(k) for k in ("id", "seq", "step_key", "title", "state", "note", "error", "started_at", "finished_at")}
                | {"external": bool(s.get("external_ref"))} for s in sorted(steps, key=lambda s: s.get("seq") or 0)]
    latest: dict[str, dict] = {}
    for s in attempts:      # one entry per step: its latest state (full detail stays in the history)
        latest[s["step_key"]] = s
    order = list(dict.fromkeys(s["step_key"] for s in attempts))
    waiting_tool = next((a.get("tool_id") for a in approvals if a.get("status") == "pending"), None)
    can_edit = actor.can_prepare and run["status"] == "awaiting_approval" and waiting_tool in orch.EDITABLE_TOOLS
    await orch.pick_up(run)      # started in the background and left mid-step by a restart: carried on from here
    options = None
    if can_edit:
        # What the editor offers: the catalogue with its prices, and the customers on record.
        from app.modules.agent.tools import product_price
        record = await orch.rt.business.load(run["business_id"])
        cat = record.get("catalogue") or {}
        options = {
            "catalogue": [{"id": p.get("id"), "name": p.get("name"), "unit_price": product_price(p)} for p in cat.get("products") or [] if isinstance(p, dict) and p.get("name")],
            "customers": [{"id": c.get("id"), "name": c.get("name"), "email": c.get("email") or ""} for c in cat.get("customers") or [] if isinstance(c, dict) and c.get("id") and c.get("name")],
            "edited_by_you": ((run.get("state") or {}).get("last_edit") or {}).get("by") == user["id"],
            "document": {"send_quotation": "quotation", "send_invoice": "invoice", "send_contract": "contract",
                         "send_payment_reminder": "reminder", "send_receipt": "receipt", "send_proposal": "proposal",
                         "send_purchase_order": "purchase_order", "send_credit_note": "credit_note"}[waiting_tool],
            "wording": (run.get("state") or {}).get("document_edits") or {},
        }
    return {
        "run": _public_run(run),
        "draft_options": options,
        "steps": [latest[k] for k in order],
        "step_attempts": attempts,
        "messages_sent": sum(1 for s in attempts if s["external"]),
        "approvals": [{**{k: a.get(k) for k in ("id", "title", "tool_id", "payload", "payload_version", "status", "requester_id",
                                                "approver_id", "decided_at", "decided_note", "expires_at", "created_at")},
                       **summary_mod.approval_card(a, now)} for a in approvals],
        "history": [_public_audit(a) for a in audit if a["event_type"] != "guardrail_decision"],
        "can": {"approve": actor.can_send, "answer": actor.can_prepare, "retry": actor.can_prepare,
                "confirm_delivery": actor.can_send and run["status"] == "failed" and run.get("reason_code") == "delivery_unconfirmed",
                "fix_customer_email": actor.can_prepare and run["status"] == "failed" and run.get("reason_code") == "invalid_customer_destination",
                "cancel": actor.is_owner or (actor.can_prepare and run["requester_id"] == user["id"]),
                "edit_draft": can_edit},
    }


class ApprovalDecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/workflow-runs/{run_id}/approvals/{approval_id}/approve")
async def approve_action(run_id: str, approval_id: str, body: ApprovalDecisionIn | None = None, user=Depends(get_current_user)):
    _known_id(run_id, approval_id)
    try:
        res = await get_orchestrator().decide_approval(run_id, approval_id, user["id"], True, (body.note if body else None), user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"run": _public_run(res["run"]), "changed": res["changed"], "message": res.get("message")}


@router.post("/workflow-runs/{run_id}/approvals/{approval_id}/reject")
async def reject_action(run_id: str, approval_id: str, body: ApprovalDecisionIn | None = None, user=Depends(get_current_user)):
    _known_id(run_id, approval_id)
    try:
        res = await get_orchestrator().decide_approval(run_id, approval_id, user["id"], False, (body.note if body else None), user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"run": _public_run(res["run"]), "changed": res["changed"], "message": res.get("message")}


class DraftEditIn(BaseModel):
    items: list[dict[str, Any]] | None = None       # [{name, quantity, unit_price, product_id?}]
    vat_rate: float | None = None
    notes: str | None = Field(default=None, max_length=2000)
    customer_id: str | None = Field(default=None, max_length=80)
    customer_email: str | None = Field(default=None, max_length=254)
    valid_until: str | None = Field(default=None, max_length=10)       # YYYY-MM-DD
    payment_terms_days: int | None = None
    discount: dict[str, Any] | None = None           # {"type": "percent" | "amount", "value": n}; value 0 removes it
    due_date: str | None = Field(default=None, max_length=10)          # invoices
    description: str | None = Field(default=None, max_length=4000)     # contracts: what is agreed
    total: float | None = None                       # contracts: the value
    problem: str | None = Field(default=None, max_length=4000)         # proposals
    solution: str | None = Field(default=None, max_length=6000)
    timeline: str | None = Field(default=None, max_length=200)
    delivery_date: str | None = Field(default=None, max_length=10)     # purchase orders
    reason: str | None = Field(default=None, max_length=500)           # credit notes
    refund_amount: float | None = None
    message: str | None = Field(default=None, max_length=1500)         # reminders and receipts: the owner's own wording
    amount_requested: float | None = None            # reminders: the amount asked for now


@router.post("/workflow-runs/{run_id}/draft")
async def edit_draft(run_id: str, body: DraftEditIn, user=Depends(get_current_user)):
    """Edit draft while it waits for approval: creates a new payload version and invalidates
    the pending approval, which must then be approved again (AC-09)."""
    _known_id(run_id)
    try:
        run = await get_orchestrator().edit_draft(run_id, user["id"], body.model_dump(exclude_unset=True), user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"run": _public_run(run)}


class RunInputIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    background: bool = False


@router.post("/workflow-runs/{run_id}/input")
async def answer_run(run_id: str, body: RunInputIn, user=Depends(get_current_user)):
    _known_id(run_id)
    try:
        return {"run": _public_run(await get_orchestrator().provide_input(run_id, user["id"], body.answers, user.get("email"), background=body.background))}
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)


class CustomerEmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)


@router.post("/workflow-runs/{run_id}/customer-email")
async def fix_customer_email(run_id: str, body: CustomerEmailIn, user=Depends(get_current_user)):
    """A task stopped for want of a usable customer email: save one and carry on."""
    _known_id(run_id)
    try:
        run = await get_orchestrator().fix_customer_email(run_id, user["id"], body.email, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"run": _public_run(run)}


class DeliveryDecisionIn(BaseModel):
    outcome: str      # delivered | resend


@router.post("/workflow-runs/{run_id}/delivery")
async def resolve_delivery(run_id: str, body: DeliveryDecisionIn, user=Depends(get_current_user)):
    """After an unconfirmed send that is too old to retry: was it delivered, or send it again?"""
    _known_id(run_id)
    try:
        run = await get_orchestrator().resolve_delivery(run_id, user["id"], body.outcome.strip().lower(), user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"run": _public_run(run)}


class InvoiceStateIn(BaseModel):
    state: str                                              # disputed | voided | cancelled | credited | reopen
    reason: str | None = Field(default=None, max_length=500)
    date: str | None = None                                 # YYYY-MM-DD; today when omitted


@router.post("/businesses/{business_id}/invoices/{invoice_id}/state")
async def set_invoice_state(business_id: str, invoice_id: str, body: InvoiceStateIn, user=Depends(get_current_user)):
    """Mark an invoice disputed, voided, cancelled or credited, or reopen it."""
    try:
        invoice = await get_orchestrator().set_invoice_state(business_id, invoice_id, user["id"], body.state.strip().lower(),
                                                             body.reason, body.date, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"invoice": invoice}


@router.post("/workflow-runs/{run_id}/cancel")
async def cancel_run(run_id: str, user=Depends(get_current_user)):
    _known_id(run_id)
    try:
        return {"run": _public_run(await get_orchestrator().cancel(run_id, user["id"], user.get("email")))}
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)


@router.post("/workflow-runs/{run_id}/retry")
async def retry_run(run_id: str, user=Depends(get_current_user)):
    _known_id(run_id)
    try:
        return {"run": _public_run(await get_orchestrator().retry(run_id, user["id"], user.get("email")))}
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)


# ── Business-scoped views ────────────────────────────────────────────────────

PAGE_SIZE = 10      # rows in a page of any list (tasks, documents); the pages on screen use the same number


def _page(limit: int | None, offset: int, page: int | None) -> tuple[int | None, int]:
    """?page=3 means the third page of PAGE_SIZE rows; an explicit limit/offset is taken as given."""
    if page is None:
        return limit, offset
    size = limit or PAGE_SIZE
    return size, (page - 1) * size


_DOCUMENT_KINDS = (
    # (kind, label, where it is kept, the task-state key that points at it)
    ("quotation", "Quotation", None, "quote_id"), ("invoice", "Invoice", "invoices", "invoice_id"), ("contract", "Contract", "contracts", "contract_id"),
    ("proposal", "Proposal", "proposals", "document_id"), ("purchase_order", "Purchase order", "purchase_orders", "document_id"),
    ("credit_note", "Credit note", "credit_notes", "document_id"),
)
_DOCUMENT_STATUS = {"draft": "Draft", "sent": "Sent", "viewed": "Viewed", "accepted": "Accepted", "won": "Accepted", "declined": "Declined", "lost": "Declined",
                    "paid": "Paid", "pending": "Sent, awaiting signature", "signed": "Signed", "credited": "Credited", "void": "Voided", "voided": "Voided",
                    "cancelled": "Cancelled", "canceled": "Cancelled", "disputed": "Disputed", "expired": "Expired", "overdue": "Overdue", "partial": "Part paid"}
# The same stored word means different things on different documents: a contract that is "pending"
# is out for signature, an invoice that is "pending" is waiting to be paid.
_STATUS_BY_KIND = {
    "invoice": {"pending": "Awaiting payment", "unpaid": "Awaiting payment", "partially_paid": "Part paid", "signed": "Sent"},
    "quotation": {"pending": "Sent, awaiting reply", "signed": "Accepted"},
    "proposal": {"pending": "Sent, awaiting reply", "signed": "Accepted"},
    "purchase_order": {"pending": "Sent to supplier", "sent": "Sent to supplier", "signed": "Confirmed"},
    "credit_note": {"pending": "Issued", "sent": "Sent"},
}


def _document_reference(kind: str, rec: dict, data: dict) -> str:
    """The number the document is known by everywhere else: never a bare record id."""
    if kind == "invoice":
        from app.modules.agent import current
        number = current.document_number(rec, data, {"invoice_id": rec.get("id")})
        if number:
            return number
    stored = str(rec.get("reference") or rec.get("quotation_id") or rec.get("invoice_number") or "").strip()
    if stored:
        return stored
    # No number was ever given: named as Business Operations names it.
    prefix = {"quotation": "QUO", "invoice": "INV", "contract": "CON", "proposal": "PRO", "purchase_order": "PO", "credit_note": "CN"}[kind]
    return f"{prefix}-{str(rec['id'])[:8].upper()}"


@router.get("/businesses/{business_id}/agent/documents")
async def list_documents(
    business_id: str,
    only: str | None = Query(default=None, alias="kind"),       # quotation | invoice | contract | proposal | purchase_order | credit_note | receipt
    search: str | None = Query(default=None, alias="q", max_length=120),      # words to find in the number, party, status or amount
    order: str = Query(default="newest"),                       # newest | oldest (by the document's date)
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    page: int | None = Query(default=None, ge=1),               # or a page number: PAGE_SIZE rows each
    user=Depends(get_current_user),
):
    """Every quotation, invoice, contract, proposal, purchase order, credit note and receipt on
    record, newest first, with its status, the task that is handling it and whether its draft
    can be edited now."""
    limit, offset = _page(limit, offset, page)
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    from app.modules.agent import business as bz
    from app.modules.agent.tools import _currency
    data, runs, (pending, _awaiting) = await asyncio.gather(
        orch.visible_data(business_id), orch.rt.store.list_runs(business_id, limit=500),
        summary_mod.waiting_for_approval(orch.rt.store, business_id, orch.rt.clock()))
    fin = data.get("financials") or {}
    waiting = {a["run_id"]: a for a in pending}
    items: list[dict] = []

    def task_for(key: str, record: dict) -> dict | None:
        """The task handling this document: one waiting for approval first, else the newest."""
        mine = [r for r in runs if str((r.get("state") or {}).get(key) or "") == str(record.get("id")) or (record.get("agent_run_id") and r["id"] == record.get("agent_run_id"))]
        mine.sort(key=lambda r: (r["id"] in waiting, r.get("created_at") or ""), reverse=True)
        return mine[0] if mine else None

    for kind, label, collection, key in _DOCUMENT_KINDS:
        records = bz.quotes_of(data) if kind == "quotation" else [r for r in fin.get(collection) or [] if isinstance(r, dict)]
        for rec in records:
            if rec.get("archived") or not rec.get("id"):
                continue
            run = task_for(key, rec)
            approval = waiting.get(run["id"]) if run else None
            # Only the approval for this very document counts (a quote-to-invoice task has several documents over its life).
            if approval and str((approval.get("payload") or {}).get({"quotation": "quote_id", "invoice": "invoice_id", "contract": "contract_id", "proposal": "proposal_id",
                                                                    "purchase_order": "purchase_order_id", "credit_note": "credit_note_id"}[kind]) or "") != str(rec["id"]):
                approval = None
            hold = bz.invoice_hold(rec) if kind == "invoice" else None
            status = (hold or {}).get("state") or bz.status_of(rec) or "draft"
            if kind == "invoice" and status == "sent" and bz.invoice_outstanding(rec) > 0 and (bz.parse_day(rec.get("due_date")) or orch.rt.clock().date()) < orch.rt.clock().date():
                status = "overdue"
            items.append({
                "kind": kind, "kind_label": label, "id": rec["id"], "reference": _document_reference(kind, rec, data),
                "party": rec.get("customer_name") or rec.get("party_name") or rec.get("recipient") or "", "total": bz.invoice_total(rec), "currency": _currency(rec, data),
                "status": "awaiting_approval" if approval else status,
                "status_label": "Waiting for your approval" if approval else (_STATUS_BY_KIND.get(kind, {}).get(status)
                                                                                  or _DOCUMENT_STATUS.get(status, status.replace("_", " ").capitalize())),
                "date": str(rec.get("issued_at") or rec.get("created_at") or "")[:10], "updated_at": rec.get("updated_at") or rec.get("created_at"),
                "run_id": run["id"] if run else None, "approval_id": approval["id"] if approval else None,
                "can_edit": bool(approval and actor.can_prepare and approval.get("tool_id") in orch.EDITABLE_TOOLS),
                "from_agent": bool(rec.get("agent_run_id") or run),
            })
    # Receipts are issued against payments on invoices.
    for inv in fin.get("invoices") or []:
        for p in (inv.get("payments") or []) if isinstance(inv, dict) and not inv.get("archived") else []:
            receipt = (p or {}).get("receipt") or {}
            if not receipt.get("number"):
                continue
            run = next((r for r in sorted(runs, key=lambda r: (r["id"] in waiting, r.get("created_at") or ""), reverse=True)
                        if str((r.get("state") or {}).get("invoice_id") or "") == str(inv.get("id")) and r.get("workflow_key") in ("receipt_send", "quote_to_cash", "new_invoice")), None)
            approval = waiting.get(run["id"]) if run else None
            if approval and (approval.get("payload") or {}).get("receipt_number") != receipt["number"]:
                approval = None
            sent = bool(receipt.get("sent_at"))
            items.append({
                "kind": "receipt", "kind_label": "Receipt", "id": f"{inv.get('id')}:{p.get('id')}", "reference": receipt["number"], "party": inv.get("customer_name") or "",
                "total": bz.money(p.get("amount")), "currency": _currency(inv, data), "status": "awaiting_approval" if approval else ("sent" if sent else "draft"),
                "status_label": "Waiting for your approval" if approval else ("Sent" if sent else "Issued, not sent"),
                "date": str(receipt.get("issued_at") or receipt.get("created_at") or p.get("paid_at") or "")[:10],
                "updated_at": receipt.get("sent_at") or receipt.get("issued_at") or receipt.get("created_at") or p.get("paid_at"),
                "run_id": run["id"] if run else None, "approval_id": approval["id"] if approval else None,
                "can_edit": bool(approval and actor.can_prepare), "from_agent": bool(run),
            })
    # Waiting for approval first; then newest first by the document's own date (its last change breaks a tie).
    items.sort(key=lambda d: (d["status"] == "awaiting_approval", str(d.get("date") or ""), str(d.get("updated_at") or "")), reverse=True)
    # A number held by two documents of a kind is said, so it can be put right (it should never happen for new ones).
    held: dict[tuple[str, str], int] = {}
    for d in items:
        held[(d["kind"], d["reference"].upper())] = held.get((d["kind"], d["reference"].upper()), 0) + 1
    for d in items:
        d["duplicate_number"] = held[(d["kind"], d["reference"].upper())] > 1
    counts: dict[str, int] = {}
    for d in items:
        counts[d["kind"]] = counts.get(d["kind"], 0) + 1
    everything = len(items)
    if only:
        items = [d for d in items if d["kind"] == only]
    words = [w for w in str(search or "").lower().split() if w]
    if words:
        items = [d for d in items if all(w in f"{d['kind_label']} {d['reference']} {d['party']} {d['status_label']} {d['total']}".lower() for w in words)]
    if order == "oldest":      # what waits for approval still leads; the rest oldest first
        items.sort(key=lambda d: (d["status"] != "awaiting_approval", str(d.get("date") or ""), str(d.get("updated_at") or "")))
    if limit is not None:
        # `total` is what matches the filter and search; `all_total` and `counts` are every document, for the tab and the type list.
        return {"items": items[offset:offset + limit], "counts": counts, "total": len(items), "all_total": everything, "limit": limit, "offset": offset,
                "kinds": [{"key": k, "label": l} for k, l, _c, _s in _DOCUMENT_KINDS] + [{"key": "receipt", "label": "Receipt"}]}
    return {"items": items[:300], "counts": counts, "total": len(items), "all_total": everything,
            "kinds": [{"key": k, "label": l} for k, l, _c, _s in _DOCUMENT_KINDS] + [{"key": "receipt", "label": "Receipt"}]}


@router.get("/businesses/{business_id}/agent/summary")
async def agent_summary(business_id: str, user=Depends(get_current_user)):
    try:
        s = await summary_mod.build_summary(get_orchestrator(), user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    s["active_runs"] = [_public_run(r) for r in s["active_runs"]]
    try:      # the greeting's figures: never a reason for the summary to fail
        s["briefing"] = await _briefing(user, business_id, s.get("needs_approval_count") or 0)
        s.update({k: s["briefing"][k] for k in ("done_since_last_visit", "needs_input_count")})
    except Exception:      # noqa: BLE001
        logger.warning("agent: the briefing could not be built for %s", business_id, exc_info=True)
    _look_for_work(business_id)
    return s


async def _person(user: dict) -> dict:
    """The signed-in person as stored now (the sign-in cache may be minutes old): their name and when they were last here."""
    from app.core.supabase import sb_select
    try:
        row = await sb_select("users", filters=[("id", "eq", user["id"])], single=True) or {}
    except Exception:      # noqa: BLE001
        row = {}
    name = (str(row.get("name") or user.get("name") or "").strip().split(" ") or [""])[0] or str(row.get("first_name") or "").strip()
    if "@" in name:
        name = str(row.get("first_name") or "").strip()
    return {"first_name": name or None, "last_seen_at": row.get("last_seen_at"), "timezone": row.get("timezone") or None}


async def _briefing(user: dict, business_id: str, needs_approval: int) -> dict:
    orch = get_orchestrator()
    who = await _person(user)
    runs = await orch.rt.store.list_runs(business_id, limit=200)
    out = summary_mod.briefing_of(runs, since=who["last_seen_at"], needs_approval=needs_approval, now=orch.rt.clock())
    return {**out, "first_name": who["first_name"], "timezone": who["timezone"]}


@router.get("/businesses/{business_id}/agent/briefing")
async def agent_briefing(business_id: str, user=Depends(get_current_user)):
    """What the Agent's card greets the owner with: their first name, what was done since they were last here, and what is waiting."""
    try:
        orch = get_orchestrator()
        actor, _ = await orch.actor_for(user["id"], business_id, user.get("email"))
        if not actor.can_view:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this business.")
        pending = await summary_mod.pending_approvals(orch.rt.store, business_id, orch.rt.clock())
    except AccessDenied as e:
        raise _denied(e)
    return await _briefing(user, business_id, len(pending) if (actor.can_send or actor.can_prepare) else 0)


@router.post("/agent/seen")
async def agent_seen(user=Depends(get_current_user)):
    """The owner has been on the dashboard a while, or is leaving it: from now, "while you were away" counts from here."""
    from datetime import datetime, timezone
    from app.core.supabase import sb_update
    now = datetime.now(timezone.utc).isoformat()
    try:
        await sb_update("users", filters=[("id", "eq", user["id"])], payload={"last_seen_at": now})
    except Exception:      # noqa: BLE001 - before migration 040 there is nowhere to keep it
        return {"saved": False}
    return {"saved": True, "last_seen_at": now}


def _look_for_work(business_id: str) -> None:
    """The owner has opened the app: have the Agent check, in the background, whether the records
    call for a task it hasn't started (an invoice that fell overdue overnight). Never slows the page."""
    try:
        from app.modules.agent import autostart
        autostart.later(business_id)
    except Exception:      # noqa: BLE001
        pass


# ── Adaptive Dashboard (PRD-AD-001) ──────────────────────────────────────────

def _dashboard_on() -> bool:
    from app.core.config import get_settings
    return bool(get_settings().adaptive_dashboard_enabled)


@router.get("/businesses/{business_id}/dashboard")
async def adaptive_dashboard(business_id: str, preview_pathway: str | None = Query(default=None),
                             preview_stage: str | None = Query(default=None), user=Depends(get_current_user)):
    """One composed view: context, financial summary, adaptive insights, Agent summary,
    pending approvals, freshness and entitlement."""
    from app.modules.agent import dashboard as dash
    if not _dashboard_on():
        return {"enabled": False}
    try:
        # `preview_stage=idea|pre_launch|operating|growth` (or `preview_pathway=startup|small_business`)
        # lets QA see another stage's dashboard for this business. Ignored in production.
        from app.core.config import get_settings
        production = str(get_settings().environment or "").lower() in ("production", "prod")
        d = await dash.build_dashboard(get_orchestrator(), user["id"], business_id, user.get("email"),
                                       preview_pathway=None if production else preview_pathway,
                                       preview_stage=None if production else preview_stage)
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    d["agent"]["active_runs"] = [_public_run(r) for r in d["agent"]["active_runs"]]
    return d


class DashboardPreferenceIn(BaseModel):
    current_goal: str | None = None
    clear_goal: bool = False
    pinned_widget_ids: list[str] | None = Field(default=None, max_length=10)
    hidden_widget_ids: list[str] | None = Field(default=None, max_length=10)


@router.put("/businesses/{business_id}/dashboard/preferences")
async def save_dashboard_preferences(business_id: str, body: DashboardPreferenceIn, user=Depends(get_current_user)):
    """What this user wants to see first. Presentation only: no score or record changes."""
    from app.modules.agent import dashboard as dash
    orch = get_orchestrator()
    try:
        await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    patch: dict[str, Any] = {}
    if body.clear_goal:
        patch["current_goal"] = None
    elif "current_goal" in body.model_fields_set:      # sent as null or "" = no goal
        patch["current_goal"] = (body.current_goal or "").strip().lower() or None
    for key in ("pinned_widget_ids", "hidden_widget_ids"):
        if getattr(body, key) is not None:
            patch[key] = getattr(body, key)
    now = orch.rt.clock()
    saved: dict[str, Any] = {}

    def _apply(data: dict) -> None:
        if not isinstance(data.get("dashboard_preferences"), dict):
            data["dashboard_preferences"] = {}
        current = data["dashboard_preferences"].get(str(user["id"])) or {}
        data["dashboard_preferences"][str(user["id"])] = dash.clean_preferences(patch, current, now)
        saved.update(data["dashboard_preferences"][str(user["id"])])
    try:
        await orch.rt.business.mutate(business_id, _apply)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"preferences": saved}


class DashboardStageIn(BaseModel):
    stage: str | None = None      # idea | pre_launch | operating | growth; null or "auto" = read it from the records


@router.put("/businesses/{business_id}/dashboard/stage")
async def set_dashboard_stage(business_id: str, body: DashboardStageIn, user=Depends(get_current_user)):
    """"Not right? Change it": the stage the dashboard is composed for. It changes what the
    dashboard shows, not any business record, and every change is audited."""
    from app.modules.agent import dashboard as dash
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    if not actor.can_prepare:
        raise HTTPException(status_code=403, detail="Your role can't change the business stage.")
    try:
        stage = dash.clean_stage(body.stage)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    now = orch.rt.clock()
    change: dict[str, Any] = {}

    def _apply(data: dict) -> None:
        before = dash.stage_of(data, now)
        if stage is None:
            data.pop("dashboard_stage", None)
        else:
            data["dashboard_stage"] = {"stage": stage, "set_by": user["id"], "set_at": now.isoformat()}
        after = dash.stage_of(data, now)
        change.update({"from": before["stage"], "from_source": before["source"], "to": after["stage"], "to_source": after["source"],
                       "detected": after["detected"]})
    await orch.rt.business.mutate(business_id, _apply)
    await orch.rt.store.audit({
        "id": new_id(), "business_id": business_id, "run_id": None, "actor_id": user["id"],
        "event_type": "dashboard_stage_changed", "detail": change, "created_at": now.isoformat(),
    })
    return {"stage": change["to"], "source": change["to_source"], "detected": change["detected"]}


_DASHBOARD_EVENTS = {"dashboard_viewed", "insight_opened", "insight_action", "insight_why_opened", "goal_changed",
                     "tool_opened", "report_opened", "upgrade_clicked", "stage_changed", "action_card_opened"}


class DashboardEventIn(BaseModel):
    type: str = Field(max_length=40)
    widget_id: str | None = Field(default=None, max_length=60)
    detail: dict[str, Any] | None = None


@router.post("/businesses/{business_id}/dashboard/events", status_code=202)
async def dashboard_event(business_id: str, body: DashboardEventIn, user=Depends(get_current_user)):
    """Usage signals for the dashboard's metrics (s15). Best-effort: never an error for the page."""
    orch = get_orchestrator()
    try:
        await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    if body.type not in _DASHBOARD_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown dashboard event.")
    detail = {k: v for k, v in (body.detail or {}).items() if isinstance(v, (str, int, float, bool)) or v is None}
    try:
        await orch.rt.store.emit_event({
            "id": new_id(), "business_id": business_id, "type": "Dashboard." + body.type, "schema_version": 1,
            "run_id": None, "correlation_id": None, "causation_id": None,
            "payload": {"widget_id": body.widget_id, "actor_id": user["id"], **dict(list(detail.items())[:10])},
            "created_at": orch.rt.clock().isoformat(),
        })
    except Exception:      # noqa: BLE001
        pass
    return {"accepted": True}


@router.get("/businesses/{business_id}/agent/integrity")
async def agent_integrity(business_id: str, user=Depends(get_current_user)):
    """Receipts that were approved and sent but are missing from the books, and receipt
    numbers that reached more than one payment."""
    from app.modules.agent import integrity
    orch = get_orchestrator()
    try:
        actor = await orch.rt.business.actor(user["id"], business_id, await orch.rt.store.get_policy(business_id), user.get("email"))
    except Exception as e:      # noqa: BLE001 - unknown business or no access
        raise _denied(e)
    if not actor.can_send:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your role can't view this check.")
    issues = await integrity.check_business(orch.rt, business_id)
    return {"ok": not issues, "issues": issues}


@router.get("/businesses/{business_id}/agent/metrics")
async def agent_metrics(business_id: str, user=Depends(get_current_user)):
    """Adoption, quality, reliability, speed, safety, economics and conversion (s23)."""
    try:
        return await summary_mod.build_metrics(get_orchestrator(), user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)


@router.get("/businesses/{business_id}/approvals")
async def list_approvals(business_id: str, status_: str = Query(default="pending", alias="status"), user=Depends(get_current_user)):
    orch = get_orchestrator()
    try:
        actor, _ = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    if not (actor.can_send or actor.can_prepare):
        return {"items": []}      # only people who can act on approvals see them (AC-29)
    now = orch.rt.clock()
    if status_ == "pending":
        rows = await summary_mod.pending_approvals(orch.rt.store, business_id, now)
    else:
        rows = await orch.rt.store.list_approvals(business_id=business_id, status=status_)
    items = sorted(({**summary_mod.approval_card(a, now), "status": a["status"], "full_title": a.get("title")} for a in rows),
                   key=lambda c: c.get("created_at") or "", reverse=True)
    return {"items": items, "count": len(items)}


@router.get("/businesses/{business_id}/workflow-runs")
async def list_runs(
    business_id: str,
    bucket: str | None = Query(default=None),          # active | needs_approval | needs_attention | completed | history
    capability: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=200),      # a page: with it, only these rows are returned
    offset: int = Query(default=0, ge=0),
    page: int | None = Query(default=None, ge=1),               # or a page number: PAGE_SIZE rows each
    user=Depends(get_current_user),
):
    limit, offset = _page(limit, offset, page)
    orch = get_orchestrator()
    try:
        await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    from app.modules.agent import current
    # Needs Approval is the same query the dashboard uses. A task waiting for approval is always
    # listed, however many newer tasks there are, so the two can never show different numbers.
    listed, (pending, awaiting) = await asyncio.gather(orch.rt.store.list_runs(business_id, limit=500),
                                                       summary_mod.waiting_for_approval(orch.rt.store, business_id, orch.rt.clock()))
    have = {r["id"] for r in listed}
    raw_runs = await current.open_runs(orch, business_id, [r for r in awaiting if r["id"] not in have] + listed, recheck=True)
    waiting = {a["run_id"] for a in pending}
    runs = []
    for r in raw_runs:
        pr = _public_run(r)
        # A run counts as needing approval only while it has a live pending approval (the
        # same definition the dashboard uses); one whose approval has lapsed needs attention.
        if pr["bucket"] == "needs_approval" and r["id"] not in waiting:
            pr["bucket"] = "needs_attention"
        runs.append(pr)
    counts: dict[str, int] = {}
    for r in runs:
        counts[r["bucket"]] = counts.get(r["bucket"], 0) + 1
    counts["history"] = len(runs)      # every task: what the History tab's number is, whatever page is showing
    if bucket and bucket != "history":
        runs = [r for r in runs if r["bucket"] == bucket]
    if capability:
        runs = [r for r in runs if r["capability"] == capability]
    if status_:
        runs = [r for r in runs if r["status"] == status_]
    if date_from:
        runs = [r for r in runs if (r["created_at"] or "") >= date_from]
    if date_to:
        runs = [r for r in runs if (r["created_at"] or "")[:10] <= date_to[:10]]
    if limit is not None:
        # One page of what was asked for. `total` is everything that matches; `counts` is every task by tab.
        return {"items": runs[offset:offset + limit], "counts": counts, "total": len(runs), "limit": limit, "offset": offset}
    # What needs the owner is never cut off by the page size.
    first = [r for r in runs if r["bucket"] in ("needs_approval", "needs_attention")]
    rest = [r for r in runs if r["bucket"] not in ("needs_approval", "needs_attention")]
    keep = {r["id"] for r in (first + rest)[:max(200, len(first))]}
    return {"items": [r for r in runs if r["id"] in keep], "counts": counts}


class EnquiryIn(BaseModel):
    body: str = Field(min_length=3, max_length=8000)
    sender_name: str | None = Field(default=None, max_length=160)
    sender_email: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=200)
    source: str = Field(default="manual", max_length=32)


@router.post("/businesses/{business_id}/enquiries")
async def submit_enquiry(business_id: str, body: EnquiryIn, user=Depends(get_current_user)):
    """Hand the Agent a customer enquiry (pasted, or forwarded by an authorised integration)."""
    return await submit_request(AgentRequestIn(
        business_id=business_id, capability="enquiry_to_quote",
        source_channel="ui_action",      # user-authenticated; the original source is kept below
        params={"body": body.body, "sender_name": body.sender_name or "", "sender_email": body.sender_email or "",
                "subject": body.subject or "", "source": body.source}), user=user)


class BusinessEventIn(BaseModel):
    record_type: str            # invoice | quote | contract
    record_id: str


@router.post("/businesses/{business_id}/agent/events")
async def business_event(business_id: str, body: BusinessEventIn, user=Depends(get_current_user)):
    """A record changed (payment recorded, contract signed...): wake any workflow waiting on it."""
    orch = get_orchestrator()
    try:
        await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    return {"woken": await orch.notify(business_id, body.record_type, body.record_id)}


@router.post("/businesses/{business_id}/agent/wake")
async def wake_business(business_id: str, user=Depends(get_current_user)):
    """Called after business records are saved, so waiting workflows react at once
    (e.g. a recorded payment leads straight to the receipt)."""
    orch = get_orchestrator()
    try:
        await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    woken = await orch.wake(business_id)
    # The same change may call for a new task (a payment just recorded needs its receipt).
    from app.modules.agent import autostart
    started = await autostart.sweep(orch, business_id)
    return {"woken": woken, "started": len(started)}


class FactIn(BaseModel):
    text: str = Field(min_length=3, max_length=300)


def _memory_error(e) -> HTTPException:
    return HTTPException(status_code=403 if e.code == "owner_only" else 400, detail={"code": e.code, "message": e.message})


@router.get("/businesses/{business_id}/agent/memory")
async def read_memory(business_id: str, user=Depends(get_current_user)):
    """The facts the owner has asked the assistant to remember about this business."""
    from app.modules.agent import memory
    orch = get_orchestrator()
    try:
        actor, _ = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    return {"facts": memory.facts(await orch.rt.business.load(business_id)), "can_edit": actor.is_owner, "limit": memory.MAX_FACTS}


@router.post("/businesses/{business_id}/agent/memory")
async def save_fact(business_id: str, body: FactIn, user=Depends(get_current_user)):
    from app.modules.agent import memory
    try:
        return {"fact": await memory.add(get_orchestrator(), business_id, user["id"], body.text, user.get("email"))}
    except AccessDenied as e:
        raise _denied(e)
    except memory.MemoryError as e:
        raise _memory_error(e)


@router.delete("/businesses/{business_id}/agent/memory/{fact_id}")
async def forget_fact(business_id: str, fact_id: str, user=Depends(get_current_user)):
    from app.modules.agent import memory
    try:
        return {"removed": await memory.remove(get_orchestrator(), business_id, user["id"], fact_id, user.get("email"))}
    except AccessDenied as e:
        raise _denied(e)
    except memory.MemoryError as e:
        raise _memory_error(e)


class PolicyIn(BaseModel):
    contract_route: str | None = None
    default_vat_rate: float | None = None
    clear_vat_rate: bool = False
    quote_validity_days: int | None = Field(default=None, ge=1, le=365)
    default_payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    member_can_approve: bool | None = None
    reminders_auto_send: bool | None = None
    rfq_auto_start: bool | None = None      # draft a reply to each marketplace request as it arrives
    automation_items: dict[str, bool] | None = None      # one switch per automatic item (see autostart.ITEMS)
    automation_credit_cap: int | None = Field(default=None, ge=0, le=100000)      # most credits a month on work the Agent starts itself
    auto_start: bool | None = None          # start the follow-on task when records change (invoice, receipt, reminder)
    reminder_cadence_days: list[int] | None = None
    max_reminders: int | None = Field(default=None, ge=0, le=6)
    concentration_alert_pct: float | None = Field(default=None, ge=5, le=100)
    timezone: str | None = Field(default=None, max_length=64)      # IANA name, e.g. Europe/London


@router.get("/businesses/{business_id}/agent/policy")
async def read_policy(business_id: str, user=Depends(get_current_user)):
    orch = get_orchestrator()
    try:
        actor, policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    ent = await orch.entitlement(business_id)
    profile = (await orch.rt.business.load(business_id)).get("workspace_profile") or {}
    from app.modules.agent import autostart, config
    return {"policy": policy, "can_edit": actor.can_manage_policy, "auto_reminders_available": ent["max_autonomy"] == "A4",
            "timezone": profile.get("timezone") or None,
            "plan": ent["plan"], "events": autostart.events(policy, ent),
            "automatic_budget": autostart.budget(policy, await orch.rt.store.list_runs(business_id, limit=500), orch.rt.clock()),
            # Everything the Agent can do: the plan it needs, what it costs, and whether it can start by itself.
            "capabilities": [{"capability": c, "title": WORKFLOWS[c].title, "family": WORKFLOWS[c].family,
                              "minimum_plan": config.CAPABILITY_MIN_PLAN.get(c, "starter_insight"),
                              "minimum_plan_label": config.PLAN_LABEL[config.CAPABILITY_MIN_PLAN.get(c, "starter_insight")],
                              "available": config.plan_allows(ent["plan"], c), "credits": config.cost_of(c),
                              "needs_approval": WORKFLOWS[c].autonomy == "A3",
                              "automatic": [{"key": e["key"], "label": e.get("event"), "on": bool(e.get("on"))}
                                            for e in autostart.events(policy, ent) if e.get("capability") == c and e.get("key")]}
                             for c in WORKFLOWS]}


@router.put("/businesses/{business_id}/agent/policy")
async def update_policy(business_id: str, body: PolicyIn, user=Depends(get_current_user)):
    orch = get_orchestrator()
    try:
        actor, policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise _denied(e)
    except Conflict as e:
        raise _conflict(e)
    if not actor.can_manage_policy:      # only the owner changes Agent permissions/policies (s24)
        raise HTTPException(status_code=403, detail="Only the workspace owner can change Agent settings.")
    patch: dict[str, Any] = {}
    if body.contract_route is not None:
        if body.contract_route not in ("ask", "direct_invoice", "contract_first"):
            raise HTTPException(status_code=400, detail="Invalid contract route.")
        patch["contract_route"] = body.contract_route
    if body.clear_vat_rate:
        patch["default_vat_rate"] = None
    elif body.default_vat_rate is not None:
        if not 0 <= body.default_vat_rate <= 100:
            raise HTTPException(status_code=400, detail="VAT rate must be between 0 and 100.")
        patch["default_vat_rate"] = body.default_vat_rate
    for k in ("quote_validity_days", "default_payment_terms_days", "member_can_approve"):
        if getattr(body, k) is not None:
            patch[k] = getattr(body, k)
    reminders: dict[str, Any] = {}
    if body.reminders_auto_send is not None:
        if body.reminders_auto_send and (await orch.entitlement(business_id))["max_autonomy"] != "A4":
            raise HTTPException(status_code=403, detail="Automatic reminders are available on the Decision Engine plan.")
        reminders["auto_send"] = body.reminders_auto_send
    if body.reminder_cadence_days is not None:
        cadence = sorted({int(d) for d in body.reminder_cadence_days if 0 < int(d) <= 180})[:6]
        if not cadence:
            raise HTTPException(status_code=400, detail="Add at least one reminder day.")
        reminders["cadence_days_overdue"] = cadence
    if body.max_reminders is not None:
        reminders["max_reminders"] = body.max_reminders
    if reminders:
        patch["reminders"] = reminders
    if body.rfq_auto_start is not None:
        patch["marketplace_rfq"] = {"auto_start": body.rfq_auto_start}
    if body.auto_start is not None:
        patch["automation"] = {"auto_start": body.auto_start}
    if body.automation_credit_cap is not None:
        patch["automation"] = {**patch.get("automation", {}), "monthly_credit_cap": body.automation_credit_cap}
    if body.automation_items is not None:
        from app.modules.agent import autostart
        unknown = [k for k in body.automation_items if k not in autostart.ITEMS]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown automatic item: {unknown[0]}.")
        items = {**((policy.get("automation") or {}).get("items") or {}), **{k: bool(v) for k, v in body.automation_items.items() if k != "rfq_arrives"}}
        patch["automation"] = {**patch.get("automation", {}), "items": items}
        if "rfq_arrives" in body.automation_items:      # this one has its own, older setting
            patch["marketplace_rfq"] = {"auto_start": bool(body.automation_items["rfq_arrives"])}
    if body.concentration_alert_pct is not None:
        patch["risk"] = {"concentration_alert_pct": body.concentration_alert_pct}
    if body.timezone is not None:
        # The business's time zone is part of its profile (not the Agent policy): it decides
        # what "today" is for the dates and numbers of documents the Agent creates.
        from app.modules.agent import business as bz
        zone = body.timezone.strip()
        if not bz.valid_timezone(zone):
            raise HTTPException(status_code=400, detail="That time zone isn't recognised. Use a name like Europe/London.")

        def _set_zone(data: dict) -> None:
            data.setdefault("workspace_profile", {})
            if not isinstance(data["workspace_profile"], dict):
                data["workspace_profile"] = {}
            data["workspace_profile"]["timezone"] = zone
        await orch.rt.business.mutate(business_id, _set_zone)
        if not patch:      # nothing about the policy itself changed: its version stays as it is
            return {"policy": policy, "timezone": zone}
    updated = await orch.rt.store.set_policy(business_id, patch, user["id"])
    await orch.rt.store.audit({
        "id": new_id(), "business_id": business_id, "run_id": None, "actor_id": user["id"],
        "event_type": "policy_changed", "detail": {"changed": sorted(patch), "version": updated["version"]},
        "created_at": orch.rt.clock().isoformat(),
    })
    return {"policy": updated}


@router.get("/agent/capabilities")
async def capabilities(user=Depends(get_current_user)):
    """The Agent inventory: one Agent, specialist capabilities behind it (s5)."""
    return {
        "capabilities": [{**c, "available": c["capability"] in WORKFLOWS} for c in INVENTORY],
        "workflows": [{"workflow_key": w.workflow_key, "version": w.version, "title": w.title, "family": w.family,
                       "autonomy": w.autonomy, "tools": list(w.tools), "steps": [s.title for s in w.steps]} for w in WORKFLOWS.values()],
        "tools": describe_tools(),
    }


# ── Scheduler ────────────────────────────────────────────────────────────────

_scheduler_task: asyncio.Task | None = None


async def _scheduler_loop(interval_s: int) -> None:
    """Wakes workflows whose wait has elapsed. State is durable in the database, so a
    restart loses nothing: the next tick simply picks up whatever is due (s7.2, s21)."""
    passes = 0
    while True:
        try:
            await asyncio.sleep(interval_s)
            woken = await get_orchestrator().tick()
            if woken:
                logger.info("agent scheduler woke %s workflow(s)", woken)
            passes += 1
            if passes % 12 == 0:      # about hourly: an invoice becomes overdue without any record changing
                from app.modules.agent import autostart
                await autostart.sweep_all(get_orchestrator())
        except asyncio.CancelledError:
            raise
        except Exception as e:      # noqa: BLE001 - never let the loop die
            logger.warning("agent scheduler tick failed: %s", e)


def start_scheduler(interval_s: int = 300) -> None:
    global _scheduler_task
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.get_event_loop().create_task(_scheduler_loop(interval_s))


def stop_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
    _scheduler_task = None
