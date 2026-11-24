"""New passwords: long enough, not common, not breached. The check never stops someone when it can't be reached."""
import asyncio
import hashlib

import httpx
import pytest
from fastapi import HTTPException

from app.shared.auth import password_rules as rules

REAL_BREACH_CHECK = rules._seen_in_breaches      # conftest stands in for it during each test


def refused(password):
    with pytest.raises(HTTPException) as e:
        asyncio.run(rules.check_new_password(password))
    assert e.value.status_code == 422
    return e.value.detail


def test_too_short_and_common_are_refused_in_plain_words():
    assert refused("short1234") == rules.TOO_SHORT
    assert refused("") == rules.TOO_SHORT
    assert refused("Password123") == rules.TOO_COMMON


def test_a_long_phrase_passes():
    assert asyncio.run(rules.check_new_password("correct horse battery")) is None


class _Client:
    text = ""
    error = None
    asked = None

    def __init__(self, **_k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def get(self, url, headers=None):
        _Client.asked = url
        if _Client.error:
            raise _Client.error
        return type("R", (), {"text": _Client.text, "raise_for_status": staticmethod(lambda: None)})


def test_a_breached_password_is_refused_and_only_five_characters_leave(monkeypatch):
    monkeypatch.setattr(rules.httpx, "AsyncClient", _Client)
    pw = "some long phrase here"
    digest = hashlib.sha1(pw.encode()).hexdigest().upper()
    _Client.error, _Client.text = None, f"AAAA:3\n{digest[5:]}:12\n"
    assert asyncio.run(REAL_BREACH_CHECK(pw)) is True
    assert _Client.asked.endswith(f"/range/{digest[:5]}") and digest[5:] not in _Client.asked and pw not in _Client.asked
    _Client.text = f"{digest[5:]}:0\n"      # a padding line, not a real match
    assert asyncio.run(REAL_BREACH_CHECK(pw)) is False


def test_the_check_being_down_stops_nobody(monkeypatch):
    monkeypatch.setattr(rules.httpx, "AsyncClient", _Client)
    _Client.error = httpx.ConnectError("down")
    assert asyncio.run(REAL_BREACH_CHECK("some long phrase here")) is False
    _Client.error = None
