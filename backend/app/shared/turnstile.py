"""Cloudflare Turnstile: a check that a request came from a person, on the doors bots use. Off until TURNSTILE_SECRET_KEY is set."""
from __future__ import annotations

import logging

import httpx
from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.shared.limits import client_ip

logger = logging.getLogger(__name__)

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
REFUSED = "We couldn't confirm this came from a person. Please refresh the page and try again."


async def require_human(request: Request) -> None:
    secret = get_settings().turnstile_secret_key
    if not secret:
        return
    token = str(request.headers.get("x-turnstile-token") or "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REFUSED)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(VERIFY_URL, data={"secret": secret, "response": token, "remoteip": client_ip(request)})
            passed = bool(resp.json().get("success"))
    except (httpx.HTTPError, ValueError):
        # Cloudflare unreachable: real people are not turned away for it. The attempt limits still apply.
        logger.warning("Turnstile could not be reached; letting this request through")
        return
    if not passed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REFUSED)
