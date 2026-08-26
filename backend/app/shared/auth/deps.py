from __future__ import annotations

import time
from typing import Any, Dict

from fastapi import Depends, HTTPException, Request, status
from app.core.supabase import sb_select
from app.shared.auth.security import decode_token

# Short-lived in-process user cache to avoid per-request Supabase round-trips.
# Keyed by JWT token string; each entry expires after _USER_CACHE_TTL seconds.
_USER_CACHE_TTL = 60  # seconds
_user_cache: dict[str, tuple[Dict[str, Any], float]] = {}


def _cache_get(token: str) -> Dict[str, Any] | None:
    entry = _user_cache.get(token)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    _user_cache.pop(token, None)
    return None


def _cache_set(token: str, user: Dict[str, Any]) -> None:
    # Evict stale entries occasionally to prevent unbounded growth
    if len(_user_cache) > 2000:
        now = time.monotonic()
        stale = [k for k, v in _user_cache.items() if v[1] <= now]
        for k in stale:
            _user_cache.pop(k, None)
    _user_cache[token] = (user, time.monotonic() + _USER_CACHE_TTL)


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
    cached = _cache_get(token)
    if cached is not None:
        return None if cached.get("is_blocked") else cached
    user = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user or user.get("is_blocked"):
        return None
    _cache_set(token, user)
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
    cached = _cache_get(token)
    if cached is not None:
        if cached.get("is_blocked"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended. Contact support at tech.support@enterprateai.com")
        return cached
    user = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.get("is_blocked"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended. Contact support at tech.support@enterprateai.com")
    _cache_set(token, user)
    return user
