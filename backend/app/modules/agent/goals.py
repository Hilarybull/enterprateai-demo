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

import asyncio
import hashlib
import logging
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent import config, intent
from app.modules.agent.workflows import WORKFLOWS

logger = logging.getLogger(__name__)

from app.modules.agent import first_value      # noqa: E402

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
# Quick amounts in the chat's currency (the owner's brief, 20 Oct: ₦1m, ₦5m, ₦10m, ₦25m on a naira workspace), short labels.
AMOUNT_CHIPS = {"GBP": (10000, 25000, 50000, 100000, 250000), "NGN": (1_000_000, 5_000_000, 10_000_000, 25_000_000),
                "USD": (10000, 25000, 50000, 100000, 250000), "EUR": (10000, 25000, 50000, 100000, 250000),
                "GHS": (50000, 100000, 250000, 500000), "KES": (500000, 1_000_000, 2_500_000, 5_000_000)}


def _short_money(sign: str, v: float) -> str:
    """"₦5m", "£25k": a quick amount as people say it."""
    if v >= 1_000_000:
        return f"{sign}{v / 1_000_000:g}m"
    if v >= 1000:
        return f"{sign}{v / 1000:g}k"
    return f"{sign}{v:g}"


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
    {"key": "more_customers", "mode": "business_goal",      # on the landing shortcuts: its free check is built (the owner, 25 Oct)
     "label": "I need more customers", "outcome": "Work toward winning more customers",
     "class": COMPOSITE, "start": "offer_review", "path": ["offer_review", "marketplace_profile", "marketplace_offering", "new_proposal", "enquiry_to_quote"],
     "say": "I can help you work toward getting more customers: review what sells, improve how your business appears in the Marketplace, "
            "and prepare proposals and quotations for the enquiries you get.",
     "boundary": "I can't guarantee customers or bring them to you directly.",
     "questions": [_f("sell", "What do you sell?", "text", required=True), _f("customer", "Who is your ideal customer?", "text", required=True),
                   _f("channel", "Where do your customers come from today?", "text")]},
    {"key": "price_offer", "mode": "business_goal", "chip": False,      # off the landing shortcuts until ready (the owner, 22 Oct)
     "label": "Help me price my product/service", "outcome": "Model a price against cost, margin and break-even",
     "class": PARTIAL, "start": "price_test", "path": ["price_test", "add_catalogue_item", "scenario_help"],
     "say": "I can model a price for you: what it means for your margin, and how much volume you could lose before a higher price stops paying.",
     "boundary": "The price you charge stays your decision.",
     "questions": [_f("sell", "What are you pricing?", "text", required=True), _money("price", "What price do you have in mind?"),
                   _money("cost", "What does it cost you to deliver?")]},
    {"key": "launch", "mode": "business_goal",      # back on the landing shortcuts (the owner, 25 Oct)
     "label": "I want to launch a product/service", "outcome": "Check launch readiness and close the gaps",
     "class": PARTIAL, "start": "launch_readiness", "path": ["launch_readiness", "idea_validation", "launch_evidence_gaps", "scenario_help"],
     "say": "I can assess how ready the launch is, list what is missing and what to do next, and test the idea behind it.",
     # No boundary line in the launch chat's header (the owner, 23 Oct: "no need")
     "boundary": None,
     "questions": [_f("sell", "What are you launching?", "text", required=True), _f("customer", "Who is it for?", "text", required=True),
                   _f("target_date", "When do you want to launch?", "date")]},
    {"key": "cash_flow", "mode": "business_goal", "label": "Improve my cash flow", "chip": False, "outcome": "See what drives cash and act on it",
     "class": COMPOSITE, "start": "scenario_help", "path": ["payment_followup", "new_invoice", "record_expense", "scenario_help", "risk_concentration"],
     "say": "I can show what is driving your cash, chase unpaid invoices for you, get invoices out faster and model what a change would do.",
     "boundary": "",      # how it is worked out is never told in the chat (the owner, 26 Oct)
     "questions": [_f("owed", "Are customers paying you late?", "choice",
                      options=[{"value": "yes", "label": "Yes, often"}, {"value": "some", "label": "Sometimes"}, {"value": "no", "label": "No"}]),
                   _f("pressure", "What is the biggest pressure on cash right now?", "text")]},
    {"key": "grow", "mode": "business_goal", "label": "Help me grow my business", "chip": False, "outcome": "Find what limits growth and a path through it",
     "class": COMPOSITE, "start": "expansion_scenario", "path": ["expansion_scenario", "capacity_check", "offer_review", "scenario_help"],
     "say": "I can work out what growing would do to your revenue and costs, check whether you have the capacity for it, and review what sells.",
     "boundary": "I can't guarantee a growth result.",
     "questions": [_f("sell", "What do you sell?", "text", required=True), _f("limit", "What is holding growth back today?", "text")]},
    {"key": "test_idea", "mode": "business_goal",      # back on the landing shortcuts (the owner, 25 Oct)
     "label": "Test a business idea", "outcome": "Score a business idea and see its risks",
     "class": DIRECT, "start": "idea_validation", "path": ["idea_validation", "market_size", "business_plan_draft"],
     "say": "I can score your idea, show the risks and next steps, and size the market for it.",
     "boundary": "",      # never told in the chat (the owner, 26 Oct: "remove telling the user about engine")
     "questions": [_f("description", "What is the idea? (1 to 2 sentences)", "textarea", required=True), _f("customer", "Who is the customer?", "text", required=True),
                   _f("problem", "What problem does it solve for them?", "textarea", required=True)]},
    {"key": "business_risks", "mode": "business_goal",      # back on the landing shortcuts: its free check is built (the owner, 24 Oct)
     "label": "Help me understand my business risks", "outcome": "See the risks in the business and what to do about them",
     "class": COMPOSITE, "start": "risk_concentration", "path": ["risk_concentration", "scenario_help", "readiness_refresh"],
     "say": "I can show where the business is fragile: reliance on a few customers, late payment and cash, and what a shock would do.",
     "boundary": "",      # how it is worked out is never told in the chat (the owner, 26 Oct)
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
     # What it is about is asked; who buys it and the problem the Agent works out when left blank (the owner's QA, 23 Oct:
     # "agent should fill all these things, draft the business plan"), changeable in the plan's inputs afterwards
     "questions": [_f("description", "What does the business do? (1 to 2 sentences)", "textarea", required=True), _f("customer", "Who is the customer?", "text"),
                   _f("problem", "What problem does it solve for them?", "textarea")]},
    # Not a homepage shortcut (asked for in words, it still prepares a proposal).
    {"key": "prepare_proposal", "mode": "quick_task", "label": "Prepare Proposal", "outcome": "A proposal ready for your approval", "shortcut": False,
     "class": DIRECT, "start": "new_proposal", "path": ["new_proposal"], "say": "I'll prepare the proposal and have it ready for you to approve. Nothing is sent until you say so.", "boundary": "",
     "questions": [_f("customer", "Who is it for?", "text", required=True), _f("solution", "What are you proposing?", "textarea", required=True),
                   _money("amount", "At what price?")]},
]
_BY_KEY = {g["key"]: g for g in GOALS}

# The short conversation for each of the five covered goals: the questions of the First-Value PRD
# (7.2, 8.1, 9.1, 10.1, 11.2), in its order. `q` is the question's number (two fields can share
# one question). `unsure`: "Not sure" (or the wording given) is an answer; it is kept as unknown
# and never guessed. `value` is the one line that says what the visitor gets, in plain words.
UNSURE = "unknown"
_NOT_SURE = "Not sure"


def _choice(key: str, label: str, options: list[tuple[str, str]], **extra: Any) -> dict:
    return _f(key, label, "choice", options=[{"value": v, "label": text} for v, text in options], **extra)


_CONVERSATIONS: dict[str, dict[str, Any]] = {
    "need_funding": {"value": "A few quick questions, then you'll get a score out of 100 for how ready you are to ask for funding, and the first things to fix.", "questions": [
        _money("amount", "How much funding do you think you need?", required=True, chips=_FUNDING_AMOUNTS, unsure=_NOT_SURE, q=1, noun="amount"),
        _f("use", "What do you need the money for?", "textarea", required=True, q=2, noun="purpose",
           chips=[{"value": v, "label": v} for v in ("Equipment", "Stock", "Hiring staff", "Marketing", "Working capital")]),
        _choice("stage", "What stage is the business at?", [("idea", "Just an idea"), ("pre_revenue", "Not trading yet"), ("trading", "Trading"), ("growing", "Trading and growing")], required=True, q=3, noun="stage"),
        _choice("route", "What funding route are you considering?", [("equity", "Equity"), ("loan", "Loan"), ("grant", "Grant"), (UNSURE, _NOT_SURE)], required=True, q=4, noun="route"),
        _f("timing", "When do you need the funding?", "text", required=True, q=5, noun="timing", unsure=_NOT_SURE,
           chips=[{"value": v, "label": v} for v in ("Within 3 months", "In 3 to 6 months", "In 6 to 12 months")]),
        _f("traction", "What traction do you have so far? Customers, revenue, pilots, contracts or other evidence.", "textarea", required=True, q=6, noun="traction",
           unsure="No traction yet", unsure_value="No traction yet"),
        # Where the business trades: read from what they say ("a car wash in Abuja"), never asked on its own.
        _f("where", "Where does the business trade?", "text", hidden=True, noun="place"),
    ]},
    "test_idea": {"value": "A few quick questions, then you'll see whether the idea can make money, worked out from your own numbers.", "questions": [
        _f("description", "What is your product or service idea?", "textarea", required=True, q=1, noun="idea"),
        _f("customer", "Who is it for, and where?", "text", required=True, q=2, noun="customer"),
        # Where it will run: read from what they say ("a mobile car wash in Abuja"), never asked on its own.
        _f("where", "Where will it run?", "text", hidden=True, noun="place"),
        _money("price", "What price are you thinking of charging?", required=True, unsure=_NOT_SURE, q=3, noun="price"),
        _f("monthly_sales", "Roughly how many could you sell each month?", "number", required=True, unsure=_NOT_SURE, q=3, noun="monthly sales"),
        _money("cost", "Roughly what does one sale cost you?", required=True, unsure=_NOT_SURE, q=4, noun="cost per sale"),
        _money("fixed_costs", "Any new monthly fixed costs?", unsure=_NOT_SURE, q=4, noun="fixed costs"),
        _f("capacity", "How many could you realistically deliver each month?", "number", required=True, unsure=_NOT_SURE, q=5, noun="capacity"),
        _choice("demand", "What evidence of demand do you already have?", [("assumption", "None yet, it is my assumption"), ("research", "Research"), ("enquiries", "Enquiries"),
                ("lois", "Letters of intent"), ("pilot", "A paid pilot"), ("paying", "Paying customers"), ("repeat", "Repeat customers")], required=True, q=6, noun="demand evidence"),
    ]},
    # The free Business Risk Check (the owner, 24 Oct: "Help me understand my business risks... implement it")
    "business_risks": {"value": "I'll check your biggest customer, cash, late payments and how much the business depends on you. This uses your records; it isn't financial advice.", "questions": [
        _f("worry", "What worries you most about the business right now?", "textarea", unsure="Nothing in particular", q=1, noun="worry"),
        _choice("top_share", "How much of your income comes from your biggest customer?", [("under_20", "Less than a fifth"), ("20_50", "A fifth to a half"),
                ("over_50", "More than half")], required=True, unsure=_NOT_SURE, q=2, noun="biggest customer"),
        _choice("runway", "If sales stopped today, how long would your cash cover your costs?", [("under_3", "Less than 3 months"), ("3_6", "3 to 6 months"),
                ("over_6", "More than 6 months")], required=True, unsure=_NOT_SURE, q=3, noun="cash"),
        _choice("paid_on_time", "Do your customers pay on time?", [("on_time", "Almost always"), ("sometimes_late", "Sometimes late"), ("often_late", "Often late")],
                required=True, unsure=_NOT_SURE, q=4, noun="payments"),
        _choice("key_person", "If you were away for a month, what would happen to the business?", [("runs", "It would carry on"), ("slows", "It would slow down"),
                ("stops", "It would stop")], required=True, unsure=_NOT_SURE, q=5, noun="team"),
        _money("cash_in_bank", "What's in the bank today?", hidden=True, noun="cash in the bank"),
        _money("monthly_costs", "What do you spend in a usual month, all regular costs together?", hidden=True, noun="monthly costs"),
    ]},
    "launch": {"value": "A few quick questions, then you'll see how ready you are to launch and what to sort out first.", "questions": [
        _choice("kind", "What are you launching?", [("product", "A product"), ("service", "A service"), ("both", "Both")], required=True, q=1, noun="kind"),
        # What is launched, by name (the owner's QA, 23 Oct: required, and a placeholder is asked again)
        _f("sell", "What exactly are you launching?", "textarea", required=True, q=2, noun="description"),
        _choice("stage", "What stage is it at?", [("idea", "Idea"), ("prototype", "Prototype"), ("testing", "Testing"), ("ready", "Ready")], required=True, q=3, noun="stage"),
        _f("customer", "Who is it for?", "text", required=True, q=4, noun="customer"),
        # PRD 8.1 question 5 is one question: "Where and when do you want to launch?" The answer is split into the place
        # and the date ("Abuja, January 2027"); the date is its own field, never asked on its own.
        _f("where", "Where and when do you want to launch?", "text", required=True, unsure=_NOT_SURE, q=5, noun="launch market"),
        _f("target_date", "When do you want to launch?", "text", hidden=True, q=5, noun="launch date"),
        # Said in passing ("I'll charge 15000 naira a month and it costs me 6000"): kept for Offer and pricing, never asked here.
        _f("price", "Price", "number", hidden=True, noun="price"),
        _f("cost", "Cost per sale", "number", hidden=True, noun="cost"),
        _f("evidence", "What customer testing or demand evidence do you already have?", "textarea", required=True, q=6, noun="demand evidence", unsure="None yet", unsure_value="None yet"),
    ]},
    "price_offer": {"value": "A few quick questions, then you'll see how much each sale earns you and whether your price works.", "questions": [
        _f("sell", "What are you pricing?", "text", required=True, q=1, noun="what you are pricing"),
        _f("customer", "Who are you selling it to?", "text", required=True, unsure=_NOT_SURE, q=2, noun="customer"),
        _money("price", "What price are you considering or charging now?", required=True, unsure=_NOT_SURE, q=3, noun="price"),
        _money("cost", "About what does one sale cost you to deliver?", required=True, unsure=_NOT_SURE, q=4, noun="cost per sale"),
        _f("monthly_sales", "How many could you realistically sell each month?", "number", required=True, unsure=_NOT_SURE, q=5, noun="monthly sales"),
        _choice("positioning", "How do you want to position it?", [("affordable", "Affordable"), ("mid", "Mid-market"), ("premium", "Premium"), (UNSURE, _NOT_SURE)], required=True, q=6, noun="positioning"),
    ]},
    # Winning more customers (the owner's brief, 25 Oct): what the records hold is read, never asked; the rest as buttons
    "more_customers": {"value": "I'll look at who buys from you now, how new customers find you, and the first things to do. This uses your records; it doesn't promise customers.",
                       "questions": [
        _f("sell", "What do you sell?", "text", required=True, q=1, noun="what you sell"),
        _f("customer", "Who do you want more of? Your best kind of customer.", "text", required=True, unsure="I'm not sure", q=2, noun="customer"),
        _f("where", "Where do you want to find them?", "text", required=True, unsure=_NOT_SURE, q=3, noun="where"),
        # Several at once (the owner, 25 Oct: "can be multichoice"): stored as the values chosen, joined with commas
        _f("channel", "How do new customers find you today? Pick all that apply.", "choice", required=True, multi=True, q=4, noun="channel",
           options=[{"value": k, "label": v[:1].upper() + v[1:]} for k, v in first_value.CHANNELS.items()] + [{"value": "none", "label": "I don't have customers yet"}]),
        _f("price", "What do you usually charge?", "text", required=True, unsure=_NOT_SURE, q=5, noun="price"),
        _f("goal", "How many new customers do you want in the next three months?", "choice", required=True, unsure=_NOT_SURE, q=6, noun="goal",
           options=[{"value": k, "label": v[:1].upper() + v[1:]} for k, v in first_value.CUSTOMER_GOALS.items()]),
    ]},
}
# A document's short conversation: who it is for, their email (it can wait), what, how many, the price,
# VAT once (offered from the currency, and kept as the business's default), and the due date stated rather than asked.
_LATER = "I'll add it later"
_VAT_CHIPS = [{"value": v, "label": label} for v, label in ((0, "No VAT"), (5, "5%"), (7.5, "7.5%"), (20, "20%"))]
VAT_BY_CURRENCY = {"GBP": 20, "EUR": 20, "NGN": 7.5, "USD": 0}


def _document_questions(noun: str, what: str) -> list[dict]:
    return [
        _f("customer", "Who is it for?", "text", required=True, q=1, noun="customer"),
        _f("customer_email", "What is their email address?", "email", required=True, unsure=_LATER, unsure_value="", q=2, noun="email"),
        _f("item", what, "text", required=True, q=3, noun="what it is for"),
        _f("quantity", "How many?", "number", default=1, q=4, noun="quantity", chips=[{"value": n, "label": str(n)} for n in (1, 2, 5, 10)]),
        _money("amount", "What price for each?", required=True, q=4, noun="price"),
        _f("vat_rate", "Do you charge VAT on this?", "number", required=True, q=5, noun="VAT", chips=_VAT_CHIPS, suffix="%"),
        _f("due_days", f"Due in 14 days. Want a different date?" if noun == "invoice" else "Valid for 30 days. Want a different period?", "number",
           default=14 if noun == "invoice" else 30, q=6, noun="due date" if noun == "invoice" else "validity",
           chips=[{"value": n, "label": f"{n} days"} for n in ((7, 14, 30) if noun == "invoice" else (14, 30, 60))]),
    ]


def questions_for(goal_key: str) -> list[dict]:
    """The short conversation's questions for a goal (copies, safe to change)."""
    return [dict(q) for q in (_CONVERSATIONS.get(goal_key) or {}).get("questions") or []]


def value_of(goal_key: str) -> str:
    return str((_CONVERSATIONS.get(goal_key) or {}).get("value") or "")


_CONVERSATIONS["create_invoice"] = {"value": "I'll prepare the invoice for you to approve. Nothing is sent until you say so.", "questions": _document_questions("invoice", "What is it for?")}
_CONVERSATIONS["create_quotation"] = {"value": "I'll prepare the quotation for you to approve. Nothing is sent until you say so.", "questions": _document_questions("quotation", "What are you quoting for?")}
for _key, _talk in _CONVERSATIONS.items():
    _BY_KEY[_key]["questions"] = _talk["questions"]
    _BY_KEY[_key]["value"] = _talk["value"]

# Free text that states an outcome rather than a document: which goal it means.
_OUTCOMES: list[tuple[str, re.Pattern]] = [
    ("need_funding", re.compile(r"\b(funding|fund(s|ed)?|investors?|investment|raise (money|capital|funds)|loans?|grants?|finance my|borrow\w*"
                                r"|rais(e|ing) (about |around |up to )?(£|\d)|(need|want|looking for|after) (about |around |roughly )?(£\s?\d|\d[\d,]*\s?(k|m|thousand|million|pounds)\b))"
                                # "£25k for a second van and a driver, ... need it by March": an amount for something, needed by a date.
                                r"|^\s*[£$€₦]\s?\d[\d,.]*\s*(?:k|m|thousand|million)?\s+(?:for|to)\b|\bneed (?:it|the money|the cash|the funds?) (?:by|before|in)\b", re.I)),
    ("more_customers", re.compile(r"\b(more (customers|clients|sales|leads|work|business)|win (more )?(work|customers|clients|contracts)|get (customers|clients|leads)|find (customers|clients)|(?:need|want|looking for)\s+(?:new\s+|some\s+)?(customers|clients)|no (customers|clients))\b", re.I)),
    ("price_offer", re.compile(r"\b(pric(e|ing) (my|our|a|the)|how much (should|to) (i )?charge|what (should|to) (i )?charge|help me price)\b", re.I)),
    ("launch", re.compile(
        r"\blaunch\w*\b"
        r"|\b(?:start|starting|open|opening|set\s+up|setting\s+up|begin|beginning|kick\s+off|run|running)\s+(?:up\s+)?"
        r"(?:(?:a|an|my|our|the|own|new|small|little|lil|tiny|local|mobile|online|proper|side)\s+){0,3}(?:[\w'&-]+\s+){0,3}"
        r"(?:business|biz|company|shop|cafe|caf\u00e9|coffee\s+shop|bakery|salon|store|restaurant|studio|gym|agency|brand|service|services|"
        r"startup|start-up|venture|firm|clinic|bar|pub|takeaway|stall|van|trade|practice|hustle|thing)\b"
        r"|\b(?:thinking|thinkin|planning|looking)\s+(?:of|about|bout|to|on)\s+(?:starting|opening|setting\s+up|launching|start|open|set\s+up|launch)\b", re.I)),
    ("cash_flow", re.compile(r"\b(cash ?flow|cash position|running out of (cash|money)|paid (late|faster|on time)|late pay\w*)\b", re.I)),
    ("test_idea", re.compile(r"\b((business |startup |new )idea|test (an?|my) idea|validat\w+)\b", re.I)),
    ("business_risks", re.compile(r"\b(risks?|fragil\w*|what could go wrong|worried|worries|worry|vulnerab\w*)\b|\b(?:rely|relying|relies|depend\w*)\s+(?:on|upon)\b", re.I)),
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


_REVENUE_WORDS = re.compile(r"\b(revenue|turnover|sales|income|profit|takings|earn\w*|making|bring(?:ing)? in|a month|per month|monthly|/\s?m(?:onth|o)?\b|"
                            r"a year|per year|per annum|annual(?:ly)?|a week|per week|weekly|subscribers? pay|each|per (?:customer|client|sale|unit))\b", re.I)
_NEED_WORDS = re.compile(r"\b(need|needs|needed|raise|raising|borrow|looking for|seeking|apply for|funding of|loan of|grant of|invest(?:ment)? of|require)\b", re.I)


def is_revenue(text: str, start: int, end: int) -> bool:
    """Is the money said at text[start:end] revenue or a per-period figure, rather than an amount needed? Read from the
    words around it (its own clause), unless the clause also says it is needed ("we need £50k, we make £2k a month")."""
    clause_start = max([text.rfind(x, 0, start) for x in (".", ";", ",", " and ", "\n")] + [-1]) + 1
    ends = [i for i in (text.find(x, end) for x in (".", ";", ",", " and ", "\n")) if i != -1]
    clause = text[clause_start:min(ends) if ends else len(text)]
    return bool(_REVENUE_WORDS.search(clause)) and not _NEED_WORDS.search(clause)


_MONTHS_TITLE = r"(?i)(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?"


def extract(text: str, goal_key: str | None) -> dict[str, Any]:
    out = _extract(text, goal_key)
    if out.get("where") and isinstance(out.get("use"), str):
        # The place is its own answer: "buy two pressure washers and a second van for my car wash in Abuja" is the purpose
        # "buy two pressure washers and a second van".
        use = re.sub(rf"\s+(?:in|based in|around|from)\s+{re.escape(out['where'])}\b", "", out["use"]).strip()
        use = re.sub(r"\s+for (?:my|our|the) [\w\s-]{1,30}$", "", use).strip(" ,.")
        out["use"] = use or out["use"]
    return out


# What a sentence says about the four risks (the owner, 24 Oct: "one customer" was asked again as "How much of your income
# comes from your biggest customer?"). Read from any answer, the first message or the worry, so the chat moves on.
_RISK_SIGNS = (
    ("top_share", "over_50", r"\b(?:one|1|a single|single|two|2|one or two|a couple of|a few|one big|our main|my main|our biggest|my biggest|"
                             r"our largest|my largest)\s+(?:big\s+|main\s+|major\s+|key\s+)?(?:customers?|clients?|buyers?|accounts?)\b|"
                             r"\b(?:rely|relies|relying|depend|depends|dependent|depending)\s+(?:on|upon)\s+(?:one|a single|a few|two|our|my)\b"),
    ("top_share", "under_20", r"\b(?:lots of|many|hundreds of|loads of)\s+(?:small\s+)?(?:customers|clients)\b|\bno (?:one|single) customer\b"),
    ("runway", "under_3", r"\brun(?:ning)?\s+out\s+of\s+(?:cash|money)\b|\b(?:can't|cannot|struggl\w*\s+to)\s+pay\s+(?:the\s+)?(?:bills|rent|staff|salaries|wages)\b|"
                          r"\b(?:low|no|little)\s+(?:cash|money)\b|\bcash\s*flow\b"),
    ("paid_on_time", "often_late", r"\b(?:pay|paying|paid)\s+late\b|\blate\s+pay\w*\b|\b(?:don't|do not|won't)\s+pay\b|\bchas\w+\s+(?:payments?|invoices?|customers?|clients?)\b|"
                                   r"\boverdue\b|\bowed\b|\bunpaid\b"),
    ("key_person", "stops", r"\b(?:only|just)\s+me\b|\bby myself\b|\bon my own\b|\bi do (?:everything|it all)\b|\bwithout me\b|\bone[- ]man\b|\bsolo\b"),
)


_NUM_WORDS = {"one": 1, "a": 1, "an": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
              "eleven": 11, "twelve": 12, "a couple of": 2, "a few": 3, "several": 4}


def _n_of(text: str, unit: str) -> float | None:
    """The number said before a unit: "about 2 months", "two weeks", "a year" (the unit as a regex)."""
    m = re.search(rf"(\d+(?:\.\d+)?|{'|'.join(sorted(_NUM_WORDS, key=len, reverse=True))})\s*(?:or so\s+)?(?:more\s+)?{unit}", text, re.I)
    if not m:
        return None
    w = m.group(1).lower()
    return float(w) if re.match(r"\d", w) else float(_NUM_WORDS[w])


_CHANNEL_WORDS = (("word_of_mouth", r"\b(word of mouth|referr\w*|recommend\w*|friends?|family|returning customers?|repeat customers?)\b"),
                  ("social", r"\b(social media|instagram|insta|facebook|fb|tiktok|twitter|whatsapp|linkedin|youtube|snapchat|social)\b"),
                  ("marketplace", r"\b(marketplace|directory|directories|jiji|etsy|amazon|ebay|yell|checkatrade|bark|enterprateai)\b"),
                  ("search", r"\b(google|search(?: engines?)?|maps|website|seo|online search)\b"),
                  ("ads", r"\b(ads?|adverts?|advertis\w*|flyers?|leaflets?|posters?|billboards?|radio|newspapers?)\b"),
                  ("partners", r"\b(partners?|agents?|suppliers?|resellers?|other businesses)\b"),
                  ("walk_in", r"\b(walk[- ]?ins?|passing by|passers[- ]?by|foot traffic|street|shop front|storefront)\b"))


def choice_from_words(key: str, text: str) -> str | None:
    """A risk question answered in plain words, not by picking a chip (the owner, 24 Oct: "it should be flexible and adaptive"):
    "about 30%", "most of it", "maybe 2 months", "mostly yes", "I have 3 staff"."""
    t = str(text or "").lower()
    if key == "channel":
        # "Instagram and referrals" (the owner, 25 Oct: several at once): each channel named, joined as the chips are
        if re.search(r"\b(?:no|none|don'?t have any|haven'?t got any|not yet)\b.{0,15}\b(?:customers?|clients?)\b|\bno customers\b", t):
            return "none"
        said = [k for k, pattern in _CHANNEL_WORDS if re.search(pattern, t)]
        return ",".join(said) or None
    if key == "goal":
        n = re.search(r"\b(\d{1,4})\b", t)
        if n:
            v = int(n.group(1))
            return "5" if v <= 7 else "10" if v <= 15 else "20"
        return None
    if key == "top_share":
        pct = re.search(r"(\d+(?:\.\d+)?)\s*(?:%|per ?cent)", t)
        if pct:
            v = float(pct.group(1))
            return "over_50" if v > 50 else "20_50" if v >= 20 else "under_20"
        if re.search(r"\b(most|majority|nearly all|almost all|all of it|the bulk|over half|more than half|everything)\b", t):
            return "over_50"
        if re.search(r"\b(half|a third|a quarter|a big (?:part|chunk|share)|quite a lot)\b", t):
            return "20_50"
        if re.search(r"\b(small|little|tiny|not much|a bit|spread|evenly|none)\b", t):
            return "under_20"
        return risk_answers(t).get("top_share")
    if key == "runway":
        months = _n_of(t, r"months?") or ((_n_of(t, r"weeks?") or 0) / 4.3 or None) or ((_n_of(t, r"years?") or 0) * 12 or None)
        if months is None and re.search(r"\ba year\b|\byears\b", t):
            months = 12
        if months is None and re.search(r"\b(?:few|couple of)?\s*weeks?\b|\bdays\b|\bnot long\b|\bnot (?:very )?long\b", t):
            months = 1
        if months is not None:
            return "under_3" if months < 3 else "3_6" if months <= 6 else "over_6"
        return risk_answers(t).get("runway")
    if key == "paid_on_time":
        if re.search(r"\b(often|usually|always|most(?:ly)?|many)\b.{0,20}\b(late|slow|don'?t pay|chase)\b|\bno\b(?!t)|\brarely\b|\bnever\b", t):
            return "often_late"
        if re.search(r"\b(some(?:times|one)?|a few|occasionally|now and then|not always|one or two|slow)\b", t):
            return "sometimes_late"
        if re.search(r"\b(yes|yeah|yep|mostly|usually|always|on time|generally|they do|fine|good)\b", t):
            return "on_time"
        return risk_answers(t).get("paid_on_time")
    if key == "key_person":
        staff = _n_of(t, r"(?:staff|people|employees|workers|team members|helpers|others)")
        if staff is not None:
            team = staff + 1
            return "runs" if team >= 5 else "slows"
        if re.search(r"\b(manager|partner|team|staff|deputy|someone else|colleague|co-?founder)\b.{0,30}\b(run|runs|handle|handles|manage|cover|covers|carry|carries)\b|\bcarr(?:y|ies) on\b|\b(?:would|will) be fine\b|\bkeeps? going\b", t):
            return "runs"
        if re.search(r"\bslow(?:s|er)?\b|\bstruggle\b|\bless\b|\bsome things\b", t):
            return "slows"
        if re.search(r"\bstop(?:s|ped)?\b|\bclose(?:s|d)?\b|\bnothing (?:would )?happen|\bshut\b|\bcollapse", t):
            return "stops"
        return risk_answers(t).get("key_person")
    return None


def risk_answers(text: str) -> dict[str, str]:
    """{question: answer} that a sentence gives for the risk check; the first sign for each question wins."""
    out: dict[str, str] = {}
    for key, value, pattern in _RISK_SIGNS:
        if key not in out and re.search(pattern, str(text or ""), re.I):
            out[key] = value
    return out


def _extract(text: str, goal_key: str | None) -> dict[str, Any]:
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
        # Revenue, sales or a monthly figure is never the funding amount ("about 1.2 million naira revenue a month").
        if amount > 0 and "amount" in wanted and not is_revenue(text, m.start(), m.end()):
            out["amount"] = amount
        # The amount comes out with the word that led up to it ("for £1,500", "at 2k").
        rest = re.sub(r"(?:\s*,)?(?:\s+(?:for|at|of|costing|worth|totall?ing|priced at|@))?\s*" + re.escape(m.group(0)), " ", text, count=1, flags=re.I)
    if goal_key in ("launch", "more_customers", "price_offer"):
        out.update({k: v for k, v in _launch_facts(text).items() if k in wanted or (k.endswith("_per") and k[:-4] in wanted)})
        if goal_key == "more_customers" and "channel" in wanted:
            # "selling to local offices through Instagram": how new customers find you, as the chips say it (25 Oct)
            ch = choice_from_words("channel", text)
            if ch:
                out["channel"] = ch
        if goal_key == "launch" and ("price" in out or "cost" in out):
            from app.modules.agent.intake_turn import currency_of as _cur
            if _cur(text):
                out["currency"] = _cur(text)      # "15000 naira": NGN, kept on the session (never a question)
        return out
    if goal_key == "business_risks":
        out.update({k: v for k, v in risk_answers(text).items() if k in wanted})
        return out
    if goal_key == "test_idea":
        # "Validate my idea: a mobile car wash in Abuja": the idea and where it will run, read from the goal itself.
        m = re.search(r"(?:\bidea\s*(?:is|:|-)|\bvalidat\w*\s+(?:my\s+|this\s+|an?\s+)?(?:business\s+)?(?:idea\s*)?[:,-]?|\btest\s+(?:my\s+|this\s+)?(?:business\s+)?idea\s*[:,-]?)\s*(.+)$", text, re.I)
        what = _tidy(re.sub(r"^(?:an?|my|the|for an?)\s+", "", m.group(1).strip(), flags=re.I)) if m else ""
        place = re.search(r"\s+(?:in|around|across)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})\s*[.!]?$", what)
        if place:
            out["where"] = place.group(1)
            what = what[:place.start()].strip()
        if len(what) >= 3 and "description" in wanted:
            out["description"] = what
        return out
    if goal_key == "need_funding" and "where" in wanted:
        # Where the business trades, said in passing ("my car wash in Abuja"): read, and kept out of the purpose.
        place = re.search(r"\b(?:in|based in|around|from)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})\b", rest)
        if place and not re.fullmatch(_MONTHS_TITLE, place.group(1)):
            out["where"] = place.group(1)
            rest = (rest[:place.start()] + rest[place.end():]).strip()
            rest = re.sub(r"\s+for (?:my|our|the) [\w\s]{1,30}$", "", rest).strip()
    if goal_key == "need_funding":
        # What it is for follows the amount when one was given ("£50k for hiring"); otherwise the first "for".
        # It ends at the next clause: "£25k for a van, we're trading, need it by March" is three answers, not one.
        use = re.search(r"\b(?:for|to (?:fund|pay for|cover|finance)|to)\s+(.+)$", text[m.end():], re.I) if m else re.search(r"\bfor\s+(.+)$", rest, re.I)
        purpose = re.split(r"\s*(?:[,;.]|\band\s+(?:we|i)\b|\b(?:we(?:'re| are)|i(?:'m| am)|need it|needed)\b)", use.group(1), maxsplit=1)[0] if use else ""
        if purpose and "use" in wanted and not _NOT_A_USE.search(purpose) and len(_tidy(purpose)) > 2:
            out["use"] = re.sub(r"^(?:an?|the)\s+", "", _tidy(purpose), flags=re.I)      # "second van and a driver"
        out.update({k: v for k, v in _funding_facts(text).items() if k in wanted})
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


_WHAT = re.compile(r"\b(?:launch(?:ing)?|start(?:ing)?|open(?:ing)?|set(?:ting)?\s+up|sell(?:ing)?|pric(?:e|ing)|offer(?:ing)?|run(?:ning)?|customers? for)\s+(?:a\s+|an\s+|my\s+|our\s+|the\s+|new\s+|small\s+|little\s+|lil\s+)*"
                   r"(.+?)(?=\s+(?:in|across|around|near|for|to|by|from|next|this|before)\b|[,.;!?]|$)", re.I)
_PLACE = re.compile(r"\b(?:in|across|around|near)\s+((?:the\s+)?[A-Z][\w'-]+(?:[\s-]+(?:upon[\s-]+)?[A-Z][\w'-]+)*(?:,\s*[A-Z][\w'-]+)?)")
_WHEN = re.compile(r"\b(next (?:week|month|year|spring|summer|autumn|winter)|this (?:month|year|spring|summer|autumn|winter)|in \d+ (?:weeks?|months?)"
                   r"|(?:in |by |before )?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)\b", re.I)


# "already got 3 mates who said they'd pay", "4 people said theyd defo pay", "two customers have asked": demand evidence, as said.
_EVIDENCE = re.compile(r"\b(?:\d+|a\s+few|a\s+couple(?:\s+of)?|some|two|three|four|five|six|several|loads\s+of|lots\s+of)\s+"
                       r"(?:people|mates|friends|customers|clients|neighbours|neighbors|folk|businesses|families)\b[^.!?]{0,40}?"
                       r"\b(?:pay|paid|buy|bought|use|book|booked|asked|interested|signed\s+up|pre-?ordered)\b", re.I)


# The check's own words, not an offering: "launch readiness", "readiness", "a launch" (the owner's QA, 23 Oct)
_LAUNCH_WORDS = re.compile(r"\s*(?:(?:check|checking)\s+)?(?:(?:my|a|the|new|our)\s+)?(?:(?:launch|lunch)\s*)?(?:readiness|launch|lunch)(?:\s+(?:check|plan|readiness))?(?:\s+(?:of|for)\s+(?:my|a|the|our)\s+(?:product/service|product|service|business|idea|launch|offer))?\s*\.?\s*", re.I)


_LAUNCH_ASK_AGAIN = {
    "sell": "Name the product or service you're launching, for example home cleaning or a dog-walking app.",
    "customer": "Say who it's for, for example office workers in Leeds or new parents.",
    "where": "Name the place, for example Leeds or online across the UK.",
}


def _placeholder(key: str, value: Any) -> bool:
    """A launch answer that names nothing ("customers", "unknown", "readiness of my product")."""
    from app.modules.readiness.service import _vague
    text = str(value or "").strip()
    return bool(text) and (_vague(text) or (key == "sell" and bool(_LAUNCH_WORDS.fullmatch(text))))


def _launch_facts(text: str) -> dict[str, Any]:
    """"I want to launch a home cleaning service in Leeds next month": what (and whether it is a product or a
    service), where and when, when they are plainly there (QA P2-2). Anything doubtful is left to be asked."""
    out: dict[str, Any] = {}
    m = _WHAT.search(text)
    if m:
        what = _tidy(re.sub(r"\s*\b(?:business|biz|company|thing|idea|venture)$", "", m.group(1).strip(), flags=re.I))
        from app.modules.readiness.service import _vague
        # "launch readiness", "my business": not what is launched (the owner's QA, 23 Oct): asked instead
        vague = re.fullmatch(r"(?:it|this|that|something|(?:a |my )?product(?:/service)?|(?:a |my )?service|(?:a |my )?business)", what, re.I) \
            or _vague(what) or _LAUNCH_WORDS.fullmatch(what)
        if len(what) >= 3 and not vague and not re.match(r"(?:in|on|at|by|next|this|before|soon)\b", what, re.I):
            out["sell"] = what
            # A service: said so, or an activity done for someone ("dog walking", "car valeting", "tutoring").
            if re.search(r"\bservices?\b|\bcleaning|\bconsult|\bcoaching|\brepairs?\b|\bdesign\b|\bcatering\b", what, re.I) \
                    or (re.search(r"\b\w{3,}ing\b", what, re.I) and not re.search(r"\b(?:shop|store|cafe|café|bakery|brand|range|app|product)\b", what, re.I)):
                out["kind"] = "service"
            elif re.search(r"\bproducts?\b|\bapp\b|\bshop\b|\brange\b|\bbrand\b", what, re.I):
                out["kind"] = "product"
    p = _PLACE.search(text)
    month = re.compile(r"^(?:" + _MONTHS + r")\b", re.I)
    if p and not month.match(p.group(1)):
        out["where"] = p.group(1).strip()
    w = _WHEN.search(text)
    if w:
        out["target_date"] = w.group(1).strip()
    e = _EVIDENCE.search(text)
    if e:
        out["evidence"] = _tidy(e.group(0))
    # QA, 15 Oct: everything the sentence plainly says, so only what is missing is asked.
    if m:
        who = re.match(r"\s*for\s+(.+?)(?=\s+(?:in|across|around|near|by|from|next|this|before)\b|[,.;!?]|$)", text[m.end(1):], re.I)
        if who and not re.match(r"(?:the\s+)?(?:next|first|a|an)\s+(?:few\s+)?(?:weeks?|months?|years?)\b", who.group(1), re.I):
            out["customer"] = _tidy(who.group(1))
    if not out.get("customer"):      # kept only where the check asks who it is for (the caller filters)
        # A correction said as who it is for (the owner, 25 Oct: "it's for landlords and letting agents in Leeds" left the
        # recap's customer unchanged): the customer, and any place after it is the place
        who = re.match(r"\s*(?:actually,?\s+|no,?\s+)?(?:(?:it'?s|it\s+is|this\s+is|that'?s|they'?re|we'?re)\s+)?(?:aimed\s+at|targeting|for)\s+"
                       r"(.+?)(?=\s+(?:in|across|around|near|by|from|next|this|before|within)\b|[,.;!?]|$)", text, re.I)
        if who and not re.match(r"(?:the\s+)?(?:next|first|about|around|over|a|an|\d+|few|couple)\b.{0,20}?\b(?:days?|weeks?|months?|years?)\b", text[who.start(1):], re.I) and len(who.group(1)) > 3:
            out["customer"] = _tidy(who.group(1))
    st = re.search(r"\b(?:at\s+(?:the\s+)?|in\s+(?:the\s+)?)?(idea|prototype|testing|trial|pilot|ready)\s+stage\b|\bstill\s+(?:an?\s+)?(idea|prototype)\b|\b(?:it'?s|it\s+is)\s+(?:being\s+)?(tested|testing|ready)\b", text, re.I)
    if st:
        word = next(g for g in st.groups() if g).lower()
        out["stage"] = {"trial": "testing", "pilot": "testing", "tested": "testing"}.get(word, word)
    k = re.search(r"\b(?:it'?s|it\s+is|this\s+is)\s+(?:a|an)\s+(product|service)\b|\b(?:a|an)\s+(product|service)\s+(?:at|in)\b", text, re.I)
    if k:
        out["kind"] = (k.group(1) or k.group(2)).lower()
    if "evidence" not in out:
        e2 = re.search(r"\b(?:\d+|a\s+few|some|two|three|four|five|ten|several)\s+(?:people|customers|clients|users|businesses|families|offices)\s+"
                       r"(?:have\s+)?(?:tried|tested|used|trialled|trialed|piloted)\b[^,.;!?]{0,30}", text, re.I)
        if e2:
            out["evidence"] = _tidy(e2.group(0))
    from app.modules.agent import intake_turn as _it
    for key, pattern in (("price", _it._PRICE), ("cost", _it._COST)):
        mm = pattern.search(text)
        n = _it._number(mm.group(1)) if mm else None
        if n is not None and n > 0:
            out[key] = n
            per = re.search(r"\b(?:a|per|each|every)\s+(month|week|year|day|hour|customer|client|box|unit|visit|session)\b", mm.group(1), re.I)
            if per:
                out[f"{key}_per"] = per.group(1).lower()
    return out


_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"


def _funding_facts(text: str) -> dict[str, Any]:
    """The stage, route and timing someone states in passing ("we're trading, need a loan by March"). Only what is plainly said."""
    out: dict[str, Any] = {}
    if re.search(r"\b(not (?:yet )?trading|pre[- ]?revenue|haven'?t (?:started|launched)|no revenue|not started)\b", text, re.I):
        out["stage"] = "pre_revenue"
    elif re.search(r"\b(growing|scaling|expanding)\b", text, re.I):
        out["stage"] = "growing"
    elif re.search(r"\b(trading|have (?:customers|revenue|sales)|in business|up and running)\b", text, re.I):
        out["stage"] = "trading"
    elif re.search(r"\bjust an idea\b", text, re.I):
        out["stage"] = "idea"
    route = [k for k, pattern in (("equity", r"\b(equity|investors?|angels?|vc|venture)\b"), ("loan", r"\b(loans?|borrow\w*|bank|overdraft|credit line)\b"), ("grant", r"\bgrants?\b"))
             if re.search(pattern, text, re.I)]
    if len(route) == 1:      # two routes named: they have not chosen, so it is asked
        out["route"] = route[0]
    when = re.search(rf"\b(by|before|in|within|next)\s+((?:the\s+)?(?:end of\s+)?(?:{_MONTHS}|q[1-4]|\d+\s+(?:days?|weeks?|months?|years?)|month|quarter|year|summer|autumn|winter|spring|christmas)(?:\s+\d{{4}})?)\b", text, re.I)
    if when:
        said = f"{when.group(1).lower()} {when.group(2)}"
        from app.modules.agent.intake_turn import resolve_when
        out["timing"] = resolve_when(said)
        if out["timing"] == said:
            out["timing"] = said[:1].upper() + re.sub(rf"\b({_MONTHS})\b", lambda mm: mm.group(1).capitalize(), said[1:], flags=re.I)
    return out


def _display_name(name: str) -> str:
    """A name typed all in lower case is shown with its capitals ("mark" -> "Mark"); anything else is left as written."""
    name = _tidy(name)
    return " ".join(w[:1].upper() + w[1:] for w in name.split()) if name == name.lower() else name


def _valid_path(goal: dict, reg: dict[str, str]) -> list[str]:
    return [c for c in goal["path"] if c in reg]


def suggestions(reg: dict[str, str] | None = None) -> dict:
    """What the homepage may show: only goals and tasks that resolve to something registered now."""
    reg = registry() if reg is None else reg
    # "chip": False keeps a goal off the homepage chips (the owner's choice, 13 Oct 2026); typed, it is still understood.
    shown = [g for g in GOALS if _valid_path(g, reg) and g.get("chip", True)]
    return {"prompt": "What do you want EnterprateAI to do for your business?",
            "reassurance": "Free essential business tools. 50 AI Credits to get started.",
            "goals": [{"key": g["key"], "label": g["label"]} for g in shown if g["mode"] == "business_goal"],
            "tasks": [{"key": g["key"], "label": g["label"]} for g in shown if g["mode"] == "quick_task" and g.get("shortcut", True)],
            "retention_days": SESSION_DAYS, "version": REGISTRY_VERSION}


def _no_match(original: str, rule: str = "none") -> dict:
    return {"original_goal": original, "goal_key": None, "underlying_outcome": None, "resolution_class": NO_MATCH, "candidate_capabilities": [],
            "start_capability": None, "confidence": 0.0, "execution_boundary": "",
            "message": "EnterprateAI doesn't do that at the moment, so I won't pretend it can. "
                       "It helps you plan, quote, invoice, get paid, check readiness for funding or a launch, and understand your risks.",
            "recommended_path": [],
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
        "recommended_path": [reg[c] for c in ordered][:4],
        "provenance": {"registry": _PROVENANCE, "version": REGISTRY_VERSION, "rule": rule},
    }


# The words goals are recognised by, for reading a typo as what was meant (the owner, 24 Oct: "i want to understand a rsisk"
# was offered launch, idea and funding)
_KEY_WORDS = ("risk", "risks", "funding", "funds", "loan", "grant", "investment", "launch", "launching", "idea", "validate", "invoice", "quotation",
              "quote", "proposal", "business", "customers", "customer", "pricing", "price", "cashflow", "growth", "grow", "readiness", "fragile",
              "plan")      # "I need a business paln" (the owner, 25 Oct)
_REAL_WORDS = {"plain", "place", "plane", "prize", "lunch", "ideal", "finding", "fund", "loans", "grants", "quite", "quiet", "growl", "proposed",
               "rink", "disk", "brisk", "frisk", "rusk", "rise", "rich", "cuts", "custom", "costumes", "costume", "nice", "voice", "busy",
               "plant", "plane", "planet", "plank", "plain", "clan", "plat", "play", "plans"}


def _typos_fixed(text: str) -> str:
    """The sentence with a misspelt goal word put right ("rsisk" is "risk", "fundng" is "funding"); every other word as it was."""
    import difflib
    def fix(m: re.Match) -> str:
        w = m.group(0)
        low = w.lower()
        if len(low) < 4 or low in _KEY_WORDS or low in _REAL_WORDS:
            return w
        close = difflib.get_close_matches(low, _KEY_WORDS, n=1, cutoff=0.8)
        if not close:      # two letters swapped ("paln", "lanuch"): the word itself
            close = [k for k in _KEY_WORDS if len(k) == len(low) and k[0] == low[0] and sorted(k) == sorted(low)
                     and sum(a != b for a, b in zip(k, low)) == 2]
        return close[0] if close else w
    return re.sub(r"[A-Za-z]+", fix, text)


def resolve(*, text: str | None = None, key: str | None = None, reg: dict[str, str] | None = None) -> dict:
    """Goal -> underlying outcome -> the registered capabilities that address it. No model, no credits."""
    reg = registry() if reg is None else reg
    original = (text or "").strip()[:500]
    if key:
        goal = _BY_KEY.get(key)
        return _resolution(goal, original or goal["label"], reg, 1.0, f"suggestion:{key}") if goal else _no_match(original or key, "unknown_suggestion")
    if not original:
        return _no_match("", "empty")
    read = _typos_fixed(original)      # matched as meant; the owner's own words kept as their goal
    outcomes = [k for k, pattern in _OUTCOMES if pattern.search(read) and _valid_path(_BY_KEY[k], reg)]
    # A document or task named outright is a direct task, unless the sentence is really about an outcome.
    named = intent.rule_capability(read, list(reg))
    if named and named in reg and not (set(outcomes) & {"need_funding", "more_customers", "cash_flow", "grow", "price_offer", "launch"}):
        if named in _GOAL_OF_CAPABILITY:
            return _resolution(_BY_KEY[_GOAL_OF_CAPABILITY[named]], original, reg, 0.9, f"task_rule:{named}", direct=named)
        # A registered task with no homepage goal of its own (record a payment, add a customer…).
        return {"original_goal": original, "goal_key": None, "underlying_outcome": reg[named], "resolution_class": DIRECT,
                "candidate_capabilities": [{"capability": named, "label": reg[named]}], "start_capability": named, "confidence": 0.9, "execution_boundary": "",
                "message": f"I can do that ({reg[named][0].lower() + reg[named][1:]}). I'll ask for anything I need once your work can be saved.",
                "recommended_path": [reg[named]],
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
        if pattern.search(read):
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
                 "demo_opened", "demo_completed", "demo_try_it_clicked",
                 # QA PF7: the funnel past the goal: the first value seen in the app, the premium step chosen, its upgrade
                 # prompt followed, and the clarifying choice. Each was refused (422) before, so none was recorded.
                 "first_value_shown", "first_value_premium_clicked", "premium_upgrade_clicked", "onboarding_match_choice",
                 # Time from the goal sent to its first question on screen, in milliseconds (the target is under 1,500).
                 "first_question_shown")
SERVER_EVENTS = ("questions_avoided", "first_value_shown", "goal_or_task_submitted", "goal_outcome_resolved", "capability_match_classified", "email_verified", "task_or_goal_path_resumed", "first_output_prepared")


async def track(store: SessionStore, name: str, session: dict | None = None, *, clock=None, **facts: Any) -> None:
    """One funnel event: its name, the goal or task key, entry mode and capability. Never the
    visitor's words, answers, email or business details."""
    session = session or {}
    event = {"name": name, "at": _now(clock).isoformat(), "session_id": (session.get("id") or "")[:12] or None, "entry_mode": session.get("entry_mode"),
             "goal_key": session.get("goal_key"), "capability": (session.get("resolution") or {}).get("start_capability"),
             "resolution_class": (session.get("resolution") or {}).get("resolution_class"), "signed_in": bool(session.get("user_id")),
             **{k: v for k, v in facts.items() if k in ("entry_mode", "goal_key", "where") and v},
             **({"ms": int(facts["ms"])} if isinstance(facts.get("ms"), (int, float)) and not isinstance(facts.get("ms"), bool) else {})}
    logger.info("goal analytics %s goal=%s entry_mode=%s capability=%s", name, event["goal_key"], event["entry_mode"], event["capability"])
    try:
        await store.record(event)
    except Exception:      # noqa: BLE001
        logger.debug("goal event not recorded", exc_info=True)


def _questions(session: dict) -> list[dict]:
    if session["resolution"]["resolution_class"] in (NO_MATCH, "clarify"):
        return []
    out = list((_BY_KEY.get(session.get("goal_key") or "") or {}).get("questions") or [])
    if session.get("goal_key") == "launch":
        out = launch_questions(out, {**(session.get("proposed") or {}), **(session.get("inputs") or {})})
    return out


WHEN_CHIPS = [{"value": v, "label": v} for v in ("Within a month", "In 1 to 3 months", "In 3 to 6 months")]


def launch_questions(fields: list[dict], known: dict) -> list[dict]:
    """PRD 8.1 question 5, "Where and when do you want to launch?", asked as one; when only one of the two is known
    already ("in Leeds", "in March"), only the other is asked, in its own words."""
    has_where, has_when = known.get("where") not in (None, ""), known.get("target_date") not in (None, "")
    out = []
    for f in fields:
        if f["key"] == "where" and has_when and not has_where:
            f = {**f, "label": "Where do you want to launch?"}
        if f["key"] == "target_date" and has_where and not has_when:
            f = {**f, "hidden": False, "label": "When do you want to launch?", "unsure": "Not decided yet", "chips": WHEN_CHIPS}
        out.append(f)
    return out


def _missing(session: dict) -> list[str]:
    """Required answers not given yet. A value read from the visitor's sentence counts as given; they confirm it with the rest."""
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    given = session.get("inputs") or {}
    from app.modules.readiness.service import _vague
    # A placeholder ("readiness", "customers", "unknown") is not an answer to a required question (the owner's QA, 23 Oct):
    # asked again, never carried onto the plan.
    launch = session.get("goal_key") == "launch"      # the launch chat's own rule; the other checks keep theirs
    unsaid = lambda k: answers.get(k) in (None, "") or (launch and k in ("sell", "customer", "where") and isinstance(answers.get(k), str)      # noqa: E731
                                                          and (_vague(answers[k]) or (k == "sell" and bool(_LAUNCH_WORDS.fullmatch(answers[k].strip())))))
    # An answer of "I'll add it later" is kept as empty: it was answered, so it is not asked again.
    return [f["key"] for f in _questions(session) if f.get("required") and unsaid(f["key"]) and not (f["key"] in given and f.get("unsure"))]


_FIGURE = re.compile(r"(-?\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b", re.I)


def number_in(value: Any) -> float | None:
    """The number in an answer: "£45 per groom" is 45, "about 20 a month" is 20, "£2.5k" is 2500. None when there is none."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    m = _FIGURE.search(str(value or "").replace("\u00a3", " ").replace("$", " ").replace("\u20ac", " ").replace("\u20a6", " "))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "")) * _SCALE.get((m.group(2) or "").lower(), 1)
    except ValueError:
        return None


def _shown(field: dict, value: Any) -> str:
    if value == UNSURE:
        return str(field.get("unsure") or _NOT_SURE)
    if field.get("type") == "choice":
        if field.get("multi") and isinstance(value, str) and "," in value:      # several chosen: each by its own label
            labels = {o["value"]: o["label"] for o in field.get("options") or []}
            return ", ".join(labels.get(v.strip(), v.strip()) for v in value.split(",") if v.strip())
        return next((o["label"] for o in field.get("options") or [] if o["value"] == value), str(value))
    if field.get("type") == "number" and isinstance(value, (int, float)):
        # As its button says it ("No VAT", "7.5%", "14 days"), else with its unit (the owner, 26 Oct: VAT shown as "7.50" or "0")
        chip = next((c["label"] for c in field.get("chips") or [] if isinstance(c.get("value"), (int, float)) and float(c["value"]) == float(value)), None)
        if chip:
            return chip
        if field.get("suffix") == "%":
            return "No VAT" if field.get("key") == "vat_rate" and float(value) == 0 else f"{value:g}%"
        text = f"{value:,.2f}"
        return f"{field.get('prefix', '')}{text[:-3] if text.endswith('.00') else text}"
    return str(value)


SIGNS = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦"}
DEFAULT_CURRENCY = "GBP"


def _in_currency(session: dict, fields: list[dict]) -> list[dict]:
    """Amount fields carry the sign of the currency the visitor wrote ("$300" shows $, not £)."""
    code = session.get("currency") or DEFAULT_CURRENCY
    sign = SIGNS.get(code, "£")
    out = []
    for f in fields:
        if f.get("prefix"):
            f = {**f, "prefix": sign}
            if f.get("key") == "amount" and f.get("chips") and code in AMOUNT_CHIPS:
                f["chips"] = [{"value": v, "label": _short_money(sign, v)} for v in AMOUNT_CHIPS[code]]
        out.append(f)
    return out


def _summary(session: dict) -> list[dict]:
    """What has been given so far, one short line each, for the visitor to see and confirm."""
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    said = set(session.get("from_message") or [])
    from app.modules.agent.intake_turn import _RISK_SAID
    # A risk answer said as what it means ("Customers pay on time"), never a chip's words under another heading (the owner,
    # 24 Oct: "Late payment: Almost always" read as always late)
    meaning = lambda f, v: (_RISK_SAID[(f["key"], v)][:1].upper() + _RISK_SAID[(f["key"], v)][1:]) if (f["key"], v) in _RISK_SAID else _shown(f, v)   # noqa: E731
    rows = [{"key": f["key"], "label": f["label"], "value": meaning(f, answers[f["key"]]), "proposed": f["key"] not in (session.get("inputs") or {}),
             "from_message": f["key"] in said, "from_records": f["key"] in set(session.get("from_records") or []),
             **({"source": (session.get("record_sources") or {})[f["key"]]} if f["key"] in (session.get("record_sources") or {}) else {})}
            for f in _in_currency(session, _questions(session)) if answers.get(f["key"]) not in (None, "")
            and f["key"] not in set(session.get("not_on_record") or [])]
    if session.get("currency") and session["currency"] != DEFAULT_CURRENCY and any(f.get("prefix") for f in _questions(session)):
        rows.append({"key": "currency", "label": "Currency", "value": session["currency"], "proposed": not session.get("currency_confirmed")})
    # An invoice or quotation says what it comes to (the owner, 26 Oct: "no total")
    price, many, vat = answers.get("amount"), answers.get("quantity") or 1, answers.get("vat_rate")
    if session.get("goal_key") in ("create_invoice", "create_quotation") and isinstance(price, (int, float)) and isinstance(many, (int, float))             and isinstance(vat, (int, float)):      # once VAT is known: never a total that leaves it out
        rate = float(vat) if isinstance(vat, (int, float)) else 0.0
        total = float(price) * float(many) * (1 + rate / 100)
        sign = SIGNS.get(session.get("currency") or DEFAULT_CURRENCY, "£")
        text = f"{total:,.2f}"
        rows.append({"key": "total", "label": "Total", "value": f"{sign}{text[:-3] if text.endswith('.00') else text}" + (" including VAT" if rate else ""),
                     "proposed": False, "worked_out": True})
    return rows


# What the last step is called while it runs: the work being done, not the visitor's words.
_PREPARING = {"funding_readiness": "Checking your funding readiness", "launch_readiness": "Checking your launch readiness", "new_invoice": "Preparing your invoice",
              "quote_to_cash": "Preparing your invoice", "enquiry_to_quote": "Preparing your quotation", "new_proposal": "Preparing your proposal",
              "business_plan_draft": "Drafting your business plan", "idea_validation": "Scoring your idea", "price_test": "Modelling your price",
              "scenario_help": "Working out your cash position", "risk_concentration": "Looking for risks in your records", "expansion_scenario": "Modelling your growth",
              "offer_review": "Reviewing what you sell"}


_NOUN = {"amount": "amount", "use": "purpose", "customer": "customer", "item": "what it is for", "solution": "what you are proposing", "description": "idea"}


def _conversation(session: dict) -> dict:
    """The short conversation as the page shows it: how far through it is ("2 of 6", counted in questions, not
    fields), what was understood from the first message ("Got your amount, purpose and timing."), and the one
    line that says what the visitor gets. Engine and capability names are never part of it."""
    fields = [f for f in _questions(session) if not f.get("hidden")]
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    # Counted in the turns the chat takes, one question each (QA P2-1): a field the visitor answered, or one read
    # from their first message, is done; "Not sure" is an answer too. Grouping by PRD question number made it lag.
    done = sum(1 for f in fields if answers.get(f["key"]) not in (None, "") or (f["key"] in (session.get("inputs") or {}) and f.get("unsure")))
    understood = [f.get("noun") or _NOUN.get(f["key"]) or f["key"].replace("_", " ") for f in fields if f["key"] in (session.get("proposed") or {})]
    # What was read from the first message, said back naturally ("Cupcake boxes, nice." / "Got it: £30 a box, about 40 a
    # month."), never "Got your what you are pricing.".
    from app.modules.agent import intake_turn
    every = _questions(session)      # a hidden slot ("where", for an idea) is said back too, never asked
    first = {f["key"]: (session.get("proposed") or {})[f["key"]] for f in every if f["key"] in (session.get("proposed") or {})}
    said = (launch_ack(session.get("proposed") or {}, session.get("currency")) if session.get("goal_key") == "launch" else
            intake_turn.acknowledgement(first, {f["key"]: f for f in every}, answers, session.get("currency"))) if first else ""
    goal = _BY_KEY.get(session.get("goal_key") or "") or {}
    return {"progress": {"answered": done, "total": len(fields)} if fields else None, "acknowledged": said,
            # Nothing left to ask because the records answered it: said so, never "a few quick questions" (the owner, 24 Oct)
            "value_line": session.get("value_note") or goal.get("value") or "",
            "first_value": first_value.covered(session.get("goal_key")),
            "questions_avoided": len(understood)}


def public(session: dict) -> dict:
    """What the browser is given. The visitor's own answers come back to them; nothing else is in a session."""
    res, answers, missing = session["resolution"], session.get("inputs") or {}, _missing(session)
    proposed = {k: v for k, v in (session.get("proposed") or {}).items() if k not in answers}
    goal = _BY_KEY.get(session.get("goal_key") or "") or {}
    return {
        "id": session["id"], "state": session["state"], "entry_mode": session.get("entry_mode"), "goal_key": session.get("goal_key"),
        "goal_label": goal.get("label") or res.get("underlying_outcome") or res.get("original_goal"),
        "resolution": {**res, **({"recommended_path": [], "message": goal["value"]} if goal.get("value") else {})},
        "questions": [{**f, "default": answers.get(f["key"], proposed.get(f["key"], f.get("default", ""))), "proposed": f["key"] in proposed}
                      for f in _in_currency(session, _questions(session))],
        # A currency other than the default was written: kept, said ("In USD"), and theirs to switch.
        "currency": session.get("currency") or DEFAULT_CURRENCY,
        # Figures given in another currency than the workspace's, to settle once (keep and convert, or meant as the workspace's).
        "currency_question": session.get("currency_question"),
        "currency_note": f"In {session['currency']}" if session.get("currency") and session["currency"] != DEFAULT_CURRENCY else "",
        "currency_options": [session["currency"], DEFAULT_CURRENCY] if session.get("said_currency") and session["said_currency"] != DEFAULT_CURRENCY else [],
        "verification": ({"sent": True, "masked": mask_email(session["email"]), "expires_at": session["verify"]["expires_at"],
                          "google": session["email"].rsplit("@", 1)[-1] in ("gmail.com", "googlemail.com")}
                         if session.get("verify") and session.get("email") and not session.get("user_id") else None),
        "saving": saving_text(session) if res["resolution_class"] not in (NO_MATCH, "clarify") else "",
        **_conversation(session),
        # Their own first name, when they have said it ("I'm Munah"): the page greets them with it and doesn't ask again.
        "first_name": (session.get("visitor") or {}).get("first_name") or None,
        # The Agent's last turn: what it captured, said back in one line, and its next question (or a check to confirm).
        "agent_turn": session.get("agent_turn"),
        # The thread as it happened: each message as typed, each Agent reply once. Nothing made up for slots never asked.
        "turns": [{k: t.get(k) for k in ("role", "content", "next") if t.get(k) is not None} for t in (session.get("turns") or [])[-MAX_TURNS:]],
        "questions_avoided": len([k for k in (session.get("from_message") or session.get("proposed") or [])]) + int(session.get("questions_avoided") or 0),
        # Answers that could not be used, by field, with why: the page goes back to the first one.
        "rejected": dict(session.get("rejected") or {}),
        "choose": session.get("choose"), "case_changes": session.get("case_changes") or [], "confirm": session.get("confirm"), "preparing_label": _PREPARING.get(res.get("start_capability") or "", "Preparing your task"),
        "clarify": res.get("clarify"), "inputs": answers, "proposed": proposed, "summary": _summary(session), "missing": missing,
        "authenticated": bool(session.get("user_id")), "business_id": session.get("business_id"),
        "handoff": session.get("handoff"), "problem": session.get("problem"), "expires_at": session["expires_at"], "retention_days": SESSION_DAYS,
        "next": ("none" if res["resolution_class"] == NO_MATCH else "clarify" if res["resolution_class"] == "clarify"
                 else "questions" if (missing or proposed) else "identity" if not session.get("user_id") else "handoff" if session.get("handoff")
                 else "choose" if session.get("choose") else "prepare"),
    }


async def _understood_goal(text: str, no_match: dict) -> dict:
    """QA U1a: the rules found no goal. The understanding layer may (it asks the model when unsure). Only when the model
    agrees nothing fits is it "doesn't do that"; with no model to ask, one question offers the closest goals instead."""
    from app.modules.agent import understanding as und
    goals_reg = {g["key"]: g["label"] for g in GOALS}
    try:
        u = await und.understand(text, {"capabilities": goals_reg})
    except Exception:      # noqa: BLE001
        u = None
    if u and u.intent in goals_reg and u.confidence >= 0.6:
        out = resolve(key=u.intent)
        return {**out, "original_goal": text, "provenance": {**(out.get("provenance") or {}), "rule": "understanding"}}
    if u and u.intent == und.UNSUPPORTED and u.method == "llm+rules":
        return no_match      # the model agrees: nothing here does that
    return _clarify(text, ["business_risks", "launch", "test_idea", "need_funding", "create_invoice"], registry(), "understanding_unsure") or no_match


# E1: a document asked for on the homepage is read by the same AI extractor as the Agent's own tasks.
_EXTRACTED_AS = {"create_invoice": "new_invoice", "create_quotation": "enquiry_to_quote", "prepare_proposal": "new_proposal",
                 "create_business_plan": "business_plan_draft"}


async def _settled(orch, run: dict | None, seconds: float = 3.0) -> dict | None:
    """A task started in the background, given a moment to get where it is going: a draft that is ready a second
    later is said to be ready, never "one more thing to answer". One still working after that is said as started."""
    if not run:
        return run
    deadline = time.monotonic() + seconds
    while run.get("status") == "running" and not run.get("pending_question") and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
        run = await orch.rt.store.get_run(run["id"]) or run
    return run


FIRST_READ_SECONDS = 1.2


async def proposed_from(text: str, goal_key: str | None, owner_name: str | None = None) -> dict[str, Any]:
    """What the opening sentence gives, less placeholders (the owner's QA, 23 Oct: "launch readiness" read as selling
    "readiness"): those are asked instead, never prefilled."""
    from app.modules.readiness.service import _vague
    got = await _proposed_from(text, goal_key, owner_name=owner_name)
    if goal_key != "launch":
        return got
    return {k: v for k, v in got.items() if not (isinstance(v, str) and k in ("sell", "customer", "where")
                                                  and (_vague(v) or (k == "sell" and _LAUNCH_WORDS.fullmatch(v.strip()))))}


async def _proposed_from(text: str, goal_key: str | None, owner_name: str | None = None) -> dict[str, Any]:
    """What the visitor's sentence answers. A document is read by the shared extractor (the model reads, code checks),
    mapped onto the homepage's questions; when the model can't be reached, the earlier readers answer, and what they
    read is shown to confirm. Where both read something, the model's reading wins."""
    if not text or not goal_key:
        return {}
    # The Agent's intake turn reads the first message as it reads every other one (one shared service): its checked values
    # win, and the earlier readers only fill what it left. Without the model, the earlier readers answer as before.
    from app.modules.agent import intake_turn
    slots = (_BY_KEY.get(goal_key) or {}).get("questions") or questions_for(goal_key)
    # The first question must show within 1.5 seconds: the model has FIRST_READ_SECONDS for the first message.
    r = await intake_turn.turn(goal_key=goal_key, message=text, slots=slots, known={}, asked=None, owner_name=owner_name, seconds=FIRST_READ_SECONDS)
    if r["by"] == "model" and goal_key == "launch":
        # The launch reader's plain readings win (what is sold, its stage, price and cost); the model fills the rest.
        return {**{k: v for k, v in r["values"].items() if v != intake_turn.UNKNOWN}, **extract(text, goal_key),
                **({"currency": r["currency"]} if r.get("currency") else {})}
    if r["by"] == "model":
        return {**extract(text, goal_key), **{k: v for k, v in r["values"].items() if v != intake_turn.UNKNOWN},
                **({"currency": r["currency"]} if r.get("currency") else {})}
    if r["fallback_used"] and r["fallback_used"] != "no_model":
        # Slow or failing just now: the rule readers only, so no second wait for a model before the first question.
        if goal_key == "launch":      # the launch reader knows a launch sentence: its values win over the generic clause reader's
            return {**{k: v for k, v in r["values"].items() if v != intake_turn.UNKNOWN}, **extract(text, goal_key)}
        return {**extract(text, goal_key), **{k: v for k, v in r["values"].items() if v != intake_turn.UNKNOWN}}
    if goal_key in _EXTRACTED_AS:
        read = await read_document_goal(text, goal_key)
        if read is not None:
            return read
    if goal_key == "launch":
        return {**(await understood_answers(text, goal_key)), **extract(text, goal_key)}
    return {**extract(text, goal_key), **(await understood_answers(text, goal_key))}


async def read_document_goal(text: str, goal_key: str) -> dict[str, Any] | None:
    from app.modules.agent import extraction
    from app.modules.agent.services import LLMClassifier
    today = datetime.now(timezone.utc).date()
    got = await extraction.understand(LLMClassifier(), _EXTRACTED_AS[goal_key], text, {}, today, "homepage")
    if got.get("by") != "model":
        return None
    f = {k: v["value"] for k, v in (got.get("fields") or {}).items() if v.get("confidence", 0) >= extraction.CONFIDENT}
    # The questions this goal asks: its short conversation's, else the goal's own (a proposal, a plan).
    wanted = {q["key"] for q in questions_for(goal_key) or (_BY_KEY.get(goal_key) or {}).get("questions") or []}
    out: dict[str, Any] = {}
    if f.get("customer_name"):
        out["customer"] = f["customer_name"]
    if f.get("customer_email"):
        out["customer_email"] = f["customer_email"]
    lines = f.get("items") or []
    if lines:
        first = lines[0]
        out["item"] = first.get("name")
        if first.get("quantity"):
            out["quantity"] = float(first["quantity"])
        if first.get("unit_price") not in (None, ""):
            out["amount"] = float(first["unit_price"])
    if f.get("vat_rate") is not None:
        out["vat_rate"] = float(f["vat_rate"])
    for key in ("due_date", "valid_until"):
        if f.get(key):
            out["due_days"] = max(0, (date.fromisoformat(f[key]) - today).days)
    if goal_key == "prepare_proposal":
        if f.get("solution"):
            out["solution"] = f["solution"]
        price = f.get("total") or f.get("price_amount")
        if price:
            out["amount"] = float(price)
    if goal_key == "create_business_plan":
        out.update({k: f[k] for k in ("description", "customer", "problem") if f.get(k)})
    return {k: v for k, v in out.items() if k in wanted and v not in (None, "")}


async def understood_answers(text: str, goal_key: str | None) -> dict[str, Any]:
    """QA H: answers the shared understanding layer finds in the visitor's own sentence, for this goal's questions.
    Only those good enough to show for confirmation (0.6 and over), each one quoted in the sentence."""
    if not text or not goal_key:
        return {}
    from app.modules.agent import understanding as und
    qs = [{"key": q["key"], "type": q.get("type"), "label": q.get("label")} for q in questions_for(goal_key)]
    if not qs:
        return {}
    try:
        u = await und.understand(text, {"capabilities": und.capability_registry(), "questions": qs, "goal_key": goal_key})
    except Exception:      # noqa: BLE001 - the rule reader's answers stand
        return {}
    wanted = {q["key"] for q in qs}
    return {f.key: f.normalised_value for f in u.fields if f.key in wanted and f.action != und.ASK and not f.unsure}


def _asking(session: dict) -> dict | None:
    """The question the card asks next: the first slot not given yet, in the order asked (a hidden one never)."""
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    given = session.get("inputs") or {}
    return next((f for f in _questions(session) if not f.get("hidden") and answers.get(f["key"]) in (None, "")
                 and not (f["key"] in given and f.get("unsure"))), None)


def _summed_up(session: dict) -> bool:
    """The chat already reached its summary ("Here's where you stand"): what comes now is a change to it."""
    return any(t.get("role") == "assistant" and t.get("next") is None and str(t.get("content") or "").startswith(("Here's where you stand", "Here's what I'll use", "Got it"))
               for t in session.get("turns") or [])


def _got_it(ack: str) -> str:
    """An acknowledgement said as a change: 'Thanks, noted: X.' becomes 'Got it, X.'"""
    text = re.sub(r"^(?:thanks|nice|good|great|ok(?:ay)?)[,!.]?\s*(?:noted[:,.]?\s*)?", "", ack.strip(), flags=re.I)
    text = re.sub(r",?\s*noted\.?$", "", text, flags=re.I).strip().rstrip(".")
    return f"Got it, {text[:1].lower() + text[1:] if text[:1].isalpha() and not text[:2].isupper() else text}." if text else "Got it."


def _agent_turn(session: dict, ack: str, now: datetime, extra: str = "") -> dict:
    """The Agent's one reply: what it captured, anything it answered, then its next question (or nothing more to ask)."""
    q = _asking(session)
    if not q:
        # The last message before the result is one line (the owner's brief, 17 Oct): never findings or formulas in the chat.
        # A change made at the recap is acknowledged instead ("Got it, ₦5,000,000 for 2 more washing bays"), then the recap
        # shows again (the owner's QA, 21 Oct).
        if _summed_up(session) and ack.strip():
            return {"role": "assistant", "content": f"{_got_it(ack)} Here's what I'll use now.", "at": now.isoformat(), "next": None}
        return {"role": "assistant", "content": "Here's what I'll use:", "at": now.isoformat(), "next": None}
    text = " ".join(x for x in (extra.strip(), ack.strip(), q.get("label", "")) if x)
    return {"role": "assistant", "content": text[:1000], "at": now.isoformat(), "next": (q or {}).get("key")}


# A whole conversation, kept: the opening request and every question and answer (the owner's QA, 21 Oct: a six-question
# chat lost its first two turns to a cap of 12).
MAX_TURNS = 60


def _opening_turns(session: dict, text: str | None, key: str | None, now: datetime) -> list[dict]:
    if session["resolution"]["resolution_class"] in (NO_MATCH, "clarify"):
        return []
    said = (text or "").strip() or (_BY_KEY.get(key or "") or {}).get("label") or session.get("original_goal") or ""
    ack = _conversation(session)["acknowledged"]
    return [{"role": "user", "content": said[:1000], "at": now.isoformat()}, _agent_turn(session, ack, now)]


async def start(store: SessionStore, *, text: str | None, key: str | None, entry_mode: str, clock=None, currency: str | None = None) -> dict:
    now = _now(clock)
    began = time.perf_counter()
    from app.shared import people
    visitor, text = people.own_name(text) if text else (None, text)
    res = resolve(text=text, key=key)
    if text and not key and res.get("resolution_class") == NO_MATCH:
        res = await _understood_goal(text, res)
    session = {"id": secrets.token_urlsafe(24), **({"visitor": visitor, "name": visitor["full_name"]} if visitor else {}), "state": INITIATED, "entry_mode": entry_mode if entry_mode in ("business_goal", "quick_task", "free_text") else "free_text",
               "goal_key": res.get("goal_key"), "original_goal": res["original_goal"], "resolution": res, "inputs": {},
               "proposed": (await proposed_from(text or "", res.get("goal_key"), owner_name=(visitor or {}).get("full_name")) if not key else {}),
               "user_id": None, "business_id": None,
               "currency": None, "said_currency": None,
               "handoff": None, "events": [], "created_at": now.isoformat(), "updated_at": now.isoformat(),
               "expires_at": (now + timedelta(days=SESSION_DAYS)).isoformat()}
    _take_currency(session)
    if not session.get("currency") and str(currency or "").upper() in SIGNS:
        # The browser's hint: the workspace's currency when signed in, else the visitor's country's; never £ by default.
        session["currency"] = str(currency).upper()
    session["from_message"] = sorted(session["proposed"])      # read from their own first message: shown once, never asked (QA P5-1)
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
    # The opening message and the first question are saved with the session (the owner's QA, 21 Oct: they were added after
    # the save, so the first answer loaded a thread without them and both disappeared).
    session["turns"] = _opening_turns(session, text, key, now)
    await store.put(session)
    await track(store, "goal_or_task_submitted", session, clock=clock)
    await track(store, "goal_outcome_resolved", session, clock=clock)
    await track(store, "capability_match_classified", session, clock=clock)
    if session.get("proposed"):      # each answer read from the first message is a question not asked (PRD 16)
        await track(store, "questions_avoided", session, clock=clock, count=len(session["proposed"]))
    session["first_question_ms"] = int((time.perf_counter() - began) * 1000)
    logger.info("task session %s: first question ready in %sms (goal %s)", session["id"][:8], session["first_question_ms"], session.get("goal_key"))
    return session


def first_value_of(session: dict, data: dict | None = None, clock=None) -> dict | None:
    """The free deterministic result for this task, from the answers given and what the Company has on record. An action
    already done since is not offered again (the owner's QA, 23 Oct: "I have added the product to the catalogue, why is it
    still here?"): checked each time it is shown, also on a result kept from adopted research."""
    out = _first_value_of(session, data, clock)
    if out and data is not None:
        out = {**out, "free_next_actions": [x for x in out.get("free_next_actions") or []
                                            if not (isinstance(x.get("catalogue"), dict) and x["catalogue"].get("name")
                                                    and first_value.offering_on_record({"sell": x["catalogue"]["name"]}, data,
                                                                                       priced_only=x["catalogue"].get("base_price") is not None))]}
    return out


def _first_value_of(session: dict, data: dict | None = None, clock=None) -> dict | None:
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    goal = session.get("goal_key") or ""
    # Research adopted since (on this card or the check's page): the result as it left it, with its next step, never
    # the first answers again.
    # Only research adopted after this request began: an older run is the previous need's result, never this one's (QA, 15 Oct).
    began = str(session.get("edited_at") or session.get("created_at") or "")
    versions = [v for v in ((data or {}).get("assessment_datasets") or {}).get(goal) or []
                if isinstance(v, dict) and v.get("full_result") and str(v.get("created_at") or "") >= began]
    if versions:
        latest = max(versions, key=lambda v: str(v.get("created_at") or ""))
        return first_value.after_review(goal, latest["full_result"], latest)
    sign = SIGNS.get(session.get("currency") or DEFAULT_CURRENCY, "£")
    # A new chat about the same need keeps what was adopted before (the owner's QA, 21 Oct: after "Looks right" the adopted
    # forecast and use of funds were drafts again and the score fell from 58 to 48). A changed need (the amount or what it
    # is for) starts from its own answers.
    earlier = [v for v in ((data or {}).get("assessment_datasets") or {}).get(goal) or [] if isinstance(v, dict) and v.get("adopted")]
    if earlier:
        latest = max(earlier, key=lambda v: str(v.get("created_at") or ""))
        if same_need(latest.get("answers") or {}, answers):
            from app.modules.agent import research
            adopted = research.research_inputs(latest.get("adopted") or [])
            own = {k: v for k, v in (latest.get("inputs") or {}).items() if (latest.get("inputs_from") or {}).get(k) == "your answer"}
            return _partly_there(first_value.assess(goal, {**answers, **own, "research": adopted}, data, now=_now(clock), sign=sign), answers, sign)
    return _partly_there(first_value.assess(goal, answers, data, now=_now(clock), sign=sign), answers, sign)


def same_need(before: dict, now: dict) -> bool:
    """The same need: the same amount and the same purpose (what was said for it), as far as both say."""
    def amount(a):
        try:
            return float(str(a.get("amount")).replace(",", "")) if a.get("amount") not in (None, "") else None
        except ValueError:
            return None
    words = lambda a: " ".join(str(a.get("use") or a.get("purpose") or "").lower().split())      # noqa: E731
    a1, a2 = amount(before), amount(now)
    if a1 is not None and a2 is not None and abs(a1 - a2) > 0.005:
        return False
    return not (words(before) and words(now) and words(before) != words(now))


def _partly_there(result: dict | None, answers: dict, sign: str) -> dict | None:
    """What the traction answer already says, on the step it helps (the owner's brief, 20 Oct): "300 cars a month, ₦1.2m
    revenue" is a price of about ₦4,000, so the price step is partly there and only the cost per sale is asked. Shown on
    the step only: the score is the check's own, unchanged."""
    if not result:
        return result
    from app.modules.agent.research import said_figures
    said = said_figures(answers.get("traction"))
    price = (said.get("price") or (None,))[0]
    for b in result.get("blockers") or []:
        if b.get("key") == "economics" and price:
            b["prefill"] = {"price": price, "text": f"About {sign}{price:,.0f} a sale, worked out from what you told me. Only your cost per sale is missing."}
    return result


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
    # The answer never depends on the email going out (a failure is only logged), so the visitor is not kept
    # waiting on the mail service: a short wait, then it finishes in the background (QA P2-13: ~10s before).
    sending = asyncio.ensure_future(_mail_code(mailer, email, code, saving_text(session), session["id"]))
    _MAILING.add(sending)
    sending.add_done_callback(_MAILING.discard)
    await asyncio.wait({sending}, timeout=MAIL_WAIT_SECONDS)
    return session


MAIL_WAIT_SECONDS = 2.0
_MAILING: set = set()      # sends still going after the reply: kept so they are not dropped half way


async def _mail_code(mailer, email: str, code: str, text: str, session_id: str) -> None:
    try:
        await mailer(email, code, text)
    except Exception:      # noqa: BLE001 - said as "sent": whether an address can be mailed is not for a stranger to learn; Resend is there
        logger.warning("goal onboarding: the code email could not be sent for session %s", session_id[:8], exc_info=True)


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


def said_currency(session: dict) -> str | None:
    """The currency the owner said in the chat ("£250,000", "8 million naira"), or None: never the workspace default."""
    from app.modules.agent import intake_turn as _it
    return session.get("said_currency") or _it.currency_of(" ".join(str(t.get("content") or "") for t in session.get("turns") or [] if t.get("role") == "user")
                                                           + " " + str((session.get("resolution") or {}).get("original_goal") or ""))


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


def _recap_choice(slots: list[dict], message: str) -> tuple[str, str, str] | None:
    """(slot, value, label) when the message names one option of one choice question alone ("a loan" is the route's Loan)."""
    words = set(re.findall(r"[a-z]+", str(message or "").lower()))
    hits = []
    for q in slots:
        for o in q.get("options") or []:
            label = str(o.get("label") or "")
            names = {str(o.get("value") or "").lower().replace("_", " "), label.lower()}
            if any(n and (n in words or (" " in n and n in " ".join(re.findall(r"[a-z]+", str(message).lower())))) for n in names) \
                    and not re.search(r"\b(not|no)\b", label.lower()):
                hits.append((q["key"], o["value"], label))
    return hits[0] if len(hits) == 1 else None


async def _take_turn(session: dict, answers: dict, message: str, asked: str | None, now: datetime, rules_only: bool = False) -> dict:
    """The Agent's intake turn on the reply as typed (intake_turn): every slot it gives a value for, checked; the
    acknowledgement and the next question; the record of what was read, for audit. The answers are returned to keep."""
    from app.modules.agent import intake_turn
    slots = _questions(session)
    known = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    pending = session.pop("pending_confirm", None)
    if pending and re.match(r"^\s*(?:yes|yeah|yep|yup|correct|right|that'?s right|exactly|sure|ok(?:ay)?)\b", message, re.I):
        # "Just to check: ₦30,000 a box?" "Yes": the value it asked about is the owner's now.
        out = {k: v for k, v in answers.items() if k != asked}
        out.update({c["slot"]: c["value"] for c in pending})
        session["agent_turn"] = {"ack": "Thanks, noted.", "reply": "", "answer": None, "confirm": [], "intent": "answer", "next": None}
        return out
    turns = session.setdefault("turns", [])
    visitor = session.get("visitor") or {}
    r = await intake_turn.turn(goal_key=session.get("goal_key") or "", message=message, slots=slots, known=known,
                               provenance=session.get("provenance") or {}, asked=asked, history=turns[-6:],
                               owner_name=visitor.get("full_name") or visitor.get("first_name"), currency=session.get("currency"),
                               ai_turns=intake_turn.MAX_AI_TURNS if rules_only else int(session.get("ai_turns") or 0),
                               recent=list(session.get("recent_slots") or []))
    turns.append({"role": "user", "content": message[:1000], "at": now.isoformat()})
    if not asked and not r["values"] and _summed_up(session):
        # A change typed at the recap ("actually make it a loan"): read against each choice question, kept when one option
        # alone says it, and acknowledged as that change (the owner's QA, 21 Oct: "Thanks, that's useful evidence").
        picked = _recap_choice(slots, message)
        if picked:
            slot, value, label = picked
            r = {**r, "values": {slot: value}, "corrected": [slot], "intent": "answer", "next": None,
                 "ack": f"{'an' if label[:1].lower() in 'aeiou' else 'a'} {label.lower()}" if slot == "route" else label}
    out = {k: v for k, v in answers.items() if k != asked}
    if r["intent"] == "answer" and intake_turn.rule_intent(message) == "answer" and asked and asked in answers and asked not in r["values"]             and not r["confirm"] and not r["values"]:
        out[asked] = answers[asked]      # an answer nothing else read: as given (the form's own readers check it); never a question or an aside
    session["recent_slots"] = (list(session.get("recent_slots") or []) + [k for k in r["values"] if r["values"][k] != intake_turn.UNKNOWN])[-6:]
    out.update(r["values"])
    if r.get("currency") and r["currency"] in SIGNS and not session.get("currency_confirmed"):
        out["currency_said"] = r["currency"]
    prov = session.setdefault("provenance", {})
    for k in r["values"]:
        prov[k] = "user_corrected" if k in r["corrected"] else "user_said"
    if r["confirm"]:
        session["pending_confirm"] = r["confirm"]
    if asked and (asked in r["values"] or r["intent"] in ("question_to_agent", "not_sure", "off_topic", "change_goal")):
        (session.get("rejected") or {}).pop(asked, None)      # handled: the earlier "Please enter a number" no longer applies
    session["agent_turn"] = {"ack": r["ack"], "reply": r["reply"], "answer": r["answer"], "confirm": r["confirm"], "intent": r["intent"], "next": r["next"]}
    session["ai_turns"] = int(session.get("ai_turns") or 0) + (1 if r["ai_turn"] else 0)
    # PRD 16: the AI cost of each intake, in tokens (priced when the intake completes, from the model's own rate).
    session["ai_tokens"] = int(session.get("ai_tokens") or 0) + max((int(rec.get("tokens") or 0) for rec in r["records"]), default=0)
    session["questions_avoided"] = int(session.get("questions_avoided") or 0) + max(0, len([k for k in r["values"] if k != asked]))
    session.setdefault("turn_records", []).extend(r["records"][:20])
    session["turn_records"] = session["turn_records"][-120:]
    if r["fallback_used"]:
        session.setdefault("fallbacks", []).append({"why": r["fallback_used"], "at": now.isoformat()})
    turns.append({"role": "assistant", "content": r["reply"][:1000], "at": now.isoformat(), "next": r["next"]})
    session["turns"] = turns[-MAX_TURNS:]
    return out


async def add_inputs(store: SessionStore, session: dict, answers: dict, clock=None, confirm: bool = False, message: str | None = None,
                     asked: str | None = None, rules_only: bool = False, picked: str | None = None) -> dict:
    """Answers given in the form. A clarifying answer picks the goal; the rest are kept for the task. Still nothing canonical is written.
    With the reply as typed (`message`), the Agent's intake turn reads every slot in it, not only the one asked."""
    now = _now(clock)
    answers = dict(answers or {})
    session.pop("agent_turn", None)
    picked_turn = None
    if message and str(message).strip() and session["resolution"]["resolution_class"] not in (NO_MATCH, "clarify"):
        answers = await _take_turn(session, answers, str(message).strip(), asked, now, rules_only=rules_only)
    elif picked and asked and asked in answers:
        # A chip: what it says is the owner's turn; the Agent's turn follows once the answer is kept (below).
        session.setdefault("turns", []).append({"role": "user", "content": str(picked)[:200], "at": now.isoformat()})
        picked_turn = {asked: answers[asked]}
        from app.modules.agent import intake_turn as _it
        if _it.currency_of(picked) in SIGNS and not session.get("currency_confirmed"):
            answers.setdefault("currency_said", _it.currency_of(picked))      # "£250,000" from a chip or the form keeps its £
    if confirm and session.get("proposed") and session["resolution"]["resolution_class"] != "clarify":
        session["inputs"] = {**session["proposed"], **(session.get("inputs") or {})}
        session["proposed"] = {}
    if session["resolution"]["resolution_class"] == "clarify" and answers.get("goal_key") in _BY_KEY:
        res = resolve(key=answers.pop("goal_key"))
        res["original_goal"] = session["original_goal"]
        session.update({"resolution": res, "goal_key": res.get("goal_key"), "proposed": await proposed_from(session["original_goal"], res.get("goal_key"))})
        _take_currency(session)
        session["from_message"] = sorted(session["proposed"])
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
    # A price typed with its own currency ("$300" in a GBP workspace): that currency, shown with the switch, for them to confirm.
    typed = answers.pop("currency_said", None)
    if typed in SIGNS and typed != session.get("currency") and not session.get("currency_confirmed"):
        session["currency"] = session["said_currency"] = typed
    picked = answers.pop("subject_choice", None)
    if picked and session.get("choose") and picked in [o["value"] for o in session["choose"]["options"]]:
        session["subject_choice"] = picked
        session.pop("choose", None)
        session["state"] = READY
    allowed = {f["key"]: f for f in _questions(session)}
    for k, v in answers.items():
        if k in allowed and allowed[k].get("unsure") and str(v).strip().lower() in (UNSURE, str(allowed[k]["unsure"]).lower()):
            session["inputs"][k] = allowed[k]["unsure_value"] if "unsure_value" in allowed[k] else UNSURE      # said, and stored as said: never guessed, never treated as a fact
            session.get("rejected", {}).pop(k, None)
            continue
        if k in allowed and allowed[k]["type"] == "email" and v not in (None, ""):
            if not _ADDRESS.match(str(v).strip()):
                continue      # not an address: asked again
            session["inputs"][k] = str(v).strip().lower()
            continue
        if k in allowed and v not in (None, ""):
            if allowed[k]["type"] == "number":
                # QA H: the shared normalisers: "about sixty" is 60, "standard rate" is 20 for VAT, "not sure" is an answer.
                from app.modules.agent import understanding as _und
                if _und.is_unsure(v) and allowed[k].get("unsure"):
                    session.get("rejected", {}).pop(k, None)
                    session["inputs"][k] = UNSURE
                    continue
                figure = _und.vat_of(v) if k == "vat_rate" else _und.number_of(v)
                if figure is None:
                    # Not a number: kept out, and said, so the page asks it again with the reason (never a silent no-op).
                    session.setdefault("rejected", {})[k] = "Please enter a number, for example 45."
                    continue
                session.get("rejected", {}).pop(k, None)
                session["inputs"][k] = figure
                continue
            if session.get("goal_key") == "launch" and k in _LAUNCH_ASK_AGAIN and _placeholder(k, v):
                # "customers", "readiness of my product": kept out and asked again, saying why (the owner's QA, 23 Oct: the
                # recap showed "Customer: customers" and Continue did nothing)
                session["inputs"].pop(k, None)
                session.setdefault("rejected", {})[k] = _LAUNCH_ASK_AGAIN[k]
                continue
            session.get("rejected", {}).pop(k, None)
            session["inputs"][k] = str(v).strip()[:2000]
    if picked_turn:
        from app.modules.agent import intake_turn
        kept = {k: session["inputs"][k] for k in picked_turn if k in session["inputs"]}
        every = {f["key"]: f for f in _questions(session)}
        session["turns"].append(_agent_turn(session, intake_turn.acknowledgement(kept, every, session["inputs"], session.get("currency")), now))
        session["turns"] = session["turns"][-MAX_TURNS:]
    elif message and session.get("turns") and session["turns"][-1].get("role") == "assistant":
        # The Agent's reply, set against what was actually kept (its next question is the session's own next one).
        last = session["turns"][-1]
        q = _asking(session)
        if (session.get("agent_turn") or {}).get("confirm"):
            pass
        elif q and last.get("next") != q["key"]:
            t = session.get("agent_turn") or {}
            session["turns"][-1] = _agent_turn(session, t.get("ack") or "", now, extra=t.get("answer") or "")
        elif not q:
            t = session.get("agent_turn") or {}
            earlier = {**session, "turns": session["turns"][:-2]}      # before this message and its reply
            if _summed_up(earlier) and (t.get("ack") or "").strip():
                session["turns"][-1] = {**last, "content": f"{_got_it(t['ack'])} Here's what I'll use now.", "next": None}
            else:
                session["turns"][-1] = {**last, "content": "Here's what I'll use:", "next": None}      # one line, then the recap (the owner's QA, 21 Oct)
    if session.get("goal_key") == "launch":
        _split_where_when(session)
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
    qty = a.get("quantity") if isinstance(a.get("quantity"), (int, float)) and a.get("quantity") > 0 else 1
    if out.get("item"):
        out["item"]["quantity"] = int(qty) if float(qty).is_integer() else qty
    return out


def _answers_for_task(session: dict) -> dict:
    """The homepage answers as the task's own answers: who, their email, the lines, VAT and the due date."""
    a = session.get("inputs") or {}
    if session.get("goal_key") == "prepare_proposal":
        cur = said_currency(session)
        return {"currency": str(cur).upper()} if cur and str(cur).upper() in SIGNS else {}
    if session.get("goal_key") not in ("create_invoice", "create_quotation"):
        return {}
    out: dict[str, Any] = {}
    if a.get("customer"):
        out["customer_id"], out["customer_name"] = "new", str(a["customer"])
    if a.get("customer_email"):
        out["customer_email"] = a["customer_email"]
    elif "customer_email" in a:
        out["email_later"] = True      # "I'll add it later": the draft is made now, the address is asked for when it is sent
    if a.get("item") and isinstance(a.get("amount"), (int, float)):
        qty = a.get("quantity") if isinstance(a.get("quantity"), (int, float)) and a.get("quantity") > 0 else 1
        out["items"] = [{"name": str(a["item"]), "quantity": qty, "unit_price": a["amount"]}]
    if isinstance(a.get("vat_rate"), (int, float)):
        out["vat_rate"] = a["vat_rate"]
    # The currency the owner priced it in ("£500"), carried to the document (the owner's QA, 20 Oct: £500 became ₦500).
    # Stored as given, never converted: the customer is billed £500; totals in the workspace currency convert it.
    cur = said_currency(session) or (session.get("currency") if session.get("currency_confirmed") else None)
    if cur and str(cur).upper() in SIGNS:
        out["currency"] = str(cur).upper()
    if isinstance(a.get("due_days"), (int, float)) and a["due_days"] > 0:
        out["payment_terms_days" if session.get("goal_key") == "create_invoice" else "validity_days"] = int(a["due_days"])
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


def _keep_answers(d: dict, session: dict, now: datetime) -> None:
    """What the visitor told the homepage check goes into the workspace as they sign in, with its result, so the
    dashboard, the same check later and every other check start from it instead of asking again."""
    goal = session.get("goal_key")
    answers = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    if not first_value.covered(goal) or not answers:
        return
    from app.modules.agent import answer_memory
    result = first_value.assess(goal, answers, d, now=now, sign=SIGNS.get(session.get("currency") or DEFAULT_CURRENCY, "£"))
    answer_memory.remember(d, goal, answers, now=now, result=result, currency=session.get("currency") or DEFAULT_CURRENCY)
    # The workspace profile's empty fields, filled from what was said (P0.4); a different value is asked once, never written.
    from app.modules.agent import profile_fill
    profile_fill.fill(d, answers, goal,
                      currency=session.get("said_currency") or session.get("currency"), now=now)


async def settle_currency(store: SessionStore, session: dict, choice: str, clock=None) -> dict:
    """The answer to "You said £10,000; your workspace uses naira": "keep" converts the figures at the day's rate (said
    so, with the rate and its date); "meant" takes them as the workspace's currency. Either way the currency is settled."""
    q = session.get("currency_question")
    if not q:
        return session
    # Amounts are stored in the currency the owner gave, never converted (the owner's brief, 20 Oct: £100,000 was stored
    # as ₦177,303,000). "keep": the figures stay in that currency, and so does this case; "meant": the workspace's.
    code = q["shown"] if choice == "keep" else q["workspace"]
    session.pop("currency_question", None)
    session["currency"], session["currency_confirmed"] = code, True
    session["updated_at"] = _now(clock).isoformat()
    await store.put(session)
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
            signed_up = str(session.get("email") or user_id or "").strip()
            if _ADDRESS.match(signed_up):      # the sign-up email: the workspace's contact email until changed
                data.setdefault("workspace_profile", {})["email"] = signed_up
            session["business_id"] = await orch.rt.business.create(user_id, name or "My workspace", data)
            session["new_workspace"] = True
            _event(session, "CanonicalRecordLinkedOrCreated", now, record="business", how="created")

    def _mark(d: dict) -> None:
        d.setdefault("onboarding", {"via": "goal_first", "goal": session.get("goal_key"), "at": now.isoformat()})
        if name and not (d.get("workspace_profile") or {}).get("company_name"):
            d.setdefault("workspace_profile", {})["company_name"] = name
        _keep_answers(d, session, now)
    await orch.rt.business.mutate(session["business_id"], _mark)
    if not session.get("currency_confirmed"):
        biz = await orch.rt.business.load(session["business_id"]) or {}
        code = bz.currency_of(biz)
        shown = session.get("currency") or DEFAULT_CURRENCY
        figures = {f["key"]: (session.get("inputs") or {}).get(f["key"]) for f in _questions(session) if f.get("prefix")}
        figures = {k: v for k, v in figures.items() if isinstance(v, (int, float)) and v > 0}
        if code in SIGNS and code != shown and figures and session.get("goal_key") in ("need_funding", "launch", "test_idea", "price_offer", "more_customers"):
            # A check follows the workspace's currency, so its figures are settled once (a quick reply in £ counts as said
            # in £). A document task ("an invoice for $300") keeps the currency it was given: never asked.
            # Figures were given in the chat's currency ("£10,000") and the workspace uses another: asked once, never
            # relabelled (the owner's QA, 20 Oct: "£10,000" became "₦10,000"). Keep them (converted at the day's rate),
            # or say they were meant in the workspace's currency.
            rate = None
            try:
                from app.modules.agent import credibility
                rate = await credibility.dated_rate(shown, code, now.date())
            except Exception:      # noqa: BLE001 - asked without the converted figure
                rate = None
            session["currency_question"] = {"shown": shown, "workspace": code, "figures": figures, "rate": rate}
        elif code in SIGNS and not session.get("said_currency"):
            # Nothing given in money yet: the workspace's own (a country's currency), never the visitor default (QA, 15 Oct).
            session["currency"] = code
    # A choice still to make is where it stopped: never skipped by picking the task up again.
    session["state"] = COLLECTING_REQUIRED if session.get("choose") else READY if not _missing(session) else COLLECTING_REQUIRED
    if session["state"] == READY:
        _event(session, "TaskReadyToPrepare", now)
    session["updated_at"] = now.isoformat()
    await store.put(session)
    await track(store, "task_or_goal_path_resumed", session, clock=clock)
    return session


# The free checks worked out on the records alone, each with its own page (the owner, 24 and 25 Oct): no paid task, no
# history row, the result in one request, one short line in the chat
FREE_CHECKS = {"business_risks": "/check/risks", "more_customers": "/check/customers"}

NEW = "new"


async def _open_subjects(svc, business_id: str, kind: str) -> list[dict]:
    """The workspace's funding cases (or launch plans) that are still in use, newest first. One read."""
    rows = await svc.store.list("subjects", business_id, kind=kind, limit=50)
    return [r for r in rows if r.get("status") not in ("archived", "cancelled", "launched", "closed")][:3]


_ROUTE_OF = {"equity": "equity", "loan": "loan", "grant": "grant", "unsure": "unsure", "not_sure": "unsure"}
_STAGE_OF = {"trading": "trading", "growing": "trading", "pre_revenue": "pre_revenue", "idea": "pre_revenue"}
_CUSTOMERS = re.compile(r"\b(\d[\d,]*)\s+(?:\w+\s+){0,2}(?:customers?|clients?|subscribers?|members?|users?|buyers?)\b", re.I)


def end_of_month(said: Any, today: date | None = None) -> str | None:
    """A month and year said ("June 2027", "by March") as the last day of that month ("2027-06-30"); "within 3 months" or
    "in 6 to 12 months" as the end of the latest month named. None when no date is said."""
    import calendar
    from app.modules.agent.intake_turn import resolve_when
    today = today or date.today()
    text = resolve_when(str(said or "").strip(), today)
    m = re.search(rf"\b({_MONTHS})\b\s+(\d{{4}})", text, re.I)
    if m:
        month = [x.lower() for x in calendar.month_name].index(m.group(1).lower())
        year = int(m.group(2))
    else:
        n = re.search(r"\b(?:within|in)\s+(?:\d+\s+to\s+)?(\d+|a|one)\s+months?\b", text, re.I)
        if not n:
            return None
        ahead = today.month - 1 + (1 if n.group(1).lower() in ("a", "one") else int(n.group(1)))
        year, month = today.year + ahead // 12, ahead % 12 + 1
    return f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def _num_or_none(v: Any) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def launch_fields(a: dict, today: date | None = None) -> dict:
    """The launch chat's answers, each in its own plan field: who it is for, where, a real date, and the price and cost
    said (Offer and pricing, PRD 8.2)."""
    from app.modules.readiness.service import _vague      # "unknown", "customers", "readiness": not answers (23 Oct)
    real = lambda v: None if v in (None, "") or _vague(str(v)) else v      # noqa: E731
    out = {k: v for k, v in {"audience": real(a.get("customer")), "target_date": launch_date(a.get("target_date"), today),
                             "geography": real(a.get("where"))}.items()
           if v not in (None, "")}
    offer = {k: v for k, v in {"launch_scope": real(a.get("sell")), "price": _num_or_none(a.get("price"))}.items() if v not in (None, "")}
    econ = {k: v for k, v in {"price_per_unit": _num_or_none(a.get("price")), "variable_cost_per_unit": _num_or_none(a.get("cost"))}.items() if v is not None}
    if offer:
        out["offer"] = offer
    if econ:
        out["economics"] = econ
    return out


def editable_questions(session: dict) -> list[dict]:
    """The questions the result card lets the owner change and run again: the ones asked in the chat, with their options."""
    keep = ("key", "label", "type", "options", "chips", "prefix", "unsure", "required")
    return [{k: f[k] for k in keep if k in f} for f in _questions(session) if not f.get("hidden") or f["key"] in ("target_date",)]


async def edit_answers(store: SessionStore, session: dict, orch, user_id: str, changes: dict, email: str | None = None, clock=None) -> dict:
    """Edit and run again, from the result card (the owner's QA, 15 Oct): the changed answers are kept on this request,
    written to the case or plan it set up (only what changed), and the check is run again on them. Nothing else changes."""
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    now = _now(clock)
    if session.get("user_id") != user_id or not session.get("business_id"):
        raise PermissionError("This task belongs to another account.")
    allowed = {f["key"]: f for f in _questions(session)}
    inputs = dict(session.get("inputs") or {})
    for k, v in (changes or {}).items():
        if k not in allowed:
            continue
        if allowed[k].get("type") == "number":
            n = _num_or_none(v)
            if n is None and str(v).strip().lower() not in ("unknown", "not sure"):
                continue
            inputs[k] = n if n is not None else UNSURE
        else:
            inputs[k] = str(v).strip()[:2000]
    session["inputs"], session["proposed"] = inputs, {}
    if session.get("goal_key") == "launch":
        _split_where_when(session)
    a = session["inputs"]
    sid = (session.get("handoff") or {}).get("subject_id")
    capability = (session.get("handoff") or {}).get("capability")
    if sid and capability in _MODULES:
        svc = service_for(orch)
        kind = rules.FUNDING if capability == "funding_readiness" else rules.LAUNCH
        row = await svc.store.get("subjects", sid)
        if not row or row.get("business_id") != session["business_id"]:
            raise PermissionError("That is not one of this workspace's records.")
        before = row.get("data") or {}
        if kind == rules.FUNDING:
            biz = await orch.rt.business.load(session["business_id"]) or {}
            money = case_currency(session, biz)
            wanted = case_fields(a, currency=money if money in rules.SUPPORTED_CURRENCIES else None, where=a.get("where"), today=now.date())
            changed = {d["path"].split(".")[0] for d in case_diff(before, wanted)}
            only = {k: v for k, v in {**wanted, "title": need_title(wanted)}.items() if k in changed or (k == "title" and changed & {"target_amount", "purpose", "route_preference"})}
            stamp = f"Edited on your result, {now.day} {now.strftime('%b')}"
            prov = {p: stamp for p in only}
        else:
            wanted = {**launch_fields(a, now.date()), "name": launch_title(a, now.date())}
            only = {k: v for k, v in wanted.items() if before.get(k) != v}
            prov = None
        if only:
            await svc.update_subject(user_id, session["business_id"], kind, sid, row["revision"], only, email, provenance=prov)
        try:
            checked = await svc.request_assessment(user_id, session["business_id"], kind, sid, idempotency_key=f"edit:{session['id']}:{now.isoformat()}"[:120], email=email)
            session["handoff"] = {**session["handoff"], "assessment_id": checked.get("id"), "score": (checked.get("result") or {}).get("score_display"),
                                  "classification": (checked.get("result") or {}).get("classification")}
        except Exception:      # noqa: BLE001 - the answers are saved; the check can be run from its page
            logger.warning("edit: the check did not run again for session %s", session["id"][:8], exc_info=True)
    # The quick result is worked out again from the new answers (never an older run's).
    session["edited_at"] = now.isoformat()
    session["updated_at"] = now.isoformat()
    await store.put(session)
    return session


def launch_title(a: dict, today: date | None = None) -> str:
    """"Car wash subscription, Abuja, January 2027": what, where and when, as said."""
    import calendar
    from app.modules.readiness.service import _vague
    what = str(a.get("sell") or "").strip()
    what = "My launch" if not what or _vague(what) else what[:1].upper() + what[1:]
    where = str(a.get("where") or "").strip()
    where = "" if _vague(where) else where
    when = launch_date(a.get("target_date"), today)
    month = f"{calendar.month_name[int(when[5:7])]} {when[:4]}" if when else ""
    return ", ".join(x for x in (what, where, month) if x)[:120]


def launch_ack(said: dict, currency: str | None) -> str:
    """One clean line of what a launch sentence gave (the owner's QA, 15 Oct): "Got it: a car wash subscription (a service,
    at testing stage) for office workers in Abuja, launching January 2027, at ₦15,000 a month, costing ₦6,000 per
    customer, with 10 customers tried it." Only what was said."""
    from app.modules.agent.intake_turn import _money, _with_article
    what = str(said.get("sell") or "").strip()
    from app.modules.readiness.service import _vague
    if _vague(what) or _LAUNCH_WORDS.fullmatch(what):
        what = ""      # "readiness of my product" is not what is launched: never said back as if it were (23 Oct)
    about =[x for x in ((f"a {said['kind']}" if said.get("kind") in ("product", "service") else "both a product and a service" if said.get("kind") == "both" else ""),
                         (f"at {said['stage']} stage" if said.get("stage") else "")) if x]
    head = (_with_article(what) if what else "your launch") + (f" ({', '.join(about)})" if about else "")
    parts = [head + (f" for {said['customer']}" if said.get("customer") else "") + (f" in {said['where']}" if said.get("where") else "")]
    if said.get("target_date"):
        when = re.sub(r"^(?:in|by)\s+", "", str(said["target_date"]).strip(), flags=re.I)
        parts.append(f"launching {when}")
    if isinstance(said.get("price"), (int, float)):
        parts.append(f"at {_money(said['price'], currency)}" + (f" a {said['price_per']}" if said.get("price_per") else ""))
    if isinstance(said.get("cost"), (int, float)):
        parts.append(f"costing {_money(said['cost'], currency)}" + (f" per {said['cost_per']}" if said.get("cost_per") else ""))
    if said.get("evidence") and str(said["evidence"]).lower() not in ("none yet", "not sure"):
        return "Got it: " + ", ".join(parts) + f", and {said['evidence']}."
    return "Got it: " + ", ".join(parts) + "."


def _split_where_when(session: dict) -> None:
    """"Where and when do you want to launch?" answered in one go ("Abuja, January 2027", "Leeds next month"): the place
    and the date, each in its own field. A date already given stays."""
    for bag in (session.get("inputs") or {}, session.get("proposed") or {}):
        said = bag.get("where")
        if not isinstance(said, str) or not said.strip():
            continue
        w = _WHEN.search(said)
        if not w:
            continue
        if not bag.get("target_date") and not (session.get("inputs") or {}).get("target_date"):
            bag["target_date"] = w.group(1).strip()
        place = (said[:w.start()] + said[w.end():]).strip(" ,.;-")
        place = re.sub(r"^(?:in|at|around|across)\s+|\s+(?:in|by|from|on)$", "", place, flags=re.I).strip(" ,.;")
        bag["where"] = place or said


def launch_date(said: Any, today: date | None = None) -> str | None:
    """A launch date as the plan keeps it: a date given stays; "In 1 to 3 months" or "June 2027" is the end of that month;
    anything else ("Not decided yet") is no date."""
    text = str(said or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return end_of_month(text, today)


def case_currency(session: dict, biz: dict | None) -> str | None:
    """The case's currency (the owner's QA, 20 Oct: the case flipped £/₦ across runs): the one typed in this chat ("£250,000"),
    else one chosen in it, else the workspace's own. Never a page's guess or a default."""
    said = said_currency(session)
    if said:
        return said
    if session.get("currency_confirmed") and session.get("currency"):
        return session["currency"]
    return bz.currency_of(biz or {}) or session.get("currency")


def case_fields(a: dict, *, currency: str | None, where: str | None = None, country: str | None = None, today: date | None = None) -> dict:
    """The funding chat's answers, each in its own case field (the owner's QA, 15 Oct): amount to the target, use to the
    purpose, timing to the receipt date, route to the route considered, stage, traction (their sentence, with the customers
    and monthly revenue it states), and the place to the market. Revenue is never the target."""
    from app.modules.agent.intake_turn import _number
    out: dict[str, Any] = {}
    amount = a.get("amount")
    if isinstance(amount, (int, float)) and amount > 0:
        out["target_amount"] = float(amount)
        out["timing_confirmed"] = True      # said in the chat: confirmed from it, never asked again (the owner's brief, 20 Oct)
    if currency:
        out["currency"] = currency
    if a.get("use") and str(a["use"]).strip().lower() not in ("unknown", "not sure"):
        out["purpose"] = str(a["use"]).strip()
    when = end_of_month(a.get("timing"), today) if a.get("timing") else None
    if when:
        out["receipt_date"] = when
    route = _ROUTE_OF.get(str(a.get("route") or "").lower())
    if route:
        out["route_preference"] = route
    stage = _STAGE_OF.get(str(a.get("stage") or "").lower())
    if stage:
        out["stage"] = stage
    said = str(a.get("traction") or "").strip()
    if said and said.lower() != "unknown":
        traction: dict[str, Any] = {"summary": said}
        m = _CUSTOMERS.search(said)
        if m:
            traction["customers"] = int(m.group(1).replace(",", ""))
        from app.modules.agent.research import traction_figures
        if traction_figures(said).get("monthly_revenue"):
            traction["monthly_revenue"] = traction_figures(said)["monthly_revenue"]      # "300 cars a month" is never revenue
        out["traction"] = traction
    place = str(where or a.get("where") or "").strip()
    if place:
        out["market"] = {"location": place}
    if country:
        out["jurisdiction"] = country
    return out


def short_money(v: Any, currency: str | None) -> str:
    """₦8m, £100k, $2.5m: an amount as a title says it."""
    sign = SIGNS.get(currency or DEFAULT_CURRENCY, "")
    try:
        n = float(v)
    except (TypeError, ValueError):
        return ""
    for size, word in ((1e9, "bn"), (1e6, "m"), (1e3, "k")):
        if n >= size:
            x = n / size
            return f"{sign}{x:.1f}".rstrip("0").rstrip(".") + word if x % 1 else f"{sign}{int(x)}{word}"
    return f"{sign}{n:,.0f}"


def need_title(fields: dict) -> str:
    """The case named in plain words (the owner's brief, 20 Oct): "₦5m loan for 2 more washing bays" (editable)."""
    use = re.sub(r"^(?:to|for)\s+", "", str(fields.get("purpose") or "").strip(), flags=re.I).rstrip(".")
    use = use if len(use) <= 48 else use[:45].rsplit(" ", 1)[0] + "…"
    money = short_money(fields.get("target_amount"), fields.get("currency")) if fields.get("target_amount") else ""
    route = {"loan": "loan", "grant": "grant", "equity": "equity investment"}.get(str(fields.get("route_preference") or ""), "funding")
    head = " ".join(x for x in (money, route) if x)
    head = head[:1].upper() + head[1:]
    if not use:
        return head[:120] if money else "Funding"
    from app.modules.agent.intake_turn import purpose_phrase
    return f"{head} {purpose_phrase(use)}"[:120]


# What makes it a different funding need (not just new details): the amount, its currency, what it is for, the route, where.
_CORE = ("target_amount", "currency", "purpose", "route_preference", "market.location")
_DIFF_LABEL = {"target_amount": "Amount", "currency": "Currency", "purpose": "Purpose", "receipt_date": "Timing", "route_preference": "Route",
               "stage": "Stage", "traction.summary": "Traction", "market.location": "Market"}


def _get(d: dict, path: str) -> Any:
    for part in path.split("."):
        d = (d or {}).get(part) if isinstance(d, dict) else None
    return d


def case_diff(before: dict, wanted: dict) -> list[dict]:
    """What the chat would change on the case: [{path, label, before, after, core}]; only what differs."""
    out = []
    for path, label in _DIFF_LABEL.items():
        new = _get(wanted, path)
        if new in (None, ""):
            continue
        old = _get(before, path)
        if path == "route_preference" and old in (None, ""):
            old = before.get("route")
        same = (float(old) == float(new)) if path == "target_amount" and old not in (None, "") else str(old or "").strip().lower() == str(new).strip().lower()
        if not same:
            out.append({"path": path, "label": label, "before": old, "after": new, "core": path in _CORE})
    return out


def _said(path: str, value: Any, currency: str | None, full: bool = False) -> str:
    if value in (None, ""):
        return "not set"
    if path == "target_amount":
        try:
            return f"{SIGNS.get(currency or DEFAULT_CURRENCY, '')}{float(value):,.0f}"
        except (TypeError, ValueError):
            return str(value)
    if path == "receipt_date":
        try:
            d = date.fromisoformat(str(value)[:10])
            return d.strftime("%b %Y")
        except ValueError:
            return str(value)
    text = str(value)
    # In the update table, the whole value (it wraps there); shortened only where it is said in one line.
    return text if full or len(text) <= 40 else text[:37].rsplit(" ", 1)[0] + "…"


def diff_line(diff: list[dict], before: dict, wanted: dict) -> str:
    """"Amount £100,000 → ₦8,000,000 · Route equity → loan · Timing Dec 2026 → Jun 2027"."""
    return " · ".join(f"{d['label']} {_said(d['path'], d['before'], before.get('currency'))} → {_said(d['path'], d['after'], wanted.get('currency') or before.get('currency'))}"
                      for d in diff)


def need_summary(data: dict) -> str:
    """"£100,000 equity, UK SMEs": what a funding need was, for History."""
    parts = [short_money(data.get("target_amount"), data.get("currency")) if data.get("target_amount") else "",
             str(data.get("route_preference") or data.get("route") or ""),
             str(_get(data, "market.location") or _get(data, "market.target_segment") or "")[:40]]
    return ", ".join(x for x in (" ".join(x for x in parts[:2] if x), parts[2]) if x)


def plain_changes(diff: list[dict], data: dict, wanted: dict, session: dict) -> list[dict]:
    """What the chat changes on the case, in the words the chat used ("Investment", never "equity"; "Not trading yet",
    never "pre_revenue"): [{"field", "before", "now"}], five at most."""
    labels: dict[str, dict] = {}
    for q in _questions(session):
        for o in q.get("options") or []:
            labels.setdefault(q["key"], {})[str(o.get("value") or "").lower()] = str(o.get("label") or "")
    path_key = {"route_preference": "route", "stage": "stage", "receipt_date": "timing"}

    def word(path, value, currency):
        key = path_key.get(path)
        named = (labels.get(key) or {}).get(str(value or "").lower()) if key else None
        if named:
            return named
        text = _said(path, value, currency, full=True)
        if text == "not set":
            return "Not set"
        return (text.replace("_", " ")[:1].upper() + text.replace("_", " ")[1:]) if "_" in text else text      # a code said in words
    return [{"field": d["label"], "before": word(d["path"], d["before"], data.get("currency")),
             "now": word(d["path"], d["after"], wanted.get("currency") or data.get("currency"))} for d in diff][:5]


async def case_changes(orch, session: dict, user_id: str, email: str | None = None) -> list[dict]:
    """For the recap, before anything is written: what this chat would change on the business's funding case."""
    from app.modules.agent import credibility
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    if session.get("goal_key") != "need_funding" or not session.get("business_id"):
        return []
    svc = service_for(orch)
    rows = sorted((r for r in await svc.store.list("subjects", session["business_id"], kind=rules.FUNDING, limit=50)
                   if r.get("status") not in ("cancelled", "archived")), key=lambda r: str(r.get("created_at") or ""), reverse=True)
    if not rows:
        return []
    a = session.get("inputs") or {}
    biz = await orch.rt.business.load(session["business_id"]) or {}
    profile = biz.get("workspace_profile") or {}
    where = a.get("where") or profile.get("city") or ""
    country = (credibility.country_of(where) or credibility.country_of(profile.get("country")) or "").title() or None
    money = case_currency(session, biz)
    wanted = case_fields(a, currency=money if money in rules.SUPPORTED_CURRENCIES else None, where=a.get("where"), country=country, today=_now(None).date())
    data = rows[0].get("data") or {}
    return plain_changes(case_diff(data, wanted), data, wanted, session)


def _replace_or_update(row: dict, diff: list[dict], wanted: dict) -> dict:
    """One case per business (the owner's brief, 20 Oct): never "Replace". The case is updated; when the need itself changes
    (the amount, the purpose), the previous version is kept in History automatically. Shown as a clean list of what changes:
    Field | Before | Now, five rows at most, in plain words."""
    data = row.get("data") or {}
    rows = [{"field": d["label"], "before": _said(d["path"], d["before"], data.get("currency"), full=True),
             "now": _said(d["path"], d["after"], wanted.get("currency") or data.get("currency"), full=True)} for d in diff][:5]
    how = "replace" if any(d["core"] for d in diff) else "update"      # "replace" keeps the old version in History; same button
    options = [{"value": f"{how}:{row['id']}", "label": "Update my case"}, {"value": f"cancel:{row['id']}", "label": "Cancel"}]
    return {**_f("subject_choice", "I'll update your funding case", "choice", required=True, options=options), "diff": diff, "rows": rows,
            "default": f"{how}:{row['id']}"}


def _brand_later(orch, business_id: str, user_id: str | None) -> None:
    """The empty tagline, vision, mission and core values drafted after a flow, in the background (one model call)."""
    import asyncio as _asyncio
    from app.modules.agent import profile_fill
    try:
        task = _asyncio.get_running_loop().create_task(profile_fill.draft_brand_later(orch, business_id, user_id))
        _BRAND_TASKS.add(task)
        task.add_done_callback(_BRAND_TASKS.discard)
    except RuntimeError:
        pass


_BRAND_TASKS: set = set()


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


def _same_subject(existing: list[dict], wanted: dict, name_field: str) -> dict | None:
    """An open record that is the one being asked for again: same name, same amount (where there is one), same purpose."""
    norm = lambda v: " ".join(str(v or "").lower().split())      # noqa: E731
    for row in existing:
        d = row.get("data") or {}
        if norm(d.get(name_field)) != norm(wanted.get(name_field)):
            continue
        try:
            same_amount = float(d.get("target_amount") or 0) == float(wanted.get("target_amount") or 0)
        except (TypeError, ValueError):
            same_amount = False
        if same_amount and norm(d.get("purpose")) == norm(wanted.get("purpose")) and norm(d.get("audience")) == norm(wanted.get("audience")):
            return row
    return None


def _choice_field(existing: list[dict], noun: str, a: dict) -> dict:
    """Update the one that is there, or start another: one question, with what would change said on the option."""
    options = []
    plan = noun.replace("funding case", "funding plan")
    if len(existing) == 1 and noun.endswith("case"):
        data, row = existing[0].get("data") or {}, existing[0]
        had, now_ = data.get("target_amount"), a.get("amount")
        try:
            had_s = _shown({"type": "number", "prefix": "£"}, float(had)) if had not in (None, "") else ""
        except (TypeError, ValueError):
            had_s = ""
        when = ""
        if row.get("created_at"):
            stamp = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
            when = f"{stamp.day} {stamp.strftime('%b')}"
        to = f" to {_shown({'type': 'number', 'prefix': '£'}, now_)}" if isinstance(now_, (int, float)) else ""
        label = f"You already have a {had_s + ' ' if had_s else ''}{plan}{' from ' + when if when else ''}. Update it{to} or start a new one?"
        return _f("subject_choice", label, "choice", required=True,
                  options=[{"value": row["id"], "label": f"Update it{to}"}, {"value": NEW, "label": "Start a new one"}])
    for row in existing:
        data = row.get("data") or {}
        name = data.get("title") or data.get("name") or noun.capitalize()
        had, now_ = data.get("target_amount"), a.get("amount")
        change = (f" (amount {_shown({'type': 'number', 'prefix': '£'}, float(had))} → {_shown({'type': 'number', 'prefix': '£'}, now_)})"
                  if isinstance(now_, (int, float)) and isinstance(had, (int, float)) and float(had) != float(now_) else "")
        options.append({"value": row["id"], "label": f"Update {name}{change}"})
    options.append({"value": NEW, "label": "Start a new funding plan" if noun.endswith("case") else "Start a new launch plan"})
    several = len(existing) > 1
    field = _f("subject_choice", f"You already have {'funding plans' if noun.endswith('case') and several else 'launch plans' if several else 'a ' + plan}. "
                                 f"Update {'one' if several else 'it'} or start a new one?", "choice", required=True, options=options)
    if not noun.endswith("case"):
        # Several launches are allowed (the owner's QA, 15 Oct): a different offering from every plan there starts a new one
        # by default ("car wash" is not "QA Launch UK SMB plan"); the same offering defaults to updating it.
        said = _words(a.get("sell"))
        same = next((row for row in existing if said and said & _words((row.get("data") or {}).get("name"))), None)
        field["default"] = same["id"] if same else NEW
    return field


def _words(text: Any) -> set[str]:
    """The words that name an offering, without the small ones ("car wash subscription": car, wash, subscription)."""
    small = {"a", "an", "the", "my", "our", "for", "in", "of", "and", "to", "new", "plan", "launch", "service", "product", "round", "qa"}
    return {w for w in re.findall(r"[a-z]{3,}", str(text or "").lower()) if w not in small}


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


async def prepare(store: SessionStore, session: dict, orch, user_id: str, email: str | None = None, clock=None, confirmed: bool = False) -> dict:
    """Start the work with what already does it: the Agent's own request, or the Funding or
    Launch Readiness module. Their permissions, credits and approvals apply unchanged."""
    from app.modules.agent.models import AgentRequest
    now = _now(clock)
    if session.get("user_id") != user_id or not session.get("business_id"):
        raise PermissionError("Sign in and resume this task first.")
    if session.get("handoff") and (session["handoff"].get("run_id") or session["handoff"].get("subject_id")):
        return session      # already prepared: the same task, never a second one
    if session.get("goal_key") in FREE_CHECKS:
        # R-1 (the owner, 24 Oct: three identical runs, 2 credits each): the risk check is a free calculation on the records,
        # shown as its result. No background task, no charge, no history row; the answers are kept for the next check.
        if (session.get("handoff") or {}).get("free"):
            return session      # R-8: already handed over: the same answer at once, never a second wait
        try:
            await orch.rt.business.mutate(session["business_id"], lambda d: _keep_answers(d, session, now))
        except Exception:      # noqa: BLE001 - R-8: the result is shown either way; they are kept again on the next answer
            logger.warning("risk check: answers not kept on hand-off for %s", session["id"][:8], exc_info=True)
        session["handoff"] = {"to": FREE_CHECKS[session["goal_key"]], "capability": (session.get("resolution") or {}).get("start_capability"), "free": True}
        session["state"] = HANDED_OFF
        session["updated_at"] = now.isoformat()
        await store.put(session)
        return session
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
            current = None
            wanted: dict = {}
            if kind == rules.FUNDING:
                # A business has one funding case, kept current: a funding chat updates it or replaces its need, never a second
                # case beside it (an archived one is reactivated first).
                biz = await orch.rt.business.load(session["business_id"]) or {}
                from app.modules.agent import credibility
                profile = biz.get("workspace_profile") or {}
                where = a.get("where") or profile.get("city") or ""
                country = (credibility.country_of(where) or credibility.country_of(profile.get("country")) or "").title() or None
                # The currency the owner typed ("£250,000") wins over the workspace's own; the workspace's only when none was said.
                money = case_currency(session, biz)
                wanted = case_fields(a, currency=money if money in rules.SUPPORTED_CURRENCIES else None, where=a.get("where"), country=country, today=now.date())
                every = sorted((r for r in await svc.store.list("subjects", session["business_id"], kind=kind, limit=50) if r.get("status") != "cancelled"),
                               key=lambda r: str(r.get("created_at") or ""), reverse=True)
                every = sorted(every, key=lambda r: r.get("status") == "archived")
                if every:
                    current = await svc.store.get("subjects", every[0]["id"]) or every[0]
                    if not choice:
                        diff = case_diff(current.get("data") or {}, wanted)
                        if any(d["core"] for d in diff):
                            # A different need (the amount, the route or what it is for): asked, a new case by default, never
                            # the existing one overwritten without the owner's choice (G2, 23 Oct: "I need funding" turned the
                            # £100k grant case into a £50k loan under the same id)
                            data_now = current.get("data") or {}
                            title = str(data_now.get("title") or "your funding case").strip()
                            # One funding case per business (the owner, 23 Oct): replaced by the latest need (the old one kept
                            # in History), or only its changed details updated; asked, never done unasked
                            session["choose"] = _f("subject_choice", f"You already have “{title}”. Replace it with this need, or update its details?", "choice",
                                                   required=True, options=[{"value": f"replace:{current['id']}", "label": "Replace it with this need (the current one is kept in History)"},
                                                                           {"value": f"update:{current['id']}", "label": "Update only the changed details"}])
                            session["choose"]["default"] = f"replace:{current['id']}"
                            session["case_changes"] = plain_changes(diff, data_now, wanted, session)
                            session["state"] = COLLECTING_REQUIRED
                            session["updated_at"] = now.isoformat()
                            await store.put(session)
                            return session
                        # The same need: what is new is added to the case, nothing it holds is replaced
                        choice = f"update:{current['id']}"
                        session["case_changes"] = plain_changes(diff, current.get("data") or {}, wanted, session)
            if not choice:
                existing = await _open_subjects(svc, session["business_id"], kind)
                if existing:
                    session["choose"] = _choice_field(existing, noun, a)
                    session["state"] = COLLECTING_REQUIRED
                    session["updated_at"] = now.isoformat()
                    await store.put(session)
                    return session
                choice = NEW
            clocked = time.perf_counter()
            with read_cache():      # the module reads the same business several times over: once is enough
                if kind == rules.FUNDING:
                    # Every answer in its own field (amount, currency, purpose, timing, route, stage, traction, market), each
                    # with where it came from.
                    payload = {**wanted, "pinned": True}
                    stamp = f"From your funding chat, {now.day} {now.strftime('%b')}"
                    chat_prov = {p: stamp for p in ("target_amount", "currency", "purpose", "receipt_date", "route_preference", "stage", "traction.summary",
                                                     "traction.customers", "traction.monthly_revenue", "market.location", "jurisdiction") if _get(wanted, p) not in (None, "")}
                    title, told = need_title(wanted), _told(a)
                else:
                    # Every answer in its own field, a date chip as a real date ("In 1 to 3 months": the end of the third
                    # month; "Not decided yet": no date), never the chip's words, which the plan refuses as a date.
                    payload = {**launch_fields(a, now.date()), "pinned": True}
                    title, told = launch_title(a), f'"{str(a.get("sell")).strip()}"' if a.get("sell") else ""
                name_field = "title" if kind == rules.FUNDING else "name"
                twin = None
                if choice == NEW:
                    twin = _same_subject(await _open_subjects(svc, session["business_id"], kind), {**payload, name_field: title}, name_field)
                if choice == NEW and twin:
                    made, did = twin, f'I found "{(twin.get("data") or {}).get(name_field) or noun}" already set up with these details'
                elif choice == NEW:
                    made = await svc.create_subject(user_id, session["business_id"], kind, {**payload, name_field: title}, email,
                                                    provenance=chat_prov if kind == rules.FUNDING else None)
                    did = f"I set up your {noun.replace('funding case', 'funding plan')} from what you told me"
                elif kind == rules.FUNDING and str(choice).partition(":")[0] in ("replace", "update", "cancel"):
                    how, _, sid = str(choice).partition(":")
                    row = await svc.store.get("subjects", sid)
                    if not row or row.get("business_id") != session["business_id"] or row.get("kind") != kind:
                        raise PermissionError("That is not one of this workspace's records.")
                    if how in ("replace", "update") and row.get("status") == "archived":      # updated: back in use first
                        await svc.set_status(user_id, session["business_id"], kind, sid, "reactivate", email)
                        row = await svc.store.get("subjects", sid) or row
                    before = row.get("data") or {}
                    # The spending lines follow the new request (the owner, 26 Oct): scaled to a new amount, or one line for a new purpose
                    lines = svc.lines_for_request(before, payload) if how in ("replace", "update") else None
                    if lines:
                        chat_prov = {**chat_prov, "use_of_funds": stamp}
                    if how == "replace":
                        made = await svc.replace_need(user_id, session["business_id"], sid, {**payload, "title": title, **({"use_of_funds": lines} if lines else {})},
                                                      email, provenance=chat_prov, summary=need_summary(before))
                        did = f'I replaced "{before.get("title") or "your funding case"}" with this funding need. The previous version is in History'
                    elif how == "update":
                        changed = {d["path"].split(".")[0] for d in case_diff(before, wanted)}
                        only = {k: v for k, v in payload.items() if k in changed}
                        if lines and {"target_amount", "purpose"} & changed:
                            only["use_of_funds"] = lines
                        made = (await svc.update_subject(user_id, session["business_id"], kind, sid, row["revision"], only, email, provenance=chat_prov)
                                if only else row)
                        did = (f'I updated "{before.get("title") or noun}": {diff_line(case_diff(before, wanted), before, wanted)}' if only
                               else f'"{before.get("title") or noun}" already has these details')
                    else:
                        made, did = row, f'I left "{before.get("title") or noun}" as it was'
                    told = ""
                else:
                    row = await svc.store.get("subjects", choice)
                    if not row or row.get("business_id") != session["business_id"] or row.get("kind") != kind:
                        raise PermissionError("That is not one of this workspace's records.")
                    made = await svc.update_subject(user_id, session["business_id"], kind, choice, row["revision"], payload, email)
                    did = f'I updated "{(row.get("data") or {}).get(name_field) or noun}" with what you told me'
                created_s = time.perf_counter() - clocked
                # The case remembers the chat that set it up, so its page shows the very result the chat ended on (one record,
                # the same score, count, coverage and steps; the owner's QA, 20 Oct).
                sid_made = made["id"]
                await orch.rt.business.mutate(session["business_id"], lambda d: d.setdefault("chat_sessions", {}).__setitem__(str(sid_made), session["id"]))
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
            # What was said for this goal is about this task, not yet about the company: it is kept as a proposal,
            # with where it came from, and goes on the profile only when the owner confirms it (PRD 6.1, QA R1).
            facts = {"about_company": a.get("description") or a.get("sell"), "target_customer": a.get("customer") if session.get("goal_key") not in
                     ("create_invoice", "create_quotation", "prepare_proposal") else None, "problem": a.get("problem")}
            if any(facts.values()):
                from app.modules.agent import profile_proposals
                source = {"kind": "goal", "goal_key": session.get("goal_key"), "goal_label": session.get("goal_label"), "session_id": session["id"],
                          "offering": str(a.get("sell") or a.get("description") or "")[:200]}      # QA PF5: which offering it was said about
                await orch.rt.business.mutate(session["business_id"], lambda d: profile_proposals.propose(d, facts, source, now))
            if isinstance(a.get("vat_rate"), (int, float)):
                try:
                    policy = await orch.rt.store.get_policy(session["business_id"]) or {}
                    if policy.get("default_vat_rate") is None:
                        await orch.rt.store.set_policy(session["business_id"], {"default_vat_rate": float(a["vat_rate"])}, user_id)
                except Exception:      # noqa: BLE001 - the draft carries the rate either way
                    logger.info("goal onboarding: the VAT default was not saved for %s", session["business_id"])
            # The first essential task on a new account is free (PRD s13): the workspace made for this
            # goal is marked, once, and the Agent waives the charge for the one task started from it.
            if config.FIRST_TASK_FREE and session.get("new_workspace") and capability in config.FREE_FIRST_TASKS:
                def _free(d: dict) -> None:
                    d.setdefault("onboarding", {}).setdefault("free_first_task", {"reference": f"goal:{session['id']}", "capability": capability, "at": now.isoformat()})
                await orch.rt.business.mutate(session["business_id"], _free)
            out = await orch.submit(AgentRequest(requesting_actor_id=user_id, business_id=session["business_id"], source_channel="text",
                                                 raw_input=_request_text(session), requested_capability=capability, background=True,
                                                 params={**({"prefill": _prefill(session)} if _prefill(session) else {}),
                                                         **({"answers": _answers_for_task(session)} if _answers_for_task(session) else {})},
                                                 source_reference=f"goal:{session['id']}", confirmed=confirmed,
                                                 essential_handoff=True), email=email)
            if out.get("kind") == "needs_confirmation":
                # P0.5c: its price first ("Write your business plan. 40 credits. You have 90."), Start or Not now; nothing started.
                session["state"] = READY
                session["handoff"] = None
                session["confirm"] = {"capability": out.get("capability"), "price": out.get("price"), "balance": out.get("balance"), "message": out.get("message")}
                session["updated_at"] = now.isoformat()
                await store.put(session)
                return session
            session.pop("confirm", None)
            # Only a document is given a moment to be ready (its "ready to review" line); anything else is handed over at once.
            run = await _settled(orch, out.get("run"), seconds=3.0 if session.get("goal_key") in ("create_invoice", "create_quotation") else 0.0)
            if run:
                handoff.update({"to": f"/dashboard?task={run['id']}", "run_id": run["id"]})
                noun = {"create_invoice": "invoice", "create_quotation": "quotation"}.get(session.get("goal_key") or "")
                if noun:      # said on the dashboard when the draft opens for review
                    who = (session.get("inputs") or {}).get("customer")
                    whose = f" for {who}" if who else ""
                    if run.get("status") == "awaiting_approval":
                        later = (run.get("state") or {}).get("email_needed")
                        handoff.update({"ready": True, "ready_message": f"Your {noun}{whose} is ready to review." + (" Add their email to send it." if later else "")})
                    elif run.get("reason_code") == "invalid_customer_destination" or _answers_for_task(session).get("email_later"):
                        # Drafted; held only for the address the owner said they'd add later.
                        handoff.update({"ready": False, "ready_message": f"Your {noun}{whose} is drafted. Add their email and I'll get it ready to send."})
                    else:
                        handoff.update({"ready": False, "ready_message": f"I've started your {noun}{whose}. There's one more thing to answer on your dashboard."})
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
    # P0.4: what this flow learned about the business fills its empty profile fields (never one the owner set).
    try:
        from app.modules.agent import profile_fill
        said = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
        if said and session.get("business_id"):
            # The currency only when the owner said one ("£200", "8 million naira"), never the default.
            stated = said_currency(session)
            await orch.rt.business.mutate(session["business_id"], lambda d: profile_fill.fill(d, said, session.get("goal_key") or "", currency=stated, now=now))
            _brand_later(orch, session["business_id"], user_id)
    except Exception:      # noqa: BLE001 - the task is handed over either way
        logger.info("profile fill skipped for session %s", session["id"][:8], exc_info=True)
    _event(session, "TaskBlocked" if session["state"] == BLOCKED else "FirstOutputPrepared", now, capability=capability)
    session["updated_at"] = now.isoformat()
    await store.put(session)
    if session["state"] != BLOCKED:
        await track(store, "first_output_prepared", session, clock=clock)
    return session
