from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.modules.blueprint.repository import delete_document, get_document, list_documents, save_document, update_document
from app.modules.blueprint.exporter import html_to_pdf, markdown_to_html, render_export_html, render_pdf_html
from app.modules.blueprint.schemas import (
    BlueprintDocument,
    BlueprintDocumentListItem,
    BlueprintDocumentUpdateRequest,
    BlueprintFinancialShareRequest,
    BlueprintFinancialShareResponse,
    BlueprintGenerateRequest,
    BlueprintGenerateResponse,
    BlueprintShareLinkResponse,
    BlueprintSharedDocument,
)
from app.modules.blueprint.service import generate_blueprint
from app.modules.blueprint.share_repository import create_share_token, get_shared_document_by_token, revoke_share_tokens
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/blueprint", tags=["blueprint"])


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
    user=Depends(get_current_user),
) -> BlueprintShareLinkResponse:
    token = await create_share_token(user_id=user["id"], document_id=document_id)
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return BlueprintShareLinkResponse(token=token)


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
    token = await create_share_token(user_id=user["id"], document_id=document_id)
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return BlueprintFinancialShareResponse(token=token, document_id=document_id)


@router.delete("/documents/{document_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def blueprint_documents_share_revoke(
    document_id: str,
    user=Depends(get_current_user),
) -> None:
    ok = await revoke_share_tokens(user_id=user["id"], document_id=document_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return None


@router.get("/share/{token}", response_model=BlueprintSharedDocument)
async def blueprint_shared_document_get(token: str) -> BlueprintSharedDocument:
    doc = await get_shared_document_by_token(token=token)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return doc


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
    body_html = doc.document_html or markdown_to_html(doc.document_markdown or "")
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
