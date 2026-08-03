from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update
from app.shared.auth.deps import get_current_user

ADMIN_EMAIL = "tech.support@enterprateai.com"

router = APIRouter(prefix="/research", tags=["research"])


def _require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Admin only.")
    return user


class ResearchItemIn(BaseModel):
    title: str
    description: Optional[str] = None
    type: str = "Research"
    content: Optional[str] = None
    status: str = "draft"


# ── Public endpoints ──────────────────────────────────────────────────────────

@router.get("/items")
async def list_items():
    try:
        return await sb_select(
            "research_items",
            filters=[("status", "eq", "published")],
            order="created_at",
            desc=True,
        )
    except Exception:
        return []


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/items")
async def admin_list_items(_=Depends(_require_admin)):
    try:
        return await sb_select("research_items", order="created_at", desc=True)
    except Exception:
        return []


@router.post("/admin/items", status_code=201)
async def admin_create_item(body: ResearchItemIn, _=Depends(_require_admin)):
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": str(uuid4()),
        "title": body.title,
        "description": body.description,
        "type": body.type,
        "content": body.content,
        "status": body.status,
        "published_at": now if body.status == "published" else None,
        "created_at": now,
        "updated_at": now,
    }
    result = await sb_insert("research_items", row)
    return result[0] if result else row


@router.put("/admin/items/{item_id}")
async def admin_update_item(item_id: str, body: ResearchItemIn, _=Depends(_require_admin)):
    existing = await sb_select("research_items", filters=[("id", "eq", item_id)])
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found.")
    now = datetime.now(timezone.utc).isoformat()
    published_at = existing[0].get("published_at")
    if body.status == "published" and not published_at:
        published_at = now
    updates = {
        "title": body.title,
        "description": body.description,
        "type": body.type,
        "content": body.content,
        "status": body.status,
        "published_at": published_at,
        "updated_at": now,
    }
    result = await sb_update("research_items", payload=updates, filters=[("id", "eq", item_id)])
    return result[0] if result else updates


@router.delete("/admin/items/{item_id}", status_code=204)
async def admin_delete_item(item_id: str, _=Depends(_require_admin)):
    await sb_delete("research_items", filters=[("id", "eq", item_id)])
