"""One-off (A2 follow-up, owner's decision 14 Oct): undo what an Agent idea task wrote into a business's own profile and
validation before the A2 fix, when the idea was a different one from the business's offer.

Found by the record itself: every profile field an Agent idea task wrote carries provenance (source.kind "agent_task",
its run and the offering it was said about). The value before is the newest workspace snapshot taken before that run
(Mongo workspace_snapshots); a field absent then is removed now. A business validation the same run wrote (source
"agent", the run's own score) goes back the same way. Nothing is guessed:
  - no snapshot before the run: the field is listed for the owner to confirm, and cleared only on --apply with
    --clear-unknown;
  - the business had no offer of its own before the run (so the idea may have been theirs): listed, not changed.
The idea itself is kept as a separate idea under the business (agent_ideas), with its answers and its score, as A2 does.

    python scripts/restore_idea_contamination.py            # look only
    python scripts/restore_idea_contamination.py --apply    # only after the look-only output is approved
"""
import asyncio
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")
IDEA_TASKS = ("idea_validation", "market_size", "business_plan_draft", "sales_letter_draft")
MISSING = object()


def own_offer(profile: dict) -> str:
    services = [str(s.get("service_name") or s.get("name") or "") for s in profile.get("services") or [] if isinstance(s, dict)]
    return " ".join(x for x in [str(profile.get("description") or ""), *services] if x and x != "None").strip()


def plan_restore(workspace: dict, runs: dict, snapshots: list[dict]) -> dict:
    """{"restore": [...], "confirm": [...], "ideas": [...]} for one workspace. Pure: reads only."""
    from app.modules.agent import answer_memory
    from app.modules.agent.workflows import _idea_key
    data = workspace.get("data") or {}
    profile = data.get("workspace_profile") or {}
    out = {"restore": [], "confirm": [], "ideas": []}
    by_run: dict[str, list[str]] = {}
    for field, prov in (profile.get("provenance") or {}).items():
        src = (prov or {}).get("source") or {}
        if src.get("kind") == "agent_task" and src.get("workflow") in IDEA_TASKS and src.get("run_id"):
            by_run.setdefault(src["run_id"], []).append(field)
    for run_id, fields in sorted(by_run.items()):
        run = runs.get(run_id) or {}
        started = str(run.get("created_at") or "")
        before = max((s for s in snapshots if str(s.get("created_at") or "") < started), key=lambda s: str(s.get("created_at")), default=None) if started else None
        said = str(((profile.get("provenance") or {}).get(fields[0]) or {}).get("source", {}).get("offering") or "")
        old_profile = ((before or {}).get("data") or {}).get("workspace_profile") or {}
        theirs = own_offer(old_profile)
        base = {"workspace": workspace["id"], "name": profile.get("company_name") or workspace.get("name"), "run_id": run_id, "idea": said}
        if not before:
            out["confirm"] += [{**base, "field": f, "now": profile.get(f), "why": "no snapshot before the run: the earlier value isn't known"} for f in fields]
            continue
        if not theirs or answer_memory.same_offering(said, theirs):
            out["confirm"] += [{**base, "field": f, "now": profile.get(f), "why": "the business had no other offer then: the idea may be its own"} for f in fields]
            continue
        for f in fields:
            was = old_profile.get(f, MISSING)
            out["restore"].append({**base, "section": "workspace_profile", "field": f, "now": profile.get(f), "before": None if was is MISSING else was,
                                   "remove": was is MISSING or was in (None, ""), "snapshot": str(before.get("created_at"))[:19]})
        score = ((run.get("state") or {}).get("outcome") or {}).get("score")
        validation = data.get("validation") or {}
        if validation.get("source") == "agent" and score is not None and validation.get("overall_score") == score:
            was = ((before or {}).get("data") or {}).get("validation", MISSING)
            out["restore"].append({**base, "section": "validation", "field": "validation", "now": validation, "before": None if was is MISSING else was,
                                   "remove": was is MISSING or not was, "snapshot": str(before.get("created_at"))[:19]})
        answers = (run.get("state") or {}).get("answers") or {}
        key = _idea_key(answers.get("description") or said)
        if key not in (data.get("agent_ideas") or {}):
            out["ideas"].append({**base, "key": key, "record": {
                "description": answers.get("description") or said, "customer": answers.get("customer"), "problem": answers.get("problem"),
                "created_at": started, "updated_at": started, "run_id": run_id, "restored_from_business": True,
                "results": [{**((run.get("state") or {}).get("outcome") or {}), "at": run.get("completed_at") or started, "run_id": run_id}]}})
    return out


def apply_restore(data: dict, found: dict) -> dict:
    d = copy.deepcopy(data)
    profile = d.setdefault("workspace_profile", {})
    for r in found["restore"]:
        if r["section"] == "validation":
            if r["remove"]:
                d.pop("validation", None)
            else:
                d["validation"] = r["before"]
        else:
            if r["remove"]:
                profile.pop(r["field"], None)
            else:
                profile[r["field"]] = r["before"]
            (profile.get("provenance") or {}).pop(r["field"], None)
    for i in found["ideas"]:
        d.setdefault("agent_ideas", {})[i["key"]] = i["record"]
    return d


def report(found: dict) -> str:
    lines = [f"Restore: {len(found['restore'])}"]
    for r in found["restore"]:
        before = "(absent: removed)" if r["remove"] else repr(r["before"])[:80]
        lines.append(f"  {r['name']}  {r['section']}.{r['field']}\n      now:    {repr(r['now'])[:100]}\n      before: {before}   (snapshot {r['snapshot']}, run {r['run_id'][:8]})")
    lines.append(f"Ideas kept as their own record: {len(found['ideas'])}")
    for i in found["ideas"]:
        res = i["record"]["results"][0]
        lines.append(f"  {i['name']}  agent_ideas[{i['key']!r}]: {i['record']['description']!r}, customer {i['record']['customer']!r}, score {res.get('score')}")
    lines.append(f"Needs owner confirmation (unchanged): {len(found['confirm'])}")
    lines += [f"  {c['name']}  {c['field']} = {repr(c['now'])[:70]}  ({c['why']})" for c in found["confirm"]]
    return "\n".join(lines)


async def main(apply: bool) -> None:
    from app.core.database import get_mongo_db
    from app.core.supabase import sb_select
    workspace_arg = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--workspace-id"), None)
    if apply and not workspace_arg:
        raise SystemExit("--apply requires --workspace-id so unrelated workspaces cannot be changed.")
    workspaces = await sb_select("workspaces", filters=[("id", "eq", workspace_arg)] if workspace_arg else None,
                                 order="created_at", desc=False, limit=20000) or []
    run_rows = await sb_select("agent_workflow_runs", filters=[("workflow_key", "in", list(IDEA_TASKS))], limit=20000) or []
    runs = {r["id"]: r for r in run_rows}
    total = {"restore": [], "confirm": [], "ideas": []}
    for w in workspaces:
        prov = ((w.get("data") or {}).get("workspace_profile") or {}).get("provenance") or {}
        if not any(((p or {}).get("source") or {}).get("kind") == "agent_task" for p in prov.values()):
            continue
        snaps = await get_mongo_db()["workspace_snapshots"].find({"workspace_id": w["id"]}).sort("created_at", 1).to_list(1000)
        found = plan_restore(w, runs, snaps)
        for k in total:
            total[k] += found[k]
        w["_found"] = found
    print(report(total))
    if not apply:
        print("\nLook only: nothing was changed. Re-run with --apply once this has been approved.")
        return
    from app.modules.agent.router import get_orchestrator
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    touched = [w for w in workspaces if w.get("_found") and (w["_found"]["restore"] or w["_found"]["ideas"])]
    path = BACKUPS / f"restore_idea_contamination_{stamp}.json"
    path.write_text(json.dumps({"found": total, "before": {w["id"]: w.get("data") for w in touched}}, default=str, indent=1), encoding="utf-8")
    print(f"backup: {path}")
    for w in touched:
        found = w["_found"]

        def _apply(data: dict) -> None:
            fixed = apply_restore(data, found)
            data.clear()
            data.update(fixed)
        await get_orchestrator().rt.business.mutate(w["id"], _apply)
        await get_orchestrator().rt.store.audit({"id": __import__("uuid").uuid4().hex, "business_id": w["id"], "run_id": None, "actor_id": "owner",
                                                 "event_type": "idea_contamination_restored", "created_at": datetime.now(timezone.utc).isoformat(),
                                                 "detail": {"restored": [f"{r['section']}.{r['field']}" for r in found["restore"]], "ideas": [i["key"] for i in found["ideas"]]}})
        print(f"restored {w['id']}")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
