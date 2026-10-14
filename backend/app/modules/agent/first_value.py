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

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

RULESET_VERSION = "first-value-1.0"
MET, PARTIAL, UNMET, UNKNOWN = "met", "partially_met", "unmet", "unknown"
UNSURE = "unknown"      # what "Not sure" is stored as: an answer, and never a fact

# Which goal gets which assessment.
ASSESSMENT_OF = {"test_idea": "idea_viability_initial", "launch": "launch_readiness_initial", "need_funding": "funding_readiness_initial",
                 "price_offer": "pricing_health_initial", "more_customers": "customer_growth_foundation"}
HEADLINE = {"idea_viability_initial": "Initial Idea Viability", "launch_readiness_initial": "Initial Launch Readiness",
            "funding_readiness_initial": "Initial Funding Preparation", "pricing_health_initial": "Pricing Health",
            "customer_growth_foundation": "Customer Growth Foundation"}
# The premium next action, and what it will do (said before any upgrade is asked for: PRD 12.3).
PREMIUM = {
    "idea_viability_initial": ("Validate the weak points", "research competitors and demand, find comparable prices and test the assumptions the score rests on"),
    "launch_readiness_initial": ("Resolve my launch blockers", "research the missing evidence, benchmark your market, test assumptions and help resolve the blockers"),
    "funding_readiness_initial": ("Help me become funding-ready", "research funding routes, structure your use of funds, prepare forecast assumptions and close the gaps a funder will ask about"),
    "pricing_health_initial": ("Find my best price", "research competitor prices and market price bands, and test alternative prices against demand"),
    "customer_growth_foundation": ("Find my best customer opportunities", "research segments, channels and demand signals, and prepare a brief of the best opportunities"),
}
FREE_NEXT = {
    "idea_viability_initial": [("Write a business plan", "/business-plan"), ("Add it to your catalogue", "/catalogue")],
    "launch_readiness_initial": [("Add it to your catalogue", "/catalogue"), ("Set up your Marketplace profile", "/marketplace/profile")],
    "funding_readiness_initial": [("Write a business plan", "/business-plan"), ("Record your invoices and customers", "/operations")],
    "pricing_health_initial": [("Save the price in your catalogue", "/catalogue"), ("Create a quotation", "/operations")],
    "customer_growth_foundation": [("Set up your Marketplace profile", "/marketplace/profile"), ("Create a quotation", "/operations")],
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
        "evidence_coverage": round(100 * covered / total),
        "criteria": [{"key": c["key"], "label": c["label"], "state": c["state"], **({"weight": c["weight"]} if "weight" in c else {})} for c in criteria],
        "strengths": strengths, "blockers": blockers, "metrics": metrics or [],
        "premium_next_action": {"label": label, "explains": f"I can now {does}.", "capability": kind.replace("_initial", "").replace("_foundation", "") + "_intelligence"},
        "free_next_actions": [{"label": a, "to": to} for a, to in FREE_NEXT[kind]] + [{"label": "Save for later", "save": True}],
        "generated_at": (now or datetime.now(timezone.utc)).isoformat(), "currency_sign": sign,
    }


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


def _weighted(criteria: list[dict]) -> int:
    return round(sum(c["weight"] * {MET: 1.0, PARTIAL: 0.5}.get(c["state"], 0.0) for c in criteria))


# ── Funding (PRD 9.2): the eight criteria and their weights ──────────────────

def funding(a: dict, data: dict | None = None, now: datetime | None = None, sign: str = "£") -> dict:
    co = _company(data)
    amount, use, timing, traction, stage = _num(a.get("amount")), a.get("use"), a.get("timing"), a.get("traction"), a.get("stage")
    no_traction = _known(traction) and str(traction).strip().lower() in ("none", "no", "no traction yet", "nothing yet", "not yet")
    evidence = bool(co["invoices"] or co["customers"])
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
         "strength": f"{demand_level(traction)[1]}: {_quoted(traction)}" if demand_level(traction) and not no_traction else "Some customer evidence exists",
         "gap": "No traction yet" if no_traction else "Traction evidence incomplete"},
        {"key": "economics", "label": "Business economics", "weight": 10, "state": MET if co["priced"] and co["costed"] else PARTIAL if co["priced"] else UNKNOWN,
         "strength": "Prices are on record", "gap": "Prices and costs not on record" if not co["priced"] else "Costs not on record"},
        {"key": "market", "label": "Market and growth plan", "weight": 10, "state": PARTIAL if co["target"] or co["about"] else UNKNOWN,
         "strength": "Target market described", "gap": "Target customers and how you will reach them not set out"},
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
        {"key": "offer", "label": "Offer and pricing", "weight": 15, "state": MET if _known(sell) and co["priced"] and co["costed"] else PARTIAL if _known(sell) else UNKNOWN,
         "strength": "Offer is defined", "gap": "Pricing economics incomplete"},
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


_RUN = {"need_funding": funding, "launch": launch, "test_idea": idea, "price_offer": pricing, "more_customers": customers}


def covered(goal_key: str | None) -> bool:
    return goal_key in _RUN


def assess(goal_key: str, answers: dict, data: dict | None = None, *, now: datetime | None = None, sign: str = "£") -> dict | None:
    """The first-value result for a goal, or None for a goal that has none (a document, say)."""
    run = _RUN.get(goal_key)
    if not run:
        return None
    out = run(dict(answers or {}), data, now, sign)
    if offering_on_record(answers, data):
        out["free_next_actions"] = [x for x in out["free_next_actions"] if x.get("label") != "Add it to your catalogue"]
    out["free_next_actions"] = [_doable(x, answers or {}) for x in out["free_next_actions"]]
    return out


def _amount(value: Any) -> float | None:
    try:
        n = float(str(value).replace(",", "").strip().lstrip("£$€₦"))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _doable(action: dict, answers: dict) -> dict:
    """A free next action that does the thing, not only opens the page: the catalogue ones save what this check was
    told (the offering, its price and cost), and "Create a quotation" opens a new quotation."""
    label = action.get("label")
    name = str(answers.get("sell") or answers.get("description") or "").strip()[:120]
    if label in ("Save the price in your catalogue", "Add it to your catalogue") and name:
        item = {"name": name}
        if label == "Save the price in your catalogue":
            price, cost = _amount(answers.get("price")), _amount(answers.get("cost"))
            if price is None:
                return action      # no price to save: the catalogue page, to add it there
            item.update({"base_price": price, **({"cost_of_sales": cost} if cost is not None else {})})
        return {**action, "catalogue": item}
    if label == "Create a quotation":
        return {**action, "to": "/operations?tab=Sales&sub=Quotations&new=quote"}
    return action


def _norm(text: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def offering_on_record(answers: dict | None, data: dict | None) -> bool:
    """Is what this check is about already in the catalogue (or the profile's services)? Then "Add it to your
    catalogue" isn't offered (QA PF8)."""
    said = _norm((answers or {}).get("sell") or (answers or {}).get("description"))
    if not said:
        return False
    profile = (data or {}).get("workspace_profile") or {}
    names = [p["name"] for p in _company(data)["products"]] + [
        (s.get("service_name") or s.get("name")) if isinstance(s, dict) else s for s in profile.get("services") or []]
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
    if goal_key in ("launch", "more_customers", "price_offer") and offers:
        out["sell"] = offers[0] if goal_key == "price_offer" else ", ".join(offers[:3])
    if goal_key == "launch" and co["about"] and not str(co["about"]).endswith("with EnterprateAI."):
        out["sell"] = co["about"][:400]
    if goal_key in ("launch", "more_customers", "test_idea", "price_offer") and co["target"]:
        out["customer"] = co["target"]
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


def premium_gate(result: dict, *, entitled: bool, credits: int | None = None) -> dict:
    """What happens when the premium next action is chosen. The plan is checked first; credits only
    for someone whose plan includes it (PRD 4.1). Declining leaves Save for later and the free tools (SIF-07)."""
    action = result["premium_next_action"]
    if not entitled:
        return {"allowed": False, "reason": "plan",
                "message": f"You already have an initial assessment. {action['explains']} This is available on an eligible plan.",
                "primary": {"label": "Upgrade to continue", "to": "/pricing", "upgrade": True},
                "secondary": [{"label": "Continue with free tools", "actions": [x for x in result["free_next_actions"] if not x.get("save")]}, {"label": "Save for later", "save": True}]}
    if credits is not None and credits <= 0:
        from app.modules.agent.config import short_of
        return {"allowed": False, "reason": "credits", "message": f"Your plan includes this. {short_of(None, credits)} Your assessment is saved.",
                "primary": {"label": "Top up", "to": "/pricing", "upgrade": True}, "secondary": [{"label": "Save for later", "save": True}]}
    return {"allowed": True, "reason": None, "message": action["explains"]}
