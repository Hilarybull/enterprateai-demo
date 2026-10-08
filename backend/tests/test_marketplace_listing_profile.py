"""Marketplace Index & Claim QA round 1: no private contact details on public pages (M-1), one
public profile per business however it joined (M-2), and development-only moderators."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Invalid, NotFound
from app.modules.marketplace.service import _build_listing_item
from app.shared.auth.deps import get_current_user
from test_agent import OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NORTHWIND, U, events, index, svc_of, verified_claim

READY = {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing", "Strategy"], "website": "apex.test"}


def listing(env, business="A"):
    return _build_listing_item({"id": business, "user_id": OWNER, "data": env.businesses[business]["data"], "updated_at": env.now.isoformat()})


def ready(env, s, business="A", user=OWNER):
    run(s.update_profile(U(user), business, dict(READY)))
    run(s.update_preferences(U(user), business, {"enquiries": {"enabled": True}}))
    return run(s.activate(U(user), business))


def test_m1_public_pages_never_show_the_account_or_workspace_email():
    env = Env()
    s = svc_of(env)
    env.businesses["A"]["data"]["workspace_profile"].update({"email": OWNER, "phone_number": "07700 900123"})
    ready(env, s)
    item = listing(env)
    assert item["email"] == "" and item["phone_number"] is None and item["contact_method"] == "enquiry_form"
    slug = run(s.business_profile(U(OWNER), "A"))["directory"]["slug"]
    public = run(s.public_profile(slug))
    assert public["contact"] == {"method": "enquiry_form", "email": None, "phone": None}
    for text in (json.dumps(item), json.dumps(public), json.dumps(run(s.search()))):
        assert OWNER not in text and "hello@apex.test" not in text and "07700" not in text
    # Choosing "by email" is not enough: the owner has to enter the address to show.
    with pytest.raises(Invalid) as e:
        run(s.update_profile(U(OWNER), "A", {"contact_preference": "email"}))
    assert set(e.value.errors) == {"public_email"}
    with pytest.raises(Invalid) as e:
        run(s.update_profile(U(OWNER), "A", {"contact_preference": "phone", "public_phone": "12"}))
    assert set(e.value.errors) == {"public_phone"}
    run(s.update_profile(U(OWNER), "A", {"contact_preference": "email", "public_email": "Enquiries@Apex.test"}))
    assert listing(env)["email"] == "enquiries@apex.test" and listing(env)["phone_number"] is None
    assert run(s.public_profile(slug))["contact"] == {"method": "email", "email": "enquiries@apex.test", "phone": None}
    # Back to the enquiry form: the address is kept for the owner but no longer shown.
    run(s.update_profile(U(OWNER), "A", {"contact_preference": "enquiry_form"}))
    assert listing(env)["email"] == "" and run(s.public_profile(slug))["contact"]["email"] is None
    assert run(s.business_profile(U(OWNER), "A"))["profile"]["public_email"] == "enquiries@apex.test"


def test_m2_activating_a_business_that_signed_up_directly_gives_it_one_public_profile():
    env = Env()
    s = svc_of(env)
    before = run(s.business_profile(U(OWNER), "A"))
    assert before["directory"] is None and run(s.search())["total"] == 0
    live = ready(env, s)
    assert live["is_published"] is True
    directory = live["directory"]
    assert directory["trust"]["label"] == "Created on EnterprateAI \u00b7 not verified" and directory["origin"] == "created" and directory["public"] is True
    slug = directory["slug"]
    assert slug == "apex-consulting" and env.businesses["A"]["data"]["marketplace"]["directory_profile_id"] == directory["id"]
    assert live["activation"]["counts_as_activated_claim"] is False       # created, not verified: the north-star count stays honest
    found = run(s.search())
    assert found["total"] == 1 and found["items"][0]["slug"] == slug and found["items"][0]["trust"]["state"] == "created"
    assert run(s.search(trust="created"))["total"] == 1 and run(s.search(trust="claimed"))["total"] == 0 and run(s.search(trust="unclaimed"))["total"] == 0
    assert run(s.search(q="pricing"))["total"] == 1 and run(s.search(open_for="enquiries"))["total"] == 1 and run(s.search(open_for="rfqs"))["total"] == 0
    public = run(s.public_profile(slug, U(OUTSIDER)))
    assert public["name"] == "Apex Consulting" and public["claimed"] is True and public["claim"] == {"eligible": False} and public["owner_controls"] is False
    assert public["description"] == READY["description"] and public["location"] == "Leeds and remote" and public["service_tags"] == ["Pricing", "Strategy"]
    assert public["website"] == "apex.test" and public["listing_id"] == "A" and public["opportunities"]["enquiries"] is True
    assert [o["name"] for o in public["offerings"]] == ["Strategy Workshop", "Financial Review", "Unpriced Service"]
    assert run(s.public_profile(slug, U(OWNER)))["owner_controls"] is True
    # The older listing is the same profile: same description, website and services.
    item = listing(env)
    assert item["about_company"] == READY["description"] and item["website"] == "apex.test" and item["service_area"] == "Leeds and remote"
    assert [x["service_name"] for x in item["services"]] == ["Pricing", "Strategy"] and item["directory_profile_id"] == directory["id"]
    # Saving and activating again never makes a second profile.
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold, and keep them."}))
    run(s.activate(U(OWNER), "A"))
    assert len(s.store.rows["profiles"]) == 1 and len(events(env, "DirectoryProfileCreated")) == 1
    assert run(s.public_profile(slug))["description"].endswith("and keep them.")
    # Unpublishing removes it from both.
    off = run(s.activate(U(OWNER), "A", publish=False))
    assert off["is_published"] is False and off["directory"]["public"] is False
    assert run(s.search())["total"] == 0 and listing(env) is None
    with pytest.raises(NotFound):
        run(s.public_profile(slug))
    with pytest.raises(NotFound):
        run(s.start_claim(U(OUTSIDER), slug))
    # Publishing again brings back the same address.
    again = run(s.activate(U(OWNER), "A"))
    assert again["directory"]["slug"] == slug and run(s.search())["total"] == 1 and len(s.store.rows["profiles"]) == 1


def test_m2_the_older_publish_switch_keeps_the_directory_in_step_and_a_lost_link_is_found_again():
    env = Env()
    s = svc_of(env)
    data = env.businesses["A"]["data"]
    data["marketplace"] = {"is_active": True, "published_at": env.now.isoformat()}      # published through the older listing switch
    made = run(s.sync_listing("A", actor=OWNER))
    assert made["data"]["claim_state"] == "created" and run(s.search())["total"] == 1
    data["marketplace"].pop("directory_profile_id")                       # the pointer is lost
    assert run(s.sync_listing("A"))["id"] == made["id"] and len(s.store.rows["profiles"]) == 1
    assert data["marketplace"]["directory_profile_id"] == made["id"]
    data["marketplace"]["is_active"] = False
    run(s.sync_listing("A"))
    assert run(s.search())["total"] == 0
    assert run(s.sync_listing("B")) is None and len(s.store.rows["profiles"]) == 1      # never published: nothing is created
    assert run(s.business_profile(U(OUTSIDER), "B"))["directory"] is None                  # and looking at the settings doesn't create one
    # A business published before the directory existed is added the first time its owner opens the page.
    env.businesses["B"]["data"]["marketplace"] = {"is_active": True}
    opened = run(s.business_profile(U(OUTSIDER), "B"))
    assert opened["directory"]["origin"] == "created" and opened["directory"]["public"] is True and run(s.search())["total"] == 1
    assert len(s.store.rows["profiles"]) == 2


def test_m2_a_typed_in_website_or_number_does_not_take_over_a_sourced_record():
    env = Env()
    s = svc_of(env)
    env.businesses["A"]["data"]["workspace_profile"].update({"registration_number": "12345678", "website": "northwind-advisory.co.uk"})
    ready(env, s)
    made = index(env)[0]
    assert made["result"] == "created" and made["slug"] == "northwind-advisory-ltd-leeds"      # the sourced record gets its own profile, to be claimed with proof
    assert {i["trust"]["state"] for i in run(s.search())["items"]} == {"created", "unclaimed"}
    assert [c["slug"] for c in run(s.claimable(U(OWNER), website="northwind-advisory.co.uk", company_number="12345678"))] == ["northwind-advisory-ltd-leeds"]


def test_m2_claiming_the_sourced_profile_folds_the_self_made_one_into_it():
    env = Env()
    s = svc_of(env)
    own = ready(env, s)["directory"]
    index(env)
    started = run(s.start_claim(U(OWNER), "northwind-advisory-ltd-leeds"))
    assert [(c["business_id"], c["already_linked"]) for c in started["candidates"] if c["business_id"] == "A"] == [("A", False)]
    done = verified_claim(env, user=OWNER, target="A")
    assert done["status"] == "verified" and done["business_id"] == "A"
    claimed = run(s.business_profile(U(OWNER), "A"))["directory"]
    assert claimed["slug"] == "northwind-advisory-ltd-leeds" and claimed["trust"]["state"] == "verified" and claimed["origin"] == "indexed"
    found = run(s.search())
    assert found["total"] == 1 and found["items"][0]["trust"]["state"] == "verified"      # one business, one profile
    assert run(s.public_profile(own["slug"]))["canonical_slug"] == "northwind-advisory-ltd-leeds"      # the old address still works
    assert run(s.public_profile(own["id"]))["canonical_slug"] == "northwind-advisory-ltd-leeds"
    assert len(events(env, "DirectoryProfileMerged")) == 1
    run(s.activate(U(OWNER), "A"))
    assert run(s.search())["total"] == 1 and sum(1 for p in s.store.rows["profiles"].values() if p["data"]["publication"] == "published") == 1


def test_a_challenge_to_a_self_made_profile_is_reviewed_and_leaves_it_as_it_was_when_rejected():
    env = Env()
    s = svc_of(env)
    slug = ready(env, s)["directory"]["slug"]
    claim = run(s.start_claim(U(OUTSIDER), slug))
    assert claim["challenge"] is True
    claim = run(s.confirm_match(U(OUTSIDER), claim["id"], "new"))
    claim = run(s.start_verification(U(OUTSIDER), claim["id"], method="email_domain", email="boss@apex.test"))
    claim = run(s.complete_verification(U(OUTSIDER), claim["id"], claim["verification"]["id"], s.sent_codes[-1][1]))
    assert claim["status"] == "disputed" and run(s.public_profile(slug))["trust"]["state"] == "created"      # a person decides; nothing transfers or changes publicly on a code alone
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["trust"]["state"] == "disputed"
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="No evidence of authority."))
    assert run(s.public_profile(slug))["trust"]["state"] == "created"     # not upgraded to owner-verified by a failed challenge


def test_development_moderators_are_extra_and_never_apply_in_production(monkeypatch):
    import app.core.config as config
    qa = {"id": "qa-1", "email": "QA@Example.test"}
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(environment="development", marketplace_moderators="qa@example.test, other@example.test"))
    assert d.DirectoryService.is_admin(qa) and d.DirectoryService.is_admin(ADMIN) and not d.DirectoryService.is_admin(U(OWNER)) and not d.DirectoryService.is_admin(None)
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(environment="production", marketplace_moderators="qa@example.test"))
    assert not d.DirectoryService.is_admin(qa) and d.DirectoryService.is_admin(ADMIN)


def test_the_api_says_who_is_a_moderator_and_public_listings_stay_free_of_private_contacts(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = {"id": OWNER, "email": OWNER}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/admin/marketplace/access").json() == {"moderator": False}
        monkeypatch.setattr(d, "_moderators", lambda: {OWNER.lower()})
        assert client.get("/admin/marketplace/access").json() == {"moderator": True}
        assert client.post("/admin/marketplace/directory/index", json={"records": [NORTHWIND]}).json()["summary"]["created"] == 1
        assert client.get("/admin/marketplace/funnel").status_code == 200
        env.businesses["A"]["data"]["workspace_profile"]["email"] = OWNER
        assert client.patch("/businesses/A/marketplace-profile", json={"changes": dict(READY)}).status_code == 200
        assert client.patch("/businesses/A/marketplace-opportunity-preferences", json={"changes": {"enquiries": {"enabled": True}}}).status_code == 200
        live = client.post("/businesses/A/marketplace-profile/activate", json={"publish": True}).json()
        slug = live["directory"]["slug"]
        bad = client.patch("/businesses/A/marketplace-profile", json={"changes": {"contact_preference": "email"}})
        assert bad.status_code == 422 and set(bad.json()["detail"]["errors"]) == {"public_email"}
        app.dependency_overrides.pop(get_current_user, None)              # anonymous from here
        page = client.get(f"/marketplace/businesses/{slug}")
        assert page.status_code == 200 and page.json()["trust"]["label"] == "Created on EnterprateAI \u00b7 not verified"
        listed = client.get("/marketplace/businesses").text
        assert OWNER not in page.text and OWNER not in listed and "hello@apex.test" not in page.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
