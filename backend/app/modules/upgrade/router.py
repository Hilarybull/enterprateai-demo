from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from app.core.supabase import sb_insert
from app.modules.upgrade.schemas import UpgradeClickRequest, UpgradeClickResponse
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/upgrade", tags=["upgrade"])


@router.post("/click", response_model=UpgradeClickResponse)
async def upgrade_click(
    payload: UpgradeClickRequest,
    user=Depends(get_current_user),
) -> UpgradeClickResponse:
    await sb_insert(
        "upgrade_clicks",
        {
            "user_id": user["id"],
            "email": user.get("email"),
            "feature": payload.feature or "simulation",
            "source": payload.source or None,
            "clicked_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return UpgradeClickResponse()
