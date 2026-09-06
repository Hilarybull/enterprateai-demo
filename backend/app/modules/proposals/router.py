from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.shared.auth.deps import get_current_user
from app.modules.credits.service import credit_guard
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


@router.delete("/inbox/{proposal_id}")
async def delete_inbox_proposal(
    proposal_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    await service.delete_from_inbox(user["id"], workspace_id, proposal_id)
    return {"ok": True}


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


# ── AI cover letter generation ────────────────────────────────────────────────

@router.post("/generate-cover-letter")
async def generate_cover_letter(
    body: dict,
    user=Depends(get_current_user),
):
    from app.shared.llm.openai_client import pick_llm_for_user
    from app.core.supabase import sb_select

    recipient_workspace_id = body.get("recipient_workspace_id") or ""
    request_title = body.get("request_title") or ""
    request_description = body.get("request_description") or ""

    # Fetch submitter's own workspace profile for personalisation
    submitter_name = ""
    submitter_industry = ""
    try:
        rows = await sb_select("validation_workspaces", filters=[("user_id", "eq", user["id"])], columns="company_name,primary_industry", limit=1)
        if rows:
            submitter_name = rows[0].get("company_name") or ""
            submitter_industry = rows[0].get("primary_industry") or ""
    except Exception:
        pass

    # Fetch recipient company name for context
    recipient_name = ""
    if recipient_workspace_id:
        try:
            rows = await sb_select("validation_workspaces", filters=[("id", "eq", recipient_workspace_id)], columns="company_name", limit=1)
            if rows:
                recipient_name = rows[0].get("company_name") or ""
        except Exception:
            pass

    ctx_parts = []
    if submitter_name:
        ctx_parts.append(f"Submitting company: {submitter_name}")
    if submitter_industry:
        ctx_parts.append(f"Industry: {submitter_industry}")
    if recipient_name:
        ctx_parts.append(f"Recipient: {recipient_name}")
    if request_title:
        ctx_parts.append(f"Request: {request_title}")
    if request_description:
        ctx_parts.append(f"Brief: {request_description}")
    context = ". ".join(ctx_parts) if ctx_parts else "General business proposal submission."

    prompt = (
        f"Write a short, professional cover letter / summary (3-4 sentences) for a business proposal submission. "
        f"Introduce the submitting company, explain why they are a great fit, and highlight a key strength or relevant offering. "
        f"Context: {context}. "
        f"Write in first person plural (we/our). "
        f"Do not use em dashes, en dashes, hyphens, or any dash characters anywhere in the text. Use commas or full stops instead. "
        f"Return only the cover letter text, no subject line, no labels, no markdown, no bullet points."
    )

    from fastapi import HTTPException
    import re
    import uuid
    generation_id = str(uuid.uuid4())
    try:
        async with credit_guard(user["id"], "proposal_section", generation_id):
            llm = await pick_llm_for_user(user["id"])
            result = await llm.generate_text(
                system="You are a professional business writer helping compose concise, compelling cover letters for proposal submissions.",
                prompt=prompt,
                feature="proposal_section",
            )
        cover_letter = (result.text or "").strip()
        cover_letter = cover_letter.replace("—", ",").replace("–", ",")
        cover_letter = re.sub(r"\s+-\s+", ", ", cover_letter)
        cover_letter = re.sub(r",\s*,", ",", cover_letter)
        return {"cover_letter": cover_letter}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cover letter generation failed: {exc}") from exc


# ── Upload attachment ─────────────────────────────────────────────────────────

@router.post("/upload-attachment")
async def upload_attachment(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    import uuid
    from app.core.supabase import sb_upload_file

    content = await file.read()
    filename = file.filename or "attachment"
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"
    path = f"{user['id']}/{uuid.uuid4()}.{ext}"
    content_type = file.content_type or "application/octet-stream"
    url = await sb_upload_file("proposal-attachments", path, content, content_type)
    return {"url": url, "filename": filename, "mime": content_type, "size": len(content)}


# ── Extract brief (no AI) ─────────────────────────────────────────────────────

@router.post("/extract-brief")
async def extract_brief(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    content = await file.read()
    return await service.extract_brief_text(content, file.filename or "")


# ── AI-generate description from title ────────────────────────────────────────

@router.post("/generate-description")
async def generate_description(
    payload: dict,
    user=Depends(get_current_user),
):
    """Use AI to draft a proposal request description from the title and any extra context."""
    from app.shared.llm.openai_client import pick_llm_for_user
    title = (payload.get("title") or "").strip()
    if not title:
        return {"description": ""}
    try:
        llm = await pick_llm_for_user(user["id"])
        result = await llm.generate_text(
            system="You are a business procurement assistant helping draft clear, professional proposal request descriptions.",
            prompt=f"""Write a concise, professional description for a proposal request titled: "{title}"

The description should:
- Explain what the requester is looking for (2-4 sentences)
- Mention key criteria or deliverables a proposer should address
- Be written from the requester's perspective (first-person "we" or "I")
- Be practical and specific, not generic

Return ONLY the description text — no headings, no bullet points, no extra commentary.""",
            feature="proposal_generate_description",
        )
        return {"description": (result.text or "").strip()}
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("generate-description failed: %s", exc)
        return {"description": ""}
