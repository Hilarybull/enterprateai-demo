"""The internal Marketplace team: the administrator keeps the list, in production too. The team adds and manages
profiles for claiming; nobody handles a profile they have a stake in; a team member's own claim always goes to another person."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound
from app.shared.auth.deps import get_current_user, get_optional_user
from test_agent import Env, run
from test_marketplace_admin_directory import FORM
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, index, svc_of, verified_claim

SLUG = "northwind-advisory-ltd-leeds"
TEAM = "sam@enterprate.test"
SECOND = "kim@enterprate.test"


def team_env(*emails):
    env = Env()
    s = svc_of(env)
    for email in emails or (TEAM,):
        env.meter.plans.setdefault(email, "explorer")
        run(s.add_team_member(ADMIN, email))
    return env, s


def test_only_the_administrator_keeps_the_team_and_every_change_is_recorded():
    env, s = team_env()
    assert [m["email"] for m in run(s.team(ADMIN))["members"]] == [TEAM]
    for who in (U(TEAM), U(NEW), None):
        for attempt in (lambda: s.team(who), lambda: s.add_team_member(who, SECOND), lambda: s.remove_team_member(who, TEAM)):
            with pytest.raises(Forbidden):
                run(attempt())
    with pytest.raises(Invalid):
        run(s.add_team_member(ADMIN, "not an email"))
    with pytest.raises(Invalid):
        run(s.add_team_member(ADMIN, d.ADMIN_EMAIL))
    run(s.add_team_member(ADMIN, TEAM.upper()))      # already on it, whatever the case
    assert len(run(s.team(ADMIN))["members"]) == 1
    left = run(s.remove_team_member(ADMIN, TEAM))
    assert left["members"] == [] and [h["action"] for h in left["history"]] == ["removed", "added"] and left["history"][0]["by"] == d.ADMIN_EMAIL
    with pytest.raises(NotFound):
        run(s.remove_team_member(ADMIN, TEAM))


def test_it_works_in_production_where_the_development_list_is_ignored_and_removal_is_immediate(monkeypatch):
    from types import SimpleNamespace

    from app.core import config
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(environment="production", marketplace_moderators=TEAM, marketplace_unclaimed_visibility="invite_only", marketplace_claim_invites_enabled=False))
    env = Env()
    s = svc_of(env)
    assert run(s.can_moderate(U(TEAM))) is False
    run(s.add_team_member(ADMIN, TEAM))
    assert run(s.can_moderate(U(TEAM))) is True
    run(s.remove_team_member(ADMIN, TEAM))
    assert run(s.can_moderate(U(TEAM))) is False


def test_an_unverified_account_on_that_email_gets_nothing_and_a_broken_list_lets_nobody_in(monkeypatch):
    env, s = team_env()
    assert run(s.can_moderate({"id": "x", "email": TEAM, "email_verified": False})) is False
    fresh = service = d.DirectoryService(store=s.store, business=s.business, clock=s.clock)

    async def broken(*_a, **_k):
        raise RuntimeError("database down")
    monkeypatch.setattr(service.store, "find_key", broken)
    assert run(fresh.can_moderate(U(TEAM))) is False
    assert run(fresh.can_moderate(ADMIN)) is True


def test_the_team_adds_imports_edits_invites_and_archives_but_not_directory_wide_settings():
    env, s = team_env()
    me = U(TEAM)
    added = run(s.add_business(me, dict(FORM)))
    assert added["result"] == "created" and run(s.unclaimed_profiles(me))["total"] == 1
    with pytest.raises(Conflict):      # the same business again is refused, for the team as for anyone
        run(s.add_business(me, dict(FORM)))
    preview = run(s.import_businesses(me, [dict(FORM), {**NORTHWIND}]))
    assert preview["committed"] is False and preview["summary"]["duplicates"] == 1
    edited = run(s.edit_profile(me, added["slug"], {"description": "Bookkeeping and payroll for independent shops, cafes and small trades across Yorkshire."}, "Better wording"))
    assert edited["slug"] == added["slug"] and run(s.profile_sources(me, added["slug"]))["edits"][-1]["by"] == TEAM
    assert run(s.create_invitation(me, added["slug"], reason="profile_control"))["link"].startswith(f"/marketplace/claim/{added['slug']}?invite=")
    assert run(s.set_profile_visibility(me, [added["slug"]], "public", "Agreed to be listed"))["count"] == 1
    assert run(s.moderate_profile(me, added["slug"], action="archive", reason="Closed down last year"))["publication"] == "suppressed"
    assert run(s.visibility_setting(me))["unclaimed_visibility"]      # can read it
    with pytest.raises(Forbidden):
        run(s.set_visibility(me, "public"))
    with pytest.raises(Forbidden):
        run(s.normalise_locations(me))


def test_a_stranger_gets_none_of_it():
    env, s = team_env()
    index(env)
    stranger = U(NEW)
    for attempt in (lambda: s.unclaimed_profiles(stranger), lambda: s.add_business(stranger, dict(FORM)), lambda: s.edit_profile(stranger, SLUG, {"location": "York"}),
                    lambda: s.create_invitation(stranger, SLUG, reason="profile_control"), lambda: s.review_queue(stranger)):
        with pytest.raises(Forbidden):
            run(attempt())


def test_the_whole_journey_team_adds_invites_owner_claims_team_decides():
    env, s = team_env()
    added = run(s.add_business(U(TEAM), dict(FORM)))
    invite = run(s.create_invitation(U(TEAM), added["slug"], reason="profile_control"))
    token = invite["link"].split("invite=")[1]
    claim = run(s.start_claim(U(NEW), added["slug"], invitation=token))
    assert claim["status"] == "claim_started"
    claim = run(s.confirm_match(U(NEW), claim["id"], "new"))
    claim = run(s.start_verification(U(NEW), claim["id"], method="manual", note="I am the director of this company and can show the filing."))
    queue = run(s.review_queue(U(TEAM)))
    assert [c["id"] for c in queue["claims"]] == [claim["id"]] and queue["claims"][0]["needs_another_reviewer"] is False
    run(s.review_decision(U(TEAM), claim["id"], decision="approve", reason="Filing matches the director's name."))
    profile = run(s.public_profile(added["slug"]))
    assert profile["trust"]["state"] == "verified"
    held = next(p for p in s.store.rows["profiles"].values() if p["data"].get("slug") == added["slug"])
    assert held["data"]["linked_business_id"] in env.businesses
    with pytest.raises(Conflict):      # the business holds it now: only its owner edits it
        run(s.edit_profile(U(TEAM), added["slug"], {"location": "York"}))


def test_a_team_members_own_code_never_approves_their_own_claim():
    """They can edit a profile's website, so pointing it at their own domain must not win them the profile."""
    env, s = team_env(TEAM, SECOND)
    index(env)
    claim = run(s.start_claim(U(TEAM), SLUG))
    claim = run(s.confirm_match(U(TEAM), claim["id"], "new"))
    claim = run(s.start_verification(U(TEAM), claim["id"], method="email_domain", email="owner@northwind-advisory.co.uk"))
    done = run(s.complete_verification(U(TEAM), claim["id"], claim["verification"]["id"], s.sent_codes[-1][1]))
    assert done["status"] == "verification_pending"
    held = next(p for p in s.store.rows["profiles"].values() if p["data"].get("slug") == SLUG)
    assert held["data"]["claim_state"] == "unclaimed" and not held["data"].get("linked_business_id")
    # They can't decide it, nor touch the profile while they have a stake in it. A colleague can decide it.
    with pytest.raises(Forbidden):
        run(s.review_decision(U(TEAM), claim["id"], decision="approve", reason="It is mine, honestly."))
    with pytest.raises(Forbidden):
        run(s.edit_profile(U(TEAM), SLUG, {"website": "https://mine.example"}))
    with pytest.raises(Forbidden):
        run(s.create_invitation(U(TEAM), SLUG, reason="profile_control"))
    with pytest.raises(Forbidden):
        run(s.moderate_profile(U(TEAM), SLUG, action="archive", reason="Getting rid of it"))
    assert run(s.set_profile_visibility(U(TEAM), [SLUG], "hidden"))["count"] == 0
    assert run(s.review_decision(U(SECOND), claim["id"], decision="reject", reason="Not enough to go on."))["status"] == "rejected"


def test_with_a_team_a_revocation_needs_a_second_person():
    env, s = team_env()
    index(env)
    claim = verified_claim(env)
    first = run(s.review_decision(U(TEAM), claim["id"], decision="revoke", reason="Fraud report upheld.", reason_category="fraud_or_impersonation"))
    assert first["revocation"] == "awaiting_second_reviewer"
    with pytest.raises(Forbidden):
        run(s.review_decision(U(TEAM), claim["id"], decision="revoke", reason="Confirming my own.", reason_category="fraud_or_impersonation"))
    assert run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Confirmed after checking.", reason_category="fraud_or_impersonation"))["status"] == "revoked"


def test_a_later_import_leaves_what_a_claimed_business_has_set():
    env, s = team_env()
    index(env)
    verified_claim(env)
    row = next(p for p in s.store.rows["profiles"].values() if p["data"].get("slug") == SLUG)
    s.store.rows["profiles"][row["id"]]["data"]["description"] = "Written by the owner after claiming."
    out = run(s.index_records([{**NORTHWIND, "description": "A scraped description that should not win.", "website": "https://www.northwind-advisory.co.uk", "contact_email": "other@example.test"}]))["results"][0]
    assert out["result"] == "updated"
    after = s.store.rows["profiles"][row["id"]]["data"]
    assert after["description"] == "Written by the owner after claiming." and after["contact_email"] != "other@example.test" and after["claim_state"] == "verified"


def test_the_api(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    svc_of(env)
    who = dict(ADMIN)
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_optional_user] = lambda: dict(who)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.post("/admin/marketplace/team", json={"email": TEAM}).status_code == 200
        assert [m["email"] for m in client.get("/admin/marketplace/team").json()["members"]] == [TEAM]
        who.clear()
        who.update({"id": TEAM, "email": TEAM})
        assert client.get("/admin/marketplace/access").json() == {"moderator": True, "team": True}
        assert client.get("/admin/marketplace/team").status_code == 403
        assert client.post("/admin/marketplace/team", json={"email": NEW}).status_code == 403
        assert client.delete(f"/admin/marketplace/team/{TEAM}").status_code == 403
        assert client.post("/admin/marketplace/directory/businesses", json={"record": dict(FORM)}).status_code == 201
        assert client.get("/admin/marketplace/directory/unclaimed").json()["total"] == 1
        assert client.post("/admin/marketplace/directory/index", json={"records": [dict(NORTHWIND)]}).status_code == 403
        assert client.put("/admin/marketplace/settings", json={"unclaimed_visibility": "public"}).status_code == 403
        who.clear()
        who.update(ADMIN)
        assert client.delete(f"/admin/marketplace/team/{TEAM}").status_code == 200
        who.clear()
        who.update({"id": TEAM, "email": TEAM})
        assert client.get("/admin/marketplace/access").json() == {"moderator": False}
        assert client.get("/admin/marketplace/directory/unclaimed").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_ai_fill_writes_from_the_form_for_the_team_only_and_saves_nothing():
    env, s = team_env()
    asked = []

    async def writer(prompt):
        asked.append(prompt)
        return "Francal is a construction and trades business based in Florida, offering roofing work for local customers."
    record = {"name": "Francal", "category": "Construction & Trades", "location": "Florida", "service_tags": ["Roofing"]}
    before = len(s.store.rows["profiles"])
    out = run(s.suggest_index_description(U(TEAM), record, writer))
    assert out["suggestion"].startswith("Francal is") and len(s.store.rows["profiles"]) == before
    assert "third person" in asked[0] and "Do not invent" in asked[0] and "Roofing" in asked[0]
    with pytest.raises(Forbidden):
        run(s.suggest_index_description(U(NEW), record, writer))
    with pytest.raises(Invalid):      # not enough to go on: no call to the model
        run(s.suggest_index_description(U(TEAM), {"name": "Francal"}, writer))
    assert len(asked) == 1

    async def nonsense(_prompt):
        return "x"
    with pytest.raises(Invalid):
        run(s.suggest_index_description(U(TEAM), record, nonsense))
