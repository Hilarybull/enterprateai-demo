"""Contracts for Agentic Orchestration (PRD-AO-001).

Conceptual entities from the PRD map to these shapes:
  AgentRequest (s8), WorkflowRun / StepRun / Approval (s13),
  ToolDefinition (s14), guardrail decision (s11.1), autonomy + effects (s10).
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

# ── Canonical statuses (s12.1) ────────────────────────────────────────────────
RUN_CREATED = "created"
RUN_RUNNING = "running"
RUN_AWAITING_APPROVAL = "awaiting_approval"
RUN_SUCCEEDED = "succeeded"
RUN_FAILED = "failed"
RUN_CANCELLED = "cancelled"
RUN_TERMINAL = {RUN_SUCCEEDED, RUN_FAILED, RUN_CANCELLED}

# User-facing reason/substates. These refine, never replace, the canonical status.
SUB_WAITING_INFO = "waiting_for_information"
SUB_WAITING_EVENT = "waiting_for_external_event"
SUB_BLOCKED = "blocked"
SUB_RETRY_AVAILABLE = "retry_available"
SUB_DELIVERY_UNCERTAIN = "delivery_status_uncertain"

# ── Step states (s12.2) ───────────────────────────────────────────────────────
STEP_PENDING = "pending"
STEP_RUNNING = "running"
STEP_AWAITING_INPUT = "awaiting_input"
STEP_AWAITING_APPROVAL = "awaiting_approval"
STEP_SUCCEEDED = "succeeded"
STEP_FAILED = "failed"
STEP_SKIPPED = "skipped"
STEP_CANCELLED = "cancelled"

# ── Tool effect types (s10.1) ─────────────────────────────────────────────────
EFFECT_READ_ONLY = "read_only"
EFFECT_INTERNAL_DRAFT = "internal_draft"
EFFECT_INTERNAL_WRITE = "internal_write"
EFFECT_EXTERNAL_COMMUNICATION = "external_communication"
EFFECT_EXTERNAL_COMMITMENT = "external_commitment"
EFFECT_FINANCIAL = "financial_effect"
EXTERNAL_EFFECTS = {EFFECT_EXTERNAL_COMMUNICATION, EFFECT_EXTERNAL_COMMITMENT, EFFECT_FINANCIAL}

# ── Autonomy levels (s10) ─────────────────────────────────────────────────────
A1_ASSIST = "A1"
A2_PREPARE = "A2"
A3_EXECUTE_WITH_APPROVAL = "A3"
A4_BOUNDED_AUTO = "A4"
AUTONOMY_RANK = {A1_ASSIST: 1, A2_PREPARE: 2, A3_EXECUTE_WITH_APPROVAL: 3, A4_BOUNDED_AUTO: 4}

# ── Guardrail decisions (s11.1) ───────────────────────────────────────────────
DECISION_ALLOWED = "allowed"
DECISION_REQUIRES_APPROVAL = "requires_approval"
DECISION_BLOCKED = "blocked"
DECISION_NEEDS_CLARIFICATION = "needs_clarification"

# ── Channels (s8) ─────────────────────────────────────────────────────────────
SOURCE_CHANNELS = {"text", "ui_action", "business_event", "api", "voice", "marketplace_rfq"}

# ── Approval states ───────────────────────────────────────────────────────────
APPROVAL_PENDING = "pending"
APPROVAL_APPROVED = "approved"
APPROVAL_REJECTED = "rejected"
APPROVAL_INVALIDATED = "invalidated"  # payload changed after approval (AC-09)
APPROVAL_SUPERSEDED = "superseded"    # the draft was edited: this version can no longer be approved (AC-09)
APPROVAL_EXPIRED = "expired"
APPROVAL_CANCELLED = "cancelled"
APPROVAL_CONSUMED = "consumed"  # the approved action has been executed


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def payload_hash(tool_id: str, payload: dict[str, Any]) -> str:
    """Stable hash binding an approval to the exact action payload (s11 approval binding)."""
    canonical = json.dumps({"tool": tool_id, "payload": payload}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class AgentRequest:
    """Channel-agnostic request. Text, UI actions, business events, API calls and
    (later) voice all resolve to this before orchestration (s8, AC-03)."""
    requesting_actor_id: str
    business_id: str
    source_channel: str = "text"
    source_reference: str | None = None       # message / recommendation / enquiry / invoice / risk / event id
    raw_input: str | None = None              # original text or transcript (untrusted data)
    raw_input_reference: str | None = None
    resolved_goal: str | None = None
    requested_capability: str | None = None   # candidate only: validated by the router/policy
    params: dict[str, Any] = field(default_factory=dict)
    locale: str = "en-GB"
    response_channel: str = "text"
    # Voice-only evidence: a transcript is input, never permission (s8.2).
    transcript_confidence: float | None = None
    confirmed: bool = False
    recommendation_id: str | None = None      # lineage for recommendation-to-action (s17.2)
    part_of_message: bool = False             # one request out of several in a single message: never split again
    background: bool = False                  # start the task and return at once; its progress is read from the task
    # Set only by the server's own goal hand-off (never read from an HTTP request): an essential
    # document started from the homepage, which the free plan may prepare within its monthly allowance.
    essential_handoff: bool = False
    request_id: str = field(default_factory=new_id)
    correlation_id: str = field(default_factory=new_id)


@dataclass
class GuardrailDecision:
    decision: str
    reason_codes: list[str] = field(default_factory=list)
    message: str = ""

    @property
    def allowed(self) -> bool:
        return self.decision == DECISION_ALLOWED

    def as_dict(self) -> dict[str, Any]:
        return {"decision": self.decision, "reason_codes": self.reason_codes, "message": self.message}


@dataclass
class Actor:
    """Who is acting, and with what authority in this business (s24)."""
    user_id: str
    email: str | None
    business_id: str
    is_owner: bool
    can_view: bool = True
    can_prepare: bool = False
    can_send: bool = False       # send / approve external actions
    can_manage_policy: bool = False
    is_system: bool = False      # scheduler acting under a pre-authorised policy; never approves


@dataclass
class ToolDefinition:
    """Registered, versioned capability (s14.1). Agents never touch the database directly."""
    tool_id: str
    version: int
    effect: str
    permission: str                      # view | prepare | send
    handler: Callable[..., Awaitable[dict[str, Any]]]
    required: tuple[str, ...] = ()       # input schema: required argument names
    output_keys: tuple[str, ...] = ()    # output schema: keys the tool returns
    approval_policy: str = "none"        # none | required | policy_a4 (auto only under pre-authorised policy)
    timeout_s: float = 30.0
    max_retries: int = 0                 # only for retry-safe tools
    idempotency: Callable[[dict[str, Any], dict[str, Any]], str] | None = None   # (args/payload, run) -> key
    credit_feature: str | None = None    # metered via credit_feature_config (cost is config, not code)
    audit_class: str = "routine"         # routine | consequential
    data_scope: str = "business"         # data minimisation scope
    # Rechecks source state immediately before an effect; returns a stop reason or None.
    revalidate: Callable[..., Awaitable[str | None]] | None = None


class GuardrailBlocked(Exception):
    def __init__(self, decision: GuardrailDecision):
        super().__init__(decision.message or ",".join(decision.reason_codes))
        self.decision = decision


class NeedsApproval(Exception):
    """Raised by the tool gateway when an action must be approved first."""
    def __init__(self, tool_id: str, payload: dict[str, Any], title: str, summary: dict[str, Any]):
        super().__init__(f"approval required for {tool_id}")
        self.tool_id = tool_id
        self.payload = payload
        self.title = title
        self.summary = summary


class DeliveryUncertain(Exception):
    """The provider may or may not have acted. Reconcile before any retry (s21)."""


class DeliveryUnconfirmed(DeliveryUncertain):
    """An earlier attempt can't be confirmed and the provider's de-duplication window has
    passed, so sending again could deliver the message twice. Only a person can decide."""


# ── Step results ──────────────────────────────────────────────────────────────
@dataclass
class Next:
    step: str | None = None      # None → the following step in the definition


@dataclass
class WaitForInput:
    question: str
    fields: list[dict[str, Any]]


@dataclass
class WaitForEvent:
    reason: str
    wake_at: datetime | None = None
    # Optional: lets an authorised user confirm the awaited event by hand.
    question: str | None = None
    fields: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Done:
    summary: str
    next_action: str | None = None
    outcome: dict[str, Any] = field(default_factory=dict)
    # The task ended correctly without doing its action (e.g. no reminder was needed).
    # The step that would have acted is recorded as "skipped", with the reason.
    skipped: bool = False


@dataclass
class Stop:
    """Pause/blocked by a stop condition (s11 stop conditions, s16.9)."""
    reason_code: str
    message: str
    substatus: str = SUB_BLOCKED
    failed: bool = False


@dataclass
class StepDefinition:
    key: str
    title: str
    handler: Callable[..., Awaitable[Any]]


@dataclass
class WorkflowDefinition:
    workflow_key: str
    version: int
    capability: str
    family: str
    title: str
    autonomy: str                       # highest autonomy level this workflow needs
    steps: list[StepDefinition]
    tools: tuple[str, ...]              # least-privilege allowlist (AC-06)
    triggers: tuple[str, ...] = ("text", "ui_action")
    success_condition: str = ""

    def step_index(self, key: str) -> int:
        for i, s in enumerate(self.steps):
            if s.key == key:
                return i
        raise KeyError(key)
