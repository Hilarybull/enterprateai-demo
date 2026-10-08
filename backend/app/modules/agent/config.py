"""Tunable defaults for Agentic Orchestration.

The PRD leaves these as open commercial/product decisions (s9.1, s28). They are
configuration, not orchestration logic: the database rows seeded by migration
027 override them, so they can be changed without a code release.
"""
from __future__ import annotations


def with_dev_overrides(limits: dict) -> dict:
    """Plan limits with the development/test overrides applied. Never in production."""
    from app.core.config import get_settings
    settings = get_settings()
    if str(settings.environment or "").lower() in ("production", "prod"):
        return limits
    out = dict(limits)
    if settings.agent_monthly_runs_override:
        out["monthly_runs"] = int(settings.agent_monthly_runs_override)
    if settings.agent_max_active_runs_override:
        out["max_active_runs"] = int(settings.agent_max_active_runs_override)
    return out

from typing import Any

# Plan limits. Free (Explorer) users get real but limited Agent value from their
# 50 sign-up credits (s9, AC-05); paid plans unlock sustained use and A4.
DEFAULT_PLAN_LIMITS: dict[str, dict[str, Any]] = {
    "explorer":              {"monthly_runs": 5,    "max_active_runs": 2,   "max_autonomy": "A3"},
    "starter_insight":       {"monthly_runs": 50,   "max_active_runs": 10,  "max_autonomy": "A3"},
    "decision_engine":       {"monthly_runs": 500,  "max_active_runs": 50,  "max_autonomy": "A4"},
    "growth_navigator":      {"monthly_runs": 2000, "max_active_runs": 200, "max_autonomy": "A4"},
    "strategic_business_os": {"monthly_runs": 5000, "max_active_runs": 500, "max_autonomy": "A4"},
}

# Which plan each Agent capability needs. One table, checked in one place (the orchestrator's
# start check), so every way of starting a task obeys it: the Agent panel, the assistant,
# every "Ask Agent" button, marketplace requests and automatic starting. Change a row to move
# a capability to another plan.
from app.modules.plans import capabilities as plan_map      # noqa: E402 - the one plan to task map

PLAN_ORDER = plan_map.PLAN_ORDER
PLAN_LABEL = plan_map.PLAN_LABEL
# The cheapest plan that includes each task, read from the plan map (app/modules/plans/capabilities.py).
CAPABILITY_MIN_PLAN: dict[str, str] = {c: plan_map.min_plan_for(c) for c in sorted(plan_map.all_capabilities())}

# What each capability costs when the owner asks for it, in words (default prices: the live
# price list decides what is charged, and each task records what it actually used).
CAPABILITY_COST: dict[str, str] = {
    "enquiry_to_quote": "2 credits to prepare the quotation, 2 when it is sent",
    "new_invoice": "2 credits to prepare the invoice, 2 when it is sent",
    "quote_to_cash": "2 credits for the invoice draft, 2 when it is sent",
    "new_contract": "2 credits to prepare the contract, 2 when it is sent",
    "receipt_send": "2 credits to issue the receipt, 2 when it is sent",
    "payment_followup": "2 credits per reminder sent",
    "new_proposal": "2 credits when it is sent",
    "new_purchase_order": "2 credits when it is sent",
    "credit_note": "2 credits when it is sent",
    "risk_concentration": "2 credits",
    "scenario_help": "2 credits",
    "expansion_scenario": "2 credits",
    "record_expense": "2 credits",
    "record_payment": "2 credits",
    "add_customer": "2 credits",
    "add_catalogue_item": "2 credits",
    "add_vendor": "2 credits",
    "update_record": "2 credits",
    "supplier_bill": "2 credits",
    "registration_checklist": "2 credits",
    "funding_pack_draft": "2 credits",
    "readiness_refresh": "2 credits",
    "launch_evidence_gaps": "2 credits",
    "price_test": "2 credits",
    "capacity_check": "2 credits",
    "offer_review": "2 credits",
    "marketplace_profile": "2 credits",
    "marketplace_offering": "2 credits",
    "idea_validation": "The price of an Idea Validation on your price list",
    "market_size": "The price of an Idea Validation on your price list",
    "business_plan_draft": "The price of a Business Plan on your price list",
}


# Tasks whose work is priced by its own product (an Idea Validation, a Business Plan): the Agent adds no charge of its own to those.
SELF_PRICED = ("idea_validation", "market_size", "business_plan_draft")
BASE_TASK_FEATURE = "agent_task"

# A request left waiting on the owner for an answer is closed after this many days with no activity.
UNANSWERED_CLOSE_DAYS = 14
# A task started from the homepage is carried out on any plan and charged in AI Credits like any
# other (the owner's decision, 7 Oct 2026). The free first task the PRD suggested is therefore off;
# set this to True to give a new account its first invoice or quotation without a charge.
FIRST_TASK_FREE = False
FREE_FIRST_TASKS = ("new_invoice", "enquiry_to_quote")
# Every task started from the homepage goal flow is carried out whatever the plan: the plan gate and
# the plan's task allowances (a month, and at once) do not apply to it, and AI Credits are what it costs. Asked for
# from inside the app, the same tasks follow CAPABILITY_MIN_PLAN and the allowance as before.
HOMEPAGE_TASKS_ON_ANY_PLAN = True
# A plan-included task is limited by AI Credits, not by a monthly count of tasks: a new account
# with credits can keep asking until they run out. (The counted things, like scenario simulations,
# have their own monthly numbers in the plan map.) Set to True to apply DEFAULT_PLAN_LIMITS' monthly_runs and
# max_active_runs again.
MONTHLY_TASK_ALLOWANCE_APPLIES = False


def cost_of(capability: str) -> str:
    """The price shown for a capability; anything not listed costs nothing."""
    return CAPABILITY_COST.get(capability) or AUTOMATIC_COST.get(capability) or "Free"


# What one automatic item costs, in words, for Agent settings (the amounts are the default
# prices; the live price list decides what is actually charged and is what each task records).
AUTOMATIC_COST: dict[str, str] = {
    "enquiry_to_quote": "2 credits, when the reply is sent",
    "quote_to_cash": "2 credits for the invoice draft, 2 when it is sent",
    "receipt_send": "2 credits to issue the receipt, 2 when it is sent",
    "payment_followup": "2 credits per reminder sent",
    "risk_concentration": "2 credits",
    "price_test": "Free",
    "readiness_refresh": "Free",
    "launch_evidence_gaps": "Free",
    "funding_pack_draft": "Free",
    "registration_checklist": "Free",
    "idea_validation": "The price of an Idea Validation on your price list",
    "market_size": "The price of an Idea Validation on your price list",
    "business_plan_draft": "The price of a Business Plan on your price list",
    "capacity_check": "Free",
    "offer_review": "Free",
    "expansion_scenario": "Free",
}
FREE_CAPABILITIES = frozenset(c for c, cost in AUTOMATIC_COST.items() if cost == "Free")


def plan_rank(plan: str | None) -> int:
    return PLAN_ORDER.index(plan) if plan in PLAN_ORDER else 0


def plan_allows(plan: str | None, capability: str) -> bool:
    """Whether the plan includes the task (the plan map). A task the map doesn't list needs a paid plan: nothing is open by omission."""
    return plan_rank(plan) >= plan_rank(CAPABILITY_MIN_PLAN.get(capability, "starter_insight"))


# Execution budget per run (s11 execution budget). Paid plans get more headroom.
DEFAULT_BUDGET = {"max_steps": 60, "max_llm_calls": 6, "max_external_calls": 12, "max_runtime_days": 120}
PAID_BUDGET = {"max_steps": 200, "max_llm_calls": 20, "max_external_calls": 40, "max_runtime_days": 365}

# Per-business Agent policy (versioned). Owners can change it; every change bumps `version`.
# The email provider recognises a repeated send (same idempotency key) for 24 hours. After
# that a retry would be treated as a new message, so the Agent never retries on its own.
PROVIDER_DEDUPE_HOURS = 23      # an hour of margin inside the provider's 24

DEFAULT_POLICY: dict[str, Any] = {
    "version": 1,
    "contract_route": "ask",            # ask | direct_invoice | contract_first  (s16.2)
    "default_vat_rate": None,           # None → tax not configured; never invented
    "quote_validity_days": 30,
    "default_payment_terms_days": 14,
    "approval_expiry_hours": 72,
    "member_can_approve": False,        # owner approves external actions unless enabled
    "auto_create_customers": True,      # new customers are created as part of the reviewed draft
    "reminders": {
        "auto_send": False,             # A4 bounded auto-execution: off until explicitly pre-authorised
        "cadence_days_overdue": [3, 10, 21],
        "max_reminders": 3,
        "min_interval_days": 7,         # never two reminders for one invoice closer together than this
        "skip_repeat_days": 7,          # a follow-up skipped for a reason isn't started again for that reason within this
    },
    "risk": {"concentration_alert_pct": 40},
    # A marketplace request for a quotation starts a drafting task by itself. Nothing is sent
    # without approval either way; with this off, the owner starts the task from the request's row.
    "marketplace_rfq": {"auto_start": True},
    # Start the task that follows when records change elsewhere: the invoice for an accepted
    # quotation, the receipt for a recorded payment, the reminder for an overdue invoice. On by
    # default (owner's decision, Oct 2026: the Agent does the work and asks only for approval);
    # the owner can switch it off. Preparing drafts uses credits. Sending still needs approval.
    # items: {key: False} switches one automatic item off. monthly_credit_cap: the most AI Credits
    # the Agent may spend in a calendar month on work it started by itself; once reached, automatic
    # work that costs credits pauses until the owner raises it or the month ends. Free work carries on.
    "automation": {"auto_start": True, "items": {}, "monthly_credit_cap": 50},
}

# Credit feature codes (rows in credit_feature_config). Costs are data, not code.
# No charge on the system is below 2 credits (credits.service.MIN_CREDIT_CHARGE); these are the defaults.
CREDIT_FEATURES: dict[str, dict[str, Any]] = {
    "agent_classify":       {"name": "Agent: classify enquiry",        "cost": 2},
    "agent_quote_draft":    {"name": "Agent: prepare quotation",       "cost": 2},
    "agent_contract_draft": {"name": "Agent: prepare contract",        "cost": 2},
    "agent_invoice_draft":  {"name": "Agent: prepare invoice",         "cost": 2},
    "agent_send":           {"name": "Agent: send document",           "cost": 2},
    "agent_reminder":       {"name": "Agent: payment reminder",        "cost": 2},
    "agent_receipt":        {"name": "Agent: receipt",                 "cost": 2},
    "agent_analyse":        {"name": "Agent: risk & scenario analysis", "cost": 2},
    # The price of a task none of whose steps has a price of its own (a record added, a checklist
    # prepared): charged once, when the task has succeeded. Every task therefore costs something.
    "agent_task":           {"name": "Agent: task",                    "cost": 2},
    # Not an Agent feature of its own: the existing charge for replying to a marketplace request
    # (migration 025). A reply the Agent sends costs the same as one sent by hand.
    "rfq_response":         {"name": "RFQ Response",                   "cost": 2},
}

# Invoice states in which a reminder must never be sent (s16.6, AC-23).
REMINDER_INELIGIBLE_STATUSES = {"paid", "void", "voided", "cancelled", "canceled", "credited", "disputed", "draft", "written_off"}
