from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.modules.blueprint.schemas import (
    BlueprintDocument,
    BlueprintDocumentListItem,
    BlueprintDocumentUpdateRequest,
    BlueprintType,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _oid(id_str: str) -> ObjectId:
    if not ObjectId.is_valid(id_str):
        raise ValueError("Invalid ObjectId")
    return ObjectId(id_str)


def _collection(db: AsyncIOMotorDatabase):
    return db["blueprint_documents"]


async def create_document(
    db: AsyncIOMotorDatabase,
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
    update: dict[str, Any] = {
        "title": title,
        "company_name": company_name,
        "industry": industry,
        "pricing_model": pricing_model,
        "workspace_id": workspace_id,
        "document_markdown": document_markdown,
        "document_html": document_html,
        "provider": provider,
        "model": model,
        "updated_at": ts,
    }
    res = await _collection(db).find_one_and_update(
        {"user_id": user_id, "type": type},
        {"$set": update, "$setOnInsert": {"created_at": ts, "user_id": user_id, "type": type}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if not res:
        raise RuntimeError("Failed to upsert document")
    return str(res["_id"])


async def list_documents(
    db: AsyncIOMotorDatabase,
    *,
    user_id: str,
    type: Optional[str] = None,
    limit: int = 30,
) -> list[BlueprintDocumentListItem]:
    query: dict[str, Any] = {"user_id": user_id}
    if type:
        query["type"] = type
    query["document_markdown"] = {"$exists": True, "$ne": ""}

    cur = _collection(db).find(query, {"document_markdown": 0, "document_html": 0}).sort("updated_at", -1)
    out: list[BlueprintDocumentListItem] = []
    seen: set[str] = set()
    async for d in cur:
        doc_type = d.get("type")
        if not doc_type:
            continue
        if doc_type in seen:
            continue
        seen.add(doc_type)
        out.append(
            BlueprintDocumentListItem(
                id=str(d["_id"]),
                type=doc_type,
                title=d.get("title") or "",
                company_name=d.get("company_name") or "",
                updated_at=d.get("updated_at"),
            )
        )
        if len(out) >= limit:
            break
    return out


async def get_document(
    db: AsyncIOMotorDatabase,
    *,
    user_id: str,
    document_id: str,
) -> BlueprintDocument | None:
    d = await _collection(db).find_one({"_id": _oid(document_id), "user_id": user_id})
    if not d:
        return None
    return BlueprintDocument.model_validate(d)


async def update_document(
    db: AsyncIOMotorDatabase,
    *,
    user_id: str,
    document_id: str,
    patch: BlueprintDocumentUpdateRequest,
) -> BlueprintDocument | None:
    update: dict[str, Any] = {"updated_at": _now()}
    if patch.title is not None:
        update["title"] = patch.title
    if patch.document_markdown is not None:
        update["document_markdown"] = patch.document_markdown
    if patch.document_html is not None:
        update["document_html"] = patch.document_html

    res = await _collection(db).find_one_and_update(
        {"_id": _oid(document_id), "user_id": user_id},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
    )
    if not res:
        return None
    return BlueprintDocument.model_validate(res)


async def delete_document(
    db: AsyncIOMotorDatabase,
    *,
    user_id: str,
    document_id: str,
) -> bool:
    res = await _collection(db).delete_one({"_id": _oid(document_id), "user_id": user_id})
    return bool(res.deleted_count)
