"""A new account made by a verified email code sets its first password straight after, with no reset email; an
account that already has one can't be changed this way."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.shared.auth import router as auth_router
from app.shared.auth.deps import get_current_user
from app.shared.auth.security import verify_password


@pytest.fixture
def client(monkeypatch):
    written = []

    async def update(table, *, filters, payload):
        written.append((table, filters, payload))
        return [{"id": "u1"}]
    monkeypatch.setattr(auth_router, "sb_update", update)
    who = {"user": {"id": "u1", "email": "new@example.test", "password_hash": None}}
    app.dependency_overrides[get_current_user] = lambda: who["user"]
    with TestClient(app) as c:
        yield c, who, written
    app.dependency_overrides.pop(get_current_user, None)


def test_a_new_account_sets_its_first_password(client):
    c, _who, written = client
    assert c.post("/auth/me/set-password", json={"new_password": "correct horse 1"}).status_code == 204
    table, filters, payload = written[-1]
    assert table == "users" and filters == [("id", "eq", "u1")] and verify_password("correct horse 1", payload["password_hash"])


def test_too_short_is_refused_and_an_existing_password_is_not_replaced(client):
    c, who, written = client
    assert c.post("/auth/me/set-password", json={"new_password": "short"}).status_code == 422
    who["user"] = {**who["user"], "password_hash": "already-set"}
    assert c.post("/auth/me/set-password", json={"new_password": "correct horse 1"}).status_code == 409
    assert written == []
