from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update
from app.core.config import get_settings
from app.shared.email.resend import send_workspace_invitation_email_with_link


def _normalize_expiry_days(expires_in_days: int | None) -> int:
    if expires_in_days is None:
        return 7
    return max(1, min(int(expires_in_days), 30))


def _missing_column(exc: Exception, column: str) -> bool:
    message = str(exc)
    return f"'{column}' column" in message and "schema cache" in message


async def get_owner_workspace_id(user_id: str) -> str:
    ws = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="No workspace found. Create a workspace before inviting members.")
    return ws["id"]


async def create_invitation(
    workspace_id: str,
    invited_by_user_id: str,
    invited_by_email: str,
    email: Optional[str],
    permission_type: str,
    permissions: Dict[str, Any],
    expires_in_days: int = 7,
) -> Dict[str, Any]:
    expires_in_days = _normalize_expiry_days(expires_in_days)
    normalized_email = email.strip().lower() if email else None
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()
    row = {
        "workspace_id": workspace_id,
        "invited_by_user_id": invited_by_user_id,
        "email": normalized_email,
        "token": token,
        "permission_type": permission_type,
        "permissions": permissions,
        "status": "pending",
        "expires_at": expires_at,
    }
    result = await sb_insert("workspace_invitations", row)
    invitation = result[0] if result else row

    if normalized_email:
        invite_url = f"{get_settings().frontend_url.rstrip('/')}/join/{token}"
        ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
        workspace_name = ws.get("name") if ws else None
        delivery = await send_workspace_invitation_email_with_link(
            to_email=normalized_email,
            inviter_email=invited_by_email,
            invite_url=invite_url,
            expires_in_days=expires_in_days,
            permission_type=permission_type,
            workspace_name=workspace_name,
        )
        invitation["email_sent"] = delivery.sent
        invitation["email_error"] = delivery.error
    else:
        invitation["email_sent"] = False
        invitation["email_error"] = None

    return invitation


async def list_invitations(workspace_id: str) -> list:
    return await sb_select(
        "workspace_invitations",
        filters=[("workspace_id", "eq", workspace_id)],
        order="created_at",
        desc=True,
    )


def _iso_now() -> datetime:
    return datetime.now(timezone.utc)


def _derive_document_share_status(share: Dict[str, Any]) -> str:
    if share.get("revoked"):
        return "revoked"
    expires_at = share.get("expires_at")
    if expires_at:
        try:
            if _iso_now() > datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")):
                return "expired"
        except Exception:
            pass
    if share.get("accepted_at") or share.get("last_accessed_at"):
        return "accepted"
    return "pending"


def _share_type_label(document_type: str | None) -> str:
    value = str(document_type or "").strip()
    if value in {"invoice_template", "sales_quotation"}:
        return "financials"
    return "blueprint"


async def list_document_share_links(workspace_id: str) -> list:
    documents = await sb_select(
        "blueprint_documents",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id,title,type,workspace_id,updated_at",
        order="updated_at",
        desc=True,
    )
    if not documents:
        return []

    doc_ids = [doc["id"] for doc in documents if doc.get("id")]
    if not doc_ids:
        return []

    try:
        shares = await sb_select(
            "blueprint_document_shares",
            filters=[("document_id", "in", doc_ids)],
            columns="id,document_id,token,email,revoked,created_at,updated_at,last_accessed_at,accepted_at,expires_at",
            order="created_at",
            desc=True,
        )
    except Exception as exc:
        if _missing_column(exc, "email"):
            shares = await sb_select(
                "blueprint_document_shares",
                filters=[("document_id", "in", doc_ids)],
                columns="id,document_id,token,revoked,created_at,updated_at,last_accessed_at,expires_at",
                order="created_at",
                desc=True,
            )
            shares = [{**share, "email": None, "accepted_at": share.get("last_accessed_at")} for share in shares]
        elif _missing_column(exc, "accepted_at"):
            shares = await sb_select(
                "blueprint_document_shares",
                filters=[("document_id", "in", doc_ids)],
                columns="id,document_id,token,email,revoked,created_at,updated_at,last_accessed_at,expires_at",
                order="created_at",
                desc=True,
            )
            shares = [{**share, "accepted_at": share.get("last_accessed_at")} for share in shares]
        else:
            raise
    if not shares:
        return []

    doc_map = {doc["id"]: doc for doc in documents}
    rows = []
    for share in shares:
        doc = doc_map.get(share.get("document_id"))
        if not doc:
            continue
        rows.append({
            "id": share["id"],
            "kind": "document_share",
            "source": _share_type_label(doc.get("type")),
            "document_id": doc.get("id"),
            "document_title": doc.get("title") or "Untitled document",
            "document_type": doc.get("type") or "document",
            "email": share.get("email"),
            "token": share.get("token"),
            "created_at": share.get("created_at"),
            "updated_at": share.get("updated_at"),
            "expires_at": share.get("expires_at"),
            "last_accessed_at": share.get("last_accessed_at"),
            "accepted_at": share.get("accepted_at"),
            "status": _derive_document_share_status(share),
        })
    return rows


async def revoke_invitation(invitation_id: str, workspace_id: str) -> None:
    await sb_update(
        "workspace_invitations",
        payload={"status": "revoked"},
        filters=[("id", "eq", invitation_id), ("workspace_id", "eq", workspace_id)],
    )


async def revoke_document_share(share_id: str, workspace_id: str) -> None:
    documents = await sb_select(
        "blueprint_documents",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id",
    )
    doc_ids = [doc["id"] for doc in documents if doc.get("id")]
    if not doc_ids:
        raise HTTPException(status_code=404, detail="Share link not found.")

    updated = await sb_update(
        "blueprint_document_shares",
        payload={"revoked": True, "updated_at": _iso_now().isoformat()},
        filters=[("id", "eq", share_id), ("document_id", "in", doc_ids)],
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Share link not found.")


async def accept_invitation(token: str, user_id: str, user_email: str | None = None) -> Dict[str, Any]:
    inv = await sb_select(
        "workspace_invitations",
        filters=[("token", "eq", token)],
        single=True,
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation link is invalid or does not exist.")

    if inv["status"] == "revoked":
        raise HTTPException(status_code=410, detail="This invitation has been revoked by the workspace owner.")

    email_restricted = bool(inv.get("email"))
    normalized_user_email = (user_email or "").strip().lower()

    if email_restricted and normalized_user_email != str(inv["email"]).strip().lower():
        raise HTTPException(status_code=403, detail="This invitation is restricted to a different email address.")

    if inv["status"] == "accepted" and email_restricted:
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
            await sb_update(
                "workspace_invitations",
                payload={"status": "expired"},
                filters=[("id", "eq", inv["id"])],
            )
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

    if email_restricted:
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
