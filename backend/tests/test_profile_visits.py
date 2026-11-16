"""Visits to a Marketplace profile (the owner, 14 Nov): one per visitor a day, never its owner or the team, and shown
only to the business and the team."""
from app.modules.marketplace import directory as d
from test_agent import OUTSIDER, OWNER, run
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
    assert run(s.public_profile(NORTH, ADMIN))["views"]["total"] == 4            # the team does


def test_the_team_sees_visits_on_the_unclaimed_list():
    env, s = world("public")
    run(s.record_view(NORTH, None, None, "ip:9.9.9.9"))
    rows = {p["slug"]: p for p in run(s.unclaimed_profiles(ADMIN))["items"]}
    assert rows[NORTH]["views"]["total"] == 1 and rows[NORTH]["views"]["last_30_days"] == 1
