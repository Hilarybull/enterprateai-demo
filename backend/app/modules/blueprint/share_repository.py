from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from app.core.supabase import sb_insert, sb_select, sb_update
from app.modules.blueprint.schemas import BlueprintSharedDocument


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_share_token(*, user_id: str, document_id: str) -> str | None:
    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
        columns="id",
        single=True,
    )
    if not doc:
        return None

    # Revoke any previous shares for this document.
    await sb_update(
        "blueprint_document_shares",
        filters=[("document_id", "eq", document_id), ("user_id", "eq", user_id)],
        payload={"revoked": True, "updated_at": _now_iso()},
    )

    token = secrets.token_urlsafe(32)
    payload: dict[str, Any] = {
        "user_id": user_id,
        "document_id": document_id,
        "token": token,
        "revoked": False,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    rows = await sb_insert("blueprint_document_shares", payload=payload)
    if not rows:
        raise RuntimeError("Failed to create share token")
    return token


async def revoke_share_tokens(*, user_id: str, document_id: str) -> bool:
    rows = await sb_update(
        "blueprint_document_shares",
        filters=[("document_id", "eq", document_id), ("user_id", "eq", user_id), ("revoked", "eq", False)],
        payload={"revoked": True, "updated_at": _now_iso()},
    )
    return bool(rows)


async def get_shared_document_by_token(*, token: str) -> BlueprintSharedDocument | None:
    share = await sb_select(
        "blueprint_document_shares",
        filters=[("token", "eq", token), ("revoked", "eq", False)],
        columns="user_id,document_id,token",
        single=True,
    )
    if not share:
        return None

    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", share["document_id"]), ("user_id", "eq", share["user_id"])],
        single=True,
    )
    if not doc:
        return None
    if not (doc.get("document_markdown") or "").strip():
        return None

    # Best-effort access tracking (ignore failures).
    try:
        await sb_update(
            "blueprint_document_shares",
            filters=[("token", "eq", token)],
            payload={"last_accessed_at": _now_iso(), "updated_at": _now_iso()},
        )
    except Exception:
        pass

    return BlueprintSharedDocument(
        type=doc.get("type"),
        title=doc.get("title") or "",
        company_name=doc.get("company_name") or "",
        document_markdown=doc.get("document_markdown") or "",
        document_html=doc.get("document_html"),
        updated_at=doc.get("updated_at"),
    )

