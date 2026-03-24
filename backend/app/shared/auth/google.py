from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None = None
    picture: str | None = None


def verify_google_id_token(*, credential: str, audience: str) -> GoogleIdentity:
    try:
        req = google_requests.Request()
        payload: Dict[str, Any] = id_token.verify_oauth2_token(credential, req, audience=audience)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential")

    email = str(payload.get("email") or "").strip().lower()
    sub = str(payload.get("sub") or "").strip()
    if not email or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential missing required claims")

    email_verified = bool(payload.get("email_verified", False))
    if not email_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email not verified")

    return GoogleIdentity(
        sub=sub,
        email=email,
        email_verified=email_verified,
        name=payload.get("name"),
        picture=payload.get("picture"),
    )

