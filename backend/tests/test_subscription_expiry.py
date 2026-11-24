import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.admin import router as admin
from app.modules.credits import service as credits
from app.modules.plans import access


@pytest.fixture
def account(monkeypatch):
    state = {
        "user_id": "expired@example.test", "plan_key": "starter_insight", "status": "active",
        "current_period_end": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
    }
    user = {"id": state["user_id"], "email": state["user_id"], "created_at": "2026-10-01T00:00:00Z"}

    async def select(table, *, single=False, **kwargs):
        row = dict(state) if table == "user_subscriptions" else dict(user)
        assert table in ("user_subscriptions", "users")
        return row if single else [row]

    async def wallet(user_id):
        return {"available_credits": 77, "held_credits": 3, "lifetime_credits_used": 20}

    monkeypatch.setattr(access, "sb_select", select)
    monkeypatch.setattr(admin, "sb_select", select)
    monkeypatch.setattr(credits, "get_wallet", wallet)
    monkeypatch.setitem(app.dependency_overrides, admin.require_admin, lambda: {"id": "admin", "email": admin.ADMIN_EMAIL})
    return state


@pytest.mark.parametrize("status", ["active", "trial", "trialing", "past_due", "unpaid", "cancelled"])
def test_expired_subscription_is_explorer_in_access_admin_and_contacts(account, status):
    account["status"] = status
    resolved = asyncio.run(access.resolve_subscription(account["user_id"]))
    assert resolved.plan_key == "explorer"
    client = TestClient(app)
    subscription = client.get(f"/admin/users/{account['user_id']}/subscription")
    assert subscription.status_code == 200
    assert subscription.json()["plan_key"] == "explorer"
    wallet = client.get(f"/admin/users/{account['user_id']}/credits")
    assert wallet.status_code == 200
    assert wallet.json()["plan_code"] == "explorer"
    assert wallet.json()["available_credits"] == 77
    assert asyncio.run(admin._contacts())[0]["plan"] == "explorer"


@pytest.mark.parametrize("status", ["active", "trial", "trialing"])
def test_a_recorded_renewal_keeps_the_paid_plan(account, status):
    account.update(status=status, current_period_end=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat())
    resolved = asyncio.run(access.resolve_subscription(account["user_id"]))
    assert resolved.plan_key == "starter_insight"
    assert TestClient(app).get(f"/admin/users/{account['user_id']}/credits").json()["plan_code"] == "starter_insight"


def test_expiry_applies_at_the_paid_period_boundary():
    ends = datetime(2026, 11, 17, 10, tzinfo=timezone.utc)
    sub = {"plan_key": "starter_insight", "current_period_end": ends.isoformat()}
    assert not access._lapsed(sub, now=ends - timedelta(microseconds=1))
    assert access._lapsed(sub, now=ends)
    assert access._lapsed(sub, now=ends + timedelta(seconds=1))


def test_admin_credit_provisioning_uses_the_current_plan(account, monkeypatch):
    allocations = []

    async def provision(user_id, plan_code, **kwargs):
        allocations.append(plan_code)
        return {"ok": True}

    monkeypatch.setattr(credits, "provision_plan_credits", provision)
    response = TestClient(app).post(f"/admin/users/{account['user_id']}/credits/provision")
    assert response.status_code == 200
    assert response.json()["plan_code"] == "explorer"
    assert allocations == ["explorer"]
