"""Who can see a directory profile nobody has claimed yet (MARKETPLACE_UNCLAIMED_VISIBILITY):
admin_only, invite_only or public. Claimed and self-made profiles are open at every level."""
import copy

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Forbidden, Invalid, NotFound, RateLimited
from app.shared.auth.deps import get_current_user, get_optional_user
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, events, index, svc_of, verified_claim

SLUG = "northwind-advisory-ltd-leeds"
HARBOUR = {**NORTHWIND, "name": "Harbour Legal LLP", "company_number": "87654321", "website": "https://harbour-legal.co.uk", "contact_email": "office@harbour-legal.co.uk",
           "category": "Legal", "location": "York", "source": {"provider": "Companies House", "record_id": "87654321"}}
READY = {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}


def world(level):
    """Two sourced profiles (Northwind unclaimed, Harbour claimed by business A) and one self-made profile (business B)."""
    env = Env()
    s = svc_of(env)
    index(env, NORTHWIND, HARBOUR)
    verified_claim(env, user=OWNER, slug="harbour-legal-llp-york", target="A", email="partner@harbour-legal.co.uk")
    run(s.update_profile(U(OUTSIDER), "B", dict(READY)))
    run(s.update_preferences(U(OUTSIDER), "B", {"enquiries": {"enabled": True}}))
    run(s.activate(U(OUTSIDER), "B"))
    if level:
        run(s.set_visibility(ADMIN, level))
    return env, s


def test_the_default_is_invite_only_and_a_moderators_choice_is_kept_with_who_and_when(monkeypatch):
    assert type(get_settings()).model_fields["marketplace_unclaimed_visibility"].default == "invite_only"
    monkeypatch.setattr(get_settings(), "marketplace_unclaimed_visibility", "invite_only")
    env = Env()
    s = svc_of(env)
    assert run(s.visibility()) == "invite_only"
    seen = run(s.visibility_setting(ADMIN))
    assert (seen["unclaimed_visibility"], seen["source"], seen["changed_by"]) == ("invite_only", "default", None)
    assert [x["key"] for x in seen["levels"]] == ["admin_only", "invite_only", "public"] and all(x["explanation"] for x in seen["levels"])
    for call in (s.visibility_setting(U(OWNER)), s.set_visibility(U(OWNER), "public"), s.unclaimed_profiles(U(OWNER))):
        with pytest.raises(Forbidden):
            run(call)
    with pytest.raises(Invalid):
        run(s.set_visibility(ADMIN, "everyone"))
    changed = run(s.set_visibility(ADMIN, "admin_only"))
    assert (changed["unclaimed_visibility"], changed["source"], changed["changed_by"], changed["changed_at"]) == ("admin_only", "moderator", d.ADMIN_EMAIL, env.now.isoformat())
    env.now += d.timedelta(hours=1)
    again = run(s.set_visibility(ADMIN, "public"))
    assert [(h["from"], h["value"], h["by"]) for h in again["history"]] == [("invite_only", "admin_only", d.ADMIN_EMAIL), ("admin_only", "public", d.ADMIN_EMAIL)]
    assert len(events(env, "MarketplaceVisibilityChanged")) == 2
    s._visibility = None                                                  # a fresh read comes from the server, not from memory
    assert run(s.visibility()) == "public"
    monkeypatch.setattr(get_settings(), "marketplace_unclaimed_visibility", "nonsense")
    assert d.DirectoryService._default_visibility() == "invite_only"      # a bad value in the environment falls back to the safe default


@pytest.mark.parametrize("level", ["admin_only", "invite_only"])
def test_hidden_levels_keep_unclaimed_profiles_out_of_the_directory_search_and_sitemap(level):
    env, s = world(level)
    found = run(s.search())
    assert sorted(i["trust"]["state"] for i in found["items"]) == ["created", "verified"] and found["total"] == 2 and found["unclaimed_listed"] is False
    assert found["categories"] == ["Legal"]                               # no trace of the hidden profile, not even its category
    assert run(s.search(q="northwind"))["total"] == 0 and run(s.search(trust="unclaimed"))["total"] == 0 and run(s.search(category="Consulting"))["total"] == 0
    assert SLUG not in run(s.sitemap_slugs()) and "harbour-legal-llp-york" in run(s.sitemap_slugs()) and len(run(s.sitemap_slugs())) == 2
    # Nobody without a way in can open it: anonymous, an ordinary user, or a member of another business.
    for viewer in (None, U(NEW), U(MEMBER), U(OUTSIDER)):
        with pytest.raises(NotFound):
            run(s.public_profile(SLUG, viewer))
        with pytest.raises(NotFound):
            run(s.create_intent(SLUG, viewer=viewer))
    with pytest.raises(NotFound):
        run(s.start_claim(U(NEW), SLUG))
    with pytest.raises(NotFound):
        run(s.report(SLUG, kind="correction", message="Trying to reach a hidden profile."))
    run(s.record_view(SLUG))
    assert events(env, "profile_viewed") == []                            # and looking for it leaves no trace of a view
    # Moderators see it, and their list of unclaimed profiles is complete, at every level.
    assert run(s.public_profile(SLUG, ADMIN))["trust"]["state"] == "unclaimed" and run(s.public_profile(SLUG, ADMIN))["noindex"] is True
    assert [p["slug"] for p in run(s.unclaimed_profiles(ADMIN))["items"]] == [SLUG]
    # Claimed and self-made profiles are untouched.
    assert run(s.public_profile("harbour-legal-llp-york"))["trust"]["state"] == "verified" and run(s.public_profile("harbour-legal-llp-york"))["noindex"] is False
    made = [i for i in found["items"] if i["trust"]["state"] == "created"][0]
    assert run(s.public_profile(made["slug"]))["claimed"] is True


def test_public_lists_everything_as_before():
    env, s = world("public")
    found = run(s.search())
    assert found["total"] == 3 and found["unclaimed_listed"] is True and run(s.search(trust="unclaimed"))["total"] == 1
    assert run(s.public_profile(SLUG))["claim"]["eligible"] is True and run(s.public_profile(SLUG))["noindex"] is False
    assert SLUG in run(s.sitemap_slugs()) and run(s.start_claim(U(NEW), SLUG))["status"] == "claim_started"


@pytest.mark.parametrize("level", ["admin_only", "invite_only"])
def test_an_invitation_link_opens_its_own_profile_and_the_claim_flow_until_it_expires(level):
    env, s = world(level)
    link = run(s.create_invitation(ADMIN, SLUG))["link"]
    token = link.split("invite=")[1]
    page = run(s.public_profile(SLUG, None, {"invitation": token}))
    assert page["claim"]["eligible"] is True and page["noindex"] is True
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, None, {"invitation": "not-a-token"}))
    made = run(s.create_intent(SLUG, invitation_token=token))            # before sign-in
    assert run(s.public_profile(SLUG, None, {"intent": made["intent"]}))["name"] == "Northwind Advisory Ltd"      # back from sign-in, the claim they started opens it
    claim = run(s.start_claim(U(NEW), SLUG, intent=made["intent"]))
    assert claim["status"] == "claim_started"
    assert run(s.public_profile(SLUG, U(NEW)))["name"] == "Northwind Advisory Ltd"      # their own claim keeps it open to them
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, U(MEMBER)))                           # and to nobody else
    assert verified_claim(env, user=NEW)["status"] == "verified"         # the journey completes as usual
    assert run(s.public_profile(SLUG))["trust"]["state"] == "verified"   # and once claimed, it is public
    # A token for one profile opens only that profile, and stops working when it is old.
    other = Env()
    so = svc_of(other)
    index(other, NORTHWIND, HARBOUR)
    run(so.set_visibility(ADMIN, level))
    t2 = run(so.create_invitation(ADMIN, SLUG))["link"].split("invite=")[1]
    with pytest.raises(NotFound):
        run(so.public_profile("harbour-legal-llp-york", None, {"invitation": t2}))
    other.now += d.INVITE_TTL + d.timedelta(days=1)
    with pytest.raises(NotFound):
        run(so.public_profile(SLUG, None, {"invitation": t2}))


def test_invite_only_opens_an_exact_match_and_nothing_looser():
    env, s = world("invite_only")
    for attempt in ({"name": "Northwind Advisory", "company_number": "12345678"},            # "Ltd" and case don't matter
                    {"name": "northwind advisory ltd", "website": "https://www.northwind-advisory.co.uk/about"}):
        hit = run(s.find_to_claim(**attempt))
        assert hit["found"] is True and hit["slug"] == SLUG and hit["claimed"] is False and hit["access"]
    assert run(s.public_profile(SLUG, None, {"access": hit["access"]}))["claim"]["eligible"] is True
    assert run(s.create_intent(SLUG, access=hit["access"]))["intent"]
    assert run(s.start_claim(U(NEW), SLUG, access=hit["access"]))["status"] == "claim_started"
    for miss in ({"name": "Northwind", "company_number": "12345678"},                        # part of the name
                 {"name": "Northwind Advisory Ltd", "company_number": "11111111"},           # the wrong number
                 {"name": "Harbour Legal LLP", "company_number": "12345678"},                # someone else's number
                 {"name": "Northwind Advisory Ltd", "website": "northwind.co.uk"}):
        assert run(s.find_to_claim(**miss)) == {"found": False}
    for bad in ({"name": "Northwind Advisory Ltd"}, {"name": "", "company_number": "12345678"}):
        with pytest.raises(Invalid):
            run(s.find_to_claim(**bad))                                   # a name alone is browsing, not a match
    claimed = run(s.find_to_claim(name="Harbour Legal LLP", company_number="87654321"))
    assert claimed == {"found": True, "slug": "harbour-legal-llp-york", "name": "Harbour Legal LLP", "claimed": True, "access": None}
    # The grant is for that profile only and lasts a day.
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, None, {"access": "made-up"}))
    env.now += d.LOOKUP_GRANT_TTL + d.timedelta(minutes=1)
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, None, {"access": hit["access"]}))


def test_admin_only_does_not_open_by_lookup_and_lookups_are_limited_per_caller():
    env, s = world("admin_only")
    assert run(s.find_to_claim(name="Northwind Advisory Ltd", company_number="12345678")) == {"found": False}
    assert run(s.find_to_claim(name="Harbour Legal LLP", company_number="87654321"))["claimed"] is True      # a claimed profile is public anyway
    env2, s2 = world("invite_only")
    grant = run(s2.find_to_claim(name="Northwind Advisory Ltd", company_number="12345678"))["access"]
    run(s2.set_visibility(ADMIN, "admin_only"))
    with pytest.raises(NotFound):
        run(s2.public_profile(SLUG, None, {"access": grant}))            # tightening the level closes lookup grants at once
    for _ in range(d.LOOKUPS_PER_HOUR - 1):
        run(s2.find_to_claim(name="Guess Ltd", company_number="00000001", client="ip:1.2.3.4"))
    run(s2.find_to_claim(name="Guess Ltd", company_number="00000001", client="ip:1.2.3.4"))
    with pytest.raises(RateLimited):
        run(s2.find_to_claim(name="Northwind Advisory Ltd", company_number="12345678", client="ip:1.2.3.4"))
    assert run(s2.find_to_claim(name="Guess Ltd", company_number="00000001", client="ip:9.9.9.9")) == {"found": False}      # another caller is unaffected
    env2.now += d.timedelta(hours=1, minutes=1)
    assert run(s2.find_to_claim(name="Guess Ltd", company_number="00000001", client="ip:1.2.3.4")) == {"found": False}


@pytest.mark.parametrize("level", ["admin_only", "invite_only"])
def test_an_owner_is_still_pointed_at_their_own_business_and_can_claim_it(level):
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, level))
    env.businesses["A"]["data"]["workspace_profile"].update({"registration_number": "12345678"})
    run(s.update_profile(U(OWNER), "A", dict(READY)))
    view = run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}}))
    assert [p["slug"] for p in view["possible_duplicates"]] == [SLUG]     # duplicate detection works at every level
    assert [c["slug"] for c in run(s.claimable(U(OWNER), company_number="12345678"))] == [SLUG]
    assert run(s.public_profile(SLUG, U(OWNER)))["claim"]["eligible"] is True      # so "Claim and link it" opens
    assert run(s.start_claim(U(OWNER), SLUG))["status"] == "claim_started"
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, U(OUTSIDER)))                         # a different business's owner gets nothing
    assert verified_claim(env, user=OWNER, target="A")["status"] == "verified"


def test_the_api_applies_the_level_to_anonymous_users_moderators_and_tokens(monkeypatch):
    env, s = world(None)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = dict(ADMIN)
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_optional_user] = lambda: dict(who)      # the public routes read the same sign-in
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/admin/marketplace/settings").json()["unclaimed_visibility"] == "public"
        assert client.put("/admin/marketplace/settings", json={"unclaimed_visibility": "sideways"}).status_code == 422
        changed = client.put("/admin/marketplace/settings", json={"unclaimed_visibility": "invite_only"}).json()
        assert changed["unclaimed_visibility"] == "invite_only" and changed["changed_by"] == d.ADMIN_EMAIL
        assert [p["slug"] for p in client.get("/admin/marketplace/directory/unclaimed").json()["items"]] == [SLUG]
        token = client.post(f"/admin/marketplace/directory-profiles/{SLUG}/invitations", json={}).json()["link"].split("invite=")[1]
        assert client.get(f"/marketplace/businesses/{SLUG}").status_code == 200           # the moderator
        who.clear()
        who.update({"id": NEW, "email": NEW})
        for path in ("/admin/marketplace/settings", "/admin/marketplace/directory/unclaimed"):
            assert client.get(path).status_code == 403
        assert client.put("/admin/marketplace/settings", json={"unclaimed_visibility": "public"}).status_code == 403
        assert client.get(f"/marketplace/businesses/{SLUG}").status_code == 404           # an ordinary signed-in user
        app.dependency_overrides.pop(get_current_user, None)                             # anonymous from here
        app.dependency_overrides[get_optional_user] = lambda: None
        listed = client.get("/marketplace/businesses").json()
        assert listed["unclaimed_listed"] is False and SLUG not in [i["slug"] for i in listed["items"]] and listed["total"] == 2
        assert client.get(f"/marketplace/businesses/{SLUG}").status_code == 404
        assert client.post(f"/marketplace/businesses/{SLUG}/reports", json={"kind": "correction", "message": "Probing a hidden page."}).status_code == 404
        assert client.post(f"/marketplace/directory-profiles/{SLUG}/claim-intents", json={}).status_code == 404
        assert client.get(f"/marketplace/businesses/{SLUG}?invite={token}").json()["claim"]["eligible"] is True
        assert client.post(f"/marketplace/directory-profiles/{SLUG}/claim-intents", json={"invitation": token}).status_code == 201
        assert client.get("/marketplace/businesses/harbour-legal-llp-york").status_code == 200      # claimed: unaffected
        sitemap = client.get("/marketplace/sitemap.xml")
        assert sitemap.status_code == 200 and "harbour-legal-llp-york" in sitemap.text and SLUG not in sitemap.text
        found = client.post("/marketplace/claim-lookup", json={"name": "Northwind Advisory Ltd", "company_number": "12345678"}).json()
        assert found["found"] is True and client.get(f"/marketplace/businesses/{SLUG}?access={found['access']}").status_code == 200
        assert client.post("/marketplace/claim-lookup", json={"name": "Northwind Advisory Ltd"}).status_code == 422
        assert client.post("/marketplace/claim-lookup", json={"name": "Nobody Ltd", "company_number": "1"}).json() == {"found": False}
        for _ in range(d.LOOKUPS_PER_HOUR):
            last = client.post("/marketplace/claim-lookup", json={"name": "Guess Ltd", "company_number": "2"})
        assert last.status_code == 429
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_optional_user, None)


def test_moderators_see_each_unclaimed_profiles_effective_state_and_can_act_on_a_row():
    env = Env()
    s = svc_of(env)
    thin = {"name": "Thin Record Ltd", "company_number": "22222222", "source": {"provider": "Companies House", "record_id": "22222222"}}
    index(env, NORTHWIND, HARBOUR, thin)
    run(s.resolve_report(ADMIN, run(s.report("harbour-legal-llp-york", kind="unlist", message="Please remove this page."))["id"], action="suppress", reason="Asked to be removed."))
    state = lambda: {p["name"]: p["public_state"] for p in run(s.unclaimed_profiles(ADMIN))["items"]}      # noqa: E731
    assert state() == {"Northwind Advisory Ltd": "Ready \u00b7 public", "Harbour Legal LLP": "Suppressed", "Thin Record Ltd": "Unpublished (quality)"}
    run(s.set_visibility(ADMIN, "invite_only"))
    assert state()["Northwind Advisory Ltd"] == "Ready \u00b7 hidden (invite only)" and run(s.unclaimed_profiles(ADMIN))["unclaimed_visibility"] == "invite_only"
    run(s.set_visibility(ADMIN, "admin_only"))
    assert state() == {"Northwind Advisory Ltd": "Ready \u00b7 hidden (moderators only)", "Harbour Legal LLP": "Suppressed", "Thin Record Ltd": "Unpublished (quality)"}
    # Suppress and restore, each with a reason that is kept.
    with pytest.raises(Invalid):
        run(s.moderate_profile(ADMIN, SLUG, action="suppress", reason=""))
    with pytest.raises(Forbidden):
        run(s.moderate_profile(U(OWNER), SLUG, action="suppress", reason="Not a moderator."))
    assert run(s.moderate_profile(ADMIN, SLUG, action="suppress", reason="Duplicate of another record."))["public_state"] == "Suppressed"
    with pytest.raises(NotFound):
        run(s.public_profile(SLUG, ADMIN))                               # suppressed is gone for everyone
    back = run(s.moderate_profile(ADMIN, SLUG, action="restore", reason="Suppressed by mistake."))
    assert back["publication"] == "published" and back["public_state"] == "Ready \u00b7 hidden (moderators only)"
    with pytest.raises(d.Conflict):
        run(s.moderate_profile(ADMIN, SLUG, action="restore", reason="It isn't suppressed."))
    assert len(events(env, "DirectoryProfileRestored")) == 1
    # Sources, field by field.
    src = run(s.profile_sources(ADMIN, SLUG))
    assert {"field": "name", "provider": "Companies House", "record_id": "12345678", "retrieved_at": "2026-09-28T10:00:00Z", "previous": None} in src["fields"]
    assert src["imports"][0]["provider"] == "Companies House" and "contact_email" not in str(src)
    with pytest.raises(Forbidden):
        run(s.profile_sources(U(OWNER), SLUG))
    # A link copied to share by hand can be made again; emailed invitations keep their 30-day gap.
    first = run(s.create_invitation(ADMIN, SLUG, by_hand=True))["link"]
    second = run(s.create_invitation(ADMIN, SLUG, by_hand=True))["link"]
    assert first != second and run(s.public_profile(SLUG, None, {"invitation": second.split("invite=")[1]}))["name"] == "Northwind Advisory Ltd"
    with pytest.raises(d.Conflict) as e:
        run(s.create_invitation(ADMIN, SLUG))
    assert e.value.code == "too_soon"
