"""Agent Orchestrator (s7, s12): one shared runtime for every capability.

Receives a canonical AgentRequest, resolves actor + business + entitlement,
selects a supported workflow, then drives its steps through the tool gateway.
The gateway is where guardrails are enforced deterministically (s11): they are
runtime checks, not prompt wording.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

from app.modules.agent import answers, config, intent
from app.modules.agent import business as bz
from app.modules.agent.models import (
    APPROVAL_APPROVED, APPROVAL_CANCELLED, APPROVAL_CONSUMED, APPROVAL_EXPIRED, APPROVAL_INVALIDATED,
    APPROVAL_PENDING, APPROVAL_REJECTED, APPROVAL_SUPERSEDED, AUTONOMY_RANK, DECISION_ALLOWED, DECISION_BLOCKED,
    DECISION_NEEDS_CLARIFICATION, DECISION_REQUIRES_APPROVAL, EFFECT_READ_ONLY, EXTERNAL_EFFECTS,
    RUN_AWAITING_APPROVAL, RUN_CANCELLED, RUN_CREATED, RUN_FAILED, RUN_RUNNING, RUN_SUCCEEDED, RUN_TERMINAL,
    SOURCE_CHANNELS, STEP_AWAITING_APPROVAL, STEP_AWAITING_INPUT, STEP_CANCELLED, STEP_FAILED, STEP_RUNNING,
    STEP_SUCCEEDED, SUB_BLOCKED, SUB_DELIVERY_UNCERTAIN, SUB_RETRY_AVAILABLE, SUB_WAITING_EVENT,
    SUB_WAITING_INFO, STEP_SKIPPED, Actor, AgentRequest, DeliveryUncertain, DeliveryUnconfirmed, Done, GuardrailBlocked, GuardrailDecision,
    NeedsApproval, Next, Stop, WaitForEvent, WaitForInput, WorkflowDefinition, new_id, now_utc, payload_hash,
)
from app.modules.agent import memory
from app.modules.agent import rfq as rfqs
from app.modules.agent.services import Classifier, Comms, InsufficientCredits, MemoryStudio, Meter, Studio
from app.modules.agent.store import Store
from app.modules.agent.store import DuplicateRun
from app.modules.agent.tools import PAYLOAD_BUILDERS, REGISTRY, NeedsInformation, ToolContext, ToolFailed, ToolStop
from app.modules.agent.workflows import INVENTORY, WORKFLOWS

# Planned capabilities with no workflow yet (s5): requests for them get a clear answer.
FUTURE = {c["capability"]: c["label"] for c in INVENTORY if c["capability"] not in WORKFLOWS}

logger = logging.getLogger(__name__)

# The document version is part of the send key, so a re-approved new version can be sent
# while the same version can never be sent twice (s21.1).
_VERSIONED_SENDS = {"send_quotation", "send_contract", "send_invoice", "send_proposal", "send_purchase_order", "send_credit_note"}
_MAX_STEPS_PER_ADVANCE = 25


@dataclass
class Runtime:
    store: Store
    business: bz.Business
    comms: Comms
    meter: Meter
    classifier: Classifier
    clock: Callable[[], datetime] = now_utc
    studio: Studio = field(default_factory=MemoryStudio)      # the product's idea, market and plan generators


class AccessDenied(Exception):
    pass


def _ended(run: dict) -> str:
    return {"succeeded": "finished", "cancelled": "been cancelled", "failed": "stopped"}.get(run["status"], "finished")


class Conflict(Exception):
    """The request can't apply to the run or approval in its current state (s11.1).
    Nothing changed; the API answers 409 with this code and message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _offer_vat_default(fields: list[dict]) -> list[dict]:
    """The VAT rate is only ever asked when Agent settings has no default. Asked, it comes with
    "Save as my default", so it is asked once and not again."""
    if any(f.get("key") == "vat_rate" for f in fields) and not any(f.get("key") == "save_vat_default" for f in fields):
        at = next(i for i, f in enumerate(fields) if f.get("key") == "vat_rate")
        rate = fields[at]
        fields = [*fields[:at + 1], {"key": "save_vat_default", "label": "Save as my default VAT rate", "type": "checkbox", "default": False,
                                    "hint": "You won't be asked again. Change it any time in Agent settings.",
                                    **({"show_if": rate["show_if"]} if rate.get("show_if") else {})}, *fields[at + 1:]]
    return fields


def dedupe_key(capability: str, source_reference: str | None, params: dict) -> str | None:
    """One run per (business, capability, source reference, target) (AC-12). Only for
    workflows that can act externally; read-only helpers may be re-run freely."""
    if not source_reference:
        return None
    target = params.get("invoice_id") or params.get("quote_id") or params.get("contract_id") or ""
    return f"{capability}:{source_reference}:{target}"


def _block(code: str, message: str, decision: str = DECISION_BLOCKED) -> GuardrailBlocked:
    return GuardrailBlocked(GuardrailDecision(decision=decision, reason_codes=[code], message=message))


@dataclass
class Ctx:
    """What a workflow step sees. Every effect goes through `call`."""
    orch: "Orchestrator"
    run: dict
    wf: WorkflowDefinition
    actor: Actor
    policy: dict
    limits: dict
    owner_id: str
    step_key: str = ""
    step_id: str = ""
    notes: list[str] = field(default_factory=list)
    _enquiry: dict | None = None

    @property
    def rt(self) -> Runtime:
        return self.orch.rt

    @property
    def state(self) -> dict:
        return self.run["state"]

    @property
    def answers(self) -> dict:
        return self.run["state"].setdefault("answers", {})

    @property
    def params(self) -> dict:
        return self.run["state"].setdefault("params", {})

    def now(self) -> datetime:
        return self.rt.clock()

    def note(self, text: str) -> None:
        self.notes.append(text)

    async def enquiry(self) -> dict:
        if self._enquiry is None:
            e = await self.rt.store.get_enquiry(self.state["enquiry_id"])
            if not e or e["business_id"] != self.run["business_id"]:
                raise ToolStop("enquiry_not_found", "The enquiry is no longer available.")
            self._enquiry = e
        return self._enquiry

    # ── LLM helpers: budgeted, metered, and never able to reach a tool ──────
    def _llm_allowed(self) -> bool:
        b = self.run["budget"]
        return self.rt.classifier.available and b["llm_calls"] < b["max_llm_calls"]

    async def classify_enquiry(self, text: str) -> tuple[str, str]:
        cls, method = await intent.classify_enquiry(text, Classifier(), self.actor.user_id)   # rules only
        if cls not in ("general_enquiry", "uncertain") or not self._llm_allowed():
            return cls, method
        try:
            async with self.rt.meter.charge(self.actor.user_id, "agent_classify"):
                self.run["budget"]["llm_calls"] += 1
                found = await intent.classify_enquiry(text, self.rt.classifier, self.actor.user_id)
            await self.orch.note_spend(self.run, "agent_classify", "classify_enquiry")
            return found
        except InsufficientCredits:
            raise
        except Exception:
            return cls, method      # LLM failure never breaks the workflow (s22.1)

    async def extract_items(self, text: str) -> list[dict]:
        if not self._llm_allowed():
            return []
        try:
            async with self.rt.meter.charge(self.actor.user_id, "agent_classify"):
                self.run["budget"]["llm_calls"] += 1
                items = await self.rt.classifier.extract_items(text=text, user_id=self.actor.user_id)
            await self.orch.note_spend(self.run, "agent_classify", "read_enquiry_items")
            return items
        except InsufficientCredits:
            raise
        except Exception:
            return []

    async def call(self, tool_id: str, **args: Any) -> dict:
        return await self.orch._gateway(self, tool_id, args)


def _money_text(value: Any, currency: str) -> str:
    symbol = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦"}.get(str(currency or "GBP").upper())
    amount = f"{float(value or 0):,.2f}"
    return f"{symbol}{amount}" if symbol else f"{currency} {amount}"


def what_changed(before: dict, after: dict) -> str:
    """One line on the difference between two versions of a draft: "Qty 2 → 3 on Monthly bookkeeping; total £900.00 → £1,260.00"."""
    cur = after.get("currency") or before.get("currency") or "GBP"
    was = {str(i.get("description")): i for i in before.get("items") or []}
    now = {str(i.get("description")): i for i in after.get("items") or []}
    parts: list[str] = []
    for name, item in now.items():
        old = was.get(name)
        if not old:
            parts.append(f"Added {name}")
            continue
        if float(old.get("qty") or 0) != float(item.get("qty") or 0):
            parts.append(f"Qty {float(old.get('qty') or 0):g} → {float(item.get('qty') or 0):g} on {name}")
        if abs(float(old.get("unit_price") or 0) - float(item.get("unit_price") or 0)) >= 0.005:
            parts.append(f"Price {_money_text(old.get('unit_price'), cur)} → {_money_text(item.get('unit_price'), cur)} on {name}")
    parts += [f"Removed {name}" for name in was if name not in now]
    if float(before.get("vat_rate") or 0) != float(after.get("vat_rate") or 0):
        parts.append(f"VAT {float(before.get('vat_rate') or 0):g}% → {float(after.get('vat_rate') or 0):g}%")
    if abs(float(before.get("discount_amount") or 0) - float(after.get("discount_amount") or 0)) >= 0.005:
        parts.append(f"Discount {_money_text(before.get('discount_amount'), cur)} → {_money_text(after.get('discount_amount'), cur)}")
    if (before.get("description") or "") != (after.get("description") or "") and not after.get("items"):
        parts.append("Scope changed")
    if (before.get("message") or "") != (after.get("message") or ""):
        parts.append("Wording changed" if after.get("message") else "Wording removed")
    if abs(float(before.get("amount_requested") or 0) - float(after.get("amount_requested") or 0)) >= 0.005:
        parts.append(f"Amount asked for {_money_text(before.get('amount_requested') or before.get('outstanding'), cur)} → "
                     f"{_money_text(after.get('amount_requested') or after.get('outstanding'), cur)}")
    for key, label in (("problem", "What the customer needs"), ("solution", "What you propose")):
        if (before.get(key) or "") != (after.get(key) or ""):
            parts.append(f"“{label}” changed")
    if abs(float(before.get("refund_amount") or 0) - float(after.get("refund_amount") or 0)) >= 0.005:
        parts.append(f"Refund {_money_text(before.get('refund_amount'), cur)} → {_money_text(after.get('refund_amount'), cur)}")
    for key, label in (("customer_name", "Customer"), ("to_email", "Sent to"), ("valid_until", "Valid until"), ("due_date", "Due date"),
                       ("delivery_date", "Deliver by"), ("timeline", "Timeline"), ("reason", "Reason"), ("payment_terms", "Payment terms")):
        if (before.get(key) or "") != (after.get(key) or ""):
            parts.append(f"{label} {before.get(key) or 'not set'} → {after.get(key) or 'not set'}")
    if (before.get("notes") or "") != (after.get("notes") or ""):
        parts.append("Notes changed")
    if abs(float(before.get("total") or 0) - float(after.get("total") or 0)) >= 0.005:
        parts.append(f"total {_money_text(before.get('total'), cur)} → {_money_text(after.get('total'), cur)}")
    return "; ".join(parts) or "Nothing in the document changed."


_BACKGROUND: set = set()
_ADVANCING: set = set()       # tasks being carried on in this process right now
# Writes running alongside the piece of work in hand (see Orchestrator._alongside).
_WRITES: "contextvars.ContextVar[list | None]" = contextvars.ContextVar("agent_writes", default=None)


def _together(fn):
    """The whole call is one piece of work: shared reads, and the audit trail written alongside."""
    import functools

    @functools.wraps(fn)
    async def inner(self, *args, **kwargs):
        with _Together() as work:
            try:
                return await fn(self, *args, **kwargs)
            finally:
                await work.settle()
    return inner


class _Together:
    """One piece of work: identical reads are shared, and the audit trail is written alongside
    it. Everything written alongside has landed before the work returns."""

    def __enter__(self):
        from app.core.supabase import read_cache
        self._cache = read_cache()
        self._cache.__enter__()
        self._own = _WRITES.get() is None
        if self._own:
            self._pending: list = []
            self._token = _WRITES.set(self._pending)
        return self

    async def settle(self) -> None:
        if self._own and self._pending:
            done = await asyncio.gather(*self._pending, return_exceptions=True)
            self._pending.clear()
            for problem in (d for d in done if isinstance(d, Exception)):
                logger.error("a record of agent work could not be written: %s", problem)

    def __exit__(self, *exc):
        if self._own:
            _WRITES.reset(self._token)
        self._cache.__exit__(*exc)
        return False      # tasks being carried on after their request returned (kept so they aren't collected)


class Orchestrator:
    def __init__(self, rt: Runtime):
        self.rt = rt

    # ══ Entitlements + guardrails ═════════════════════════════════════════════

    async def entitlement(self, business_id: str) -> dict:
        owner_id = await self.rt.business.owner_id(business_id)
        plan = await self.rt.meter.plan(owner_id)
        limits = config.with_dev_overrides(await self.rt.store.plan_limits(plan))
        return {"plan": plan, "owner_id": owner_id, **limits, "is_paid": plan != "explorer"}

    async def visible_data(self, business_id: str) -> dict:
        """The business's records as its owner's plan shows them. Whatever a page masks is masked
        here, so an answer can never contain what the plan keeps locked."""
        data = await self.rt.business.load(business_id)
        fin = data.get("financials") or {}
        if fin.get("rfq_requests") and not await self.rt.meter.rfq_unlocked(await self.rt.business.owner_id(business_id)):
            from app.modules.addons.service import redact_rfqs
            data = {**data, "financials": {**fin, "rfq_requests": redact_rfqs(fin["rfq_requests"])}}
        return data

    async def actor_for(self, user_id: str, business_id: str, email: str | None = None) -> tuple[Actor, dict]:
        policy = await self.rt.store.get_policy(business_id)
        try:
            actor = await self.rt.business.actor(user_id, business_id, policy, email)
        except bz.BusinessAccessDenied as e:
            # Business isolation: no access means no information either (AC-01).
            raise AccessDenied(str(e)) from e
        return actor, policy

    async def _usage(self, business_id: str, capability: str | None = None) -> dict:
        runs = await self.rt.store.list_runs(business_id, limit=1000)
        month_start = self.rt.clock().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        return {
            # How many of this one task have been started this month (for the plan's counted tasks).
            "this_task": sum(1 for r in runs if capability and r.get("workflow_key") == capability and (r.get("created_at") or "") >= month_start
                             and not (r.get("state") or {}).get("duplicate_of")),
            # A task closed as a duplicate of another doesn't use the monthly allowance.
            "monthly_runs": sum(1 for r in runs if (r.get("created_at") or "") >= month_start
                                and not (r.get("state") or {}).get("duplicate_of")),
            "active_runs": sum(1 for r in runs if r["status"] not in RUN_TERMINAL),
        }

    async def _why_blocked(self, decision: GuardrailDecision, wf: WorkflowDefinition, ent: dict, actor: Actor) -> dict:
        """What a blocked start adds for the page: the reason in one word, the plan that includes the
        task (with a way to upgrade and, where there is one, something the plan does include), or the
        balance and the price when it is credits that are missing. No run exists and nothing was charged."""
        code = (decision.reason_codes or [""])[0]
        if code in ("plan_capability", "plan_quota"):
            need = config.CAPABILITY_MIN_PLAN.get(wf.capability, "starter_insight")
            if code == "plan_quota":      # the next plan up lifts the number
                order = config.PLAN_ORDER
                need = order[min(len(order) - 1, config.plan_rank(ent["plan"]) + 1)]
            other = config.plan_map.alternative(ent["plan"], wf.capability)
            return {"reason": "plan", "task": wf.title, "plan_required": need, "plan_required_label": config.PLAN_LABEL[need],
                    "actions": [{"label": "Upgrade", "to": "/pricing", "upgrade": True}] + ([other] if other else [])}
        if code == "credits_exhausted":
            return {"reason": "credits", "balance": await self.rt.meter.balance(actor.user_id), "cost": config.cost_of(wf.capability),
                    "actions": [{"label": "Top up", "to": "/pricing", "upgrade": True}]}
        return {}

    async def check_start(self, actor: Actor, wf: WorkflowDefinition, ent: dict, essential: bool = False) -> GuardrailDecision:
        """Server-side checks before a workflow starts (AC-04). `essential`: handed over by the server
        from the homepage goal flow, which is carried out on any plan and paid for in AI Credits."""
        essential = bool(essential and config.HOMEPAGE_TASKS_ON_ANY_PLAN)
        if not actor.can_view:
            return GuardrailDecision(DECISION_BLOCKED, ["permission_denied"], "You don't have access to this business.")
        if not config.plan_allows(ent["plan"], wf.capability) and not essential:
            # The plan gate: the same answer whichever way the task was asked for. Nothing starts and nothing is charged.
            need = config.PLAN_LABEL[config.CAPABILITY_MIN_PLAN.get(wf.capability, "starter_insight")]
            return GuardrailDecision(DECISION_BLOCKED, ["plan_capability"], f"{wf.title} is on the {need} plan.")
        if AUTONOMY_RANK[wf.autonomy] > AUTONOMY_RANK["A1"] and not actor.can_prepare:
            return GuardrailDecision(DECISION_BLOCKED, ["permission_denied"], "Your role can't start this kind of work.")
        usage = await self._usage(actor.business_id, wf.capability)
        allowed = config.plan_map.quota(ent["plan"], wf.capability)
        if allowed is not None and usage["this_task"] >= allowed and not essential:
            # A counted task (scenario simulations): the plan's number for the month is used.
            words = config.plan_map.QUOTA_WORDS.get(wf.capability, "of these")
            return GuardrailDecision(DECISION_BLOCKED, ["plan_quota"],
                                     f"You've used all {allowed} {words} included in the {config.PLAN_LABEL.get(ent['plan'], 'your')} plan this month.")
        if config.MONTHLY_TASK_ALLOWANCE_APPLIES and usage["monthly_runs"] >= ent["monthly_runs"] and not essential:
            return GuardrailDecision(DECISION_BLOCKED, ["plan_monthly_limit"],
                                     f"You've used all {ent['monthly_runs']} Agent tasks included in your plan this month. Upgrade for more.")
        if config.MONTHLY_TASK_ALLOWANCE_APPLIES and usage["active_runs"] >= ent["max_active_runs"] and not essential:
            return GuardrailDecision(DECISION_BLOCKED, ["plan_active_limit"],
                                     f"Your plan allows {ent['max_active_runs']} Agent tasks in progress at once. Finish or cancel one, or upgrade.")
        # Every task costs credits (its steps' own prices, or the task price), so none starts on an empty balance.
        if await self.rt.meter.balance(actor.user_id) <= 0:
            return GuardrailDecision(DECISION_BLOCKED, ["credits_exhausted"],
                                     "You're out of AI Credits. Your records are safe; top up or upgrade to keep using the Agent.")
        return GuardrailDecision(DECISION_ALLOWED)

    # ══ Tool gateway ══════════════════════════════════════════════════════════

    def _decide(self, tool, wf: WorkflowDefinition, actor: Actor, limits: dict, run: dict, args: dict) -> GuardrailDecision:
        """Deterministic policy decision for one tool call (s11.1)."""
        if tool is None or tool.tool_id not in wf.tools:
            return GuardrailDecision(DECISION_BLOCKED, ["tool_not_allowed"], "That action isn't part of this task.")
        missing = [k for k in tool.required if args.get(k) in (None, "", [], {})]
        if missing:
            return GuardrailDecision(DECISION_NEEDS_CLARIFICATION, ["missing_input"], f"Missing: {', '.join(missing)}.")
        needed = "A1" if tool.effect == EFFECT_READ_ONLY else ("A3" if tool.effect in EXTERNAL_EFFECTS else "A2")
        if AUTONOMY_RANK[needed] > AUTONOMY_RANK[limits["max_autonomy"]]:
            return GuardrailDecision(DECISION_BLOCKED, ["plan_limit"], "Your plan doesn't include this kind of action.")
        b = run["budget"]
        if tool.effect in EXTERNAL_EFFECTS and b["external_calls"] >= b["max_external_calls"]:
            return GuardrailDecision(DECISION_BLOCKED, ["budget_exceeded"], "This task reached its limit of external actions.")
        if tool.permission == "prepare" and not actor.can_prepare:
            return GuardrailDecision(DECISION_BLOCKED, ["permission_denied"], "Your role can't prepare this.")
        if tool.permission == "send" and tool.approval_policy == "none" and not actor.can_send:
            return GuardrailDecision(DECISION_BLOCKED, ["permission_denied"], "Your role can't confirm this.")
        if tool.approval_policy != "none":
            return GuardrailDecision(DECISION_REQUIRES_APPROVAL, ["external_action"], "This action needs approval before it is sent.")
        return GuardrailDecision(DECISION_ALLOWED)

    def _a4_authorised(self, ctx: Ctx, payload: dict) -> bool:
        """Bounded auto-execution only under an explicit, versioned, pre-authorised policy (s10 A4)."""
        r = ctx.policy.get("reminders") or {}
        return bool(
            r.get("auto_send")
            and ctx.limits["max_autonomy"] == "A4"
            and int(payload.get("stage") or 99) <= int(r.get("max_reminders") or 0)
            and payload.get("policy_version") == int(ctx.policy.get("version") or 1)
        )

    async def _approved(self, ctx: Ctx, tool_id: str, h: str) -> dict | None:
        """A still-valid approval bound to exactly this payload, or None. Stale approvals are invalidated (AC-09)."""
        now = ctx.now().isoformat()
        for a in await self.rt.store.list_approvals(run_id=ctx.run["id"]):
            if a["step_key"] != ctx.step_key or a["tool_id"] != tool_id or a["status"] != APPROVAL_APPROVED:
                continue
            if a["payload_hash"] != h:
                await self.rt.store.update_approval(a["id"], {"status": APPROVAL_INVALIDATED, "decided_note": "The action changed after approval."})
                await self._audit(ctx.run, "approval_invalidated", ctx.actor.user_id, {"approval_id": a["id"], "reason": "payload_changed"})
                continue
            if a.get("expires_at") and a["expires_at"] < now:
                await self.rt.store.update_approval(a["id"], {"status": APPROVAL_EXPIRED})
                await self._audit(ctx.run, "approval_expired", ctx.actor.user_id, {"approval_id": a["id"]})
                continue
            return a
        return None

    async def _gateway(self, ctx: Ctx, tool_id: str, args: dict) -> dict:
        tool = REGISTRY.get(tool_id)
        decision = self._decide(tool, ctx.wf, ctx.actor, ctx.limits, ctx.run, args)
        if decision.decision in (DECISION_BLOCKED, DECISION_NEEDS_CLARIFICATION):
            await self._audit(ctx.run, "guardrail_decision", ctx.actor.user_id, {"tool": tool_id, **decision.as_dict()})
            raise GuardrailBlocked(decision)

        tc = ToolContext(rt=self.rt, run=ctx.run, actor=ctx.actor, policy=ctx.policy, owner_id=ctx.owner_id)
        exec_args, charge_user, approval, h = args, ctx.actor.user_id, None, None
        forced_key = None

        if decision.decision == DECISION_REQUIRES_APPROVAL:
            # Rebuilt from the live records every time: this is the revalidation of source state (AC-10).
            payload, title = await PAYLOAD_BUILDERS[tool_id](tc, args)
            h = payload_hash(tool_id, payload)
            exec_args = payload
            # An earlier attempt at this send that was never confirmed is settled first.
            forced_key = await self._carried_send(ctx, tc, tool, tool_id, payload, h)
            if forced_key:
                pass      # it was delivered: that delivery is recorded; nothing new is approved or sent
            elif tool.approval_policy == "policy_a4" and self._a4_authorised(ctx, payload):
                charge_user = ctx.owner_id
                await self._audit(ctx.run, "guardrail_decision", "system", {
                    "tool": tool_id, "decision": DECISION_ALLOWED, "reason_codes": ["a4_policy"],
                    "policy_version": ctx.policy.get("version")})
            else:
                approval = await self._approved(ctx, tool_id, h)
                if not approval:
                    await self._audit(ctx.run, "guardrail_decision", ctx.actor.user_id, {"tool": tool_id, **decision.as_dict()})
                    raise NeedsApproval(tool_id, payload, title, {"payload_hash": h})
                # Authority is rechecked immediately before execution (AC-10).
                try:
                    approver = await self.rt.business.actor(approval["approver_id"], ctx.run["business_id"], ctx.policy)
                except bz.BusinessAccessDenied:
                    approver = None
                if not approver or not approver.can_send:
                    await self.rt.store.update_approval(approval["id"], {"status": APPROVAL_INVALIDATED, "decided_note": "The approver's permission changed."})
                    raise _block("permission_changed", "The approver no longer has permission to send this. It needs approving again.")
                charge_user = approval["approver_id"]

        # Idempotency: the same action can never produce a second side effect (AC-12).
        key = None
        if tool.idempotency:
            key = forced_key or self._idem_key(tool, tool_id, exec_args, ctx.run, h)
            status, cached = await self.rt.store.idem_begin(ctx.run["business_id"], key, ctx.run["id"], self.rt.clock())
            if status == "completed" and cached is not None:
                await self._audit(ctx.run, "duplicate_prevented", ctx.actor.user_id, {"tool": tool_id, "idempotency_key": key})
                if approval:
                    await self.rt.store.update_approval(approval["id"], {"status": APPROVAL_CONSUMED})
                return {**cached, "duplicate": True}
            tc.idem_key = key
            if status == "started" and tool.effect in EXTERNAL_EFFECTS:
                # An earlier attempt may or may not have reached the provider (a timeout).
                # Reconcile before anything is sent: ask the provider what it holds for this
                # key. A confirmed delivery is taken as the result and nothing is sent again;
                # otherwise the send repeats with the same key, which the provider de-duplicates (s21).
                try:
                    found = await self.rt.comms.find_delivery(tc.provider_key())
                except Exception as e:      # noqa: BLE001 - fall back to the provider's own de-duplication
                    logger.warning("delivery reconciliation failed: %s", e)
                    found = None
                decision = (ctx.run["state"].get("delivery_decisions") or {}).get(key) or {}
                if not found and decision.get("outcome") == "delivered":
                    found = {"message_id": None, "confirmed_by": decision.get("by")}      # a person checked: it arrived
                since = bz._moment(decision.get("at")) if decision.get("outcome") == "resend" else \
                    await self.rt.store.idem_started_at(ctx.run["business_id"], key)
                window = timedelta(hours=config.PROVIDER_DEDUPE_HOURS)
                if not found and since and self.rt.clock() - since > window:
                    # Past the provider's de-duplication window, a repeat would go out as a new
                    # message. Never retried automatically: a person decides.
                    to = exec_args.get("to_email") or "the customer"
                    ctx.run["state"]["delivery_question"] = {"tool": tool_id, "key": key, "to": to, "first_attempt_at": since.isoformat()}
                    await self._audit(ctx.run, "delivery_reconciled", ctx.actor.user_id, {
                        "tool": tool_id, "idempotency_key": key, "outcome": "unconfirmed_after_window"})
                    raise DeliveryUnconfirmed(
                        f"I tried to send this to {to} on {since.strftime('%d %b %Y at %H:%M').lstrip('0')} UTC and couldn't confirm it arrived. "
                        "It's now too late to retry safely: the email service would treat it as a new message, so it could arrive twice. "
                        "Please check whether it was received, then tell me whether to mark it as delivered or send it again.")
                tc.resend = bool(not found and decision.get("outcome") == "resend")
                tc.reconciled = found
                await self._audit(ctx.run, "delivery_reconciled", ctx.actor.user_id, {
                    "tool": tool_id, "idempotency_key": key,
                    "outcome": ("confirmed_by_user" if found and found.get("confirmed_by") else "delivered") if found
                               else ("resend_confirmed_by_user" if tc.resend else "not_found"),
                    "message_id": (found or {}).get("message_id")})

        # Entitlement is rechecked right before any effect (AC-04, AC-10).
        feature = self._credit_feature(tool, ctx.run)
        if feature and await self._first_task_free(ctx.run):
            feature = None
        if feature and await self.rt.meter.balance(charge_user) <= 0:
            raise InsufficientCredits(0, 1)

        if tool.effect != EFFECT_READ_ONLY:      # a look-up changes nothing: there is no attempt to record before it
            await self._step_update(getattr(ctx, "step", None) or {"id": ctx.step_id}, {
                "tool_id": tool_id, "tool_version": tool.version, "idempotency_key": key,
                "input_ref": {k: v for k, v in exec_args.items() if k not in ("items", "html")},
            })
        try:
            if feature:
                async with self.rt.meter.charge(charge_user, feature):
                    result = await asyncio.wait_for(tool.handler(tc, exec_args), timeout=tool.timeout_s)
                await self.note_spend(ctx.run, feature, tool_id)      # reached only when the charge was kept
            else:
                result = await asyncio.wait_for(tool.handler(tc, exec_args), timeout=tool.timeout_s)
        except asyncio.TimeoutError as e:
            if tool.effect in EXTERNAL_EFFECTS:
                self._note_uncertain(ctx, tool_id, key, exec_args)
                raise DeliveryUncertain("The provider did not respond in time.") from e
            raise ToolFailed("The action timed out.") from e
        except DeliveryUncertain:
            self._note_uncertain(ctx, tool_id, key, exec_args)
            raise

        if (ctx.run["state"].get("uncertain_send") or {}).get("tool") == tool_id:
            ctx.run["state"].pop("uncertain_send", None)      # settled: sent, or confirmed as already delivered
        if key:
            await self.rt.store.idem_complete(ctx.run["business_id"], key, result)
        if approval:
            await self.rt.store.update_approval(approval["id"], {"status": APPROVAL_CONSUMED})
        if tool.effect in EXTERNAL_EFFECTS:
            ctx.run["budget"]["external_calls"] += 1
        if tool.effect != EFFECT_READ_ONLY:
            await self._audit(ctx.run, "tool_executed", charge_user, {
                "tool": tool_id, "tool_version": tool.version, "effect": tool.effect, "idempotency_key": key,
                "approval_id": approval["id"] if approval else None, "payload_hash": h,
                "external_ref": result.get("message_id"), "audit_class": tool.audit_class})
            await self._event(ctx.run, "ToolExecutionCompleted", {"tool": tool_id, "effect": tool.effect})
            await self._step_update(getattr(ctx, "step", None) or {"id": ctx.step_id}, {"external_ref": result.get("message_id"),
                                                          "output_ref": {k: v for k, v in result.items() if k != "draft"}})
        return result

    async def note_spend(self, run: dict, feature: str, what: str) -> None:
        """Write down what was just charged, on the task that caused it, so its cost can be seen."""
        try:
            credits = int(await self.rt.meter.cost(feature))
        except Exception:      # noqa: BLE001 - the record of the cost never breaks the task
            credits = 0
        if credits:
            run["state"].setdefault("credits", []).append({"feature": feature, "for": what, "credits": credits, "at": self.rt.clock().isoformat()})

    async def _with_what_was_said(self, run: dict, fields: list[dict]) -> list[dict]:
        """The form about to be shown, with whatever the owner already said in their message filled
        in (names, amounts and their currency, quantities, dates, VAT, discount, document numbers),
        so only what is missing is asked. Never a reason for a task to fail."""
        try:
            if run.get("source_channel") not in ("text", "voice") or not fields:
                return fields
            from app.modules.agent import said
            state = run.get("state") or {}
            text = str((state.get("params") or {}).get("body") or run.get("goal") or "")
            if not text.strip():
                return fields
            data = await self.rt.business.load(run["business_id"]) or {}
            policy = await self.rt.store.get_policy(run["business_id"]) or {}
            rate = policy.get("default_vat_rate")
            return said.apply(fields, text, bz.local_now(data, self.rt.clock()).date(), default_currency=bz.currency_of(data),
                              answered=state.get("answers") or {}, default_vat=None if rate is None else float(rate),
                              extras=("valid_until", "discount") if run.get("workflow_key") == "enquiry_to_quote" else ())
        except Exception:      # noqa: BLE001
            logger.warning("could not read the request into the form for run %s", run.get("id"), exc_info=True)
            return fields

    async def _first_task_free(self, run: dict) -> bool:
        """Is this the one task a new account gets free (the first invoice or quotation, started from
        the homepage)? The workspace carries the mark, written by the server when that account's
        workspace was made; the first task to match it claims it, and no other task ever can."""
        state = run.setdefault("state", {})
        if "first_task_free" in state:
            return bool(state["first_task_free"])
        reference = str(run.get("source_reference") or "")
        if not (config.FIRST_TASK_FREE and reference.startswith("goal:") and run.get("workflow_key") in config.FREE_FIRST_TASKS):
            return False
        claimed: dict[str, bool] = {}

        def _claim(d: dict) -> None:
            mark = (d.get("onboarding") or {}).get("free_first_task")
            if isinstance(mark, dict) and mark.get("reference") == reference and mark.get("run_id") in (None, run["id"]):
                mark["run_id"] = run["id"]
                claimed["yes"] = True
        try:
            await self.rt.business.mutate(run["business_id"], _claim)
        except Exception:      # noqa: BLE001 - if the mark can't be read, the task is charged as usual
            logger.warning("could not check the free first task for run %s", run["id"], exc_info=True)
            return False
        state["first_task_free"] = bool(claimed)
        if claimed:
            await self._audit(run, "credits_waived", run.get("requester_id"), {"reason": "first_task_free"})
        return bool(claimed)

    @staticmethod
    def _credit_feature(tool, run: dict) -> str | None:
        """What an action is charged as. Replying to a marketplace request costs what replying by
        hand costs: one credit, taken when the quotation is sent, and nothing for preparing the draft."""
        if run.get("workflow_key") == "enquiry_to_quote" and (run.get("state") or {}).get("rfq_id"):
            return {"create_quotation_draft": None, "send_quotation": "rfq_response"}.get(tool.tool_id, tool.credit_feature)
        return tool.credit_feature

    @staticmethod
    def _idem_key(tool, tool_id: str, exec_args: dict, run: dict, h: str | None) -> str:
        key = tool.idempotency(exec_args, run)
        return f"{key}:{h[:16]}" if tool_id in _VERSIONED_SENDS else key

    def _note_uncertain(self, ctx: Ctx, tool_id: str, key: str | None, exec_args: dict) -> None:
        """Remember a send whose outcome is unknown, so nothing else is sent for this step
        until it has been settled (even if the message's details change in the meantime)."""
        if key:
            ctx.run["state"]["uncertain_send"] = {"tool": tool_id, "step": ctx.step_key, "key": key,
                                                  "to": exec_args.get("to_email"), "at": self.rt.clock().isoformat()}

    async def _carried_send(self, ctx: Ctx, tc: ToolContext, tool, tool_id: str, payload: dict, h: str) -> str | None:
        """An earlier attempt at this step's send was never confirmed. Before anything is approved
        or sent again, settle it. Returns the earlier attempt's key if it was delivered (that
        delivery is then recorded and nothing new goes out); None if nothing is carried over, a
        person has said to send again, or an ordinary safe retry applies; otherwise stops and asks.

        Asking is required when the provider can no longer de-duplicate a repeat: the message has
        changed since (it would be a new message), or its 24-hour window has passed."""
        state = ctx.run["state"]
        unc = state.get("uncertain_send") or {}
        if unc.get("tool") != tool_id or unc.get("step") != ctx.step_key or not tool.idempotency:
            return None
        same = self._idem_key(tool, tool_id, payload, ctx.run, h) == unc["key"]
        decision = (state.get("delivery_decisions") or {}).get(unc["key"]) or {}
        tc.idem_key = unc["key"]
        try:
            found = await self.rt.comms.find_delivery(tc.provider_key())
        except Exception as e:      # noqa: BLE001
            logger.warning("delivery reconciliation failed: %s", e)
            found = None
        tc.idem_key = None
        if found or decision.get("outcome") == "delivered":
            return unc["key"]
        if decision.get("outcome") == "resend":
            if not same:
                state.pop("uncertain_send", None)
            return None
        at = bz._moment(unc.get("at"))
        stale = bool(at and self.rt.clock() - at > timedelta(hours=config.PROVIDER_DEDUPE_HOURS))
        if same and not stale:
            return None      # the same message, inside the window: a repeat is de-duplicated by the provider
        to = unc.get("to") or "the customer"
        state["delivery_question"] = {"tool": tool_id, "key": unc["key"], "to": to, "first_attempt_at": unc.get("at")}
        await self._audit(ctx.run, "delivery_reconciled", ctx.actor.user_id, {
            "tool": tool_id, "idempotency_key": unc["key"],
            "outcome": "unconfirmed_after_window" if same else "unconfirmed_details_changed"})
        why = ("It's now too late to retry safely: the email service would treat it as a new message"
               if same else "The details have changed since then, so sending now would go out as a new message")
        raise DeliveryUnconfirmed(
            f"I tried to send this to {to}" + (f" on {at.strftime('%d %b %Y at %H:%M').lstrip('0')} UTC" if at else "")
            + f" and couldn't confirm it arrived. {why}, and it could arrive twice. "
              "Please check whether it was received, then tell me whether to mark it as delivered or send it again.")

    # ══ Audit + events ════════════════════════════════════════════════════════

    async def _step_update(self, step: dict, patch: dict) -> None:
        """Record something on a step: its first record creates the row, later ones update it."""
        if step.pop("_unsaved", False):
            step.update(patch)
            await self.rt.store.add_step(step)
        else:
            await self.rt.store.update_step(step["id"], patch)

    async def _alongside(self, write) -> None:
        """A write nothing later depends on (the audit trail, an event). Inside a task's advance it
        runs alongside the work and is waited for before the advance returns; elsewhere it is awaited."""
        pending = _WRITES.get()
        if pending is None:
            await write
        else:
            pending.append(asyncio.ensure_future(write))

    async def _audit(self, run: dict, event_type: str, actor_id: str, detail: dict) -> None:
        await self._alongside(self.rt.store.audit({
            "id": new_id(), "business_id": run["business_id"], "run_id": run["id"], "actor_id": actor_id,
            "event_type": event_type, "workflow_key": run["workflow_key"], "workflow_version": run["workflow_version"],
            "source_channel": run.get("source_channel"), "source_reference": run.get("source_reference"),
            "correlation_id": run["correlation_id"], "detail": detail, "created_at": self.rt.clock().isoformat(),
        }))

    async def _event(self, run: dict, event_type: str, payload: dict | None = None) -> None:
        async def publish(event: dict) -> None:
            try:
                await self.rt.store.emit_event(event)
            except Exception as e:      # events are best-effort; they never fail the workflow
                logger.warning("agent event publish failed: %s", e)
        await self._alongside(publish({
            "id": new_id(), "business_id": run["business_id"], "type": event_type, "schema_version": 1,
            "run_id": run["id"], "correlation_id": run["correlation_id"], "causation_id": run.get("request_id"),
            "payload": {"workflow_key": run["workflow_key"], "status": run["status"], **(payload or {})},
            "created_at": self.rt.clock().isoformat(),
        }))

    # ══ Request intake ════════════════════════════════════════════════════════

    def supported_capabilities(self) -> list[str]:
        return list(WORKFLOWS)

    async def submit(self, req: AgentRequest, email: str | None = None) -> dict:
        """Canonical entry point for every channel (s8). Returns a result the caller can render."""
        with _Together() as work:
            try:
                if not req.part_of_message:
                    # What every start check needs, fetched together; each check then finds it already read.
                    await asyncio.gather(self.rt.store.get_policy(req.business_id), self.rt.business.record(req.business_id),
                                         self.rt.store.list_runs(req.business_id, limit=1000), self.rt.meter.balance(req.requesting_actor_id),
                                         self.rt.meter.plan(req.requesting_actor_id), return_exceptions=True)
                return await self._submit(req, email)
            finally:
                await work.settle()

    async def _submit(self, req: AgentRequest, email: str | None = None) -> dict:
        if req.source_channel not in SOURCE_CHANNELS:
            return {"kind": "blocked", "reason_codes": ["unsupported_channel"], "message": "Unsupported request channel."}
        actor, policy = await self.actor_for(req.requesting_actor_id, req.business_id, email)
        from app.shared.privacy import REFUSAL, is_bulk_contact_request
        if is_bulk_contact_request(req.raw_input):
            # A fixed server rule, whatever the wording: no bulk export of contact details.
            return {"kind": "blocked", "reason_codes": ["bulk_contact_export"], "message": REFUSAL}

        fact = memory.fact_in(req.raw_input) if not req.requested_capability else None
        if fact:
            # Nothing is remembered until the owner confirms it; this only asks.
            return {"kind": "remember", "fact": fact, "can_save": actor.is_owner,
                    "message": (f"Shall I remember this for this business? “{fact}”" if actor.is_owner
                                else "Only the workspace owner can save what I remember about this business.")}

        if req.raw_input and not req.requested_capability and not req.params and not req.part_of_message and req.source_channel in ("text", "ui_action"):
            parts = intent.split_requests(req.raw_input, self.supported_capabilities())
            if parts:
                # Each part is its own request, with every check applied to it separately.
                from dataclasses import replace
                results = [await self.submit(replace(req, raw_input=p, part_of_message=True, request_id=new_id()), email=email) for p in parts]
                return {"kind": "multi", "results": results, "message": f"I took that as {len(results)} requests."}

        capability = {"proposal": "new_proposal"}.get(req.requested_capability, req.requested_capability)      # asked for by its old name
        if capability and capability not in WORKFLOWS and capability not in FUTURE:
            capability = None      # a requested capability is only a candidate (s5.1)
        if not capability and req.raw_input:
            capability = await intent.resolve_capability(req.raw_input, Classifier(), actor.user_id, self.supported_capabilities())
        if capability == "marketplace_rfq":
            # Asked to deal with marketplace requests: a quotation is drafted for each one waiting.
            return await self._reply_to_requests(req, email)
        if capability in FUTURE:
            # Planned, not built: say so, and offer what is possible. Nothing is executed.
            return answers.unavailable(capability, FUTURE[capability])
        if not capability:
            # No workflow fits: nothing is executed (s5.1). Questions about the business are
            # answered from authoritative records, with the evidence; anything else goes to
            # the Business Assistant to answer conversationally.
            if req.raw_input:
                data = await self.visible_data(req.business_id)
                answer = answers.answer_question(req.raw_input, data, policy, self.rt.clock().date())
                if answer:
                    return {"kind": "answer", **answer}
            return {"kind": "assistant", "message": "Let me answer that from your business information."}
        wf = WORKFLOWS[capability]
        if req.source_channel not in wf.triggers and req.source_channel != "api":
            return {"kind": "blocked", "reason_codes": ["channel_not_allowed"], "message": "This task can't be started from that channel."}
        if capability == "enquiry_to_quote" and (req.params or {}).get("rfq_id"):
            # A marketplace request for a quotation, whether it arrived by itself or the owner asked
            # from its row: the reference is set here, so there is one task per request either way.
            req.source_channel, req.source_reference = rfqs.CHANNEL, rfqs.reference(str(req.params["rfq_id"]))

        # Voice: a transcript is evidence, not permission (s8.2).
        if req.source_channel == "voice" and not req.confirmed and (
            (req.transcript_confidence or 0) < 0.85 or AUTONOMY_RANK[wf.autonomy] >= AUTONOMY_RANK["A3"]
        ):
            return {"kind": "needs_confirmation", "reason_codes": ["voice_confirmation_required"], "capability": capability,
                    "message": f"I heard: “{req.raw_input}”. Shall I start “{wf.title}”?"}

        dedupe = req.source_reference and AUTONOMY_RANK[wf.autonomy] >= AUTONOMY_RANK["A3"]
        if dedupe:
            existing = await self._runs_for_reference(req.business_id, capability, req.source_reference)
            if existing:
                return await self._duplicate_result(req, capability, existing, actor)

        ent = await self.entitlement(req.business_id)
        decision = await self.check_start(actor, wf, ent, essential=bool(getattr(req, "essential_handoff", False)))
        if not decision.allowed:
            return {"kind": "blocked", "capability": capability, "upgrade": not ent["is_paid"] or "plan" in decision.reason_codes[0],
                    **decision.as_dict(), "plan": ent["plan"], **await self._why_blocked(decision, wf, ent, actor)}

        targets = await self._targets(req, wf, actor)
        if targets.get("switch"):
            # Nothing on record to start from: the same request, started from scratch instead.
            from dataclasses import replace
            return await self._submit(replace(req, requested_capability=targets["switch"], part_of_message=True, request_id=new_id()), email=email)
        if targets.get("kind"):
            return {**targets, "capability": capability}
        runs = []
        repeats: list[dict] = []
        for params in targets["runs"]:
            if wf.workflow_key == "payment_followup":
                earlier, same = await self._existing_followup(req.business_id, params.get("invoice_id"), policy)
                if earlier and same:      # already open or already checked, same answer: shown once, no new task, no quota used
                    repeats.append(earlier)
                    continue
                if earlier:               # it was blocked and the cause has gone: carry that task on
                    runs.append(await self.retry(earlier["id"], actor.user_id, email))
                    continue
            try:
                run = await self._create_run(req, wf, actor, ent, params, dedupe=bool(dedupe))
            except DuplicateRun:
                # The same request arrived at the same moment and won the race: use its run.
                if params.get("enquiry_id"):
                    await self.rt.store.update_enquiry(params["enquiry_id"], {"status": "duplicate"})
                existing = await self._runs_for_reference(req.business_id, capability, req.source_reference)
                return await self._duplicate_result(req, capability, existing, actor)
            runs.append(await self._begin(run, actor, req))
            if params is not targets["runs"][-1]:
                decision = await self.check_start(actor, wf, ent, essential=bool(getattr(req, "essential_handoff", False)))
                if not decision.allowed:
                    break
        if not runs and repeats:
            first = repeats[0]
            await self._audit(first, "repeat_suppressed", actor.user_id,
                              {"reason_code": first.get("reason_code") or (first["state"].get("outcome") or {}).get("reason")})
            lead = ("I checked this recently and nothing has changed, so I haven't started another task."
                    if first["status"] == RUN_SUCCEEDED else "There's already a task open for this, so I haven't started another.")
            return {"kind": "workflow", "capability": capability, "runs": repeats, "run": first, "duplicate": True, "repeat": True,
                    "message": f"{lead} {first.get('summary') or ''}".strip()}
        if not runs:
            return {"kind": "answer", "capability": capability, "message": "There was nothing to start."}
        used = sum(int(c.get("credits") or 0) for r in runs for c in (r.get("state") or {}).get("credits") or [])
        return {"kind": "workflow", "capability": capability, "runs": runs, "run": runs[0],
                "credits_used": used, "credits_left": await self.rt.meter.balance(actor.user_id)}

    async def _reply_to_requests(self, req: AgentRequest, email: str | None) -> dict:
        """One Enquiry to Quote task for each marketplace request still waiting for a reply. Each
        goes through the same start checks as any task and stops for approval before sending."""
        data = await self.visible_data(req.business_id)
        waiting = [r for r in (data.get("financials") or {}).get("rfq_requests") or [] if isinstance(r, dict) and rfqs.status_of(r) == "pending"]
        if not waiting:
            return {"kind": "answer", "message": "Every Marketplace request has been answered: none is waiting for a reply.",
                    "actions": [{"label": "Start a new quotation", "capability": "enquiry_to_quote"}]}
        runs: list[dict] = []
        for row in waiting[:5]:
            res = await self.submit(AgentRequest(
                requesting_actor_id=req.requesting_actor_id, business_id=req.business_id, source_channel="ui_action",
                requested_capability="enquiry_to_quote", params={"rfq_id": str(row["id"])},
                resolved_goal="Reply to a marketplace request for a quotation"), email=email)
            if res.get("kind") == "blocked":
                return res if not runs else {"kind": "workflow", "capability": "enquiry_to_quote", "runs": runs, "run": runs[0]}
            runs += res.get("runs") or []
        if not runs:
            return {"kind": "answer", "message": "There was nothing to start for the requests that are waiting."}
        return {"kind": "workflow", "capability": "enquiry_to_quote", "runs": runs, "run": runs[0]}

    def _followup_reason(self, inv: dict | None, data: dict, policy: dict, now: datetime) -> str | None:
        """What a payment follow-up for this invoice would come to right now, without running
        it: the reason it would be skipped or blocked, or None if a reminder could be prepared."""
        from app.modules.agent.tools import _customer_email
        reason = bz.followup_skip_reason(inv, policy, now)
        if reason:
            return reason
        if len(inv.get("reminders") or []) >= int((policy.get("reminders") or {}).get("max_reminders") or 3):
            return "reminders_exhausted"
        refused = {str(e).lower() for c in (data.get("catalogue") or {}).get("customers") or [] for e in c.get("refused_emails") or []}
        to = _customer_email(inv, data)
        return "invalid_customer_destination" if not to or to.lower() in refused else None

    async def _existing_followup(self, business_id: str, invoice_id: str | None, policy: dict) -> tuple[dict | None, bool]:
        """A follow-up that already covers this invoice, so another isn't started:
          * one still in progress (running, waiting, awaiting approval)  -> (run, True)
          * one blocked for the reason that still applies                -> (run, True)
          * one blocked for a reason that has since gone                 -> (run, False): resume it
          * one skipped recently for the reason that still applies      -> (run, True)
        """
        if not invoice_id:
            return None, False
        data = await self.rt.business.load(business_id)
        inv = bz.find((data.get("financials") or {}).get("invoices") or [], invoice_id)
        now = self.rt.clock()
        reason = self._followup_reason(inv, data, policy, now) if inv else "invoice_not_found"
        ids = {str(invoice_id), str((inv or {}).get("id") or ""), str((inv or {}).get("legacy_id") or "")} - {""}
        mine = [r for r in await self.rt.store.list_runs(business_id, limit=500)
                if r["workflow_key"] == "payment_followup" and str((r.get("state") or {}).get("invoice_id")) in ids]
        mine.sort(key=lambda r: r.get("created_at") or "")      # the oldest open task is the one kept

        active = next((r for r in mine if r["status"] not in RUN_TERMINAL), None)
        if active:
            return active, True
        blocked = [r for r in mine if r["status"] == RUN_FAILED]
        if blocked:
            same = next((r for r in blocked if r.get("reason_code") == reason), None)
            return (same, True) if same else (blocked[0], False)
        if not reason or reason in bz.HOLD_REASONS:
            return None, False
        days = (policy.get("reminders") or {}).get("skip_repeat_days")
        since = (now - timedelta(days=7 if days is None else int(days))).isoformat()
        for r in reversed(mine):
            outcome = (r.get("state") or {}).get("outcome") or {}
            if (r["status"] == RUN_SUCCEEDED and outcome.get("skipped") and outcome.get("reason") == reason
                    and (r.get("completed_at") or r.get("created_at") or "") >= since):
                return r, True
        return None, False

    async def _close_duplicates(self, kept: dict, actor_id: str) -> int:
        """Other tasks stopped for the same reason on the same record are duplicates of `kept`:
        close them, and give back the allowance they used."""
        state = kept.get("state") or {}
        target = state.get("invoice_id") or state.get("quote_id")
        if not target:
            return 0
        closed = 0
        for r in await self.rt.store.list_runs(kept["business_id"], limit=500):
            other = r.get("state") or {}
            if (r["id"] == kept["id"] or r["status"] != RUN_FAILED or r["workflow_key"] != kept["workflow_key"]
                    or r.get("reason_code") != kept.get("reason_code") or (other.get("invoice_id") or other.get("quote_id")) != target):
                continue
            r["state"] = {**other, "duplicate_of": kept["id"]}
            for a in await self.rt.store.list_approvals(run_id=r["id"], status=APPROVAL_PENDING):
                await self.rt.store.update_approval(a["id"], {"status": APPROVAL_CANCELLED})
            await self._finish(r, RUN_CANCELLED, None, "duplicate_closed", "Closed automatically: a duplicate of a task that has now been dealt with.")
            closed += 1
        if closed:
            await self._audit(kept, "duplicates_closed", actor_id, {"count": closed})
        return closed

    async def resolve_delivery(self, run_id: str, user_id: str, outcome: str, email: str | None = None) -> dict:
        """A send that could not be confirmed, and is too old to retry safely: a person says
        whether it arrived ("delivered": record it as sent, send nothing) or not ("resend")."""
        run, actor = await self._owned_run(run_id, user_id, email)
        if not actor.can_send or actor.is_system:
            raise AccessDenied("Your role can't decide this.")
        question = (run.get("state") or {}).get("delivery_question")
        if run["status"] != RUN_FAILED or run.get("reason_code") != "delivery_unconfirmed" or not question:
            raise Conflict("no_delivery_question", "This task isn't waiting for a delivery decision.")
        if outcome not in ("delivered", "resend"):
            raise Conflict("invalid_outcome", "Choose whether it was delivered, or should be sent again.")
        state = run["state"]
        state.setdefault("delivery_decisions", {})[question["key"]] = {"outcome": outcome, "by": user_id, "at": self.rt.clock().isoformat()}
        state.pop("delivery_question", None)
        await self.rt.store.update_run(run_id, {"state": state})
        await self._audit(run, "delivery_decided_by_user", user_id, {"tool": question.get("tool"), "outcome": outcome, "to": question.get("to")})
        return await self.retry(run_id, user_id, email)

    async def _targets(self, req: AgentRequest, wf: WorkflowDefinition, actor: Actor) -> dict:
        """Resolve what the workflow should act on. Never guesses between several candidates."""
        p = dict(req.params or {})
        key = wf.workflow_key
        if key in ("risk_concentration", "scenario_help"):
            return {"runs": [p]}
        data = await self.rt.business.load(req.business_id)
        today = self.rt.clock().date()
        invoices = (data.get("financials") or {}).get("invoices") or []

        if key == "enquiry_to_quote" and p.get("rfq_id"):
            # Everything the task works from is read from the request on record, not from the caller.
            row = rfqs.find(data, str(p["rfq_id"]))
            if not row:
                return {"kind": "answer", "message": "That marketplace request is no longer there."}
            if rfqs.status_of(row) != "pending":
                return {"kind": "answer", "message": "That marketplace request has already been answered or declined, so there is nothing to draft."}
            if not await self.rt.meter.rfq_unlocked(await self.rt.business.owner_id(req.business_id)):
                from app.modules.addons.service import RFQ_LOCKED_MESSAGE
                return {"kind": "blocked", "reason_codes": ["rfq_upgrade_required"], "reason": "plan", "upgrade": True, "message": RFQ_LOCKED_MESSAGE,
                        "actions": [{"label": "Upgrade", "to": "/pricing", "upgrade": True}]}
            about = rfqs.brief(row)
            enquiry = await self.rt.store.create_enquiry({
                "id": new_id(), "business_id": req.business_id, "source": rfqs.CHANNEL,
                "sender_name": about["company"] or str(row.get("customer_name") or "").strip(),
                "sender_email": str(row.get("customer_email") or "").strip(),
                "subject": "Marketplace request for a quotation", "body": rfqs.enquiry_text(row),
                "status": "new", "created_by": actor.user_id, "created_at": self.rt.clock().isoformat(),
            })
            run_params: dict[str, Any] = {"rfq_id": about["rfq_id"], "enquiry_id": enquiry["id"], "rfq": about}
            unsure = rfqs.doubt(row.get("message"))
            if unsure:
                run_params["classification_doubt"] = unsure
            else:
                run_params["classification"] = "quotation_request"
            return {"runs": [run_params]}

        if key == "enquiry_to_quote":
            if not p.get("enquiry_id"):
                body = (p.get("body") or req.raw_input or "").strip()
                if not body:
                    return {"kind": "needs_input", "message": "Paste the customer's enquiry and I'll prepare a quotation.",
                            "fields": [{"key": "body", "label": "Customer enquiry", "type": "textarea", "required": True},
                                       {"key": "sender_name", "label": "Customer name", "type": "text"},
                                       {"key": "sender_email", "label": "Customer email", "type": "email"}]}
                from_prompt = req.source_channel in ("text", "voice") and not p.get("body")
                import re
                named = re.search(r"\bfor\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})", body) if from_prompt else None
                enquiry = await self.rt.store.create_enquiry({
                    "id": new_id(), "business_id": req.business_id,
                    "source": "user_request" if from_prompt else (p.get("source") or "manual"),
                    "sender_name": p.get("sender_name") or (named.group(1).strip() if named else ""),
                    "sender_email": p.get("sender_email") or "", "subject": p.get("subject") or "",
                    "body": body[:8000], "status": "new", "created_by": actor.user_id,
                    "created_at": self.rt.clock().isoformat(),
                })
                p["enquiry_id"] = enquiry["id"]
                if from_prompt:
                    p["classification"] = "quotation_request"      # the user asked for a quotation directly
            return {"runs": [p]}

        if key == "quote_to_cash":
            if p.get("quote_id"):
                return {"runs": [p]}
            invoiced = {i.get("quote_id") for i in invoices if i.get("quote_id") and not i.get("archived")}
            ready = [q for q in bz.quotes_of(data) if bz.status_of(q) in ("accepted", "won") and q["id"] not in invoiced and not q.get("archived")]
            # A quotation named by its number ("invoice QUO-2041026") is that one: nothing to ask.
            wanted = str(req.raw_input or "").lower()
            numbered = next((q for q in bz.quotes_of(data) if bz.status_of(q) in ("accepted", "won", "sent") and q["id"] not in invoiced and not q.get("archived")
                             and str(q.get("reference") or q.get("quotation_id") or "").strip()
                             and str(q.get("reference") or q.get("quotation_id")).lower() in wanted), None)
            if numbered:
                return {"runs": [{**p, "quote_id": numbered["id"]}]}
            if len(ready) == 1:
                return {"runs": [{**p, "quote_id": ready[0]["id"]}]}
            options = ready or [q for q in bz.quotes_of(data) if bz.status_of(q) == "sent" and q["id"] not in invoiced]
            if not options:
                return {"switch": "new_invoice"}      # no quotation to convert: a new invoice instead, never a dead end
            return {"kind": "needs_input", "message": "Which quotation should I turn into an invoice?",
                    "fields": [{"key": "quote_id", "label": "Quotation", "type": "choice", "required": True, "options": [
                        {"value": q["id"], "label": f"{q.get('reference') or q.get('quotation_id') or q['id'][:8]} · {q.get('customer_name') or ''} · {bz.status_of(q)}"}
                        for q in options[:20]]}]}

        if key == "payment_followup":
            def not_due_yet(i: dict) -> bool:
                return bz.reminder_block_reason(i, today) == "invoice_not_overdue"
            if p.get("invoice_id"):
                return {"runs": [p]}
            policy = await self.rt.store.get_policy(req.business_id)
            overdue = bz.eligible_for_reminder(data, policy, self.rt.clock())
            if overdue:
                return {"runs": [{**p, "invoice_id": i["id"]} for i in overdue[:10]]}
            if req.source_channel not in ("text", "voice", "ui_action"):
                return {"kind": "answer", "message": "No overdue invoices are eligible for a reminder right now."}
            # Nothing is overdue. Unpaid invoices can still be reminded ahead of their due date.
            coming = [i for i in invoices if isinstance(i, dict) and not i.get("archived") and not_due_yet(i)]
            named = [i for i in coming if str(i.get("reference") or i.get("invoice_number") or "").lower() in (req.raw_input or "").lower()
                     and (i.get("reference") or i.get("invoice_number"))]
            if len(named) == 1 or len(coming) == 1:
                return {"runs": [{**p, "invoice_id": (named or coming)[0]["id"], "upcoming": True}]}
            if coming:
                return {"kind": "needs_input", "message": "Nothing is overdue. Which invoice should I send a reminder for, ahead of its due date?",
                        "params": {"upcoming": True},      # carried with the answer, so the reminder is the "due soon" one
                        "fields": [{"key": "invoice_id", "label": "Invoice", "type": "choice", "required": True, "options": [
                            {"value": i["id"], "label": f"{i.get('reference') or i.get('invoice_number') or i['id'][:8]} · {i.get('customer_name') or ''} · due {str(i.get('due_date'))[:10]}"}
                            for i in coming[:20]]}]}
            from app.modules.agent import newdocs
            if newdocs._unpaid(data):
                # Something is owed, but each has had its reminder recently (or is on hold): said as it is.
                return {"kind": "answer", "message": "No overdue invoices are eligible for a reminder right now: each has been reminded recently or is on hold."}
            return {"kind": "answer", "message": "Nothing is owed right now: every invoice is paid, so there is no one to remind.",
                    "actions": [{"label": "Start a new invoice", "capability": "new_invoice"}]}

        if key == "receipt_send":
            if p.get("invoice_id"):
                return {"runs": [p]}
            waiting = [i for i in invoices if not i.get("archived")
                       and any(not (pm.get("receipt") or {}).get("sent_at") for pm in (i.get("payments") or []))]
            if waiting:
                return {"runs": [{**p, "invoice_id": i["id"]} for i in waiting[:10]]}
            if req.source_channel not in ("text", "voice", "ui_action"):
                return {"kind": "answer", "message": "There are no confirmed payments waiting for a receipt."}
            from app.modules.agent import newdocs
            if newdocs._unpaid(data):
                return {"runs": [{**p, "record_payment": True}]}      # no payment yet: recorded in the same form, then the receipt
            return {"kind": "answer", "message": "No payment is on record and no invoice is waiting to be paid, so there is nothing to receipt yet.",
                    "actions": [{"label": "Start a new invoice", "capability": "new_invoice"}]}
        return {"runs": [p]}

    async def _runs_for_reference(self, business_id: str, capability: str, source_reference: str) -> list[dict]:
        rows = await self.rt.store.runs_for_reference(business_id, capability, source_reference)
        return [r for r in rows if r["status"] != RUN_CANCELLED]

    async def _duplicate_result(self, req: AgentRequest, capability: str, existing: list[dict], actor: Actor) -> dict:
        first = existing[0]
        await self._audit(first, "duplicate_request", actor.user_id,
                          {"source_reference": req.source_reference, "source_channel": req.source_channel})
        return {"kind": "workflow", "capability": capability, "runs": existing, "run": first, "duplicate": True,
                "message": "This request was already received, so I'm showing the task it started instead of starting another."}

    async def _create_run(self, req: AgentRequest, wf: WorkflowDefinition, actor: Actor, ent: dict, params: dict,
                          dedupe: bool = False) -> dict:
        now = self.rt.clock().isoformat()
        budget = dict(config.PAID_BUDGET if ent["is_paid"] else config.DEFAULT_BUDGET)
        state: dict[str, Any] = {"params": params, "answers": {}}
        if wf.workflow_key in ("idea_validation", "market_size", "business_plan_draft") and req.raw_input:
            from app.modules.agent import said
            named = said.idea_in(req.raw_input)
            if named:      # "Validate my idea: a mobile car wash in Abuja": that is the idea, whatever the profile says
                state["answers"]["description"] = named
                state["idea_from_message"] = True
        for k in ("enquiry_id", "quote_id", "invoice_id", "classification", "rfq_id"):
            if params.get(k):
                state[k] = params[k]
        run = {
            "id": new_id(), "business_id": req.business_id, "requester_id": actor.user_id, "requester_email": actor.email,
            "workflow_key": wf.workflow_key, "workflow_version": wf.version, "capability": wf.capability,
            "family": wf.family, "title": wf.title, "status": RUN_CREATED, "substatus": None, "reason_code": None,
            "goal": (req.resolved_goal or req.raw_input or wf.title)[:500],
            "source_channel": req.source_channel, "source_reference": req.source_reference,
            "request_id": req.request_id, "correlation_id": req.correlation_id,
            "recommendation_id": req.recommendation_id,
            "dedupe_key": dedupe_key(wf.capability, req.source_reference, params) if dedupe else None,
            "state": state, "budget": {**budget, "steps": 0, "llm_calls": 0, "external_calls": 0},
            "current_step": wf.steps[0].key, "seq": 0, "wake_at": None, "summary": None, "next_action": None,
            "pending_question": None, "error": None, "created_at": now, "updated_at": now, "completed_at": None,
        }
        run = await self.rt.store.create_run(run)
        await self._audit(run, "workflow_started", actor.user_id, {"goal": run["goal"], "plan": ent["plan"],
                                                                 "recommendation_id": req.recommendation_id})
        await self._event(run, "WorkflowStarted")
        return run

    # ══ Engine ════════════════════════════════════════════════════════════════

    async def _begin(self, run: dict, actor: Actor, req: AgentRequest) -> dict:
        """Carry a new task forward: here and now, or in the background when the caller will watch it."""
        if not req.background:
            return await self.advance(run["id"], actor=actor)
        run["state"]["background"] = True
        await self.rt.store.update_run(run["id"], {"state": run["state"]})
        self.advance_later(run["id"], actor)
        return {**run, "status": RUN_RUNNING}

    PICK_UP_AFTER = timedelta(seconds=90)

    def abandoned(self, run: dict) -> bool:
        """Started in the background, mid-step, with nothing here carrying it on and no change for
        a minute and a half: the server that was running it has gone (a restart or a deploy)."""
        if not (run.get("state") or {}).get("background") or run["id"] in _ADVANCING:
            return False
        if run.get("status") not in (RUN_CREATED, RUN_RUNNING) or run.get("substatus") or run.get("pending_question") or run.get("wake_at"):
            return False
        last = bz._moment(run.get("updated_at") or run.get("created_at"))
        return bool(last and self.rt.clock() - last > self.PICK_UP_AFTER)

    async def pick_up(self, run: dict) -> bool:
        """Carry an abandoned background task on from its last finished step. Finished steps are
        not repeated and nothing is sent twice."""
        if not self.abandoned(run):
            return False
        await self._audit(run, "picked_up", "system", {"last_update": run.get("updated_at"), "step": run.get("current_step")})
        self.advance_later(run["id"])
        return True

    def advance_later(self, run_id: str, actor: Actor | None = None) -> None:
        """Carry the task on without holding up the request. A task that never gets to run
        (the server stopped) is picked up by the same check that releases any stalled task."""
        async def go() -> None:
            from app.core import supabase as sb
            _WRITES.set(None)
            sb._reads.set(None)
            try:
                await self.advance(run_id, actor=actor)
            except Exception:      # noqa: BLE001 - the task's own state says what happened
                logger.exception("background advance failed for task %s", run_id)
        try:
            task = asyncio.get_running_loop().create_task(go())
        except RuntimeError:
            return
        _BACKGROUND.add(task)
        task.add_done_callback(_BACKGROUND.discard)

    async def advance(self, run_id: str, actor: Actor | None = None) -> dict:
        """Run steps until the workflow waits, needs approval, finishes or stops.
        Safe to call repeatedly: it always resumes from the last confirmed step (AC-13)."""
        import time
        began = time.perf_counter()
        _ADVANCING.add(run_id)
        out = None
        try:
            with _Together() as work:      # the business record and settings are read once, not once per step
                try:
                    out = await self._advance(run_id, actor)
                    return out
                finally:
                    await work.settle()
        finally:
            _ADVANCING.discard(run_id)
            logger.info("agent task %s advanced in %.2fs: now %s at step %s", run_id, time.perf_counter() - began,
                        (out or {}).get("status"), (out or {}).get("current_step"))

    async def _advance(self, run_id: str, actor: Actor | None = None) -> dict:
        run = await self.rt.store.get_run(run_id)
        if not run or run["status"] in RUN_TERMINAL or run["status"] == RUN_AWAITING_APPROVAL:
            return run
        wf = WORKFLOWS[run["workflow_key"]]
        policy = await self.rt.store.get_policy(run["business_id"])
        ent = await self.entitlement(run["business_id"])
        if actor is None:
            try:
                actor = await self.rt.business.actor(run["requester_id"], run["business_id"], policy, run.get("requester_email"))
            except bz.BusinessAccessDenied:
                return await self._finish(run, RUN_FAILED, SUB_BLOCKED, "permission_changed",
                                          "The person who started this no longer has access to the business.")
        ctx = Ctx(orch=self, run=run, wf=wf, actor=actor, policy=policy, limits=ent, owner_id=ent["owner_id"])
        run.update({"status": RUN_RUNNING, "substatus": None, "reason_code": None, "error": None, "wake_at": None, "pending_question": None})

        created = datetime.fromisoformat(run["created_at"])
        if self.rt.clock() - created > timedelta(days=run["budget"]["max_runtime_days"]):
            return await self._finish(run, RUN_FAILED, SUB_BLOCKED, "budget_exceeded", "This task ran past its time limit.")

        for _ in range(_MAX_STEPS_PER_ADVANCE):
            if run["budget"]["steps"] >= run["budget"]["max_steps"]:
                return await self._finish(run, RUN_FAILED, SUB_BLOCKED, "budget_exceeded", "This task reached its step limit.")
            step_def = wf.steps[wf.step_index(run["current_step"])]
            run["seq"] += 1
            run["budget"]["steps"] += 1
            step = {
                "id": new_id(), "run_id": run["id"], "business_id": run["business_id"], "seq": run["seq"],
                "step_key": step_def.key, "title": step_def.title, "state": STEP_RUNNING, "retry_count": 0,
                "started_at": self.rt.clock().isoformat(), "finished_at": None, "error": None,
            }
            # The row is written once, with whatever the step has to record: when a tool first
            # acts, or when the step ends. A step that only looks things up is one write, not two.
            step["_unsaved"] = True
            ctx.step = step
            ctx.step_key, ctx.step_id, ctx.notes = step_def.key, step["id"], []
            try:
                result = await step_def.handler(ctx)
            except NeedsInformation as ni:
                result = WaitForInput(ni.question, ni.fields)
            except NeedsApproval as na:
                return await self._await_approval(ctx, step, na)
            except GuardrailBlocked as g:
                return await self._stop(ctx, step, g.decision.reason_codes[0], g.decision.message, SUB_BLOCKED)
            except InsufficientCredits:
                return await self._stop(ctx, step, "credits_exhausted",
                                        "You're out of AI Credits. Nothing was lost; top up or upgrade, then retry.", SUB_BLOCKED)
            except DeliveryUnconfirmed as e:
                return await self._stop(ctx, step, "delivery_unconfirmed", str(e), SUB_DELIVERY_UNCERTAIN)
            except DeliveryUncertain as e:
                return await self._stop(ctx, step, "delivery_status_uncertain",
                                        f"I couldn't confirm whether the message was delivered ({e}). I'll check again shortly; it will not be sent twice.",
                                        SUB_DELIVERY_UNCERTAIN)
            except ToolStop as s:
                return await self._stop(ctx, step, s.reason_code, s.message, SUB_BLOCKED)
            except ToolFailed as e:
                return await self._stop(ctx, step, "action_failed", f"{e} Nothing was sent. I'll have another go shortly.", SUB_RETRY_AVAILABLE)
            except Exception as e:      # noqa: BLE001 - any unexpected error becomes a recoverable state
                logger.exception("agent step %s failed", step_def.key)
                return await self._stop(ctx, step, "unexpected_error", f"Something went wrong: {e}. I'll have another go shortly.", SUB_RETRY_AVAILABLE)

            summary = " ".join(ctx.notes) or None
            if isinstance(result, WaitForInput):
                await self._step_update(step, {"state": STEP_AWAITING_INPUT, "finished_at": self.rt.clock().isoformat(), "note": result.question})
                run.update({"substatus": SUB_WAITING_INFO, "pending_question": {"question": result.question, "fields": _offer_vat_default(await self._with_what_was_said(run, result.fields))},
                            "next_action": result.question})
                return await self._save(run, summary)
            if isinstance(result, WaitForEvent):
                await self._step_update(step, {"state": STEP_SUCCEEDED, "finished_at": self.rt.clock().isoformat(), "note": result.reason})
                run.update({"substatus": SUB_WAITING_EVENT, "wake_at": result.wake_at.isoformat() if result.wake_at else None,
                            "next_action": result.reason,
                            "pending_question": {"question": result.question, "fields": result.fields, "optional": True} if result.question else None})
                return await self._save(run, summary)
            if isinstance(result, Stop):
                return await self._stop(ctx, step, result.reason_code, result.message, result.substatus)
            if isinstance(result, Done) and result.skipped:
                # Nothing was done, correctly. The step that would have acted (this one if it is
                # the last, otherwise those after it) is recorded as skipped, with the reason.
                finished = self.rt.clock().isoformat()
                reason = (result.outcome or {}).get("reason")
                rest = wf.steps[wf.step_index(step_def.key) + 1:]
                await self._step_update(step, {
                    "state": STEP_SUCCEEDED if rest else STEP_SKIPPED, "finished_at": finished, "note": result.summary,
                    "reason_code": None if rest else reason})
                for later in rest:
                    run["seq"] += 1
                    await self.rt.store.add_step({
                        "id": new_id(), "run_id": run["id"], "business_id": run["business_id"], "seq": run["seq"],
                        "step_key": later.key, "title": later.title, "state": STEP_SKIPPED, "retry_count": 0,
                        "started_at": finished, "finished_at": finished, "error": None, "reason_code": reason, "note": result.summary})
                run["state"]["outcome"] = {**result.outcome, "skipped": True}
                run.update({"next_action": result.next_action})
                await self._audit(run, "action_skipped", ctx.actor.user_id, {"reason_code": reason, "summary": result.summary})
                return await self._finish(run, RUN_SUCCEEDED, None, None, result.summary)
            if isinstance(result, Done):
                await self._step_update(step, {"state": STEP_SUCCEEDED, "finished_at": self.rt.clock().isoformat(), "note": result.summary})
                run["state"]["outcome"] = result.outcome
                run.update({"next_action": result.next_action})
                return await self._finish(run, RUN_SUCCEEDED, None, None, result.summary)
            # Next
            done = self._step_update(step, {"state": STEP_SUCCEEDED, "finished_at": self.rt.clock().isoformat(), "note": summary})
            target = result.step if isinstance(result, Next) and result.step else None
            idx = wf.step_index(target) if target else wf.step_index(step_def.key) + 1
            if idx >= len(wf.steps):
                await done
                return await self._finish(run, RUN_SUCCEEDED, None, None, summary or "Done.")
            run["current_step"] = wf.steps[idx].key
            await asyncio.gather(done, self._save(run, summary))      # the finished step and the move to the next, written together
        return await self._save(run, None)

    async def _save(self, run: dict, summary: str | None) -> dict:
        patch = {k: run[k] for k in ("status", "substatus", "reason_code", "state", "budget", "current_step", "seq",
                                     "wake_at", "next_action", "pending_question", "error", "completed_at")}
        if summary:
            run["summary"] = summary
            patch["summary"] = summary
        await self.rt.store.update_run(run["id"], patch)
        return run

    async def _finish(self, run: dict, status: str, substatus: str | None, reason: str | None, summary: str) -> dict:
        terminal = status in RUN_TERMINAL
        run.update({"status": status, "substatus": substatus, "reason_code": reason, "wake_at": None, "pending_question": None,
                    "error": summary if status == RUN_FAILED else None,
                    "completed_at": self.rt.clock().isoformat() if terminal and status != RUN_FAILED else None})
        if status == RUN_FAILED:
            run["next_action"] = summary
            run["state"]["failed_at"] = self.rt.clock().isoformat()      # the back-off before trying again counts from here
        if status == RUN_SUCCEEDED:
            await self._charge_for_the_task(run)
        await self._save(run, summary)
        if status == RUN_CANCELLED:
            await self.rt.store.release_dedupe(run["id"])
        await self._audit(run, f"workflow_{status}", run["requester_id"], {"reason_code": reason, "summary": summary})
        await self._event(run, {RUN_SUCCEEDED: "WorkflowSucceeded", RUN_FAILED: "WorkflowFailed"}.get(status, "WorkflowStatusChanged"),
                          {"reason_code": reason})
        return run

    async def _charge_for_the_task(self, run: dict) -> None:
        """The task price, taken once when a task has succeeded and none of its steps charged
        anything: so every task costs the same each time, a failed or cancelled one costs nothing,
        and the owner's own edits are never charged. Skipped: a task that did nothing, a repeat of
        another, one priced by its own product, and a free first task."""
        state = run.setdefault("state", {})
        if state.get("credits") or state.get("task_charged") or state.get("duplicate_of") or (state.get("outcome") or {}).get("skipped"):
            return
        if run.get("workflow_key") in config.SELF_PRICED or state.get("first_task_free"):
            return
        from app.modules.agent import autostart
        if run.get("source_channel") == autostart.CHANNEL:
            return      # started by the system, not asked for: its spending is what the automatic budget governs, and unpriced preparation stays free
        state["task_charged"] = True      # decided once, whatever happens next: a retry never charges again
        try:
            payer = run.get("requester_id") if run.get("requester_id") not in (None, "system") else await self.rt.business.owner_id(run["business_id"])
            async with self.rt.meter.charge(payer, config.BASE_TASK_FEATURE):
                pass
            await self.note_spend(run, config.BASE_TASK_FEATURE, "task")
        except InsufficientCredits:
            state["task_charge_missed"] = True      # the work is done and kept; the balance was already too low to take it
        except Exception:      # noqa: BLE001 - the price list is unreachable: the finished task is not undone for it
            logger.warning("agent: the task price could not be taken for run %s", run.get("id"), exc_info=True)

    async def _stop(self, ctx: Ctx, step: dict, reason: str, message: str, substatus: str) -> dict:
        await self._step_update(step, {"state": STEP_FAILED, "finished_at": self.rt.clock().isoformat(), "error": message, "reason_code": reason})
        await self._audit(ctx.run, "guardrail_stop", ctx.actor.user_id, {"step": ctx.step_key, "reason_code": reason, "message": message})
        return await self._finish(ctx.run, RUN_FAILED, substatus, reason, message)

    async def _await_approval(self, ctx: Ctx, step: dict, na: NeedsApproval) -> dict:
        run = ctx.run
        h = na.summary["payload_hash"]
        prior = [a for a in await self.rt.store.list_approvals(run_id=run["id"])
                 if a["step_key"] == ctx.step_key and a["tool_id"] == na.tool_id]
        approval = next((a for a in prior if a["status"] == APPROVAL_PENDING and a["payload_hash"] == h), None)
        for a in prior:
            if a["status"] == APPROVAL_PENDING and a["payload_hash"] != h:
                # The action changed while waiting: the old request must not be approvable.
                await self.rt.store.update_approval(a["id"], {"status": APPROVAL_INVALIDATED, "decided_note": "Superseded by an updated action."})
        version = len(prior) + 1
        if not approval:
            now = self.rt.clock()
            approval = await self.rt.store.create_approval({
                "id": new_id(), "run_id": run["id"], "business_id": run["business_id"], "step_key": ctx.step_key,
                "tool_id": na.tool_id, "tool_version": REGISTRY[na.tool_id].version, "title": na.title,
                "payload": na.payload, "payload_hash": h, "payload_version": version, "status": APPROVAL_PENDING,
                "requester_id": run["requester_id"], "approver_id": None, "decided_at": None, "decided_note": None,
                "expires_at": (now + timedelta(hours=int(ctx.policy.get("approval_expiry_hours") or 72))).isoformat(),
                "workflow_key": run["workflow_key"], "capability": run["capability"], "created_at": now.isoformat(),
            })
            await self._audit(run, "approval_requested", ctx.actor.user_id,
                              {"approval_id": approval["id"], "tool": na.tool_id, "payload_hash": h, "payload_version": version})
        await self._step_update(step, {"state": STEP_AWAITING_APPROVAL, "finished_at": self.rt.clock().isoformat(), "note": na.title})
        run.update({"status": RUN_AWAITING_APPROVAL, "substatus": None, "next_action": f"Needs approval: {na.title}"})
        await self._save(run, " ".join(ctx.notes) or None)
        await self._event(run, "WorkflowAwaitingApproval", {"approval_id": approval["id"]})
        return run

    # ══ Human control ═════════════════════════════════════════════════════════

    async def _owned_run(self, run_id: str, user_id: str, email: str | None = None) -> tuple[dict, Actor]:
        run = await self.rt.store.get_run(run_id)
        if not run:
            raise AccessDenied("Not found.")
        actor, _ = await self.actor_for(user_id, run["business_id"], email)      # business scope enforced here
        return run, actor

    @_together
    async def provide_input(self, run_id: str, user_id: str, answers: dict, email: str | None = None, background: bool = False) -> dict:
        run, actor = await self._owned_run(run_id, user_id, email)
        if not actor.can_prepare:
            raise AccessDenied("Your role can't answer for this task.")
        if run["status"] in RUN_TERMINAL:
            raise Conflict("run_finished", f"This task has already {_ended(run)}, so there's nothing to answer.")
        if run["status"] == RUN_AWAITING_APPROVAL:
            raise Conflict("no_pending_question", "This task is waiting for approval, not for an answer. "
                                                  "To change what will be sent, edit the draft.")
        if run["status"] != RUN_RUNNING or not run.get("pending_question"):
            raise Conflict("no_pending_question", "This task isn't waiting for an answer.")
        allowed = {f["key"] for f in run["pending_question"]["fields"]}
        clean = {k: v for k, v in (answers or {}).items() if k in allowed}      # only what was asked for
        if not clean:
            raise Conflict("no_matching_answer", "None of those answers match the question this task is asking.")
        run["state"].setdefault("answers", {}).update(clean)
        if clean.get("save_vat_default") and clean.get("vat_rate") not in (None, "") and actor.is_owner:
            # "Save as my default": written to Agent settings, so the VAT rate is never asked for again.
            try:
                await self.rt.store.set_policy(run["business_id"], {"default_vat_rate": float(clean["vat_rate"])}, user_id)
                await self._audit(run, "policy_changed", user_id, {"default_vat_rate": float(clean["vat_rate"]), "from": "task_question"})
            except Exception:      # noqa: BLE001 - the answer still stands for this task
                logger.warning("could not save the default VAT rate for %s", run["business_id"], exc_info=True)
        if str(clean.get("business_name") or "").strip() or str(clean.get("business_email") or "").strip():
            await self._save_business_details(run["business_id"], str(clean.get("business_name") or "").strip(),
                                              str(clean.get("business_email") or "").strip())
        if str(clean.get("customer_email") or "").strip() and run["state"].get("refused_emails"):
            await self._save_customer_email(run, str(clean["customer_email"]).strip(), user_id)
        await self.rt.store.update_run(run_id, {"state": run["state"], "pending_question": None, "substatus": None})
        await self._audit(run, "input_provided", user_id, {"fields": sorted(clean)})
        if background:
            run["state"]["background"] = True
            await self.rt.store.update_run(run_id, {"state": run["state"]})
            self.advance_later(run_id, actor)
            return {**run, "pending_question": None, "substatus": None}
        return await self.advance(run_id, actor=actor)

    @_together
    async def decide_approval(self, run_id: str, approval_id: str, user_id: str, approve: bool,
                              note: str | None = None, email: str | None = None) -> dict:
        run, actor = await self._owned_run(run_id, user_id, email)
        approval = await self.rt.store.get_approval(approval_id)
        if not approval or approval["run_id"] != run_id or approval["business_id"] != run["business_id"]:
            raise AccessDenied("Not found.")
        if not actor.can_send or actor.is_system:
            raise AccessDenied("Your role can't approve this.")      # the Agent never self-approves (s24)
        verb = "approved" if approve else "declined"
        if approval["status"] in (APPROVAL_SUPERSEDED, APPROVAL_INVALIDATED):
            raise Conflict("approval_superseded",
                           f"This approval is for an earlier version of the draft, so nothing was {verb}. Review the current version.")
        if approval["status"] != APPROVAL_PENDING:
            raise Conflict("approval_not_pending", f"This approval is already {approval['status']}, so nothing was {verb}.")
        if run["status"] != RUN_AWAITING_APPROVAL:
            # The task moved on (an edit, or a question it now needs answered): this request is stale.
            await self._supersede(run, [approval], user_id, "run_not_awaiting_approval")
            raise Conflict("approval_superseded",
                           f"This task is no longer waiting for this approval, so nothing was {verb}. "
                           + (f"It needs: {run['pending_question']['question']}" if run.get("pending_question") else "Review its current state."))
        now = self.rt.clock().isoformat()
        if approve:
            check, why = await self._check_current(run, approval, actor)
            if check == "changed":
                await self._supersede(run, [approval], user_id, "payload_mismatch")
                raise Conflict("approval_superseded",
                               "The draft changed after this approval was requested, so nothing was approved or sent. "
                               "A fresh approval is needed for the current version.")
            if check == "obsolete":
                # The action no longer applies (e.g. the invoice was paid meanwhile): nothing is sent,
                # and the workflow carries on from the records as they are now (s11.2).
                await self._supersede(run, [approval], user_id, "source_state_changed")
                await self.rt.store.update_run(run_id, {"status": RUN_RUNNING})
                return {"run": await self.advance(run_id, actor=actor), "approval": approval, "changed": True,
                        "message": f"Nothing was sent: {why}"}
        if approval.get("expires_at") and approval["expires_at"] < now:
            approval = await self.rt.store.update_approval(approval_id, {"status": APPROVAL_EXPIRED})
            await self.rt.store.update_run(run_id, {"status": RUN_RUNNING})
            return {"run": await self.advance(run_id, actor=actor), "approval": approval, "changed": True,
                    "message": "That approval request had expired, so I prepared a fresh one."}
        status = APPROVAL_APPROVED if approve else APPROVAL_REJECTED
        decided = await self.rt.store.transition_approval(
            approval_id, APPROVAL_PENDING, {"status": status, "approver_id": user_id, "decided_at": now, "decided_note": note})
        if decided is None:
            # Another decision on this approval landed first: it alone continues the run.
            current = await self.rt.store.get_approval(approval_id)
            raise Conflict("approval_not_pending",
                           f"This approval was already {(current or {}).get('status') or 'decided'}, so nothing was {verb}.")
        approval = decided
        await self._audit(run, "approval_granted" if approve else "approval_rejected", user_id,
                          {"approval_id": approval_id, "tool": approval["tool_id"], "payload_hash": approval["payload_hash"],
                           "payload_version": approval["payload_version"]})
        await self._event(run, "ApprovalGranted" if approve else "ApprovalRejected", {"approval_id": approval_id})
        if not approve:
            await self._close_unsent_quote(run, "rejected", user_id)
            run = await self._finish(run, RUN_CANCELLED, None, "approval_rejected",
                                     f"You declined: {approval['title']}. Nothing was sent; any draft is still in Business Operations.")
            return {"run": run, "approval": approval, "changed": True}
        await self.rt.store.update_run(run_id, {"status": RUN_RUNNING})
        return {"run": await self.advance(run_id, actor=actor), "approval": approval, "changed": True}

    async def cancel(self, run_id: str, user_id: str, email: str | None = None) -> dict:
        run, actor = await self._owned_run(run_id, user_id, email)
        if not (actor.is_owner or (actor.can_prepare and run["requester_id"] == user_id)):
            raise AccessDenied("Your role can't cancel this task.")
        if run["status"] in RUN_TERMINAL and run["status"] != RUN_FAILED:
            raise Conflict("run_finished", f"This task has already {_ended(run)}, so there's nothing to cancel.")
        for a in await self.rt.store.list_approvals(run_id=run_id, status=APPROVAL_PENDING):
            await self.rt.store.update_approval(a["id"], {"status": APPROVAL_CANCELLED})
        await self._close_unsent_quote(run, "cancelled", user_id)
        done = [s for s in await self.rt.store.list_steps(run_id) if s.get("external_ref")]
        # Cancellation stops future steps; it never claims to undo what was already sent (AC-14).
        summary = ("Cancelled. " + (f"{len(done)} message(s) had already been sent and can't be recalled." if done
                                    else "Nothing had been sent."))
        return await self._finish(run, RUN_CANCELLED, None, "cancelled_by_user", summary)

    async def close_unanswered(self, runs: list[dict]) -> int:
        """Requests that have waited on the owner for an answer with nothing happening for
        config.UNANSWERED_CLOSE_DAYS are closed, with a note that says so in History. Nothing had
        been sent for any of them (they were still at a question), and asking again starts afresh."""
        cutoff = self.rt.clock() - timedelta(days=config.UNANSWERED_CLOSE_DAYS)
        closed = 0
        for run in runs:
            q = run.get("pending_question")
            touched = bz._moment(run.get("updated_at") or run.get("created_at"))
            if run.get("status") != RUN_RUNNING or run.get("substatus") != SUB_WAITING_INFO or not q or q.get("optional") or not touched or touched > cutoff:
                continue
            try:
                for a in await self.rt.store.list_approvals(run_id=run["id"], status=APPROVAL_PENDING):
                    await self.rt.store.update_approval(a["id"], {"status": APPROVAL_CANCELLED})
                await self._close_unsent_quote(run, "cancelled", run.get("requester_id"))
                await self._finish(run, RUN_CANCELLED, None, "closed_unanswered",
                                   f"Closed automatically: it waited {config.UNANSWERED_CLOSE_DAYS} days for an answer. Nothing was sent. Ask again whenever you're ready.")
                closed += 1
            except Exception:      # noqa: BLE001 - one task that can't be closed doesn't stop the rest
                logger.warning("could not close unanswered task %s", run.get("id"), exc_info=True)
        return closed

    async def stop_run(self, run: dict, actor_id: str, reason: str, summary: str) -> dict:
        """Stop a task because the record it was working on has been dealt with another way (a
        marketplace request answered or declined by hand). Pending approvals are withdrawn and an
        unsent draft is closed; like any cancellation, it never claims to undo what was sent."""
        if run["status"] in RUN_TERMINAL and run["status"] != RUN_FAILED:
            return run
        for a in await self.rt.store.list_approvals(run_id=run["id"], status=APPROVAL_PENDING):
            await self.rt.store.update_approval(a["id"], {"status": APPROVAL_CANCELLED})
        await self._close_unsent_quote(run, "cancelled", actor_id)
        return await self._finish(run, RUN_CANCELLED, None, reason, summary)

    @_together
    async def retry(self, run_id: str, user_id: str, email: str | None = None) -> dict:
        run, actor = await self._owned_run(run_id, user_id, email)
        if not actor.can_prepare:
            raise AccessDenied("Your role can't retry this task.")
        if run["status"] in RUN_TERMINAL and run["status"] != RUN_FAILED:
            raise Conflict("run_finished", f"This task has already {_ended(run)}, so there's nothing to retry.")
        if run["status"] != RUN_FAILED:
            raise Conflict("run_not_failed", "This task hasn't stopped, so there's nothing to retry.")
        ent = await self.entitlement(run["business_id"])
        if AUTONOMY_RANK[WORKFLOWS[run["workflow_key"]].autonomy] > AUTONOMY_RANK[ent["max_autonomy"]] \
                or not config.plan_allows(ent["plan"], run["capability"]):
            raise AccessDenied("Your plan no longer includes this kind of task.")
        await self.rt.store.update_run(run_id, {"status": RUN_RUNNING, "substatus": None, "reason_code": None, "error": None})
        await self._audit(run, "workflow_retried", user_id, {"from_step": run["current_step"]})
        again = await self.advance(run_id, actor=actor)
        await self._after_retry(again, run.get("summary") or run.get("error"))
        return again

    async def fix_customer_email(self, run_id: str, user_id: str, new_email: str, email: str | None = None) -> dict:
        """A task stopped because the customer has no usable email address. Save the address
        on the customer record, use it for this task, and carry on."""
        from app.modules.agent.tools import valid_email
        run, actor = await self._owned_run(run_id, user_id, email)
        if not actor.can_prepare:
            raise AccessDenied("Your role can't change this customer's details.")
        if run["status"] != RUN_FAILED or run.get("reason_code") != "invalid_customer_destination":
            raise Conflict("no_email_problem", "This task isn't waiting for a customer email address.")
        new_email = str(new_email or "").strip()
        if not valid_email(new_email):
            raise Conflict("invalid_email", "That doesn't look like an email address. Please check it.")
        state = run["state"]
        invoice_id, quote_id = state.get("invoice_id"), state.get("quote_id")
        changed: dict[str, Any] = {}

        def _apply(data: dict) -> None:
            rec = bz.find(bz.records(data, "invoices"), invoice_id) if invoice_id else None
            rec = rec or (bz.find(bz.records(data, bz.quotes_key(data)), quote_id) if quote_id else None)
            if not rec:
                return
            previous = rec.get("customer_email")
            rec["customer_email"] = new_email
            name = str(rec.get("customer_name") or "").strip().lower()
            for c in (data.get("catalogue") or {}).get("customers") or []:
                if (rec.get("customer_id") and str(c.get("id")) == str(rec["customer_id"])) or \
                        (name and str(c.get("name") or "").strip().lower() == name):
                    previous = c.get("email") or previous
                    c["email"] = new_email
                    c["updated_at"] = self.rt.clock().isoformat()
                    changed["customer_id"] = c.get("id")
                    break
            changed.update({"from": previous, "to": new_email})
        await self.rt.business.mutate(run["business_id"], _apply)
        state.setdefault("answers", {})["customer_email"] = new_email
        await self.rt.store.update_run(run_id, {"state": state})
        await self._audit(run, "customer_email_updated", user_id, changed or {"to": new_email})
        await self._close_duplicates(run, user_id)      # other tasks stuck on the same missing address
        return await self.retry(run_id, user_id, email)

    async def set_invoice_state(self, business_id: str, invoice_id: str, user_id: str, state: str,
                                reason: str | None = None, on: str | None = None, email: str | None = None) -> dict:
        """Mark an invoice disputed, voided, cancelled or credited (with a reason and date), or
        reopen it. While it is in one of those states nothing is chased."""
        actor, _policy = await self.actor_for(user_id, business_id, email)
        if not actor.can_prepare:
            raise AccessDenied("Your role can't change this invoice.")
        if state not in (*bz.HOLD_STATES, "reopen"):
            raise Conflict("invalid_state", "Choose disputed, voided, cancelled, credited or reopen.")
        reason = " ".join(str(reason or "").split())[:500]
        if state != "reopen" and len(reason) < 3:
            raise Conflict("reason_required", "Please give a reason.")
        now = self.rt.clock()
        day = bz.parse_day(on) if on else None
        if on and not day:
            raise Conflict("invalid_date", "That date isn't valid.")
        if day and day > now.date() + timedelta(days=1):
            raise Conflict("invalid_date", "The date can't be in the future.")

        def _apply(data: dict) -> dict:
            inv = bz.find(bz.records(data, "invoices"), invoice_id)
            if not inv:
                raise Conflict("invoice_not_found", "That invoice no longer exists.")
            hold = bz.invoice_hold(inv)
            if state == "reopen":
                if not hold:
                    raise Conflict("not_on_hold", "This invoice isn't disputed, voided, cancelled or credited.")
                inv.update({"status": inv.get("status_before") or "sent", "status_reason": None, "status_changed_at": now.isoformat(),
                            "status_changed_by": user_id, "reopened_from": hold["state"]})
                for k in ("status_before", "disputed", "dispute_status", "dispute_reason", "status_date"):
                    inv.pop(k, None)
            else:
                if not hold:
                    inv["status_before"] = bz.status_of(inv) or "sent"
                inv.update({"status": state, "status_reason": reason, "status_date": (day or now.date()).isoformat(),
                            "status_changed_at": now.isoformat(), "status_changed_by": user_id})
                inv.pop("reopened_from", None)
            inv["updated_at"] = now.isoformat()
            return {k: inv.get(k) for k in ("id", "reference", "status", "status_reason", "status_date", "status_changed_at", "status_before")}
        result = await self.rt.business.mutate(business_id, _apply)
        try:
            await self.wake(business_id)      # waiting follow-ups see the change now
        except Exception as e:      # noqa: BLE001 - the state is saved either way
            logger.warning("wake after invoice state change failed: %s", e)
        return result

    async def _close_unsent_quote(self, run: dict, status: str, actor_id: str) -> None:
        """When a quotation's task is declined or cancelled before the quote was sent, the draft
        is marked the same way, so it doesn't sit in the pipeline as a live draft."""
        quote_id = (run.get("state") or {}).get("quote_id")
        if run.get("workflow_key") != "enquiry_to_quote" or not quote_id:
            return
        now = self.rt.clock().isoformat()

        def _apply(data: dict) -> bool:
            q = bz.find(bz.records(data, bz.quotes_key(data)), quote_id)
            if not q or bz.status_of(q) != "draft":
                return False      # sent or answered quotes keep their real status
            q.update({"status": status, f"{status}_at": now, "status_reason": "Agent task " + ("declined" if status == "rejected" else "cancelled"),
                      "updated_at": now})
            return True
        try:
            if await self.rt.business.mutate(run["business_id"], _apply):
                await self._audit(run, "quote_status_changed", actor_id, {"quote_id": quote_id, "status": status})
        except Exception as e:      # noqa: BLE001 - the run's own outcome is what matters here
            logger.warning("could not update quote %s: %s", quote_id, e)

    async def _save_customer_email(self, run: dict, new_email: str, actor_id: str) -> None:
        """A corrected address after a refusal updates the customer record (with an audit entry),
        and the refused address is remembered there so no later task tries it again."""
        state = run.get("state") or {}
        refused = [e for e in state.get("refused_emails") or [] if e]
        customer_id = (state.get("customer") or {}).get("id")
        updated: dict[str, Any] = {}

        def _apply(data: dict) -> None:
            for c in (data.get("catalogue") or {}).get("customers") or []:
                same = (customer_id and str(c.get("id")) == str(customer_id)) or \
                       str(c.get("email") or "").lower() in {e.lower() for e in refused}
                if not same:
                    continue
                previous = c.get("email")
                c["refused_emails"] = sorted({*(c.get("refused_emails") or []), *refused})
                c["email"] = new_email
                c["updated_at"] = self.rt.clock().isoformat()
                updated.update({"customer_id": c.get("id"), "from": previous, "to": new_email})
                return
        try:
            await self.rt.business.mutate(run["business_id"], _apply)
        except Exception as e:      # noqa: BLE001 - the answer is still used for this task
            logger.warning("could not update customer email: %s", e)
            return
        if updated:
            await self._audit(run, "customer_email_updated", actor_id, updated)

    async def _save_business_details(self, business_id: str, name: str, email: str) -> None:
        """The user told us the business name and/or email: keep them in the workspace profile
        (only where none is set), so documents never go out under a placeholder, replies reach
        the business, and nobody is asked twice."""
        def _apply(data: dict) -> None:
            profile = data.setdefault("workspace_profile", {})
            if name and not str(profile.get("company_name") or "").strip():
                profile["company_name"] = name[:120]
            if email and "@" in email and not str(profile.get("email") or "").strip():
                profile["email"] = email[:140]
        try:
            await self.rt.business.mutate(business_id, _apply)
        except Exception as e:      # noqa: BLE001 - the answer is still used for this task
            logger.warning("could not save business details: %s", e)

    async def _supersede(self, run: dict, approvals: list[dict], actor_id: str, reason: str) -> None:
        for a in approvals:
            await self.rt.store.update_approval(a["id"], {"status": APPROVAL_SUPERSEDED,
                                                          "decided_note": "Superseded: the draft changed after this was requested."})
            await self._audit(run, "approval_invalidated", actor_id,
                              {"approval_id": a["id"], "payload_version": a.get("payload_version"), "reason": reason})

    async def _check_current(self, run: dict, approval: dict, actor: Actor) -> tuple[str, str]:
        """Rebuild the payload from the live records and compare it with what was approved (AC-09).
        "match": the same action. "changed": a different action now (or a required fact is
        missing), so this approval can't be used. "obsolete": the action no longer applies."""
        builder = PAYLOAD_BUILDERS.get(approval["tool_id"])
        if not builder:
            return "match", ""
        ent = await self.entitlement(run["business_id"])
        policy = await self.rt.store.get_policy(run["business_id"])
        tc = ToolContext(rt=self.rt, run=run, actor=actor, policy=policy, owner_id=ent["owner_id"])
        try:
            payload, _title = await builder(tc, dict(approval.get("payload") or {}))
        except NeedsInformation:
            return "changed", ""
        except ToolStop as stop:
            return "obsolete", stop.message
        same = payload_hash(approval["tool_id"], payload) == approval["payload_hash"]
        return ("match" if same else "changed"), ""

    # Fields an edit can change while a quotation waits for approval.
    _EDITABLE = {"enquiry_to_quote"}
    # The sends whose document can be changed while it waits for approval.
    EDITABLE_TOOLS = ("send_quotation", "send_invoice", "send_contract", "send_payment_reminder", "send_receipt",
                      "send_proposal", "send_purchase_order", "send_credit_note")

    @staticmethod
    def _discount(value: Any) -> dict | None:
        """A discount as given in an edit: {"type": "percent" | "amount", "value": n}; None or 0 removes it."""
        if not isinstance(value, dict) or not float(value.get("value") or 0):
            return None
        kind, amount = ("percent" if value.get("type") == "percent" else "amount"), float(value["value"])
        if amount < 0 or (kind == "percent" and amount > 100):
            raise Conflict("invalid_edit", "A discount is between 0 and 100%, or an amount of 0 or more.")
        return {"type": kind, "value": amount}

    async def _edit_document(self, run: dict, actor: Actor, waiting: dict, changes: dict) -> dict:
        """Change an invoice, contract, payment reminder or receipt while it waits for approval.
        The record (or, for wording, this task's own note) is changed, the approval that was
        waiting can no longer be used, and the new version is shown for approval again."""
        from app.modules.agent.tools import valid_email
        tool, state, before = waiting["tool_id"], run["state"], waiting.get("payload") or {}
        data = await self.rt.business.load(run["business_id"])
        today = bz.local_now(data, self.rt.clock()).date()
        record: dict[str, Any] = {}                     # changes to the invoice or contract itself
        notes = dict(state.get("document_edits") or {})  # wording kept with this task
        touched: list[str] = []

        def day(value: Any, label: str) -> str:
            try:
                d = datetime.fromisoformat(str(value)[:10]).date()
            except ValueError:
                raise Conflict("invalid_edit", f"“{label}” isn't a date.") from None
            if d < today:
                raise Conflict("invalid_edit", f"“{label}” can't be in the past.")
            return d.isoformat()

        if changes.get("customer_email") is not None:
            address = str(changes["customer_email"]).strip()
            if not valid_email(address):
                raise Conflict("invalid_edit", "Enter a valid email address to send this to.")
            state.setdefault("answers", {})["customer_email"] = address
            record["customer_email"] = address
            touched.append("customer_email")
        if changes.get("payment_terms_days") is not None and tool in ("send_invoice", "send_contract"):
            days = int(changes["payment_terms_days"])
            if not 0 <= days <= 365:
                raise Conflict("invalid_edit", "Payment terms must be between 0 and 365 days.")
            record["payment_terms"] = f"Net {days} days"
        if tool == "send_invoice":
            if changes.get("items") is not None:
                lines = []
                for it in changes["items"]:
                    qty, price, name = float(it.get("quantity") or 0), float(it.get("unit_price") or 0), str(it.get("name") or "").strip()
                    if qty <= 0 or price < 0 or not name:
                        raise Conflict("invalid_edit", "Each line needs a name, a quantity above 0 and a price of 0 or more.")
                    lines.append({"id": new_id()[:8], "description": name, "qty": str(int(qty) if qty.is_integer() else qty), "unit_price": str(bz.money(price)),
                                  "cost_of_sales": "0", "product_id": it.get("product_id")})
                if not lines:
                    raise Conflict("invalid_edit", "An invoice needs at least one line.")
                record["line_items"] = lines
            if changes.get("vat_rate") is not None:
                vat = float(changes["vat_rate"])
                if not 0 <= vat <= 100:
                    raise Conflict("invalid_edit", "VAT must be between 0 and 100%.")
                record["vat_rate"] = vat
            if "discount" in changes:
                record["discount"] = self._discount(changes.get("discount"))
            if changes.get("due_date"):
                record["due_date"] = day(changes["due_date"], "Due date")
        elif tool == "send_contract":
            if changes.get("description") is not None:
                scope = str(changes["description"]).strip()[:4000]
                if not scope:
                    raise Conflict("invalid_edit", "The contract needs a description of what is agreed.")
                record["description"] = scope
            if changes.get("total") is not None:
                amount = float(changes["total"])
                if amount <= 0:
                    raise Conflict("invalid_edit", "The contract value must be above 0.")
                record["amount"] = record["total_amount"] = bz.money(amount)
        elif tool == "send_proposal":
            for key, limit in (("problem", 4000), ("solution", 6000), ("timeline", 200), ("notes", 2000)):
                if changes.get(key) is not None:
                    record[key] = str(changes[key]).strip()[:limit]
            if "solution" in record and not record["solution"]:
                raise Conflict("invalid_edit", "The proposal needs to say what you propose.")
            if changes.get("total") is not None:
                if float(changes["total"]) <= 0:
                    raise Conflict("invalid_edit", "The price must be above 0.")
                record["amount"] = record["total_amount"] = bz.money(changes["total"])
            if changes.get("valid_until"):
                record["valid_until"] = day(changes["valid_until"], "Valid until")
        elif tool == "send_purchase_order":
            if changes.get("items") is not None:
                lines = []
                for it in changes["items"]:
                    qty, price, name = float(it.get("quantity") or 0), float(it.get("unit_price") or 0), str(it.get("name") or "").strip()
                    if qty <= 0 or price < 0 or not name:
                        raise Conflict("invalid_edit", "Each line needs a name, a quantity above 0 and a price of 0 or more.")
                    lines.append({"id": new_id()[:8], "description": name, "qty": str(int(qty) if qty.is_integer() else qty), "unit_price": str(bz.money(price))})
                if not lines:
                    raise Conflict("invalid_edit", "A purchase order needs at least one line.")
                record["line_items"] = lines
            if changes.get("vat_rate") is not None:
                if not 0 <= float(changes["vat_rate"]) <= 100:
                    raise Conflict("invalid_edit", "VAT must be between 0 and 100%.")
                record["vat_rate"] = float(changes["vat_rate"])
            if changes.get("delivery_date"):
                record["delivery_date"] = day(changes["delivery_date"], "Deliver by")
            if changes.get("notes") is not None:
                record["notes"] = str(changes["notes"]).strip()[:2000]
        elif tool == "send_credit_note":
            invoice = bz.find((data.get("financials") or {}).get("invoices") or [], str(before.get("invoice_id") or "")) or {}
            room = bz.money(bz.invoice_total(invoice) - bz.invoice_credited(invoice)) if invoice else 0
            amount = bz.money(changes["total"]) if changes.get("total") is not None else bz.money(before.get("total") or 0)
            if changes.get("total") is not None:
                if not 0 < amount <= room + 0.005:
                    raise Conflict("invalid_edit", f"The credit must be above 0 and no more than {room:,.2f}.")
                record["amount"] = record["total_amount"] = amount
            if "refund_amount" in changes:
                refund = bz.money(changes.get("refund_amount") or 0)
                if refund < 0 or refund > min(amount, bz.invoice_received(invoice)) + 0.005:
                    raise Conflict("invalid_edit", "The refund can't be more than the credit or than what they have paid.")
                record["refund_amount"] = refund
            if changes.get("reason") is not None:
                if not str(changes["reason"]).strip():
                    raise Conflict("invalid_edit", "A credit note needs a reason.")
                record["reason"] = str(changes["reason"]).strip()[:500]
        else:      # a payment reminder or a receipt: the wording, and for a reminder the amount asked for now
            if changes.get("message") is not None:
                notes["message"] = str(changes["message"]).strip()[:1500]
                touched.append("message")
            if tool == "send_payment_reminder" and "amount_requested" in changes:
                asked = float(changes.get("amount_requested") or 0)
                owed = float(before.get("outstanding") or 0)
                if asked < 0 or asked > owed + 0.005:
                    raise Conflict("invalid_edit", "The amount asked for can't be more than is outstanding.")
                notes["amount_requested"] = asked if 0 < asked < owed else None
                touched.append("amount_requested")
        if tool in ("send_payment_reminder", "send_receipt"):
            record.pop("customer_email", None)      # sent to another address for this message only; the invoice's own stays as it is
        if not record and not touched:
            raise Conflict("invalid_edit", "There's nothing to change.")

        if record:
            key, coll = {"send_contract": ("contract_id", "contracts"), "send_proposal": ("proposal_id", "proposals"),
                         "send_purchase_order": ("purchase_order_id", "purchase_orders"),
                         "send_credit_note": ("credit_note_id", "credit_notes")}.get(tool, ("invoice_id", "invoices"))
            target = str(before.get(key) or state.get(key) or state.get("document_id") or "")

            def _apply(d: dict) -> None:
                rec = bz.find(bz.records(d, coll), target)
                if not rec:
                    raise Conflict("source_state_changed", "That document no longer exists.")
                if bz.status_of(rec) not in ("draft", "pending"):
                    raise Conflict("source_state_changed", "This document has already been sent, so it can't be changed here.")
                discount = record.get("discount", ...)
                rec.update({k: v for k, v in record.items() if k != "discount"})
                if discount is None:
                    rec.pop("discount", None)
                elif discount is not ...:
                    rec["discount"] = discount
                if coll in ("invoices", "purchase_orders") and any(k in record for k in ("line_items", "vat_rate", "discount")):
                    from app.modules.agent.tools import _amounts
                    amounts = _amounts(rec)
                    if amounts["total"] <= 0:
                        raise Conflict("invalid_edit", "The document must come to more than 0.")
                    rec["subtotal_amount"] = amounts["subtotal"]
                    rec["amount"] = rec["total_amount"] = amounts["total"]
                    if "line_items" in record:
                        rec["description"] = ", ".join(i["description"] for i in amounts["items"])
                rec["updated_at"] = self.rt.clock().isoformat()
            await self.rt.business.mutate(run["business_id"], _apply)

        open_approvals = [a for a in await self.rt.store.list_approvals(run_id=run["id"]) if a["status"] in (APPROVAL_PENDING, APPROVAL_APPROVED)]
        await self._supersede(run, open_approvals, actor.user_id, "draft_edited")
        state["document_edits"] = {k: v for k, v in notes.items() if v not in (None, "")}
        await self.rt.store.update_run(run["id"], {"state": state, "status": RUN_RUNNING})
        await self._audit(run, "draft_edited", actor.user_id, {"fields": sorted({*record, *touched}), "document": tool})
        after = await self.advance(run["id"], actor=actor)
        now_waiting = next((a for a in await self.rt.store.list_approvals(run_id=run["id"]) if a["status"] == APPROVAL_PENDING), None)
        if now_waiting:
            after["state"]["last_edit"] = {"by": actor.user_id, "at": self.rt.clock().isoformat(), "version": now_waiting.get("payload_version"),
                                           "changes": what_changed(before, now_waiting.get("payload") or {})}
            await self.rt.store.update_run(run["id"], {"state": after["state"]})
        return after

    @_together
    async def edit_draft(self, run_id: str, user_id: str, changes: dict, email: str | None = None) -> dict:
        """Change a drafted quotation while it waits for approval. The draft is updated, a new
        payload (and payload_version) is prepared, and the pending approval is invalidated (AC-09)."""
        run, actor = await self._owned_run(run_id, user_id, email)
        if not actor.can_prepare:
            raise AccessDenied("Your role can't edit this draft.")
        if run["status"] != RUN_AWAITING_APPROVAL:
            raise Conflict("not_awaiting_approval", "The draft can only be edited while it's waiting for approval.")
        waiting = next((a for a in await self.rt.store.list_approvals(run_id=run_id) if a["status"] == APPROVAL_PENDING), None)
        if not waiting or waiting.get("tool_id") not in self.EDITABLE_TOOLS:
            raise Conflict("edit_not_supported", "This task has no draft that can be edited.")
        if waiting["tool_id"] != "send_quotation":
            return await self._edit_document(run, actor, waiting, changes)
        if not run["state"].get("quote_id"):
            raise Conflict("edit_not_supported", "This task has no draft that can be edited.")
        data = await self.rt.business.load(run["business_id"])
        before = next((a.get("payload") or {} for a in await self.rt.store.list_approvals(run_id=run_id) if a["status"] == APPROVAL_PENDING), {})
        edit: dict[str, Any] = {}
        if changes.get("items") is not None:
            from app.modules.agent.tools import product_cost, product_price
            products = {str(p.get("id")): p for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict)}
            items = []
            for it in changes["items"]:
                qty = float(it.get("quantity") or 0)
                price = float(it.get("unit_price") or 0)
                product = products.get(str(it.get("product_id") or ""))
                name = str(it.get("name") or (product or {}).get("name") or "").strip()
                if qty <= 0 or price < 0 or not name:
                    raise Conflict("invalid_edit", "Each line needs a name, a quantity above 0 and a price of 0 or more.")
                # A catalogue item left at its catalogue price is still "Catalogue price"; anything else was typed here.
                listed = product is not None and abs(price - float(product_price(product) or 0)) < 0.005 and name == str(product.get("name") or "").strip()
                items.append({"product_id": it.get("product_id") if product else None, "name": name, "quantity": int(qty) if qty.is_integer() else qty,
                              "unit_price": price, "unit_cost": float(product_cost(product) or 0) if product else 0,
                              "price_source": "catalogue" if listed else "user_edited"})
            if not items:
                raise Conflict("invalid_edit", "A quotation needs at least one line.")
            if sum(float(i["quantity"]) * float(i["unit_price"]) for i in items) <= 0:
                raise Conflict("invalid_edit", "A line can be free, but the quotation must come to more than 0.")
            edit["items"] = items
        if changes.get("vat_rate") is not None:
            vat = float(changes["vat_rate"])
            if not 0 <= vat <= 100:
                raise Conflict("invalid_edit", "VAT must be between 0 and 100%.")
            edit["vat_rate"] = vat
            run["state"].setdefault("answers", {})["vat_rate"] = vat
        if changes.get("notes") is not None:
            edit["notes"] = str(changes["notes"])[:2000]
        if "discount" in changes:
            edit["discount"] = self._discount(changes.get("discount"))
        if changes.get("customer_id"):
            customer = bz.find([c for c in (data.get("catalogue") or {}).get("customers") or [] if isinstance(c, dict)], str(changes["customer_id"]))
            if not customer:
                raise Conflict("invalid_edit", "That customer is no longer on record.")
            edit.update({"customer_id": customer["id"], "customer_name": str(customer.get("name") or "").strip()})
            if not changes.get("customer_email") and str(customer.get("email") or "").strip():
                changes = {**changes, "customer_email": str(customer["email"]).strip()}      # "Sent to" follows the customer
        if changes.get("customer_email") is not None:
            from app.modules.agent.tools import valid_email
            address = str(changes["customer_email"]).strip()
            if not valid_email(address):
                raise Conflict("invalid_edit", "Enter a valid email address to send this to.")
            edit["customer_email"] = address
            run["state"].setdefault("answers", {})["customer_email"] = address
        if changes.get("valid_until"):
            try:
                until = datetime.fromisoformat(str(changes["valid_until"])[:10]).date()
            except ValueError:
                raise Conflict("invalid_edit", "“Valid until” isn't a date.") from None
            if until < bz.local_now(data, self.rt.clock()).date():
                raise Conflict("invalid_edit", "“Valid until” can't be in the past.")
            edit["valid_until"] = until.isoformat()
        if changes.get("payment_terms_days") is not None:
            days = int(changes["payment_terms_days"])
            if not 0 <= days <= 365:
                raise Conflict("invalid_edit", "Payment terms must be between 0 and 365 days.")
            edit["payment_terms"] = f"Net {days} days"
        if not edit:
            raise Conflict("invalid_edit", "There's nothing to change.")
        # Before anything else (including any question a later step asks), no earlier version
        # of this draft can be approved any more.
        open_approvals = [a for a in await self.rt.store.list_approvals(run_id=run_id)
                          if a["status"] in (APPROVAL_PENDING, APPROVAL_APPROVED)]
        await self._supersede(run, open_approvals, user_id, "draft_edited")
        run["state"]["pending_edit"] = edit
        await self.rt.store.update_run(run_id, {"state": run["state"], "status": RUN_RUNNING, "current_step": "draft"})
        await self._audit(run, "draft_edited", user_id, {"fields": sorted(edit)})
        after = await self.advance(run_id, actor=actor)
        # What the edit changed, in a line, for whoever approves it next.
        now_waiting = next((a for a in await self.rt.store.list_approvals(run_id=run_id) if a["status"] == APPROVAL_PENDING), None)
        if now_waiting:
            after["state"]["last_edit"] = {"by": user_id, "at": self.rt.clock().isoformat(), "version": now_waiting.get("payload_version"),
                                           "changes": what_changed(before, now_waiting.get("payload") or {})}
            await self.rt.store.update_run(run_id, {"state": after["state"]})
        return after

    STALLED_AFTER = timedelta(minutes=10)

    def _stalled(self, run: dict) -> bool:
        """In the middle of a step, not waiting for anyone or anything, and untouched for ten
        minutes: whatever was running it has gone (a restart, a lost connection)."""
        if run.get("status") not in (RUN_CREATED, RUN_RUNNING) or run.get("substatus") or run.get("pending_question") or run.get("wake_at"):
            return False
        last = bz._moment(run.get("updated_at") or run.get("created_at"))
        return bool(last and self.rt.clock() - last > self.STALLED_AFTER)

    async def release_stalled(self, runs: list[dict]) -> int:
        """Move stalled tasks to Needs Attention with the reason, so they can be seen and retried.
        Retrying is safe: finished steps aren't repeated and nothing is sent twice."""
        moved = 0
        for run in runs:
            if not self._stalled(run):
                continue
            steps = await self.rt.store.list_steps(run["id"])
            step = next((s for s in reversed(steps) if s.get("state") == STEP_RUNNING), None)
            where = f" at “{step['title']}”" if step else ""
            message = (f"This task stopped part-way{where}: it was interrupted while it was running. "
                       "Nothing has been sent twice. I'm picking it up again from where it stopped.")
            if step:
                await self._step_update(step, {"state": STEP_FAILED, "finished_at": self.rt.clock().isoformat(),
                                                             "error": message, "reason_code": "stalled"})
            await self._audit(run, "stalled_detected", "system", {"step": (step or {}).get("step_key"), "last_update": run.get("updated_at")})
            await self._finish(run, RUN_FAILED, SUB_RETRY_AVAILABLE, "stalled", message)
            moved += 1
        return moved

    # Faults that pass by themselves: the Agent tries again without being asked, three times,
    # waiting longer each time. Only if it still fails does the owner see it, with the reason.
    AUTO_RETRY_REASONS = ("stalled", "action_failed", "unexpected_error", "delivery_status_uncertain")
    AUTO_RETRY_AFTER = (timedelta(minutes=0), timedelta(minutes=5), timedelta(minutes=15))

    AUTO_RETRY_DAILY = timedelta(hours=24)      # after the three quick attempts: once a day, for as long as the task may run

    def retrying(self, run: dict) -> bool:
        """Stopped for a passing fault: the Agent tries it again itself (quickly three times, then daily)."""
        return run.get("status") == RUN_FAILED and run.get("reason_code") in self.AUTO_RETRY_REASONS

    def next_attempt_at(self, run: dict) -> datetime | None:
        """When the Agent will next try a task that stopped for a passing fault."""
        if not self.retrying(run):
            return None
        state = run.get("state") or {}
        attempt = int(state.get("auto_retries") or 0)
        failed_at = bz._moment(state.get("failed_at")) or self.rt.clock()
        if attempt >= len(self.AUTO_RETRY_AFTER):
            return failed_at + self.AUTO_RETRY_DAILY
        return failed_at + (timedelta(minutes=1) if attempt == 0 and run.get("reason_code") != "stalled" else self.AUTO_RETRY_AFTER[attempt])

    async def _after_retry(self, run: dict | None, stale: str | None) -> None:
        """A task that was stopped and has now got further still carries the text of the failure
        as "what happened". Replace it with what did happen."""
        import re
        if not run or run.get("status") in (RUN_FAILED, RUN_CANCELLED) or (run.get("summary") and run.get("summary") != stale):
            return
        if run.get("status") == RUN_AWAITING_APPROVAL:
            pending = await self.rt.store.list_approvals(run_id=run["id"], status=APPROVAL_PENDING)
            title = (pending[0].get("title") if pending else "") or ""
            thing = re.match(r"^Send (?:the )?(.+?) to ", title)
            text = (f"Prepared {thing.group(1)} after a retry. Waiting for your approval." if thing
                    else "Prepared after a retry. Waiting for your approval.")
        elif run.get("pending_question"):
            text = "Picked up again after a retry. It needs one answer from you to carry on."
        elif run.get("status") == RUN_SUCCEEDED:
            return      # a finished task has its own account of what it did
        else:
            text = "Picked up again after a retry and carrying on."
        run["summary"] = text
        await self.rt.store.update_run(run["id"], {"summary": text})

    async def auto_retry(self, runs: list[dict]) -> int:
        """Try again the tasks that are due another attempt. Trying again is always safe: finished
        steps aren't repeated and a send that went out is recognised, never sent twice."""
        tried = 0
        for run in runs:
            if not self.retrying(run):
                continue
            state = run.get("state") or {}
            attempt = int(state.get("auto_retries") or 0)
            if self.rt.clock() < self.next_attempt_at(run):
                continue
            state["auto_retries"] = attempt + 1
            await self.rt.store.update_run(run["id"], {"state": state, "status": RUN_RUNNING, "substatus": None, "reason_code": None, "error": None})
            await self._audit(run, "auto_retry", "system", {"attempt": attempt + 1, "after": run.get("reason_code")})
            try:
                again = await self.advance(run["id"])
            except Exception:      # noqa: BLE001 - one task never stops the others
                logger.exception("automatic retry failed for run %s", run["id"])
                continue
            tried += 1
            await self._after_retry(again, run.get("summary") or run.get("error"))
            if again and again.get("status") == RUN_FAILED and again.get("reason_code") in self.AUTO_RETRY_REASONS \
                    and int((again.get("state") or {}).get("auto_retries") or 0) >= len(self.AUTO_RETRY_AFTER):
                # Out of attempts: now it is the owner's to know about, in plain words.
                why = str(again.get("error") or "").replace(" I'll have another go shortly.", "").replace(" I'll check again shortly; it will not be sent twice.", "") \
                    .replace(" I'm picking it up again from where it stopped.", "")
                why = why.split(" Nothing was sent twice.")[0].split("it still didn't go through. ")[-1].replace(" Nothing was sent.", "").strip()
                why = why if why.endswith((".", "!", "?")) else f"{why}."
                due = self.next_attempt_at(again)
                when = f"{due.day} {due.strftime('%b')} at {due.strftime('%H:%M')} UTC" if due else "tomorrow"
                message = (f"I've tried this {int(again['state']['auto_retries'])} more times and it still didn't go through. {why} "
                           f"Nothing was sent twice. My next attempt is on {when}.")
                await self.rt.store.update_run(again["id"], {"error": message, "next_action": message, "summary": message})
        return tried

    async def tick(self) -> int:
        """Scheduler: wake workflows whose wait has elapsed (due dates, daily payment checks)."""
        try:
            candidates = await self.rt.store.stalled_candidates()
            await self.release_stalled(candidates)
            await self.auto_retry(await self.rt.store.stalled_candidates())
        except Exception:      # noqa: BLE001 - the watchdog never stops the scheduler
            logger.exception("agent watchdog failed")
        woken = 0
        for run in await self.rt.store.due_runs(self.rt.clock()):
            try:
                await self.advance(run["id"])
                woken += 1
            except Exception:      # noqa: BLE001 - one bad run must not stop the rest
                logger.exception("agent tick failed for run %s", run["id"])
        return woken

    async def wake(self, business_id: str) -> int:
        """Business records changed: re-check every workflow of this business that is waiting on an
        external event. Each one revalidates against the authoritative records, so this is always safe."""
        woken = 0
        for run in await self.rt.store.list_runs(business_id, statuses=[RUN_RUNNING]):
            if run.get("substatus") == SUB_WAITING_EVENT:
                try:
                    await self.advance(run["id"])
                    woken += 1
                except Exception:      # noqa: BLE001
                    logger.exception("agent wake failed for run %s", run["id"])
        return woken

    async def notify(self, business_id: str, record_type: str, record_id: str) -> int:
        """A business event (payment recorded, contract signed, ...) wakes the workflows watching that record."""
        key = {"invoice": "invoice_id", "quote": "quote_id", "contract": "contract_id"}.get(record_type)
        if not key:
            return 0
        woken = 0
        for run in await self.rt.store.list_runs(business_id, statuses=[RUN_RUNNING]):
            if run["state"].get(key) == record_id and run.get("substatus") == SUB_WAITING_EVENT:
                await self.advance(run["id"])
                woken += 1
        return woken
