"""Admin: reducing a user's AI Credits."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.admin.router import ADMIN_EMAIL
from app.modules.credits import service as credit_svc
from app.shared.auth.deps import get_current_user


@pytest.fixture
def client(monkeypatch):
    who = {"id": ADMIN_EMAIL, "email": ADMIN_EMAIL}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    wallet = {"balance": 308, "calls": []}

    async def deduct(user_id, amount, reason):
        if user_id == "nowallet@x.test":
            return {"ok": False, "error": "WALLET_NOT_FOUND"}
        taken = min(abs(amount), wallet["balance"])
        wallet["balance"] -= taken
        wallet["calls"].append((user_id, amount, reason))
        return {"ok": True, "deducted": taken, "balance": wallet["balance"]}

    monkeypatch.setattr(credit_svc, "deduct_credits_admin", deduct)
    yield TestClient(app, raise_server_exceptions=False), wallet, who
    app.dependency_overrides.pop(get_current_user, None)


def test_admin_can_reduce_credits_with_a_reason(client):
    http, wallet, _ = client
    res = http.post("/admin/users/user@x.test/credits/deduct", json={"amount": 100, "reason": "Refund reversal"})
    assert res.status_code == 200
    assert res.json() == {"status": "deducted", "user_id": "user@x.test", "requested": 100, "deducted": 100, "balance": 208}
    assert wallet["calls"] == [("user@x.test", 100, "Refund reversal")]


def test_the_balance_never_goes_below_zero_and_the_response_says_what_was_removed(client):
    http, wallet, _ = client
    body = http.post("/admin/users/user@x.test/credits/deduct", json={"amount": 500}).json()
    assert body["deducted"] == 308 and body["balance"] == 0 and body["requested"] == 500
    assert wallet["calls"][0][2] == "Admin credit reduction"                  # default reason


def test_bad_amounts_missing_wallets_and_non_admins_are_refused(client):
    http, wallet, who = client
    assert http.post("/admin/users/user@x.test/credits/deduct", json={"amount": 0}).status_code == 400
    assert http.post("/admin/users/user@x.test/credits/deduct", json={"amount": -5}).status_code == 400
    assert http.post("/admin/users/nowallet@x.test/credits/deduct", json={"amount": 5}).status_code == 404
    who.update({"id": "someone@x.test", "email": "someone@x.test"})
    assert http.post("/admin/users/user@x.test/credits/deduct", json={"amount": 5}).status_code == 403
    assert wallet["calls"] == [] and wallet["balance"] == 308
