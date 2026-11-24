"""What a new password must be: long enough, and not one that's common or has appeared in a data breach. Length beats forced
symbols, which only produce patterns like Password1!. Existing passwords keep working until they're changed."""
from __future__ import annotations

import hashlib
import logging

import httpx
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

MIN_LENGTH = 10
TOO_SHORT = f"Use at least {MIN_LENGTH} characters. A short phrase works well."
TOO_COMMON = "That password is too common. Try a longer phrase."
# Refused even if the breach check can't be reached
_COMMON = frozenset({"1234567890", "12345678910", "0123456789", "1111111111", "0000000000", "qwertyuiop", "password12", "password123", "password1234",
                     "passwordpassword", "iloveyou12", "letmein123", "welcome123", "admin12345", "administrator", "abcdefghij", "abc1234567", "qwerty1234",
                     "enterprate", "enterprateai", "changeme12", "changeme123"})


async def _seen_in_breaches(password: str) -> bool:
    """Have I Been Pwned's range check: only the first 5 characters of the password's SHA-1 ever leave this server."""
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()      # noqa: S324 - the lookup's own format, never for storing
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"https://api.pwnedpasswords.com/range/{digest[:5]}", headers={"Add-Padding": "true"})
            resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Password breach check could not be reached; carrying on")      # never a reason to stop someone signing up
        return False
    for line in resp.text.splitlines():
        rest, _, count = line.partition(":")
        if rest == digest[5:] and count.strip() not in ("", "0"):      # padding lines count 0
            return True
    return False


async def check_new_password(password: str) -> None:
    if len(password or "") < MIN_LENGTH:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=TOO_SHORT)
    if password.strip().lower() in _COMMON or await _seen_in_breaches(password):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=TOO_COMMON)
