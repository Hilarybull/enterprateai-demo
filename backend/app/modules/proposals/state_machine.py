"""Proposal status state machine.

Two transition maps govern who can move a proposal to which state:
  - the recipient drives the pipeline forward,
  - the proposer can only withdraw (or answer a clarification with a revision).

The caller's role is resolved at transition time from workspace ownership.
"""

from __future__ import annotations

# ── All statuses ────────────────────────────────────────────────────────────
DRAFT = "DRAFT"
SUBMITTED = "SUBMITTED"
VIEWED = "VIEWED"
UNDER_REVIEW = "UNDER_REVIEW"
CLARIFICATION_REQUESTED = "CLARIFICATION_REQUESTED"
REVISION_REQUESTED = "REVISION_REQUESTED"
SHORTLISTED = "SHORTLISTED"
PREFERRED = "PREFERRED"
NEGOTIATION = "NEGOTIATION"
AWARDED = "AWARDED"
CONTRACT_DRAFTED = "CONTRACT_DRAFTED"
CONTRACTED = "CONTRACTED"
DECLINED = "DECLINED"
WITHDRAWN = "WITHDRAWN"
EXPIRED = "EXPIRED"
ARCHIVED = "ARCHIVED"

ALL_STATUSES: set[str] = {
    DRAFT, SUBMITTED, VIEWED, UNDER_REVIEW, CLARIFICATION_REQUESTED, REVISION_REQUESTED,
    SHORTLISTED, PREFERRED, NEGOTIATION, AWARDED, CONTRACT_DRAFTED, CONTRACTED,
    DECLINED, WITHDRAWN, EXPIRED, ARCHIVED,
}

# Proposals in an active status block a second submission to the same recipient
# and are the ones shown as "open" in both parties' views.
ACTIVE_STATUSES: set[str] = {
    SUBMITTED, VIEWED, UNDER_REVIEW, CLARIFICATION_REQUESTED, REVISION_REQUESTED,
    SHORTLISTED, PREFERRED, NEGOTIATION,
}

TERMINAL_STATUSES: set[str] = {
    AWARDED, CONTRACT_DRAFTED, CONTRACTED, DECLINED, WITHDRAWN, EXPIRED, ARCHIVED,
}

# ── Transition maps ─────────────────────────────────────────────────────────
RECIPIENT_TRANSITIONS: dict[str, set[str]] = {
    SUBMITTED: {UNDER_REVIEW, DECLINED},
    VIEWED: {UNDER_REVIEW, DECLINED},
    UNDER_REVIEW: {SHORTLISTED, CLARIFICATION_REQUESTED, DECLINED, SUBMITTED},
    CLARIFICATION_REQUESTED: {UNDER_REVIEW},
    REVISION_REQUESTED: {UNDER_REVIEW, DECLINED},
    SHORTLISTED: {PREFERRED, DECLINED, UNDER_REVIEW},
    PREFERRED: {NEGOTIATION, DECLINED, SHORTLISTED},
    NEGOTIATION: {AWARDED, DECLINED, PREFERRED},
    AWARDED: {CONTRACT_DRAFTED},
    CONTRACT_DRAFTED: {CONTRACTED},
}

PROPOSER_TRANSITIONS: dict[str, set[str]] = {
    SUBMITTED: {WITHDRAWN},
    VIEWED: {WITHDRAWN},
    UNDER_REVIEW: {WITHDRAWN},
    CLARIFICATION_REQUESTED: {REVISION_REQUESTED, WITHDRAWN},
    SHORTLISTED: {WITHDRAWN},
    PREFERRED: {WITHDRAWN},
    NEGOTIATION: {WITHDRAWN},
}


def allowed_transitions(current: str, actor: str) -> set[str]:
    table = RECIPIENT_TRANSITIONS if actor == "recipient" else PROPOSER_TRANSITIONS
    return set(table.get(current, set()))


def can_transition(current: str, target: str, actor: str) -> bool:
    return target in allowed_transitions(current, actor)
