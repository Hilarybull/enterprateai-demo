"""Marketplace Business Index and Claim (PRD-MKT-GTM-001): the index as a public projection,
claim and verification, linking to exactly one canonical business, profile and opportunity
settings, moderation, invitations, and the acceptance criteria AC-01 to AC-30."""
import copy
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import dashboard as dash
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound, RateLimited, service_for
from app.modules.marketplace.service import _build_listing_item
from app.shared.auth.deps import get_current_user
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run

ADMIN = {"id": "admin-1", "email": d.ADMIN_EMAIL}
U = lambda who: {"id": who, "email": who}      # noqa: E731
NEW = "newcomer@northwind.test"

NORTHWIND = {
    "name": "Northwind Advisory Ltd", "company_number": "12345678", "category": "Consulting", "service_tags": ["Strategy", "Pricing"],
    "location": "Leeds", "website": "https://www.northwind-advisory.co.uk", "contact_email": "hello@northwind-advisory.co.uk",
    "description": "Independent advisers helping small firms set prices and plan growth across the north of England.",
    "source": {"provider": "Companies House", "record_id": "12345678", "retrieved_at": "2026-09-28T10:00:00Z"},
}


def svc_of(env):
    s = service_for(env.orch)
    env.meter.plans.setdefault(NEW, "explorer")
    return s


def index(env, *records):
    return run(svc_of(env).index_records([copy.deepcopy(r) for r in (records or (NORTHWIND,))]))["results"]


def verified_claim(env, user=NEW, slug="northwind-advisory-ltd-leeds", target="new", email="owner@northwind-advisory.co.uk"):
    s = svc_of(env)
    claim = run(s.start_claim(U(user), slug))
    claim = run(s.confirm_match(U(user), claim["id"], target))
    claim = run(s.start_verification(U(user), claim["id"], method="email_domain", email=email))
    code = s.sent_codes[-1][1]
    return run(s.complete_verification(U(user), claim["id"], claim["verification"]["id"], code))


def events(env, kind=None):
    rows = list(svc_of(env).store.rows["events"].values())
    return [e for e in rows if kind is None or e["kind"] == kind]


# ══ Index ═════════════════════════════════════════════════════════════════════

def test_ac01_ac02_an_indexed_profile_is_a_public_projection_and_nothing_else():
    env = Env()
    before = set(env.businesses)
    out = index(env)[0]
    assert (out["result"], out["publication"], out["band"], out["slug"]) == ("created", "published", "high", "northwind-advisory-ltd-leeds")
    assert set(env.businesses) == before                                  # no business, no account, no membership
    s = svc_of(env)
    p = run(s.public_profile(out["slug"]))
    assert p["trust"] == d.TRUST["unclaimed"] and p["trust"]["label"] == "Not yet claimed" and p["claimed"] is False
    assert p["source_basis"].startswith("This profile is based on public sources") and p["sources"] == ["Companies House"]
    assert p["legal_identifier"] == "12345678" and p["claim"] == {"eligible": True, "cta": "Claim this Business for Free"}
    assert p["opportunity_note"] == "Claim to set opportunity preferences" and not any(p["opportunities"].values())
    assert "hello@northwind-advisory.co.uk" not in json.dumps(p) and "contact_email" not in p      # the contact route is never public
    row = s.store.rows["profiles"][out["id"]]
    assert row["data"]["provenance"]["website"] == {"provider": "Companies House", "record_id": "12345678", "retrieved_at": "2026-09-28T10:00:00Z"}
    assert row["data"]["linked_business_id"] is None and len(s.store.rows["snapshots"]) == 1


def test_the_same_business_is_never_indexed_twice_and_rules_decide_what_is_published():
    env = Env()
    first = index(env)[0]
    again = index(env, {**NORTHWIND, "name": "Northwind Advisory Limited", "description": NORTHWIND["description"] + " Updated."})[0]
    assert again["result"] == "updated" and again["id"] == first["id"] and again["slug"] == first["slug"]      # same number: same profile, same address
    by_domain = index(env, {**NORTHWIND, "company_number": None, "name": "Northwind", "source": {"provider": "Web", "record_id": "nw"}})[0]
    assert by_domain["id"] == first["id"]
    s = svc_of(env)
    assert len(s.store.rows["profiles"]) == 1 and len(s.store.rows["snapshots"]) == 3
    results = index(env,
                    {"name": "Dormant Shell Ltd", "company_number": "00000001", "business_status": "dissolved", "source": {"provider": "CH", "record_id": "1"}},
                    {"name": "No Source Ltd", "category": "Consulting"},
                    {"name": "Lucky Spins", "category": "Gambling", "source": {"provider": "CH", "record_id": "2"}},
                    {"name": "Sparse Trading", "location": "York", "category": "Retail", "source": {"provider": "CH", "record_id": "3"}},
                    {"name": "Bare Minimum", "source": {"provider": "CH", "record_id": "4"}},
                    {"name": ""})
    assert [r["result"] for r in results] == ["excluded", "excluded", "excluded", "created", "created", "invalid"]
    assert (results[3]["publication"], results[3]["band"]) == ("noindex", "low") and results[4]["publication"] == "unpublished"
    assert "Business status is dissolved." in results[0]["reasons"]
    found = run(s.search())
    assert [i["name"] for i in found["items"]] == ["Northwind Advisory Limited"]            # only what passed the quality rules
    assert run(s.public_profile("sparse-trading-york"))["noindex"] is True                  # reachable by link, not for search engines
    with pytest.raises(NotFound):
        run(s.public_profile("bare-minimum"))
    assert d.assess_index_record(NORTHWIND) == d.assess_index_record(copy.deepcopy(NORTHWIND))      # deterministic


def test_search_filters_and_treats_unclaimed_as_a_state_not_a_score():
    env = Env()
    index(env, NORTHWIND, {**NORTHWIND, "name": "Harbour Legal LLP", "company_number": "87654321", "category": "Legal", "location": "Bristol",
                           "website": "https://harbourlegal.co.uk", "service_tags": ["Contracts"], "source": {"provider": "CH", "record_id": "87654321"}})
    s = svc_of(env)
    assert run(s.search())["total"] == 2 and run(s.search())["categories"] == ["Consulting", "Legal"]
    assert [i["name"] for i in run(s.search(q="pricing"))["items"]] == ["Northwind Advisory Ltd"]
    assert [i["name"] for i in run(s.search(category="legal"))["items"]] == ["Harbour Legal LLP"]
    assert [i["name"] for i in run(s.search(location="leeds"))["items"]] == ["Northwind Advisory Ltd"]
    assert run(s.search(trust="claimed"))["total"] == 0 and run(s.search(open_for="enquiries"))["total"] == 0
    verified_claim(env)
    assert [i["name"] for i in run(s.search(trust="claimed"))["items"]] == ["Northwind Advisory Ltd"]
    assert [i["name"] for i in run(s.search(trust="unclaimed"))["items"]] == ["Harbour Legal LLP"]
    assert run(s.search())["items"][0]["trust"]["label"] == "Owner-verified"                # claimed first


# ══ Claim, verification and linking ═══════════════════════════════════════════

def test_ac03_ac04_ac05_ac20_a_claim_survives_sign_in_verifies_authority_and_links_one_business_once():
    env = Env()
    index(env)
    s = svc_of(env)
    intent = run(s.create_intent("northwind-advisory-ltd-leeds", source="search", opportunity_ref=None))      # before sign-in
    claim = run(s.start_claim(U(NEW), "northwind-advisory-ltd-leeds", intent=intent["intent"]))                # after sign-in
    assert (claim["status"], claim["next_step"], claim["profile"]["name"]) == ("claim_started", "match", "Northwind Advisory Ltd")
    assert s.store.rows["claims"][claim["id"]]["data"]["acquisition_source"] == "search"
    assert run(s.start_claim(U(NEW), "northwind-advisory-ltd-leeds"))["id"] == claim["id"]                     # resumes the same claim
    assert claim["candidates"] == [] and [m["method"] for m in claim["methods"]] == ["email_domain", "manual"]
    with pytest.raises(Conflict):
        run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="owner@northwind-advisory.co.uk"))      # match first
    claim = run(s.confirm_match(U(NEW), claim["id"], "new"))
    assert claim["next_step"] == "verification"
    # A registered number, or any address the claimant likes, proves nothing.
    for method, kw, field in (("registry_number", {}, "method"), ("email_domain", {"email": "someone@gmail.com"}, "email"),
                              ("email_domain", {"email": "me@other-company.co.uk"}, "email"), ("email_domain", {"email": "not-an-email"}, "email"),
                              ("manual", {"note": "trust me"}, "note")):
        with pytest.raises(Invalid) as e:
            run(s.start_verification(U(NEW), claim["id"], method=method, **kw))
        assert field in e.value.errors
    claim = run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="Owner@Northwind-Advisory.co.uk"))
    v = claim["verification"]
    assert (claim["status"], v["method"], v["destination"]) == ("verification_pending", "email_domain", "o•••@northwind-advisory.co.uk")
    address, code = s.sent_codes[-1]
    assert address == "owner@northwind-advisory.co.uk" and len(code) == 6 and code not in json.dumps(s.store.rows["verifications"])      # only a hash is kept
    with pytest.raises(Invalid) as e:
        run(s.complete_verification(U(NEW), claim["id"], v["id"], "000000" if code != "000000" else "111111"))
    assert "isn't right" in e.value.errors["code"] and set(env.businesses) == {"A", "B"}
    before = set(env.businesses)
    done = run(s.complete_verification(U(NEW), claim["id"], v["id"], code))
    assert (done["status"], done["next_step"]) == ("verified", "profile_review")
    created = set(env.businesses) - before
    assert len(created) == 1 and done["business_id"] in created
    business = env.businesses[done["business_id"]]
    assert business["owner"] == NEW and business["data"]["marketplace"]["directory_profile_id"] == done["profile"]["id"]
    assert business["data"]["acquisition"]["source"] == "marketplace_claim" and business["data"]["acquisition"]["claim_id"] == claim["id"]
    assert business["data"]["workspace_profile"]["company_name"] == "Northwind Advisory Ltd"            # known facts are not asked for again
    profile = s.store.rows["profiles"][done["profile"]["id"]]["data"]
    assert (profile["linked_business_id"], profile["claim_state"]) == (done["business_id"], "verified")
    # Retries change nothing: no second business, no second link, no second membership.
    again = run(s.complete_verification(U(NEW), claim["id"], v["id"], code))
    run(s._approve(s.store.rows["claims"][claim["id"]], actor=NEW, method="email_domain", reason="retry"))
    assert again["business_id"] == done["business_id"] and set(env.businesses) - before == created
    assert len(events(env, "MarketplaceProfileLinked")) == 1 and len(events(env, "BusinessClaimVerified")) == 1
    assert run(s.public_profile("northwind-advisory-ltd-leeds"))["trust"]["label"] == "Owner-verified"


def test_codes_expire_and_run_out_of_attempts_and_sends_are_limited():
    env = Env()
    index(env)
    s = svc_of(env)
    claim = run(s.confirm_match(U(NEW), run(s.start_claim(U(NEW), "northwind-advisory-ltd-leeds"))["id"], "new"))
    claim = run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="a@northwind-advisory.co.uk"))
    code = s.sent_codes[-1][1]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(d.CODE_ATTEMPTS):
        with pytest.raises(Invalid):
            run(s.complete_verification(U(NEW), claim["id"], claim["verification"]["id"], wrong))
    with pytest.raises(Invalid) as e:                                     # even the right code no longer works
        run(s.complete_verification(U(NEW), claim["id"], claim["verification"]["id"], code))
    assert "expired" in e.value.errors["code"] or "Too many" in e.value.errors["code"]
    claim = run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="a@northwind-advisory.co.uk"))      # retry keeps the claim
    env.now += d.CODE_TTL + timedelta(minutes=1)
    with pytest.raises(Invalid) as e:
        run(s.complete_verification(U(NEW), claim["id"], claim["verification"]["id"], s.sent_codes[-1][1]))
    assert "expired" in e.value.errors["code"]
    env.now += timedelta(hours=1, minutes=1)
    for _ in range(d.CODE_SENDS_PER_HOUR):
        run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="a@northwind-advisory.co.uk"))
    with pytest.raises(RateLimited):
        run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="a@northwind-advisory.co.uk"))
    assert run(s.get_claim(U(NEW), claim["id"]))["status"] == "verification_pending" and set(env.businesses) == {"A", "B"}


def test_ac06_an_existing_business_is_linked_not_duplicated_and_its_private_data_stays_private():
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"].update({"registration_number": "12345678", "about_company": "Private working notes about Apex."})
    env.fin["invoices"].append({"id": "i1", "customer_name": "Secret Customer Ltd", "total_amount": 9000, "status": "paid"})
    index(env)
    s = svc_of(env)
    claim = run(s.start_claim(U(OWNER), "northwind-advisory-ltd-leeds"))
    assert claim["candidates"] == [{"business_id": "A", "name": "Apex Consulting", "location": "", "likely_match": True, "already_linked": False}]
    with pytest.raises(NotFound):                                         # someone else's business can't be chosen
        run(s.confirm_match(U(OWNER), claim["id"], "B"))
    done = verified_claim(env, user=OWNER, target="A", email="owner@northwind-advisory.co.uk")
    assert done["business_id"] == "A" and set(env.businesses) == {"A", "B"}          # no duplicate business
    assert env.businesses["A"]["data"]["marketplace"]["directory_profile_id"] == done["profile"]["id"]
    public = json.dumps(run(s.public_profile("northwind-advisory-ltd-leeds")))
    for private in ("Secret Customer", "9000", "hello@apex.test", "invoices", "financials"):
        assert private not in public
    # One business, one profile: the same business can't take a second one.
    index(env, {**NORTHWIND, "name": "Second Co Ltd", "company_number": "22222222", "website": "https://second-co.co.uk", "source": {"provider": "CH", "record_id": "22222222"}})
    second = run(s.start_claim(U(OWNER), "second-co-ltd-leeds"))
    assert second["candidates"][0]["already_linked"] is True
    with pytest.raises(Conflict) as e:
        run(s.confirm_match(U(OWNER), second["id"], "A"))
    assert e.value.code == "business_already_linked"
    # Signup detection: "We found an existing Marketplace profile that may be your business."
    assert [c["name"] for c in run(s.claimable(U(OUTSIDER), company_number="22222222"))] == ["Second Co Ltd"]
    assert run(s.claimable(U(OUTSIDER), name="Second Co Ltd")) == []     # a name alone is too weak to suggest
    assert run(s.claimable(U(OUTSIDER), company_number="12345678")) == []     # already claimed


def test_ac07_ac08_ac09_ac10_a_second_claimed_business_is_separate_and_uses_the_same_dashboard_rules():
    env = Env()
    env.meter.plans[OWNER] = "decision_engine"
    index(env, NORTHWIND, {**NORTHWIND, "name": "Second Co Ltd", "company_number": "22222222", "website": "https://second-co.co.uk",
                           "source": {"provider": "CH", "record_id": "22222222"}})
    a_before = copy.deepcopy(env.businesses["A"]["data"])
    one = verified_claim(env, user=OWNER, target="new")
    two = verified_claim(env, user=OWNER, slug="second-co-ltd-leeds", target="new", email="x@second-co.co.uk")
    assert len({one["business_id"], two["business_id"], "A"}) == 3
    assert env.businesses["A"]["data"] == a_before                        # nothing merged into the existing business
    assert [b["id"] for b in run(env.orch.rt.business.owned_by(OWNER))] == ["A", one["business_id"], two["business_id"]]
    # The claimed business enters the ordinary dashboard, composed by the ordinary rules: nothing marks it "operating" or "multi-entity".
    built = run(dash.build_dashboard(env.orch, OWNER, one["business_id"]))
    direct = Env()
    direct.businesses["A"]["data"] = {"settings": {"currency": "GBP"}, "workspace_profile": copy.deepcopy(env.businesses[one["business_id"]]["data"]["workspace_profile"])}
    homepage = run(dash.build_dashboard(direct.orch, OWNER, "A"))
    assert built["context"]["business_stage"] == homepage["context"]["business_stage"] == "idea"
    assert [c["key"] for c in built["action_cards"]] == [c["key"] for c in homepage["action_cards"]]
    assert built["context"]["account_scope"] == "single_business"
    assert run(dash.build_dashboard(env.orch, OWNER, "A"))["context"]["business_stage"] == "pre_launch"      # A keeps its own stage
    # Changing the stage changes the view, not the business or its profile.
    env.businesses[one["business_id"]]["data"]["dashboard_stage"] = {"stage": "operating"}
    assert run(dash.build_dashboard(env.orch, OWNER, one["business_id"]))["context"]["business_stage"] == "operating"
    s = svc_of(env)
    assert s.store.rows["profiles"][one["profile"]["id"]]["data"]["linked_business_id"] == one["business_id"] and len(env.businesses) == 4


def test_ac11_ac27_only_authorised_people_see_a_claim_or_change_a_profile():
    env = Env()
    index(env)
    s = svc_of(env)
    done = verified_claim(env, user=OWNER, target="A")
    for call in (s.get_claim(U(OUTSIDER), done["id"]), s.cancel_claim(U(OUTSIDER), done["id"]), s.confirm_match(U(OUTSIDER), done["id"], "new"),
                 s.complete_handoff(U(OUTSIDER), done["id"]), s.get_claim(U(OWNER), "not-a-uuid"),
                 s.business_profile(U(OUTSIDER), "A"), s.update_profile(U(OUTSIDER), "A", {"description": "Taken over"}),
                 s.update_preferences(U(OUTSIDER), "A", {"enquiries": {"enabled": True}}), s.activate(U(OUTSIDER), "A")):
        with pytest.raises(NotFound):
            run(call)
    assert run(s.business_profile(U(MEMBER), "A"))["can_edit"] is False   # a member may look
    with pytest.raises(Forbidden):                                        # but not change the public profile without the authority to approve
        run(s.update_profile(U(MEMBER), "A", {"description": "A member's edit of the public profile"}))
    env.store.policies["A"]["member_can_approve"] = True
    assert run(s.my_claims(U(OUTSIDER))) == [] and [c["id"] for c in run(s.my_claims(U(OWNER)))] == [done["id"]]
    assert run(s.public_profile("northwind-advisory-ltd-leeds", U(OUTSIDER)))["owner_controls"] is False
    mine = run(s.public_profile("northwind-advisory-ltd-leeds", U(OWNER)))
    assert mine["owner_controls"] is True and mine["business_id"] == "A"
    for call in (s.review_queue(U(OWNER)), s.review_decision(U(OWNER), done["id"], decision="revoke", reason="because I can"),
                 s.create_invitation(U(OWNER), "northwind-advisory-ltd-leeds"), s.funnel(U(OWNER))):
        with pytest.raises(Forbidden):
            run(call)


# ══ Profile, offerings, opportunity preferences, activation ═══════════════════

def test_ac12_ac13_ac14_profile_settings_publish_catalogue_offerings_and_reuse_the_proposal_writer():
    env = Env()
    index(env)
    s = svc_of(env)
    done = verified_claim(env, user=OWNER, target="A")
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["directory"]["trust"]["state"] == "verified" and view["directory"]["sourced"]["name"] == "Northwind Advisory Ltd"
    assert [(o["name"], o["published"]) for o in view["offerings"]] == [("Strategy Workshop", True), ("Financial Review", True), ("Unpriced Service", True)]
    assert view["activation"]["ready"] is False and [i["key"] for i in view["activation"]["items"] if not i["done"]] == ["description", "service_area", "opportunity"]
    with pytest.raises(Invalid) as e:
        run(s.activate(U(OWNER), "A"))
    assert set(e.value.errors) == {"description", "service_area", "opportunity"}
    with pytest.raises(Invalid) as e:
        run(s.update_profile(U(OWNER), "A", {"colour": "blue", "website": "not a site"}))
    assert set(e.value.errors) == {"colour", "website"}
    saved = run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing", "Strategy"],
                                                 "published_offering_ids": ["p1"], "contact_preference": "enquiry_form"}, revision=0, claim_id=done["id"]))
    assert saved["profile"]["revision"] == 1 and [o["id"] for o in saved["offerings"] if o["published"]] == ["p1"]
    products = env.businesses["A"]["data"]["catalogue"]["products"]
    assert [p.get("marketplace_listed") for p in products] == [True, False, False] and len(products) == 3      # the Catalogue's own records: marked, not copied
    with pytest.raises(Conflict) as e:
        run(s.update_profile(U(OWNER), "A", {"description": "A stale edit from another tab."}, revision=0))
    assert e.value.code == "stale_revision" and e.value.detail == {"revision": 1}
    with pytest.raises(Invalid):
        run(s.update_preferences(U(OWNER), "A", {"proposals": {"enabled": True, "accepted_modes": ["anything_goes"]}}))
    prefs = run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}, "rfqs": {"enabled": True, "categories": ["Consulting"], "service_areas": ["Leeds"]},
                                                     "proposals": {"enabled": True, "accepted_modes": ["general", "solicited_general"]}}, claim_id=done["id"]))
    assert prefs["preferences"]["rfqs"] == {"enabled": True, "categories": ["Consulting"], "service_areas": ["Leeds"]}
    data = env.businesses["A"]["data"]
    assert data["proposal_preferences"]["enabled"] is True and data["proposal_preferences"]["accepted_modes"] == ["general", "solicited_general"]
    assert data["marketplace"]["open_for_proposals"] is True              # the fields Proposal Intelligence and the listing badge already read
    assert "proposals" not in data["marketplace"]["opportunity_preferences"]      # no second proposal status model
    assert data["marketplace"].get("is_active") is not True               # settings alone don't publish
    live = run(s.activate(U(OWNER), "A"))
    assert live["is_published"] is True and live["activation"]["counts_as_activated_claim"] is True
    activated = events(env, "MarketplaceProfileActivated")
    assert len(activated) == 1 and activated[0]["data"]["activated_claimed_business"] is True and activated[0]["data"]["modes"] == ["enquiries", "rfqs", "proposals"]
    run(s.activate(U(OWNER), "A"))
    assert len(events(env, "MarketplaceProfileActivated")) == 1           # counted once
    public = run(s.public_profile("northwind-advisory-ltd-leeds"))
    assert public["description"] == "We help small firms set prices that hold." and public["location"] == "Leeds and remote"
    assert public["offerings"] == [{"id": "p1", "name": "Strategy Workshop", "description": "A one-day strategy workshop for leadership teams."}]      # no price: the Catalogue's prices are private
    assert public["service_tags"] == ["Pricing", "Strategy"] and public["since"]
    assert public["opportunities"] == {"enquiries": True, "rfqs": True, "proposals": True, "partnerships": False, "subcontracting": False}
    assert public["legal_identifier"] == "12345678" and public["canonical_slug"] == "northwind-advisory-ltd-leeds"      # AC-23: the address did not change
    text = json.dumps(public)
    for private in ("base_price", "1500", "cost_of_sales", "customers", "BrightTech", "hello@apex.test", "financials"):
        assert private not in text
    listing = _build_listing_item({"id": "A", "data": env.businesses["A"]["data"], "updated_at": env.now.isoformat()})      # AC-28: the existing listing still builds
    assert listing["company_name"] == "Apex Consulting" and listing["open_for_proposals"] is True and [p["id"] for p in listing["catalogue_products"]] == ["p1"]
    off = run(s.activate(U(OWNER), "A", publish=False))
    assert off["is_published"] is False and run(s.public_profile("northwind-advisory-ltd-leeds"))["offerings"] == []
    assert run(s.get_claim(U(OWNER), done["id"]))["next_step"] == "context"
    assert run(s.complete_handoff(U(OWNER), done["id"])) == {"business_id": "A", "to": "/dashboard"}
    assert run(s.get_claim(U(OWNER), done["id"]))["next_step"] == "done" and len(events(env, "dashboard_handoff_completed")) == 1


def test_a_free_plan_keeps_its_claim_and_settings_when_a_second_listing_needs_an_upgrade():
    env = Env()
    index(env)
    s = svc_of(env)
    env.meter.plans[OWNER] = "explorer"
    env.businesses["A"]["data"]["marketplace"] = {"is_active": True}
    done = verified_claim(env, user=OWNER, target="new")
    bid = done["business_id"]
    run(s.update_profile(U(OWNER), bid, {"service_area": "Leeds", "service_tags": ["Pricing"]}))
    run(s.update_preferences(U(OWNER), bid, {"enquiries": {"enabled": True}}))
    with pytest.raises(Conflict) as e:
        run(s.activate(U(OWNER), bid))
    assert e.value.code == "entitlement" and "Your profile and settings are saved" in e.value.message
    kept = run(s.business_profile(U(OWNER), bid))
    assert kept["directory"]["trust"]["state"] == "verified" and kept["preferences"]["enquiries"]["enabled"] is True and kept["activation"]["ready"] is True
    env.meter.plans[OWNER] = "decision_engine"
    assert run(s.activate(U(OWNER), bid))["is_published"] is True


# ══ Review, disputes, revocation ══════════════════════════════════════════════

def test_manual_review_keeps_the_profile_unchanged_until_a_person_decides():
    env = Env()
    index(env, {**NORTHWIND, "website": None})                            # no website: only evidence review is offered
    s = svc_of(env)
    slug = "northwind-advisory-ltd-leeds"
    claim = run(s.confirm_match(U(NEW), run(s.start_claim(U(NEW), slug))["id"], "new"))
    assert [m["method"] for m in claim["methods"]] == ["manual"]
    with pytest.raises(Invalid):
        run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="a@b.co.uk"))
    claim = run(s.start_verification(U(NEW), claim["id"], method="manual", note="I am the director; certificate of incorporation attached."))
    assert (claim["status"], claim["next_step"], claim["can"]["edit_profile"]) == ("verification_pending", "pending_review", False)
    with pytest.raises(Invalid):
        run(s.attach_evidence(U(NEW), claim["id"], claim["verification"]["id"], "virus.exe", "application/x-msdownload", b"MZ"))
    run(s.attach_evidence(U(NEW), claim["id"], claim["verification"]["id"], "certificate.pdf", "application/pdf", b"%PDF-1.4"))
    assert run(s.public_profile(slug))["trust"]["state"] == "unclaimed" and set(env.businesses) == {"A", "B"}      # nothing changes while it waits
    queue = run(s.review_queue(ADMIN))
    assert [c["id"] for c in queue["claims"]] == [claim["id"]] and queue["claims"][0]["evidence"][0]["files"] == [{"name": "certificate.pdf", "index": 0}]
    assert run(s.evidence_file(ADMIN, claim["verification"]["id"], 0))["content"] == b"%PDF-1.4"
    with pytest.raises(Forbidden):
        run(s.evidence_file(U(NEW), claim["verification"]["id"], 0))
    with pytest.raises(Invalid):
        run(s.review_decision(ADMIN, claim["id"], decision="approve", reason=""))
    rejected = run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="Certificate names a different company"))
    seen = run(s.get_claim(U(NEW), claim["id"]))
    assert rejected["status"] == "rejected" and seen["next_step"] == "closed" and "couldn't confirm" in seen["reason"]
    assert "different company" not in json.dumps(seen)                    # the internal reason stays internal
    again = run(s.start_claim(U(NEW), slug))                              # they can start again
    assert again["id"] != claim["id"] and again["status"] == "claim_started"
    again = run(s.start_verification(U(NEW), run(s.confirm_match(U(NEW), again["id"], "new"))["id"], method="manual", note="Updated evidence: utility bill and director ID."))
    assert run(s.review_decision(ADMIN, again["id"], decision="approve", reason="Director confirmed against the register"))["status"] == "verified"
    final = run(s.get_claim(U(NEW), again["id"]))
    assert final["status"] == "verified" and env.businesses[final["business_id"]]["owner"] == NEW
    history = s.store.rows["claims"][again["id"]]["data"]["history"]
    assert history[-1]["actor"] == "moderator:admin-1" and history[-1]["method"] == "manual_review" and history[-1]["reason"] == "Director confirmed against the register"
    assert all({"status", "at", "actor", "method", "reason"} <= set(h) for h in history)      # AC: who, how, when and why for every change


def test_ac21_a_competing_claim_pauses_changes_exposes_nothing_and_is_settled_by_a_person():
    env = Env()
    index(env)
    s = svc_of(env)
    slug = "northwind-advisory-ltd-leeds"
    env.businesses["B"]["data"]["workspace_profile"].update({"company_name": "Borealis Partners", "email": "team@borealis.test"})
    held = verified_claim(env, user=OWNER, target="A")
    assert run(s.start_claim(U(OWNER), slug))["id"] == held["id"]        # the holder gets their own verified claim back, not a new one
    with pytest.raises(Conflict) as e:                                    # a colleague in the same business is sent to it
        run(s.start_claim(U(MEMBER), slug))
    assert e.value.code == "already_yours" and e.value.detail["business_id"] == "A"
    challenge = run(s.start_claim(U(OUTSIDER), slug))
    assert challenge["challenge"] is True and "business_id" not in [k for k, v in challenge.items() if v == "A"]
    assert "Apex" not in json.dumps(challenge) and "hello@apex.test" not in json.dumps(challenge)
    challenge = run(s.confirm_match(U(OUTSIDER), challenge["id"], "B"))
    challenge = run(s.start_verification(U(OUTSIDER), challenge["id"], method="email_domain", email="real-owner@northwind-advisory.co.uk"))
    disputed = run(s.complete_verification(U(OUTSIDER), challenge["id"], challenge["verification"]["id"], s.sent_codes[-1][1]))
    assert (disputed["status"], disputed["next_step"], disputed["business_id"]) == ("disputed", "pending_review", None)
    assert env.businesses["A"]["data"]["marketplace"]["directory_profile_id"] and "marketplace" not in env.businesses["B"]["data"]      # nothing moved
    assert run(s.public_profile(slug))["trust"]["label"] == "Owner-verified"      # the public page is unchanged while a person checks
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["frozen"] is True   # the holder is told, and their edits pause
    for call in (s.update_profile(U(OWNER), "A", {"description": "Changed during the dispute, which is paused."}), s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}}),
                 s.activate(U(OWNER), "A")):
        with pytest.raises(Conflict) as e:
            run(call)
        assert e.value.code == "disputed"
    assert run(s.review_decision(ADMIN, challenge["id"], decision="reject", reason="Holder confirmed as the registered director"))["status"] == "rejected"
    assert run(s.public_profile(slug))["trust"]["state"] == "verified"    # back to normal for the holder
    run(s.update_profile(U(OWNER), "A", {"service_area": "Leeds"}))
    # A second challenge that is upheld: control moves, the earlier business keeps everything else.
    second = run(s.confirm_match(U(OUTSIDER), run(s.start_claim(U(OUTSIDER), slug))["id"], "B"))
    second = run(s.start_verification(U(OUTSIDER), second["id"], method="manual", note="We bought the company in August; share transfer attached."))
    assert second["status"] == "disputed" and run(s.review_decision(ADMIN, second["id"], decision="approve", reason="Share transfer verified"))["status"] == "verified"
    profile = s.store.rows["profiles"][second["profile"]["id"]]["data"]
    assert (profile["linked_business_id"], profile["claim_state"]) == ("B", "verified")
    a = env.businesses["A"]["data"]
    assert "directory_profile_id" not in a["marketplace"] and a["financials"]["invoices"] is not None and a["catalogue"]["products"]      # history intact
    assert env.businesses["B"]["data"]["marketplace"]["directory_profile_id"] == second["profile"]["id"]
    with pytest.raises(NotFound):
        run(s.business_profile(U(OUTSIDER), "A"))                        # winning the profile gives no way into the other business


def test_revoking_a_claim_removes_control_and_keeps_the_business():
    env = Env()
    index(env)
    s = svc_of(env)
    done = verified_claim(env)
    bid = done["business_id"]
    with pytest.raises(Invalid) as e:                                     # a revocation always says why
        run(s.review_decision(ADMIN, done["id"], decision="revoke", reason="Verification email belonged to a former employee"))
    assert set(e.value.errors) == {"reason_category"}
    assert run(s.review_decision(ADMIN, done["id"], decision="revoke", reason="Verification email belonged to a former employee", reason_category="no_longer_authorised"))["status"] == "revoked"
    assert bid in env.businesses and "directory_profile_id" not in env.businesses[bid]["data"]["marketplace"]
    assert run(s.public_profile("northwind-advisory-ltd-leeds"))["trust"]["state"] == "unclaimed"
    assert run(s.get_claim(U(NEW), done["id"]))["next_step"] == "closed"
    run(s.cancel_claim(U(NEW), run(s.start_claim(U(NEW), "northwind-advisory-ltd-leeds"))["id"]))      # an open claim can be cancelled
    with pytest.raises(Conflict):
        run(s.cancel_claim(U(NEW), done["id"]))


# ══ Corrections, unlisting, invitations, matching ═════════════════════════════

def test_ac22_corrections_and_unlisting_work_without_an_account_and_are_respected_everywhere():
    env = Env()
    index(env)
    s = svc_of(env)
    slug = "northwind-advisory-ltd-leeds"
    with pytest.raises(Invalid):
        run(s.report(slug, kind="unlist", message=""))
    report = run(s.report(slug, kind="unlist", message="We have ceased trading; please remove this page.", reporter_email="someone@example.com"))
    assert report["status"] == "open" and "don't need an account" in report["message"]
    assert [r["id"] for r in run(s.review_queue(ADMIN))["reports"]] == [report["id"]]
    assert run(s.resolve_report(ADMIN, report["id"], action="suppress", reason="Business confirmed it has closed"))["action"] == "suppress"
    assert run(s.search())["total"] == 0
    for call in (s.public_profile(slug), s.start_claim(U(NEW), slug)):
        with pytest.raises(NotFound):
            run(call)
    with pytest.raises(Conflict):
        run(s.create_invitation(ADMIN, slug))
    assert index(env)[0]["publication"] == "suppressed"                   # a later import does not bring it back
    resolved = s.store.rows["reports"][report["id"]]
    assert resolved["status"] == "resolved" and resolved["data"]["resolved_by"] == "admin-1" and resolved["data"]["reason"]
    assert len(events(env, "DirectoryProfileSuppressed")) >= 1


def test_ac17_ac18_opportunity_invitations_need_a_real_eligible_request_and_respect_opt_outs():
    env = Env()
    index(env)
    s = svc_of(env)
    slug = "northwind-advisory-ltd-leeds"
    live = {"req-1": {"id": "req-1", "type": "proposals", "status": "open", "categories": ["Consulting"], "location": "Leeds"}}

    async def lookup(ref):
        return live.get(ref)
    s._opportunity_lookup = lookup
    for ref in (None, "no-such-request"):
        with pytest.raises(Invalid) as e:                                 # no invented urgency
            run(s.create_invitation(ADMIN, slug, reason="opportunity", opportunity_ref=ref))
        assert "no open request" in e.value.errors["opportunity_ref"]
    live["req-2"] = {"id": "req-2", "type": "proposals", "status": "open", "categories": ["Plumbing"], "location": "Leeds"}
    with pytest.raises(Invalid):
        run(s.create_invitation(ADMIN, slug, reason="opportunity", opportunity_ref="req-2"))      # real, but this business isn't eligible
    inv = run(s.create_invitation(ADMIN, slug, reason="opportunity", opportunity_ref="req-1"))
    token = inv["link"].split("invite=")[1]
    assert inv["status"] == "created" and inv["link"].startswith(f"/marketplace/claim/{slug}?invite=") and token not in json.dumps(s.store.rows["invitations"])
    with pytest.raises(Conflict) as e:
        run(s.create_invitation(ADMIN, slug))                             # not twice in 30 days
    assert e.value.code == "too_soon"
    intent = run(s.create_intent(slug, invitation_token=token))
    assert intent["opportunity"] == {"reference": "req-1", "available": True, "text": "A current Marketplace request may match your services.",
                                     "note": "Claim and verify your profile to see the request and respond. This is not a promise of work."}
    claim = run(s.start_claim(U(NEW), slug, intent=intent["intent"]))
    assert claim["opportunity"]["available"] is True and s.store.rows["claims"][claim["id"]]["data"]["opportunity_ref"] == "req-1"      # the source reference is kept
    assert s.store.rows["claims"][claim["id"]]["data"]["acquisition_source"] == "invitation:opportunity"
    live.pop("req-1")                                                     # the request closes while the claim is in progress
    late = run(s.get_claim(U(NEW), claim["id"]))
    assert late["opportunity"]["available"] is False and "no longer available" in late["opportunity"]["text"] and late["status"] == "claim_started"
    assert run(s.opt_out(token))["ok"] is True
    env.now += d.INVITE_GAP + timedelta(days=1)
    with pytest.raises(Conflict) as e:
        run(s.create_invitation(ADMIN, slug))
    assert e.value.code == "suppressed" and [ev["data"]["reason"] for ev in events(env, "ClaimInvitationSuppressed")][-1] == "opted_out"
    with pytest.raises(NotFound):
        run(s.opt_out("not-a-token"))
    # Matching: fixed gates, with reasons, the same answer every time.
    base = {"category": "Consulting", "service_tags": ["Pricing"], "location": "Leeds", "publication": "published", "claim_state": "unclaimed"}
    ok = d.match_opportunity(base, {"categories": ["pricing"], "location": "leeds", "status": "open"})
    assert ok == d.match_opportunity(base, {"categories": ["pricing"], "location": "leeds", "status": "open"}) and ok["eligible"] and ok["ruleset"] == "match-0.1"
    assert d.match_opportunity(base, {"categories": ["Plumbing"]})["failed"] == ["No category or service in common with the request."]
    assert d.match_opportunity(base, {"categories": ["Pricing"], "location": "Cardiff"})["eligible"] is False
    assert d.match_opportunity(base, {"categories": ["Pricing"], "location": "Cardiff", "remote_ok": True})["eligible"] is True
    assert d.match_opportunity({**base, "claimed": True, "preferences": {"rfqs": True}}, {"categories": ["Pricing"], "type": "proposals"})["eligible"] is False      # not opted in
    assert d.match_opportunity({**base, "claim_state": "disputed"}, {"categories": ["Pricing"]})["eligible"] is False
    assert d.match_opportunity(base, {"categories": ["Pricing"], "status": "closed"})["eligible"] is False


def test_ac26_the_funnel_is_recorded_stage_by_stage_without_personal_data():
    env = Env()
    index(env)
    s = svc_of(env)
    run(s.record_view("northwind-advisory-ltd-leeds"))
    run(s.create_intent("northwind-advisory-ltd-leeds"))
    done = verified_claim(env)
    bid = done["business_id"]
    run(s.update_profile(U(NEW), bid, {"service_area": "Leeds", "service_tags": ["Pricing"]}, claim_id=done["id"]))
    run(s.update_preferences(U(NEW), bid, {"enquiries": {"enabled": True}}, claim_id=done["id"]))
    run(s.activate(U(NEW), bid))
    run(s.complete_handoff(U(NEW), done["id"]))
    seen = run(s.funnel(ADMIN))
    for stage in ("DirectoryProfileIndexed", "profile_viewed", "claim_cta_clicked", "BusinessClaimStarted", "business_match_confirmed", "verification_started",
                  "ClaimVerificationCompleted", "BusinessClaimVerified", "MarketplaceProfileLinked", "profile_review_completed", "opportunity_preferences_saved",
                  "MarketplaceProfileActivated", "dashboard_handoff_completed"):
        assert seen["events"].get(stage) == 1, stage
    assert seen["profiles"] == {"total": 1, "published": 1, "claimed": 1, "suppressed": 0} and seen["reports_open"] == 0
    blob = json.dumps(list(s.store.rows["events"].values()), default=str)
    for private in ("owner@northwind-advisory.co.uk", "hello@northwind-advisory.co.uk", NORTHWIND["description"][:30]):
        assert private not in blob
    assert all(e["data"]["schema_version"] == 1 and e["data"]["correlation_id"] for e in s.store.rows["events"].values())


def test_claims_are_rate_limited_per_person():
    env = Env()
    records = [{**NORTHWIND, "name": f"Firm {i} Ltd", "company_number": f"1000000{i}", "website": f"https://firm{i}.co.uk", "source": {"provider": "CH", "record_id": str(i)}} for i in range(7)]
    index(env, *records)
    s = svc_of(env)
    for i in range(d.CLAIMS_PER_DAY):
        run(s.start_claim(U(NEW), f"firm-{i}-ltd-leeds"))
    with pytest.raises(RateLimited):
        run(s.start_claim(U(NEW), "firm-5-ltd-leeds"))
    env.now += timedelta(days=1, minutes=1)
    assert run(s.start_claim(U(NEW), "firm-5-ltd-leeds"))["status"] == "claim_started"


def test_ac25_ac30_no_private_scores_from_public_data_and_no_dependence_on_the_agent():
    import inspect
    source = inspect.getsource(d).lower()
    for engine in ("fragility", "survival_score", "stability_score", "calculate_", "call_llm", "anthropic", "openai", "classifier", "orch.submit"):
        assert engine not in source, engine
    env = Env()
    env.orch.rt.classifier = None
    index(env)
    done = verified_claim(env)
    assert done["status"] == "verified" and not env.store.runs           # no Agent task was needed or started
    assert not [k for k in run(svc_of(env).public_profile("northwind-advisory-ltd-leeds")) if "score" in k or "health" in k or "readiness" in k]


# ══ API ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def http(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = {"id": OWNER, "email": OWNER}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    yield env, TestClient(app, raise_server_exceptions=False), who
    app.dependency_overrides.pop(get_current_user, None)


def test_the_api_covers_the_claim_journey_and_maps_errors(http):
    env, client, who = http
    who.update(ADMIN)
    made = client.post("/admin/marketplace/directory/index", json={"records": [NORTHWIND]})
    assert made.status_code == 200 and made.json()["summary"] == {"created": 1, "updated": 0, "excluded": 0, "invalid": 0}
    who.update({"id": OWNER, "email": OWNER})
    assert client.post("/admin/marketplace/directory/index", json={"records": [NORTHWIND]}).status_code == 403
    slug = "northwind-advisory-ltd-leeds"
    found = client.get("/marketplace/businesses?q=northwind").json()
    assert found["enabled"] is True and found["items"][0]["slug"] == slug and found["items"][0]["trust"]["state"] == "unclaimed"
    assert client.get(f"/marketplace/businesses/{slug}").json()["claim"]["eligible"] is True
    assert client.get("/marketplace/businesses/no-such-business").status_code == 404
    assert client.post(f"/marketplace/businesses/{slug}/view").status_code == 202
    assert client.post(f"/marketplace/businesses/{slug}/reports", json={"kind": "correction", "message": "The website address is out of date."}).status_code == 201
    intent = client.post(f"/marketplace/directory-profiles/{slug}/claim-intents", json={"source": "profile"}).json()["intent"]
    claim = client.post(f"/marketplace/directory-profiles/{slug}/claims", json={"intent": intent})
    assert claim.status_code == 201
    cid = claim.json()["id"]
    assert client.post(f"/business-claims/{cid}/match", json={"business_id": "B"}).status_code == 404
    assert client.post(f"/business-claims/{cid}/match", json={"business_id": "A"}).json()["next_step"] == "verification"
    bad = client.post(f"/business-claims/{cid}/verification", json={"method": "email_domain", "email": "me@gmail.com"})
    assert bad.status_code == 422 and "email" in bad.json()["detail"]["errors"]
    started = client.post(f"/business-claims/{cid}/verification", json={"method": "email_domain", "email": "me@northwind-advisory.co.uk"})
    vid = started.json()["verification"]["id"]
    code = service_for(env.orch).sent_codes[-1][1]
    assert client.post(f"/business-claims/{cid}/verification/{vid}/complete", json={"code": "999999" if code != "999999" else "111111"}).status_code == 422
    done = client.post(f"/business-claims/{cid}/verification/{vid}/complete", json={"code": code}).json()
    assert done["status"] == "verified" and done["business_id"] == "A"
    patch = client.patch("/businesses/A/marketplace-profile", json={"revision": 0, "claim_id": cid, "changes": {"description": "We help small firms set prices that hold.", "service_area": "Leeds"}})
    assert patch.status_code == 200 and patch.json()["profile"]["revision"] == 1
    assert client.patch("/businesses/A/marketplace-profile", json={"revision": 0, "changes": {"service_area": "York"}}).json()["detail"]["code"] == "stale_revision"
    assert client.patch("/businesses/A/marketplace-opportunity-preferences", json={"claim_id": cid, "changes": {"enquiries": {"enabled": True}}}).status_code == 200
    assert client.post("/businesses/A/marketplace-profile/activate", json={}).json()["is_published"] is True
    assert client.post(f"/business-claims/{cid}/handoff").json() == {"business_id": "A", "to": "/dashboard"}
    assert client.get("/business-claims").json()["items"][0]["next_step"] == "done"
    who.update({"id": OUTSIDER, "email": OUTSIDER})
    for path in (f"/business-claims/{cid}", "/businesses/A/marketplace-profile"):
        assert client.get(path).status_code == 404, path
    assert client.post(f"/business-claims/{cid}/review-decision", json={"decision": "revoke", "reason": "not an admin"}).status_code == 403
    assert client.get("/admin/marketplace/claims").status_code == 403
    assert client.get(f"/marketplace/businesses/{slug}").json()["owner_controls"] is False
    app.dependency_overrides.pop(get_current_user, None)                 # signed out: public pages work, claims need an account
    assert client.get(f"/marketplace/businesses/{slug}").status_code == 200
    assert client.post(f"/marketplace/directory-profiles/{slug}/claims", json={}).status_code == 401


def test_ac28_ac29_the_flag_closes_the_feature_and_keeps_every_link_business_and_record(http, monkeypatch):
    from app.core.config import get_settings
    env, client, who = http
    index(env)
    done = verified_claim(env, user=OWNER, target="A")
    slug = "northwind-advisory-ltd-leeds"
    monkeypatch.setattr(get_settings(), "marketplace_claim_enabled", False)
    assert client.get("/marketplace/businesses").json() == {"enabled": False, "items": [], "total": 0, "categories": []}
    assert client.get("/business-claims").json() == {"enabled": False, "items": []}
    for call in (client.get(f"/marketplace/businesses/{slug}"), client.post(f"/marketplace/directory-profiles/{slug}/claims", json={}),
                 client.get("/businesses/A/marketplace-profile"), client.get(f"/business-claims/{done['id']}")):
        assert call.status_code == 404
    assert env.businesses["A"]["data"]["marketplace"]["directory_profile_id"] == done["profile"]["id"]      # nothing was deleted
    s = service_for(env.orch)
    assert s.store.rows["claims"][done["id"]]["status"] == "verified" and s.store.rows["profiles"][done["profile"]["id"]]["data"]["linked_business_id"] == "A"
    assert run(dash.build_dashboard(env.orch, OWNER, "A"))["enabled"] is True      # the dashboard and the business carry on
    monkeypatch.setattr(get_settings(), "marketplace_claim_enabled", True)
    assert client.get(f"/business-claims/{done['id']}").json()["status"] == "verified"
