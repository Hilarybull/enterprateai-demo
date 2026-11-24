"""Welcome content and shared signup/claim delivery, without sending real mail."""
from datetime import timedelta

import pytest

from app.modules.activation import router
from app.modules.activation.service import SendResult
from app.modules.activation.welcome import BENEFITS, DASHBOARD, render
from test_activation import World, run


def test_welcome_copy_and_personalised_html_and_text(monkeypatch):
    from app.modules.activation.rules import LIFECYCLE
    assert LIFECYCLE["w1"]["subject"] == "Welcome to EnterprateAI - Get Discovered. Win Business. Grow."
    text, html = render("Ada Lovelace")
    for title, body in BENEFITS:
        assert title in text and body in text
        assert body in html
    assert "Hi Ada," in text and "Hi Ada," in html
    assert "Welcome to EnterprateAI!" in text
    assert "Password Reset" in html
    assert "bgcolor='#4f46e5'" in html and "Click to Login</a>" in html
    assert DASHBOARD in html and DASHBOARD in text
    assert "Co-Founder, EnterprateAI" in html and "Patrick" in text
    assert "<ul" in html and html.count("<li ") == 5
    assert "Hi there," in render(None)[0]
    assert "<script>" not in render("<script>alert(1)</script>")[1]
    monkeypatch.setattr("app.modules.activation.welcome.first_name", lambda name: "Ada&Co")
    assert "Ada&amp;Co" in render("anything")[1]


def test_signup_then_claim_and_repeated_claim_deliver_one_welcome():
    w = World(lifecycle_emails=True)
    uid = w.user(status="unknown")
    assert run(w.svc.welcome(uid)) is True
    assert run(w.svc.welcome(uid)) is False
    w.tick()
    assert run(w.svc.welcome(uid)) is False
    w.tick()
    assert len(w.outbox) == 1
    assert w.steps() == {"w1": "sent"}


def test_claim_can_welcome_an_older_account_without_backfilling_other_old_users():
    w = World(lifecycle_emails=True)
    uid = w.user(status="unknown", verified_at=w.now - timedelta(days=60))
    w.user("other@example.test", status="unknown", verified_at=w.now - timedelta(days=60))
    w.tick()
    assert w.outbox == []
    assert run(w.svc.welcome(uid)) is True
    w.tick()
    assert len(w.outbox) == 1 and w.outbox[0]["to"] == uid


def test_live_welcome_events_send_without_enabling_promotional_campaigns():
    w = World(welcome_live=True, enabled=False, dry_run=True, cohort="internal")
    uid = w.user(status="unknown")
    w.user("old-preview@example.test", status="unknown")
    run(w.svc._schedule("old-preview@example.test", "W", "w1", w.now))
    assert run(w.svc.welcome(uid)) is True
    w.tick()
    assert [m["to"] for m in w.outbox] == [uid]
    assert w.outbox[0]["marketing"] is False
    assert run(w.svc.welcome(uid)) is False
    w.tick()
    assert len(w.outbox) == 1


def test_a_claim_promotes_only_its_own_unsent_preview():
    w = World(lifecycle_emails=True, dry_run=True, cohort="all")
    uid = w.user(status="unknown")
    w.tick()
    assert w.outbox == []
    w.config.welcome_live = True
    assert run(w.svc.welcome(uid)) is True
    assert run(w.svc.welcome(uid)) is False
    w.tick()
    assert len(w.outbox) == 1 and w.steps() == {"w1": "sent"}


def test_explicit_preview_never_sends_even_when_welcome_events_are_live():
    w = World(welcome_live=True)
    uid = w.user(status="unknown")
    run(w.svc.welcome(uid))
    run(w.svc.deliver(dry_run=True))
    assert w.outbox == []


@pytest.mark.parametrize("config,user", [
    ({"enabled": False}, {}), ({"lifecycle_emails": False}, {}),
    ({"cohort": "internal"}, {}), ({}, {"email_verified": False}),
    ({}, {"status": "suppressed"}),
])
def test_welcome_respects_delivery_controls(config, user):
    w = World(**{"lifecycle_emails": True, **config})
    uid = w.user(**user)
    assert run(w.svc.welcome(uid)) is False
    assert w.store.ledger_rows == {}


def test_failed_send_retries_with_same_idempotency_key():
    w = World(lifecycle_emails=True)
    uid = w.user(status="unknown")
    w.results = [SendResult(sent=False, error="temporary failure")]
    run(w.svc.welcome(uid))
    w.tick()
    w.at(hours=1).tick()
    assert len(w.outbox) == 2
    assert w.outbox[0]["idempotency_key"] == w.outbox[1]["idempotency_key"]
    assert w.steps() == {"w1": "sent"}


def test_queue_hook_wakes_sender_only_for_a_new_welcome(monkeypatch):
    import asyncio
    w = World(lifecycle_emails=True)
    uid = w.user()
    wake = asyncio.Event()
    monkeypatch.setattr(router, "read_config", lambda: w.config)
    monkeypatch.setattr(router, "get_service", lambda: w.svc)
    monkeypatch.setattr(router, "_wake", wake)
    run(router.queue_welcome(uid))
    assert wake.is_set()
    wake.clear()
    run(router.queue_welcome(uid))
    assert not wake.is_set()


def test_queue_failure_does_not_fail_signup_or_claim(monkeypatch):
    w = World(lifecycle_emails=True)
    async def unavailable(user_id):
        raise RuntimeError("database unavailable")
    monkeypatch.setattr(w.svc, "welcome", unavailable)
    monkeypatch.setattr(router, "read_config", lambda: w.config)
    monkeypatch.setattr(router, "get_service", lambda: w.svc)
    run(router.queue_welcome("ada@example.test"))


def test_verified_signup_paths_queue_the_welcome(monkeypatch):
    from app.shared.auth import router as auth
    from app.modules.agent.goal_router import Accounts
    import app.core.supabase as sb
    queued = []
    async def capture(user_id):
        queued.append(user_id)
    async def saved(*args, **kwargs):
        return {}
    monkeypatch.setattr(router, "queue_welcome", capture)
    monkeypatch.setattr(auth, "sb_update", saved)
    monkeypatch.setattr(sb, "sb_insert", saved)
    monkeypatch.setattr(sb, "sb_update", saved)
    run(auth._mark_verified("password@example.test"))
    run(Accounts().create("landing@example.test", name="Ada"))
    run(Accounts().mark_verified("existing@example.test"))
    assert queued == ["password@example.test", "landing@example.test", "existing@example.test"]


def test_claim_queues_welcome_only_when_ownership_is_verified(monkeypatch):
    from test_agent import Env
    from test_marketplace_claim import NORTHWIND, svc_of, U, NEW
    import copy
    queued = []
    async def capture(user_id):
        queued.append(user_id)
    monkeypatch.setattr(router, "queue_welcome", capture)
    env = Env()
    svc = svc_of(env)
    run(svc.index_records([copy.deepcopy(NORTHWIND)]))
    claim = run(svc.start_claim(U(NEW), "northwind-advisory-ltd-leeds"))
    run(svc.confirm_match(U(NEW), claim["id"], "new"))
    verification = run(svc.start_verification(U(NEW), claim["id"], method="email_domain", email="owner@northwind-advisory.co.uk"))
    assert queued == []
    result = run(svc.complete_verification(U(NEW), claim["id"], verification["verification"]["id"], code=svc.sent_codes[-1][1]))
    assert result["status"] == "verified"
    assert queued == [NEW]
