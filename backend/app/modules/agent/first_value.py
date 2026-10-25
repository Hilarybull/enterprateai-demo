"""The free deterministic first-value result (First-Value PRD v1.0, sections 5 and 7 to 12).

For each of the five covered goals, a bounded check worked out from what the owner has said and
what the Company already has on record. Nothing here calls a model or looks anything up outside
the business: it works with those services switched off, and gives the same answer for the same
inputs. Something not known is shown as not known. It is never guessed, and never counted as met.

The result is the contract in PRD 5.1: assessment_type, basis, ruleset_version, a score or a
check (or "Insufficient evidence"), evidence coverage (kept apart from the score), each
criterion's state, strengths, blockers (failed kept apart from unknown), the premium next action
and the free next actions. The full readiness engines and their weights are not changed by this:
it is a first look, labelled as one.
"""
from __future__ import annotations

import math
import re

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

RULESET_VERSION = "first-value-1.0"
MET, PARTIAL, UNMET, UNKNOWN = "met", "partially_met", "unmet", "unknown"
UNSURE = "unknown"      # what "Not sure" is stored as: an answer, and never a fact

# Which goal gets which assessment.
ASSESSMENT_OF = {"test_idea": "idea_viability_initial", "launch": "launch_readiness_initial", "need_funding": "funding_readiness_initial",
                 "price_offer": "pricing_health_initial", "more_customers": "customer_growth_foundation", "business_risks": "business_risk_initial"}
HEADLINE = {"idea_viability_initial": "Initial Idea Viability", "launch_readiness_initial": "Initial Launch Readiness",
            "funding_readiness_initial": "Funding readiness", "pricing_health_initial": "Pricing Health",
            "customer_growth_foundation": "Customer Growth Foundation", "business_risk_initial": "Business Risk Check"}
# The premium next action, and what it will do (said before any upgrade is asked for: PRD 12.3).
PREMIUM = {
    "idea_viability_initial": ("Validate the weak points", "research competitors and demand, find comparable prices and test the assumptions the score rests on"),
    "launch_readiness_initial": ("Resolve my launch blockers", "research the missing evidence, benchmark your market, test assumptions and help resolve the blockers"),
    "funding_readiness_initial": ("Help me become funding-ready", "research funding routes, structure your use of funds, prepare forecast assumptions and close the gaps a funder will ask about"),
    "pricing_health_initial": ("Find my best price", "research competitor prices and market price bands, and test alternative prices against demand"),
    "customer_growth_foundation": ("Find my best customer opportunities", "research segments, channels and demand signals, and prepare a brief of the best opportunities"),
    "business_risk_initial": ("Plan for my biggest risks", "model a shock to the business and draft what to do about each risk"),
}
FREE_NEXT = {
    "idea_viability_initial": [("Write a business plan", "/business-plan"), ("Add it to your catalogue", "/catalogue")],
    "launch_readiness_initial": [("Add it to your catalogue", "/catalogue"), ("Set up your Marketplace profile", "/marketplace/profile")],
    # Funding-only actions (the brief, 15 Oct): the pack and the case. Customers and invoices on record count as traction in
    # the check by themselves (PRD 9.5) and a missing one is a gap in the pack, never a button here.
    "funding_readiness_initial": [("Prepare my funding pack", "/funding?tab=documents"), ("Open funding case", "/funding?tab=results")],
    "pricing_health_initial": [("Save the price in your catalogue", "/catalogue"), ("Create a quotation", "/operations")],
    "customer_growth_foundation": [("Set up your Marketplace profile", "/marketplace/profile"), ("Create a quotation", "/operations")],
    "business_risk_initial": [],      # each risk card has its own button: never the same links again below them
}


def _known(value: Any) -> bool:
    return value not in (None, "", [], {}) and str(value).strip().lower() != UNSURE


def _num(value: Any) -> float | None:
    if not _known(value):
        return None
    try:
        return float(str(value).replace(",", "").replace("£", "").replace("$", ""))
    except (TypeError, ValueError):
        return None


def _money(value: float, sign: str = "£") -> str:
    return f"{sign}{value:,.2f}".replace(".00", "")


def _company(data: dict | None) -> dict:
    """What the Company already has on record that these checks may use."""
    data = data or {}
    profile = data.get("workspace_profile") or {}
    cat = data.get("catalogue") or {}
    fin = data.get("financials") or {}
    products = [p for p in cat.get("products") or [] if isinstance(p, dict) and p.get("name") and not p.get("archived")]
    invoices = [i for i in fin.get("invoices") or [] if isinstance(i, dict) and str(i.get("status") or "").lower() not in ("draft", "void", "voided", "cancelled")]
    market = data.get("marketplace") or {}
    return {
        "products": products, "priced": [p for p in products if isinstance(p.get("base_price"), (int, float)) and p["base_price"] > 0],
        "costed": [p for p in products if isinstance(p.get("cost_of_sales"), (int, float)) and p["cost_of_sales"] > 0],
        "customers": [c for c in cat.get("customers") or [] if isinstance(c, dict) and c.get("name")], "invoices": invoices,
        "quotes": [q for q in fin.get("quotes") or [] if isinstance(q, dict)
                   and str(q.get("status") or "").lower() in ("sent", "viewed", "accepted", "approved", "converted", "invoiced")],
        "target": str(profile.get("target_customer") or profile.get("target_market") or "").strip(),
        "about": str(profile.get("about_company") or "").strip(), "listed": bool(market.get("is_active")),
        "plan": bool(data.get("business_plan") or data.get("live_plan") or data.get("blueprint")),
        "forecast": bool((data.get("live_plan") or {}).get("forecast") or fin.get("forecast")),
    }


def _result(kind: str, *, criteria: list[dict], score: Any, score_label: str, classification: str | None = None, metrics: list[dict] | None = None,
            basis: list[str] | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    """Assemble the contract from the criteria. Strengths are what is supported; blockers are what failed or is not known, failed first."""
    total = sum(c.get("weight", 1) for c in criteria) or 1
    covered = sum(c.get("weight", 1) for c in criteria if c["state"] != UNKNOWN)
    strengths = [x for c in criteria if c["state"] in (MET, PARTIAL) for x in (c.get("strengths") or [c.get("strength")]) if x][:5]
    failed = [{"key": c["key"], "label": c["gap"], "kind": "failed", "state": UNMET} for c in criteria if c["state"] == UNMET and c.get("gap")]
    # Partly there ("Enquiries") is early evidence, not "not known" (QA R3, PRD 5.1 / 12.2).
    # A criterion can be partly met while what it still lacks is simply not known (the channel, the owner): its own gap_kind says so.
    missing = [{"key": c["key"], "label": c["gap"], "kind": c.get("gap_kind") or ("partial" if c["state"] == PARTIAL else "unknown"), "state": c["state"]}
               for c in sorted(criteria, key=lambda c: -c.get("weight", 1)) if c["state"] in (UNKNOWN, PARTIAL) and c.get("gap")]
    label, does = PREMIUM[kind]
    blockers = failed + missing
    if kind == "launch_readiness_initial" and blockers:
        label = f"Resolve my {len(blockers)} launch blocker{'s' if len(blockers) != 1 else ''}"
    return {
        "assessment_type": kind, "headline": HEADLINE[kind], "ruleset_version": RULESET_VERSION, "provisional": True,
        "basis": basis or ["What you told me", "What is already on record for your business"],
        "score": score, "score_label": score_label, "classification": classification,
        # Never "no score" (the owner's QA, 21 Oct): with too little known for the check's own score, a score from what is
        # known (met counts in full, partly met half), said with how much it is based on. The check's own score is unchanged.
        "partial_score": round(100 * sum(c.get("weight", 1) * (1 if c["state"] == MET else 0.5 if c["state"] == PARTIAL else 0)
                                         for c in criteria) / total) if str(score or "").lower().startswith("insufficient") else None,
        "evidence_coverage": round(100 * covered / total),
        "criteria": [{"key": c["key"], "label": c["label"], "state": c["state"], **({"weight": c["weight"]} if "weight" in c else {})} for c in criteria],
        "strengths": strengths, "blockers": blockers, "metrics": metrics or [],
        "premium_next_action": {"label": label, "explains": f"I can now {does}.", "capability": kind.replace("_initial", "").replace("_foundation", "") + "_intelligence"},
        "free_next_actions": [{"label": a, "to": to} for a, to in FREE_NEXT[kind]] + [{"label": "Save for later", "save": True}],
        "generated_at": (now or datetime.now(timezone.utc)).isoformat(), "currency_sign": sign,
        "ready_at": _ready_at(kind),      # the one "ready" threshold, as the checklist sets it (22 Oct: 75)
    }


def _ready_at(kind: str) -> float:
    from app.modules.readiness import rules
    return rules.ready_at(rules.LAUNCH if kind.startswith("launch") else rules.FUNDING)


# ── The demand ladder (QA PF6, PRD 5.2): what the owner's own words show, highest rung first ──
_LADDER = (
    ("repeat_paying_customers", "Repeat customers", r"\brepeat (customers?|buyers?|orders?|bookings?)\b|\bre-?book(ed|ings?)?\b|\bcame back\b"),
    ("paying_customers", "Paying customers", r"\bpaying (customers?|clients?)\b|\b\d+\s+(customers?|clients?|people|households?)\s+(have\s+)?(paid|bought)\b|\balready (selling|sold)\b|\bsold\s+\d+"),
    ("paid_pilot", "Paid pilot", r"\bpaid[- ](trial|pilot|test)s?\b|\bbooked an? paid\b|\bpaid for (a|the) (trial|pilot)\b|\bpre-?(paid|orders?)\b|\bdeposits?\b"),
    ("LOIs", "Letters of intent", r"\bletters? of intent\b|\bLOIs?\b"),
    ("enquiries", "Early interest", r"\benquir|\binquir|\binterested\b|\bsaid they('?d| would) (pay|buy|book)\b|\bwait ?list\b|\basked (me|about|for)\b|\bwant(ed)? (one|it|to book)\b"),
    ("market_research", "Research", r"\bsurveys?\b|\bresearch\b|\binterviews?\b|\bquestionnaires?\b"),
)
STRONG_DEMAND = ("paid_pilot", "paying_customers", "repeat_paying_customers")


def demand_level(text: Any) -> tuple[str, str] | None:
    """Which rung of the demand ladder the owner's evidence is on ("5 neighbours booked a paid trial clean": a paid
    pilot), or None when it says nothing that can be placed. Read from their words only, never assumed."""
    if not _known(text):
        return None
    said = str(text)
    for key, label, pattern in _LADDER:
        if re.search(pattern, said, re.I):
            return key, label
    return None


def _quoted(text: Any, limit: int = 90) -> str:
    said = " ".join(str(text).split())
    return said if len(said) <= limit else said[: limit - 1].rstrip() + "…"


# ── Adopted research (QA PF3, PRD 13): evidence the owner accepted, never a fact ──
RESEARCHED, ESTIMATED = "researched", "estimated"


CONFIRMED, SKIPPED = "confirmed", "skipped"


def _with_research(criteria: list[dict], a: dict) -> list[dict]:
    """What the owner adopted from a premium run, criterion by criterion (QA PF3, R7-2):
      - researched or estimated evidence: a criterion not known yet is partly met (evidence, still not confirmed);
        never met, whatever the research says (it is not the business's own fact);
      - a private fact the owner confirmed (their cash, a named owner, a test run): met, or not met when the figures
        they gave say so (`met: False`, a capacity below the planned volume);
      - skipped: still not known, and said to be skipped. Weights are unchanged.
    `a["research"]`: {criterion key: {"value", "state", "label"?, "met"?}}."""
    adopted = a.get("research") if isinstance(a.get("research"), dict) else {}
    for c in criteria:
        got = adopted.get(c["key"])
        if not got:
            continue
        state = got.get("state")
        if state == SKIPPED:
            if c["state"] == UNKNOWN:
                c["gap"] = f"{c['gap']} (you skipped this)" if c.get("gap") else "Not known yet (you skipped this)"
            continue
        if not _known(got.get("value")):
            continue
        if state == CONFIRMED and c["state"] in (UNKNOWN, PARTIAL):
            ok = got.get("met") is not False
            c["state"] = MET if ok else UNMET
            c["strengths"] = [f"Confirmed by you: {got.get('label') or c['label']}"] if ok else []
            c["gap"] = None if ok else (got.get("gap") or c.get("gap"))
            c["research"] = {"state": state, "value": got.get("value")}
        elif state in (RESEARCHED, ESTIMATED) and c["state"] == UNKNOWN:
            word = "Researched" if state == RESEARCHED else "Estimated"
            c["state"] = PARTIAL
            c["strengths"] = [f"{word}, not yet confirmed: {got.get('label') or c['label']}"]
            c["gap_kind"] = "partial"
            c["gap"] = f"{c['gap']} (to confirm)" if c.get("gap") else None
            c["research"] = {"state": state, "value": got.get("value")}
    return criteria


_RANK = {UNKNOWN: 0, UNMET: 0, PARTIAL: 1, MET: 2}
_NOT_SAID = re.compile(r"\b(?:no|not|none)\b[^.]{0,80}\b(?:described|provided|given|stated|available|known|specified|found)\b"
                       r"|^\s*(?:pending(?: approval)?|tbc|tbd|to be confirmed|n/?a|todo|\?+|-+)\s*\.?\s*$", re.I)


def _said(v: Any) -> bool:
    """A real answer: not blank, and not a placeholder or a non-answer ("Pending approval", "None are described")."""
    return _known(v) and not _NOT_SAID.search(str(v))


def case_states(case: dict, has_forecast: bool = False) -> dict[str, str]:
    """What the funding case itself now shows, criterion by criterion (F-3, 22 Oct): its goal, lines, forecast, prices,
    market and team, so a result never asks for what the case already holds."""
    c = case or {}
    g = lambda path: _get_path(c, path)      # noqa: E731
    target = _num(c.get("target_amount"))
    lines = [a for a in c.get("use_of_funds") or [] if isinstance(a, dict)]
    total = sum(_num(a.get("amount")) or 0 for a in lines)
    people = [p for p in g("team.responsibilities") or [] if isinstance(p, dict)]
    market = [g(p) for p in ("market.target_segment", "market.differentiation", "market.acquisition_approach")]
    econ = [g(p) for p in ("economics.price", "economics.direct_cost", "economics.fixed_costs_monthly")]
    out = {
        "purpose": MET if target and _said(c.get("purpose")) and _known(c.get("receipt_date")) else PARTIAL if target or _said(c.get("purpose")) else UNKNOWN,
        "use_of_funds": MET if lines and target and abs(total - target) < 1 and all(_num(a.get("amount")) for a in lines) else PARTIAL if lines else UNKNOWN,
        "financial": MET if has_forecast else UNKNOWN,
        "economics": MET if all(_num(x) is not None for x in econ) else PARTIAL if _num(econ[0]) is not None else UNKNOWN,
        "market": MET if all(_said(x) for x in market) else PARTIAL if any(_said(x) for x in market) else UNKNOWN,
        "team": MET if people and all(_said(p.get("owner")) for p in people) else PARTIAL if people else UNKNOWN,
    }
    return out


def _get_path(d: dict, path: str) -> Any:
    for part in path.split("."):
        d = d.get(part) if isinstance(d, dict) else None
    return d


def with_case(result: dict, case: dict | None, has_forecast: bool = False) -> dict:
    """A funding result brought up to the case as it is now: a criterion the case shows as further on is moved on, and its
    step goes (F-3, 22 Oct). Never moved back: what the result already counts stays counted."""
    if not case or (result or {}).get("assessment_type") != "funding_readiness_initial":
        return result
    states = case_states(case, has_forecast)
    crit = [dict(c) for c in result.get("criteria") or []]
    moved = set()
    for c in crit:
        now = states.get(c["key"])
        if now and _RANK.get(now, 0) > _RANK.get(c.get("state"), 0):
            c["state"] = now
            moved.add(c["key"])
    if not moved:
        return result
    blockers = [b for b in result.get("blockers") or [] if not (b.get("key") in moved and states.get(b["key"]) == MET)]
    blockers = [({**b, "kind": "partial", "state": PARTIAL} if b.get("key") in moved else b) for b in blockers]
    total = sum(c.get("weight", 1) for c in crit) or 1
    covered = sum(c.get("weight", 1) for c in crit if c["state"] != UNKNOWN)
    out = {**result, "criteria": crit, "blockers": blockers, "evidence_coverage": round(100 * covered / total)}
    if isinstance(result.get("score"), (int, float)):
        out["score"] = _weighted([{**c, "weight": c.get("weight", 1)} for c in crit])
    return out


def _weighted(criteria: list[dict]) -> int:
    return round(sum(c["weight"] * {MET: 1.0, PARTIAL: 0.5}.get(c["state"], 0.0) for c in criteria))


# ── Funding (PRD 9.2): the eight criteria and their weights ──────────────────

def funding(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    co = _company(data)
    amount, use, timing, traction, stage = _num(a.get("amount")), a.get("use"), a.get("timing"), a.get("traction"), a.get("stage")
    no_traction = _known(traction) and str(traction).strip().lower() in ("none", "no", "no traction yet", "nothing yet", "not yet")
    # What the owner says about this need wins over older records (the owner's QA, 15 Oct): "Not trading yet" or "No traction
    # yet" means invoices already on the workspace are not shown as this need's traction.
    said_none = no_traction or str(stage or "").strip().lower() in ("pre_revenue", "idea")
    evidence = bool(co["invoices"] or co["customers"]) and not said_none
    crit = [
        {"key": "purpose", "label": "Funding purpose", "weight": 10,
         "state": MET if amount and _known(use) and _known(timing) else PARTIAL if _known(use) or amount else UNKNOWN,
         "strength": "Funding purpose defined" if _known(use) else "Target amount stated",
         "gap": None if amount and _known(use) and _known(timing) else "Amount not settled" if not amount else "No date for when the funding is needed" if not _known(timing) else "What the money is for is not stated"},
        {"key": "use_of_funds", "label": "Use of funds", "weight": 15, "state": PARTIAL if _known(use) and amount else UNKNOWN,
         "strength": None, "gap": "Use of funds not broken down into amounts"},
        {"key": "financial", "label": "Financial preparation", "weight": 20, "state": MET if co["forecast"] else UNKNOWN,
         "strength": "A forecast is on record", "gap": "No monthly forecast yet"},
        {"key": "demand", "label": "Demand evidence", "weight": 15,
         "state": MET if evidence and _known(traction) and not no_traction else PARTIAL if evidence or (_known(traction) and not no_traction) else UNMET if no_traction else UNKNOWN,
         # What the records show and what the owner said are named as such, so one never contradicts the other.
         "strength": f"{demand_level(traction)[1]}: {_quoted(traction)}" if demand_level(traction) and not no_traction
         else "Customers and invoices on record" if evidence else None,
         "gap": "No traction yet" if no_traction else "Traction evidence incomplete"},
        # Records of prices and the target market count only as what the workspace has on record, said so ("From your records").
        {"key": "economics", "label": "Business economics", "weight": 10, "state": MET if co["priced"] and co["costed"] else PARTIAL if co["priced"] else UNKNOWN,
         "strength": "From your records: prices are in your catalogue", "gap": "Prices and costs not on record" if not co["priced"] else "Costs not on record"},
        {"key": "market", "label": "Market and growth plan", "weight": 10, "state": PARTIAL if co["target"] or co["about"] else UNKNOWN,
         "strength": "From your records: target customers described", "gap": "Target customers and how you will reach them not set out"},
        {"key": "team", "label": "Team and delivery", "weight": 10, "state": UNKNOWN, "strength": None, "gap": "Who will deliver the plan is not recorded"},
        {"key": "materials", "label": "Materials and risks", "weight": 10, "state": PARTIAL if co["plan"] else UNKNOWN,
         "strength": "A business plan is started", "gap": "Investor materials incomplete" if co["plan"] else "No business plan or funding materials yet"},
    ]
    if _known(stage):
        crit[0]["strength"] = crit[0]["strength"] if crit[0]["state"] != UNKNOWN else None
    crit = _with_research(crit, a)
    out = _result("funding_readiness_initial", criteria=crit, score=_weighted(crit), score_label="out of 100", now=now, sign=sign)
    if _known(stage) and len(out["strengths"]) < 4:
        out["strengths"].append("Business stage clear")
    out["note"] = "This is a look at how prepared you are. It is not a view on whether funding will be given."
    return out


# ── Launch (PRD 8.2) ─────────────────────────────────────────────────────────

def offer_criterion(sell: Any, a: dict, co: dict, sign: str) -> dict:
    """Offer and pricing (PRD 8.2): the launch scope with its known price, cost and margin, from the chat ("I'll charge
    15000 naira a month and it costs me 6000") or the catalogue. A price that does not cover its cost is a blocker; a price
    without a cost is partly there; nothing said is unknown, never passed."""
    price, cost = _num(a.get("price")), _num(a.get("cost"))
    per = f" a {a['price_per']}" if a.get("price_per") else ""
    c = {"key": "offer", "label": "Offer and pricing", "weight": 15}
    if price and cost is not None:
        margin = price - cost
        if margin <= 0:
            return {**c, "state": UNMET, "strength": None, "gap": f"The price ({_money(price, sign)}) does not cover the cost ({_money(cost, sign)})"}
        return {**c, "state": MET if _known(sell) else PARTIAL,
                "strengths": [f"Price {_money(price, sign)}{per}, cost {_money(cost, sign)}: {_money(margin, sign)} margin ({round(100 * margin / price)}%)"],
                "gap": "What is being launched is not stated"}
    if price:
        return {**c, "state": PARTIAL, "strengths": [f"Price {_money(price, sign)}{per}"], "gap": "Cost per sale not known"}
    return {**c, "state": MET if _known(sell) and co["priced"] and co["costed"] else PARTIAL if _known(sell) else UNKNOWN,
            "strength": "Offer is defined", "gap": "Pricing economics incomplete"}


def launch(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    co = _company(data)
    sell, customer, where, when, evidence = a.get("sell"), a.get("customer"), a.get("where"), a.get("target_date"), a.get("evidence")
    none_yet = _known(evidence) and str(evidence).strip().lower() in ("none", "no", "nothing yet", "not yet", "none yet")
    level = None if none_yet else demand_level(evidence)
    said = _known(evidence) and not none_yet
    crit = [
        {"key": "demand", "label": "Customer and demand", "weight": 15,
         "state": MET if _known(customer) and said else PARTIAL if _known(customer) or said else UNKNOWN,
         # QA PF6: the evidence itself, in the owner's words, on its rung of the demand ladder ("Paid pilot: ...").
         "strengths": [x for x in ("Target customer identified" if _known(customer) else None,
                                   f"{level[1]}: {_quoted(evidence)}" if level else f"Demand evidence: {_quoted(evidence)}" if said else None) if x],
         "gap": "Demand not validated" if _known(customer) or not said else "Who it is for is not stated"},
        offer_criterion(sell, a, co, sign),
        {"key": "cash", "label": "Cash preparation", "weight": 20, "state": MET if co["forecast"] else UNKNOWN, "strength": "A forecast is on record", "gap": "Cash needed for the launch is not worked out"},
        {"key": "delivery", "label": "Delivery capability", "weight": 15, "state": UNKNOWN, "strength": None, "gap": "Delivery capacity unknown"},
        {"key": "process", "label": "Operational process", "weight": 10, "state": PARTIAL if co["quotes"] or co["invoices"] else UNKNOWN,
         "strength": "You already quote or invoice through EnterprateAI", "gap": "Order to delivery to payment not tested end to end"},
        {"key": "prerequisites", "label": "Applicable prerequisites", "weight": 10, "state": UNKNOWN, "strength": None, "gap": "Licences, registrations or other prerequisites not checked"},
        {"key": "route", "label": "Route to market", "weight": 10, "state": PARTIAL if _known(where) or co["listed"] else UNKNOWN,
         "strength": "Launch market selected", "gap": "Launch channel not defined", "gap_kind": UNKNOWN},
        {"key": "control", "label": "Launch control", "weight": 5, "state": PARTIAL if _known(when) else UNKNOWN,
         "strength": f"Launch timing set: {str(when).strip()}" if _known(when) else "Launch date set",
         "gap": "No launch owner yet" if _known(when) else "No launch date or owner yet", "gap_kind": UNKNOWN},
    ]
    crit = _with_research(crit, a)
    return _result("launch_readiness_initial", criteria=crit, score=_weighted(crit), score_label="out of 100", now=now, sign=sign)


# ── Idea viability (PRD 7.3): the existing Viability Engine, when its inputs are there ──

_DEMAND = {"assumption": "assumption_only", "research": "market_research", "enquiries": "enquiries", "lois": "LOIs", "pilot": "paid_pilot",
           "paying": "paying_customers", "repeat": "repeat_paying_customers"}


def idea(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    price, sales, cost, fixed, capacity = (_num(a.get(k)) for k in ("price", "monthly_sales", "cost", "fixed_costs", "capacity"))
    demand = _DEMAND.get(str(a.get("demand") or "").lower())
    enough = None not in (price, sales, cost) and price > 0 and sales > 0
    metrics, scores, outcome = [], {}, None
    if enough:
        from app.modules.service_ideas.service import evaluate_service_idea      # the one viability score there is (SIF-12)
        run = evaluate_service_idea(SimpleNamespace(
            service_name=str(a.get("description") or "Idea")[:120], price_per_sale=price, expected_sales_per_month=sales,
            direct_labour_cost_per_sale=0, contractor_cost_per_sale=0, materials_cost_per_sale=0, travel_cost_per_sale=0, other_direct_cost_per_sale=0,
            assumed_cost_per_unit=cost, monthly_software_cost=0, monthly_marketing_cost=0, monthly_admin_cost=0, monthly_rent_cost=0, monthly_other_fixed_cost=fixed or 0,
            hours_required_per_sale=0, available_delivery_hours_per_month=0, required_capacity=capacity or 0,
            demand_evidence_type=demand or "assumption_only", number_of_paying_customers=0, number_of_interested_leads=0,
            target_market_scope="", target_customer_type="", country=""))
        m, scores, outcome = run["metrics"], run["scores"], run["outcome"]
        metrics = [{"label": "Monthly revenue", "value": _money(m["monthly_revenue"], sign)}, {"label": "Contribution per sale", "value": _money(m["contribution_per_sale"], sign)},
                   {"label": "Margin", "value": f"{round(m['contribution_margin'] * 100)}%"}]
        if m["break_even_sales"] is not None and fixed:
            whole = math.ceil(round(float(m["break_even_sales"]), 6))      # a part sale is one more sale (QA R2)
            metrics.append({"label": "Break-even", "value": f"{whole} sale{'s' if whole != 1 else ''} a month", "raw": m["break_even_sales"]})
        if capacity:
            metrics.append({"label": "Capacity used", "value": f"{round(m['capacity_utilisation'] * 100)}%"})
    margin_ok = enough and scores.get("margin_score", 0) >= 75
    crit = [
        {"key": "idea", "label": "The idea", "state": MET if _known(a.get("description")) else UNKNOWN, "strength": None, "gap": "The idea is not described"},
        {"key": "customer", "label": "Who it is for", "state": MET if _known(a.get("customer")) else UNKNOWN, "strength": "Target customer identified", "gap": "Who it is for is not stated"},
        {"key": "margin", "label": "Margin", "state": (MET if margin_ok else UNMET) if enough else UNKNOWN,
         "strength": "Workable margin", "gap": "Margin is thin at this price and cost" if enough else "Price, cost or expected sales not known"},
        {"key": "break_even", "label": "Break-even", "state": (MET if scores.get("break_even_score", 0) >= 75 else UNMET) if enough and fixed is not None else UNKNOWN,
         "strength": "Break-even is within reach", "gap": "Break-even is slow or out of reach" if enough and fixed is not None else "New monthly fixed costs not known"},
        {"key": "capacity", "label": "Capacity", "state": (MET if scores.get("capacity_score", 0) >= 60 else UNMET) if enough and capacity else UNKNOWN,
         "strength": "Delivery capacity appears feasible", "gap": "Expected sales are above what you can deliver" if enough and capacity else "Delivery capacity not known"},
        {"key": "demand", "label": "Demand evidence", "state": (MET if demand in ("paying_customers", "repeat_paying_customers", "paid_pilot") else PARTIAL if demand in ("enquiries", "LOIs") else UNMET) if demand else UNKNOWN,
         "strength": "Demand is evidenced by real customers" if demand in ("paying_customers", "repeat_paying_customers", "paid_pilot") else "Some interest already shown",
         "gap": "Demand is largely unproven" if demand in (None, "assumption_only", "market_research") else "Demand evidence is early"},
        {"key": "competitors", "label": "Competitor pricing", "state": UNKNOWN, "strength": None, "gap": "Competitor pricing is unknown"},
    ]
    full = enough and fixed is not None and capacity and demand
    crit = _with_research(crit, a)
    out = _result("idea_viability_initial", criteria=crit, score=round(scores["viability_score"]) if full else "Insufficient evidence",
                  score_label="out of 100" if full else "", classification=outcome if full else None, metrics=metrics, now=now, sign=sign)
    return out


# ── Pricing health (PRD 10.2): the owner's own numbers, not a market price ───

def pricing(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    price, cost, sales = _num(a.get("price")), _num(a.get("cost")), _num(a.get("monthly_sales"))
    metrics, margin = [], None
    if price and cost is not None:
        contribution = price - cost
        margin = contribution / price if price else 0
        metrics = [{"label": "Proposed price", "value": _money(price, sign)}, {"label": "Cost per sale", "value": _money(cost, sign)},
                   {"label": "Contribution", "value": _money(contribution, sign)}, {"label": "Margin", "value": f"{round(margin * 100)}%"}]
        if sales:
            metrics.append({"label": f"At {sales:g} sales a month", "value": f"{_money(contribution * sales, sign)} contribution before fixed costs"})
    health = None if margin is None else "Strong" if margin > 0.5 else "Healthy" if margin >= 0.3 else "Thin" if margin >= 0.15 else "Weak" if margin > 0 else "Loss-making"
    crit = [
        {"key": "offer", "label": "What is priced", "state": MET if _known(a.get("sell")) else UNKNOWN, "strength": None, "gap": "What is being priced is not stated"},
        {"key": "margin", "label": "Margin", "state": UNKNOWN if margin is None else MET if margin >= 0.3 else UNMET,
         "strength": f"{health} margin at this price" if health else None, "gap": "Price or cost per sale not known" if margin is None else "Margin is too thin at this price"},
        {"key": "volume", "label": "Monthly volume", "state": MET if sales else UNKNOWN, "strength": "Monthly volume estimated", "gap": "Expected monthly sales not known"},
        {"key": "comparables", "label": "Comparable prices", "state": UNKNOWN, "strength": None, "gap": "Comparable prices are not known"},
        {"key": "sensitivity", "label": "Customer price sensitivity", "state": UNKNOWN, "strength": None, "gap": "How customers react to a different price is not known"},
        {"key": "positioning", "label": "Positioning", "state": MET if _known(a.get("positioning")) else UNKNOWN, "strength": "Positioning chosen", "gap": "Competitor positioning is not known"},
    ]
    crit = _with_research(crit, a)
    out = _result("pricing_health_initial", criteria=crit, score=health or "Insufficient evidence", score_label="", classification=health, metrics=metrics, now=now, sign=sign)
    out["note"] = "This is how the price works on your own numbers. It is not a recommended market price."
    return out


# ── Customer growth (PRD 11.3): nine foundations, a count and never a score ──

def customers(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    co = _company(data)
    sell, ideal, where, channel, charge, goal = (a.get(k) for k in ("sell", "customer", "where", "channel", "price", "goal"))
    no_customers = _known(channel) and "have customers yet" in str(channel).lower()
    has = lambda ok: MET if ok else UNKNOWN      # noqa: E731
    crit = [
        {"key": "offer", "label": "Offer exists", "state": has(_known(sell) or co["products"]), "strength": "Offer defined", "gap": "No offer on record"},
        {"key": "clarity", "label": "Offer clarity", "state": has(len(str(sell or "").split()) >= 3 or len(co["about"].split()) >= 6), "strength": None, "gap": "Offer is not described clearly enough to sell"},
        {"key": "target", "label": "Target customer", "state": has(_known(ideal) and len(str(ideal).split()) >= 2), "strength": "Ideal customer described",
         "gap": "Ideal customer too broad" if _known(ideal) else "Ideal customer not defined"},
        {"key": "price", "label": "Price readiness", "state": has(_known(charge) or co["priced"]), "strength": "Price defined", "gap": "No price or price basis"},
        {"key": "channel", "label": "Acquisition channel", "state": UNMET if no_customers and not _known(where) else has((_known(channel) and not no_customers) or _known(where)),
         "strength": "Where to find customers identified", "gap": "No defined acquisition channel"},
        {"key": "marketplace", "label": "Marketplace visibility", "state": MET if co["listed"] else UNMET, "strength": "Listed on the Marketplace", "gap": "No active Marketplace listing"},
        {"key": "sales_path", "label": "Sales path", "state": MET, "strength": "Quotation path ready", "gap": None},
        {"key": "traction", "label": "Traction evidence", "state": MET if co["customers"] or co["invoices"] else UNMET if no_customers else UNKNOWN,
         "strength": "Customers already on record", "gap": "Limited demand evidence"},
        {"key": "goal", "label": "Growth goal", "state": has(_known(goal)), "strength": "Growth goal set", "gap": "No measurable three-month goal"},
    ]
    crit = _with_research(crit, a)
    in_place = sum(1 for c in crit if c["state"] == MET)
    out = _result("customer_growth_foundation", criteria=crit, score=f"{in_place} of {len(crit)}", score_label="in place", now=now, sign=sign)
    out["note"] = "This checks the foundations for winning customers. It does not promise customers."
    return out


# Sentence starts that are ordinary words, lower-cased after "You asked about ...:" (a customer's name keeps its capital)
_PLAIN_START = {"The", "Over", "One", "No", "Less", "Three", "About", "Your", "It's", "Customers", "Whether"}


def risk_facts(data: dict | None, now: datetime | None = None) -> dict:
    """What the records say about the business's risks, from the one source of figures (agent/figures.py, R-4): the biggest
    customer's share, revenue, costs and cash a month, months of cash, overdue invoices, and the team size."""
    from app.modules.agent import figures
    data = data or {}
    f = figures.of(data, (now or datetime.now(timezone.utc)).date())
    out: dict[str, Any] = {**f, "team": None}
    p = data.get("workspace_profile") or {}
    # The profile form's own field, company_size ("solo", "2-5", ...); a range counts from its smallest size
    for k in ("company_size", "team_size", "employee_count", "staff_count"):
        raw = str(p.get(k) or "").strip().lower().replace("_", "-")
        if not raw:
            continue
        if raw in ("solo", "just me", "1", "me"):
            out["team"] = 1
            break
        m = re.search(r"\d+", raw)
        if m and int(m.group(0)) > 0:
            out["team"] = int(m.group(0))
            break
    return out


def saved_risk_answers(data: dict | None) -> dict[str, dict]:
    """What the owner answered in an earlier risk check (R-2): {question: {"value", "at"}}, reused by every later check."""
    kept = ((data or {}).get("quick_check_answers") or {}).get("business_risks") or {}
    at = str(kept.get("at") or "")[:10]
    return {k: {"value": v, "at": at} for k, v in (kept.get("answers") or {}).items()
            if k in ("key_person", "cash_in_bank", "monthly_costs") and str(v).strip() and str(v).strip().lower() != UNSURE}


def _engines(f: dict, key_person: str) -> dict | None:
    """The authoritative engines on the same figures (Onboarding PRD 6.1): Survival from cash, revenue and costs; Stability
    from the customers and what the owner said about being away; Fragility from both. None while they lack their inputs."""
    if f.get("cash") is None or not f.get("costs_monthly") or f.get("revenue_monthly") is None:
        return None
    try:
        from app.engines import (FragilityEngineInput, StabilityEngineInput, SurvivalEngineInput, run_fragility_engine,
                                 run_stability_engine, run_survival_engine)
        sv = run_survival_engine(SurvivalEngineInput(business_id="risk_check", cash_balance=float(f["cash"]), monthly_revenue=float(f["revenue_monthly"]),
                                                     monthly_expenses=float(f["costs_monthly"]), variable_costs_monthly=0.0, fixed_costs_monthly=float(f["costs_monthly"])))
        st = run_stability_engine(StabilityEngineInput(business_id="risk_check", top1_customer_revenue_pct=f.get("top_share"), customer_count=int(f.get("clients") or 0),
                                                       key_person_dependency=key_person in ("stops", "slows"), has_backup_personnel=key_person == "runs"))
        sc, tc = sv.scores, st.scores
        fr = run_fragility_engine(FragilityEngineInput(business_id="risk_check", survival_cash_health=sc.survival_score if sc else None,
                                                       stability_customer=tc.customer_stability_score if tc else None,
                                                       stability_operational=tc.operational_dependency_score if tc else None,
                                                       top_client_share_pct=f.get("top_share"), client_count=int(f.get("clients") or 1)))
        return {"survival": sc.survival_score if sc else None, "stability": tc.stability_score if tc else None,
                "fragility": fr.scores.fragility_index if fr.scores else None,
                "from": {"runway": "Survival engine", "concentration": "Stability engine", "key_person": "Stability engine", "late_payment": "Your invoices"}}
    except Exception:      # noqa: BLE001 - the risks stand without the engine view
        return None


def _amount_words(v: float, sign: str) -> str:
    return f"{sign}{v:,.2f}".replace(".00", "")


def risks(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    """The free Business Risk Check (Onboarding PRD 6.1): the four common risks, read from the records first (the one source of
    figures), then what the owner said; only real risks are listed as risks, what is fine apart, what isn't on record apart.
    No made-up total (the owner, 24 Oct): the engines' own numbers, under Advanced, once they have their inputs."""
    f = risk_facts(data, now)
    said = lambda k: str(a.get(k) or "").strip().lower()      # noqa: E731
    saved = saved_risk_answers(data)
    shown = known_answers("business_risks", data) if data else {}
    spoke = lambda k: said(k) not in ("", UNSURE) and said(k) != shown.get(k)      # noqa: E731
    crit = []
    # 1. Relying on one customer
    if f["top_share"] is not None and spoke("top_share"):
        state = {"over_50": UNMET, "20_50": PARTIAL, "under_20": MET}.get(said("top_share"), UNKNOWN)
        mine = {"over_50": "more than half", "20_50": "a fifth to a half", "under_20": "less than a fifth"}.get(said("top_share"), said("top_share"))
        crit.append({"key": "concentration", "label": "Relying on one customer", "state": state,
                     "strength": f"You said your biggest customer is {mine} of your income", "gap": f"You said your biggest customer is {mine} of your income",
                     "note": f"Your invoices show {f['top_customer']} at {round(f['top_share'])}%"})
    elif f["top_share"] is not None:
        share = round(f["top_share"])
        state = UNMET if share >= 50 else PARTIAL if share >= 30 else MET
        crit.append({"key": "concentration", "label": "Relying on one customer", "state": state, "customer": f["top_customer"],
                     "strength": f"No customer is more than {share}% of your income", "gap": f"{f['top_customer']} is {share}% of your paid income",
                     "why": "Losing them would take that share of your income with it."})
    else:
        state = {"over_50": UNMET, "20_50": PARTIAL, "under_20": MET}.get(said("top_share"), UNKNOWN)
        crit.append({"key": "concentration", "label": "Relying on one customer", "state": state, "strength": "No single customer is a large share of income",
                     "gap": "Over half your income comes from one customer" if state == UNMET else "One customer is a large share of income"
                     if state == PARTIAL else "I can't see who pays you yet: no paid invoices are recorded"})
    # 2. Cash: worked out from what exists (R-3), what's missing asked for exactly
    cash = _num(a.get("cash_in_bank")) if _num(a.get("cash_in_bank")) is not None else _num((saved.get("cash_in_bank") or {}).get("value"))
    cash_from = "what you told me" if cash is not None else f["sources"].get("cash")
    cash = cash if cash is not None else f["cash"]
    costs = f["costs_monthly"]
    from app.modules.agent.figures import day_words
    said_costs = _num(a.get("monthly_costs")) if _num(a.get("monthly_costs")) is not None else _num((saved.get("monthly_costs") or {}).get("value"))
    if said_costs is not None and said_costs > 0:
        costs, f["sources"]["costs_monthly"] = said_costs, "your usual monthly costs, as you told me"
    # Too thin to judge (the owner, 24 Oct: "2 same-day expenses averaged over 3 months understates spending"): an estimate,
    # and the regular costs asked for before any months of cash are shown
    thin = said_costs is None and f.get("costs_estimate", False)      # the same rule as the dashboard's cash card
    if spoke("runway"):
        state = {"under_3": UNMET, "3_6": PARTIAL, "over_6": MET}.get(said("runway"), UNKNOWN)
        crit.append({"key": "runway", "label": "Cash runway", "state": state, "strength": "Over six months of costs covered by cash",
                     "gap": "Less than three months of costs covered by cash" if state == UNMET else "Three to six months of costs covered by cash"})
    elif cash is not None and thin:
        from app.modules.agent.figures import estimate_basis
        crit.append({"key": "runway", "label": "Cash runway", "state": UNKNOWN, "strength": "", "ask": "monthly_costs",
                     "gap": f"Your cash runway is only an estimate: it's based on {estimate_basis(f)}. Are there regular monthly costs, "
                            "like rent, wages or subscriptions?"})
    elif cash is not None and costs:
        months = round(max(0.0, cash) / costs, 1)
        state = UNMET if months < 3 else PARTIAL if months < 6 else MET
        basis = (f"{_amount_words(cash, sign)} in the bank ({cash_from}); about {_amount_words(costs, sign)} a month spent "
                 f"({f['sources'].get('costs_monthly')}). If you have other costs, add them.")
        crit.append({"key": "runway", "label": "Cash runway", "state": state, "strength": f"About {months:g} months of cash at your recorded spending",
                     "gap": f"About {months:g} months of cash at your recorded spending", "note": basis, "basis": basis})
    elif costs:
        crit.append({"key": "runway", "label": "Cash runway", "state": UNKNOWN, "strength": "",
                     "gap": "I don't know what's in the bank today. Tell me and I'll work out how long your cash lasts.", "ask": "cash_in_bank"})
    else:
        crit.append({"key": "runway", "label": "Cash runway", "state": UNKNOWN, "strength": "",
                     "gap": "I can't tell how long your cash would last because no expenses are recorded. Add last month's expenses and I'll show you."})
    # 3. Late payment
    if f["overdue"] is not None and not spoke("paid_on_time"):
        n = f["overdue"]
        state = MET if n == 0 else PARTIAL if n <= max(1, f["invoices"] // 5) else UNMET
        crit.append({"key": "late_payment", "label": "Late payments", "state": state, "strength": "No invoices overdue",
                     "gap": f"{n} invoice{'s' if n != 1 else ''} overdue", "why": "Late payers tie up the cash you have already earned."})
    else:
        state = {"on_time": MET, "sometimes_late": PARTIAL, "often_late": UNMET}.get(said("paid_on_time"), UNKNOWN)
        crit.append({"key": "late_payment", "label": "Late payments", "state": state, "strength": "Customers pay on time",
                     "gap": "Customers often pay late" if state == UNMET else "Customers sometimes pay late" if state == PARTIAL
                     else "I can't see how customers pay yet: no invoices are recorded"})
    # 4. Cover if you're away: what the owner says (now or before, R-2); a team size never answers it, except "just me"
    kp = said("key_person") if said("key_person") not in ("", UNSURE) else str((saved.get("key_person") or {}).get("value") or "").lower()
    state = {"runs": MET, "slows": PARTIAL, "stops": UNMET}.get(kp, UNKNOWN)
    solo = state == UNKNOWN and f["team"] == 1
    if solo:
        state, kp = UNMET, "stops"
    # Wording follows the answer (R-5: "slows down" never says "could stop")
    crit.append({"key": "key_person", "label": "Cover if you're away for a month", "state": state, "strength": "The business carries on without you",
                 "gap": ("It's just you, so the business stops without you" if solo else "The business stops without you") if state == UNMET
                 else "The business slows down without you" if state == PARTIAL else "What happens when you're away isn't known yet",
                 "why": "A month away could stop the work and the income." if state == UNMET else "A month away would slow the work and the income."
                 if state == PARTIAL else "", "ask": "key_person" if state == UNKNOWN else None})
    out = _result("business_risk_initial", criteria=crit, score=None, score_label="", now=now, sign=sign,
                  basis=["What you told me", "Your invoices, expenses and cash on record"])
    out["partial_score"] = None
    out["premium_next_action"] = None      # free only
    extra = {c["key"]: {k: c[k] for k in ("note", "why", "ask", "basis", "customer") if c.get(k)} for c in crit}      # "customer": the what-if is about them (R-4)
    every = [{**b, **extra.get(b["key"], {})} for b in out["blockers"]]
    # Only what was found to be a risk is a risk; what isn't on record is said apart, with the one thing to add (R-5, R-6)
    out["blockers"] = [b for b in every if b.get("kind") != "unknown"]
    out["not_on_record"] = [{"key": b["key"], "label": b["label"], **({"ask": b["ask"]} if b.get("ask") else {})} for b in every if b.get("kind") == "unknown"]
    # What is fine, with what it rests on when that is thin ("16.7 months" from 2 expenses: said so)
    out["fine"] = [(f"{c['strength']} ({c['basis']})" if c.get("basis") else c["strength"]) for c in crit if c["state"] == MET and c.get("strength")]
    out["checked"] = sum(1 for c in crit if c["state"] != UNKNOWN)
    out["engines"] = _engines({**f, "cash": cash}, kp) if out["checked"] == len(crit) else None      # no number until all four are known
    from app.modules.agent.figures import day_words
    out["provenance"] = {k: f"From you, {day_words(v['at'])}" for k, v in saved.items() if v.get("at")}
    worry = str(a.get("worry") or "").strip()
    from app.modules.agent.goals import risk_answers
    named = next(iter(risk_answers(worry)), None) if worry and worry.lower() != UNSURE else None
    about = {"top_share": "relying on one customer", "runway": "your cash", "paid_on_time": "late payment", "key_person": "the business depending on you"}
    if named:
        crit_key = {"top_share": "concentration", "paid_on_time": "late_payment"}.get(named, named)
        c = next(x for x in crit if x["key"] == crit_key)
        found = c["strength"] if c["state"] == MET else c["gap"]
        verdict = {MET: "That one looks under control", PARTIAL: "That's a real risk", UNMET: "That's your biggest risk right now"}.get(c["state"], "")
        out["focus"] = {"key": crit_key, "text": f"You asked about {about[named]}: {found[:1].lower() + found[1:] if found.split(' ')[0] in _PLAIN_START else found}."
                                               + (f" {verdict}." if verdict else "")}
        out["blockers"] = sorted(out["blockers"], key=lambda b: b.get("key") != crit_key)
    out["note"] = "This looks at four common risks from your records and answers. It is not financial advice."
    return out


_RUN = {"need_funding": funding, "launch": launch, "test_idea": idea, "price_offer": pricing, "more_customers": customers, "business_risks": risks}


def covered(goal_key: str | None) -> bool:
    return goal_key in _RUN


def assess(goal_key: str, answers: dict, data: dict | None = None, *, now: datetime | None = None, sign: str | None = None) -> dict | None:
    """The first-value result for a goal, or None for a goal that has none (a document, say)."""
    run = _RUN.get(goal_key)
    if not run:
        return None
    if sign is None:
        # The workspace's currency (its country's when none is saved), never £ by default for a business elsewhere.
        from app.modules.agent import business as bz
        sign = {"GBP": "£", "NGN": "₦", "USD": "$", "EUR": "€", "GHS": "GH₵", "KES": "KSh "}.get(bz.currency_of(data or {}), "£") if data else "£"
    out = run(dict(answers or {}), data, now, sign)
    if offering_on_record(answers, data, priced_only=_amount((answers or {}).get("price")) is not None) or (
            goal_key == "test_idea" and not idea_of_this_business(answers, data)):
        # Already on record, or an idea that is not this business's (G4, 23 Oct): not offered for its catalogue
        out["free_next_actions"] = [x for x in out["free_next_actions"] if x.get("label") != "Add it to your catalogue"]
    out["free_next_actions"] = [_doable(x, answers or {}, sign) for x in out["free_next_actions"]]
    out.update(at_a_glance(out))
    return out


# ── The result at a glance (PRD 12.2), worked out here once so every surface shows the same: the band, three key numbers
#    and the gaps, failed apart from not known. The dashboard's Agent card shows these; the detail drawer shows the rest. ──
_BAND_WORDS = {"very strong": "Strong", "strong": "Strong", "good": "Strong", "ready": "Strong", "fair": "Fair", "moderate": "Fair",
               "promising": "Fair", "developing": "Fair", "weak": "Weak", "not ready": "Weak", "poor": "Weak", "insufficient evidence": "Insufficient evidence"}


def band_of(result: dict) -> str:
    """Strong, Fair, Weak or Insufficient evidence. Kept apart from evidence coverage (PRD 5.2)."""
    for said in (result.get("classification"), result.get("score_label"), result.get("score") if isinstance(result.get("score"), str) else None):
        word = str(said or "").strip().lower()
        for key, band in _BAND_WORDS.items():
            if key in word:
                return band
    if isinstance(result.get("score"), (int, float)) and not isinstance(result.get("score"), bool):
        n = float(result["score"])
        return "Strong" if n >= 70 else "Fair" if n >= 50 else "Weak"
    m = re.match(r"\s*(\d+)\s+out of\s+100", str(result.get("score") or ""))
    if m:
        n = int(m.group(1))
        return "Strong" if n >= 70 else "Fair" if n >= 50 else "Weak"
    m = re.match(r"\s*(\d+)\s+of\s+(\d+)", str(result.get("score") or ""))
    if m and int(m.group(2)):
        share = int(m.group(1)) / int(m.group(2))
        return "Strong" if share >= 0.75 else "Fair" if share >= 0.5 else "Weak"
    return "Insufficient evidence"


def _metric(result: dict, *labels: str) -> str | None:
    for m in result.get("metrics") or []:
        if any(str(m.get("label") or "").lower().startswith(label.lower()) for label in labels):
            return str(m.get("value") or "")
    return None


def key_numbers(result: dict) -> list[str]:
    """Three short figures for one line: "₦30,000 price · 60% margin · ₦720,000 a month before fixed costs"."""
    kind = result.get("assessment_type") or ""
    out: list[str] = []
    if kind.startswith("pricing"):
        price, margin = _metric(result, "Proposed price"), _metric(result, "Margin")
        monthly = next((m for m in result.get("metrics") or [] if str(m.get("label") or "").startswith("At ")), None)
        out = [f"{price} price" if price else "", f"{margin} margin" if margin else "",
               re.sub(r"\s*contribution before fixed costs$", " a month before fixed costs", str(monthly["value"])) if monthly else ""]
    elif kind.startswith("idea"):
        revenue, margin, even = _metric(result, "Monthly revenue"), _metric(result, "Margin"), _metric(result, "Break-even")
        out = [f"{revenue} a month" if revenue else "", f"{margin} margin" if margin else "", f"break-even at {even}" if even else ""]
    out = [x for x in out if x]
    if len(out) < 3:
        criteria = result.get("criteria") or []
        met = sum(1 for c in criteria if c.get("state") == "met")
        score = result.get("score")
        shown = f"{score:g} out of 100" if isinstance(score, (int, float)) and not isinstance(score, bool) else str(score or "")
        extra = [shown if shown and " of " not in shown.replace(" out of ", " ") else "",
                 f"{met} of {len(criteria)} in place" if criteria else "", f"{len(result.get('blockers') or [])} to close" if result.get("blockers") else ""]
        out += [x for x in extra if x and x not in out]
    return out[:3]


_FAILED = ("unmet", "failed")


def gaps_of(result: dict) -> dict[str, list[str]]:
    """The gaps by name (PRD 12.2), in the states the drawer shows them: failed, early evidence (partly met) and not known
    yet, named as the criteria are ("comparable prices")."""
    names = {c["key"]: c["label"] for c in result.get("criteria") or [] if c.get("key")}
    out: dict[str, list[str]] = {"failed": [], "early": [], "unknown": []}
    for b in result.get("blockers") or []:
        name = names.get(b.get("key")) or b.get("label") or ""
        name = name[:1].lower() + name[1:] if name and not name[:2].isupper() else name
        state = b.get("state")
        (out["failed"] if state in _FAILED else out["early"] if state == "partially_met" else out["unknown"]).append(name)
    return out


def at_a_glance(result: dict) -> dict:
    kind = str(result.get("assessment_type") or "")
    band = band_of(result)
    if kind.startswith("customer_growth"):
        band = None      # PRD 11.3, SIF-15: a foundation count ("5 of 9 in place"), never a grade
    elif band == "Weak" and kind.startswith(("funding", "launch")):
        band = "Not ready yet"      # the PRD's own wording for readiness
    return {"band": band, "key_numbers": key_numbers(result), "gaps": gaps_of(result)}


def _amount(value: Any) -> float | None:
    try:
        n = float(str(value).replace(",", "").strip().lstrip("£$€₦"))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


_CODE_OF_SIGN = {"£": "GBP", "$": "USD", "€": "EUR", "₦": "NGN"}


_PLAIN = {"business", "company", "service", "services", "people", "customers", "local", "small", "with", "from", "that", "this", "their",
          "your", "will", "would", "want", "start", "starting", "idea", "offer", "help", "helps", "provide", "selling", "sell"}


def _words(text: Any) -> set:
    return set(re.findall(r"[a-z]{4,}", str(text or "").lower())) - _PLAIN


def idea_of_this_business(answers: dict | None, data: dict | None) -> bool:
    """Does the idea fit what the business already does? True when the business says nothing about itself yet (the idea
    is the business), else when the idea shares a word with its description, industry or offerings."""
    said = _words((answers or {}).get("description") or (answers or {}).get("sell"))
    p = (data or {}).get("workspace_profile") or {}
    about = " ".join(str(p.get(k) or "") for k in ("description", "about_company", "business_description", "what_we_do", "primary_industry",
                                                   "primary_industry_other", "custom_industry", "industry", "key_offering_focus"))
    about += " " + " ".join(str(x.get("name") or "") for x in _company(data)["products"])
    mine = _words(about)
    return not mine or not said or bool(said & mine)


_NAME_LEAD = re.compile(r"^(?:(?:i|we)\s+(?:want|plan|would like|am going|are going)\s+to\s+(?:start|open|launch|run|sell|offer)\s+|"
                        r"(?:my|our)\s+idea\s+is\s+(?:to\s+(?:start|open|launch|run|sell|offer)\s+)?|(?:an?|the|my|our)\s+)+", re.I)


def item_name(text: Any) -> str:
    """A catalogue name from what was said: "I want to start a mobile drone cleaning service for offices in Leeds, about
    £80 a visit" is "Mobile drone cleaning service". The first clause, without the lead-in, who it is for or where."""
    first = re.split(r"[.,;:!?\n]|\s+-\s+|\s+(?:but|which|so)\s+", str(text or "").strip(), maxsplit=1)[0]
    name = _NAME_LEAD.sub("", first.strip())
    name = re.split(r"\s+(?:for|in|around|across|to|at|near|aimed at|targeting)\s+", name, maxsplit=1)[0].strip()
    name = name[:60].rsplit(" ", 1)[0] if len(name) > 60 else name
    return name[:1].upper() + name[1:] if len(name) >= 3 else ""


def _doable(action: dict, answers: dict, sign: str = "£") -> dict:
    """A free next action that does the thing, not only opens the page: the catalogue ones save what this check was
    told (the offering, its price and cost), and "Create a quotation" opens a new quotation."""
    label = action.get("label")
    name = str(answers.get("sell") or answers.get("description") or "").strip()[:120]
    from app.modules.readiness.service import _vague
    if _vague(name):
        name = ""      # "Readiness", "my business": not an offering to add (the owner's QA, 23 Oct)
    if label in ("Save the price in your catalogue", "Add it to your catalogue") and item_name(name):
        name = item_name(name)      # a short product name, never the whole sentence (G4, 23 Oct)
        item = {"name": name}
        if label == "Save the price in your catalogue":
            price, cost = _amount(answers.get("price")), _amount(answers.get("cost"))
            if price is None:
                return action      # no price to save: the catalogue page, to add it there
            item.update({"base_price": price, **({"cost_of_sales": cost} if cost is not None else {}), **({"currency": _CODE_OF_SIGN[sign]} if sign in _CODE_OF_SIGN else {})})
        elif _amount(answers.get("price")) is not None:
            # A price said in the chat goes with it, said on the button (QA, 15 Oct): "Add 'Car wash subscription · ₦15,000 a month'".
            price, cost = _amount(answers.get("price")), _amount(answers.get("cost"))
            item.update({"base_price": price, **({"cost_of_sales": cost} if cost is not None else {}), **({"currency": _CODE_OF_SIGN[sign]} if sign in _CODE_OF_SIGN else {})})
            per = f" a {answers['price_per']}" if answers.get("price_per") else ""
            shown = name[:1].upper() + name[1:]
            return {**action, "label": f"Add '{shown} · {_money(price, sign)}{per}' to your catalogue", "catalogue": item}
        return {**action, "catalogue": item}
    if label == "Create a quotation":
        return {**action, "to": "/operations?tab=Sales&sub=Quotations&new=quote"}
    if label == "Write a business plan":
        # Started when pressed (R4: asked for), from what this check was told; the plans page is where it lands.
        who = str(answers.get("customer") or "").strip()[:200]
        from app.modules.readiness.service import _vague
        said = {k: v for k, v in {"description": name, "customer": "" if _vague(who) else who}.items() if v}
        return {**action, "capability": "business_plan_draft", "params": {"answers": said} if said else {}, "to": "/blueprint?tab=business-plans"}
    return action


def _norm(text: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def offering_on_record(answers: dict | None, data: dict | None, priced_only: bool = False) -> bool:
    """Is what this check is about already in the catalogue (or the profile's services)? Then "Add it to your
    catalogue" isn't offered (QA PF8)."""
    said = _norm((answers or {}).get("sell") or (answers or {}).get("description"))
    if not said:
        return False
    profile = (data or {}).get("workspace_profile") or {}
    # With a price said, only a catalogue product counts: a service named on the profile has no price to sell from.
    names = [p["name"] for p in _company(data)["products"] if not priced_only or (isinstance(p.get("base_price"), (int, float)) and p["base_price"] > 0)] + ([] if priced_only else [
        (s.get("service_name") or s.get("name")) if isinstance(s, dict) else s for s in profile.get("services") or []])
    for name in names:
        n = _norm(name)
        if n and (n == said or (len(n) >= 4 and (n in said or said in n))):
            return True
    return False


# ── In the app (QA P1-7): the same short conversation, with what the Company already holds filled in ──

_STAGE_FOR_FUNDING = {"idea": "idea", "pre_revenue": "pre_revenue", "early_revenue": "trading", "established": "trading", "growing": "growing", "growth": "growing"}
FROM_RECORDS = "From your business profile"
FROM_PROPOSAL = "From an earlier answer, not saved to your profile"
# Which question a proposed profile value can fill (QA R1): only where the profile itself has nothing.
_PROPOSAL_FILLS = {"target_customer": "customer", "about_company": "sell", "location": "where"}


def known_sources(goal_key: str, data: dict | None) -> dict[str, dict]:
    """{question key: {"value", "source", "proposal_id"?}}: the profile's own values first, said as such;
    then a pending proposal (an earlier answer, not confirmed) for a gap, said as that and never as the profile."""
    records = known_answers(goal_key, data)
    out = {k: {"value": v, "source": FROM_RECORDS} for k, v in records.items()}
    from app.modules.agent.goals import questions_for
    asked = {q["key"] for q in questions_for(goal_key)}
    # QA PF5: what an earlier check was told about the same offering ("From your launch check").
    from app.modules.agent import answer_memory
    for k, v in answer_memory.recall(goal_key, data, asked, records).items():
        out.setdefault(k, {"value": v["value"], "source": v["source"], "from_goal": v["from_goal"]})
    offering = answer_memory.current_offering(goal_key, data, records)
    from app.modules.agent import profile_proposals
    for p in reversed(profile_proposals.pending(data)):
        key = _PROPOSAL_FILLS.get(p["field"])
        # Never a value from a different idea or offering (QA PF5): a proposal is used only for the offering it came
        # from. One that doesn't say which offering it was about is used only while no offering is known at all.
        came_from = (p.get("source") or {}).get("offering")
        if offering and not (came_from and answer_memory.same_offering(came_from, offering)):
            continue
        # A proposal for this gap wins over an earlier check's answer (the same answer, kept from it): it can be saved to the profile.
        if key and key in asked and (key not in out or out[key].get("from_goal")):
            out[key] = {"value": p["value"], "source": FROM_PROPOSAL, "proposal_id": p["id"],
                        "from": (p.get("source") or {}).get("goal_label") or "another task"}
    return out


def known_answers(goal_key: str, data: dict | None) -> dict[str, Any]:
    """Answers the Company's own records already give for a goal's questions. Only facts on record;
    nothing is guessed (a field with no record stays empty and is asked)."""
    data = data or {}
    profile = data.get("workspace_profile") or {}
    co = _company(data)
    services = [str(s.get("service_name") or s.get("name") or "").strip() if isinstance(s, dict) else str(s).strip() for s in profile.get("services") or []]
    offers = [s for s in services if s] or [str(p["name"]).strip() for p in co["products"]]
    city, country = str(profile.get("city") or "").strip(), str(profile.get("country") or "").strip()
    place = ", ".join(x for x in (city, country) if x and x.lower() != "not specified")
    out: dict[str, Any] = {}
    if goal_key == "business_risks":
        # What the records already tell is not asked (the owner, 23 Oct): the biggest customer's share, the cash, late payment
        f = risk_facts(data)
        if f["top_share"] is not None:
            out["top_share"] = "over_50" if f["top_share"] >= 50 else "20_50" if f["top_share"] >= 20 else "under_20"
        if f["runway_months"] is not None and not f.get("costs_estimate"):      # an estimate is never taken as known (R-9)
            out["runway"] = "under_3" if f["runway_months"] < 3 else "3_6" if f["runway_months"] < 6 else "over_6"
        if f["overdue"] is not None:
            out["paid_on_time"] = "on_time" if f["overdue"] == 0 else "sometimes_late" if f["overdue"] <= max(1, f["invoices"] // 5) else "often_late"
        if f["team"] == 1:
            out["key_person"] = "stops"      # a business of one; any larger team is asked, never guessed
        for k, v in saved_risk_answers(data).items():
            out.setdefault(k, v["value"])      # what the owner answered before (R-2): never asked again
        return out
    if goal_key in ("launch", "more_customers", "price_offer") and offers:
        out["sell"] = offers[0] if goal_key == "price_offer" else ", ".join(offers[:3])
    if goal_key == "launch" and co["about"] and not str(co["about"]).endswith("with EnterprateAI."):
        out["sell"] = co["about"][:400]
    # The profile's target customer, only when the owner set it: one the Agent filled from a chat about another offering is
    # never proposed for this one (the owner, 25 Oct: "Dog owners aged 30 to 60" offered for a carpet cleaning launch)
    owners = lambda f: (lambda e: not e or e.get("by") == "owner")(((data or {}).get("profile_provenance") or {}).get(f))      # noqa: E731
    target = next((str(profile.get(f)).strip() for f in ("target_customer", "target_market") if str(profile.get(f) or "").strip() and owners(f)), "")
    if goal_key in ("launch", "more_customers", "test_idea", "price_offer") and target:
        out["customer"] = target
    if goal_key in ("launch", "more_customers") and place:
        out["where"] = place
    if goal_key == "need_funding" and profile.get("operating_stage") in _STAGE_FOR_FUNDING and profile.get("operating_stage") != "idea":
        out["stage"] = _STAGE_FOR_FUNDING[profile["operating_stage"]]
    if goal_key == "price_offer" and co["priced"]:
        first = co["priced"][0]
        out["sell"], out["price"] = first["name"], first["base_price"]
        if first in co["costed"]:
            out["cost"] = first["cost_of_sales"]
    return out


# After research is adopted, what the result recommends next: the document the check leads to, started from a button
# (R4: asked for by the owner, never started by itself).
AFTER_REVIEW = {"need_funding": {"label": "Draft my funding pack", "capability": "funding_pack_draft"},
                "launch": {"label": "Draft my business plan", "capability": "business_plan_draft", "to": "/blueprint?tab=business-plans"}}


def after_review(goal: str, result: dict, version: dict | None = None) -> dict:
    """The result as the adopted research left it, with its next step first."""
    out = dict(result)
    step = AFTER_REVIEW.get(goal)
    if step and step["capability"] == "business_plan_draft":
        # Started with what this check was told (the owner's QA, 23 Oct: "make sure these next actions work with the right
        # details prefilled"): what is launched and for whom, never a placeholder
        told = (out.get("_edit") or {}).get("answers") or out.get("answers") or {}
        step = _doable({"label": "Write a business plan"}, told)
        step = {**step, "label": AFTER_REVIEW[goal]["label"]}
    actions = [x for x in out.get("free_next_actions") or [] if not (step and x.get("capability") == step["capability"])]
    out["free_next_actions"] = ([step] if step else []) + actions
    out["premium_next_action"] = None      # adopted: the research isn't offered again (it reruns only when a figure changes)
    if version:
        out["adopted"] = {"version": version.get("version"), "at": version.get("created_at")}
    return out


def premium_gate(result: dict, *, entitled: bool, credits: int | None = None, feature: str | None = None, plan: str | None = None,
                 cost: int | None = None) -> dict:
    """What happens when the premium next action is chosen. The plan is checked first; credits only
    for someone whose plan includes it (PRD 4.1). Declining leaves Save for later and the free tools (SIF-07).
    The words are the credit templates: "{Feature} is on the {plan} plan." and "This needs {cost} credits and you have {balance}." """
    action = result.get("premium_next_action")
    if not action:
        # Adopted: nothing paid is offered (the owner's QA, 21 Oct: this crashed the case page after every apply).
        return {"allowed": True, "reason": None, "message": ""}
    if not entitled:
        return {"allowed": False, "reason": "plan",
                "message": f"{feature or action['label']} is on the {plan or 'Starter'} plan.",
                "primary": {"label": "See plans", "to": "/pricing", "upgrade": True},
                "secondary": [{"label": "Continue with free tools", "actions": [x for x in result["free_next_actions"] if not x.get("save")]}, {"label": "Save for later", "save": True}]}
    if credits is not None and (credits <= 0 or (cost and credits < cost)):
        have = max(0, int(credits or 0))
        return {"allowed": False, "reason": "credits",
                "message": f"This needs {cost} credits and you have {have}." if cost else f"You have {have} credits, which isn't enough for this.",
                "primary": {"label": "Top up", "to": "/pricing", "upgrade": True}, "secondary": [{"label": "Save for later", "save": True}]}
    return {"allowed": True, "reason": None, "message": action["explains"]}
