"""Marketplace QA round 5: a reviewer with any stake in a profile never decides it (D-1), a
revocation never grows a second public profile (D-2), a challenge pauses the holder's changes and
nothing else (D-3), claim endpoints are the claimant's alone (D-4), and the challenger sees the
profile's real trust state (D-5)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound
from app.shared.auth.deps import get_current_user
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, events, index, svc_of, verified_claim

SLUG = "northwind-advisory-ltd-leeds"
MOD = {"id": OUTSIDER, "email": OUTSIDER}      # a second moderator, who also owns business "B"
THIRD = {"id": "mod-3", "email": "third@moderators.test"}


@pytest.fixture
def moderators(monkeypatch):
    monkeypatch.setattr(d, "_moderators", lambda: {OWNER.lower(), OUTSIDER.lower(), THIRD["email"]})


def challenge(env, user, target="new"):
    s = svc_of(env)
    claim = run(s.start_claim(U(user), SLUG))
    claim = run(s.confirm_match(U(user), claim["id"], target))
    return run(s.start_verification(U(user), claim["id"], method="manual", note="I am the director of this company; certificate attached."))


# ══ D-1 ═══════════════════════════════════════════════════════════════════════

def test_d1_a_reviewer_with_a_competing_claim_cannot_revoke_approve_or_reject_on_that_profile(moderators):
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env, user=OWNER, target="A")
    mine = challenge(env, OUTSIDER, "B")                                  # the moderator's own open challenge on the same profile
    for decision in ("revoke", "approve", "reject"):
        with pytest.raises(Forbidden) as e:
            run(s.review_decision(MOD, held["id"], decision=decision, reason="Removing the current holder.", reason_category="other"))
        assert "claim of your own on this profile" in str(e.value)
    assert s.store.rows["claims"][held["id"]]["status"] == "verified" and env.businesses["A"]["data"]["marketplace"]["directory_profile_id"]
    assert [c["needs_another_reviewer"] for c in run(s.review_queue(MOD))["claims"]] == [True]
    # The holder can't decide the challenge against them either: they belong to the business it is about.
    with pytest.raises(Forbidden) as e:
        run(s.review_decision({"id": OWNER, "email": OWNER}, mine["id"], decision="reject", reason="We hold this profile."))
    assert str(e.value).startswith("You can't decide a claim about a business you belong to.")
    # Still a party after the claim closes: a cancelled challenge within the window, and the business it named.
    run(s.cancel_claim(U(OUTSIDER), mine["id"]))
    with pytest.raises(Forbidden):
        run(s.review_decision(MOD, held["id"], decision="revoke", reason="Removing the current holder.", reason_category="other"))
    env.now += d.PARTY_WINDOW + d.timedelta(days=1)
    with pytest.raises(Forbidden) as e:                                   # long after: still a member of a business once tied to the profile
        run(s.review_decision(MOD, held["id"], decision="revoke", reason="Removing the current holder.", reason_category="other"))
    assert "business you belong to" in str(e.value)


def test_d1_the_revoked_owner_cannot_decide_the_claim_that_follows(moderators):
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env, user=OWNER, target="A")
    assert run(s.review_decision(MOD, held["id"], decision="revoke", reason="Verified against a lapsed domain.", reason_category="verified_in_error"))["revocation"] == "awaiting_second_reviewer"
    assert run(s.review_decision(THIRD, held["id"], decision="revoke", reason="Confirmed: the domain lapsed in May."))["status"] == "revoked"
    after = challenge(env, NEW)                                           # an ordinary claim now that the profile is unclaimed
    assert after["challenge"] is False and after["status"] == "verification_pending"
    for decision, reason in (("approve", "Looks fine to me."), ("reject", "No."), ("reject", "")):
        with pytest.raises(Forbidden):                                    # refused for who they are, before the reason is even looked at
            run(s.review_decision({"id": OWNER, "email": OWNER}, after["id"], decision=decision, reason=reason))
    assert run(s.review_decision(THIRD, after["id"], decision="approve", reason="Certificate matches the register."))["status"] == "verified"


def test_d1_revoking_names_a_category_and_needs_a_second_reviewer_where_there_is_one(moderators):
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env)
    with pytest.raises(Invalid) as e:
        run(s.review_decision(MOD, held["id"], decision="revoke", reason="Verified in error.", reason_category="because"))
    assert set(e.value.errors) == {"reason_category"}
    asked = run(s.review_decision(MOD, held["id"], decision="revoke", reason="Verified against a lapsed domain.", reason_category="verified_in_error"))
    assert asked == {"id": held["id"], "status": "verified", "revocation": "awaiting_second_reviewer"}
    assert run(s.public_profile(SLUG))["trust"]["state"] == "verified"    # nothing changes on one person's say-so
    with pytest.raises(Forbidden) as e:
        run(s.review_decision(MOD, held["id"], decision="revoke", reason="Confirming my own request."))
    assert "second reviewer" in str(e.value)
    waiting = run(s.review_queue(THIRD))["revocations"]
    assert [(r["id"], r["category"], r["needs_another_reviewer"], r["requested_by_you"]) for r in waiting] == [(held["id"], "verified_in_error", False, False)]
    assert run(s.review_queue(MOD))["revocations"][0]["needs_another_reviewer"] is True and run(s.review_queue(MOD))["second_reviewer_required"] is True
    assert run(s.review_decision(THIRD, held["id"], decision="keep", reason="The domain was renewed; keep it."))["revocation"] == "withdrawn"
    assert run(s.review_queue(THIRD))["revocations"] == [] and s.store.rows["claims"][held["id"]]["status"] == "verified"
    with pytest.raises(Conflict):
        run(s.review_decision(THIRD, held["id"], decision="keep", reason="Nothing is waiting."))
    run(s.review_decision(MOD, held["id"], decision="revoke", reason="It lapsed again.", reason_category="no_longer_authorised"))
    done = run(s.review_decision(THIRD, held["id"], decision="revoke", reason="Confirmed with the registrar."))
    assert done["status"] == "revoked" and done["revocation"] == "done"
    kept = s.store.rows["claims"][held["id"]]["data"]["revoked"]
    assert (kept["category"], kept["requested_by"], kept["confirmed_by"]) == ("no_longer_authorised", OUTSIDER, "mod-3")
    assert len(events(env, "claim_revocation_requested")) == 2


# ══ D-2 ═══════════════════════════════════════════════════════════════════════

def test_d2_revoking_unpublishes_the_business_and_never_makes_it_a_second_profile():
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env, user=OWNER, target="A")
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}))
    run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}}))
    assert run(s.activate(U(OWNER), "A"))["is_published"] is True
    run(s.review_decision(ADMIN, held["id"], decision="revoke", reason="Verified against a lapsed domain.", reason_category="verified_in_error"))
    m = env.businesses["A"]["data"]["marketplace"]
    assert m["is_active"] is False and "directory_profile_id" not in m and m["control_removed"]["category"] == "verified_in_error"
    # The owner opens their page: told what happened, not published, and no new profile appears.
    view = run(s.business_profile(U(OWNER), "A"))
    assert view["is_published"] is False and view["directory"] is None
    assert view["control_removed"]["profile_name"] == "Northwind Advisory Ltd"
    profiles = list(s.store.rows["profiles"].values())
    assert len(profiles) == 1 and profiles[0]["data"]["claim_state"] == "unclaimed" and profiles[0]["data"]["previous_business_ids"] == ["A"]
    found = run(s.search())
    assert found["total"] == 1 and found["items"][0]["trust"]["state"] == "unclaimed" and found["items"][0]["description"] == NORTHWIND["description"]
    assert events(env, "DirectoryProfileCreated") == [] and len(events(env, "MarketplaceProfileUnpublished")) == 1
    assert env.businesses["A"]["data"]["catalogue"]["products"] and view["profile"]["description"].startswith("We help")      # the business keeps everything else
    # Publishing again is the owner's choice, and clears the notice.
    again = run(s.activate(U(OWNER), "A"))
    assert again["is_published"] is True and again["control_removed"] is None and again["directory"]["origin"] == "created"


def test_d2_an_upheld_challenge_takes_the_earlier_listing_down_the_same_way():
    env = Env()
    index(env)
    s = svc_of(env)
    verified_claim(env, user=OWNER, target="A")
    env.businesses["A"]["data"]["marketplace"]["is_active"] = True
    won = challenge(env, OUTSIDER, "B")
    run(s.review_decision(ADMIN, won["id"], decision="approve", reason="Share transfer verified."))
    a = env.businesses["A"]["data"]["marketplace"]
    assert a["is_active"] is False and a["control_removed"]["category"] == "upheld_challenge" and "directory_profile_id" not in a
    run(s.business_profile(U(OWNER), "A"))
    assert len(s.store.rows["profiles"]) == 1 and s.store.rows["profiles"][won["profile"]["id"]]["data"]["previous_business_ids"] == ["A"]


# ══ D-3 ═══════════════════════════════════════════════════════════════════════

def test_d3_a_challenge_pauses_the_holders_changes_keeps_the_public_page_and_is_released_when_settled():
    env = Env()
    index(env)
    s = svc_of(env)
    verified_claim(env, user=OWNER, target="A")
    run(s.update_profile(U(OWNER), "A", {"description": "We help small firms set prices that hold.", "service_area": "Leeds and remote", "service_tags": ["Pricing"]}))
    run(s.update_preferences(U(OWNER), "A", {"enquiries": {"enabled": True}}))
    run(s.activate(U(OWNER), "A"))
    before = run(s.public_profile(SLUG))
    started = run(s.confirm_match(U(OUTSIDER), run(s.start_claim(U(OUTSIDER), SLUG))["id"], "B"))
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["frozen"] is False      # starting a claim alone pauses nothing
    sent = run(s.start_verification(U(OUTSIDER), started["id"], method="manual", note="I am the director of this company; certificate attached."))
    assert (sent["status"], sent["next_step"]) == ("disputed", "pending_review")
    run(s.attach_evidence(U(OUTSIDER), sent["id"], sent["verification"]["id"], "cert.pdf", "application/pdf", b"%PDF-1.4"))      # evidence can still be added
    owner = run(s.business_profile(U(OWNER), "A"))
    assert owner["directory"]["frozen"] is True and owner["directory"]["trust"]["state"] == "disputed" and owner["is_published"] is True
    for call in (s.update_profile(U(OWNER), "A", {"description": "Changed while the review is open."}), s.update_preferences(U(OWNER), "A", {"rfqs": {"enabled": True}}),
                 s.activate(U(OWNER), "A", publish=False), s.activate(U(OWNER), "A")):
        with pytest.raises(Conflict) as e:
            run(call)
        assert e.value.code == "disputed" and "under review" in e.value.message
    after = run(s.public_profile(SLUG))
    for key in ("trust", "description", "service_tags", "offerings", "opportunities", "activated", "location"):
        assert after[key] == before[key]                                  # the public page is exactly as it was
    assert run(s.search())["items"][0]["trust"]["state"] == "verified"
    assert [c["status"] for c in run(s.review_queue(ADMIN))["claims"]] == ["disputed"]
    # Cancelled by the challenger: released.
    run(s.cancel_claim(U(OUTSIDER), sent["id"]))
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["frozen"] is False
    assert run(s.update_profile(U(OWNER), "A", {"service_area": "Leeds"}))["profile"]["service_area"] == "Leeds"
    # A second one, decided against the challenger: released again.
    again = challenge(env, OUTSIDER, "B")
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["frozen"] is True
    run(s.review_decision(ADMIN, again["id"], decision="reject", reason="Holder confirmed as the registered director."))
    assert run(s.business_profile(U(OWNER), "A"))["directory"]["frozen"] is False and run(s.public_profile(SLUG))["trust"]["state"] == "verified"


# ══ D-4 and D-5 ═══════════════════════════════════════════════════════════════

def test_d4_claim_endpoints_belong_to_the_claimant_alone_even_for_a_moderator(moderators):
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env, user=OWNER, target="A")
    open_ = run(s.start_claim(U(NEW), SLUG))
    for who in (MOD, ADMIN, U(MEMBER)):
        for call in (lambda: s.get_claim(who, held["id"]), lambda: s.complete_handoff(who, held["id"]), lambda: s.cancel_claim(who, open_["id"]),
                     lambda: s.confirm_match(who, open_["id"], "new"), lambda: s.start_verification(who, open_["id"], method="manual", note="Trying someone else's claim."),
                     lambda: s.complete_verification(who, open_["id"], "v", "123456"), lambda: s.attach_evidence(who, open_["id"], "v", "a.pdf", "application/pdf", b"x")):
            with pytest.raises(NotFound):
                run(call())
    assert "handoff_completed" not in s.store.rows["claims"][held["id"]]["data"] and s.store.rows["claims"][open_["id"]]["status"] == "claim_started"
    # The moderator's own view carries no owner actions and no business id.
    row = [c for c in run(s.review_queue(THIRD, status="all"))["claims"] if c["id"] == held["id"]][0]
    assert "can" not in row and "business_id" not in row and "linked_business_id" not in json.dumps(row)
    assert run(s.get_claim(U(OWNER), held["id"]))["can"]["edit_profile"] is True      # the claimant still has theirs


def test_d4_over_the_api_a_moderator_and_a_stranger_both_get_404(monkeypatch):
    env = Env()
    index(env)
    s = svc_of(env)
    held = verified_claim(env, user=OWNER, target="A")
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    monkeypatch.setattr(d, "_moderators", lambda: {OUTSIDER.lower()})
    who = {"id": OUTSIDER, "email": OUTSIDER}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        for user in ({"id": OUTSIDER, "email": OUTSIDER}, {"id": "stranger", "email": "stranger@example.test"}):
            who.clear()
            who.update(user)
            assert client.get(f"/business-claims/{held['id']}").status_code == 404
            assert client.post(f"/business-claims/{held['id']}/handoff").status_code == 404
            assert client.post(f"/business-claims/{held['id']}/cancel").status_code == 404
            assert client.post(f"/business-claims/{held['id']}/match", json={"business_id": "new"}).status_code == 404
            assert client.post(f"/business-claims/{held['id']}/verification", json={"method": "manual", "note": "Not my claim at all."}).status_code == 404
        who.clear()
        who.update({"id": OUTSIDER, "email": OUTSIDER})
        asked = client.post(f"/business-claims/{held['id']}/review-decision", json={"decision": "revoke", "reason": "Verified in error.", "reason_category": "verified_in_error"})
        assert asked.status_code == 200 and asked.json()["revocation"] == "awaiting_second_reviewer"
        again = client.post(f"/business-claims/{held['id']}/review-decision", json={"decision": "revoke", "reason": "Confirming it myself."})
        assert again.status_code == 403 and "second reviewer" in again.json()["detail"]
        assert client.get("/admin/marketplace/claims").json()["revocations"][0]["category_label"] == "The claim was verified in error"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_d5_the_challenger_sees_the_real_trust_state_and_is_told_it_will_be_reviewed():
    env = Env()
    index(env)
    s = svc_of(env)
    verified_claim(env, user=OWNER, target="A")
    started = run(s.start_claim(U(OUTSIDER), SLUG))
    assert started["profile"]["trust"]["state"] == "verified" and started["profile"]["claimed"] is True
    assert started["held_by_another"] is True and started["notice"] == "This profile is managed by another business. Your request will be reviewed."
    sent = challenge(env, OUTSIDER, "B")
    assert sent["profile"]["trust"]["state"] == "verified" and sent["held_by_another"] is True      # not "under review" and not "unclaimed"
    assert "Apex" not in json.dumps(sent) and "hello@apex.test" not in json.dumps(sent)              # still nothing about the holder
    mine = run(s.get_claim(U(OWNER), [c for c in s.store.rows["claims"].values() if c["kind"] == OWNER][0]["id"]))
    assert mine["held_by_another"] is False and mine["notice"] is None and mine["profile"]["trust"]["state"] == "verified"
    plain = Env()
    index(plain)
    first = run(svc_of(plain).start_claim(U(NEW), SLUG))
    assert first["profile"]["trust"]["state"] == "unclaimed" and first["held_by_another"] is False and first["notice"] is None
