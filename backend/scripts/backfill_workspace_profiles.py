"""One-off, safe to run again (P0.4, 15 Oct 2026): each workspace's EMPTY profile fields filled from what it has already
said: the most recent quick-check and homepage answers (quick_check_answers), each with its source. A field the owner set
is never changed; a different value is recorded as a conflict for the owner to answer on next login.

Nothing is written without --apply. Run it only when the owner has approved the look-only output.

    python scripts/backfill_workspace_profiles.py            # look only: what each workspace would get
    python scripts/backfill_workspace_profiles.py --apply    # write it
"""
import asyncio
import copy
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def plan(data: dict) -> tuple[dict, dict]:
    """(new data, what changed) from the workspace's own remembered answers, the newest first so the latest wins an empty field."""
    from app.modules.agent import business as bz
    from app.modules.agent import profile_fill
    d = copy.deepcopy(data)
    done = {"filled": [], "conflicts": []}
    answers = dict(d.get("quick_check_answers") or {})
    # Every flow's answers: the quick checks, the answers shared between checks, and each research run's own.
    by_goal: dict[str, dict] = {}
    for k, v in (d.get("shared_answers") or {}).items():
        if isinstance(v, dict) and v.get("value") not in (None, ""):
            rec = by_goal.setdefault(v.get("goal") or "", {"answers": {}, "at": v.get("at") or "0", "goal": v.get("goal") or "", "currency": v.get("currency")})
            rec["answers"][k] = v["value"]
    for g, rec in by_goal.items():
        answers[f"_shared:{g}"] = rec
    for rid, run in (d.get("research_runs") or {}).items():
        if isinstance(run, dict) and run.get("answers"):
            answers[f"_run:{rid}"] = {"answers": {**(run.get("inputs") or {}), **run["answers"]}, "at": run.get("created_at"), "goal": run.get("goal")}
    # Newest first: an empty field takes the latest thing said about it (fill never overwrites, so the first to fill wins).
    for goal, rec in sorted(answers.items(), key=lambda kv: str((kv[1] or {}).get("at") or ""), reverse=True):
        goal = (rec or {}).get("goal") or goal
        said = (rec or {}).get("answers") or {}
        when = None
        try:
            when = datetime.fromisoformat(str(rec.get("at")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            when = datetime.now(timezone.utc)
        out = profile_fill.fill(d, said, goal, currency=rec.get("currency") if rec.get("currency") != bz.currency_of(d) else None, now=when)
        done["filled"] += out["filled"]
        done["conflicts"] += out["conflicts"]
    d.pop("profile_filled", None)      # a backfill is told on the profile page itself, not as a fresh toast
    return d, done


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select, sb_update
    rows = await sb_select("workspaces", columns="id,name,data") or []
    for row in rows:
        new, done = plan(row.get("data") or {})
        if not done["filled"] and not done["conflicts"]:
            continue
        print(f"{row['id']} {row.get('name')!r}: fills {sorted(set(done['filled']))}; conflicts {[c['field'] for c in done['conflicts']]}")
        if apply:
            await sb_update("workspaces", payload={"data": new}, filters=[("id", "eq", row["id"])])


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
