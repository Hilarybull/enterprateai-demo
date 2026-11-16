"""A listed business is told when it is listed and every Monday at 7am UK time until it claims. Its private contact stays private."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.modules.marketplace import directory as d
from test_agent import Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, index, svc_of
from test_marketplace_decisions import SLUG, waiting_claim

MONDAY_7 = datetime(2026, 11, 9, 7, 5, tzinfo=timezone.utc)      # GMT in November


@pytest.fixture()
def world(monkeypatch):
    env = Env()
    s = svc_of(env)
    run(s.set_visibility(ADMIN, "public"))
    s.sent = []

    async def send(message):
        s.sent.append(message)
        return True
    s._send_invitation = send
    monkeypatch.setattr(d.DirectoryService, "_invites_enabled", staticmethod(lambda: True))
    return env, s


def at(s, when):
    s.clock = lambda: when


def test_a_business_is_told_when_it_is_listed_with_a_way_to_stop(world):
    env, s = world
    index(env)
    assert [m["reason"] for m in s.sent] == ["listed"]
    m = s.sent[0]
    assert m["to"] == NORTHWIND["contact_email"] and "/marketplace/claim/" in m["link"] and "/opt-out" in m["opt_out"]


def test_not_told_when_it_isnt_public_or_has_no_email(world):
    env, s = world
    run(s.set_visibility(ADMIN, "admin_only"))
    index(env)
    assert s.sent == []


def test_every_monday_at_7_uk_time_once_until_claimed(world):
    env, s = world
    at(s, MONDAY_7 - timedelta(days=7))
    index(env)
    s.sent.clear()
    at(s, MONDAY_7)
    assert run(s.send_claim_reminders()) == 1
    assert s.sent[0]["reason"] == "weekly_reminder"
    at(s, MONDAY_7 + timedelta(minutes=20))
    assert run(s.send_claim_reminders()) == 0      # once a week, however often it runs
    at(s, MONDAY_7 + timedelta(days=7))
    assert run(s.send_claim_reminders()) == 1


@pytest.mark.parametrize("when", [MONDAY_7 - timedelta(hours=1), MONDAY_7 + timedelta(hours=1), MONDAY_7 + timedelta(days=1)])
def test_not_at_any_other_time(world, when):
    env, s = world
    at(s, MONDAY_7 - timedelta(days=7))
    index(env)
    s.sent.clear()
    at(s, when)
    assert run(s.send_claim_reminders()) == 0


def test_7am_follows_uk_summer_time(world):
    env, s = world
    summer_6_utc = datetime(2026, 7, 6, 6, 5, tzinfo=timezone.utc)      # a Monday: 7:05 in London
    at(s, summer_6_utc - timedelta(days=7))
    index(env)
    s.sent.clear()
    at(s, summer_6_utc)
    assert run(s.send_claim_reminders()) == 1


def test_just_listed_waits_for_the_next_monday(world):
    env, s = world
    at(s, MONDAY_7 - timedelta(days=1))
    index(env)
    s.sent.clear()
    at(s, MONDAY_7)
    assert run(s.send_claim_reminders()) == 0


def test_stops_once_claimed_and_once_they_opt_out(world):
    env, s = world
    at(s, MONDAY_7 - timedelta(days=7))
    index(env)
    token = s.sent[0]["opt_out"].split("/")[3]
    run(s.opt_out(token))
    s.sent.clear()
    at(s, MONDAY_7)
    assert run(s.send_claim_reminders()) == 0
    env2 = Env()
    s2 = svc_of(env2)
    run(s2.set_visibility(ADMIN, "public"))
    s2.sent = []

    async def send(message):
        s2.sent.append(message)
        return True
    s2._send_invitation = send
    index(env2)
    claim = waiting_claim(env2)
    run(s2.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))
    s2.sent.clear()
    at(s2, MONDAY_7)
    assert run(s2.send_claim_reminders()) == 0


def test_a_failed_send_is_tried_again_and_doesnt_stop_the_listing(world):
    env, s = world

    async def down(_message):
        raise RuntimeError("mail provider down")
    s._send_invitation = down
    at(s, MONDAY_7 - timedelta(days=7))
    index(env)
    assert s.store.rows["profiles"]      # listed anyway
    s.sent = []

    async def send(message):
        s.sent.append(message)
        return True
    s._send_invitation = send
    at(s, MONDAY_7)
    assert run(s.send_claim_reminders()) == 1


def test_automatic_emails_dont_use_up_the_teams_own_invitation(world):
    env, s = world
    index(env)
    assert run(s.create_invitation(ADMIN, SLUG, reason="profile_control"))["reason"] == "profile_control"


def test_the_phone_and_email_are_kept_private_and_the_team_can_see_them(world):
    env, s = world
    run(s.add_business(ADMIN, {**NORTHWIND, "contact_phone": "020 7946 0000"}))
    public = json.dumps(run(s.public_profile(SLUG)), default=str) + json.dumps(run(s.search()), default=str)
    assert "020 7946 0000" not in public and NORTHWIND["contact_email"] not in public
    row = next(i for i in run(s.unclaimed_profiles(ADMIN))["items"] if i["slug"] == SLUG)
    assert row["contact_phone"] == "020 7946 0000" and row["contact_email"] == NORTHWIND["contact_email"]


def test_a_bad_phone_is_refused(world):
    _env, s = world
    assert "contact_phone" in run(s.check_business(ADMIN, {**NORTHWIND, "contact_phone": "123"}))["errors"]


def test_adding_an_email_later_tells_the_business_then(world):
    env, s = world
    run(s.add_business(ADMIN, {**NORTHWIND, "contact_email": None}))
    assert s.sent == []
    run(s.edit_profile(ADMIN, SLUG, {"contact_email": "owner@northwind-advisory.co.uk"}))
    assert [m["reason"] for m in s.sent] == ["listed"]


@pytest.mark.parametrize("reason", ["listed", "weekly_reminder"])
def test_the_emails_read_properly_and_are_safe(monkeypatch, reason):
    sent = {}

    async def fake(**kw):
        sent.update(kw)
        return SimpleNamespace(sent=True)
    monkeypatch.setattr("app.shared.email.resend.send_email_via_resend", fake)
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "marketplace_claim_invites_enabled", True)
    assert run(d._email_invitation({"to": "a@b.test", "business_name": "<b>Acme</b>", "reason": reason, "link": "/marketplace/claim/acme?invite=t", "opt_out": "/marketplace/invitations/t/opt-out", "requests": 2, "key": "k"})) is True
    assert "2 requests are waiting" in sent["text_content"] and "Next step:" in sent["text_content"] and "opt-out" in sent["text_content"]
    assert "<b>Acme" not in sent["html_content"] and sent["idempotency_key"] == "k"
    assert 'text-align:center' in sent["html_content"] and "background:#4f46e5" in sent["html_content"]      # a centred button, not a bare link
    for dash in ("\u2013", "\u2014"):
        assert dash not in sent["text_content"] and dash not in sent["subject"]


@pytest.mark.parametrize("typed,name", [("blue", "Blue Shark Design Limited"), ("shark", "Blue Shark Design Limited"), ("blu shrak", "Blue Shark Design Limited"),
                                        ("birmingam brewing", "Birmingham Brewing Company Limited"), ("bidmrk", "Bidmark Limited"), ("Liverpol", "Liverpool Media")])
def test_a_close_spelling_fits(typed, name):
    assert d.name_likeness(typed, name) >= 0.62


@pytest.mark.parametrize("typed,name", [("re", "Blue Shark Design Limited"), ("bakery", "Blue Shark Design Limited"), ("zzz", "Bidmark Limited"), ("x", "Xenon")])
def test_an_unrelated_name_doesnt(typed, name):
    assert d.name_likeness(typed, name) < 0.62


def test_suggestions_are_only_listed_businesses_closest_first_and_show_nothing_private(world):
    env, s = world
    index(env)
    found = run(s.suggest_names("Northwnd Advisry"))
    assert [b["slug"] for b in found] == [SLUG]
    assert set(found[0]) == {"id", "slug", "name", "location", "claimed"}
    assert run(s.suggest_names("Northwind"))[0]["slug"] == SLUG
    assert run(s.suggest_names("n")) == []
    run(s.set_visibility(ADMIN, "admin_only"))
    assert run(s.suggest_names("Northwind")) == []
