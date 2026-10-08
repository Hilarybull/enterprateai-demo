"""Activation and education emails: the journeys, their schedule, the message library and
the rules that read a user's state from their own records.

Three journeys:
  A  no workspace yet           -> ends when a workspace is created (then B)
  B  workspace, no first result -> ends when a meaningful task is completed (then C)
  C  continuing education       -> at most two useful tips a month

Everything here is deterministic. Nothing is decided from a click or an open: only from what
the account and its workspaces actually contain. No email carries idea text, scores, financial
figures or any other business content.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

TEMPLATE_VERSION = "2026-10-v1"
DEFAULT_TIMEZONE = "Europe/London"
SEND_FROM, SEND_UNTIL = time(9, 0), time(18, 0)      # local time; the last send starts before 18:00
MIN_GAP = timedelta(hours=48)                         # never two activation emails closer than this
C_PER_MONTH = 2
C_WINDOW = timedelta(days=30)
C_MIN_GAP = timedelta(days=10)
INACTIVE_AFTER = timedelta(days=90)                   # no activity for this long: continuing tips stop
MAX_ATTEMPTS = 3

# Permission. "unknown" is every account that was never asked: it is not a permission.
PERMITTED = ("subscribed", "soft_opt_in")
STATUSES = ("unknown", "subscribed", "soft_opt_in", "unsubscribed", "suppressed")

# When each step is due, measured from the journey's start.
SCHEDULE: dict[str, list[tuple[str, timedelta]]] = {
    "A": [("a1", timedelta(minutes=10)), ("a2", timedelta(hours=24)), ("a3", timedelta(days=3)), ("a4", timedelta(days=6)), ("a5", timedelta(days=10))],
    "B": [("b1", timedelta(minutes=10)), ("b2", timedelta(days=3)), ("b3", timedelta(days=7))],
}

# The message library. `to` is a path inside the app; the sender adds attribution and the
# recipient signs in first if they need to. Copy differs from the brief only where the brief's
# wording claimed something the product doesn't do (see NOTES).
TEMPLATES: dict[str, dict[str, Any]] = {
    "a1": {"journey": "A", "subject": "Create your EnterprateAI workspace",
           "body": ["You have an EnterprateAI account. The next step is to create your workspace so your business information has one place to live.",
                    "Start with your business name or working idea; you can build from there. Once your workspace is ready, you can explore the tools that fit what you are trying to do."],
           "button": "Create my workspace", "to": "/onboarding"},
    "a2": {"journey": "A", "subject": "A simple way to get started",
           "body": ["You do not need a finished business plan to begin. Create a workspace, add a short description of the idea or business you want to work on, and choose one decision you want to make.",
                    "If you are exploring a new idea, Basic Idea Validation is a useful first step. If you already trade, start with the part of your business you want to organise."],
           "button": "Set up my workspace", "to": "/onboarding"},
    "a3": {"journey": "A", "subject": "What could your first business insight reveal?",
           "body": ["A promising idea still has questions to test: who needs it, how it might earn revenue, and what could make it difficult to deliver.",
                    "EnterprateAI Idea Validation helps structure those questions and provides scores, risks and suggested next actions. Create your workspace to begin exploring your own idea.",
                    "The output supports your judgement; it is not financial, legal or investment advice."],
           "button": "Explore Idea Validation", "to": "/onboarding?next=%2Fvalidation"},
    "a4": {"journey": "A", "subject": "Start where your business is today",
           "body": ["Have an idea you have not launched? Begin with Idea Validation to test the assumptions behind it.",
                    "Already running a business? A workspace can bring your catalogue, documents and financial activity into one place, with other tools available according to your plan.",
                    "Choose the path that fits you and take one small step today."],
           "button": "Choose my starting point", "to": "/onboarding"},
    "a5": {"journey": "A", "subject": "Can we help you take the first step?",
           "body": ["You have not created a workspace yet. If the set-up is unclear, reply to this email and tell us where you got stuck.",
                    "If the timing simply is not right, that is fine. Your account is there when you are ready."],
           "button": "Create my workspace", "to": "/onboarding"},
    "b1": {"journey": "B", "subject": "Your workspace is set up: choose your first result",
           "body": ["Your workspace is ready. If you are testing a new idea, open Idea Validation and describe the problem, customer and proposed solution.",
                    "If you are already operating, begin with a product or service in your catalogue or another task that matches your goal. Focus on one useful result today."],
           "button": "Open my first task", "to": "/dashboard"},
    "b2": {"journey": "B", "subject": "One question worth answering this week",
           "body": ["What decision are you facing now: whether an idea has demand, how a change might affect cash, or how to present your offer?",
                    "Pick one question and use the relevant EnterprateAI tool. Your workspace keeps the information together so you can build on it later."],
           "button": "Continue in my workspace", "to": "/tools"},
    "b3": {"journey": "B", "subject": "What would make EnterprateAI easier to use?",
           "body": ["If you began setting up but have not completed a task, we would like to understand why.",
                    "Reply with the one thing that stopped you. We can point you to a practical starting route."],
           "button": "Open my workspace", "to": "/dashboard"},
}

# Continuing tips. Each names the feature it needs, what must already be true, and the action it
# suggests: a tip is never sent to someone without access to the feature, or who has already done it.
TIPS: dict[str, dict[str, Any]] = {
    "c1": {"journey": "C", "subject": "Turn your validation into a next step", "feature": "validation", "needs": ("validation_completed",), "suggests": "blueprint_created",
           "body": ["Your report can help you decide what to test next. Review the strongest evidence gaps and prioritised actions, then use your workspace to refine the idea.",
                    "You can also explore a Business Blueprint if it is available on your plan. Treat the report as decision support and verify important assumptions independently."],
           "button": "Review my next steps", "to": "/validation"},
    "c2": {"journey": "C", "subject": "What happens if one assumption changes?", "feature": "simulation", "needs": ("operating",), "suggests": "simulation_run",
           "body": ["A useful business decision often depends on a few variables. The Simulation tool can help you explore how a change in revenue, cost or client mix might affect projected results.",
                    "Use a realistic assumption and compare it with your current position."],
           "button": "Explore scenarios", "to": "/simulation"},
    "c3": {"journey": "C", "subject": "Let the information you already entered do more", "feature": "catalogue", "needs": ("invoice_or_catalogue",), "suggests": "catalogue_reviewed",
           "body": ["Your catalogue can hold the products and services behind your documents and financial activity.",
                    "Check that descriptions, prices and costs are current, then explore how that information can support quotations or invoices in your workspace."],
           "button": "Review my catalogue", "to": "/catalogue"},
}
ALL_TEMPLATES = {**TEMPLATES, **TIPS}

# Where the brief's copy was changed, and why. Shown to administrators so the difference is on record.
NOTES = [
    {"step": "a1", "was": "Your EnterprateAI workspace is ready", "now": "Create your EnterprateAI workspace",
     "why": "The email goes to people who have no workspace, so nothing is ready yet."},
    {"step": "c2", "was": "Scenario Intelligence ... where your plan includes access", "now": "The Simulation tool",
     "why": "The app calls this Simulation, and the tip is only sent to accounts whose plan includes it."},
    {"step": "b3", "was": "use the help option in the app", "now": "Reply with the one thing that stopped you",
     "why": "There is no help option in the app to point at. Replies need a monitored address."},
    {"step": "b1", "was": "Your workspace is set up choose your first result", "now": "Your workspace is set up: choose your first result", "why": "Punctuation."},
]


# ── reading a user's state from their records ─────────────────────────────────

def _fin(data: dict, key: str) -> list:
    return [x for x in ((data.get("financials") or {}).get(key) or []) if isinstance(x, dict) and not x.get("archived")]


def workspace_facts(data: dict) -> dict[str, bool]:
    """What one workspace's records show has been done. Presence of the record, never a click."""
    data = data or {}
    validation = data.get("validation") or data.get("idea_validation") or (data.get("decision") or {}).get("status") == "accepted"
    products = [p for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict) and not p.get("archived")]
    simulations = data.get("simulations") or data.get("simulation_runs") or (data.get("scenario_intelligence") or {}).get("runs") or data.get("scenarios")
    return {
        "validation_completed": bool(validation),
        "first_invoice_created": bool(_fin(data, "invoices")),
        "blueprint_created": bool(data.get("blueprints") or data.get("business_plan") or data.get("live_plan")),
        "marketplace_listing_created": bool((data.get("marketplace") or {}).get("is_active")),
        "catalogue_started": bool(products),
        "simulation_run": bool(simulations),
        "quote_created": bool(_fin(data, "quotes")),
    }


MEANINGFUL = ("validation_completed", "first_invoice_created", "blueprint_created", "marketplace_listing_created", "catalogue_started", "simulation_run", "quote_created")


def user_facts(workspaces: list[dict]) -> dict[str, Any]:
    """Everything the journeys need to know about a user, from all the workspaces they own."""
    facts = {k: False for k in MEANINGFUL}
    created, updated = [], []
    for w in workspaces or []:
        for k, v in workspace_facts(w.get("data") or {}).items():
            facts[k] = facts[k] or v
        if w.get("created_at"):
            created.append(str(w["created_at"]))
        if w.get("updated_at") or w.get("created_at"):
            updated.append(str(w.get("updated_at") or w.get("created_at")))
    facts["has_workspace"] = bool(workspaces)
    facts["workspace_created_at"] = min(created) if created else None
    facts["last_active_at"] = max(updated) if updated else None
    facts["first_task_done"] = any(facts[k] for k in MEANINGFUL)
    facts["operating"] = facts["first_invoice_created"] or facts["quote_created"]
    facts["invoice_or_catalogue"] = facts["first_invoice_created"] or facts["catalogue_started"]
    facts["catalogue_reviewed"] = False      # there is no record of a review: the tip is simply not repeated
    return facts


def plan_allows(plan: str | None, feature: str) -> bool:
    """Whether an account's plan includes the feature a tip is about."""
    plan = str(plan or "explorer")
    if feature == "simulation":
        return plan != "explorer"
    return True


def eligible_tips(facts: dict, plan: str | None, already_sent: set[str]) -> list[str]:
    """Tips this user could usefully get now, in order: has access, meets the tip's condition,
    hasn't done what it suggests, and hasn't had it before."""
    out = []
    for key, tip in TIPS.items():
        if key in already_sent or not plan_allows(plan, tip["feature"]):
            continue
        if not all(facts.get(need) for need in tip["needs"]) or facts.get(tip["suggests"]):
            continue
        out.append(key)
    return out


# ── time ──────────────────────────────────────────────────────────────────────

def parse(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except Exception:      # noqa: BLE001 - an unknown zone name falls back to the default
        return ZoneInfo(DEFAULT_TIMEZONE)


def in_send_window(now: datetime, tz: str | None) -> bool:
    local = now.astimezone(zone(tz))
    return SEND_FROM <= local.time() < SEND_UNTIL


def next_window_start(now: datetime, tz: str | None) -> datetime:
    """The next moment it is 09:00 to 18:00 where the user is (now, if it already is)."""
    z = zone(tz)
    local = now.astimezone(z)
    if SEND_FROM <= local.time() < SEND_UNTIL:
        return now
    day = local.date() if local.time() < SEND_FROM else local.date() + timedelta(days=1)
    return datetime.combine(day, SEND_FROM, tzinfo=z).astimezone(timezone.utc)


def first_name(name: Any) -> str | None:
    """A first name, only when one is plainly there: not an email address, not a single letter."""
    text = str(name or "").strip()
    if not text or "@" in text:
        return None
    first = text.split()[0].strip(",.")
    return first if len(first) >= 2 and first.isalpha() else None
