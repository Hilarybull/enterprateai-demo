from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.shared.auth.deps import get_current_user
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select
from app.shared.email.resend import send_email_via_resend

ADMIN_EMAIL = "tech.support@enterprateai.com"

def require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/demo", tags=["demo"])


class BookDemoRequest(BaseModel):
    name: str
    email: str
    company: str
    phone: str | None = None
    role: str | None = None
    message: str | None = None


@router.post("/book")
async def book_demo(payload: BookDemoRequest) -> dict:
    record = {
        "name": payload.name.strip(),
        "email": payload.email.lower().strip(),
        "company": payload.company.strip(),
        "phone": (payload.phone or "").strip() or None,
        "role": (payload.role or "").strip() or None,
        "message": (payload.message or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await sb_insert("demo_requests", record)
    except Exception as exc:
        logger.warning("Could not persist demo request: %s", exc)

    settings = get_settings()
    notify_email = settings.demo_notify_email or settings.resend_from_email
    if notify_email:
        name_esc = record["name"].replace("<", "&lt;")
        email_esc = record["email"].replace("<", "&lt;")
        company_esc = record["company"].replace("<", "&lt;")
        html = (
            "<div style='font-family:sans-serif;max-width:540px;margin:auto'>"
            "<h2 style='color:#1e40af'>New Demo Request</h2>"
            f"<p><strong>Name:</strong> {name_esc}</p>"
            f"<p><strong>Email:</strong> {email_esc}</p>"
            f"<p><strong>Company:</strong> {company_esc}</p>"
            f"<p><strong>Phone:</strong> {record['phone'] or '—'}</p>"
            f"<p><strong>Role / Interest:</strong> {record['role'] or '—'}</p>"
            f"<p><strong>Message:</strong> {record['message'] or '—'}</p>"
            "</div>"
        )
        text = (
            "New Demo Request\n\n"
            f"Name: {record['name']}\n"
            f"Email: {record['email']}\n"
            f"Company: {record['company']}\n"
            f"Phone: {record['phone'] or '—'}\n"
            f"Role / Interest: {record['role'] or '—'}\n"
            f"Message: {record['message'] or '—'}\n"
        )
        await send_email_via_resend(
            to_email=notify_email,
            subject=f"[EnterprateAI] Demo Request – {record['name']} ({record['company']})",
            text_content=text,
            html_content=html,
            sender_name="EnterprateAI",
        )

    return {"ok": True}


@router.get("/requests")
async def list_demo_requests(user=Depends(require_admin)) -> list:
    rows = await sb_select("demo_requests", order="created_at", desc=True)
    return rows or []
