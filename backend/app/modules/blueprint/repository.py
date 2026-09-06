from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update
from app.modules.blueprint.schemas import (
    BlueprintDocument,
    BlueprintDocumentListItem,
    BlueprintDocumentUpdateRequest,
    BlueprintType,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_document(
    *,
    user_id: str,
    type: BlueprintType,
    title: str,
    company_name: str,
    industry: Optional[str],
    pricing_model: Optional[str],
    workspace_id: Optional[str],
    document_markdown: str,
    document_html: Optional[str],
    provider: Optional[str],
    model: Optional[str],
) -> str:
    if not document_markdown or not str(document_markdown).strip():
        raise ValueError("Empty document_markdown")
    ts = _now()
    payload: dict[str, Any] = {
        "id": str(uuid4()),
        "user_id": user_id,
        "type": type,
        "title": title,
        "company_name": company_name,
        "industry": industry,
        "pricing_model": pricing_model,
        "workspace_id": workspace_id,
        "document_markdown": document_markdown,
        "document_html": document_html,
        "provider": provider,
        "model": model,
        "created_at": ts.isoformat(),
        "updated_at": ts.isoformat(),
    }

    rows = await sb_insert("blueprint_documents", payload=payload)
    if not rows:
        raise RuntimeError("Failed to insert document")
    return rows[0]["id"]


async def save_document(
    *,
    user_id: str,
    type: BlueprintType,
    title: str,
    company_name: str,
    industry: Optional[str],
    pricing_model: Optional[str],
    workspace_id: Optional[str],
    document_markdown: str,
    document_html: Optional[str],
    provider: Optional[str],
    model: Optional[str],
    document_id: Optional[str] = None,
) -> str:
    if document_id:
        rows = await sb_update(
            "blueprint_documents",
            filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
            payload={
                "type": type,
                "title": title,
                "company_name": company_name,
                "industry": industry,
                "pricing_model": pricing_model,
                "workspace_id": workspace_id,
                "document_markdown": document_markdown,
                "document_html": document_html,
                "provider": provider,
                "model": model,
                "updated_at": _now().isoformat(),
            },
        )
        if rows:
            return rows[0]["id"]
    return await create_document(
        user_id=user_id,
        type=type,
        title=title,
        company_name=company_name,
        industry=industry,
        pricing_model=pricing_model,
        workspace_id=workspace_id,
        document_markdown=document_markdown,
        document_html=document_html,
        provider=provider,
        model=model,
    )


async def list_documents(
    *,
    user_id: str,
    type: Optional[str] = None,
    limit: int = 30,
) -> list[BlueprintDocumentListItem]:
    filters: list[tuple[str, str, Any]] = [("user_id", "eq", user_id)]
    if type:
        filters.append(("type", "eq", type))
    data = await sb_select(
        "blueprint_documents",
        filters=filters,
        columns="id,type,title,company_name,updated_at,document_markdown",
        order="updated_at",
        desc=True,
        limit=limit,
    )
    _VALID_TYPES = {"business_plan", "client_proposal", "sales_letter", "sales_quotation", "invoice_template", "receipt", "cashflow_analysis", "financial_projection"}
    out: list[BlueprintDocumentListItem] = []
    for d in data:
        doc_type = d.get("type")
        if not doc_type or doc_type not in _VALID_TYPES:
            continue
        if not d.get("document_markdown"):
            continue
        out.append(
            BlueprintDocumentListItem(
                id=d["id"],
                type=doc_type,
                title=d.get("title") or "",
                company_name=d.get("company_name") or "",
                updated_at=d.get("updated_at"),
            )
        )
    return out


async def get_document(
    *,
    user_id: str,
    document_id: str,
) -> BlueprintDocument | None:
    d = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
        single=True,
    )
    if not d:
        return None
    return BlueprintDocument.model_validate(d)


async def update_document(
    *,
    user_id: str,
    document_id: str,
    patch: BlueprintDocumentUpdateRequest,
) -> BlueprintDocument | None:
    update: dict[str, Any] = {"updated_at": _now().isoformat()}
    if patch.title is not None:
        update["title"] = patch.title
    if patch.document_markdown is not None:
        update["document_markdown"] = patch.document_markdown
    if patch.document_html is not None:
        update["document_html"] = patch.document_html

    rows = await sb_update(
        "blueprint_documents",
        filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
        payload=update,
    )
    if not rows:
        return None
    return BlueprintDocument.model_validate(rows[0])


async def delete_document(
    *,
    user_id: str,
    document_id: str,
) -> bool:
    await sb_delete(
        "blueprint_documents",
        filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
    )
    return True
