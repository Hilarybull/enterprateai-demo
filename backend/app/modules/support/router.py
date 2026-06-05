from __future__ import annotations

from uuid import uuid4
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.supabase import sb_insert

router = APIRouter(prefix="/support", tags=["support"])


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
