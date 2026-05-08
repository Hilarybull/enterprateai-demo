from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.modules.workspace_access.schemas import CreateInvitationRequest, UpdateMemberRequest
from app.modules.workspace_access.service import (
    accept_invitation,
    create_invitation,
    get_my_memberships,
    get_owner_workspace_id,
    list_document_share_links,
    list_invitations,
    list_members,
    remove_member,
    revoke_document_share,
    revoke_invitation,
    update_member,
)
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/workspace", tags=["workspace_access"])


@router.post("/invitations", status_code=201)
async def create_workspace_invitation(
    payload: CreateInvitationRequest,
    user=Depends(get_current_user),
) -> dict:
    workspace_id = await get_owner_workspace_id(user["id"])
    invitation = await create_invitation(
        workspace_id=workspace_id,
        invited_by_user_id=user["id"],
        email=payload.email,
        permission_type=payload.permission_type,
        permissions=payload.permissions,
        expires_in_days=payload.expires_in_days or 7,
    )
    return {k: str(v) if v is not None else None for k, v in invitation.items()}


@router.get("/invitations")
async def get_workspace_invitations(user=Depends(get_current_user)) -> list:
    workspace_id = await get_owner_workspace_id(user["id"])
    return await list_invitations(workspace_id)


@router.get("/share-links")
async def get_workspace_share_links(user=Depends(get_current_user)) -> list:
    workspace_id = await get_owner_workspace_id(user["id"])
    return await list_document_share_links(workspace_id)


@router.delete("/invitations/{invitation_id}", status_code=204)
async def delete_workspace_invitation(invitation_id: str, user=Depends(get_current_user)) -> None:
    workspace_id = await get_owner_workspace_id(user["id"])
    await revoke_invitation(invitation_id, workspace_id)


@router.delete("/share-links/{share_id}", status_code=204)
async def delete_workspace_share_link(share_id: str, user=Depends(get_current_user)) -> None:
    workspace_id = await get_owner_workspace_id(user["id"])
    await revoke_document_share(share_id, workspace_id)


@router.get("/join/{token}")
async def join_workspace(token: str, user=Depends(get_current_user)) -> dict:
    return await accept_invitation(token=token, user_id=user["id"], user_email=user["email"])


@router.get("/members")
async def get_workspace_members(user=Depends(get_current_user)) -> list:
    workspace_id = await get_owner_workspace_id(user["id"])
    return await list_members(workspace_id)


@router.patch("/members/{member_id}")
async def update_workspace_member(
    member_id: str,
    payload: UpdateMemberRequest,
    user=Depends(get_current_user),
) -> dict:
    workspace_id = await get_owner_workspace_id(user["id"])
    return await update_member(member_id, workspace_id, payload.permission_type, payload.permissions)


@router.delete("/members/{member_id}", status_code=204)
async def delete_workspace_member(member_id: str, user=Depends(get_current_user)) -> None:
    workspace_id = await get_owner_workspace_id(user["id"])
    await remove_member(member_id, workspace_id)


@router.get("/me/memberships")
async def get_my_workspace_memberships(user=Depends(get_current_user)) -> list:
    return await get_my_memberships(user["id"])
