"""Businesses that sign up directly and the directory: the name guard on publishing (G-2),
verifying a self-made profile and merging it with a sourced one (G-3), the review of newly
published self-made profiles (G-4), and the company number collected at onboarding (G-1)."""
import copy

import pytest

from app.core.config import get_settings
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound
from app.modules.workspace_profile.service import _clean_answers
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, events, index, svc_of

SLUG = "northwind-advisory-ltd-leeds"
READY = {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}


def prepared(env, business="A", user=OWNER, **profile):
    """A business with everything the checklist needs, not yet published."""
    s = svc_of(env)
    env.businesses[business]["data"]["workspace_profile"].update(profile)
    run(s.update_profile(U(user), business, {**READY, **({"website": profile["website"]} if profile.get("website") else {})}))
    run(s.update_preferences(U(user), business, {"enquiries": {"enabled": True}}))
    return s


@pytest.fixture
def review(monkeypatch):
    def use(mode):
        monkeypatch.setattr(get_settings(), "marketplace_self_created_review", mode)
    return use


# ══ G-1 ═══════════════════════════════════════════════════════════════════════

def test_g1_onboarding_keeps_an_optional_company_number_and_never_needs_it():
    assert _clean_answers({"company_name": "Apex Consulting", "registration_number": " 12345678 ", "website": "apex.test", "made_up": "x"}) == {
        "company_name": "Apex Consulting", "registration_number": "12345678", "website": "apex.test"}
    assert _clean_answers({"company_name": "Apex Consulting"}) == {"company_name": "Apex Consulting"}      # signing up never depends on it
    env = Env()
    index(env)
    s = svc_of(env)
    # The check the onboarding screen makes once a name and a number or website are in.
    assert [(c["slug"], c["matched_on"]) for c in run(s.claimable(U(NEW), name="Northwind Advisory", company_number="12345678"))] == [(SLUG, "registered number")]
    assert run(s.claimable(U(NEW), name="Northwind Advisory")) == []     # a name alone suggests nothing


# ══ G-2 ═══════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("level", ["public", "invite_only", "admin_only"])
def test_g2_a_business_cannot_publish_unverified_under_another_profiles_name(level):
    env = Env()
    index(env)
    s = prepared(env, company_name="NORTHWIND ADVISORY LIMITED.")       # same name once case, punctuation and "Limited" are ignored
    run(s.set_visibility(ADMIN, level))
    with pytest.raises(Conflict) as e:
        run(s.activate(U(OWNER), "A"))
    assert e.value.code == "verification_required" and e.value.detail["profile"]["slug"] == SLUG and e.value.detail["profile"]["claimed"] is False
    assert env.businesses["A"]["data"]["marketplace"].get("is_active") is not True and len(s.store.rows["profiles"]) == 1      # nothing went live beside it
    # A different name publishes as before.
    env.businesses["A"]["data"]["workspace_profile"]["company_name"] = "Apex Consulting"
    assert run(s.activate(U(OWNER), "A"))["is_published"] is True


def test_g2_the_guard_also_covers_a_verified_profile_and_ignores_other_unverified_ones():
    from test_marketplace_claim import verified_claim
    env = Env()
    index(env)
    verified_claim(env, user=OUTSIDER, target="B")                       # the real Northwind, verified and held by business B
    s = prepared(env, company_name="Northwind Advisory")
    with pytest.raises(Conflict) as e:
        run(s.activate(U(OWNER), "A"))
    assert e.value.code == "verification_required" and e.value.detail["profile"]["claimed"] is True
    # Two self-made profiles may share a name: neither is verified, and the review queue sees both.
    env2 = Env()
    s2 = prepared(env2, company_name="Same Name Ltd")
    run(s2.activate(U(OWNER), "A"))
    prepared(env2, business="B", user=OUTSIDER, company_name="Same Name Limited")
    assert run(s2.activate(U(OUTSIDER), "B"))["is_published"] is True


# ══ G-3 ═══════════════════════════════════════════════════════════════════════

def test_g3_a_self_made_profile_is_verified_by_code_when_nothing_else_carries_its_name():
    env = Env()
    s = prepared(env, website="apex.test")
    live = run(s.activate(U(OWNER), "A"))
    assert live["directory"]["trust"]["label"] == "Created on EnterprateAI · not verified"
    for who in (U(MEMBER), U(OUTSIDER)):
        with pytest.raises((Forbidden, NotFound)):
            run(s.start_self_verification(who, "A"))                     # only the owner verifies the business
    claim = run(s.start_self_verification(U(OWNER), "A"))
    assert claim["self_verify"] is True and claim["next_step"] == "verification" and claim["target"] == "A"
    assert run(s.start_self_verification(U(OWNER), "A"))["id"] == claim["id"]      # resumed, not duplicated
    assert [m["method"] for m in claim["methods"]] == ["email_domain", "manual"]
    with pytest.raises(Invalid):
        run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="owner@gmail.com"))
    sent = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="owner@apex.test"))
    done = run(s.complete_verification(U(OWNER), claim["id"], sent["verification"]["id"], s.sent_codes[-1][1]))
    assert (done["status"], done["next_step"], done["business_id"]) == ("verified", "done", "A")
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["directory"]["trust"]["label"] == "Owner-verified" and view["directory"]["slug"] == live["directory"]["slug"] and view["is_published"] is True
    assert run(s.public_profile(live["directory"]["slug"]))["trust"]["state"] == "verified"
    assert run(s.search(trust="claimed"))["total"] == 1 and run(s.search(trust="created"))["total"] == 0      # "Verified only" finds it
    with pytest.raises(Conflict) as e:
        run(s.start_self_verification(U(OWNER), "A"))
    assert e.value.code == "already_verified"
    # Verified or not, a self-made profile leaves the directory when its owner unpublishes.
    run(s.activate(U(OWNER), "A", publish=False))
    assert run(s.search())["total"] == 0
    with pytest.raises(NotFound):
        run(s.public_profile(live["directory"]["slug"]))
    assert run(s.activate(U(OWNER), "A"))["directory"]["trust"]["state"] == "verified"      # and comes back verified


def test_g3_a_business_can_verify_before_it_publishes_which_lifts_the_name_guard():
    from test_marketplace_claim import verified_claim
    env = Env()
    index(env)
    verified_claim(env, user=OUTSIDER, target="B")
    s = prepared(env, company_name="Northwind Advisory", website="northwind-advisory-london.test")
    with pytest.raises(Conflict):
        run(s.activate(U(OWNER), "A"))
    claim = run(s.start_self_verification(U(OWNER), "A"))               # creates the profile, unpublished, to verify against
    own = [p for p in s.store.rows["profiles"].values() if p["data"].get("origin") == "created"][0]
    assert own["data"]["publication"] == "unpublished" and run(s.search())["total"] == 1
    assert run(s.public_profile(own["data"]["slug"], U(OWNER)))["name"] == "Northwind Advisory"      # the owner can open it
    with pytest.raises(NotFound):
        run(s.public_profile(own["data"]["slug"]))                       # nobody else can
    # A code at their own website doesn't prove they are the Northwind another profile describes: a person decides.
    sent = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="me@northwind-advisory-london.test"))
    waiting = run(s.complete_verification(U(OWNER), claim["id"], sent["verification"]["id"], s.sent_codes[-1][1]))
    assert (waiting["status"], waiting["next_step"]) == ("verification_pending", "pending_review")
    with pytest.raises(Conflict):
        run(s.activate(U(OWNER), "A"))                                   # still guarded while it waits
    queue = run(s.review_queue(ADMIN))["claims"]
    assert [c["id"] for c in queue] == [claim["id"]]
    assert run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="A separate firm with the same trading name; documents checked."))["status"] == "verified"
    live = run(s.activate(U(OWNER), "A"))
    assert live["is_published"] is True and live["directory"]["trust"]["state"] == "verified"
    assert sorted(i["trust"]["state"] for i in run(s.search())["items"]) == ["verified", "verified"]      # two verified firms, two profiles


def test_g3_a_member_moderator_cannot_approve_their_own_business_verification(monkeypatch):
    monkeypatch.setattr(d, "_moderators", lambda: {MEMBER.lower(), OWNER.lower()})
    env = Env()
    s = prepared(env, website="apex.test")
    env.businesses["A"]["members"][MEMBER] = env.businesses["A"]["members"].get(MEMBER) or {"role": "member", "tools": ["operations"]}
    run(s.activate(U(OWNER), "A"))
    claim = run(s.start_self_verification(U(OWNER), "A"))
    run(s.start_verification(U(OWNER), claim["id"], method="manual", note="Certificate of incorporation attached."))
    for who in ({"id": OWNER, "email": OWNER}, {"id": MEMBER, "email": MEMBER}):
        with pytest.raises(Forbidden):
            run(s.review_decision(who, claim["id"], decision="approve", reason="It's our own business."))
    assert run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Certificate matches."))["status"] == "verified"


def test_g3_indexing_a_match_for_a_published_self_made_profile_then_verifying_folds_them_into_one():
    env = Env()
    s = prepared(env, website="northwind-advisory.co.uk", registration_number="12345678")
    own = run(s.activate(U(OWNER), "A"))["directory"]
    assert own["slug"] == "apex-consulting"
    made = index(env)[0]                                                 # the sourced record arrives afterwards
    assert made["result"] == "created" and made["slug"] == SLUG
    assert sorted(i["trust"]["state"] for i in run(s.search())["items"]) == ["created", "unclaimed"]      # both exist until verified
    assert [p["slug"] for p in run(s.business_profile(U(OWNER), "A"))["possible_duplicates"]] == [SLUG]
    claim = run(s.start_self_verification(U(OWNER), "A"))
    sent = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="owner@northwind-advisory.co.uk"))
    done = run(s.complete_verification(U(OWNER), claim["id"], sent["verification"]["id"], s.sent_codes[-1][1]))
    assert done["status"] == "verified" and done["profile"]["slug"] == SLUG      # the code is at the sourced profile's own domain: no person needed
    found = run(s.search())
    assert found["total"] == 1 and found["items"][0]["slug"] == SLUG and found["items"][0]["trust"]["state"] == "verified"
    assert run(s.public_profile("apex-consulting"))["canonical_slug"] == SLUG        # the self-made address redirects
    assert run(s.public_profile(own["id"]))["canonical_slug"] == SLUG
    kept = [p for p in s.store.rows["profiles"].values() if p["data"].get("slug") == SLUG][0]["data"]
    assert kept["provenance"]["name"]["provider"] == "Companies House"               # the sourced history
    assert [(m["slug"], m["origin"]) for m in kept["merged_from"]] == [("apex-consulting", "created")] and kept["merged_from"][0]["created_on_platform_at"]      # and the self-made one
    assert env.businesses["A"]["data"]["marketplace"]["directory_profile_id"] == done["profile"]["id"]
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["origin"] == "indexed" and len(events(env, "DirectoryProfileMerged")) == 1


def test_g3_a_match_on_a_typed_in_number_alone_is_merged_only_after_a_person_agrees():
    env = Env()
    index(env)
    s = prepared(env, website="apex.test", registration_number="12345678")      # their own site, someone else's number
    run(s.answer_duplicate(U(OWNER), "A", SLUG))                         # "not mine" lets the first publish through
    run(s.activate(U(OWNER), "A"))
    env.businesses["A"]["data"]["marketplace"]["not_my_profiles"] = []   # and then they change their mind
    claim = run(s.start_self_verification(U(OWNER), "A"))
    sent = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="me@apex.test"))
    waiting = run(s.complete_verification(U(OWNER), claim["id"], sent["verification"]["id"], s.sent_codes[-1][1]))
    assert waiting["status"] == "verification_pending" and run(s.search(trust="unclaimed"))["total"] == 1      # the sourced profile is untouched
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="The number belongs to a different company."))
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["trust"]["state"] == "created"


# ══ G-4 ═══════════════════════════════════════════════════════════════════════

def test_g4_post_publish_goes_live_at_once_and_is_reviewed_afterwards(review, monkeypatch):
    review("post_publish")
    monkeypatch.setattr(d, "_moderators", lambda: {OWNER.lower()})
    env = Env()
    s = prepared(env)
    live = run(s.activate(U(OWNER), "A"))
    assert live["is_published"] is True and live["review_state"] is None and live["listing_suppressed"] is None      # the owner sees nothing unusual
    assert run(s.search())["total"] == 1
    queue = run(s.review_queue(ADMIN))
    assert queue["self_created_review"] == "post_publish"
    row = queue["new_listings"][0]
    assert (row["name"], row["live"], row["mode"], row["overdue"], row["needs_another_reviewer"]) == ("Apex Consulting", True, "post_publish", False, False)
    assert row["due_at"] == (env.now + d.REVIEW_SLA).isoformat()
    env.now += d.REVIEW_SLA + d.timedelta(minutes=1)
    assert run(s.review_queue(ADMIN))["new_listings"][0]["overdue"] is True      # the 24-hour mark has passed
    mine = run(s.review_queue({"id": OWNER, "email": OWNER}))["new_listings"][0]
    assert mine["needs_another_reviewer"] is True
    with pytest.raises(Forbidden) as e:
        run(s.review_listing({"id": OWNER, "email": OWNER}, row["slug"], decision="approve"))
    assert "business you belong to" in str(e.value)
    with pytest.raises(Invalid):
        run(s.review_listing(ADMIN, row["slug"], decision="suppress", reason=""))
    assert run(s.review_listing(ADMIN, row["slug"], decision="approve"))["decision"] == "approve"
    assert run(s.review_queue(ADMIN))["new_listings"] == [] and run(s.search())["total"] == 1
    with pytest.raises(Conflict):
        run(s.review_listing(ADMIN, row["slug"], decision="approve"))
    # Unpublishing and publishing an approved profile again doesn't send it back to the queue.
    run(s.activate(U(OWNER), "A", publish=False))
    run(s.activate(U(OWNER), "A"))
    assert run(s.review_queue(ADMIN))["new_listings"] == [] and run(s.search())["total"] == 1


def test_g4_suppressing_tells_the_owner_why_and_a_fixed_profile_is_checked_before_it_returns(review):
    review("post_publish")
    env = Env()
    s = prepared(env)
    slug = run(s.activate(U(OWNER), "A"))["directory"]["slug"]
    run(s.review_listing(ADMIN, slug, decision="suppress", reason="The description advertises a regulated service without the licence number."))
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["is_published"] is False and view["listing_suppressed"]["reason"].startswith("The description advertises")
    assert run(s.search())["total"] == 0
    with pytest.raises(NotFound):
        run(s.public_profile(slug))
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold. FCA reference 123456."}))
    again = run(s.activate(U(OWNER), "A"))
    assert again["is_published"] is False and again["review_state"] == "pending_review" and again["listing_suppressed"] is None
    assert run(s.search())["total"] == 0                                 # not public until someone has looked
    row = run(s.review_queue(ADMIN))["new_listings"][0]
    assert (row["live"], row["mode"]) == (False, "pre_publish")
    run(s.review_listing(ADMIN, slug, decision="approve", reason="Licence number added."))
    assert run(s.business_profile(U(OWNER), "A"))["is_published"] is True and run(s.search())["total"] == 1


def test_g4_pre_publish_holds_the_profile_until_it_is_approved(review):
    review("pre_publish")
    env = Env()
    s = prepared(env)
    held = run(s.activate(U(OWNER), "A"))
    assert held["is_published"] is False and held["review_state"] == "pending_review"
    assert env.businesses["A"]["data"]["marketplace"]["is_active"] is False and run(s.search())["total"] == 0
    slug = held["directory"]["slug"]
    with pytest.raises(NotFound):
        run(s.public_profile(slug))
    assert run(s.public_profile(slug, U(OWNER)))["name"] == "Apex Consulting"      # its owner can still preview it
    assert events(env, "MarketplaceProfileActivated") == []              # not counted as activated yet
    run(s.activate(U(OWNER), "A", publish=False))                        # withdrawn before anyone looked
    assert run(s.review_queue(ADMIN))["new_listings"] == [] and run(s.business_profile(U(OWNER), "A"))["review_state"] is None
    run(s.activate(U(OWNER), "A"))
    assert [r["live"] for r in run(s.review_queue(ADMIN))["new_listings"]] == [False]
    run(s.review_listing(ADMIN, slug, decision="approve"))
    live = run(s.business_profile(U(OWNER), "A"))
    assert live["is_published"] is True and live["review_state"] is None and run(s.search())["total"] == 1 and run(s.public_profile(slug))["claimed"] is True


def test_g4_off_reviews_nothing_and_a_verified_business_is_never_queued(review):
    review("off")
    env = Env()
    s = prepared(env)
    run(s.activate(U(OWNER), "A"))
    assert run(s.review_queue(ADMIN))["new_listings"] == [] and run(s.review_queue(ADMIN))["self_created_review"] == "off"
    review("pre_publish")
    from test_marketplace_claim import verified_claim
    env2 = Env()
    index(env2)
    verified_claim(env2, user=OWNER, target="A")
    s2 = prepared(env2)
    assert run(s2.activate(U(OWNER), "A"))["is_published"] is True and run(s2.review_queue(ADMIN))["new_listings"] == []


def test_nothing_changes_for_a_business_that_never_publishes(review):
    review("post_publish")
    env = Env()
    index(env)
    s = svc_of(env)
    before = copy.deepcopy(env.businesses["A"]["data"])
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["is_published"] is False and view["directory"] is None and view["review_state"] is None and view["possible_duplicates"] == []
    assert env.businesses["A"]["data"] == before                         # looking at the settings writes nothing
    assert len(s.store.rows["profiles"]) == 1 and run(s.review_queue(ADMIN))["new_listings"] == [] and run(s.search())["total"] == 1
    assert events(env, "DirectoryProfileCreated") == []


# ══ N-1 ═══════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("name", ["", "   ", "My workspace", "Business", "unnamed"])
def test_n1_a_business_without_a_real_name_cannot_be_published_and_gets_no_address(name):
    env = Env()
    s = prepared(env, company_name=name)
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["activation"]["ready"] is False and [i["key"] for i in view["activation"]["items"] if not i["done"] and not i.get("optional")] == ["name"]
    with pytest.raises(Invalid) as e:
        run(s.activate(U(OWNER), "A"))
    assert e.value.errors == {"name": "Still needed: A business name."}
    assert s.store.rows["profiles"] == {} and env.businesses["A"]["data"]["marketplace"].get("is_active") is not True
    # The older publish switch can't make one either.
    env.businesses["A"]["data"]["marketplace"]["is_active"] = True
    assert run(s.sync_listing("A")) is None and s.store.rows["profiles"] == {} and run(s.search())["total"] == 0
    with pytest.raises((Conflict, Invalid, NotFound)):
        run(s.public_profile("business"))
    # With a name it publishes at an address made from that name.
    env.businesses["A"]["data"]["marketplace"]["is_active"] = False
    env.businesses["A"]["data"]["workspace_profile"]["company_name"] = "Apex Consulting"
    assert run(s.activate(U(OWNER), "A"))["directory"]["slug"] == "apex-consulting"
