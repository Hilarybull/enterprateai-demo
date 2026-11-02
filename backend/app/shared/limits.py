"""Attempt limits and signed-out tokens, and where a request really came from.

Counted in this process, or in Redis when REDIS_URL is set so several processes share one count. Redis being unavailable
never stops anyone signing in: the count falls back to this process.
"""
from __future__ import annotations

import logging
import os
import time
import uuid

from fastapi import Request

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_hits: dict[str, list[float]] = {}
_revoked: dict[str, float] = {}
_redis = None
_redis_tried = False


def _client():
    global _redis, _redis_tried
    if _redis_tried:
        return _redis
    _redis_tried = True
    url = get_settings().redis_url
    if url:
        try:
            import redis

            _redis = redis.Redis.from_url(url, socket_timeout=0.2, socket_connect_timeout=0.2, decode_responses=True)
        except Exception:      # noqa: BLE001 - counted here instead
            logger.warning("limits: Redis could not be set up, counting in this process", exc_info=True)
    return _redis


def client_ip(request: Request) -> str:
    """The visitor's address, from what each host guarantees. Render passes on an X-Forwarded-For the visitor sent, so its
    Cloudflare header is read there; Railway's edge sets X-Forwarded-For itself. CLIENT_IP_HEADER overrides both."""
    named = (get_settings().client_ip_header or "").strip()
    headers = [named] if named else ["cf-connecting-ip", "true-client-ip"] if os.environ.get("RENDER") else []
    for name in headers:
        got = str(request.headers.get(name) or "").split(",")[0].strip()
        if got:
            return got
    forwarded = str(request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "") or "unknown"


def over(key: str, limit: int, window_s: int) -> bool:
    """True once `limit` attempts have been noted in the last `window_s` seconds. Notes nothing."""
    now = time.time()
    r = _client()
    if r is not None:
        try:
            r.zremrangebyscore(f"limit:{key}", 0, now - window_s)
            return int(r.zcard(f"limit:{key}")) >= limit
        except Exception:      # noqa: BLE001
            logger.warning("limits: Redis unavailable, counting in this process")
    recent = [t for t in _hits.get(key, []) if now - t < window_s]
    if recent:
        _hits[key] = recent
    else:
        _hits.pop(key, None)
    return len(recent) >= limit


def note(key: str, window_s: int) -> None:
    now = time.time()
    r = _client()
    if r is not None:
        try:
            r.zadd(f"limit:{key}", {f"{now}:{uuid.uuid4().hex[:8]}": now})
            r.expire(f"limit:{key}", window_s)
            return
        except Exception:      # noqa: BLE001
            logger.warning("limits: Redis unavailable, counting in this process")
    if len(_hits) > 20000:
        _hits.clear()
    _hits.setdefault(key, []).append(now)


def hit(key: str, limit: int, window_s: int) -> bool:
    """Counts this attempt. False when it is over the limit, and then it isn't counted."""
    if over(key, limit, window_s):
        return False
    note(key, window_s)
    return True


def clear(key: str) -> None:
    r = _client()
    if r is not None:
        try:
            r.delete(f"limit:{key}")
        except Exception:      # noqa: BLE001
            pass
    _hits.pop(key, None)


def revoke(jti: str, expires_at: float) -> None:
    """This sign-in stops working, until it would have expired anyway. Kept in memory it lasts until a restart; in Redis, for good."""
    ttl = int(expires_at - time.time())
    if not jti or ttl <= 0:
        return
    r = _client()
    if r is not None:
        try:
            r.setex(f"revoked:{jti}", ttl, "1")
        except Exception:      # noqa: BLE001
            logger.warning("limits: Redis unavailable, sign-out kept in this process")
    now = time.time()
    if len(_revoked) > 5000:
        for k in [k for k, v in _revoked.items() if v <= now]:
            _revoked.pop(k, None)
    _revoked[jti] = expires_at


def is_revoked(jti: str | None) -> bool:
    if not jti:
        return False
    if _revoked.get(jti, 0) > time.time():
        return True
    r = _client()
    if r is not None:
        try:
            return bool(r.exists(f"revoked:{jti}"))
        except Exception:      # noqa: BLE001
            return False
    return False
