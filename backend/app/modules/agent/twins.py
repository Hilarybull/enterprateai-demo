"""One task asked twice (QA U8): tasks of the same kind still waiting on the same first question, nothing answered
in any of them. Needs You shows one, a new request opens the one already waiting, and housekeeping closes the rest.

A task about the business as a whole (Idea Validation, Market Size, Plan Draft) is one per business, whenever it was
started. Any other task is a twin only when it is the very same request sent again within a few minutes (a double
send): two invoices waiting at the same question may well be two invoices the owner wants."""
from __future__ import annotations

import json
from datetime import datetime

from app.modules.agent.models import RUN_RUNNING, SUB_WAITING_INFO

DOUBLE_SEND_S = 600

# Tasks about the business as a whole: one at a time per business.
ONE_PER_BUSINESS = ("idea_validation", "market_size", "business_plan_draft")


def waiting_on_first_question(run: dict) -> bool:
    """Running, stopped at a question, and nothing answered in it yet."""
    q = run.get("pending_question") or {}
    return (run.get("status") == RUN_RUNNING and run.get("substatus") == SUB_WAITING_INFO and bool(q.get("fields"))
            and not q.get("optional") and not ((run.get("state") or {}).get("answers")))


def question_signature(run: dict) -> tuple:
    """What a waiting task is asking: its kind, the question and the fields it wants; for a task that isn't one per
    business, the request that started it too."""
    q = run.get("pending_question") or {}
    asked = (run.get("workflow_key"), str(q.get("question") or "").strip().lower(),
             tuple(sorted(str(f.get("key")) for f in q.get("fields") or [] if isinstance(f, dict))))
    if run.get("workflow_key") in ONE_PER_BUSINESS:
        return asked
    request = (str(run.get("raw_input") or "").strip().lower(), json.dumps(run.get("params") or {}, sort_keys=True, default=str))
    return (*asked, *request)


def _at(run: dict) -> float | None:
    try:
        return datetime.fromisoformat(str(run.get("created_at")).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def twins(runs: list[dict], workflow_key: str) -> list[dict]:
    """The tasks of this kind still waiting on their first answer, newest first."""
    found = [r for r in runs if r.get("workflow_key") == workflow_key and waiting_on_first_question(r)]
    return sorted(found, key=lambda r: str(r.get("created_at") or ""), reverse=True)


def stale_twins(runs: list[dict]) -> list[dict]:
    """Every task that is an older copy of another still waiting on the same first question."""
    groups: dict[tuple, list[dict]] = {}
    for run in runs:
        if waiting_on_first_question(run):
            groups.setdefault(question_signature(run), []).append(run)
    out: list[dict] = []
    for same in groups.values():
        same.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        if same[0].get("workflow_key") in ONE_PER_BUSINESS:
            out += same[1:]
            continue
        for newer, older in zip(same, same[1:]):      # a double send: the same request again within minutes
            a, b = _at(newer), _at(older)
            if a is not None and b is not None and a - b <= DOUBLE_SEND_S:
                out.append(older)
    return out


def without_twins(runs: list[dict]) -> list[dict]:
    """The runs, with the older copies of a task asked twice left out."""
    stale = {id(r) for r in stale_twins(runs)}
    return [r for r in runs if id(r) not in stale]
