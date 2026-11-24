"""Visits to a Marketplace profile (the owner, 14 Nov): one per visitor a day, never its owner or the team, and shown
on the profile page only to its owner and the superadmin."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.marketplace import directory as d
from test_agent import MEMBER, OUTSIDER, OWNER, run
from test_marketplace_claim import ADMIN, U, events
from test_marketplace_visibility import world

NORTH = "northwind-advisory-ltd-leeds"      # unclaimed
HARBOUR = "harbour-legal-llp-york"          # claimed by business A, owned by OWNER


def test_each_visitor_counts_once_a_day_and_the_owner_and_team_never():
    env, s = world("public")
    for who in ("ip:1.1.1.1", "ip:1.1.1.1", "ip:2.2.2.2", f"user:{OUTSIDER}"):
        run(s.record_view(NORTH, U(OUTSIDER) if who.startswith("user") else None, None, who))
    run(s.record_view(NORTH, ADMIN, None, "user:admin-1"))                       # the team checking it
    assert run(s.profile_views(run(s._profile(NORTH))["id"]))["total"] == 3
    env.now += d.timedelta(days=1)
    run(s.record_view(NORTH, None, None, "ip:1.1.1.1"))                           # the same visitor, the next day
    seen = run(s.profile_views(run(s._profile(NORTH))["id"]))
    assert (seen["total"], seen["last_7_days"], seen["last_30_days"]) == (4, 4, 4) and seen["last_viewed_at"] == env.now.isoformat()
    env.now += d.timedelta(days=40)
    assert run(s.profile_views(run(s._profile(NORTH))["id"]))["last_30_days"] == 0
    assert len(events(env, "profile_viewed")) == 4                                # the funnel counts the same visits
    blob = str([e["data"] for e in s.store.rows["events"].values() if e["kind"] == "profile_views"])
    assert "1.1.1.1" not in blob and OUTSIDER not in blob                        # who visited is never kept, only a hash

    run(s.record_view(HARBOUR, U(OWNER), None, f"user:{OWNER}"))                 # the owner looking at their own profile
    run(s.record_view(HARBOUR, None, None, "ip:3.3.3.3"))
    assert run(s.public_profile(HARBOUR, U(OWNER)))["views"]["total"] == 1       # its owner sees it
    assert "views" not in run(s.public_profile(HARBOUR, U(OUTSIDER)))           # a visitor doesn't
    assert "views" not in run(s.public_profile(HARBOUR, None))
    for viewer in (None, U(OUTSIDER), U(MEMBER)):
        assert "views" not in run(s.public_profile(NORTH, viewer))
    assert "views" not in run(s.public_profile(HARBOUR, U(MEMBER)))
    assert run(s.public_profile(NORTH, ADMIN))["views"]["total"] == 4
    assert run(s.public_profile(HARBOUR, ADMIN))["views"]["total"] == 1

    async def moderator(viewer):
        return True

    s.can_moderate = moderator
    assert "views" not in run(s.public_profile(NORTH, U(MEMBER)))


def test_the_team_sees_visits_on_the_unclaimed_list():
    env, s = world("public")
    run(s.record_view(NORTH, None, None, "ip:9.9.9.9"))
    rows = {p["slug"]: p for p in run(s.unclaimed_profiles(ADMIN))["items"]}
    assert rows[NORTH]["views"]["total"] == 1 and rows[NORTH]["views"]["last_30_days"] == 1


def test_a_member_with_profile_controls_does_not_receive_private_visit_counts(monkeypatch):
    env, s = world("public")

    async def member_actor(*args, **kwargs):
        return SimpleNamespace(is_owner=False, can_send=True)

    monkeypatch.setattr(s.business, "actor", member_actor)
    profile = run(s.public_profile(HARBOUR, U(MEMBER)))
    assert profile["owner_controls"] is True
    assert "views" not in profile


def test_workspace_visit_endpoint_checks_the_owner_or_superadmin_before_returning_counts(monkeypatch):
    from app.modules.marketplace import service

    async def workspace(*args, **kwargs):
        return {"id": "A", "user_id": OWNER, "data": {"marketplace": {"profile_views": [{"viewed_at": "2026-11-17"}]}}}

    monkeypatch.setattr(service, "_load_workspace", workspace)
    monkeypatch.setattr(service, "sb_select", workspace)
    assert run(service.get_profile_views(user_id=OWNER, workspace_id="A"))["total"] == 1
    for viewer in (MEMBER, OUTSIDER, ADMIN["id"]):
        with pytest.raises(HTTPException) as error:
            run(service.get_profile_views(user_id=viewer, workspace_id="A"))
        assert error.value.status_code == 403
    assert run(service.get_profile_views(user_id=ADMIN["id"], user_email=ADMIN["email"], workspace_id="A"))["total"] == 1


def test_assigned_views_survive_new_visits_and_can_be_set_back_to_zero():
    env, s = world("public")
    profile_id = run(s._profile(NORTH))["id"]
    run(s.set_profile_views(ADMIN, NORTH, 200))
    counter = run(s._views_counter(profile_id))
    seeded_at = env.now.isoformat()
    run(s.store.update("events", counter["id"], {
        "data": {**counter["data"], "profile_views_seeded_at": seeded_at},
    }, bump=False))

    run(s.set_profile_views(ADMIN, NORTH, 0))
    assert run(s.profile_views(profile_id))["total"] == 0
    run(s.set_profile_views(ADMIN, NORTH, 200))
    run(s.record_view(NORTH, None, None, "ip:9.9.9.9"))
    summary = run(s.profile_views(profile_id))
    assert (summary["total"], summary["tracked_total"], summary["last_7_days"]) == (201, 1, 1)
    data = run(s._views_counter(profile_id))["data"]
    assert data["profile_views_seeded_at"] == seeded_at
    assert data["admin_additions"][-1]["total"] == 200

    run(s.set_profile_views(ADMIN, NORTH, 1))
    run(s.record_view(NORTH, None, None, "ip:8.8.8.8"))
    assert run(s.profile_views(profile_id))["total"] == 2
