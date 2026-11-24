"""Answers carried from one task to the next (QA PF5; SIF-10, First-Value PRD 14: "the second task should usually
require fewer questions than the first").

What a quick check was told (who it is for, where, when, the demand evidence) is kept with the offering it was about.
The next quick check, and the launch plan, start from it: said as "From your launch check", and only for the same
offering. A value from a different idea or offering ("Busy pet owners in Manchester" for a cleaning business) is
never proposed.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

# The answers that mean the same thing in every check, and so may be carried (each key is a question key).
SHARED = ("customer", "where", "target_date", "evidence")
# Funding's "traction" is the same evidence as a launch's "evidence"; idea validation calls the offering "description".
ALIAS = {"traction": "evidence", "description": "sell"}
GOAL_WORDS = {"launch": "launch check", "price_offer": "pricing check", "need_funding": "funding check",
              "more_customers": "customer growth check", "test_idea": "idea check"}


def norm(text: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def same_offering(a: Any, b: Any) -> bool:
    """The same offering, said two ways ("home cleaning" and "Home cleaning service")."""
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    if x == y or (min(len(x), len(y)) >= 4 and (x in y or y in x)):
        return True
    # Common service noun forms should still match ("end of tenancy cleans" and
    # "end of tenancy cleaning") when an invoice is offered for the catalogue.
    def base(word: str) -> str:
        if len(word) > 5 and word.endswith("ing"):
            return word[:-3]
        if len(word) > 4 and word.endswith("s"):
            return word[:-1]
        return word
    return [base(w) for w in x.split()] == [base(w) for w in y.split()]


MONEY = ("price", "cost", "fixed_costs", "amount", "cash_in_bank")


def remember(data: dict, goal: str, answers: dict, now: datetime | None = None, result: dict | None = None, currency: str | None = None) -> None:
    """Keep what this check was told, with the offering it was about, and its latest result (QA R8-8: shown again on
    return, so the check is never redone just to reach its premium step)."""
    now = now or datetime.now(timezone.utc)
    offering = answers.get("sell") or answers.get("description")
    clean = {k: v for k, v in (answers or {}).items() if isinstance(v, (str, int, float)) and str(v).strip() and str(v).strip().lower() != "unknown"}
    # Who buys it and their problem belong to one offering: one carried over from another offering (a dog-grooming idea's
    # customers kept on a cleaning business's customer check, QA F1 30 Oct) is dropped, never saved again under this one
    for key in ("customer", "problem"):
        was = (data.get("shared_answers") or {}).get(ALIAS.get(key, key))
        if key in clean and offering and isinstance(was, dict) and str(was.get("value") or "").strip() == str(clean[key]).strip() \
                and was.get("offering") and not same_offering(was["offering"], offering):
            clean.pop(key)
    data.setdefault("quick_check_answers", {})[goal] = {"answers": clean, "offering": str(offering or "")[:200], "at": now.isoformat(),
                                                        **({"currency": currency} if currency else {}), **({"result": result} if result else {})}
    shared = data.setdefault("shared_answers", {})
    for key, value in clean.items():
        field = ALIAS.get(key, key)
        if field in SHARED or field == "sell":
            shared[field] = {"value": value, "offering": str(offering or "")[:200], "goal": goal, "at": now.isoformat(),
                             **({"currency": currency} if currency and field in MONEY else {})}      # PRD 6.1: a figure keeps its own currency


def current_offering(goal: str, data: dict | None, known: dict | None = None) -> str:
    """What this check is about: what the records say, else the offering the last check was about."""
    known = known or {}
    said = known.get("sell") or known.get("description")
    if said:
        return str(said)
    # An idea being tested is not the business's offering: never what another check is assumed to be about (QA F1, 30 Oct)
    last = max(((v.get("at") or "", v.get("offering") or "") for g, v in ((data or {}).get("quick_check_answers") or {}).items()
                if g != "test_idea" or goal == "test_idea"), default=("", ""))
    return last[1]


def recall(goal: str, data: dict | None, asked: set[str], known: dict | None = None) -> dict[str, dict]:
    """{question key: {"value", "source", "from_goal"}} for this check's questions, from earlier checks about the same offering."""
    offering = current_offering(goal, data, known)
    out: dict[str, dict] = {}
    if not offering:
        return out
    for key in asked:
        field = ALIAS.get(key, key)
        got = ((data or {}).get("shared_answers") or {}).get(field)
        if not got or key in (known or {}):      # the records win over an earlier answer
            continue
        if field == "sell" or same_offering(got.get("offering"), offering):
            out[key] = {"value": got["value"], "source": f"From your {GOAL_WORDS.get(got.get('goal'), 'earlier check')}", "from_goal": got.get("goal")}
    if "sell" in asked and "sell" not in (known or {}) and "sell" not in out:
        out["sell"] = {"value": offering, "source": "From your last check", "from_goal": None}
    return out


_MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august", "september",
                                        "october", "november", "december"), start=1)}


def target_date_from(text: Any, today: date) -> str | None:
    """A launch date from how it was said: an ISO date as it is; "Within a month", "In 1 to 3 months", "In 3 to 6
    months" as the end of that window; a month name ("March") as the 1st of the next such month. None otherwise."""
    said = str(text or "").strip().lower()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", said):
        return said
    m = re.search(r"within (a|one|1) month", said)
    if m:
        return (today + timedelta(days=30)).isoformat()
    m = re.search(r"(\d+)\s*(?:to|-|–)\s*(\d+)\s*months?", said) or re.search(r"in\s+(\d+)\s*months?", said)
    if m:
        months = int(m.groups()[-1])
        return (today + timedelta(days=30 * months)).isoformat()
    for name, n in _MONTHS.items():
        # "May" is a month only when it reads as one ("in May", "by May"), never "we may launch".
        pattern = r"\b(in|by|from|around|early|late|mid)\s+may\b|^may$" if name == "may" else rf"\b{name}\b|\b{name[:3]}\b"
        if re.search(pattern, said):
            year = today.year if n > today.month else today.year + 1
            return date(year, n, 1).isoformat()
    return None
