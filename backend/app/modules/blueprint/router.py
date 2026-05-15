from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.config import get_settings
from app.core.supabase import sb_select
from app.modules.blueprint.repository import delete_document, get_document, list_documents, save_document, update_document
from app.modules.blueprint.exporter import extract_export_body, html_to_pdf, markdown_to_html, render_export_html, render_pdf_html
from app.modules.blueprint.schemas import (
    BlueprintDocument,
    BlueprintDocumentListItem,
    BlueprintDocumentUpdateRequest,
    BlueprintFinancialShareRequest,
    BlueprintFinancialShareResponse,
    BlueprintGenerateRequest,
    BlueprintGenerateResponse,
    BlueprintShareEmailRequest,
    BlueprintShareEmailResponse,
    BlueprintShareCreateRequest,
    BlueprintShareLinkResponse,
    BlueprintSharedDocument,
)
from app.modules.blueprint.service import generate_blueprint
from app.modules.blueprint.share_repository import (
    create_share_token,
    get_share_record_for_owner,
    get_shared_document_by_token,
    revoke_share_tokens,
)
from app.shared.email.sendgrid import send_document_share_email
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/blueprint", tags=["blueprint"])


def _shared_document_url(token: str) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/share/{token}"


def _remaining_expiry_days(expires_at: str | None) -> int:
    if not expires_at:
        return 7
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        delta = expiry - datetime.now(timezone.utc)
        return max(1, int(delta.total_seconds() // 86400) + (1 if delta.total_seconds() % 86400 else 0))
    except Exception:
        return 7


def _looks_like_markdown_text(value: str | None) -> bool:
    source = str(value or "").strip()
    if not source:
        return False
    lower = source.lower()
    if "<html" in lower or "<body" in lower:
        return False
    return (
        source.startswith("# ")
        or source.startswith("## ")
        or source.startswith("### ")
        or source.startswith("![")
        or "\n![" in source
        or "\n# " in source
        or "\n## " in source
        or "\n### " in source
        or "\n* " in source
        or "\n- " in source
        or source.startswith("**")
        or "\n**" in source
    )


def _resolved_document_html(document_html: str | None, document_markdown: str | None) -> str:
    html = str(document_html or "").strip()
    markdown = str(document_markdown or "").strip()
    if html:
        return markdown_to_html(html) if _looks_like_markdown_text(html) else html
    if markdown:
        return markdown_to_html(markdown)
    return ""


@router.post("/generate", response_model=BlueprintGenerateResponse)
async def blueprint_generate(
    payload: BlueprintGenerateRequest,
    user=Depends(get_current_user),
) -> BlueprintGenerateResponse:
    return await generate_blueprint(payload, user_id=user["id"])


@router.get("/documents", response_model=list[BlueprintDocumentListItem])
async def blueprint_documents_list(
    type: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user=Depends(get_current_user),
) -> list[BlueprintDocumentListItem]:
    return await list_documents(user_id=user["id"], type=type, limit=limit)


@router.get("/documents/{document_id}", response_model=BlueprintDocument)
async def blueprint_documents_get(
    document_id: str,
    user=Depends(get_current_user),
) -> BlueprintDocument:
    doc = await get_document(user_id=user["id"], document_id=document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.patch("/documents/{document_id}", response_model=BlueprintDocument)
async def blueprint_documents_update(
    document_id: str,
    payload: BlueprintDocumentUpdateRequest,
    user=Depends(get_current_user),
) -> BlueprintDocument:
    doc = await update_document(user_id=user["id"], document_id=document_id, patch=payload)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def blueprint_documents_delete(
    document_id: str,
    user=Depends(get_current_user),
) -> None:
    ok = await delete_document(user_id=user["id"], document_id=document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return None


@router.post("/documents/{document_id}/share", response_model=BlueprintShareLinkResponse)
async def blueprint_documents_share_create(
    document_id: str,
    payload: BlueprintShareCreateRequest | None = None,
    user=Depends(get_current_user),
) -> BlueprintShareLinkResponse:
    payload = payload or BlueprintShareCreateRequest()
    token = await create_share_token(
        user_id=user["id"],
        document_id=document_id,
        email=payload.email,
        expires_in_days=payload.expires_in_days,
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    email_sent = False
    email_error = None
    if payload.email:
        doc = await get_document(user_id=user["id"], document_id=document_id)
        document_title = doc.title if doc else "Shared document"
        company_name = doc.company_name if doc else get_settings().app_name
        delivery = await send_document_share_email(
            to_email=payload.email,
            sender_email=user["email"],
            share_url=_shared_document_url(token),
            document_title=document_title,
            company_name=company_name,
            expires_in_days=payload.expires_in_days,
        )
        email_sent = delivery.sent
        email_error = delivery.error
    return BlueprintShareLinkResponse(token=token, email_sent=email_sent, email_error=email_error)


@router.post("/financial-documents/share", response_model=BlueprintFinancialShareResponse)
async def blueprint_financial_documents_share(
    payload: BlueprintFinancialShareRequest,
    user=Depends(get_current_user),
) -> BlueprintFinancialShareResponse:
    document_id = await save_document(
        user_id=user["id"],
        document_id=payload.document_id,
        type=payload.type,
        title=payload.title,
        company_name=payload.company_name,
        industry=payload.industry,
        pricing_model=payload.pricing_model,
        workspace_id=payload.workspace_id,
        document_markdown=payload.document_markdown,
        document_html=payload.document_html,
        provider="financials",
        model="workspace",
    )
    token = await create_share_token(
        user_id=user["id"],
        document_id=document_id,
        email=payload.email,
        expires_in_days=payload.expires_in_days,
    )
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    email_sent = False
    email_error = None
    if payload.email:
        delivery = await send_document_share_email(
            to_email=payload.email,
            sender_email=user["email"],
            share_url=_shared_document_url(token),
            document_title=payload.title,
            company_name=payload.company_name,
            expires_in_days=payload.expires_in_days,
        )
        email_sent = delivery.sent
        email_error = delivery.error
    return BlueprintFinancialShareResponse(
        token=token,
        document_id=document_id,
        email_sent=email_sent,
        email_error=email_error,
    )


@router.delete("/documents/{document_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def blueprint_documents_share_revoke(
    document_id: str,
    user=Depends(get_current_user),
) -> None:
    ok = await revoke_share_tokens(user_id=user["id"], document_id=document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return None


@router.post("/share/{token}/email", response_model=BlueprintShareEmailResponse)
async def blueprint_share_send_email(
    token: str,
    payload: BlueprintShareEmailRequest,
    user=Depends(get_current_user),
) -> BlueprintShareEmailResponse:
    share = await get_share_record_for_owner(token=token, user_id=user["id"])
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", share["document_id"]), ("user_id", "eq", user["id"])],
        single=True,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    delivery = await send_document_share_email(
        to_email=str(payload.email),
        sender_email=user["email"],
        share_url=_shared_document_url(token),
        document_title=str(doc.get("title") or "Shared document"),
        company_name=str(doc.get("company_name") or get_settings().app_name),
        expires_in_days=_remaining_expiry_days(share.get("expires_at")),
    )
    return BlueprintShareEmailResponse(sent=delivery.sent, error=delivery.error)


@router.get("/share/{token}", response_model=BlueprintSharedDocument)
async def blueprint_shared_document_get(token: str, email: str | None = Query(default=None)) -> BlueprintSharedDocument:
    try:
        doc = await get_shared_document_by_token(token=token, viewer_email=email)
    except RuntimeError as exc:
        if str(exc) == "EXPIRED":
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This share link has expired.")
        raise
    except PermissionError as exc:
        code = str(exc)
        if code == "EMAIL_REQUIRED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address required for this share link.")
        if code == "EMAIL_MISMATCH":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This share link is restricted to a different email address.")
        raise
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return doc


@router.get("/share/{token}/export")
async def blueprint_shared_document_export(
    token: str,
    format: str = Query(default="pdf", pattern="^(pdf|doc)$"),
    email: str | None = Query(default=None),
):
    try:
        doc = await get_shared_document_by_token(token=token, viewer_email=email)
    except RuntimeError as exc:
        if str(exc) == "EXPIRED":
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This share link has expired.")
        raise
    except PermissionError as exc:
        code = str(exc)
        if code == "EMAIL_REQUIRED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address required for this share link.")
        if code == "EMAIL_MISMATCH":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This share link is restricted to a different email address.")
        raise
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")

    title = doc.title or doc.type or "document"
    raw_html = _resolved_document_html(doc.document_html, doc.document_markdown)
    body_html = extract_export_body(raw_html)
    html = render_export_html(title=title, body_html=body_html)

    safe_name = "".join(ch for ch in title.lower().replace(" ", "-") if ch.isalnum() or ch in "-_")
    safe_name = safe_name or "document"

    if format == "doc":
        return Response(
            content=html,
            media_type="application/msword",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.doc"'},
        )

    pdf_html = render_pdf_html(title=title, body_html=body_html)
    pdf_bytes = html_to_pdf(pdf_html)
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF export failed")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )


@router.get("/documents/{document_id}/export")
async def blueprint_documents_export(
    document_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|doc)$"),
    user=Depends(get_current_user),
):
    doc = await get_document(user_id=user["id"], document_id=document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    title = doc.title or doc.type or "document"
    raw_html = _resolved_document_html(doc.document_html, doc.document_markdown)
    body_html = extract_export_body(raw_html)
    html = render_export_html(title=title, body_html=body_html)

    safe_name = "".join(ch for ch in title.lower().replace(" ", "-") if ch.isalnum() or ch in "-_")
    safe_name = safe_name or "document"

    if format == "doc":
        return Response(
            content=html,
            media_type="application/msword",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.doc"'},
        )

    pdf_html = render_pdf_html(title=title, body_html=body_html)
    pdf_bytes = html_to_pdf(pdf_html)
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PDF export failed")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )
