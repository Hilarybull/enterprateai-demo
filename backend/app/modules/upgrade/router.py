from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.modules.upgrade.schemas import UpgradeClickRequest, UpgradeClickResponse
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/upgrade", tags=["upgrade"])


@router.post("/click", response_model=UpgradeClickResponse)
async def upgrade_click(
    payload: UpgradeClickRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> UpgradeClickResponse:
    await db["upgrade_clicks"].insert_one(
        {
            "user_id": user["id"],
            "email": user.get("email"),
            "feature": payload.feature or "simulation",
            "source": payload.source or None,
            "clicked_at": datetime.now(timezone.utc),
        }
    )
    return UpgradeClickResponse()
