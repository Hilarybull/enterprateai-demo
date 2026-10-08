"""Answers to questions about the business, from authoritative records (s4, s5.1).

A question such as "What is my biggest risk?" doesn't start a workflow: nothing is
prepared or sent. It is answered here, deterministically, from the same figures
the dashboard shows (recorded invoices, expenses and the business's risk policy),
with the evidence behind the answer. Questions on other topics return None and
are answered conversationally by the Business Assistant.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent.documents import fmt_money

_TOPICS: list[tuple[str, re.Pattern]] = [
    ("risk", re.compile(r"\b(risk\w*|fragil\w*|concentrat\w*|depend\w*|vulnerab\w*|threat\w*|worr\w*|danger\w*|exposure|exposed)\b", re.I)),
    ("receivables", re.compile(r"\b(overdue|owe[sd]?|owing|outstanding|receivabl\w*|unpaid|late pay\w*|debtors?)\b", re.I)),
    ("cash", re.compile(r"\b(cash|runway|burn rate|bank balance|money left|afford)\b", re.I)),
    ("revenue", re.compile(r"\b(revenue|sales|income|turnover|(top|biggest|best|largest|main) (customer|client)s?)\b", re.I)),
]
SOURCE_NOTE = "Based on the invoices and expenses recorded in this workspace."


# Requests for a quotation that buyers sent to this business through the Marketplace.
_REQUESTS = re.compile(r"\b(rfqs?|requests? for (a |an )?quot\w*|quot\w* requests?|marketplace requests?|inbound requests?|buyer requests?)\b", re.I)


def _requests_answer(data: dict) -> dict:
    """Who asked this business for a quotation, from the requests on record and nothing else.
    `data` is already masked for the plan: a locked request gives its existence, never its details."""
    from app.modules.agent import memory
    r = memory.inbound_requests(data)
    source = "Based on the requests for a quotation received through the Marketplace."
    if not r["count"]:
        return {"topic": "requests", "message": "No request for a quotation has come in through the Marketplace yet. Listing an offering there is what brings them in.",
                "evidence": [], "actions": [{"label": "Open the Marketplace", "to": "/marketplace"}], "source": source}
    n, waiting = r["count"], r["waiting_for_a_reply"]
    count = f"You have {n} request{'s' if n != 1 else ''} for a quotation from the Marketplace, {waiting} waiting for a reply."
    if r["locked"]:
        return {"topic": "requests", "source": source,
                "message": count + " Who sent them and what they asked for are locked on your plan. Upgrade to view and reply to them.",
                "evidence": [{"label": "Latest received", "value": r["received"][0] or "date not recorded"}],
                "actions": [{"label": "See plans", "to": "/pricing"}]}
    latest = r["requests"][0]
    who = latest["from"] or "a buyer whose name wasn't given"
    asked = ", ".join(latest["asked_for"]) or "nothing listed"
    return {"topic": "requests", "source": source,
            "message": f"Your latest request for a quotation came from {who}" + (f" ({latest['email']})" if latest["email"] else "")
                       + (f" on {latest['received']}" if latest["received"] else "") + f", asking for {asked}. It is {latest['status']}. " + count,
            "evidence": [{"label": q["from"] or "Buyer", "value": f"{', '.join(q['asked_for']) or 'nothing listed'} · {q['status']}"} for q in r["requests"][:5]],
            "actions": [{"label": "Open requests", "to": "/operations?tab=Sales"}]}


def topic_of(text: str) -> str | None:
    return next((key for key, pattern in _TOPICS if pattern.search(text or "")), None)


def _facts(data: dict, policy: dict, today: date) -> dict[str, Any]:
    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    overdue = bz.overdue_invoices(data, today)
    oldest = None
    for inv in overdue:
        due = bz.parse_day(inv.get("due_date"))
        if due:
            days = (today - due).days
            oldest = days if oldest is None else max(oldest, days)
    return {
        "cur": bz.currency_of(data),
        "alert_pct": alert_pct,
        "conc": bz.concentration(data, alert_pct),
        "overdue": overdue,
        "overdue_total": sum(bz.invoice_outstanding(i) for i in overdue),
        "oldest_days": oldest,
        "cash": bz.cash_position(data, today),
    }


def _evidence(f: dict) -> list[dict]:
    cur, conc, cash = f["cur"], f["conc"], f["cash"]
    ev: list[dict] = []
    if conc["customer_count"]:
        top = conc["top_customers"][0]
        ev.append({"label": "Largest customer", "value": f"{top['customer']}: {top['share_pct']:g}% of revenue "
                                                          f"({fmt_money(top['revenue'], cur)} of {fmt_money(conc['total_revenue'], cur)})"})
        if conc["customer_count"] >= 2:
            ev.append({"label": "Top two customers", "value": f"{conc['top2_share_pct']:g}% of revenue"})
        ev.append({"label": "Concentration alert level", "value": f"{f['alert_pct']:g}% of revenue"})
    else:
        ev.append({"label": "Revenue recorded", "value": "None yet"})
    if f["overdue"]:
        oldest = f" (oldest {f['oldest_days']} days)" if f["oldest_days"] is not None else ""
        ev.append({"label": "Overdue invoices", "value": f"{len(f['overdue'])} · {fmt_money(f['overdue_total'], cur)}{oldest}"})
    else:
        ev.append({"label": "Overdue invoices", "value": "None"})
    runway = f" · {cash['runway_months']:g} months of runway" if cash["runway_months"] is not None else ""
    ev.append({"label": "Cash position", "value": f"{fmt_money(cash['cash'], cur)}{runway}"})
    return ev


def _risks(f: dict) -> list[dict]:
    """Risks present now, most serious first."""
    cur, conc, cash = f["cur"], f["conc"], f["cash"]
    out: list[dict] = []
    if cash["cash"] < 0:
        out.append({"key": "cash_negative", "text": f"your recorded cash position is negative at {fmt_money(cash['cash'], cur)}",
                    "action": {"label": "Model a fix in Simulation", "to": "/simulation"}})
    elif cash["runway_months"] is not None and cash["runway_months"] < 3:
        out.append({"key": "runway", "text": f"you have only {cash['runway_months']:g} months of runway at your current spending",
                    "action": {"label": "Model a fix in Simulation", "to": "/simulation"}})
    if conc["alert"]:
        top = conc["top_customers"][0]
        if top["share_pct"] >= f["alert_pct"]:
            text = f"customer concentration: {top['customer']} accounts for {top['share_pct']:g}% of your revenue"
        else:
            text = f"customer concentration: your top two customers account for {conc['top2_share_pct']:g}% of your revenue"
        out.append({"key": "concentration", "text": f"{text}, above your {f['alert_pct']:g}% alert level",
                    "action": {"label": "Review concentration risk", "capability": "risk_concentration"}})
    if f["overdue"]:
        n = len(f["overdue"])
        oldest = f", the oldest by {f['oldest_days']} days" if f["oldest_days"] else ""
        out.append({"key": "overdue", "text": f"late payment: {n} invoice{'s are' if n != 1 else ' is'} overdue "
                                              f"({fmt_money(f['overdue_total'], cur)}){oldest}",
                    "action": {"label": "Prepare payment follow-ups", "capability": "payment_followup"}})
    return out


def answer_question(text: str, data: dict, policy: dict, today: date) -> dict | None:
    """{"message", "evidence", "actions", "topic", "source"} for a question about the
    business's risks, receivables, cash or revenue; None for anything else."""
    if _REQUESTS.search(text or ""):
        return _requests_answer(data)
    topic = topic_of(text)
    if not topic:
        return None
    f = _facts(data, policy, today)
    cur, conc, cash = f["cur"], f["conc"], f["cash"]
    risks = _risks(f)
    actions: list[dict] = []

    if topic == "risk":
        if risks:
            message = f"Your biggest risk right now is {risks[0]['text']}."
            if len(risks) > 1:
                message += " Also worth watching: " + "; ".join(r["text"] for r in risks[1:]) + "."
            actions = [r["action"] for r in risks[:2]]
        elif not conc["customer_count"]:
            message = ("No significant risk shows yet, though with no revenue recorded there is little to measure. "
                       "Ask me for an invoice or to record an expense and I'll keep watch for concentration, late payment and cash risks.")
            actions = [{"label": "Open Essentials", "to": "/operations"}]
        else:
            top = conc["top_customers"][0]
            message = (f"No major risk stands out. Your largest customer is {top['share_pct']:g}% of revenue, "
                       f"within your {f['alert_pct']:g}% alert level, and nothing is overdue.")
            actions = [{"label": "Test a scenario", "to": "/simulation"}]
    elif topic == "receivables":
        if f["overdue"]:
            names = ", ".join(sorted({str(i.get("customer_name") or "a customer") for i in f["overdue"]})[:3])
            message = (f"{len(f['overdue'])} invoice{'s are' if len(f['overdue']) != 1 else ' is'} overdue, "
                       f"{fmt_money(f['overdue_total'], cur)} in total, from {names}.")
            actions = [{"label": "Prepare payment follow-ups", "capability": "payment_followup"}]
        else:
            message = "Nothing is overdue. Every issued invoice is either paid or still within its payment terms."
    elif topic == "cash":
        if cash["cash"] < 0:
            message = f"Your recorded cash position is negative at {fmt_money(cash['cash'], cur)}."
        elif cash["runway_months"] is not None:
            message = (f"Your cash position is {fmt_money(cash['cash'], cur)}, about {cash['runway_months']:g} months of runway "
                       f"at your recent spending of {fmt_money(cash['monthly_burn'], cur)} a month.")
        else:
            message = f"Your cash position is {fmt_money(cash['cash'], cur)}. Record your expenses to see how long it will last."
        actions = [{"label": "Model a scenario", "to": "/simulation"}]
    else:  # revenue
        if conc["customer_count"]:
            top = conc["top_customers"][0]
            message = (f"You've recorded {fmt_money(conc['total_revenue'], cur)} of revenue from {conc['customer_count']} "
                       f"customer{'s' if conc['customer_count'] != 1 else ''}. Your largest is {top['customer']} "
                       f"at {top['share_pct']:g}%.")
        else:
            message = "No revenue is recorded yet. Paid and issued invoices will show up here."
            actions = [{"label": "Open Essentials", "to": "/operations"}]

    return {"topic": topic, "message": message, "evidence": _evidence(f), "actions": actions, "source": SOURCE_NOTE}


# ── Capabilities that are planned but can't run yet (PRD s5 inventory) ──────────

UNAVAILABLE: dict[str, dict[str, Any]] = {
    "proposal": {"what": "Preparing proposals",
                 "explain": "How should I structure a strong business proposal for a client?",
                 "draft": {"label": "Start a proposal draft", "to": "/blueprint?tab=proposals"}},
    "marketplace_rfq": {"what": "Responding to marketplace requests for quotation",
                        "explain": "How should I respond to a request for quotation?",
                        "draft": {"label": "Open the Marketplace", "to": "/marketplace"}},
    "business_planning": {"what": "Writing business plans",
                          "explain": "What should a business plan include?",
                          "draft": {"label": "Start a business plan draft", "to": "/blueprint?tab=business-plans"}},
    "launch": {"what": "Launch tasks such as company registration",
               "explain": "What are the steps to register and launch my business?",
               "draft": {"label": "Open Business Registration", "to": "/registration"}},
    "funding_readiness": {"what": "Funding readiness",
                          "explain": "How do I prepare my business to raise funding?",
                          "draft": {"label": "Open Business Blueprints", "to": "/blueprint"}},
    "growth": {"what": "Growth planning",
               "explain": "What are practical ways to grow my business revenue?",
               "draft": {"label": "Test a growth scenario", "to": "/simulation"}},
    "business_health": {"what": "Full business health reviews",
                        "explain": "How healthy is my business, and what should I improve?",
                        "draft": {"label": "Open the Business Health Report", "to": "/dashboard"}},
    "operational": {"what": "Operational tasks",
                    "explain": "How can I run my day-to-day operations more efficiently?",
                    "draft": {"label": "Open Business Operations", "to": "/operations"}},
}


def unavailable(capability: str, label: str | None = None) -> dict:
    spec = UNAVAILABLE.get(capability) or {"what": label or "That task", "explain": None, "draft": None}
    offers = []
    if spec.get("explain"):
        offers.append({"label": "Explain how to do it", "kind": "explain", "prompt": spec["explain"]})
    if spec.get("draft"):
        offers.append({**spec["draft"], "kind": "draft"})
    return {
        "kind": "unavailable", "capability": capability,
        "message": f"{spec['what']} isn't available as an Agent action yet, so nothing has been started. "
                   "I can explain how to approach it, or you can prepare a draft yourself.",
        "offers": offers,
    }
