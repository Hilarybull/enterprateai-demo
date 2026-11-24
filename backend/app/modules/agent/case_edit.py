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
# "make it 45000", "make my funding £45k": an amount said with no "to"
_MAKE_IT = re.compile(r"\b(?:make|set)\s+(?:it|this|that|my funding|the funding|the amount|the target)\s+(?P<value>[£$€₦]?\s?\d[\d,.]*\s*(?:k|m|thousand|million)?)\b", re.I)
_ABOUT_FUNDING = re.compile(r"\b(funding|fund|case|readiness|raise|loan|grant|investment|target)\b", re.I)


_AND = re.compile(r"\s*(?:,\s+(?:and\s+)?|\s+and\s+)(?!(?:check|run|re-?check)\b)", re.I)      # never inside "£60,000"
_WHEN = re.compile(r"^(?:within|in|by|before|next)\b", re.I)


def read(text: str) -> dict | None:
    """{"field", "value", "said", "more": [the other changes]} for a change asked to the funding case, else None. Every change
    in the message is read (the owner, 25 Oct: "…to 45000 and the timing to within 3 months" changed only the first)."""
    text = str(text or "").strip()
    if not (_EDIT.search(text) or _MAKE_IT.search(text)) or not _ABOUT_FUNDING.search(text):
        return None
    changes = []
    for n, clause in enumerate(x for x in _AND.split(text) if x.strip()):
        change = _one(clause if n == 0 or _EDIT.search(clause) or _MAKE_IT.search(clause) or _WHEN.search(clause.strip()) else f"change {clause}")
        if change and change["field"] not in {c["field"] for c in changes}:
            changes.append(change)
    if not changes:
        return None
    return {**changes[0], "more": changes[1:]}


def _one(clause: str) -> dict | None:
    """One change: "change the amount to £45,000", "the timing to within 3 months", or a date on its own ("within 3 months")."""
    from app.modules.agent import goals
    clause = clause.strip().rstrip(".")
    plain = _MAKE_IT.search(clause)
    if plain and not re.search(r"\bto\b", clause, re.I):
        return _amount_change(plain.group("value"))
    if _WHEN.search(clause) and not _EDIT.search(clause):
        when = goals.end_of_month(clause)
        return {"field": "receipt_date", "value": when, "said": clause} if when else None
    m = _EDIT.search(clause)
    if not m:
        return None
    what = m.group("what") or ""
    field = next((f for f, pattern in _FIELDS if re.search(pattern, what, re.I)), None)
    said = m.group("value").strip().rstrip(".")
    if field is None and re.fullmatch(r"\s*(?:it|this|that|the funding|my funding|funding|the case)?\s*", what, re.I) and re.search(r"\d", said):
        field = "target_amount"      # "make it 45000": the amount
    if field is None:
        return None
    from app.modules.agent import goals
    from app.modules.agent.intake_turn import currency_of
    if field == "target_amount":
        return _amount_change(said)
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


def _amount_change(said: str) -> dict | None:
    """The amount in "£45,000", "45k" or a bare "45000"."""
    from app.modules.agent import goals
    from app.modules.agent.intake_turn import currency_of
    n = goals.extract(said, "need_funding").get("amount")
    if not n:
        m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b", said, re.I)
        if not m:
            return None
        n = float(m.group(1).replace(",", "")) * {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6}.get((m.group(2) or "").lower(), 1)
    return {"field": "target_amount", "value": float(n), "said": said, "currency": currency_of(said)}


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
    every = [change, *(change.get("more") or [])]

    def said(c: dict) -> str:
        was = data.get(c["field"]) if c["field"] != "route_preference" else (data.get("route_preference") or data.get("route"))
        return f"the {_LABEL[c['field']]} from {shown(c['field'], was, currency)} to {shown(c['field'], c['value'], c.get('currency') or currency)}"
    parts = [said(c) for c in every]
    question = f"Change {parts[0]}?" if len(parts) == 1 else f"Change {', '.join(parts[:-1])} and {parts[-1]}?"
    if change.get("currency") and currency and change["currency"] != currency:
        question += f" That amount is in {change['currency']}; your case is in {currency}."
    body = {"changes": {c["field"]: c["value"] for c in every}}
    return {"kind": "answer", "conversational": False, "message": question,
            "offers": [{"label": "Yes, update", "post": {"url": f"/businesses/{case['business_id']}/funding-cases/{case['id']}/agent-edit", "body": body}},
                       {"label": "Cancel", "dismiss": True}]}


def provenance(changes: dict, today: date | None = None) -> dict:
    today = today or date.today()
    return {k: f"Changed via Agent, {today.day} {today.strftime('%b')}" for k in changes}
