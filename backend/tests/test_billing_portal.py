"""Customers can manage or cancel, and a cancel at the period's end keeps what they paid for until it ends."""
import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.modules.plans import router as plans
from app.shared.auth.deps import get_current_user


class _Sessions:
    def __init__(self):
        self.made = []

    def create(self, params):
        self.made.append(params)
        return type("S", (), {"url": "https://billing.stripe.test/session"})


@pytest.fixture()
def client():
    app.dependency_overrides[get_current_user] = lambda: {"id": "owner@example.com", "email": "owner@example.com"}
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_current_user, None)


def _row(monkeypatch, row):
    async def select(*_a, **_k):
        return row
    monkeypatch.setattr(plans, "sb_select", select)


def test_a_subscriber_gets_their_own_billing_page(client, monkeypatch):
    _row(monkeypatch, {"stripe_customer_id": "cus_1"})
    sessions = _Sessions()
    monkeypatch.setattr(plans, "_stripe_client", lambda: type("C", (), {"billing_portal": type("B", (), {"sessions": sessions})}))
    out = client.post("/plans/billing-portal")
    assert out.status_code == 200 and out.json()["url"].startswith("https://billing.stripe.test")
    assert sessions.made[0]["customer"] == "cus_1"


def test_no_subscription_is_said_plainly(client, monkeypatch):
    _row(monkeypatch, {"plan_key": "explorer"})
    assert client.post("/plans/billing-portal").status_code == 404


@pytest.mark.parametrize("etype,status,canceled_at,want", [
    ("customer.subscription.updated", "active", 1893456000, "active"),      # set to end at the period's end: still theirs
    ("customer.subscription.deleted", "canceled", 1893456000, "cancelled"),      # it ended
])
def test_a_cancel_takes_effect_when_the_period_ends(client, monkeypatch, etype, status, canceled_at, want):
    monkeypatch.setattr(get_settings(), "stripe_webhook_secret", "whsec_x", raising=False)
    event = {"type": etype, "data": {"object": {"id": "sub_1", "status": status, "canceled_at": canceled_at, "customer": "cus_1", "metadata": {},
                                                "cancel_at_period_end": etype.endswith("updated")}}}
    monkeypatch.setattr(plans.stripe.Webhook, "construct_event", lambda *_a, **_k: event)

    async def not_addon(_id):
        return False
    monkeypatch.setattr("app.modules.addons.service.is_addon_subscription", not_addon)
    _row(monkeypatch, {"user_id": "owner@example.com", "stripe_subscription_id": "sub_1"})
    saved = []

    async def update(_table, payload=None, filters=None):
        saved.append(payload)
    monkeypatch.setattr("app.core.supabase.sb_update", update)
    assert client.post("/plans/webhook", content=json.dumps(event), headers={"stripe-signature": "x"}).status_code == 200
    assert saved[0]["status"] == want
    assert saved[0]["cancelled_at"]      # recorded while it runs out too: that is what says the plan is ending, so the owner can be reminded
