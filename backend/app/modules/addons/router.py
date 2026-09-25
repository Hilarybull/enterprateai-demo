from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.shared.auth.deps import get_current_user
from app.modules.addons.service import get_featured_status, use_boost

router = APIRouter(prefix="/addons", tags=["addons"])


async def _resolve_workspace_id(user_id: str, workspace_id: str | None) -> str:
    if workspace_id:
        return workspace_id
    from app.modules.idea_validation.service import get_user_workspace
    ws = await get_user_workspace(user_id=user_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return str(ws.id)


@router.get("/featured")
async def featured_status(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    """Owner: featured state of their listing and remaining boosts this period."""
    ws_id = await _resolve_workspace_id(user["id"], workspace_id)
    return await get_featured_status(user_id=user["id"], workspace_id=ws_id)


@router.post("/boost")
async def boost_listing(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    """Owner: spend one boost to feature their listing for 24 hours."""
    ws_id = await _resolve_workspace_id(user["id"], workspace_id)
    return await use_boost(user_id=user["id"], workspace_id=ws_id)
