"""The audit's security gaps: attempt limits, real client address, forged-sign-in guard, server-side sign-out, private addresses."""
import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import main as app_main
from app.core.config import get_settings
from app.modules.agent import credibility
from app.shared import limits, net
from app.shared.auth import router as auth
from app.shared.auth.deps import get_current_user
from app.shared.auth.schemas import LoginRequest, ResetPasswordRequest
from app.shared.auth.security import create_access_token, decode_token
from app.shared.llm import openai_client as llm

REAL_FETCH = credibility.fetch_page      # conftest stands in for it during each test


def req(headers=None, host="1.2.3.4"):
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()], "client": (host, 1), "method": "GET", "path": "/", "query_string": b""})


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    limits._hits.clear()
    limits._revoked.clear()
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(get_settings(), "client_ip_header", None, raising=False)
    yield
    limits._hits.clear()


def test_the_visitors_address_is_read_as_each_host_guarantees_it(monkeypatch):
    assert limits.client_ip(req({"x-forwarded-for": "9.9.9.9, 1.1.1.1"})) == "9.9.9.9"      # Railway's edge sets it
    monkeypatch.setenv("RENDER", "true")
    assert limits.client_ip(req({"x-forwarded-for": "6.6.6.6, 9.9.9.9", "cf-connecting-ip": "9.9.9.9"})) == "9.9.9.9"      # Render passes on a faked one
    monkeypatch.setattr(get_settings(), "client_ip_header", "x-real-ip", raising=False)
    assert limits.client_ip(req({"x-real-ip": "8.8.8.8"})) == "8.8.8.8"


def test_wrong_passwords_stop_at_the_limit_and_a_right_one_clears_the_count(monkeypatch):
    async def row(*_a, **_k):
        return {"id": "owner@example.com", "password_hash": "h", "email_verified": True}
    monkeypatch.setattr(auth, "sb_select", row)
    good = {"ok": False}
    monkeypatch.setattr(auth, "verify_password", lambda _p, _h: good["ok"])

    def attempt():
        return asyncio.run(auth.login(LoginRequest(email="owner@example.com", password="password1"), req()))
    for _ in range(auth.LOGIN_PAIR[0]):
        with pytest.raises(HTTPException) as e:
            attempt()
        assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:
        attempt()
    assert e.value.status_code == 429
    # From another address the owner is not locked out by that
    good["ok"] = True
    assert asyncio.run(auth.login(LoginRequest(email="owner@example.com", password="password1"), req(host="5.5.5.5"))).access_token


def test_a_short_code_can_never_reset_a_password_signed_out(monkeypatch):
    async def row(*_a, **_k):
        raise AssertionError("never looked up")
    monkeypatch.setattr(auth, "sb_select", row)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.reset_password(ResetPasswordRequest(token="1234567890", new_password="password12"), req()))
    assert e.value.status_code == 400


def test_signing_out_ends_that_token_on_the_server(monkeypatch):
    async def row(*_a, **_k):
        return {"id": "owner@example.com"}
    monkeypatch.setattr("app.shared.auth.deps.sb_select", row)
    token = create_access_token("owner@example.com")
    other = create_access_token("owner@example.com")
    call = req({"authorization": f"Bearer {token}"})
    assert asyncio.run(get_current_user(call))["id"] == "owner@example.com"
    asyncio.run(auth.logout(call))
    with pytest.raises(HTTPException) as e:
        asyncio.run(get_current_user(call))
    assert e.value.status_code == 401
    assert asyncio.run(get_current_user(req({"authorization": f"Bearer {other}"})))["id"] == "owner@example.com"      # the other device stays in
    assert decode_token(other)["jti"] != decode_token(token)["jti"]


def test_the_demo_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_login_enabled", False, raising=False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.demo_login(req()))
    assert e.value.status_code == 404


class _S:
    environment, jwt_secret_key = "production", "CHANGE_ME"


def test_production_refuses_to_start_on_the_default_secret_and_others_only_warn():
    with pytest.raises(RuntimeError):
        app_main._check_signing_secret(_S)

    class Fine(_S):
        jwt_secret_key = "x" * 40

    class Dev(_S):
        environment = "development"
    app_main._check_signing_secret(Fine)
    app_main._check_signing_secret(Dev)


@pytest.mark.parametrize("url", ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5", "http://localhost:8001/x", "http://[::1]/", "ftp://example.com", "http://db.internal/"])
def test_the_servers_own_network_is_never_fetched(url):
    assert asyncio.run(net.blocked_url(url)) is True


def test_a_redirect_into_the_private_network_is_stopped():
    class Resp:
        status_code, headers, text, url = 302, {"location": "http://169.254.169.254/latest"}, "", "http://8.8.8.8/"

    class Client:
        async def get(self, *_a, **k):
            assert k["follow_redirects"] is False
            return Resp()
    got = asyncio.run(REAL_FETCH(Client(), "http://8.8.8.8/"))
    assert got == {"ok": False, "url": "http://8.8.8.8/", "reason": "blocked"}


def test_ai_calls_wait_their_turn_and_give_up_rather_than_pile_up(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_max_concurrent", 1, raising=False)
    monkeypatch.setattr(s, "ai_queue_seconds", 0.01, raising=False)

    async def go():
        async with llm.ai_slot():
            with pytest.raises(llm.AIBusy):
                async with llm.ai_slot():
                    pass
        async with llm.ai_slot():
            return True
    assert asyncio.run(go())


def test_the_daily_ceiling_stops_ai_calls(monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_call_limit", 1, raising=False)
    llm._today.update(day=0, calls=0)

    async def go():
        async with llm.ai_slot():
            pass
        with pytest.raises(llm.AIBusy):
            async with llm.ai_slot():
                pass
    asyncio.run(go())
