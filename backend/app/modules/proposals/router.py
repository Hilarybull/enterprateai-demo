from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.shared.auth.deps import get_current_user
from app.modules.proposals import service
from app.modules.proposals.schemas import (
    ProposalPreferencesIn,
    ProposalRequestIn,
    ProposalRequestPatch,
    StatusTransitionIn,
    ProposalSubmitIn,
    UploadSessionIn,
)

router = APIRouter(prefix="/proposals", tags=["proposals"])


# ── Preferences ───────────────────────────────────────────────────────────────

@router.get("/preferences")
async def get_preferences(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.get_preferences(user["id"], workspace_id)


@router.put("/preferences")
async def save_preferences(
    body: ProposalPreferencesIn,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.save_preferences(user["id"], workspace_id, body.model_dump())


# ── Requests ──────────────────────────────────────────────────────────────────

@router.get("/requests")
async def list_requests(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.list_requests(user["id"], workspace_id)


@router.post("/requests")
async def create_request(
    body: ProposalRequestIn,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.create_request(user["id"], workspace_id, body.model_dump())


@router.patch("/requests/{request_id}")
async def update_request(
    request_id: str,
    body: ProposalRequestPatch,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.update_request(user["id"], workspace_id, request_id, body.model_dump(exclude_none=True))


@router.post("/requests/{request_id}/publish")
async def publish_request(
    request_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.publish_request(user["id"], workspace_id, request_id)


@router.post("/requests/{request_id}/close")
async def close_request(
    request_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.close_request(user["id"], workspace_id, request_id)


@router.post("/requests/{request_id}/reopen")
async def reopen_request(
    request_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.reopen_request(user["id"], workspace_id, request_id)


@router.delete("/requests/{request_id}")
async def delete_request(
    request_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    await service.delete_request(user["id"], workspace_id, request_id)
    return {"ok": True}


# ── Inbox ─────────────────────────────────────────────────────────────────────

@router.get("/inbox")
async def get_inbox(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.get_inbox(user["id"], workspace_id)


@router.patch("/inbox/{proposal_id}/link")
async def link_inbox_proposal(
    proposal_id: str,
    body: dict,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.link_inbox_to_request(
        user["id"], workspace_id, proposal_id, body.get("request_id")
    )


# ── Activity ──────────────────────────────────────────────────────────────────

@router.get("/activity")
async def get_activity(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.get_activity(user["id"], workspace_id)


# ── Status transition ─────────────────────────────────────────────────────────

@router.post("/{proposal_id}/status")
async def transition_status(
    proposal_id: str,
    body: StatusTransitionIn,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.transition_status(
        user["id"], workspace_id, proposal_id, body.status, body.reason
    )


# ── Submit ────────────────────────────────────────────────────────────────────

@router.post("/submit")
async def submit_proposal(
    body: ProposalSubmitIn,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    payload = body.model_dump()
    payload["proposer_email"] = user.get("email")
    return await service.submit_proposal(user["id"], workspace_id, payload)


# ── Upload session ────────────────────────────────────────────────────────────

@router.post("/upload-session")
async def create_upload_session(
    body: UploadSessionIn,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.create_upload_session(user["id"], workspace_id, body.model_dump())


# ── Invite by email ───────────────────────────────────────────────────────────

@router.post("/requests/{request_id}/invite")
async def invite_to_request(
    request_id: str,
    body: dict,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await service.invite_to_request(
        user_id=user["id"],
        workspace_id=workspace_id,
        request_id=request_id,
        emails=body.get("emails") or [],
        invite_url=body.get("invite_url", ""),
        sender_name=body.get("sender_name", ""),
        sender_email=user.get("email", ""),
    )


# ── Extract brief (no AI) ─────────────────────────────────────────────────────

@router.post("/extract-brief")
async def extract_brief(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    content = await file.read()
    return await service.extract_brief_text(content, file.filename or "")
