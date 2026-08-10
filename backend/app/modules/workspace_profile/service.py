from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from app.modules.idea_validation.service import create_workspace, get_workspace, get_user_workspace, update_workspace
from app.modules.workspace_profile.schemas import WorkspaceProfile


async def _load_workspace(user_id: str, workspace_id: str | None):
    if workspace_id:
        return await get_workspace(user_id=user_id, workspace_id=workspace_id)
    existing = await get_user_workspace(user_id=user_id)
    return existing


async def get_profile(*, user_id: str, workspace_id: str | None = None):
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    data = ws.data or {}
    profile = data.get("workspace_profile")
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace profile not found")
    try:
        parsed = WorkspaceProfile.model_validate(profile)
    except Exception:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Workspace profile invalid")
    return {"workspace_id": str(ws.id), "profile": parsed, "updated_at": ws.updated_at}


async def upsert_profile(*, user_id: str, workspace_id: str | None, profile: WorkspaceProfile):
    ws = await _load_workspace(user_id, workspace_id)
    now = datetime.now(timezone.utc).isoformat()

    if ws:
        # Merge incoming profile on top of existing so previously-saved required fields
        # (services, country, city, etc.) are preserved when not re-submitted.
        existing = ws.data.get("workspace_profile") if isinstance(ws.data, dict) else {}
        base = dict(existing or {})
        incoming = profile.model_dump()
        for k, v in incoming.items():
            # Only overwrite with incoming value when it's non-empty; keep existing otherwise
            if isinstance(v, list):
                if v:
                    base[k] = v
            elif v is not None and v != "":
                base[k] = v
        try:
            merged_profile = WorkspaceProfile.model_validate(base)
        except Exception as e:
            raise HTTPException(status_code=422, detail=str(e))
        await update_workspace(user_id=user_id, workspace_id=str(ws.id), data_patch={"workspace_profile": merged_profile.model_dump()})
        ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
        return {"workspace_id": str(ws.id), "profile": merged_profile, "updated_at": ws.updated_at}

    # Create a workspace if none exists yet
    payload = {"workspace_profile": profile.model_dump()}
    ws_id = await create_workspace(user_id=user_id, name=profile.company_name, data=payload)
    ws = await get_workspace(user_id=user_id, workspace_id=ws_id)
    return {"workspace_id": str(ws.id), "profile": profile, "updated_at": ws.updated_at}


async def patch_profile(*, user_id: str, workspace_id: str | None, profile_patch: dict[str, Any]):
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    existing = ws.data.get("workspace_profile") if isinstance(ws.data, dict) else None
    merged = dict(existing or {})
    for k, v in (profile_patch or {}).items():
        merged[k] = v

    try:
        validated = WorkspaceProfile.model_validate(merged)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    await update_workspace(user_id=user_id, workspace_id=str(ws.id), data_patch={"workspace_profile": validated.model_dump()})
    ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
    return {"workspace_id": str(ws.id), "profile": validated, "updated_at": ws.updated_at}
