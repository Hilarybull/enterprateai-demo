from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update


async def get_owner_workspace_id(user_id: str) -> str:
    ws = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="No workspace found. Create a workspace before inviting members.")
    return ws["id"]


async def create_invitation(
    workspace_id: str,
    invited_by_user_id: str,
    email: Optional[str],
    permission_type: str,
    permissions: Dict[str, Any],
    expires_in_days: int = 7,
) -> Dict[str, Any]:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()
    row = {
        "workspace_id": workspace_id,
        "invited_by_user_id": invited_by_user_id,
        "email": email,
        "token": token,
        "permission_type": permission_type,
        "permissions": permissions,
        "status": "pending",
        "expires_at": expires_at,
    }
    result = await sb_insert("workspace_invitations", row)
    return result[0] if result else row


async def list_invitations(workspace_id: str) -> list:
    return await sb_select(
        "workspace_invitations",
        filters=[("workspace_id", "eq", workspace_id)],
        order="created_at",
        desc=True,
    )


async def revoke_invitation(invitation_id: str, workspace_id: str) -> None:
    await sb_update(
        "workspace_invitations",
        payload={"status": "revoked"},
        filters=[("id", "eq", invitation_id), ("workspace_id", "eq", workspace_id)],
    )


async def accept_invitation(token: str, user_id: str) -> Dict[str, Any]:
    inv = await sb_select(
        "workspace_invitations",
        filters=[("token", "eq", token)],
        single=True,
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation link is invalid or does not exist.")

    if inv["status"] == "revoked":
        raise HTTPException(status_code=410, detail="This invitation has been revoked by the workspace owner.")

    if inv["status"] == "accepted":
        # If this user already accepted it, treat as success by returning their membership
        existing = await sb_select(
            "workspace_members",
            filters=[("workspace_id", "eq", inv["workspace_id"]), ("user_id", "eq", user_id)],
            single=True,
        )
        if existing:
            return existing
        raise HTTPException(status_code=409, detail="This invitation has already been used.")

    if inv.get("expires_at"):
        expires_at = datetime.fromisoformat(str(inv["expires_at"]).replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=410, detail="This invitation has expired.")

    # Prevent owner from joining their own workspace as a member
    owner_ws = await sb_select("workspaces", filters=[("id", "eq", inv["workspace_id"]), ("user_id", "eq", user_id)], single=True)
    if owner_ws:
        raise HTTPException(status_code=400, detail="You already own this workspace.")

    existing = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", inv["workspace_id"]), ("user_id", "eq", user_id)],
        single=True,
    )
    now = datetime.now(timezone.utc).isoformat()

    if existing:
        result = await sb_update(
            "workspace_members",
            payload={
                "permission_type": inv["permission_type"],
                "permissions": inv["permissions"],
                "updated_at": now,
            },
            filters=[("id", "eq", existing["id"])],
        )
        member = result[0] if result else existing
    else:
        member_row = {
            "workspace_id": inv["workspace_id"],
            "user_id": user_id,
            "invited_by_user_id": inv["invited_by_user_id"],
            "permission_type": inv["permission_type"],
            "permissions": inv["permissions"],
            "role": "member",
        }
        result = await sb_insert("workspace_members", member_row)
        member = result[0] if result else member_row

    await sb_update(
        "workspace_invitations",
        payload={"status": "accepted", "accepted_at": now, "accepted_by_user_id": user_id},
        filters=[("id", "eq", inv["id"])],
    )
    return member


async def list_members(workspace_id: str) -> list:
    members = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", workspace_id)],
        order="created_at",
    )
    if not members:
        return []
    user_ids = [m["user_id"] for m in members]
    users = await sb_select("users", filters=[("id", "in", user_ids)])
    user_map = {u["id"]: u["email"] for u in users}
    for m in members:
        m["email"] = user_map.get(m["user_id"], "")
    return members


async def update_member(
    member_id: str,
    workspace_id: str,
    permission_type: str,
    permissions: Dict[str, Any],
) -> Dict[str, Any]:
    result = await sb_update(
        "workspace_members",
        payload={
            "permission_type": permission_type,
            "permissions": permissions,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        filters=[("id", "eq", member_id), ("workspace_id", "eq", workspace_id)],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found.")
    return result[0]


async def remove_member(member_id: str, workspace_id: str) -> None:
    await sb_delete(
        "workspace_members",
        filters=[("id", "eq", member_id), ("workspace_id", "eq", workspace_id)],
    )


async def get_my_memberships(user_id: str) -> list:
    members = await sb_select("workspace_members", filters=[("user_id", "eq", user_id)])
    if not members:
        return []
    ws_ids = [m["workspace_id"] for m in members]
    workspaces = await sb_select("workspaces", filters=[("id", "in", ws_ids)])
    ws_map = {w["id"]: w for w in workspaces}
    for m in members:
        ws = ws_map.get(m["workspace_id"], {})
        m["workspace_name"] = ws.get("name", "")
    return members
