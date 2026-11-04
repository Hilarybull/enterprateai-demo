"""Welcome, a plan that is really ending, and following up a quiet account, on the same engine and switches as the other emails."""
import json
from datetime import timedelta

from app.modules.activation import rules
from test_activation import World

NEW = dict(lifecycle_emails=True)


def subjects(w):
    return [m["subject"] for m in w.outbox]


def test_a_new_account_is_welcomed_once_without_marketing_permission():
    w = World(**NEW)
    w.user(status="unknown")
    w.tick()
    w.at(hours=1).tick()
    assert subjects(w) == ["Welcome to EnterprateAI"]
    m = w.outbox[0]
    assert m["marketing"] is False and "nsubscribe" not in m["text"] and "nsubscribe" not in json.dumps(m["headers"])


def test_nobody_who_joined_long_ago_gets_a_welcome():
    w = World(**NEW)
    w.user(status="unknown", verified_at=w.now - timedelta(days=8))
    w.tick()
    assert w.outbox == []


def test_a_welcome_respects_the_switches_and_a_dead_address():
    dry = World(dry_run=True, **NEW)
    dry.user(status="unknown")
    dry.tick()
    assert dry.outbox == []
    internal = World(cohort="internal", **NEW)
    internal.user(status="unknown")
    internal.tick()
    assert internal.outbox == []
    bounced = World(**NEW)
    bounced.user(status="suppressed")
    bounced.tick()
    assert bounced.outbox == []
    unverified = World(**NEW)
    unverified.user(status="unknown", email_verified=False)
    unverified.tick()
    assert unverified.outbox == []


def test_an_unsubscribed_person_is_still_told_about_their_account_but_gets_no_follow_up():
    w = World(**NEW)
    u = w.user(status="unsubscribed")
    w.store.subs[u] = {"plan_key": "starter_insight", "status": "trial", "current_period_end": (w.now + timedelta(days=6)).isoformat()}
    w.tick()
    assert "Welcome to EnterprateAI" in subjects(w) and any("plan ends" in s for s in subjects(w))
    w.at(days=20).tick()
    assert not any(r["journey_key"] == "D" for r in w.store.ledger_rows.values())


def test_the_welcome_doesnt_hold_up_the_getting_started_email():
    w = World(**NEW)
    w.user()
    w.tick()
    w.at(minutes=15).tick()
    assert subjects(w) == ["Welcome to EnterprateAI", rules.TEMPLATES["a1"]["subject"]]


def ending(w, days, **over):
    return {"plan_key": "starter_insight", "status": "trial", "current_period_end": (w.now + timedelta(days=days)).isoformat(), **over}


def seen_long_ago_user(w, **over):
    return w.user(status="unknown", verified_at=w.now - timedelta(days=30), **over)


def test_a_plan_ending_gets_a_reminder_at_7_days_and_at_1_day_each_once():
    w = World(**NEW)
    u = seen_long_ago_user(w)
    w.store.subs[u] = ending(w, 10)
    w.tick()
    assert w.outbox == []
    w.at(days=4).tick()
    w.at(hours=1).tick()
    end = rules.parse(w.store.subs[u]["current_period_end"])
    assert subjects(w) == [f"Your EnterprateAI plan ends on {end.day} {end:%B %Y}"]
    assert f"{end.day} {end:%B %Y}" in w.outbox[0]["text"] and w.outbox[0]["marketing"] is False and "{date}" not in w.outbox[0]["text"]
    w.at(days=5).tick()
    assert subjects(w)[-1] == "Your EnterprateAI plan ends tomorrow" and len(w.outbox) == 2


def test_a_plan_that_renews_by_itself_gets_no_reminder():
    w = World(**NEW)
    u = seen_long_ago_user(w)
    w.store.subs[u] = ending(w, 5, status="active", stripe_subscription_id="sub_1", current_period_start=(w.now - timedelta(days=25)).isoformat())
    w.tick()
    assert w.outbox == []


def test_a_stripe_plan_cancelled_for_the_end_of_its_period_gets_one_unless_they_change_their_mind():
    w = World(**NEW)
    u = seen_long_ago_user(w)
    w.store.subs[u] = ending(w, 5, status="active", stripe_subscription_id="sub_1", current_period_start=(w.now - timedelta(days=25)).isoformat(), cancelled_at=(w.now - timedelta(days=2)).isoformat())
    w.tick()
    assert len(w.outbox) == 1
    other = World(**NEW)
    v = seen_long_ago_user(other)
    other.store.subs[v] = ending(other, 5, status="active", stripe_subscription_id="sub_1", current_period_start=(other.now - timedelta(days=25)).isoformat(), cancelled_at=(other.now - timedelta(days=2)).isoformat())
    run_select = other.svc.select
    from test_activation import run
    run(run_select())
    other.store.subs[v]["cancelled_at"] = None
    run(other.svc.deliver())
    assert other.outbox == [] and any(r["stopped_reason"] == "plan_no_longer_ending" for r in other.store.ledger_rows.values())


def test_a_cancel_from_before_this_period_doesnt_count():
    w = World(**NEW)
    u = seen_long_ago_user(w)
    w.store.subs[u] = ending(w, 5, status="active", stripe_subscription_id="sub_2", current_period_start=(w.now - timedelta(days=25)).isoformat(), cancelled_at=(w.now - timedelta(days=90)).isoformat())
    w.tick()
    assert w.outbox == []


def test_a_new_period_gets_its_own_reminder():
    w = World(**NEW)
    u = seen_long_ago_user(w)
    w.store.subs[u] = ending(w, 5)
    w.tick()
    w.at(days=40)
    w.store.subs[u] = ending(w, 5)
    w.tick()
    assert sum("plan ends on" in s for s in subjects(w)) == 2


def quiet(w, days, status="subscribed"):
    """Has a workspace and a first task behind them, and hasn't been seen for this long."""
    then = w.now - timedelta(days=days)
    u = w.user(status=status, verified_at=then, last_seen_at=then.isoformat())
    w.workspace(u, "w1", validation={"overall_score": 70})
    w.store.workspaces["w1"].update(created_at=then.isoformat(), updated_at=then.isoformat())
    return u


def follow_ups(w):
    return [r["step_key"] for r in w.store.ledger_rows.values() if r["journey_key"] == "D"]


def test_a_quiet_account_with_permission_is_followed_up_at_14_30_and_60_days_then_it_stops():
    w = World(**NEW)
    quiet(w, 14)
    w.tick()
    assert follow_ups(w) == ["d1"]
    w.at(days=3).tick()      # any tip due goes first: the 48 hour gap between promotional emails still holds
    sent = next(m for m in w.outbox if m["subject"] == rules.LIFECYCLE["d1"]["subject"])
    assert sent["marketing"] is True and "Unsubscribe" in sent["text"]
    w.at(days=13).tick()
    assert "d2" in follow_ups(w)
    w.at(days=30).tick()
    assert "d3" in follow_ups(w)
    count = len(w.outbox)
    w.at(days=31).tick()
    w.at(days=60).tick()
    assert sorted(follow_ups(w)) == ["d1", "d2", "d3"]
    assert not [m for m in w.outbox[count:] if m["subject"] in {t["subject"] for t in rules.LIFECYCLE.values()}]


def test_no_permission_no_follow_up():
    w = World(**NEW)
    quiet(w, 20, status="unknown")
    w.tick()
    assert follow_ups(w) == []


def test_someone_quiet_for_over_90_days_is_not_suddenly_contacted():
    w = World(**NEW)
    quiet(w, 120)
    w.tick()
    assert follow_ups(w) == []


def test_someone_who_comes_back_before_it_goes_doesnt_get_it():
    from test_activation import run
    w = World(**NEW)
    u = quiet(w, 20)
    run(w.svc.select())
    w.store.users[u]["last_seen_at"] = w.now.isoformat()
    run(w.svc.deliver())
    assert not [m for m in w.outbox if m["subject"] == rules.LIFECYCLE["d1"]["subject"]]


def test_the_new_copy_has_no_dashes():
    for t in rules.LIFECYCLE.values():
        words = t["subject"] + t["button"] + " ".join(t["body"])
        assert "\u2013" not in words and "\u2014" not in words
