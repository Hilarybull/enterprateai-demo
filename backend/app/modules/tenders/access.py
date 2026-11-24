from fastapi import HTTPException
from app.core.supabase import sb_select, sb_insert, sb_update
from app.modules.plans.access import plan_meets
from uuid import NAMESPACE_URL, uuid5
from datetime import datetime, timezone


async def claim_free_view(user_id, tender_id):
    """One private account record, using revisions to serialize concurrent view claims."""
    record_id = str(uuid5(NAMESPACE_URL, "tender-allowance:" + user_id))
    for _ in range(8):
        row = await sb_select("readiness_artifacts", filters=[("id", "eq", record_id)], single=True)
        if not row:
            now = datetime.now(timezone.utc).isoformat()
            try:
                await sb_insert("readiness_artifacts", {"id": record_id, "business_id": "account:" + user_id,
                    "kind": "tender_allowance", "subject_id": None, "status": "active", "revision": 1,
                    "data": {"views": [tender_id]}, "created_by": user_id, "created_at": now, "updated_at": now})
                return True
            except Exception as exc:
                if str(getattr(exc, "code", "")) == "23505": continue
                raise
        views = (row.get("data") or {}).get("views") or []
        if tender_id in views: return True
        if len(views) >= 2: return False
        changed = await sb_update("readiness_artifacts", payload={"data": {"views": [*views, tender_id]}, "revision": row["revision"] + 1},
            filters=[("id", "eq", record_id), ("revision", "eq", row["revision"])])
        if changed: return True
    raise HTTPException(503, "Please try opening the tender again.")


async def require_detail_access(user_id, notice):
    if await plan_meets(user_id, "starter_insight", grant_module="public_tenders"):
        return
    allowed = await claim_free_view(user_id, notice.get("ocid") or notice["id"])
    if not allowed:
        raise HTTPException(403, {"code": "TENDER_PREVIEW_LIMIT", "limit": 2,
            "message": "You’ve explored your two free tenders. Unlock more opportunities with Starter and find your next contract."})
