"""PROPOSAL ONLY (QA D1): restore "QA Sparkle Cleaning Ltd"'s company profile from the Mongo snapshot taken at
2026-10-11T23:08:29Z, 23 seconds before the Registration wizard's autosave replaced it.

Default: prints what would change and writes nothing. Run with --apply only after the owner has approved it.

What it restores (from the snapshot): city, country, email, website, company number, stage (early_revenue), team
size, services, and every other onboarding field. What it does NOT restore:
  - target_customer "Busy pet owners in Manchester": that came from a homepage idea (the R1 leak), not from the
    business. It is offered as a proposal instead (profile_proposals), for the owner to confirm or dismiss.
  - website "not a url": kept out (it fails the website check added in P2-8); the field is left empty to be asked again.
It also creates the two onboarding offerings as Catalogue items (QA D2), with no price ("Price needed").
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

WS = "f5b66653-a332-44f6-a69f-917da32f4eba"
SNAPSHOT_AT = "2026-10-11T23:08:29"


async def main(apply: bool):
    from app.core.database import get_mongo_db
    from app.core.supabase import sb_select, sb_update
    from app.modules.agent import profile_proposals
    from app.modules.workspace_profile.service import catalogue_with_offerings
    snaps = await get_mongo_db()["workspace_snapshots"].find({"workspace_id": WS}).sort("created_at", 1).to_list(50)
    snap = next((s for s in snaps if str(s.get("created_at", "")).startswith(SNAPSHOT_AT)), None)
    if not snap:
        raise SystemExit("The snapshot isn't there: nothing to restore from.")
    old = dict(snap["data"]["workspace_profile"])
    row = (await sb_select("workspaces", filters=[("id", "eq", WS)], columns="id,user_id,data", limit=1))[0]
    data = dict(row["data"] or {})
    current = dict(data.get("workspace_profile") or {})
    leaked = old.pop("target_customer", None)
    if str(old.get("website") or "").strip().lower() in ("not a url",):
        old.pop("website")
    restored = {**old, **{k: v for k, v in current.items() if v not in (None, "", []) and k not in old}}
    now = datetime.now(timezone.utc).isoformat()
    changes = {k: (current.get(k), restored.get(k)) for k in sorted(set(current) | set(restored)) if current.get(k) != restored.get(k)}
    print(json.dumps({"fields_changed": {k: {"now": a, "restored": b} for k, (a, b) in changes.items() if k != "logo_data_url"}}, indent=1, default=str)[:4000])
    offered = [str(s.get("service_name") or "").strip() for s in old.get("services") or [] if isinstance(s, dict)]
    catalogue, added = catalogue_with_offerings(data.get("catalogue"), offered, now)
    print("catalogue items to add:", [a["name"] for a in added])
    if leaked:
        print(f"target_customer {leaked!r}: not restored; offered as a proposal from the homepage idea.")
    if not apply:
        print("\nNothing written. Re-run with --apply once the owner approves.")
        return
    data["workspace_profile"] = restored
    data["workspace_profile_updated_at"] = now
    data["catalogue"] = catalogue
    if leaked:
        profile_proposals.propose(data, {"target_customer": leaked}, {"kind": "goal", "goal_key": "test_idea", "restored_from": SNAPSHOT_AT}, datetime.now(timezone.utc))
    await sb_update("workspaces", filters=[("id", "eq", WS)], payload={"data": data, "updated_at": now})
    print("Restored.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
