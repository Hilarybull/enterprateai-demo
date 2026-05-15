from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.supabase import sb_insert, sb_select, sb_update
from app.modules.blueprint.schemas import BlueprintSharedDocument


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _missing_column(exc: Exception, column: str) -> bool:
    message = str(exc)
    return f"'{column}' column" in message and "schema cache" in message


def _normalize_expiry_days(expires_in_days: int | None) -> int:
    if expires_in_days is None:
        return 7
    return max(1, min(int(expires_in_days), 30))


async def create_share_token(
    *,
    user_id: str,
    document_id: str,
    email: str | None = None,
    expires_in_days: int = 7,
) -> str | None:
    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", document_id), ("user_id", "eq", user_id)],
        columns="id",
        single=True,
    )
    if not doc:
        return None

    normalized_email = email.strip().lower() if email else None
    expires_at = (datetime.now(timezone.utc) + timedelta(days=_normalize_expiry_days(expires_in_days))).isoformat()

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
        "email": normalized_email,
        "revoked": False,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "expires_at": expires_at,
    }
    try:
        rows = await sb_insert("blueprint_document_shares", payload=payload)
    except Exception as exc:
        # Allow older databases to keep generating share links until the
        # migration adding email/accepted_at is applied.
        if _missing_column(exc, "email"):
            legacy_payload = {k: v for k, v in payload.items() if k != "email"}
            rows = await sb_insert("blueprint_document_shares", payload=legacy_payload)
        else:
            raise
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


async def get_share_record_for_owner(*, token: str, user_id: str) -> dict[str, Any] | None:
    try:
        return await sb_select(
            "blueprint_document_shares",
            filters=[("token", "eq", token), ("user_id", "eq", user_id), ("revoked", "eq", False)],
            columns="user_id,document_id,token,email,expires_at,revoked",
            single=True,
        )
    except Exception as exc:
        if _missing_column(exc, "email"):
            share = await sb_select(
                "blueprint_document_shares",
                filters=[("token", "eq", token), ("user_id", "eq", user_id), ("revoked", "eq", False)],
                columns="user_id,document_id,token,expires_at,revoked",
                single=True,
            )
            if share is not None and "email" not in share:
                share["email"] = None
            return share
        raise


async def get_shared_document_by_token(*, token: str, viewer_email: str | None = None) -> BlueprintSharedDocument | None:
    try:
        share = await sb_select(
            "blueprint_document_shares",
            filters=[("token", "eq", token), ("revoked", "eq", False)],
            columns="user_id,document_id,token,email,expires_at",
            single=True,
        )
    except Exception as exc:
        if _missing_column(exc, "email"):
            share = await sb_select(
                "blueprint_document_shares",
                filters=[("token", "eq", token), ("revoked", "eq", False)],
                columns="user_id,document_id,token,expires_at",
                single=True,
            )
            if share is not None and "email" not in share:
                share["email"] = None
        else:
            raise
    if not share:
        return None

    expires_at = share.get("expires_at")
    if expires_at:
        try:
            if datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                await sb_update(
                    "blueprint_document_shares",
                    filters=[("token", "eq", token)],
                    payload={"revoked": True, "updated_at": _now_iso()},
                )
                raise RuntimeError("EXPIRED")
        except RuntimeError:
            raise
        except Exception:
            pass

    required_email = str(share.get("email") or "").strip().lower()
    normalized_viewer_email = str(viewer_email or "").strip().lower()
    if required_email:
        if not normalized_viewer_email:
            raise PermissionError("EMAIL_REQUIRED")
        if normalized_viewer_email != required_email:
            raise PermissionError("EMAIL_MISMATCH")

    doc = await sb_select(
        "blueprint_documents",
        filters=[("id", "eq", share["document_id"]), ("user_id", "eq", share["user_id"])],
        single=True,
    )
    if not doc:
        return None
    if not str(doc.get("document_markdown") or "").strip() and not str(doc.get("document_html") or "").strip():
        return None

    # Best-effort access tracking (ignore failures).
    try:
        try:
            await sb_update(
                "blueprint_document_shares",
                filters=[("token", "eq", token)],
                payload={"last_accessed_at": _now_iso(), "updated_at": _now_iso(), "accepted_at": _now_iso()},
            )
        except Exception as exc:
            if _missing_column(exc, "accepted_at"):
                await sb_update(
                    "blueprint_document_shares",
                    filters=[("token", "eq", token)],
                    payload={"last_accessed_at": _now_iso(), "updated_at": _now_iso()},
                )
            else:
                raise
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
