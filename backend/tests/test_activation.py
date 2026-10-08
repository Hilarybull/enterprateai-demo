"""Activation and education emails: who enters each journey, what stops it, that a step is sent
once and only while it still applies, and that permission is real and withdrawing it is immediate."""
import asyncio
import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.activation import router as act_router
from app.modules.activation import rules
from app.modules.activation.service import ActivationService, Config, SendResult
from app.modules.activation.store import Duplicate, MemoryStore
from app.shared.auth.deps import get_current_user
from app.shared.auth.schemas import RegisterRequest

T0 = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)      # a Monday, 11:00 in London
run = lambda c: asyncio.get_event_loop().run_until_complete(c)      # noqa: E731


class World:
    def __init__(self, **config):
        self.now = T0
        self.store = MemoryStore()
        self.outbox: list[dict] = []
        self.results: list[SendResult] = []      # queued outcomes for the next sends; default is "sent"
        self.plans: dict[str, str] = {}
        self.config = Config(**{"enabled": True, "dry_run": False, "cohort": "all", "holdout_percent": 0, **config})
        self.svc = ActivationService(store=self.store, send=self._send, config=lambda: self.config, clock=lambda: self.now, plan_of=self._plan)

    async def _send(self, message):
        self.outbox.append(message)
        return self.results.pop(0) if self.results else SendResult(sent=True, message_id=f"msg-{len(self.outbox)}")

    async def _plan(self, user_id):
        return self.plans.get(user_id, "explorer")

    def user(self, email="ada@example.test", status="subscribed", verified_at=None, **over):
        self.store.users[email] = {"id": email, "email": email, "name": "Ada Lovelace", "email_verified": True, "verified_at": (verified_at or self.now).isoformat(),
                                   "created_at": (verified_at or self.now).isoformat(), "timezone": "Europe/London", "marketing_email_status": status,
                                   "marketing_permission_source": "signup_checkbox_v1" if status == "subscribed" else None, **over}
        return email

    def workspace(self, user, wid="w1", **data):
        self.store.workspaces[wid] = {"user_id": user, "created_at": self.now.isoformat(), "updated_at": self.now.isoformat(), "data": data}

    def tick(self):
        return run(self.svc.tick())

    def at(self, **delta):
        self.now += timedelta(**delta)
        return self

    def steps(self, user="ada@example.test"):
        return {r["step_key"]: r["state"] for r in self.store.ledger_rows.values() if r["user_id"] == user}

    def subjects(self):
        return [m["subject"] for m in self.outbox]


# ══ who enters ════════════════════════════════════════════════════════════════

def test_only_a_verified_account_with_recorded_permission_and_no_workspace_enters_journey_a():
    w = World()
    w.user("ada@example.test")
    w.user("unknown@example.test", status="unknown")                     # never asked: creating an account is not consent
    w.user("pending@example.test", email_verified=False)
    w.user("gone@example.test", status="unsubscribed")
    w.user("has@example.test")
    w.workspace("has@example.test", "w9", validation={"overall_score": 60})
    out = w.tick()
    assert [(p["user_id"], p["journey"]) for p in out["selected"] if p["action"] == "enrol"] == [("ada@example.test", "A")]
    assert set(w.steps()) == {"a1", "a2", "a3", "a4", "a5"}
    for other in ("unknown@example.test", "pending@example.test", "gone@example.test"):
        assert w.steps(other) == {}
    assert RegisterRequest(email="ada@example.com", password="longenough").marketing_opt_in is False      # the sign-up tick is never pre-set


def test_the_schedule_is_shortly_after_verifying_then_24_hours_and_days_3_6_and_10():
    w = World()
    u = w.user()
    w.tick()
    due = {r["step_key"]: rules.parse(r["due_at"]) - T0 for r in w.store.ledger_rows.values() if r["user_id"] == u}
    assert due == {"a1": timedelta(minutes=10), "a2": timedelta(hours=24), "a3": timedelta(days=3), "a4": timedelta(days=6), "a5": timedelta(days=10)}
    assert w.outbox == []                                                 # not due yet
    w.at(minutes=15).tick()
    assert w.subjects() == ["Create your EnterprateAI workspace"] and w.steps()["a1"] == "sent"
    w.at(days=1).tick()                                                   # 24 hours on, but an email went within 48 hours
    assert len(w.outbox) == 1 and w.steps()["a2"] == "scheduled"
    w.at(days=1, hours=1).tick()
    assert w.subjects()[-1] == "A simple way to get started"
    sent = []
    for _ in range(40):
        w.at(hours=8).tick()
    assert [m["subject"] for m in w.outbox] == [rules.TEMPLATES[k]["subject"] for k in ("a1", "a2", "a3", "a4", "a5")]
    times = sorted(rules.parse(r["sent_at"]) for r in w.store.ledger_rows.values())
    assert all(b - a >= rules.MIN_GAP for a, b in zip(times, times[1:]))    # never two inside 48 hours
    w.at(days=30).tick()
    assert len(w.outbox) == 5                                             # the sequence ends; it is not restarted


def test_the_message_has_a_greeting_a_route_back_attribution_and_a_way_out_and_nothing_from_the_business():
    w = World(api_base_url="https://api.example.test", postal_address="1 Example Street, Leeds")
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    m = w.outbox[0]
    assert m["to"] == u and m["text"].startswith("Hello Ada,")
    assert "/onboarding?utm_source=activation&utm_medium=email&utm_campaign=journey_a&utm_content=a1" in m["text"]
    token = w.svc.token(u)
    assert f"/email/unsubscribe?token={token}" in m["text"] and f"/email/preferences?token={token}" in m["html"] and "1 Example Street, Leeds" in m["text"]
    assert m["headers"]["List-Unsubscribe"] == f"<https://api.example.test/email/unsubscribe?token={token}>" and m["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert m["idempotency_key"] == f"activation/{u}/A/a1/{rules.TEMPLATE_VERSION}"
    # No name on record, or only an email address as the name: neutral.
    w.user("anon@example.test", name="anon@example.test")
    assert w.svc.message(w.store.users["anon@example.test"], {"id": "x", "journey_key": "A", "step_key": "a2"})["text"].startswith("Hello,")
    # Whatever is in the workspace, none of it is in any email.
    w.workspace(u, "w1", validation={"overall_score": 87, "idea": "Secret drone bakery"}, financials={"invoices": [{"id": "i1", "total": 4200, "customer": "BrightTech"}]})
    for key in rules.ALL_TEMPLATES:
        body = json.dumps(w.svc.message(w.store.users[u], {"id": "x", "journey_key": rules.ALL_TEMPLATES[key]["journey"], "step_key": key}))
        assert not any(secret in body for secret in ("Secret drone bakery", "87", "4200", "BrightTech"))


# ══ what stops or moves a journey ═════════════════════════════════════════════

def test_a_workspace_created_between_scheduling_and_delivery_stops_that_step_and_the_rest_then_b_begins():
    """The demonstration the brief asks for: the step is due, the person activates, and nothing is sent."""
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15)
    assert [(d["step"], d["result"]) for d in run(w.svc.dry_run())["due"]] == [("a1", "would_send")]      # it is due and would go...
    w.workspace(u)                                                        # ...and at this moment they create a workspace
    handled = run(w.svc.deliver())                                        # the sender alone, as if the selector hadn't run again yet
    assert [(h["step"], h["result"], h["why"]) for h in handled] == [("a1", "cancelled", "workspace_created")]
    assert w.outbox == [] and set(w.steps().values()) == {"cancelled"}
    assert {r["stopped_reason"] for r in w.store.ledger_rows.values()} == {"workspace_created"}
    out = w.tick()
    assert [(p["journey"], p["action"]) for p in out["selected"]] == [("B", "enrol")]
    w.at(minutes=15).tick()
    assert w.subjects() == ["Your workspace is set up: choose your first result"]
    # A second workspace changes nothing, and A is never entered again.
    w.workspace(u, "w2")
    w.at(days=40).tick()
    assert not any(k.startswith("a") and v != "cancelled" for k, v in w.steps().items())
    del w.store.workspaces["w1"], w.store.workspaces["w2"]
    w.at(days=1).tick()
    assert sorted(k for k in w.steps() if k.startswith("a")) == ["a1", "a2", "a3", "a4", "a5"] and len(w.outbox) <= 3


def test_completing_a_first_task_stops_the_reminders_and_a_click_proves_nothing():
    w = World()
    u = w.user()
    w.workspace(u)
    w.tick()
    w.at(minutes=15).tick()
    assert w.subjects() == ["Your workspace is set up: choose your first result"]
    w.at(days=3, hours=1).tick()
    assert w.subjects()[-1] == "One question worth answering this week"
    w.store.workspaces["w1"]["data"]["financials"] = {"invoices": [{"id": "i1"}]}      # a real record, not a link being followed
    w.store.workspaces["w1"]["updated_at"] = w.now.isoformat()
    w.at(days=4).tick()
    assert w.steps()["b3"] == "cancelled" and "What would make EnterprateAI easier to use?" not in w.subjects()
    assert [r["stopped_reason"] for r in w.store.ledger_rows.values() if r["step_key"] == "b3"] == ["first_task_completed"]


def test_tips_need_access_a_reason_and_room_in_the_month():
    w = World()
    u = w.user()
    w.workspace(u, "w1", validation={"overall_score": 70}, financials={"invoices": [{"id": "i1"}]}, catalogue={"products": [{"id": "p1", "name": "Review"}]})
    w.tick()
    assert set(w.steps()) == {"c1"}                                       # one at a time
    w.tick()
    assert w.subjects() == ["Turn your validation into a next step"]
    w.at(days=5).tick()
    assert len(w.outbox) == 1                                             # not within ten days of the last
    w.at(days=6).tick()
    assert w.subjects()[-1] == "Let the information you already entered do more"      # Simulation isn't on the Explorer plan, so that tip is skipped
    w.plans[u] = "growth"
    w.at(days=11).tick()
    assert len(w.outbox) == 2                                             # two in thirty days is the limit, access or not
    for _ in range(4):
        w.at(days=5).tick()
        w.store.workspaces["w1"]["updated_at"] = w.now.isoformat()
    assert w.subjects()[-1] == "What happens if one assumption changes?" and len(w.outbox) == 3
    w.at(days=60).tick()
    assert len(w.outbox) == 3                                             # every tip once; nothing is repeated
    # Someone who has already done what a tip suggests isn't sent it.
    w2 = World()
    v = w2.user("op@example.test")
    w2.plans[v] = "growth"
    w2.workspace(v, "w1", financials={"invoices": [{"id": "i1"}]}, simulations=[{"id": "s1"}], blueprints=[{"id": "b1"}], validation={"overall_score": 50})
    w2.tick()
    assert set(w2.steps(v)) == {"c3"}
    # Gone quiet for three months: tips stop.
    w3 = World()
    q = w3.user("quiet@example.test")
    w3.workspace(q, "w1", validation={"overall_score": 50})
    w3.at(days=120).tick()
    assert w3.steps(q) == {}


# ══ once, and only in the right hours ═════════════════════════════════════════

def test_repeated_and_overlapping_runs_send_a_step_once():
    w = World()
    u = w.user()
    w.tick()
    w.tick()
    assert len(w.store.ledger_rows) == 5                                  # the selector running twice makes no second set
    with pytest.raises(Duplicate):
        run(w.store.insert_ledger({"user_id": u, "journey_key": "A", "step_key": "a1", "due_at": w.now, "state": "scheduled"}))
    w.at(minutes=15)

    async def together():
        return await asyncio.gather(w.svc.deliver(), w.svc.deliver(), w.svc.deliver())
    results = run(together())
    assert len(w.outbox) == 1 and sum(1 for r in results for x in r if x["result"] == "sent") == 1
    w.tick()
    assert len(w.outbox) == 1


def test_an_uncertain_send_is_retried_with_the_same_key_and_given_up_after_three_tries():
    w = World()
    w.user()
    w.tick()
    w.results = [SendResult(sent=False, uncertain=True, error="timeout"), SendResult(sent=True, message_id="msg-real")]
    w.at(minutes=15).tick()
    assert w.steps()["a1"] == "uncertain" and len(w.outbox) == 1
    w.at(minutes=10).tick()
    assert len(w.outbox) == 1                                             # not straight away
    w.at(minutes=25).tick()
    assert w.steps()["a1"] == "sent" and len(w.outbox) == 2
    assert w.outbox[0]["idempotency_key"] == w.outbox[1]["idempotency_key"]      # the provider treats the retry as the same email
    # A worker that died mid-send leaves the step "sending": it is reconciled the same way.
    w2 = World()
    w2.user()
    w2.tick()
    w2.at(minutes=15)
    row = [r for r in w2.store.ledger_rows.values() if r["step_key"] == "a1"][0]
    row.update({"state": "sending", "attempt_count": 1, "updated_at": w2.now.isoformat()})
    w2.tick()
    assert w2.outbox == []
    w2.at(minutes=31).tick()
    assert w2.steps()["a1"] == "sent" and len(w2.outbox) == 1
    # Never known to have gone: three tries, then it stops.
    w3 = World()
    w3.user()
    w3.tick()
    w3.results = [SendResult(sent=False, uncertain=True)] * 3
    for _ in range(6):
        w3.at(minutes=40).tick()
    assert w3.steps()["a1"] == "failed" and len(w3.outbox) == 3
    # A refused address is never tried again, for any journey.
    w4 = World()
    u = w4.user()
    w4.tick()
    w4.results = [SendResult(sent=False, recipient_rejected=True, error="invalid")]
    w4.at(minutes=15).tick()
    assert w4.store.users[u]["marketing_email_status"] == "suppressed" and w4.store.users[u]["marketing_suppression_reason"] == "bounced"
    assert set(w4.steps().values()) == {"failed", "cancelled"}


@pytest.mark.parametrize("tz,hour_utc,sends", [("Europe/London", 7, False), ("Europe/London", 8, True), ("Europe/London", 16, True), ("Europe/London", 17, False),
                                               ("America/New_York", 12, False), ("America/New_York", 13, True), (None, 8, True), ("Not/AZone", 8, True)])
def test_emails_go_between_nine_and_six_where_the_person_is(tz, hour_utc, sends):
    w = World()
    w.now = datetime(2026, 10, 5, hour_utc, 30, tzinfo=timezone.utc)      # British Summer Time: London is UTC+1, New York UTC-4
    u = w.user(timezone=tz, verified_at=w.now - timedelta(hours=1))
    w.tick()
    assert (len(w.outbox) == 1) is sends
    if not sends:
        due = rules.parse([r for r in w.store.ledger_rows.values() if r["step_key"] == "a1"][0]["due_at"])
        assert due.astimezone(rules.zone(tz)).time() == rules.SEND_FROM and due > w.now      # moved to nine o'clock their time
        w.now = due
        w.tick()
        assert len(w.outbox) == 1


# ══ permission ════════════════════════════════════════════════════════════════

def test_unsubscribing_stops_everything_at_once_and_a_suppressed_address_stays_stopped():
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    assert len(w.outbox) == 1
    assert w.svc.user_from_token(w.svc.token(u)) == u and w.svc.user_from_token(w.svc.token(u)[:-2] + "zz") is None and w.svc.user_from_token("junk") is None
    run(w.svc.set_permission(u, "unsubscribed", source="unsubscribe_link"))
    assert set(w.steps().values()) == {"sent", "cancelled"} and w.store.users[u]["marketing_unsubscribed_at"] == w.now.isoformat()
    w.at(days=20).tick()
    assert len(w.outbox) == 1
    w.workspace(u)                                                        # and it holds across journeys
    w.at(days=1).tick()
    assert not any(k.startswith("b") for k in w.steps())
    assert run(w.svc.preferences(u))["product_tips"] is False
    # They can change their mind; the evidence says where.
    run(w.svc.set_permission(u, "subscribed", source="preference_page"))
    assert w.store.users[u]["marketing_permission_source"] == "preference_page" and w.store.users[u]["marketing_unsubscribed_at"] is None
    # A bounce or complaint can't be undone from a tick box.
    run(w.svc.set_permission(u, "suppressed", source="complained", actor="system"))
    run(w.svc.set_permission(u, "subscribed", source="preference_page"))
    assert w.store.users[u]["marketing_email_status"] == "suppressed" and run(w.svc.preferences(u))["can_resubscribe"] is False
    # Unsubscribing between scheduling and delivery, with only the sender running.
    w2 = World()
    v = w2.user()
    w2.tick()
    w2.at(minutes=15)
    w2.store.users[v]["marketing_email_status"] = "unsubscribed"
    assert [(h["result"], h["why"]) for h in run(w2.svc.deliver())][0] == ("cancelled", "unsubscribed") and w2.outbox == []
    # And a deleted account.
    w3 = World()
    d = w3.user()
    w3.tick()
    w3.at(minutes=15)
    del w3.store.users[d]
    assert run(w3.svc.deliver())[0]["why"] == "account_deleted" and w3.outbox == []


def test_delivery_events_are_recorded_once_and_a_bounce_or_complaint_stops_all_promotional_email():
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    assert run(w.svc.delivery_event(event_id="evt-1", type_="email.delivered", message_id="msg-1")) == {"ok": True, "matched": True, "status": "delivered"}
    assert run(w.svc.delivery_event(event_id="evt-1", type_="email.delivered", message_id="msg-1")) == {"ok": True, "duplicate": True}      # the provider retried
    assert [r["delivery_status"] for r in w.store.ledger_rows.values() if r["step_key"] == "a1"] == ["delivered"]
    assert sum(1 for e in w.store.event_rows if e["type"] == "delivery_delivered") == 1
    assert run(w.svc.delivery_event(event_id="evt-2", type_="email.delivered", message_id="someone-elses"))["matched"] is False
    run(w.svc.delivery_event(event_id="evt-3", type_="email.complained", message_id="msg-1"))
    assert w.store.users[u]["marketing_email_status"] == "suppressed" and w.store.users[u]["marketing_suppression_reason"] == "complained"
    run(w.svc.delivery_event(event_id="evt-4", type_="email.delivered", message_id="msg-1"))      # a late "delivered" doesn't hide the complaint
    assert [r["delivery_status"] for r in w.store.ledger_rows.values() if r["step_key"] == "a1"] == ["complained"]
    w.at(days=12).tick()
    assert len(w.outbox) == 1
    run(w.svc.delivery_event(event_id="evt-3", type_="email.complained", message_id="msg-1"))
    assert sum(1 for e in w.store.event_rows if e["type"] == "suppressed") == 1


# ══ rollout, dry run, measurement ═════════════════════════════════════════════

def test_dry_run_says_who_would_get_what_and_why_and_changes_nothing():
    w = World(dry_run=True)
    u = w.user()
    w.user("unknown@example.test", status="unknown")
    report = run(w.svc.dry_run())
    assert [(p["user_id"], p["action"], p["journey"], p["steps"]) for p in report["selected"] if p["action"] != "skip"] == [(u, "enrol", "A", ["a1", "a2", "a3", "a4", "a5"])]
    assert [(p["user_id"], p["why"]) for p in report["selected"] if p["action"] == "skip"] == [("unknown@example.test", "no_permission_recorded")]
    assert "permission recorded" in report["selected"][0]["why"] and w.store.ledger_rows == {} and w.store.event_rows == []
    w.tick()                                                              # the job in dry-run mode schedules, but sends nothing
    w.at(minutes=15)
    out = w.tick()
    assert [(d["step"], d["result"], d["to"]) for d in out["delivered"]] == [("a1", "would_send", u)] and w.outbox == [] and w.steps()["a1"] == "scheduled"
    assert run(w.svc.dry_run())["due"][0]["result"] == "would_send"
    off = World(enabled=False)
    off.user()
    assert off.tick() == {"enabled": False, "selected": [], "delivered": []} and off.store.ledger_rows == {}


def test_the_rollout_starts_internal_then_a_sample_then_everyone_and_old_accounts_come_in_small_batches():
    internal = World(cohort="internal", internal_emails=frozenset({"team@example.test"}))
    internal.user("team@example.test")
    internal.user("customer@example.test")
    internal.tick()
    assert set(internal.steps("team@example.test")) and internal.steps("customer@example.test") == {}
    sample = World(cohort="sample", sample_percent=30)
    for n in range(100):
        sample.user(f"u{n}@example.test")
    sample.tick()
    enrolled = {r["user_id"] for r in sample.store.ledger_rows.values()}
    assert 15 <= len(enrolled) <= 45
    sample.tick()
    assert {r["user_id"] for r in sample.store.ledger_rows.values()} == enrolled      # the same people each time
    # Accounts from before the start date: only with permission on record, and a few per run.
    old = World(start_at=T0 - timedelta(days=1), backlog_batch=3)
    for n in range(10):
        old.user(f"old{n}@example.test", verified_at=T0 - timedelta(days=200))
    old.user("old-unknown@example.test", status="unknown", verified_at=T0 - timedelta(days=200))
    old.user("new@example.test")
    old.tick()
    who = {r["user_id"] for r in old.store.ledger_rows.values()}
    assert "new@example.test" in who and "old-unknown@example.test" not in who and len(who) == 4
    assert all(rules.parse(r["due_at"]) >= T0 for r in old.store.ledger_rows.values())      # they begin at step one, now, not ten days late
    for _ in range(4):
        old.at(hours=1).tick()
    assert len({r["user_id"] for r in old.store.ledger_rows.values()}) == 11


def test_a_holdout_is_never_emailed_and_the_dashboard_compares_the_two_groups_from_real_records():
    w = World(holdout_percent=50)
    for n in range(40):
        w.user(f"u{n}@example.test")
    w.tick()
    w.at(minutes=15).tick()
    held = {r["user_id"] for r in w.store.ledger_rows.values() if r["state"] == "holdout"}
    emailed = {m["to"] for m in w.outbox}
    assert held and emailed and not held & emailed and len(held) + len(emailed) == 40
    for n, uid in enumerate(sorted(emailed)[:5]):
        w.at(hours=1)
        w.workspace(uid, f"w{n}", validation={"overall_score": 50})
    w.at(days=2).tick()
    run(w.svc.delivery_event(event_id="e1", type_="email.delivered", message_id="msg-1"))
    board = run(w.svc.dashboard())
    assert board["eligible_users"] == 40 and board["emailed"]["users"] == len(emailed) and board["holdout"]["users"] == len(held)
    assert board["emailed"]["workspace_7d"] == 5 and board["emailed"]["first_task_14d"] == 5 and board["holdout"]["workspace_7d"] == 0
    a1 = [s for s in board["steps"] if s["step"] == "a1"][0]
    assert (a1["sent"], a1["delivered"], a1["holdout"]) == (len(emailed), 1, len(held))
    assert board["guardrails"] == {"unsubscribed": 0, "suppressed": 0, "bounced": 0, "complained": 0} and board["copy_notes"][0]["step"] == "a1"


def test_an_administrator_sees_the_journey_and_the_permission_evidence_but_nothing_from_the_business():
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    w.workspace(u, "w1", notes={"idea": "Secret drone bakery", "score": 87})      # a workspace with nothing completed in it
    w.at(days=1).tick()
    seen = run(w.svc.user_journey(u))
    assert seen["permission"] == {"may_email": True, "reason": "subscribed", "status": "subscribed", "source": "signup_checkbox_v1", "collected_at": None,
                                  "unsubscribed_at": None, "suppression_reason": None}
    by = {s["step"]: s for s in seen["steps"]}
    assert (by["a1"]["state"], by["a1"]["template_version"], by["a1"]["delivery_status"]) == ("sent", rules.TEMPLATE_VERSION, "accepted")
    assert (by["a2"]["state"], by["a2"]["stopped_reason"]) == ("cancelled", "workspace_created") and by["b1"]["state"] == "scheduled"
    assert "Secret drone bakery" not in json.dumps(seen) and "87" not in json.dumps(seen)
    assert run(w.svc.user_journey("nobody@example.test")) is None


# ══ over HTTP ═════════════════════════════════════════════════════════════════

def _signed(secret, body, msg_id="msg_1", ts=None):
    ts = str(int(ts if ts is not None else time.time()))
    key = base64.b64decode(secret.split("_", 1)[1])
    sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    return {"svix-id": msg_id, "svix-timestamp": ts, "svix-signature": f"v1,{sig}", "content-type": "application/json"}


def test_the_unsubscribe_link_the_preference_page_the_webhook_and_the_admin_views(monkeypatch):
    from app.core.config import get_settings
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    secret = "whsec_" + base64.b64encode(b"a-test-signing-secret").decode()
    monkeypatch.setattr(act_router, "get_service", lambda: w.svc)
    monkeypatch.setattr(get_settings(), "resend_webhook_secret", secret)
    client = TestClient(app, raise_server_exceptions=False)
    token = w.svc.token(u)
    assert client.get(f"/email/preferences?token={token}").json()["product_tips"] is True
    assert client.get("/email/preferences?token=made-up").status_code == 404 and client.post("/email/unsubscribe?token=made-up").status_code == 404
    done = client.post(f"/email/unsubscribe?token={token}")               # one click, no sign-in
    assert done.status_code == 200 and "password resets" in done.json()["message"] and w.store.users[u]["marketing_email_status"] == "unsubscribed"
    assert client.put(f"/email/preferences?token={token}", json={"product_tips": True}).json()["status"] == "subscribed"
    body = json.dumps({"type": "email.bounced", "created_at": "2026-10-05T10:20:00Z", "data": {"email_id": "msg-1"}}).encode()
    assert client.post("/webhooks/resend", content=body, headers={"content-type": "application/json"}).status_code == 401
    assert client.post("/webhooks/resend", content=body, headers=_signed(secret, b"{}")).status_code == 401           # signed for a different body
    assert client.post("/webhooks/resend", content=body, headers=_signed(secret, body, ts=time.time() - 3600)).status_code == 401      # too old
    assert client.post("/webhooks/resend", content=body, headers=_signed(secret, body)).json()["status"] == "bounced"
    assert client.post("/webhooks/resend", content=body, headers=_signed(secret, body)).json() == {"ok": True, "duplicate": True}
    assert w.store.users[u]["marketing_email_status"] == "suppressed"
    who = {"id": u, "email": u}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    try:
        assert client.get("/auth/me/email-preferences").json()["can_resubscribe"] is False
        for path in ("/admin/activation", "/admin/activation/dry-run", f"/admin/activation/users/{u}"):
            assert client.get(path).status_code == 403
        who.update({"id": "tech.support@enterprateai.com", "email": "tech.support@enterprateai.com"})
        assert client.get("/admin/activation").json()["guardrails"]["suppressed"] == 1
        assert client.get("/admin/activation/dry-run").json()["config"]["enabled"] is True
        assert client.get(f"/admin/activation/users/{u}").json()["permission"]["suppression_reason"] == "bounced"
        assert client.get("/admin/activation/users/nobody@example.test").status_code == 404
        w.user("audit@example.test", status="unknown")
        assert client.put("/admin/activation/users/audit@example.test/permission", json={"status": "subscribed", "source": "x"}).status_code == 422      # evidence is required
        recorded = client.put("/admin/activation/users/audit@example.test/permission", json={"status": "soft_opt_in", "source": "Opted in at the Leeds event, form 14"}).json()
        assert recorded["permission"]["may_email"] is True and "recorded by tech.support@enterprateai.com" in recorded["permission"]["source"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ══ follow-ups: subscribing again, the dry run at a chosen time, the handoff demonstration ═══

def test_handoff_demo_a_workspace_created_after_a_step_is_scheduled_cancels_it_and_every_later_a_step():
    """Handoff section 10: a2 is scheduled and due, the person creates a workspace before it is sent,
    and a2 and everything after it in Journey A is cancelled. What was already sent stays sent."""
    w = World()
    u = w.user()
    w.tick()
    w.at(minutes=15).tick()
    assert w.steps() == {"a1": "sent", "a2": "scheduled", "a3": "scheduled", "a4": "scheduled", "a5": "scheduled"}
    due = min(rules.parse(r["due_at"]) for r in w.store.ledger_rows.values() if r["step_key"] == "a2")
    w.now = rules.next_window_start(due, "Europe/London") + timedelta(hours=1)      # a2 is now due, inside the sending hours
    assert [(d["step"], d["result"]) for d in run(w.svc.dry_run())["due"]] == [("a2", "would_send")]
    w.workspace(u)                                                        # between scheduling and sending
    handled = run(w.svc.deliver())                                        # the sender alone, before the selector has looked again
    assert [(h["step"], h["result"], h["why"]) for h in handled] == [("a2", "cancelled", "workspace_created")]
    assert w.steps() == {"a1": "sent", "a2": "cancelled", "a3": "cancelled", "a4": "cancelled", "a5": "cancelled"}
    assert {r["stopped_reason"] for r in w.store.ledger_rows.values() if r["state"] == "cancelled"} == {"workspace_created"}
    assert len(w.outbox) == 1
    w.at(days=30).tick()
    assert {k: v for k, v in w.steps().items() if k.startswith("a")} == {"a1": "sent", "a2": "cancelled", "a3": "cancelled", "a4": "cancelled", "a5": "cancelled"}
    assert not any(m["subject"] == rules.ALL_TEMPLATES[s]["subject"] for m in w.outbox for s in ("a2", "a3", "a4", "a5"))


def test_subscribing_again_brings_back_the_tip_that_was_stopped_but_never_journeys_a_or_b():
    w = World()
    u = w.user()
    w.workspace(u, "w1", validation={"overall_score": 70}, financials={"invoices": [{"id": "i1"}]}, catalogue={"products": [{"id": "p1", "name": "Review"}]})
    run(w.svc.select())                                                   # the tip is queued, and before it goes...
    assert w.steps() == {"c1": "scheduled"}
    run(w.svc.set_permission(u, "unsubscribed", source="unsubscribe_link"))      # ...they unsubscribe
    assert w.steps() == {"c1": "cancelled"}
    w.at(days=3).tick()
    assert w.outbox == [] and w.steps() == {"c1": "cancelled"}           # nothing while they are unsubscribed
    run(w.svc.set_permission(u, "subscribed", source="preference_page"))
    w.store.workspaces["w1"]["updated_at"] = w.now.isoformat()
    out = w.tick()
    assert [(p["journey"], p["action"], p["steps"]) for p in out["selected"]] == [("C", "schedule", ["c1"])]
    assert w.subjects() == ["Turn your validation into a next step"] and w.steps() == {"c1": "sent"}
    rows = [r for r in w.store.ledger_rows.values() if r["step_key"] == "c1"]
    assert len(rows) == 1 and rows[0]["stopped_reason"] is None           # the same row: it exists once and went once
    # The limits still hold: the next tip waits its ten days, and a tip that went is never offered again.
    w.at(days=5).tick()
    assert len(w.outbox) == 1
    w.at(days=6).tick()
    assert w.subjects() == ["Turn your validation into a next step", "Let the information you already entered do more"]
    w.at(days=11).tick()
    assert len(w.outbox) == 2                                             # two in thirty days

    # Journey A stopped by unsubscribing stays stopped.
    a = World()
    v = a.user()
    a.tick()
    a.at(minutes=15).tick()
    run(a.svc.set_permission(v, "unsubscribed", source="unsubscribe_link"))
    run(a.svc.set_permission(v, "subscribed", source="preference_page"))
    a.at(days=30).tick()
    assert a.steps() == {"a1": "sent", "a2": "cancelled", "a3": "cancelled", "a4": "cancelled", "a5": "cancelled"} and len(a.outbox) == 1
    # And so does Journey B.
    b = World()
    x = b.user()
    b.workspace(x)
    b.tick()
    b.at(minutes=15).tick()
    run(b.svc.set_permission(x, "unsubscribed", source="unsubscribe_link"))
    run(b.svc.set_permission(x, "subscribed", source="preference_page"))
    b.at(days=30).tick()
    assert b.steps() == {"b1": "sent", "b2": "cancelled", "b3": "cancelled"} and len(b.outbox) == 1


def test_the_dry_run_can_be_asked_about_another_time_and_says_why_each_account_is_in_or_out():
    w = World(dry_run=True, cohort="internal", internal_emails=frozenset({"ada@example.test", "tokyo@example.test"}))
    u = w.user()
    w.user("tokyo@example.test", timezone="Asia/Tokyo")
    w.user("outside@example.test")
    w.user("unsub@example.test", status="unsubscribed")
    w.tick()
    before = {k: dict(v) for k, v in w.store.ledger_rows.items()}
    now = run(w.svc.dry_run())
    assert now["at"] == w.now.isoformat() and now["due"] == []           # a1 is fifteen minutes away
    assert {(p["user_id"], p["action"], p["why"]) for p in now["selected"]} == {
        (u, "skip", "already_in_journey"), ("tokyo@example.test", "skip", "already_in_journey"),
        ("outside@example.test", "skip", "not_in_rollout"), ("unsub@example.test", "skip", "unsubscribed")}
    at = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)                # 13:00 in London, 21:00 in Tokyo
    later = run(w.svc.dry_run(at))
    assert later["at"] == at.isoformat()
    due = {d["user_id"]: d for d in later["due"]}
    assert due[u]["result"] == "would_send" and due[u]["step"] == "a1"
    assert due["tokyo@example.test"]["result"] == "would_defer" and "21:00 in Asia/Tokyo" in due["tokyo@example.test"]["why"]
    assert due["tokyo@example.test"]["timezone"] == "Asia/Tokyo"
    assert due["tokyo@example.test"]["until"] == datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc).isoformat()      # 09:00 the next morning there
    assert w.store.ledger_rows == before and w.outbox == [] and w.svc.clock() == w.now      # asking changes nothing


def test_the_dry_run_address_takes_an_iso_time_and_refuses_anything_else(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.activation import router as activation_router
    w = World(dry_run=True)
    w.user()
    w.tick()
    app = FastAPI()
    app.include_router(activation_router.router)
    app.dependency_overrides[activation_router.require_admin] = lambda: {"id": "admin"}
    monkeypatch.setattr(activation_router, "get_service", lambda: w.svc)
    with TestClient(app) as client:
        assert client.get("/admin/activation/dry-run").json()["due"] == []
        seen = client.get("/admin/activation/dry-run", params={"at": "2026-10-05T12:00:00Z"}).json()
        assert seen["at"].startswith("2026-10-05T12:00:00") and [d["result"] for d in seen["due"]] == ["would_send"]
        assert client.get("/admin/activation/dry-run", params={"at": "2026-10-05T12:00:00"}).json()["at"].startswith("2026-10-05T12:00:00+00:00")
        bad = client.get("/admin/activation/dry-run", params={"at": "next tuesday"})
        assert bad.status_code == 422 and "ISO" in bad.json()["detail"]
