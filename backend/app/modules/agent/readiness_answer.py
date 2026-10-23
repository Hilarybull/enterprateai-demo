"""Readiness questions on the dashboard Agent, answered from the case summary by fixed rules (G6, 23 Oct).

"How ready is my drone cleaning launch?" is matched to the launch plan the owner names, by its words; none matching, the
plans there are are listed with "Start a new launch plan". "How ready am I for a £20k grant?" goes to Funding Readiness,
asking whether to update the case on record or start a new one when the need differs. The one score (the summary's),
plain words (never the checklist's own wording), and every reply ends with buttons, never on a bare question.
"""
from __future__ import annotations

import re
from typing import Any

_READY = re.compile(r"\b(ready|readiness|score|how (?:am i|are we) doing|what(?:'s| is) (?:next|missing|left)|(?:do|doing) next|next steps?|where do i stand)\b", re.I)
_FUNDING = re.compile(r"\b(fund(?:s|ing|ed)?|grants?|loans?|invest(?:ment|ors?)?|equity|raise|raising|borrow)\b", re.I)
_LAUNCH = re.compile(r"\b(launch(?:es|ing)?)\b", re.I)
_ROUTE = (("grant", r"\bgrants?\b"), ("loan", r"\b(loans?|borrow\w*)\b"), ("equity", r"\b(equity|invest(?:ment|ors?)?)\b"))
_MONEY = re.compile(r"[£$€₦]\s?\d[\d,.]*\s*(?:k|m|thousand|million)?\b|\b\d[\d,.]*\s*(?:k|m|thousand|million)\b", re.I)
_STOP = {"ready", "readiness", "launch", "launching", "funding", "fund", "grant", "loan", "score", "what", "whats", "next", "with",
         "plan", "case", "about", "much", "need", "have", "does", "this", "that", "they", "them", "there", "where", "stand", "doing",
         "going", "want", "would", "could", "should", "your", "mine", "first", "missing", "steps"}


def _words(text: Any) -> set:
    return set(re.findall(r"[a-z]{4,}", str(text or "").lower())) - _STOP


def _amount(text: str) -> float | None:
    m = _MONEY.search(text or "")
    if not m:
        return None
    raw = m.group(0).lower()
    n = re.search(r"\d[\d,.]*", raw)
    try:
        value = float(n.group(0).replace(",", ""))
    except (AttributeError, ValueError):
        return None
    return value * (1_000_000 if re.search(r"(m|million)\b", raw) else 1_000 if re.search(r"(k|thousand)\b", raw) else 1)


# A request to start or set something up ("I need new launch readiness", "I want a £20k grant"): the flow runs and collects
# the details, never a status answer in its place (the owner, 23 Oct: "why is it not collecting my details")
_START = re.compile(r"\b(i|we)\s+(?:need|want|would like|'d like|am looking|are looking)\b|\b(start|new|create|set up|setup|begin|apply|get)\b|^\s*(?:help me|let'?s)\b", re.I)
_QUESTION = re.compile(r"^\s*(how|what|whats|what's|where|am i|are we|is my|is it|which|do i|can i)\b|\?\s*$", re.I)


def asked_about(text: str) -> str | None:
    """'funding', 'launch' or None: is this a question about where a case stands (how ready, what is next)? Only a question:
    anything asking to start, set up or apply goes to its flow."""
    t = str(text or "").strip()
    if not _QUESTION.search(t) or (_START.search(t) and not re.search(r"\b(how ready|ready|score|next|missing|left)\b", t, re.I)):
        return None
    if not _READY.search(t):
        return None
    if _FUNDING.search(t):
        return "funding"
    if _LAUNCH.search(t):
        return "launch"
    return None


def _short(name: str, size: int = 40) -> str:
    """A button's name cut at a word, never mid-word."""
    name = str(name).split(",")[0].strip()
    return name if len(name) <= size else name[:size].rsplit(" ", 1)[0] + "…"


def _status(summary: dict, kind: str) -> str:
    score = summary.get("score")
    if summary.get("classification") is None:
        return "not checked yet"
    words = ("ready to approach funders" if kind == "funding" else "ready to launch") if summary.get("classification") == "ready" else "not ready yet"
    shown = f"{round(score)}/100{' so far' if summary.get('score_partial') else ''}" if isinstance(score, (int, float)) else "not scored yet"
    return f"{shown}, {words}"


def _next(summary: dict) -> str:
    n = summary.get("open_actions") or 0
    return f" {n} {'thing' if n == 1 else 'things'} to do first." if n else ""


def answer(text: str, kind: str, subjects: list[dict]) -> dict:
    """The reply: a message and its buttons. `subjects`: this business's open cases or plans of `kind`, each with `id`,
    `data` and `summary`, newest first."""
    base = "/funding" if kind == "funding" else "/launch"
    noun = "funding case" if kind == "funding" else "launch plan"
    name_of = lambda s: str(s.get("title") or (s.get("data") or {}).get("title") or (s.get("data") or {}).get("name") or (s.get("summary") or {}).get("title") or noun)   # noqa: E731
    named = _words(text)
    if kind == "funding":
        named -= {"grant", "grants", "loan", "loans", "equity", "investment", "investors", "money"}
    matched = [s for s in subjects if named and named & _words(name_of(s) + " " + str((s.get("data") or {}).get("purpose") or "") + " "
                                                               + str((s.get("data") or {}).get("sell") or (s.get("data") or {}).get("description") or ""))]
    new_label = f"Start a new {noun}"
    new_button = {"label": new_label, "to": f"{base}?new=1"}
    if kind == "funding":
        amount = _amount(text)
        route = next((r for r, p in _ROUTE if re.search(p, text, re.I)), None)
        current = (matched or subjects or [None])[0]
        if current is not None and (amount or route):
            data = current.get("data") or {}
            differs = (amount and data.get("target_amount") not in (None, "") and abs(float(data["target_amount"]) - amount) > 0.5) or (
                route and data.get("route_preference") and data["route_preference"] != route)
            if differs:
                return {"kind": "answer", "conversational": False,
                        "message": f"You have “{name_of(current)}” ({_status(current.get('summary') or {}, kind)}). This sounds like a different need. "
                                   "Replace it with this need, or update its details? The current one is kept in History.",
                        "offers": [{"label": "Replace with this need", "to": f"{base}/{current['id']}?tab=answers&field=title"},
                                   {"label": "Update the details", "to": f"{base}/{current['id']}?tab=answers"},
                                   {"label": "Not now", "dismiss": True}]}
    if matched or (subjects and not named):
        pick = (matched or subjects)[0]
        summary = pick.get("summary") or {}
        # The count and the case page's own steps, never the checklist's wording in the reply
        message = f"“{name_of(pick)}”: {_status(summary, kind)}." + (" Your next steps are on its page." if summary.get("classification") != "ready" else "")
        offers = [{"label": f"Open “{_short(name_of(pick))}”", "to": f"{base}/{pick['id']}"}]
        if summary.get("freshness") == "stale" or summary.get("classification") is None:
            offers.append({"label": "Run the check again", "to": f"{base}/{pick['id']}?check=again"})
        others = [s for s in subjects if s is not pick]
        if others:
            offers.append({"label": f"See all {noun}s", "to": base})
        elif kind == "launch":
            offers.append(new_button)      # several launch plans; one funding case
        return {"kind": "answer", "conversational": False, "message": message, "offers": offers[:3]}
    if not subjects:
        return {"kind": "answer", "conversational": False, "message": f"You don't have a {noun} yet. I can set one up and check it, for free.",
                "offers": [new_button, {"label": "Not now", "dismiss": True}]}
    listed = ", ".join(f"“{name_of(s)}”" for s in subjects[:3])
    return {"kind": "answer", "conversational": False,
            "message": f"I can't find a {noun} for that. Your {noun}s: {listed}.",
            "offers": [new_button] + [{"label": f"Open “{_short(name_of(s))}”", "to": f"{base}/{s['id']}"} for s in subjects[:2]]}
