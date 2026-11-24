"""New-User Test S2: answers given signed out never attach to whoever signs in next on that browser."""
import pytest

from app.modules.agent import goal_router
from test_goal_onboarding import world  # noqa: F401 - the fixture

REAL_RULE = goal_router._may_attach      # the fixture answers yes for its journeys; here the rule itself is tested


@pytest.fixture()
def browser(world, monkeypatch):  # noqa: F811
    monkeypatch.setattr(goal_router, "_may_attach", REAL_RULE)
    return world


def _answered_signed_out(client):
    return client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal", "currency": "GBP"}).json()


def test_the_next_account_to_sign_in_is_asked_and_nothing_attaches_until_it_says_yes(browser):
    env, store, client, who = browser
    s = _answered_signed_out(client)
    who["user"] = "B"
    for path, body in (("attach-user", {}), ("resume", {})):
        refused = client.post(f"/task-sessions/{s['id']}/{path}", json=body)
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "confirm_attach"
    assert client.get(f"/task-sessions/{s['id']}").json()["authenticated"] is False      # still nobody's
    yes = client.post(f"/task-sessions/{s['id']}/attach-user", json={"confirm": True})
    assert yes.status_code == 200 and yes.json()["authenticated"] is True
    assert client.post(f"/task-sessions/{s['id']}/resume", json={}).status_code == 200      # the yes holds, never asked twice


def test_once_attached_no_other_account_can_take_them_even_saying_yes(browser):
    env, store, client, who = browser
    s = _answered_signed_out(client)
    who["user"] = "B"
    client.post(f"/task-sessions/{s['id']}/attach-user", json={"confirm": True})
    who["user"] = "C"
    assert client.post(f"/task-sessions/{s['id']}/attach-user", json={"confirm": True}).status_code == 403


def test_a_task_started_signed_in_is_not_asked_and_no_one_else_can_claim_it(browser, monkeypatch):
    env, store, client, who = browser

    async def signed_in(_request):
        return {"id": "A", "email": "a@x.test"}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    s = _answered_signed_out(client)
    who["user"] = "B"
    assert client.post(f"/task-sessions/{s['id']}/attach-user", json={"confirm": True}).status_code == 403
    who["user"] = "A"
    assert client.post(f"/task-sessions/{s['id']}/attach-user", json={}).status_code == 200
