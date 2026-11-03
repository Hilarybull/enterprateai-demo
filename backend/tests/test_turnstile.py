"""The person check: off until its key is set; then bots are refused at sign-up, signed-out tasks and emailed codes."""
import asyncio

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core.config import get_settings
from app.modules.agent import goal_router
from app.shared import turnstile
from test_goal_onboarding import world  # noqa: F401 - the fixture


def req(token=None):
    headers = [(b"x-turnstile-token", token.encode())] if token else []
    return Request({"type": "http", "headers": headers, "client": ("1.2.3.4", 1), "method": "POST", "path": "/", "query_string": b""})


class _Client:
    answer = {"success": True}
    error = None
    sent = None

    def __init__(self, **_k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def post(self, _url, data=None):
        _Client.sent = data
        if _Client.error:
            raise _Client.error
        return type("R", (), {"json": staticmethod(lambda: _Client.answer)})


@pytest.fixture()
def on(monkeypatch):
    monkeypatch.setattr(get_settings(), "turnstile_secret_key", "secret", raising=False)
    monkeypatch.setattr(turnstile.httpx, "AsyncClient", _Client)
    _Client.answer, _Client.error, _Client.sent = {"success": True}, None, None


def test_off_until_the_key_is_set(monkeypatch):
    monkeypatch.setattr(get_settings(), "turnstile_secret_key", None, raising=False)
    assert asyncio.run(turnstile.require_human(req())) is None


def test_no_token_or_a_bad_one_is_refused(on):
    with pytest.raises(HTTPException) as e:
        asyncio.run(turnstile.require_human(req()))
    assert e.value.status_code == 403
    _Client.answer = {"success": False}
    with pytest.raises(HTTPException):
        asyncio.run(turnstile.require_human(req("bad")))
    assert _Client.sent["response"] == "bad" and _Client.sent["secret"] == "secret"


def test_a_good_token_passes_and_cloudflare_being_down_turns_nobody_away(on):
    assert asyncio.run(turnstile.require_human(req("good"))) is None
    _Client.error = httpx.ConnectError("down")
    assert asyncio.run(turnstile.require_human(req("good"))) is None


def test_a_signed_out_task_needs_it_and_a_signed_in_one_does_not(world, on, monkeypatch):  # noqa: F811
    env, store, client, who = world
    body = {"key": "need_funding", "entry_mode": "business_goal"}
    assert client.post("/task-sessions", json=body).status_code == 403
    assert client.post("/task-sessions", json=body, headers={"x-turnstile-token": "good"}).status_code == 201

    async def signed_in(_request):
        return {"id": "A", "email": "a@example.com"}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    assert client.post("/task-sessions", json=body).status_code == 201
