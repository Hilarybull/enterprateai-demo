"""PROPOSAL ONLY (G2, 23 Oct): "I need funding" on the landing page turned funding case 80f0f8fc (the £100k grant for hiring
staff) into a £50k loan under the same id. With many funding cases now allowed (the owner's choice, 23 Oct), this puts the
grant back on 80f0f8fc from its History (the latest replaced need) and keeps the loan as its own new case.

    python scripts/restore_funding_grant_80f0f8fc.py           # look only: prints what would change
    python scripts/restore_funding_grant_80f0f8fc.py --apply   # only after the owner approves the look-only output

On --apply the current row is saved to BACKUPS first. The loan is created through the readiness service as a new case
with the loan's own fields (title, amount, currency, route, purpose, stage, receipt date); the grant's set-aside parts
(milestones, use of funds, market, traction, purpose milestone) come back onto 80f0f8fc.
"""
import asyncio
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")
CASE_PREFIX = "80f0f8fc"
LOAN_FIELDS = ("title", "target_amount", "currency", "route_preference", "purpose", "stage", "receipt_date")


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select, sb_update
    rows = await sb_select("readiness_subjects", filters=[("kind", "eq", "funding_case")], columns="id,business_id,revision,data") or []
    row = next((r for r in rows if str(r["id"]).startswith(CASE_PREFIX)), None)
    if not row:
        raise SystemExit("Case not found.")
    now_data = row["data"] or {}
    needs = now_data.get("previous_needs") or []
    if not needs:
        raise SystemExit("No earlier need in History: nothing to restore.")
    grant = needs[0]
    restored = copy.deepcopy(now_data)
    for k, v in (grant.get("values") or {}).items():
        restored[k] = v
    restored["title"] = grant.get("title") or restored.get("title")
    for k, v in (grant.get("set_aside") or {}).items():
        restored[k] = v
    restored["previous_needs"] = needs[1:]
    loan = {k: now_data.get(k) for k in LOAN_FIELDS if now_data.get(k) not in (None, "")}
    print(json.dumps({"case": row["id"], "business": row["business_id"],
                      "now": {k: now_data.get(k) for k in LOAN_FIELDS},
                      "restored to": {k: restored.get(k) for k in LOAN_FIELDS},
                      "brought back from History": sorted((grant.get("set_aside") or {}).keys()),
                      "new case for the loan": loan}, indent=1, default=str))
    if not apply:
        print("\nLook only: nothing was changed. Re-run with --apply once this has been approved.")
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    (BACKUPS / f"funding_{row['id']}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json").write_text(json.dumps(row, default=str), encoding="utf-8")
    await sb_update("readiness_subjects", filters=[("id", "eq", row["id"])],
                    payload={"data": restored, "revision": int(row["revision"]) + 1, "updated_at": datetime.now(timezone.utc).isoformat()})
    from app.modules.agent.goal_router import get_orchestrator
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    owner = (await sb_select("workspaces", filters=[("id", "eq", row["business_id"])], columns="user_id", single=True) or {}).get("user_id")
    made = await service_for(get_orchestrator()).create_subject(owner, row["business_id"], rules.FUNDING, {**loan, "pinned": True})
    print("Restored the grant on", row["id"], "and made the loan case", made.get("id"))


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
