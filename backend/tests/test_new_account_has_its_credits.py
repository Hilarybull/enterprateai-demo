"""From the demo call: a brand-new account (verified with an email code on the homepage) asked for
an invoice and was told "You're out of AI Credits". It had its 50 starting credits coming, but a
wallet was only ever opened when a page asked for the balance in full, and the task ran first."""
import asyncio

from app.modules.credits import service


def test_a_balance_asked_for_before_any_wallet_exists_opens_the_wallet_with_the_starting_credits(monkeypatch):
    wallets: dict[str, dict] = {}
    opened = []

    async def get_wallet(user_id):
        return wallets.get(user_id)

    async def ensure_wallet(user_id):
        opened.append(user_id)
        wallets[user_id] = {"available_credits": 50, "held_credits": 0}
        return wallets[user_id]
    monkeypatch.setattr(service, "get_wallet", get_wallet)
    monkeypatch.setattr(service, "ensure_wallet", ensure_wallet)
    assert asyncio.run(service.get_balance("brand.new@example.test")) == 50      # not 0: the first task is not turned away
    assert opened == ["brand.new@example.test"]
    wallets["brand.new@example.test"]["available_credits"] = 46
    assert asyncio.run(service.get_balance("brand.new@example.test")) == 46 and len(opened) == 1      # an existing wallet is read as it is
    wallets["spent@example.test"] = {"available_credits": 0, "held_credits": 0}
    assert asyncio.run(service.get_balance("spent@example.test")) == 0 and len(opened) == 1          # used up is still used up: nothing is topped up


def test_a_wallet_that_cannot_be_opened_is_reported_as_empty_not_as_an_error(monkeypatch):
    async def get_wallet(user_id):
        return None

    async def ensure_wallet(user_id):
        raise RuntimeError("database unavailable")
    monkeypatch.setattr(service, "get_wallet", get_wallet)
    monkeypatch.setattr(service, "ensure_wallet", ensure_wallet)
    assert asyncio.run(service.get_balance("anyone@example.test")) == 0
