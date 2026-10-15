"""Tunable defaults for Agentic Orchestration.

The PRD leaves these as open commercial/product decisions (s9.1, s28). They are
configuration, not orchestration logic: the database rows seeded by migration
027 override them, so they can be changed without a code release.
"""
from __future__ import annotations

import re


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

# A5: what each task costs, in words, with every figure read from the price list (credits/catalogue.py, after the
# minimum charge), never typed here. Agent settings' two lists, the run page and the charge itself all read this.
# {feature} stands for that feature's price; the task is charged exactly the features named.
COST_WORDS: dict[str, str] = {
    "enquiry_to_quote": "{agent_quote_draft} to prepare the quotation, {agent_send} when it is sent",
    "new_invoice": "{agent_invoice_draft} to prepare the invoice, {agent_send} when it is sent",
    "quote_to_cash": "{agent_invoice_draft} for the invoice draft, {agent_send} when it is sent",
    "new_contract": "{agent_contract_draft} to prepare the contract, {agent_send} when it is sent",
    "receipt_send": "{agent_receipt} to issue the receipt, {agent_send} when it is sent",
    "payment_followup": "{agent_reminder} per reminder sent",
    "new_proposal": "{proposal_full} for the written proposal, {agent_send} when it is sent",
    "new_purchase_order": "{agent_send} when it is sent",
    "credit_note": "{agent_send} when it is sent",
    "idea_validation": "{idea_validation} (a Basic Idea Validation, worked out from your answers)",
    "market_size": "{idea_validation_comprehensive} (a Comprehensive Idea Validation), only when the market is sized",
    "business_plan_draft": "{business_plan_full} (a Complete Business Plan)",
    "sales_letter_draft": "{sales_letter_full} (a Complete Sales Letter)",
}


def default_cost(feature: str) -> int:
    """A feature's price when the live price list has no row for it: the Agent's own, else the price list file's."""
    if feature in CREDIT_FEATURES:
        return int(CREDIT_FEATURES[feature].get("cost", 0))
    return price_credits(feature)


def price_credits(feature: str) -> int:
    """A feature's price from the price list file, as charged (0 stays free; anything else at least the minimum)."""
    from app.modules.credits.catalogue import default_config
    from app.modules.credits.service import charged
    return charged((default_config(feature) or {}).get("credit_cost"))


def short_of(needed: int | None, have: int | None) -> str:
    """The one sentence where the Agent speaks of credits: there aren't enough to do what was asked.
    "This needs 40 credits; you have 31. Top up." Everywhere else the Agent never mentions what anything cost."""
    have = max(0, int(have or 0))
    if needed and needed < 10 ** 6:
        return f"This needs {int(needed)} credit{'s' if int(needed) != 1 else ''}; you have {have}. Top up."
    return f"You have {'no' if not have else have} credit{'s' if have != 1 else ''} left. Top up."


def _words(template: str) -> str:
    """"2 credits to prepare the invoice, 2 when it is sent": the unit is said once, with the first figure."""
    said = {"unit": False}

    def one(m):
        n = price_credits(m.group(1))
        if not n:
            return "free"
        if said["unit"]:
            return str(n)
        said["unit"] = True
        return f"{n} credit{'s' if n != 1 else ''}"
    return re.sub(r"\{([a-z_]+)\}", one, template)


def _all_task_costs() -> dict[str, str]:
    """Every task: its own words, or the Agent task price for one with no priced steps of its own."""
    return {c: _words(COST_WORDS.get(c, "{" + BASE_TASK_FEATURE + "}")) for c in CAPABILITY_MIN_PLAN}


# Tasks whose work is priced by its own product (an Idea Validation, a Business Plan): the Agent adds no charge of its own to those.
SELF_PRICED = ("idea_validation", "market_size", "business_plan_draft", "sales_letter_draft")
# What the owner gets, in their words, on the price confirm (never a capability key).
ACTION_NAME = {"idea_validation": "Validate your idea", "market_size": "Size the market for your idea", "business_plan_draft": "Write your business plan",
               "sales_letter_draft": "Write your sales letter", "new_proposal": "Write your proposal"}
BASE_TASK_FEATURE = "agent_task"
# The price-list feature each self-priced task is charged as (the rest are charged as an Agent task).
PRICED_AS = {"idea_validation": "idea_validation", "market_size": "idea_validation_comprehensive", "business_plan_draft": "business_plan_full",
             "sales_letter_draft": "sales_letter_full"}
# A4: tasks that exist to answer a question ("which of my services sell best?", "what evidence am I missing before I
# launch?"): asked as a question, they run at their listed price rather than as a written chat answer.
ANSWERS_QUESTIONS = frozenset({"offer_review", "launch_evidence_gaps", "capacity_check", "readiness_refresh", "market_size",
                               "price_test", "expansion_scenario"})      # live check: "should I put my prices up", "what would hiring two more do"      # risk questions are answered from the records, free (AC-02)
# A11: an automatic task above this many credits is never started by itself (a chat remark, a record changing): it is
# offered as a suggestion for the owner to start. Set per deployment.
AUTO_START_MAX_CREDITS = 10      # kept for reference only: what decides now is the kind of task (SUGGEST_ONLY), not its price

# PRD alignment §4 (FV §4.1, R4): paid research and generation run only when the owner asks. These are never started by
# the Agent by itself, whatever their price: they are offered as a suggestion with a button, including when an idea is
# mentioned in chat. Free deterministic checks (readiness refresh, launch gaps, registration, price test, capacity, offer
# review, expansion) may still start by themselves.
SUGGEST_ONLY = frozenset({"idea_validation", "market_size", "business_plan_draft", "sales_letter_draft", "funding_pack_draft"})
FREE_DETERMINISTIC = frozenset({"readiness_refresh", "launch_evidence_gaps", "registration_checklist", "price_test", "capacity_check",
                                "offer_review", "expansion_scenario"})


def feature_of(capability: str) -> str | None:
    """What a task is charged as on the price list; None for a free one."""
    if capability in FREE_CAPABILITIES:
        return None
    return PRICED_AS.get(capability, BASE_TASK_FEATURE)

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
    return CAPABILITY_COST.get(capability) or _words("{" + BASE_TASK_FEATURE + "}")


CAPABILITY_COST: dict[str, str] = _all_task_costs()
# One price per task, whoever starts it (A5): what an automatic task costs is what an asked-for one costs.
AUTOMATIC_COST: dict[str, str] = dict(CAPABILITY_COST)
FREE_CAPABILITIES = frozenset(c for c, cost in CAPABILITY_COST.items() if cost == "free")


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

# QA E7: tasks whose reading of the enquiry is part of the price they advertise ("2 credits to prepare the
# quotation"): the reading is never charged on top, so what is charged is what was said.
READING_INCLUDED_IN = frozenset({"enquiry_to_quote"})

# Invoice states in which a reminder must never be sent (s16.6, AC-23).
REMINDER_INELIGIBLE_STATUSES = {"paid", "void", "voided", "cancelled", "canceled", "credited", "disputed", "draft", "written_off"}


# C9: how long the model may take to read a message before the rules read it instead. Simple records are written in a
# few seconds, end to end, whatever the model's provider is doing.
SIMPLE_WRITES = frozenset({"add_customer", "add_vendor", "add_catalogue_item", "record_expense", "update_record", "record_payment", "marketplace_offering"})
FIELD_READ_SECONDS_SIMPLE = 4.5      # live check: the model reads a simple record in 3 to 4.5s; C9 keeps it at 5s or less
FIELD_READ_SECONDS = 10.0
