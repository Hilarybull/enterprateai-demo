"""Goal-driven onboarding (PRD-GO-001): a visitor says what they want, and the workspace forms
around that.

Three parts, none of which executes anything itself:

* The **Goal Resolver** turns a business goal, a quick task or free text into an underlying
  outcome and a path made ONLY of capabilities that are registered right now (Agent workflows,
  and the Funding and Launch Readiness modules when they are switched on). It uses fixed rules,
  no model, so it costs no AI Credits and cannot name a capability that does not exist.
* A **TaskSession** holds the goal and the few answers given before sign-up. It is temporary:
  nothing about a business, a customer or a document is written for an anonymous visitor.
* **Prepare** hands the session to what already does the work: the Agent (the same request
  every other entry point sends) or the Funding Readiness module. Approvals, permissions and
  credits are theirs, unchanged.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent import config, intent
from app.modules.agent.workflows import WORKFLOWS

logger = logging.getLogger(__name__)

REGISTRY_VERSION = "goals-2026-10-07"
SESSION_DAYS = 7      # how long an unfinished session is kept; disclosed on the homepage

# Session states (PRD s11).
INITIATED, COLLECTING, AWAITING_IDENTITY, RESUMING, COLLECTING_REQUIRED = "initiated", "collecting_context", "awaiting_identity", "resuming", "collecting_required_data"
READY, PREPARING, AWAITING_REVIEW, HANDED_OFF, BLOCKED, ABANDONED = "ready_to_prepare", "preparing", "awaiting_review", "handed_off", "blocked", "abandoned"

DIRECT, COMPOSITE, PARTIAL, NO_MATCH = "direct_supported", "composite_goal", "partial_support", "no_match"

# Modules that are capabilities but not Agent workflows.
_MODULES = {"funding_readiness": "Funding Readiness", "launch_readiness": "Launch Readiness"}


def registry() -> dict[str, str]:
    """Every capability that exists right now: {key: label}. The one source the resolver may offer from."""
    out = {key: wf.title for key, wf in WORKFLOWS.items()}
    try:
        from app.modules.readiness import router as readiness_router
        from app.modules.readiness import rules
        if readiness_router.enabled(rules.FUNDING):
            out["funding_readiness"] = _MODULES["funding_readiness"]
        if readiness_router.enabled(rules.LAUNCH):
            out["launch_readiness"] = _MODULES["launch_readiness"]
    except Exception:      # noqa: BLE001 - a module that can't be loaded is simply not offered
        logger.debug("readiness modules not available to the goal registry", exc_info=True)
    return out


def _f(key: str, label: str, kind: str = "text", **extra: Any) -> dict:
    return {"key": key, "label": label, "type": kind, **extra}


def _money(key: str, label: str, **extra: Any) -> dict:
    """An amount of money: shown with the currency sign in front."""
    return _f(key, label, "number", prefix="£", **extra)


_FUNDING_AMOUNTS = [{"value": v, "label": f"£{v:,}"} for v in (10000, 25000, 50000, 100000, 250000)]


# The homepage's suggestions and what each resolves to. `path` lists capabilities in the order
# they help; only those in the registry are ever shown or started. `start` is the first thing
# prepared after sign-up. Copy never promises an outcome the product cannot control.
GOALS: list[dict[str, Any]] = [
    {"key": "need_funding", "mode": "business_goal", "label": "I need funding", "outcome": "Become funding-ready and prepare what a funder will ask for",
     "class": PARTIAL, "start": "funding_readiness", "path": ["funding_readiness", "funding_pack_draft", "business_plan_draft", "scenario_help"],
     "say": "I can help you become more funding-ready: assess where you stand, show the gaps, organise your evidence and prepare the materials.",
     "boundary": "I can't guarantee funding, or a yes from any investor or lender.",
     "questions": [_money("amount", "How much funding are you looking for?", required=True, chips=_FUNDING_AMOUNTS),
                   _f("use", "What will the money be used for?", "textarea", required=True),
                   _f("stage", "Where is the business now?", "choice", required=True,
                      options=[{"value": "pre_revenue", "label": "Not trading yet"}, {"value": "trading", "label": "Trading"}])]},
    {"key": "more_customers", "mode": "business_goal", "label": "I need more customers", "outcome": "Work toward winning more customers",
     "class": COMPOSITE, "start": "offer_review", "path": ["offer_review", "marketplace_profile", "marketplace_offering", "new_proposal", "enquiry_to_quote"],
     "say": "I can help you work toward getting more customers: review what sells, improve how your business appears in the Marketplace, "
            "and prepare proposals and quotations for the enquiries you get.",
     "boundary": "I can't guarantee customers or bring them to you directly.",
     "questions": [_f("sell", "What do you sell?", "text", required=True), _f("customer", "Who is your ideal customer?", "text", required=True),
                   _f("channel", "Where do your customers come from today?", "text")]},
    {"key": "price_offer", "mode": "business_goal", "label": "Help me price my product/service", "outcome": "Model a price against cost, margin and break-even",
     "class": PARTIAL, "start": "price_test", "path": ["price_test", "add_catalogue_item", "scenario_help"],
     "say": "I can model a price for you: what it means for your margin, and how much volume you could lose before a higher price stops paying.",
     "boundary": "The price you charge stays your decision.",
     "questions": [_f("sell", "What are you pricing?", "text", required=True), _money("price", "What price do you have in mind?"),
                   _money("cost", "What does it cost you to deliver?")]},
    {"key": "launch", "mode": "business_goal", "label": "I want to launch a product/service", "outcome": "Check launch readiness and close the gaps",
     "class": PARTIAL, "start": "launch_readiness", "path": ["launch_readiness", "idea_validation", "launch_evidence_gaps", "scenario_help"],
     "say": "I can assess how ready the launch is, list what is missing and what to do next, and test the idea behind it.",
     "boundary": "I work from what you tell me and what is on record: I won't invent market evidence.",
     "questions": [_f("sell", "What are you launching?", "text", required=True), _f("customer", "Who is it for?", "text", required=True),
                   _f("target_date", "When do you want to launch?", "date")]},
    {"key": "cash_flow", "mode": "business_goal", "label": "Improve my cash flow", "outcome": "See what drives cash and act on it",
     "class": COMPOSITE, "start": "scenario_help", "path": ["payment_followup", "new_invoice", "record_expense", "scenario_help", "risk_concentration"],
     "say": "I can show what is driving your cash, chase unpaid invoices for you, get invoices out faster and model what a change would do.",
     "boundary": "The figures come from your own records, worked out exactly: nothing is estimated for you.",
     "questions": [_f("owed", "Are customers paying you late?", "choice",
                      options=[{"value": "yes", "label": "Yes, often"}, {"value": "some", "label": "Sometimes"}, {"value": "no", "label": "No"}]),
                   _f("pressure", "What is the biggest pressure on cash right now?", "text")]},
    {"key": "grow", "mode": "business_goal", "label": "Help me grow my business", "outcome": "Find what limits growth and a path through it",
     "class": COMPOSITE, "start": "expansion_scenario", "path": ["expansion_scenario", "capacity_check", "offer_review", "scenario_help"],
     "say": "I can work out what growing would do to your revenue and costs, check whether you have the capacity for it, and review what sells.",
     "boundary": "I can't guarantee a growth result.",
     "questions": [_f("sell", "What do you sell?", "text", required=True), _f("limit", "What is holding growth back today?", "text")]},
    {"key": "test_idea", "mode": "business_goal", "label": "Test a business idea", "outcome": "Score a business idea and see its risks",
     "class": DIRECT, "start": "idea_validation", "path": ["idea_validation", "market_size", "business_plan_draft"],
     "say": "I can score your idea, show the risks and next steps, and size the market for it.",
     "boundary": "The score comes from the validation engine, from what you tell me: I won't make up demand.",
     "questions": [_f("description", "What is the idea? (1 to 2 sentences)", "textarea", required=True), _f("customer", "Who is the customer?", "text", required=True),
                   _f("problem", "What problem does it solve for them?", "textarea", required=True)]},
    {"key": "business_risks", "mode": "business_goal", "label": "Help me understand my business risks", "outcome": "See the risks in the business and what to do about them",
     "class": COMPOSITE, "start": "risk_concentration", "path": ["risk_concentration", "scenario_help", "readiness_refresh"],
     "say": "I can show where the business is fragile: reliance on a few customers, late payment and cash, and what a shock would do.",
     "boundary": "Risks are worked out from your records, so the more of the business is on record, the more I can see.",
     "questions": [_f("worry", "What worries you most about the business right now?", "text")]},
    # Quick tasks: for someone who knows the document they want.
    {"key": "create_invoice", "mode": "quick_task", "label": "Create Invoice", "outcome": "An invoice ready for your approval",
     "class": DIRECT, "start": "new_invoice", "path": ["new_invoice"], "say": "I'll prepare the invoice and have it ready for you to approve. Nothing is sent until you say so.", "boundary": "",
     "questions": [_f("customer", "Who is it for?", "text", required=True), _f("item", "What is it for?", "text", required=True),
                   _money("amount", "How much?", required=True)]},
    {"key": "create_quotation", "mode": "quick_task", "label": "Create Quotation", "outcome": "A quotation ready for your approval",
     "class": DIRECT, "start": "enquiry_to_quote", "path": ["enquiry_to_quote"], "say": "I'll prepare the quotation and have it ready for you to approve. Nothing is sent until you say so.", "boundary": "",
     "questions": [_f("customer", "Who is it for?", "text", required=True), _f("item", "What are you quoting for?", "text", required=True),
                   _money("amount", "At what price?", required=True)]},
    {"key": "create_business_plan", "mode": "quick_task", "label": "Create Business Plan", "outcome": "A business plan draft to review",
     "class": DIRECT, "start": "business_plan_draft", "path": ["business_plan_draft"], "say": "I'll draft your business plan from what you tell me and show what is still missing.", "boundary": "",
     "questions": [_f("description", "What does the business do? (1 to 2 sentences)", "textarea", required=True), _f("customer", "Who is the customer?", "text", required=True),
                   _f("problem", "What problem does it solve for them?", "textarea", required=True)]},
    {"key": "prepare_proposal", "mode": "quick_task", "label": "Prepare Proposal", "outcome": "A proposal ready for your approval",
     "class": DIRECT, "start": "new_proposal", "path": ["new_proposal"], "say": "I'll prepare the proposal and have it ready for you to approve. Nothing is sent until you say so.", "boundary": "",
     "questions": [_f("customer", "Who is it for?", "text", required=True), _f("solution", "What are you proposing?", "textarea", required=True),
                   _money("amount", "At what price?")]},
]
_BY_KEY = {g["key"]: g for g in GOALS}

# Free text that states an outcome rather than a document: which goal it means.
_OUTCOMES: list[tuple[str, re.Pattern]] = [
    ("need_funding", re.compile(r"\b(funding|fund(s|ed)?|investors?|investment|raise (money|capital|funds)|loans?|grants?|finance my|borrow\w*"
                                r"|rais(e|ing) (about |around |up to )?(£|\d)|(need|want|looking for|after) (about |around |roughly )?(£\s?\d|\d[\d,]*\s?(k|m|thousand|million|pounds)\b))", re.I)),
    ("more_customers", re.compile(r"\b(more (customers|clients|sales|leads|work|business)|win (more )?(work|customers|clients|contracts)|get (customers|clients|leads)|find (customers|clients))\b", re.I)),
    ("price_offer", re.compile(r"\b(pric(e|ing) (my|our|a|the)|how much (should|to) (i )?charge|what (should|to) (i )?charge|help me price)\b", re.I)),
    ("launch", re.compile(r"\blaunch\w*\b", re.I)),
    ("cash_flow", re.compile(r"\b(cash ?flow|cash position|running out of (cash|money)|paid (late|faster|on time)|late pay\w*)\b", re.I)),
    ("test_idea", re.compile(r"\b((business |startup |new )idea|test (an?|my) idea|validat\w+)\b", re.I)),
    ("business_risks", re.compile(r"\b(risks?|fragil\w*|what could go wrong)\b", re.I)),
    ("grow", re.compile(r"\b(grow\w*|scale (up|my|the)|expand\w*)\b", re.I)),
    ("create_business_plan", re.compile(r"\bbusiness plans?\b", re.I)),
]
# The homepage goal each directly-named capability belongs to (for its questions and wording).
_GOAL_OF_CAPABILITY = {"new_invoice": "create_invoice", "quote_to_cash": "create_invoice", "enquiry_to_quote": "create_quotation", "new_proposal": "prepare_proposal",
                       "business_plan_draft": "create_business_plan", "idea_validation": "test_idea", "risk_concentration": "business_risks"}
_PROVENANCE = "agent workflows and readiness modules"

# Asks that are about the business but could mean several things: which goals to offer.
_VAGUE: list[tuple[re.Pattern, list[str]]] = [
    (re.compile(r"\b(money|finances?|financ\w+|cash|profit\w*|income|revenue|budget\w*)\b", re.I), ["cash_flow", "need_funding", "price_offer"]),
    (re.compile(r"\b(sales|sell\w*|market\w*|customers?|clients?|leads?)\b", re.I), ["more_customers", "price_offer", "grow"]),
    (re.compile(r"\b((my|our|the|a) (business|company|start-?up|shop|firm)|struggl\w+|improv\w+|do better|get started|not sure|don'?t know)\b", re.I),
     ["grow", "more_customers", "cash_flow", "business_risks"]),
]
# What each goal is called on a chip when the visitor is asked to choose.
_CHIP = {"cash_flow": "Improve cash flow", "need_funding": "Get funding-ready", "price_offer": "Price my product", "more_customers": "Get more customers",
         "grow": "Grow the business", "launch": "Launch something", "test_idea": "Test an idea", "business_risks": "Understand my risks",
         "create_business_plan": "Write a business plan"}
OTHER = "other"


def _clarify(original: str, keys: list[str], reg: dict[str, str], rule: str) -> dict | None:
    """One question with a few chips (PRD s8.2.2). None when fewer than two routes really exist."""
    offered = [k for k in keys if _valid_path(_BY_KEY[k], reg)][:3]
    if len(offered) < 2:
        return None
    return {**_no_match(original, rule), "resolution_class": "clarify", "confidence": 0.4, "credit_implication": "",
            "message": "I can help with that in more than one way. Which is closest to what you need?",
            "clarify": _f("goal_key", "Which is closest?", "choice", required=True,
                          options=[{"value": k, "label": _CHIP.get(k, _BY_KEY[k]["label"])} for k in offered] + [{"value": OTHER, "label": "Something else"}])}


# ── what the visitor already said (PRD s8, s9.1) ─────────────────────────────
_AMOUNT = re.compile(r"(?:[£$€₦]|\b(?:gbp|usd|eur|ngn)\s?)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|thousand|million)?\b"
                     r"|\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|thousand|million|pounds?|quid|gbp|dollars?|usd|euros?|eur|naira|ngn)\b", re.I)
_SCALE = {"k": 1_000, "thousand": 1_000, "m": 1_000_000, "million": 1_000_000}
_DOC_WORD = re.compile(r"^.*?\b(invoices?|quotations?|quotes?|proposals?|estimates?|bills?)\b", re.I)
_COMPANY = re.compile(r"\b(ltd|limited|llp|llc|inc|plc|co|company|group|& ?co)\b\.?", re.I)
_NOT_A_USE = re.compile(r"\b(funding|investors?|investment|loans?|grants?|my business|the business|me)\b", re.I)


def _tidy(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip(" .,:;-–\"'")[:200]


# Words that say a phrase is the work, not who it is for.
_WORK = re.compile(r"\b(\w+(ing|tion|ment|ance)|design|redesign|website|web|site|app|logo|services?|work|hours?|days?|weeks?|months?|project|repairs?|maintenance|support"
                   r"|audit|rent|fees?|delivery|refit|kitchen|office|garden|subscription|licen[cs]e|retainer|workshop|review|plan|report|goods|products?|items?|order)\b", re.I)


def _is_name(value: str) -> bool:
    """A customer rather than a piece of work: a company word, words written with capitals, or a
    short phrase with no word for work in it ("mark", "john smith")."""
    if _COMPANY.search(value) or any(w[:1].isupper() for w in value.split()):
        return True
    words = value.split()
    return len(words) <= 2 and not _WORK.search(value) and not re.match(r"^(a|an|the|my|our|some)\b", value, re.I)


def extract(text: str, goal_key: str | None) -> dict[str, Any]:
    """Values the visitor has already given in their own sentence, for the goal's questions.
    Rules only, and only what is plainly there: anything doubtful is left to be asked."""
    text = (text or "").strip()
    wanted = {f["key"] for f in (_BY_KEY.get(goal_key or "") or {}).get("questions") or []}
    if not text or not wanted:
        return {}
    out: dict[str, Any] = {}
    rest = text
    m = _AMOUNT.search(text)
    if m:
        number, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        try:
            amount = float(number.replace(",", "")) * _SCALE.get((unit or "").lower(), 1)
        except ValueError:
            amount = 0
        if amount > 0 and "amount" in wanted:
            out["amount"] = amount
        # The amount comes out with the word that led up to it ("for £1,500", "at 2k").
        rest = re.sub(r"(?:\s*,)?(?:\s+(?:for|at|of|costing|worth|totall?ing|priced at|@))?\s*" + re.escape(m.group(0)), " ", text, count=1, flags=re.I)
    if goal_key == "need_funding":
        # What it is for follows the amount when one was given ("£50k for hiring"); otherwise the first "for".
        use = re.search(r"\b(?:for|to (?:fund|pay for|cover|finance)|to)\s+(.+)$", text[m.end():], re.I) if m else re.search(r"\bfor\s+(.+)$", rest, re.I)
        if use and "use" in wanted and not _NOT_A_USE.search(use.group(1)) and len(_tidy(use.group(1))) > 2:
            out["use"] = _tidy(use.group(1))
        return out
    if not ({"customer", "item", "solution"} & wanted) or goal_key not in ("create_invoice", "create_quotation", "prepare_proposal"):
        return out
    # A document: read by the same reader the Agent chat uses (app.modules.agent.said), so the
    # homepage and the chat take the same things from the same sentence.
    from app.modules.agent import said
    told = said.read(text, datetime.now(timezone.utc).date())
    out = {}
    if told.get("amount") and "amount" in wanted:
        out["amount"] = float(told["amount"])
    if told.get("currency") and told["currency"] != "GBP":
        out["currency"] = told["currency"]      # kept beside the answers: "$300" is 300 in USD, never £300
    if told.get("party"):
        out["customer"] = _display_name(told["party"])
    if told.get("work"):
        out["solution" if "solution" in wanted else "item"] = told["work"]
    return {k: v for k, v in out.items() if v not in ("", None)}


def _display_name(name: str) -> str:
    """A name typed all in lower case is shown with its capitals ("mark" -> "Mark"); anything else is left as written."""
    name = _tidy(name)
    return " ".join(w[:1].upper() + w[1:] for w in name.split()) if name == name.lower() else name


def _valid_path(goal: dict, reg: dict[str, str]) -> list[str]:
    return [c for c in goal["path"] if c in reg]


def suggestions(reg: dict[str, str] | None = None) -> dict:
    """What the homepage may show: only goals and tasks that resolve to something registered now."""
    reg = registry() if reg is None else reg
    shown = [g for g in GOALS if _valid_path(g, reg)]
    return {"prompt": "What do you want EnterprateAI to do for your business?",
            "reassurance": "Free essential business tools. 50 AI Credits to get started.",
            "goals": [{"key": g["key"], "label": g["label"]} for g in shown if g["mode"] == "business_goal"],
            "tasks": [{"key": g["key"], "label": g["label"]} for g in shown if g["mode"] == "quick_task"],
            "retention_days": SESSION_DAYS, "version": REGISTRY_VERSION}


def _credit_text(capability: str | None) -> str:
    if not capability or capability in _MODULES:
        return "Free to start: working this out with you uses no AI Credits."
    cost = config.cost_of(capability)
    if cost != "Free" and config.FIRST_TASK_FREE and capability in config.FREE_FIRST_TASKS:
        return f"Your first one on a new account is free: no AI Credits to prepare or send it. After that, {cost[0].lower() + cost[1:]}."
    return "Free: this uses no AI Credits." if cost == "Free" else f"Working this out with you is free. Preparing it uses AI Credits ({cost[0].lower() + cost[1:]})."


def _credit_badge(capability: str | None) -> str:
    """The credit position in three or four words, for the task card."""
    if not capability or capability in _MODULES:
        return "Free"
    if config.cost_of(capability) == "Free":
        return "Free"
    if config.FIRST_TASK_FREE and capability in config.FREE_FIRST_TASKS:
        return "Free"
    return "Uses AI Credits"

def _display_credit_badge(session: dict) -> str:
    start = (session.get("resolution") or {}).get("start_capability")
    if not session.get("user_id") or (session.get("new_workspace") and start in config.FREE_FIRST_TASKS):
        return "Free"
    cost = config.cost_of(start) if start else "Free"
    if cost == "Free":
        return "Free"
    match = re.search(r"(\d+)", cost)
    return f"Uses {match.group(1)} credits" if match else "Uses AI Credits"


def _no_match(original: str, rule: str = "none") -> dict:
    return {"original_goal": original, "goal_key": None, "underlying_outcome": None, "resolution_class": NO_MATCH, "candidate_capabilities": [],
            "start_capability": None, "confidence": 0.0, "execution_boundary": "",
            "message": "EnterprateAI doesn't do that at the moment, so I won't pretend it can. "
                       "It helps you plan, quote, invoice, get paid, check readiness for funding or a launch, and understand your risks.",
            "recommended_path": [], "credit_implication": "Nothing was used.",
            "provenance": {"registry": _PROVENANCE, "version": REGISTRY_VERSION, "rule": rule}}


def _resolution(goal: dict, original: str, reg: dict[str, str], confidence: float, rule: str, direct: str | None = None) -> dict:
    path = _valid_path(goal, reg)
    start = direct if direct in reg else (goal["start"] if goal["start"] in reg else (path[0] if path else None))
    if not path or not start:
        return _no_match(original, rule)
    ordered = [start] + [c for c in path if c != start]
    return {
        "original_goal": original, "goal_key": goal["key"], "underlying_outcome": goal["outcome"],
        "resolution_class": DIRECT if direct else goal["class"],
        "candidate_capabilities": [{"capability": c, "label": reg[c]} for c in ordered],
        "start_capability": start, "confidence": confidence,
        "execution_boundary": goal.get("boundary") or "", "message": goal["say"],
        "recommended_path": [reg[c] for c in ordered][:4], "credit_implication": _credit_text(start), "credit_badge": _credit_badge(start),
        "provenance": {"registry": _PROVENANCE, "version": REGISTRY_VERSION, "rule": rule},
    }


def resolve(*, text: str | None = None, key: str | None = None, reg: dict[str, str] | None = None) -> dict:
    """Goal -> underlying outcome -> the registered capabilities that address it. No model, no credits."""
    reg = registry() if reg is None else reg
    original = (text or "").strip()[:500]
    if key:
        goal = _BY_KEY.get(key)
        return _resolution(goal, original or goal["label"], reg, 1.0, f"suggestion:{key}") if goal else _no_match(original or key, "unknown_suggestion")
    if not original:
        return _no_match("", "empty")
    outcomes = [k for k, pattern in _OUTCOMES if pattern.search(original) and _valid_path(_BY_KEY[k], reg)]
    # A document or task named outright is a direct task, unless the sentence is really about an outcome.
    named = intent.rule_capability(original, list(reg))
    if named and named in reg and not (set(outcomes) & {"need_funding", "more_customers", "cash_flow", "grow", "price_offer", "launch"}):
        if named in _GOAL_OF_CAPABILITY:
            return _resolution(_BY_KEY[_GOAL_OF_CAPABILITY[named]], original, reg, 0.9, f"task_rule:{named}", direct=named)
        # A registered task with no homepage goal of its own (record a payment, add a customer…).
        return {"original_goal": original, "goal_key": None, "underlying_outcome": reg[named], "resolution_class": DIRECT,
                "candidate_capabilities": [{"capability": named, "label": reg[named]}], "start_capability": named, "confidence": 0.9, "execution_boundary": "",
                "message": f"I can do that ({reg[named][0].lower() + reg[named][1:]}). I'll ask for anything I need once your work can be saved.",
                "recommended_path": [reg[named]], "credit_implication": _credit_text(named), "credit_badge": _credit_badge(named),
                "provenance": {"registry": _PROVENANCE, "version": REGISTRY_VERSION, "rule": f"task_rule:{named}"}}
    specific = [k for k in outcomes if k != "grow"] or outcomes      # "grow" is the broadest: anything more specific wins
    if len(specific) == 1:
        return _resolution(_BY_KEY[specific[0]], original, reg, 0.8, f"outcome_rule:{specific[0]}")
    if len(specific) > 1:
        # Two materially different routes are plausible: one concise question before choosing.
        asked = _clarify(original, specific, reg, "ambiguous")
        if asked:
            return asked
    # About the business, but too loose to pick a route: ask once. Only what has nothing to do with it is refused.
    for pattern, keys in _VAGUE:
        if pattern.search(original):
            asked = _clarify(original, keys, reg, "vague")
            if asked:
                return asked
    return _no_match(original)


# ── TaskSession ──────────────────────────────────────────────────────────────

class SessionStore:
    """Where sessions live. Memory by default (tests, and a database without migration 037)."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.events: list[dict] = []

    async def put(self, row: dict) -> None:
        self.rows[row["id"]] = row

    async def get(self, session_id: str) -> dict | None:
        return self.rows.get(session_id)

    async def record(self, event: dict) -> None:
        """An analytics event. Kept here in memory (bounded); the database store writes a row."""
        self.events.append(event)
        del self.events[:-2000]


def _table_missing(e: Exception) -> bool:
    text = f"{getattr(e, 'code', '')} {e}"
    return "task_sessions" in text or "PGRST205" in text or "42P01" in text


class SupabaseSessionStore(SessionStore):
    """Table task_sessions (migration 037). Falls back to memory if the table is not there yet."""

    def __init__(self) -> None:
        super().__init__()
        self._missing = False
        self._no_events = False

    async def record(self, event: dict) -> None:
        await super().record(event)
        if self._no_events:
            return
        try:
            from app.core.supabase import sb_insert
            await sb_insert("goal_events", {"name": event["name"], "session_id": event.get("session_id"), "entry_mode": event.get("entry_mode"),
                                            "goal_key": event.get("goal_key"), "capability": event.get("capability"),
                                            "resolution_class": event.get("resolution_class"), "signed_in": bool(event.get("signed_in")), "created_at": event["at"]})
        except Exception as e:      # noqa: BLE001 - analytics never gets in the way of the task
            if "goal_events" in str(e) or "PGRST205" in str(e) or "42P01" in str(e):
                logger.warning("goal_events table missing: run migration 038. Events are logged only until then.")
                self._no_events = True
            else:
                logger.debug("goal event not stored", exc_info=True)

    async def put(self, row: dict) -> None:
        if not self._missing:
            try:
                from app.core.supabase import sb_upsert
                await sb_upsert("task_sessions", payload={"id": row["id"], "state": row["state"], "user_id": row.get("user_id"), "business_id": row.get("business_id"),
                                                          "data": row, "created_at": row["created_at"], "updated_at": row["updated_at"], "expires_at": row["expires_at"]},
                                on_conflict="id")
                return
            except Exception as e:      # noqa: BLE001
                if not _table_missing(e):
                    raise
                logger.warning("task_sessions table missing: run migration 037. Sessions are kept in memory until then.")
                self._missing = True
        await super().put(row)

    async def get(self, session_id: str) -> dict | None:
        if not self._missing:
            try:
                from app.core.supabase import sb_select
                row = await sb_select("task_sessions", filters=[("id", "eq", session_id)], columns="data", single=True)
                if row:
                    return row.get("data")
            except Exception as e:      # noqa: BLE001
                if not _table_missing(e):
                    raise
                self._missing = True
        return await super().get(session_id)


def _now(clock=None) -> datetime:
    return clock() if clock else datetime.now(timezone.utc)


def _event(session: dict, kind: str, when: datetime, **facts: Any) -> None:
    """A funnel event: the step reached and which goal, never what the visitor typed."""
    session.setdefault("events", []).append({"type": kind, "at": when.isoformat(), **{k: v for k, v in facts.items() if v is not None}})
    logger.info("goal onboarding event %s session=%s entry_mode=%s goal=%s", kind, session["id"][:8], session.get("entry_mode"), session.get("goal_key"))


# The MVP funnel (PRD s20). The first three are reported by the page; the rest happen here.
CLIENT_EVENTS = ("homepage_goal_prompt_viewed", "entry_mode_selected", "verification_started", "dashboard_handoff_completed",
                 "demo_opened", "demo_completed", "demo_try_it_clicked")
SERVER_EVENTS = ("goal_or_task_submitted", "goal_outcome_resolved", "capability_match_classified", "email_verified", "task_or_goal_path_resumed", "first_output_prepared")


async def track(store: SessionStore, name: str, session: dict | None = None, *, clock=None, **facts: Any) -> None:
    """One funnel event: its name, the goal or task key, entry mode and capability. Never the
    visitor's words, answers, email or business details."""
    session = session or {}
    event = {"name": name, "at": _now(clock).isoformat(), "session_id": (session.get("id") or "")[:12] or None, "entry_mode": session.get("entry_mode"),
             "goal_key": session.get("goal_key"), "capability": (session.get("resolution") or {}).get("start_capability"),
             "resolution_class": (session.get("resolution") or {}).get("resolution_class"), "signed_in": bool(session.get("user_id")),
             **{k: v for k, v in facts.items() if k in ("entry_mode", "goal_key") and v}}
    logger.info("goal analytics %s goal=%s entry_mode=%s capability=%s", name, event["goal_key"], event["entry_mode"], event["capability"])
    try:
        await store.record(event)
    except Exception:      # noqa: BLE001
        logger.debug("goal event not recorded", exc_info=True)


def _questions(session: dict) -> list[dict]:
    if session["resolution"]["resolution_class"] in (NO_MATCH, "clarify"):
        return []
    return list((_BY_KEY.get(session.get("goal_key") or "") or {}).get("questions") or [])


def _missing(session: dict) -> list[str]:
    """Required answers not given yet. A value read from the visitor's sentence counts as given; they confirm it with the rest."""
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    return [f["key"] for f in _questions(session) if f.get("required") and answers.get(f["key"]) in (None, "")]


def _shown(field: dict, value: Any) -> str:
    if field.get("type") == "choice":
        return next((o["label"] for o in field.get("options") or [] if o["value"] == value), str(value))
    if field.get("type") == "number" and isinstance(value, (int, float)):
        return f"{field.get('prefix', '')}{value:,.2f}".replace(".00", "")
    return str(value)


SIGNS = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦"}
DEFAULT_CURRENCY = "GBP"


def _in_currency(session: dict, fields: list[dict]) -> list[dict]:
    """Amount fields carry the sign of the currency the visitor wrote ("$300" shows $, not £)."""
    sign = SIGNS.get(session.get("currency") or DEFAULT_CURRENCY, "£")
    return [{**f, "prefix": sign} if f.get("prefix") else f for f in fields]


def _summary(session: dict) -> list[dict]:
    """What has been given so far, one short line each, for the visitor to see and confirm."""
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    rows = [{"key": f["key"], "label": f["label"], "value": _shown(f, answers[f["key"]]), "proposed": f["key"] not in (session.get("inputs") or {})}
            for f in _in_currency(session, _questions(session)) if answers.get(f["key"]) not in (None, "")]
    if session.get("currency") and session["currency"] != DEFAULT_CURRENCY and any(f.get("prefix") for f in _questions(session)):
        rows.append({"key": "currency", "label": "Currency", "value": session["currency"], "proposed": not session.get("currency_confirmed")})
    return rows


# What the last step is called while it runs: the work being done, not the visitor's words.
_PREPARING = {"funding_readiness": "Checking your funding readiness", "launch_readiness": "Checking your launch readiness", "new_invoice": "Preparing your invoice",
              "quote_to_cash": "Preparing your invoice", "enquiry_to_quote": "Preparing your quotation", "new_proposal": "Preparing your proposal",
              "business_plan_draft": "Drafting your business plan", "idea_validation": "Scoring your idea", "price_test": "Modelling your price",
              "scenario_help": "Working out your cash position", "risk_concentration": "Looking for risks in your records", "expansion_scenario": "Modelling your growth",
              "offer_review": "Reviewing what you sell"}


def public(session: dict) -> dict:
    """What the browser is given. The visitor's own answers come back to them; nothing else is in a session."""
    res, answers, missing = session["resolution"], session.get("inputs") or {}, _missing(session)
    proposed = {k: v for k, v in (session.get("proposed") or {}).items() if k not in answers}
    goal = _BY_KEY.get(session.get("goal_key") or "") or {}
    return {
        "id": session["id"], "state": session["state"], "entry_mode": session.get("entry_mode"), "goal_key": session.get("goal_key"),
        "goal_label": goal.get("label") or res.get("underlying_outcome") or res.get("original_goal"),
        "resolution": {**res, "credit_badge": _display_credit_badge(session)},
        "questions": [{**f, "default": answers.get(f["key"], proposed.get(f["key"], f.get("default", ""))), "proposed": f["key"] in proposed}
                      for f in _in_currency(session, _questions(session))],
        # A currency other than the default was written: kept, said ("In USD"), and theirs to switch.
        "currency": session.get("currency") or DEFAULT_CURRENCY,
        "currency_note": f"In {session['currency']}" if session.get("currency") and session["currency"] != DEFAULT_CURRENCY else "",
        "currency_options": [session["currency"], DEFAULT_CURRENCY] if session.get("said_currency") and session["said_currency"] != DEFAULT_CURRENCY else [],
        "verification": ({"sent": True, "masked": mask_email(session["email"]), "expires_at": session["verify"]["expires_at"],
                          "google": session["email"].rsplit("@", 1)[-1] in ("gmail.com", "googlemail.com")}
                         if session.get("verify") and session.get("email") and not session.get("user_id") else None),
        "saving": saving_text(session) if res["resolution_class"] not in (NO_MATCH, "clarify") else "",
        # Their own first name, when they have said it ("I'm Munah"): the page greets them with it and doesn't ask again.
        "first_name": (session.get("visitor") or {}).get("first_name") or None,
        "choose": session.get("choose"), "preparing_label": _PREPARING.get(res.get("start_capability") or "", "Preparing your task"),
        "clarify": res.get("clarify"), "inputs": answers, "proposed": proposed, "summary": _summary(session), "missing": missing,
        "authenticated": bool(session.get("user_id")), "business_id": session.get("business_id"),
        "handoff": session.get("handoff"), "problem": session.get("problem"), "expires_at": session["expires_at"], "retention_days": SESSION_DAYS,
        "next": ("none" if res["resolution_class"] == NO_MATCH else "clarify" if res["resolution_class"] == "clarify"
                 else "questions" if (missing or proposed) else "identity" if not session.get("user_id") else "handoff" if session.get("handoff")
                 else "choose" if session.get("choose") else "prepare"),
    }


async def start(store: SessionStore, *, text: str | None, key: str | None, entry_mode: str, clock=None) -> dict:
    now = _now(clock)
    from app.shared import people
    visitor, text = people.own_name(text) if text else (None, text)
    res = resolve(text=text, key=key)
    session = {"id": secrets.token_urlsafe(24), **({"visitor": visitor, "name": visitor["full_name"]} if visitor else {}), "state": INITIATED, "entry_mode": entry_mode if entry_mode in ("business_goal", "quick_task", "free_text") else "free_text",
               "goal_key": res.get("goal_key"), "original_goal": res["original_goal"], "resolution": res, "inputs": {},
               "proposed": extract(text or "", res.get("goal_key")) if not key else {}, "user_id": None, "business_id": None,
               "currency": None, "said_currency": None,
               "handoff": None, "events": [], "created_at": now.isoformat(), "updated_at": now.isoformat(),
               "expires_at": (now + timedelta(days=SESSION_DAYS)).isoformat()}
    _take_currency(session)
    _event(session, "HomepageGoalSubmitted", now)
    _event(session, "GoalOutcomeResolved", now, resolution_class=res["resolution_class"])
    if res["resolution_class"] == NO_MATCH:
        session["state"] = BLOCKED
        _event(session, "NoCapabilityMatch", now)
    elif res["resolution_class"] == "clarify":
        session["state"] = COLLECTING
        _event(session, "TaskClarificationRequested", now)
    else:
        session["state"] = COLLECTING if (_missing(session) or session["proposed"]) else AWAITING_IDENTITY
        _event(session, "CompositeGoalPathPresented" if res["resolution_class"] in (COMPOSITE, PARTIAL) else "TaskIntentResolved", now)
    await store.put(session)
    await track(store, "goal_or_task_submitted", session, clock=clock)
    await track(store, "goal_outcome_resolved", session, clock=clock)
    await track(store, "capability_match_classified", session, clock=clock)
    return session


# ── saving a task: the email is verified with a code, in place ───────────────
CODE_MINUTES, CODE_ATTEMPTS, CODE_RESEND_SECONDS = 10, 5, 45
_ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def mask_email(email: str) -> str:
    """h•••@gmail.com: enough to recognise it, not enough to read it over a shoulder."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}•••@{domain}"


def _code_hash(session_id: str, code: str) -> str:
    return hashlib.sha256(f"{session_id}:{code}".encode()).hexdigest()


def saving_text(session: dict) -> str:
    """What is being saved, in a line: "Create Invoice for Mark · $300 · USD"."""
    label = (_BY_KEY.get(session.get("goal_key") or "") or {}).get("label") or session.get("original_goal") or "your task"
    rows = {r["key"]: r["value"] for r in _summary(session)}
    who = f" for {rows['customer']}" if rows.get("customer") else ""
    rest = [v for k, v in rows.items() if k in ("amount", "currency")]
    return label + who + (" · " + " · ".join(rest) if rest else "")


async def send_code(store: SessionStore, session: dict, email: str | None, mailer, clock=None, name: str | None = None,
                    marketing_consent: bool | None = None, consent_source: str = "homepage_agent") -> dict:
    """Send a 6-digit code to the address (a new one each time). The address stays on the session,
    on the server; it is never put in a link. Nothing here looks up whether an account exists, so the
    answer and its timing are the same for every address."""
    now = _now(clock)
    email = (email or session.get("email") or "").strip().lower()
    if not _ADDRESS.match(email) or len(email) > 254:
        raise ValueError("Enter a valid email address.")
    if str(name or "").strip():
        from app.shared import people
        given = people.clean_name(name)
        if not given:
            raise ValueError("Enter your name using letters only (spaces, hyphens and apostrophes are fine).")
        session["visitor"], session["name"] = given, given["full_name"]      # theirs to give; it goes on the account once the code is right
    if marketing_consent is not None:
        from app.shared import people
        # The choice as made now, with when, where and which wording: it goes on the account with the name.
        session["consent"] = {"marketing_consent": bool(marketing_consent), "consent_at": now.isoformat(), "consent_source": consent_source,
                              "consent_version": people.CONSENT_VERSION}
    last = (session.get("verify") or {}).get("sent_at")
    if last and session.get("email") == email and (now - datetime.fromisoformat(last)).total_seconds() < CODE_RESEND_SECONDS:
        return session      # asked again too soon: the code already sent still stands
    code = f"{secrets.randbelow(1_000_000):06d}"
    session["email"] = email
    session["verify"] = {"hash": _code_hash(session["id"], code), "sent_at": now.isoformat(), "expires_at": (now + timedelta(minutes=CODE_MINUTES)).isoformat(), "attempts": 0}
    session["updated_at"] = now.isoformat()
    await store.put(session)
    await track(store, "verification_started", session, clock=clock)
    try:
        await mailer(email, code, saving_text(session))
    except Exception:      # noqa: BLE001 - said as "sent": whether an address can be mailed is not for a stranger to learn; Resend is there
        logger.warning("goal onboarding: the code email could not be sent for session %s", session["id"][:8], exc_info=True)
    return session


async def check_code(store: SessionStore, session: dict, code: str, clock=None) -> str:
    """The verified email address, or raise ValueError with what to tell the visitor. The task is kept whatever happens."""
    now = _now(clock)
    v = session.get("verify") or {}
    if not v or not session.get("email"):
        raise ValueError("Enter your email address first.")
    if now.isoformat() > v["expires_at"]:
        raise ValueError("That code has expired. Send a new one.")
    if int(v.get("attempts") or 0) >= CODE_ATTEMPTS:
        raise ValueError("Too many tries with that code. Send a new one.")
    if not secrets.compare_digest(_code_hash(session["id"], re.sub(r"\D", "", str(code or ""))), v["hash"]):
        v["attempts"] = int(v.get("attempts") or 0) + 1
        await store.put(session)
        raise ValueError("That code isn't right. Check the email and try again.")
    session.pop("verify", None)      # a code works once
    session["email_verified"] = True
    session["updated_at"] = now.isoformat()
    await store.put(session)
    return session["email"]


def _take_currency(session: dict) -> None:
    """The currency read from the sentence is not one of the questions: it is kept on the session."""
    said = (session.get("proposed") or {}).pop("currency", None)
    if said in SIGNS:
        session["currency"] = session["said_currency"] = said


async def load(store: SessionStore, session_id: str, clock=None) -> dict | None:
    session = await store.get(str(session_id))
    if not session:
        return None
    if session["expires_at"] < _now(clock).isoformat() and session["state"] not in (HANDED_OFF, AWAITING_REVIEW):
        session["state"] = ABANDONED
    return session


async def add_inputs(store: SessionStore, session: dict, answers: dict, clock=None, confirm: bool = False) -> dict:
    """Answers given in the form. A clarifying answer picks the goal; the rest are kept for the task. Still nothing canonical is written."""
    now = _now(clock)
    answers = dict(answers or {})
    if confirm and session.get("proposed") and session["resolution"]["resolution_class"] != "clarify":
        session["inputs"] = {**session["proposed"], **(session.get("inputs") or {})}
        session["proposed"] = {}
    if session["resolution"]["resolution_class"] == "clarify" and answers.get("goal_key") in _BY_KEY:
        res = resolve(key=answers.pop("goal_key"))
        res["original_goal"] = session["original_goal"]
        session.update({"resolution": res, "goal_key": res.get("goal_key"), "proposed": extract(session["original_goal"], res.get("goal_key"))})
        _take_currency(session)
        _event(session, "FallbackPathAccepted", now, resolution_class=res["resolution_class"])
        await track(store, "capability_match_classified", session, clock=clock)
    elif session["resolution"]["resolution_class"] == "clarify" and answers.get("goal_key") == OTHER:
        # None of the routes offered: said plainly, with the way to ask again. No account is asked for.
        session.update({"resolution": {**_no_match(session["original_goal"], "clarify_other"),
                                       "message": "No problem. Tell me in a few words what you want done, or pick one of the suggestions."}, "state": BLOCKED})
        session["updated_at"] = now.isoformat()
        await store.put(session)
        return session
    elif answers and session.get("proposed"):
        # Sending the form confirms what was read from the visitor's sentence (they saw it, and could change it).
        session["inputs"] = {**session["proposed"], **(session.get("inputs") or {})}
        session["proposed"] = {}
    if answers.get("currency") in SIGNS and session.get("said_currency"):      # switched in the form: the figure stays, the currency is theirs to say
        session["currency"], session["currency_confirmed"] = answers["currency"], True
    answers.pop("currency", None)
    picked = answers.pop("subject_choice", None)
    if picked and session.get("choose") and picked in [o["value"] for o in session["choose"]["options"]]:
        session["subject_choice"] = picked
        session.pop("choose", None)
        session["state"] = READY
    allowed = {f["key"]: f for f in _questions(session)}
    for k, v in answers.items():
        if k in allowed and v not in (None, ""):
            try:
                session["inputs"][k] = float(v) if allowed[k]["type"] == "number" else str(v).strip()[:2000]
            except (TypeError, ValueError):
                continue
    if session["inputs"]:
        _event(session, "TaskInputConfirmed", now, fields=len(session["inputs"]))
    if session["state"] not in (HANDED_OFF, AWAITING_REVIEW, PREPARING) and not picked:
        waiting = bool(_missing(session)) or bool(session.get("proposed")) or session["resolution"]["resolution_class"] == "clarify"
        session["state"] = COLLECTING if waiting else (AWAITING_IDENTITY if not session.get("user_id") else READY)
        if session["state"] == AWAITING_IDENTITY:
            _event(session, "AuthenticationRequired", now)
    session["updated_at"] = now.isoformat()
    await store.put(session)
    return session


def _amount_text(value: Any, currency: str | None = None) -> str:
    sign = SIGNS.get(currency or DEFAULT_CURRENCY, "£")
    return f" for {sign}{float(value):,.2f}".replace(".00", "") if isinstance(value, (int, float)) and value > 0 else ""


def _request_text(session: dict) -> str:
    """The session as the one sentence the Agent is asked, built from the visitor's own answers."""
    a, goal = session.get("inputs") or {}, session.get("goal_key")
    if goal == "create_invoice":
        return f"Create an invoice for {a.get('customer', '')}: {a.get('item', '')}{_amount_text(a.get('amount'), session.get('currency'))}".strip()
    if goal == "create_quotation":
        return f"Prepare a quotation for {a.get('customer', '')}: {a.get('item', '')}{_amount_text(a.get('amount'), session.get('currency'))}".strip()
    if goal == "prepare_proposal":
        return f"Write a proposal for {a.get('customer', '')}{_amount_text(a.get('amount'), session.get('currency'))}".strip()
    return session.get("original_goal") or ""


def _prefill(session: dict) -> dict:
    """What was said before sign-up, handed to the task so it is filled in, not asked for again."""
    a = session.get("inputs") or {}
    out: dict[str, Any] = {}
    if a.get("customer"):
        out["customer_name"] = str(a["customer"])
    if a.get("item"):
        out["item"] = {"name": str(a["item"]), "quantity": 1, "unit_price": a.get("amount") if isinstance(a.get("amount"), (int, float)) else ""}
    if a.get("solution"):
        out["solution"] = str(a["solution"])
    if isinstance(a.get("amount"), (int, float)):
        out["amount"] = a["amount"]
    if session.get("currency") and session["currency"] != DEFAULT_CURRENCY:
        out["currency"] = session["currency"]
    return out


async def attach(store: SessionStore, session: dict, user_id: str, clock=None) -> dict:
    """Bind the verified user. A session already bound to someone else is never handed over."""
    now = _now(clock)
    if session.get("user_id") and session["user_id"] != user_id:
        raise PermissionError("This task belongs to another account.")
    first = not session.get("user_id")
    if first:
        session["user_id"] = user_id
        _event(session, "TaskSessionAttachedToUser", now)
    if session["state"] in (AWAITING_IDENTITY, INITIATED):
        session["state"] = RESUMING
    session["updated_at"] = now.isoformat()
    await store.put(session)
    if first:
        await track(store, "email_verified", session, clock=clock)      # only a verified account can reach here
    return session


async def resume(store: SessionStore, session: dict, orch, user_id: str, *, business_name: str | None = None, business_id: str | None = None, clock=None) -> dict:
    """Connect the session to the user's business: the one they already have, else a new one
    (only ever after sign-in). The workspace is marked as set up through a goal, so the
    setup questionnaire is not put in front of the task."""
    now = _now(clock)
    if session.get("user_id") != user_id:
        raise PermissionError("This task belongs to another account.")
    name = (business_name or "").strip()[:120]
    if not session.get("business_id"):
        owned = await orch.rt.business.owned_by(user_id)
        if owned:
            # The workspace they picked, if it is theirs; otherwise the one they used last.
            session["business_id"] = next((b["id"] for b in owned if business_id and str(b["id"]) == str(business_id)), owned[0]["id"])
            _event(session, "CanonicalRecordLinkedOrCreated", now, record="business", how="existing")
        else:
            data: dict[str, Any] = {"onboarding": {"via": "goal_first", "goal": session.get("goal_key"), "at": now.isoformat()}}
            if name:
                data["workspace_profile"] = {"company_name": name}
            session["business_id"] = await orch.rt.business.create(user_id, name or "My workspace", data)
            session["new_workspace"] = True
            _event(session, "CanonicalRecordLinkedOrCreated", now, record="business", how="created")

    def _mark(d: dict) -> None:
        d.setdefault("onboarding", {"via": "goal_first", "goal": session.get("goal_key"), "at": now.isoformat()})
        if name and not (d.get("workspace_profile") or {}).get("company_name"):
            d.setdefault("workspace_profile", {})["company_name"] = name
    await orch.rt.business.mutate(session["business_id"], _mark)
    session["state"] = READY if not _missing(session) else COLLECTING_REQUIRED
    if session["state"] == READY:
        _event(session, "TaskReadyToPrepare", now)
    session["updated_at"] = now.isoformat()
    await store.put(session)
    await track(store, "task_or_goal_path_resumed", session, clock=clock)
    return session


NEW = "new"


async def _open_subjects(svc, business_id: str, kind: str) -> list[dict]:
    """The workspace's funding cases (or launch plans) that are still in use, newest first. One read."""
    rows = await svc.store.list("subjects", business_id, kind=kind, limit=50)
    return [r for r in rows if r.get("status") not in ("archived", "cancelled", "launched", "closed")][:3]


def _case_title(a: dict) -> str:
    """A new funding case is named from the answers: "£50,000 for hiring"."""
    amount = _shown({"type": "number", "prefix": "£"}, a["amount"]) if isinstance(a.get("amount"), (int, float)) else ""
    use = _own_words(a["use"]) if a.get("use") else ""
    use = use if len(use) <= 60 else use[:57].rsplit(" ", 1)[0] + "…"
    return (f"{amount} for {use}" if amount and use else amount or (use[:1].upper() + use[1:] if use else "Funding case"))[:120]


def _told(a: dict) -> str:
    """What was said, with the visitor's own words quoted as they wrote them, never bent into a sentence."""
    amount = _shown({"type": "number", "prefix": "£"}, a["amount"]) if isinstance(a.get("amount"), (int, float)) else ""
    use = f'"{str(a["use"]).strip().rstrip(".")}"' if a.get("use") else ""
    return f"{amount} to fund: {use}" if amount and use else amount or (f"to fund: {use}" if use else "")


def _choice_field(existing: list[dict], noun: str, a: dict) -> dict:
    """Update the one that is there, or start another: one question, with what would change said on the option."""
    options = []
    for row in existing:
        data = row.get("data") or {}
        name = data.get("title") or data.get("name") or noun.capitalize()
        had, now_ = data.get("target_amount"), a.get("amount")
        change = (f" (amount {_shown({'type': 'number', 'prefix': '£'}, float(had))} → {_shown({'type': 'number', 'prefix': '£'}, now_)})"
                  if isinstance(now_, (int, float)) and isinstance(had, (int, float)) and float(had) != float(now_) else "")
        options.append({"value": row["id"], "label": f"Update {name}{change}"})
    options.append({"value": NEW, "label": f"Start a new {noun.split()[-1]}" if noun.endswith("case") else "Start a new launch plan"})
    several = len(existing) > 1
    return _f("subject_choice", f"You already have {'funding cases' if noun.endswith('case') and several else 'launch plans' if several else 'a ' + noun}. "
                                f"Update {'one' if several else 'it'} or start a new one?", "choice", required=True, options=options)


def _own_words(value: Any) -> str:
    """The visitor's words set inside a sentence: a capital that only began their answer is dropped."""
    text = str(value).strip().rstrip(".")
    first = text.split(" ", 1)[0]
    return text[:1].lower() + text[1:] if first[:1].isupper() and first[1:].islower() else text


def _where_you_stand(summary: dict) -> str:
    """The check's result in a sentence, from the readiness engine's own words and numbers."""
    said = str(summary.get("headline") or "").strip()
    gaps = summary.get("open_actions") or 0
    tail = f" {gaps} thing{'s' if gaps != 1 else ''} to do next." if gaps else ""
    return (said.rstrip(".") + "." if said else "Here's where you stand.") + tail


async def prepare(store: SessionStore, session: dict, orch, user_id: str, email: str | None = None, clock=None) -> dict:
    """Start the work with what already does it: the Agent's own request, or the Funding or
    Launch Readiness module. Their permissions, credits and approvals apply unchanged."""
    from app.modules.agent.models import AgentRequest
    now = _now(clock)
    if session.get("user_id") != user_id or not session.get("business_id"):
        raise PermissionError("Sign in and resume this task first.")
    if session.get("handoff") and (session["handoff"].get("run_id") or session["handoff"].get("subject_id")):
        return session      # already prepared: the same task, never a second one
    session["handoff"] = None      # it could not be started last time (a plan limit, no credits): tried again now, not refused for ever
    res, a = session["resolution"], session.get("inputs") or {}
    capability = res.get("start_capability")
    if not capability or capability not in registry():
        session.update({"state": BLOCKED, "problem": "That is no longer available."})
        await store.put(session)
        return session
    session["state"] = PREPARING
    handoff: dict[str, Any] = {"to": "/dashboard", "capability": capability}
    try:
        if capability in _MODULES:
            from app.core.supabase import read_cache
            from app.modules.readiness import rules
            from app.modules.readiness.service import service_for
            svc = service_for(orch)
            kind = rules.FUNDING if capability == "funding_readiness" else rules.LAUNCH
            noun = "funding case" if kind == rules.FUNDING else "launch plan"
            # One funding case (or launch plan) is kept current, not a new one made every time: if the
            # workspace already has one, the owner says whether to update it or start another.
            choice = session.get("subject_choice")
            if not choice:
                existing = await _open_subjects(svc, session["business_id"], kind)
                if existing:
                    session["choose"] = _choice_field(existing, noun, a if kind == rules.FUNDING else {})
                    session["state"] = COLLECTING_REQUIRED
                    session["updated_at"] = now.isoformat()
                    await store.put(session)
                    return session
                choice = NEW
            clocked = time.perf_counter()
            with read_cache():      # the module reads the same business several times over: once is enough
                if kind == rules.FUNDING:
                    # The currency is the one they wrote, else the business's own: known, so never left for them to enter again.
                    money = session.get("currency") or bz.currency_of(await orch.rt.business.load(session["business_id"]) or {})
                    payload = {k: v for k, v in {"target_amount": a.get("amount"), "purpose": a.get("use"),
                                                 "currency": money if a.get("amount") and money in rules.SUPPORTED_CURRENCIES else None,
                                                 "stage": a.get("stage") if a.get("stage") in ("pre_revenue", "trading") else None, "pinned": True}.items() if v not in (None, "")}
                    title, told = _case_title(a), _told(a)
                else:
                    payload = {k: v for k, v in {"audience": a.get("customer"), "target_date": a.get("target_date"), "pinned": True}.items() if v not in (None, "")}
                    title, told = str(a.get("sell") or "My launch")[:120], f'"{str(a.get("sell")).strip()}"' if a.get("sell") else ""
                name_field = "title" if kind == rules.FUNDING else "name"
                if choice == NEW:
                    made = await svc.create_subject(user_id, session["business_id"], kind, {**payload, name_field: title}, email)
                    did = f"I set up your {noun} from what you told me"
                else:
                    row = await svc.store.get("subjects", choice)
                    if not row or row.get("business_id") != session["business_id"] or row.get("kind") != kind:
                        raise PermissionError("That is not one of this workspace's records.")
                    made = await svc.update_subject(user_id, session["business_id"], kind, choice, row["revision"], payload, email)
                    did = f'I updated "{(row.get("data") or {}).get(name_field) or noun}" with what you told me'
                created_s = time.perf_counter() - clocked
                handoff.update({"to": f"/{'funding' if kind == rules.FUNDING else 'launch'}/{made['id']}", "subject_id": made["id"], "updated_existing": choice != NEW,
                                "message": f"{did}{': ' + told if told else ''}. Run the check to see where you stand."})
                # First value is the result, not an empty case: the readiness check is run now. It is
                # worked out by fixed rules from what is on record, so it uses no AI Credits.
                try:
                    checked = await svc.request_assessment(user_id, session["business_id"], kind, made["id"], idempotency_key=f"goal:{session['id']}"[:120], email=email)
                    result = checked.get("result") or {}
                    if checked.get("execution_status") == "succeeded":
                        actions = [x for x in await svc.store.list("actions", session["business_id"], subject_id=made["id"], limit=300)
                                   if x.get("status") in rules.UNRESOLVED_ACTION_STATES]
                        summary = {"headline": result.get("headline"), "open_actions": len(actions)}
                        handoff.update({"to": f"{handoff['to']}?tab=results", "assessment_id": checked["id"], "score": result.get("score_display"),
                                        "classification": result.get("classification"),
                                        "message": handoff["message"].rsplit(". ", 1)[0] + ". " + _where_you_stand(summary)})
                except Exception:      # noqa: BLE001 - the case is set up either way; the check can be run from its page
                    logger.warning("goal onboarding: the first readiness check did not run for session %s", session["id"][:8], exc_info=True)
            # Where the time goes, in the log, so a slow hand-off can be seen for what it is.
            logger.info("goal onboarding prepare %s session=%s: record %.2fs, check %.2fs, total %.2fs", capability, session["id"][:8],
                        created_s, time.perf_counter() - clocked - created_s, time.perf_counter() - clocked)
            session["state"] = HANDED_OFF
        else:
            # What the visitor said about the business is theirs to keep: it goes on the profile, only where that is still empty.
            facts = {"about_company": a.get("description") or a.get("sell"), "target_customer": a.get("customer") if session.get("goal_key") not in
                     ("create_invoice", "create_quotation", "prepare_proposal") else None, "problem": a.get("problem")}

            def _profile(d: dict) -> None:
                p = d.setdefault("workspace_profile", {})
                for k, v in facts.items():
                    if v and not p.get(k):
                        p[k] = str(v)
            if any(facts.values()):
                await orch.rt.business.mutate(session["business_id"], _profile)
            # The first essential task on a new account is free (PRD s13): the workspace made for this
            # goal is marked, once, and the Agent waives the charge for the one task started from it.
            if config.FIRST_TASK_FREE and session.get("new_workspace") and capability in config.FREE_FIRST_TASKS:
                def _free(d: dict) -> None:
                    d.setdefault("onboarding", {}).setdefault("free_first_task", {"reference": f"goal:{session['id']}", "capability": capability, "at": now.isoformat()})
                await orch.rt.business.mutate(session["business_id"], _free)
            out = await orch.submit(AgentRequest(requesting_actor_id=user_id, business_id=session["business_id"], source_channel="text",
                                                 raw_input=_request_text(session), requested_capability=capability, background=True,
                                                 params={"prefill": _prefill(session)} if _prefill(session) else {},
                                                 source_reference=f"goal:{session['id']}",
                                                 essential_handoff=True), email=email)
            run = out.get("run")
            if run:
                handoff.update({"to": f"/dashboard?task={run['id']}", "run_id": run["id"]})
                session["state"] = AWAITING_REVIEW
            else:
                # Not started (plan, credits, nothing to act on): said as it is, with the dashboard still to go to.
                handoff.update({"message": out.get("message") or "That couldn't be started just now.", "blocked": out.get("kind") == "blocked", "upgrade": bool(out.get("upgrade"))})
                session["state"] = BLOCKED if out.get("kind") == "blocked" else HANDED_OFF
    except Exception as e:      # noqa: BLE001 - the session and what was entered are kept; the visitor can try again
        logger.warning("goal onboarding prepare failed for session %s", session["id"][:8], exc_info=True)
        session.update({"state": READY, "problem": "That couldn't be prepared just now. Nothing was lost; try again."})
        _event(session, "TaskFailed", now, reason=type(e).__name__)
        session["updated_at"] = now.isoformat()
        await store.put(session)
        return session
    session["handoff"] = handoff
    session.pop("problem", None)
    _event(session, "TaskBlocked" if session["state"] == BLOCKED else "FirstOutputPrepared", now, capability=capability)
    session["updated_at"] = now.isoformat()
    await store.put(session)
    if session["state"] != BLOCKED:
        await track(store, "first_output_prepared", session, clock=clock)
    return session
