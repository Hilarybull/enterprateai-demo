"""One-off (F1, F2): find Agent charges that should be given back, and business plan drafts made more than once.

  1. Work the Agent started by itself that never reached the owner: cancelled, or stopped and not to be tried again,
     with credits charged and nothing given back yet. All of it is refunded.
  2. The same action charged twice on one task (F2: "Reading the enquiry" twice in the same minute): the extra charges
     are refunded. Only the same feature, for the same thing, within DOUBLE_WINDOW_SECONDS; reminders sent days apart
     are separate actions and are left alone.
  3. Business plan drafts one task made more than once (F1: four drafts from one automatic plan): the one the task
     points at is kept and the others are removed. A draft is counted as the task's only when it was made while the
     task ran, in the task's own workspace.

Nothing is changed without --apply. With --apply, everything it removes is saved to BACKUPS first, and each refund is
given once (the wallet transaction carries the task's key; a second run of the script finds it and skips it).

    python scripts/cleanup_agent_charges.py                 # look only: prints what it would do
    python scripts/cleanup_agent_charges.py --apply         # do it (only after the look-only output is approved)
    python scripts/cleanup_agent_charges.py --refund-run ID # also refund this task in full (the owner's decision, by id)
"""
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")
AUTOMATIC = "business_event"
DOUBLE_WINDOW_SECONDS = 120
PLAN_SLACK = timedelta(minutes=5)
RETRIED_BY_ITSELF = {"stalled", "action_failed", "unexpected_error", "delivery_status_uncertain"}      # Orchestrator.AUTO_RETRY_REASONS


def _at(value) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _final_and_undelivered(run: dict, retry_reasons: set[str]) -> bool:
    status = run.get("status")
    if status == "cancelled":
        return True
    if status == "failed":
        state = run.get("state") or {}
        out_of_tries = run.get("reason_code") == "retries_exhausted" or int(state.get("auto_retries") or 0) >= 3
        return out_of_tries or run.get("reason_code") not in retry_reasons
    return False


def plan_cleanup(runs: list[dict], docs: list[dict], retry_reasons: set[str] = RETRIED_BY_ITSELF, refund_runs: set[str] = frozenset()) -> dict:
    """What should be given back and removed, from the tasks and the Business Blueprints documents. Pure: reads only."""
    refunds, removals = [], []
    for run in runs:
        state = run.get("state") or {}
        charges = [c for c in state.get("credits") or [] if int(c.get("credits") or 0) > 0]
        if not charges or state.get("refunded"):
            continue
        payer = run.get("requester_id")
        if run["id"] in refund_runs:
            refunds.append({"business_id": run.get("business_id"), "user_id": payer, "run_id": run["id"], "task": run.get("title") or run.get("workflow_key"),
                            "credits": sum(int(c["credits"]) for c in charges), "why": "named for a full refund", "key": f"refund:{run['id']}"})
            continue
        if run.get("source_channel") == AUTOMATIC and _final_and_undelivered(run, retry_reasons):
            refunds.append({"business_id": run.get("business_id"), "user_id": payer, "run_id": run["id"], "task": run.get("title") or run.get("workflow_key"),
                            "credits": sum(int(c["credits"]) for c in charges), "why": f"started by the Agent, {run.get('status')}, never delivered",
                            "key": f"refund:{run['id']}"})
            continue      # all of it is given back: no double counted on top
        seen: dict[tuple, datetime] = {}
        for i, c in enumerate(sorted(charges, key=lambda c: str(c.get("at") or ""))):
            mark, when = (c.get("feature"), c.get("for")), _at(c.get("at"))
            first = seen.get(mark)
            done_doubles = {x.get("key") for x in state.get("refunded_doubles") or []}
            if first and when and (when - first).total_seconds() <= DOUBLE_WINDOW_SECONDS and f"refund:{run['id']}:double:{i}" not in done_doubles:
                refunds.append({"business_id": run.get("business_id"), "user_id": payer, "run_id": run["id"], "task": run.get("title") or run.get("workflow_key"),
                                "credits": int(c["credits"]), "why": f"charged twice: {c.get('feature')} for {c.get('for')} at {c.get('at')}",
                                "key": f"refund:{run['id']}:double:{i}"})
            elif when:
                seen[mark] = when
    for run in runs:
        if run.get("workflow_key") != "business_plan_draft":
            continue
        state = run.get("state") or {}
        kept = (((state.get("outcome") or {}).get("plan") or {}).get("document_id")
                or ((state.get("made") or {}).get("business_plan_full") or {}).get("document_id"))
        start, end = _at(run.get("created_at")), _at(run.get("updated_at") or run.get("completed_at"))
        if not start or not end:
            continue
        made = [d for d in docs if d.get("type") == "business_plan" and d.get("workspace_id") == run.get("business_id")
                and (t := _at(d.get("created_at"))) and start <= t <= end + PLAN_SLACK]
        if len(made) < 2:
            continue
        keep = kept if kept in {d["id"] for d in made} else max(made, key=lambda d: str(d.get("created_at")))["id"]
        removals += [{"business_id": run.get("business_id"), "run_id": run["id"], "document_id": d["id"], "title": d.get("title"),
                      "created_at": d.get("created_at"), "kept": keep} for d in made if d["id"] != keep]
    return {"refunds": refunds, "removals": removals}


def report(found: dict) -> str:
    lines = [f"Refunds: {len(found['refunds'])}, {sum(r['credits'] for r in found['refunds'])} credits"]
    for r in found["refunds"]:
        lines.append(f"  {r['business_id']}  {r['run_id']}  {r['task']:<28} {r['credits']:>4}  {r['why']}")
    lines.append(f"Duplicate business plan drafts to remove: {len(found['removals'])}")
    for d in found["removals"]:
        lines.append(f"  {d['business_id']}  {d['document_id']}  {d['title']!r}  made {d['created_at']}  (task {d['run_id']} keeps {d['kept']})")
    return "\n".join(lines)


async def _load() -> tuple[list[dict], list[dict]]:
    from app.core.supabase import sb_select
    runs = await sb_select("agent_workflow_runs", order="created_at", desc=True, limit=20000) or []
    docs = await sb_select("blueprint_documents", filters=[("type", "eq", "business_plan")], order="created_at", desc=True, limit=20000) or []
    return runs, docs


async def main(apply: bool, refund_runs: set[str] = frozenset()) -> None:
    from app.modules.agent.orchestrator import Orchestrator
    runs, docs = await _load()
    found = plan_cleanup(runs, docs, set(Orchestrator.AUTO_RETRY_REASONS), refund_runs)
    print(report(found))
    if not apply:
        print("\nLook only: nothing was changed. Re-run with --apply once this has been approved.")
        return
    from app.core.supabase import sb_update
    from app.modules.agent.services import CreditMeter
    from app.modules.blueprint.repository import delete_document
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    gone = [d for d in docs if d["id"] in {r["document_id"] for r in found["removals"]}]
    (BACKUPS / f"cleanup_agent_charges_{stamp}.json").write_text(json.dumps({"found": found, "documents": gone}, default=str, indent=1), encoding="utf-8")
    meter, by_run = CreditMeter(), {r["id"]: r for r in runs}
    for r in found["refunds"]:
        given = await meter.refund(r["user_id"], r["credits"], f"Refund: {r['task']} ({r['why']})", r["key"])
        run = by_run[r["run_id"]]
        state = run.get("state") or {}
        if r["key"] == f"refund:{r['run_id']}":
            state["refunded"] = {"credits": r["credits"], "at": datetime.now(timezone.utc).isoformat(), "given": bool(given), "by": "cleanup"}
        else:
            state.setdefault("refunded_doubles", []).append({"credits": r["credits"], "key": r["key"], "given": bool(given)})
        await sb_update("agent_workflow_runs", payload={"state": state}, filters=[("id", "eq", r["run_id"])])
        print(f"refund {'given' if given else 'already given'}: {r['run_id']} {r['credits']}")
    for d in found["removals"]:
        owner = next((x.get("user_id") for x in gone if x["id"] == d["document_id"]), None)
        await delete_document(user_id=owner, document_id=d["document_id"])
        print(f"removed {d['document_id']} ({d['title']!r})")
    # A business's own plan pointer that named a removed draft names the kept one instead (never left pointing at nothing).
    from app.modules.agent.router import get_orchestrator
    removed = {d["document_id"]: d["kept"] for d in found["removals"]}
    for business_id in sorted({d["business_id"] for d in found["removals"]}):
        def _repoint(data: dict) -> list[str]:
            plan = (data.get("agent_studio") or {}).get("plan") or {}
            if plan.get("document_id") in removed:
                was = plan["document_id"]
                plan["document_id"] = removed[was]
                return [was]
            return []
        changed = await get_orchestrator().rt.business.mutate(business_id, _repoint)
        for was in changed or []:
            print(f"business {business_id}: plan pointer {was} -> {removed[was]}")


if __name__ == "__main__":
    named = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--refund-run"}
    asyncio.run(main("--apply" in sys.argv, named))
