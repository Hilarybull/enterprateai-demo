"""Which plan includes which Agent task: the one place this is written down.

The rule: the Agent carries out any task that is included in the account's plan, and charges AI
Credits for it. A task outside the plan is never started and never charged.

The Agent's start check, the entitlement the pages read, and the "locked" marks on suggestions
all come from this table. To move a task to another plan, move its name between the tuples below.
Plans are cumulative: each one includes everything in the plans before it.
"""
from __future__ import annotations

PLAN_ORDER = ("explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os")
PLAN_LABEL = {"explorer": "Explorer", "starter_insight": "Starter", "decision_engine": "Decision Engine",
              "growth_navigator": "Growth Navigator", "strategic_business_os": "Strategic Business OS"}

# What each plan adds to the one before it.
_ADDS: dict[str, tuple[str, ...]] = {
    # Explorer: the everyday documents and records, a first look at an idea, a plan, registration
    # guidance and one Marketplace listing.
    "explorer": (
        "new_invoice", "receipt_send", "new_contract", "record_expense", "record_payment",
        "add_customer", "add_catalogue_item", "add_vendor", "update_record",
        "idea_validation", "business_plan_draft", "registration_checklist",
        "marketplace_profile", "marketplace_offering",
    ),
    # Starter: proposals, quotation management, chasing payments, scenarios (a few a month), risk
    # and the fragility index, funding and launch preparation, and the wider document set.
    "starter_insight": (
        "new_proposal", "enquiry_to_quote", "quote_to_cash", "payment_followup",
        "scenario_help", "expansion_scenario", "risk_concentration",
        "funding_pack_draft", "readiness_refresh", "launch_evidence_gaps",
        "market_size", "price_test", "capacity_check", "offer_review",
        "credit_note", "new_purchase_order", "supplier_bill",
    ),
    # Decision Engine and above add no new Agent tasks: they lift the monthly quotas below.
    "decision_engine": (),
    "growth_navigator": (),
    "strategic_business_os": (),
}

PLAN_CAPABILITIES: dict[str, frozenset[str]] = {}
_so_far: set[str] = set()
for _plan in PLAN_ORDER:
    _so_far |= set(_ADDS[_plan])
    PLAN_CAPABILITIES[_plan] = frozenset(_so_far)

# How many of a thing a plan includes in a calendar month (or in all, for listings). None: no limit.
# A task counted here is blocked, not charged, once the plan's number is used.
QUOTAS: dict[str, dict[str, int | None]] = {
    "explorer":              {"scenario_help": 0, "marketplace_listings": 1},
    "starter_insight":       {"scenario_help": 4, "marketplace_listings": None},
    "decision_engine":       {"scenario_help": None, "marketplace_listings": None},
    "growth_navigator":      {"scenario_help": None, "marketplace_listings": None},
    "strategic_business_os": {"scenario_help": None, "marketplace_listings": None},
}
QUOTA_WORDS = {"scenario_help": "scenario simulations"}

# Something the plan does include, to offer in place of a task it doesn't.
ALTERNATIVE: dict[str, tuple[str, str]] = {
    "enquiry_to_quote": ("new_invoice", "Create an invoice instead"),
    "quote_to_cash": ("new_invoice", "Create an invoice instead"),
    "new_proposal": ("new_contract", "Draft a contract instead"),
    "funding_pack_draft": ("business_plan_draft", "Draft a business plan instead"),
    "market_size": ("idea_validation", "Validate the idea instead"),
}


def plan_rank(plan: str | None) -> int:
    return PLAN_ORDER.index(plan) if plan in PLAN_ORDER else 0


def all_capabilities() -> frozenset[str]:
    return PLAN_CAPABILITIES[PLAN_ORDER[-1]]


def min_plan_for(capability: str) -> str | None:
    """The cheapest plan that includes the task; None for something no plan lists (it is then open to all)."""
    return next((p for p in PLAN_ORDER if capability in PLAN_CAPABILITIES[p]), None)


def plan_allows(plan: str | None, capability: str) -> bool:
    need = min_plan_for(capability)
    return need is None or plan_rank(plan) >= plan_rank(need)


def quota(plan: str | None, key: str) -> int | None:
    """The plan's monthly number for a counted task; None when it isn't counted on this plan."""
    return (QUOTAS.get(plan if plan in PLAN_ORDER else "explorer") or {}).get(key)


def alternative(plan: str | None, capability: str) -> dict | None:
    other = ALTERNATIVE.get(capability)
    return {"label": other[1], "capability": other[0]} if other and plan_allows(plan, other[0]) else None
