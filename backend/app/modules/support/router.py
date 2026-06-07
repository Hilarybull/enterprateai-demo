from __future__ import annotations

import re
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.supabase import sb_insert, sb_select

router = APIRouter(prefix="/support", tags=["support"])

_EMAIL_RE = re.compile(r"^[\w.\+\-]+@[\w\-]+\.[a-zA-Z]{2,}$")


class SupportMessageIn(BaseModel):
    name: str = ""
    email: str = ""
    message: str
    type: str = "support"


class ModuleInterestIn(BaseModel):
    email: str
    feature: str


@router.post("/message", status_code=status.HTTP_201_CREATED)
async def submit_support_message(body: SupportMessageIn) -> dict:
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message is required.")
    msg_type = body.type.strip().lower() if body.type.strip().lower() in ("feedback", "support") else "support"
    await sb_insert("support_messages", {
        "id": str(uuid4()),
        "name": body.name.strip(),
        "email": body.email.strip(),
        "message": body.message.strip(),
        "type": msg_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


class WaitlistIn(BaseModel):
    email: str
    role: str = ""
    source: str = "landing"


@router.post("/waitlist", status_code=status.HTTP_201_CREATED)
async def join_waitlist(body: WaitlistIn) -> dict:
    email = body.email.strip().lower()
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    existing = await sb_select("mailing_list", filters=[("email", "eq", email)], single=True)
    if existing:
        return {"ok": True, "already_subscribed": True}
    await sb_insert("mailing_list", {
        "id": str(uuid4()),
        "email": email,
        "source": (body.source or "landing").strip()[:80],
        "subscribed_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "already_subscribed": False}


@router.get("/waitlist-count")
async def get_waitlist_count() -> dict:
    try:
        rows = await sb_select("mailing_list", columns="id")
        return {"count": len(rows)}
    except Exception:
        return {"count": 0}


@router.post("/module-interest", status_code=status.HTTP_201_CREATED)
async def track_module_interest(body: ModuleInterestIn) -> dict:
    email = body.email.strip().lower()
    feature = body.feature.strip()
    if not email or not feature:
        raise HTTPException(status_code=400, detail="email and feature are required.")
    await sb_insert("module_interest", {
        "id": str(uuid4()),
        "email": email,
        "feature": feature,
        "clicked_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}
