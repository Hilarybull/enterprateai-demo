from unittest.mock import AsyncMock
import pytest
from test_goal_onboarding import world, OWNER
from app.modules.agent import goal_router


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "connect_to_mongo", AsyncMock())
    for name in ("start_agent_scheduler", "start_tender_scheduler", "start_activation_scheduler"):
        monkeypatch.setattr(main, name, lambda: None)


def test_retrying_signed_start_reuses_the_task_and_rejects_changed_payload(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    monkeypatch.setattr(goal_router, "get_optional_user", AsyncMock(return_value={"id": OWNER, "email": OWNER}))
    body = {"key": "need_funding", "entry_mode": "business_goal", "business_id": "A", "client_request_id": "same-click"}
    first = client.post("/task-sessions", json=body)
    again = client.post("/task-sessions", json=body)
    assert first.status_code == again.status_code == 201
    assert first.json()["id"] == again.json()["id"] and len(store.rows) == 1
    assert client.post("/task-sessions", json={**body, "key": "launch"}).status_code == 409


def test_start_identifier_is_private_to_the_signed_in_user(world, monkeypatch):
    env, store, client, who = world
    monkeypatch.setattr(goal_router, "get_optional_user", AsyncMock(side_effect=[{"id": OWNER}, {"id": "second-user"}]))
    body = {"key": "create_invoice", "entry_mode": "quick_task", "client_request_id": "same-client-id"}
    first = client.post("/task-sessions", json=body).json()
    second = client.post("/task-sessions", json=body).json()
    assert first["id"] != second["id"] and len(store.rows) == 2
