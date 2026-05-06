from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.supabase import sb_select
from app.shared.auth.deps import get_current_user

ADMIN_EMAIL = "tech.support@enterprateai.com"

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access only.")
    return user


@router.get("/stats")
async def get_system_stats(user=Depends(require_admin)) -> dict:
    workspaces = await sb_select("workspaces", columns="id,name,created_at")
    users = await sb_select("users", columns="id,email,created_at")
    members = await sb_select("workspace_members", columns="id,workspace_id,user_id,permission_type,created_at")
    invitations = await sb_select("workspace_invitations", columns="id,workspace_id,email,status,created_at")

    # Count simulations and blueprints from workspace data
    sim_count = 0
    blueprint_count = 0
    validation_count = 0
    for ws in workspaces:
        ws_data = await sb_select("workspaces", filters=[("id", "eq", ws["id"])], columns="data", single=True)
        data = (ws_data or {}).get("data") or {}
        if isinstance(data, dict):
            sims = data.get("simulations") or []
            if isinstance(sims, list):
                sim_count += len(sims)
            bps = data.get("blueprints") or data.get("documents") or []
            if isinstance(bps, list):
                blueprint_count += len(bps)
            if data.get("decision") or data.get("idea_validation") or data.get("service_validation_history"):
                validation_count += 1

    return {
        "total_workspaces": len(workspaces),
        "total_users": len(users),
        "total_members": len(members),
        "total_invitations": len(invitations),
        "total_simulations": sim_count,
        "total_blueprints": blueprint_count,
        "total_validated_workspaces": validation_count,
        "workspaces": [
            {
                "id": ws["id"],
                "name": ws.get("name") or "Unnamed",
                "created_at": ws.get("created_at"),
            }
            for ws in workspaces
        ],
        "users": [
            {
                "id": u["id"],
                "email": u["email"],
                "created_at": u.get("created_at"),
            }
            for u in users
        ],
        "members": [
            {
                "id": m["id"],
                "workspace_id": m["workspace_id"],
                "user_id": m["user_id"],
                "permission_type": m.get("permission_type"),
                "created_at": m.get("created_at"),
            }
            for m in members
        ],
        "invitations": [
            {
                "id": i["id"],
                "workspace_id": i["workspace_id"],
                "invited_email": i.get("email"),
                "status": i.get("status"),
                "created_at": i.get("created_at"),
            }
            for i in invitations
        ],
    }


@router.get("/workspaces")
async def list_all_workspaces(user=Depends(require_admin)) -> list:
    return await sb_select("workspaces", columns="id,name,created_at", order="created_at", desc=True)


@router.get("/users")
async def list_all_users(user=Depends(require_admin)) -> list:
    return await sb_select("users", columns="id,email,created_at", order="created_at", desc=True)
