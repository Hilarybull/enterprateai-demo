from __future__ import annotations

from typing import Any, Dict

from fastapi import Depends, HTTPException, Request, status
from app.core.supabase import sb_select
from app.shared.auth.security import decode_token


async def get_optional_user(request: Request) -> Dict[str, Any] | None:
    """Like get_current_user but returns None instead of raising 401."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user or user.get("is_blocked"):
        return None
    return user


async def get_current_user(request: Request) -> Dict[str, Any]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    user = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended. Contact support at tech.support@enterprateai.com")
    return user
