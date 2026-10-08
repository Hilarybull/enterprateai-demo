"""Put right the open Agent tasks that were started before the reader and the plan gate were fixed.

Run once; safe to run again (a task already right is left alone, and a task blocked for its plan
is released by the same run if the plan now includes it).

    python -m app.modules.agent.repair                 # say what would change, change nothing
    python -m app.modules.agent.repair --apply         # change it
    python -m app.modules.agent.repair --apply <business_id> [<business_id> ...]

For each task that is still open (running, or waiting for an answer or an approval; nothing sent):
  1. The request is read again with the shared reader, and a prefilled value is replaced only where
     the stored one is plainly wrong: a customer called "business proposal" or "my latest
     marketplace RFQ"; a scope that still has the customer's name in it; an idea taken from the
     profile when the request names one. Anything the owner typed or changed is never touched.
  2. The plan is checked again. A task the workspace's plan does not include is held ("blocked",
     reason "plan"): nothing runs, nothing is charged, and its tile offers Upgrade or Cancel.
  3. Every change is written to the task's history: "Updated by the Agent: customer set to ABC Ltd".
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.modules.agent import config, said
from app.modules.agent.models import RUN_AWAITING_APPROVAL, RUN_CREATED, RUN_RUNNING, SUB_BLOCKED
from app.modules.agent.workflows import WORKFLOWS

logger = logging.getLogger(__name__)

OPEN = (RUN_CREATED, RUN_RUNNING, RUN_AWAITING_APPROVAL)
_NAME_KEYS = ("customer_name", "vendor_name", "party_name", "recipient")
_SCOPE_KEYS = ("solution", "scope", "description", "work", "subject", "about")
IDEA_TASKS = ("idea_validation", "market_size", "business_plan_draft")


def _request_text(run: dict) -> str:
    state = run.get("state") or {}
    return str((state.get("params") or {}).get("body") or run.get("goal") or "").strip()


def _typed(run: dict) -> set[str]:
    """The fields the owner has answered or edited themselves: never changed here."""
    state = run.get("state") or {}
    keys = set((state.get("answers") or {}).keys()) - ({"description"} if state.get("idea_from_message") else set())
    return keys | set(state.get("edited") or []) | {str(e.get("field")) for e in state.get("edits") or [] if isinstance(e, dict)}


def fix_prefills(run: dict, today) -> list[str]:
    """Correct the plainly wrong prefills on one task, in place. Returns what was changed, in words."""
    from app.modules.agent.summary import bad_subject
    q = run.get("pending_question") or {}
    fields = [f for f in q.get("fields") or [] if isinstance(f, dict)]
    text = _request_text(run)
    if not text:
        return []
    typed, changes = _typed(run), []
    told = said.read(text, today) if fields else {}
    party = str(told.get("party") or "").strip()
    by_key = {f.get("key"): f for f in fields}

    for key in _NAME_KEYS:
        f = by_key.get(key)
        if not f or key in typed or not isinstance(f.get("default"), str) or not f["default"].strip():
            continue
        if bad_subject(f["default"], run.get("workflow_key")) and f["default"].strip().lower() != party.lower():
            f["default"], f["said"], f["said_text"] = party, bool(party) or None, None
            picker = by_key.get("customer_id") or by_key.get("vendor_id")
            if picker and picker.get("default") == "new":
                picker["said_text"] = f"{party} (new)" if party else None
            changes.append(f"customer set to {party}" if party else "customer cleared, to be asked for")

    name = next((str(by_key[k]["default"]).strip() for k in _NAME_KEYS if by_key.get(k) and isinstance(by_key[k].get("default"), str) and by_key[k]["default"].strip()), party)
    if name:
        for key in _SCOPE_KEYS:
            f = by_key.get(key)
            if not f or key in typed or not isinstance(f.get("default"), str):
                continue
            was = f["default"].strip()
            cut = re.sub(rf"^\s*(?:for\s+)?{re.escape(name)}\s*(?:,|:|\bfor\b|\babout\b|\bregarding\b)\s*", "", was, count=1, flags=re.I).strip()
            if cut and cut != was:
                f["default"] = cut[:1].upper() + cut[1:]
                if f.get("said_text"):
                    f["said_text"] = cut
                changes.append(f"{str(f.get('label') or key).lower()} set to {f['default']}")

    if run.get("workflow_key") in IDEA_TASKS and "description" not in typed:
        idea = said.idea_in(text)
        state = run.setdefault("state", {})
        answers = state.setdefault("answers", {})
        if idea and answers.get("description") != idea:
            answers["description"] = idea
            state["idea_from_message"] = True
            f = by_key.get("description")
            if f:
                f["default"], f["hint"] = idea, "Taken from what you asked for. Change it if it isn't quite right."
                q["question"] = f"Is this the idea? {idea}"
            changes.append(f"idea set to {idea}")
    return changes


def hold_for_plan(run: dict, plan: str) -> str | None:
    """Hold a task its workspace's plan does not include, or release one the plan now includes. Returns what was done, or None."""
    key = run.get("workflow_key") or ""
    wf = WORKFLOWS.get(key)
    if not wf:
        return None
    state = run.setdefault("state", {})
    held = run.get("substatus") == SUB_BLOCKED and run.get("reason_code") == "plan"
    allowed = config.plan_allows(plan, wf.capability)
    if not allowed and not held:
        need = config.PLAN_LABEL[config.CAPABILITY_MIN_PLAN.get(wf.capability, "starter_insight")]
        state["held_for_plan"] = {"status": run.get("status"), "substatus": run.get("substatus"), "reason_code": run.get("reason_code"),
                                  "pending_question": run.get("pending_question"), "next_action": run.get("next_action"), "plan_required": need}
        run.update({"substatus": SUB_BLOCKED, "reason_code": "plan", "pending_question": None, "wake_at": None,
                    "next_action": f"On the {need} plan. Upgrade or cancel."})
        return f"held: {wf.title} is on the {need} plan"
    if allowed and held:
        was = state.pop("held_for_plan", None) or {}
        run.update({"substatus": was.get("substatus"), "reason_code": was.get("reason_code"), "pending_question": was.get("pending_question"),
                    "next_action": was.get("next_action")})
        return "released: the plan now includes it"
    return None


async def repair_business(orch, business_id: str, *, apply: bool = False) -> list[dict[str, Any]]:
    """Every open task of one business. Returns one entry per task that changes (or would)."""
    store = orch.rt.store
    ent = await orch.entitlement(business_id)
    today = orch.rt.clock().date()
    out: list[dict[str, Any]] = []
    for run in await store.list_runs(business_id, limit=1000):
        if run.get("status") not in OPEN:
            continue
        before_credits = list((run.get("state") or {}).get("credits") or [])
        changes = fix_prefills(run, today)
        held = hold_for_plan(run, ent["plan"])
        if not changes and not held:
            continue
        entry = {"business_id": business_id, "run_id": run["id"], "task": run.get("workflow_key"), "changes": changes, "plan": held}
        out.append(entry)
        if not apply:
            continue
        (run.get("state") or {})["credits"] = before_credits      # nothing is charged for being put right
        await store.update_run(run["id"], {k: run.get(k) for k in ("substatus", "reason_code", "pending_question", "next_action", "state", "wake_at")})
        for change in changes:
            await orch._audit(run, "agent_updated", "system", {"summary": f"Updated by the Agent: {change}"})
        if held:
            await orch._audit(run, "agent_updated", "system", {"summary": f"Updated by the Agent: {held}", "reason_code": "plan"})
    return out


async def _main(args: list[str]) -> None:
    from app.core.supabase import sb_select
    from app.modules.agent.router import get_orchestrator
    apply = "--apply" in args
    wanted = [a for a in args if not a.startswith("--")]
    orch = get_orchestrator()
    ids = wanted or [str(w["id"]) for w in await sb_select("workspaces", columns="id") or []]
    total = 0
    for business_id in ids:
        try:
            for e in await repair_business(orch, business_id, apply=apply):
                total += 1
                print(f"{business_id} {e['run_id']} {e['task']}: {'; '.join(e['changes'] + ([e['plan']] if e['plan'] else []))}")
        except Exception as exc:      # noqa: BLE001 - one business that can't be read doesn't stop the rest
            print(f"{business_id}: skipped ({exc})")
    print(f"{total} task{'s' if total != 1 else ''} {'changed' if apply else 'would change'}." + ("" if apply else " Run again with --apply to change them."))


if __name__ == "__main__":
    import asyncio
    import sys
    asyncio.run(_main(sys.argv[1:]))
