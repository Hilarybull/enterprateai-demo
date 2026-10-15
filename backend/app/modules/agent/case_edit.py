"""The Agent edits the one funding case (the owner's QA, 15 Oct): "Change the amount in my funding readiness to £60,000 and
check it again" is a change to the case, never a new intake. Said first ("Change the target from £100,000 to £60,000?"
[Yes, update] [Cancel]), written with "Changed via Agent" as its source, then checked again (free)."""
from __future__ import annotations

import re
from datetime import date
from typing import Any

# A change asked for, to a field of the funding case: "change|update|set|make|increase|reduce… the amount … to £60,000".
_EDIT = re.compile(r"\b(?:change|update|set|make|increase|raise|reduce|lower|move|switch|edit)\b(?P<what>.{0,60}?)\b(?:to|=|as)\s+(?P<value>.+?)"
                   r"(?:\s+and\s+(?:check|run|re-?check)\b.*)?[.!]?\s*$", re.I)
_FIELDS = (("target_amount", r"\b(amount|target|figure|raise|funding needed|how much)\b"), ("receipt_date", r"\b(date|timing|deadline|when)\b"),
           ("route_preference", r"\b(route|type of funding|kind of funding)\b"), ("purpose", r"\b(purpose|what it is for|use of the money|use)\b"),
           ("currency", r"\b(currency)\b"), ("stage", r"\b(stage)\b"))
_ABOUT_FUNDING = re.compile(r"\b(funding|fund|case|readiness|raise|loan|grant|investment|target)\b", re.I)


def read(text: str) -> dict | None:
    """{"field", "value", "said"} for a change asked to the funding case, else None."""
    m = _EDIT.search(str(text or "").strip())
    if not m or not _ABOUT_FUNDING.search(text):
        return None
    what = m.group("what") or ""
    field = next((f for f, pattern in _FIELDS if re.search(pattern, what, re.I)), None)
    said = m.group("value").strip().rstrip(".")
    if field is None:
        return None
    from app.modules.agent import goals
    from app.modules.agent.intake_turn import currency_of
    if field == "target_amount":
        n = goals.extract(said, "need_funding").get("amount")
        if not n:
            return None
        return {"field": field, "value": float(n), "said": said, "currency": currency_of(said)}
    if field == "receipt_date":
        when = goals.end_of_month(said)
        return {"field": field, "value": when, "said": said} if when else None
    if field == "route_preference":
        route = next((r for r in ("loan", "grant", "equity") if re.search(rf"\b{r}\b", said, re.I)), None)
        return {"field": field, "value": route, "said": said} if route else None
    if field == "currency":
        code = currency_of(said) or (said.upper() if re.fullmatch(r"[A-Za-z]{3}", said) else None)
        return {"field": field, "value": code, "said": said} if code else None
    if field == "stage":
        stage = "pre_revenue" if re.search(r"\b(not trading|pre[- ]?revenue|idea)\b", said, re.I) else "trading" if re.search(r"\btrading\b", said, re.I) else None
        return {"field": field, "value": stage, "said": said} if stage else None
    return {"field": field, "value": said, "said": said}


_LABEL = {"target_amount": "target", "receipt_date": "date you expect the funding", "route_preference": "route", "purpose": "purpose",
          "currency": "currency", "stage": "stage"}


def shown(field: str, value: Any, currency: str | None) -> str:
    from app.modules.agent.goals import _said
    if field == "route_preference":
        return str(value or "not set")
    return _said(field, value, currency)


def proposal(case: dict, change: dict) -> dict:
    """The confirm, before anything is written: "Change the target from £100,000 to £60,000?" [Yes, update] [Cancel]."""
    data = case.get("data") or {}
    currency = data.get("currency")
    field = change["field"]
    before = data.get(field) if field != "route_preference" else (data.get("route_preference") or data.get("route"))
    question = f"Change the {_LABEL[field]} from {shown(field, before, currency)} to {shown(field, change['value'], change.get('currency') or currency)}?"
    if change.get("currency") and currency and change["currency"] != currency:
        question += f" That amount is in {change['currency']}; your case is in {currency}."
    body = {"changes": {field: change["value"]}}
    return {"kind": "answer", "conversational": False, "message": question,
            "offers": [{"label": "Yes, update", "post": {"url": f"/businesses/{case['business_id']}/funding-cases/{case['id']}/agent-edit", "body": body}},
                       {"label": "Cancel", "dismiss": True}]}


def provenance(changes: dict, today: date | None = None) -> dict:
    today = today or date.today()
    return {k: f"Changed via Agent, {today.day} {today.strftime('%b')}" for k in changes}
