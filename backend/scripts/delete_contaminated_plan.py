"""One-off (F1 follow-up, owner's decision 14 Oct): delete the business plan draft c1530e31 of QA Sparkle Cleaning Ltd, a
cleaning plan written with another idea's customer and problem, never requested and already refunded. The document and
the business's plan pointer are backed up first; the pointer is cleared (no plan), never moved to another draft.

    python scripts/delete_contaminated_plan.py            # look only
    python scripts/delete_contaminated_plan.py --apply
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BACKUPS = Path(r"C:\Users\USER\AppData\Local\Temp\claude\c--Users-USER-Desktop-codeProjects-ent\6791474d-c99a-4e8d-a424-f07a6835acae\scratchpad\backups")
BUSINESS = "f5b66653-a332-44f6-a69f-917da32f4eba"
DOCUMENT = "c1530e31-da47-4d76-8120-4421c9d50d1a"


async def main(apply: bool) -> None:
    from app.core.supabase import sb_select
    from app.modules.agent.router import get_orchestrator
    from app.modules.blueprint.repository import delete_document
    doc = await sb_select("blueprint_documents", filters=[("id", "eq", DOCUMENT)], single=True)
    data = await get_orchestrator().rt.business.load(BUSINESS)
    pointer = (data.get("agent_studio") or {}).get("plan")
    print(f"document: {doc.get('id') if doc else None}  {doc.get('title') if doc else 'not found'}  workspace {doc.get('workspace_id') if doc else ''}")
    print(f"plan pointer: {json.dumps(pointer, default=str)}")
    if not doc or doc.get("workspace_id") != BUSINESS:
        raise SystemExit("The document isn't the one described. Nothing changed.")
    if not apply:
        print("\nLook only: nothing was changed. Re-run with --apply.")
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    path = BACKUPS / f"delete_contaminated_plan_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps({"document": doc, "plan_pointer": pointer}, default=str, indent=1), encoding="utf-8")
    print(f"backup: {path}")
    await delete_document(user_id=doc["user_id"], document_id=DOCUMENT)
    print(f"deleted {DOCUMENT}")

    def _clear(d: dict) -> None:
        studio = d.get("agent_studio") or {}
        if (studio.get("plan") or {}).get("document_id") == DOCUMENT:
            studio.pop("plan", None)
    await get_orchestrator().rt.business.mutate(BUSINESS, _clear)
    after = (await get_orchestrator().rt.business.load(BUSINESS)).get("agent_studio") or {}
    print(f"plan pointer now: {json.dumps(after.get('plan'), default=str)}")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
