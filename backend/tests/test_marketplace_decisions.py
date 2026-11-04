"""When the team decides, the person waiting is told by email, and the team has one place to see what was decided."""
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace import directory as d
from app.modules.agent.business import BusinessAccessDenied
from app.modules.marketplace.directory import Conflict, Forbidden
from app.shared.auth.deps import get_current_user, get_optional_user
from test_agent import OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, U, index, svc_of, verified_claim
from test_marketplace_self_created import prepared

SLUG = "northwind-advisory-ltd-leeds"
BUYER = {"kind": "quote", "name": "Ada Buyer", "email": "ada@buyer.test", "items": [{"name": "Pricing", "quantity": 2}]}


def waiting_claim(env, user=NEW, target="new"):
    s = svc_of(env)
    claim = run(s.start_claim(U(user), SLUG))
    claim = run(s.confirm_match(U(user), claim["id"], target))
    return run(s.start_verification(U(user), claim["id"], method="manual", note="I run this company and can show the filing."))


def decided(s, viewer=ADMIN):
    return run(s.decisions(viewer))["items"]


def test_an_approved_claim_emails_the_claimant_with_the_waiting_requests():
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, "public"))
    run(s.hold_request(SLUG, BUYER))
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing, documents checked."))
    assert len(s.sent_decisions) == 1
    message = s.sent_decisions[0]
    assert (message["to"], message["kind"], message["requests"]) == ([NEW], "claim_approved", 1)
    assert message["link"] == f"/marketplace/claim/{SLUG}"
    assert "ada@buyer.test" not in json.dumps(message) and "documents checked" not in json.dumps(message)      # no buyer details, no reviewer notes
    row = decided(s)[0]
    assert (row["outcome"], row["type"], row["person"], row["links_to"], row["email"], row["decided_by"]) == ("approved", "claim", NEW, "A new business", "sent", ADMIN["email"])
    assert row["reason"] == "Director on the filing, documents checked."


def test_a_rejected_claim_gets_the_public_reason_never_the_reviewers_note():
    env = Env()
    s = svc_of(env)
    index(env)
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="Looks like a competitor fishing for leads."))
    message = s.sent_decisions[0]
    assert message["kind"] == "claim_rejected" and "competitor" not in json.dumps(message) and "different evidence" in message["reason"]
    assert decided(s)[0]["outcome"] == "rejected"


def test_a_removed_claim_and_a_losing_challenger_are_told_too():
    env = Env()
    s = svc_of(env)
    index(env)
    held = verified_claim(env)
    challenge = waiting_claim(env, user=OWNER, target="A")
    assert challenge["status"] == "disputed"
    run(s.review_decision(ADMIN, challenge["id"], decision="reject", reason="The holder is the registered director."))
    assert s.sent_decisions[-1]["to"] == [OWNER] and s.sent_decisions[-1]["kind"] == "claim_rejected"
    run(s.review_decision(ADMIN, held["id"], decision="revoke", reason="Evidence turned out to be forged.", reason_category=next(iter(d.REVOKE_CATEGORIES))))
    assert s.sent_decisions[-1]["to"] == [NEW, "owner@northwind-advisory.co.uk"] and s.sent_decisions[-1]["kind"] == "claim_revoked"
    assert {r["outcome"] for r in decided(s)} == {"removed", "rejected"}


def test_a_code_passed_on_screen_is_listed_and_needs_no_email():
    env = Env()
    s = svc_of(env)
    index(env)
    verified_claim(env)
    assert s.sent_decisions == []
    row = decided(s)[0]
    assert (row["outcome"], row["email"], row["decided_by"]) == ("approved", "not_needed", "Email code")


def test_the_email_given_on_the_form_is_told_as_well_as_the_login_once_its_code_passed():
    env = Env()
    s = svc_of(env)
    index(env)
    verified_claim(env)      # someone already holds it, so a challenge goes to a person
    claim = run(s.start_claim(U(OWNER), SLUG))
    claim = run(s.confirm_match(U(OWNER), claim["id"], "A"))
    claim = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="Director@northwind-advisory.co.uk"))
    code = s.sent_codes[-1][1]
    public = run(s.complete_verification(U(OWNER), claim["id"], claim["verification"]["id"], code))
    assert "director@northwind-advisory.co.uk" not in json.dumps(public, default=str)      # still masked on screen
    assert "director@northwind-advisory.co.uk" not in json.dumps(run(s.review_queue(ADMIN)), default=str)
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Share transfer checked."))
    assert s.sent_decisions[-1]["to"] == [OWNER, "director@northwind-advisory.co.uk"]
    assert decided(s)[0]["person"] == f"{OWNER}, director@northwind-advisory.co.uk"


def test_an_address_typed_but_never_confirmed_is_not_emailed():
    env = Env()
    s = svc_of(env)
    index(env)
    claim = run(s.start_claim(U(NEW), SLUG))
    claim = run(s.confirm_match(U(NEW), claim["id"], "new"))
    run(s.start_verification(U(NEW), claim["id"], method="email_domain", email="someone.else@northwind-advisory.co.uk"))      # code never entered
    run(s.start_verification(U(NEW), claim["id"], method="manual", note="I run this company and can show the filing."))
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="Nothing supports this."))
    assert s.sent_decisions[-1]["to"] == [NEW]


def listing(env):
    monkey = pytest.MonkeyPatch()
    monkey.setattr(get_settings(), "marketplace_self_created_review", "post_publish")
    s = prepared(env, website="apex.test", email="office@apex.test")
    run(s.activate(U(OWNER), "A"))
    return s, next(p for p in s.store.rows["profiles"].values() if p["data"].get("origin") == "created"), monkey


def test_a_reviewed_listing_emails_its_owner_and_shows_as_approved():
    env = Env()
    s, profile, monkey = listing(env)
    run(s.review_listing(ADMIN, profile["data"]["slug"], decision="approve"))
    assert (s.sent_decisions[0]["to"], s.sent_decisions[0]["kind"], s.sent_decisions[0]["link"]) == ([OWNER, "office@apex.test"], "listing_approved", "/marketplace/profile?business=A")      # the login and the email filled in
    row = decided(s)[0]
    assert (row["outcome"], row["type"], row["person"], row["email"], row["decided_by"]) == ("approved", "listing", f"{OWNER}, office@apex.test", "sent", ADMIN["email"])
    assert run(s.review_queue(ADMIN))["new_listings"] == []      # and it has left the queue
    monkey.undo()


def test_a_suppressed_listing_is_told_why():
    env = Env()
    s, profile, monkey = listing(env)
    run(s.review_listing(ADMIN, profile["data"]["slug"], decision="suppress", reason="The description isn't about a real service."))
    monkey.undo()
    message = s.sent_decisions[0]
    assert message["kind"] == "listing_suppressed" and message["reason"] == "The description isn't about a real service."
    assert decided(s)[0]["outcome"] == "rejected"


def test_a_failed_email_keeps_the_decision_and_the_team_can_see_it():
    env = Env()
    s = svc_of(env)
    index(env)

    async def down(_message):
        raise RuntimeError("mail provider down")
    s._send_decision = down
    claim = waiting_claim(env)
    assert run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))["status"] == "verified"
    assert decided(s)[0]["email"] == "failed"
    assert run(s.get_claim(U(NEW), claim["id"]))["status"] == "verified"


def row_of(s, viewer=ADMIN):
    return next(r for r in decided(s, viewer) if r["type"] == "claim")


def test_an_approved_claim_can_be_revoked_from_the_decisions_list_by_two_people():
    env = Env()
    s = svc_of(env)
    index(env)
    claim = verified_claim(env)
    reviewer = {"id": "r1", "email": "reviewer@enterprate.test"}
    run(s.add_team_member(ADMIN, reviewer["email"]))
    assert row_of(s)["revocable"] is True and row_of(s)["revocation"] is None
    assert run(s.decisions(ADMIN))["second_reviewer_required"] is True and run(s.decisions(ADMIN))["revoke_categories"]
    asked = run(s.review_decision(reviewer, claim["id"], decision="revoke", reason="Evidence turned out to be forged.", reason_category="fraud_or_impersonation"))
    assert asked["revocation"] == "awaiting_second_reviewer"
    assert row_of(s, reviewer)["revocation"]["requested_by_you"] is True
    other = row_of(s)["revocation"]
    assert other["requested_by_you"] is False and other["reason"] == "Evidence turned out to be forged."
    assert s.sent_decisions == []      # nothing happens to the business yet
    run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Agreed, the filing doesn't match."))
    row = row_of(s)
    assert (row["outcome"], row["revocable"], row["email"]) == ("removed", False, "sent")
    assert s.sent_decisions[-1]["kind"] == "claim_revoked"


def test_the_person_who_made_the_claim_can_not_revoke_it():
    env = Env()
    s = svc_of(env)
    index(env)
    verified_claim(env)
    run(s.add_team_member(ADMIN, NEW))
    assert row_of(s, U(NEW))["needs_another_reviewer"] is True
    assert row_of(s)["needs_another_reviewer"] is False


def test_a_revoked_business_goes_back_to_waiting_to_be_claimed():
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, "public"))
    claim = verified_claim(env)
    assert SLUG not in [i["slug"] for i in run(s.unclaimed_profiles(ADMIN))["items"]]
    assert run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Verified in error here.", reason_category="verified_in_error"))["revocation"] == "done"
    listed = next(i for i in run(s.unclaimed_profiles(ADMIN))["items"] if i["slug"] == SLUG)      # the team's list
    assert listed["publication"] == "published"
    public = next(b for b in run(s.search(trust="unclaimed"))["items"] if b["slug"] == SLUG)      # the directory and its services
    assert public["claimed"] is False and public["held_requests_open"] is True
    assert run(s.hold_request(SLUG, BUYER))["status"] == "held"      # requests are kept again
    assert run(s.start_claim(U(OUTSIDER), SLUG))["status"] == "claim_started"      # someone else can claim it
    assert run(s.start_claim(U(NEW), SLUG))["status"] == "claim_started"      # and so can the same person, starting again


def test_a_revoke_takes_back_unanswered_requests_and_keeps_answered_ones():
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, "public"))
    unanswered = run(s.hold_request(SLUG, BUYER))["id"]
    answered = run(s.hold_request(SLUG, {**BUYER, "email": "bo@buyer.test", "name": "Bo Buyer"}))["id"]
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))
    business = s.store.rows["claims"][claim["id"]]["data"]["linked_business_id"]

    def answer(data):
        for r in data["financials"]["rfq_requests"]:
            if r["id"] == answered:
                r.update(status="approved", quote_id="q1")
    run(s.business.mutate(business, answer))
    run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Verified in error here.", reason_category="verified_in_error"))
    left = run(s.business.load(business))["financials"]["rfq_requests"]
    assert [r["id"] for r in left] == [answered]
    assert s.store.rows["requests"][unanswered]["status"] == "held" and "delivered_to" not in s.store.rows["requests"][unanswered]["data"]
    assert s.store.rows["requests"][answered]["status"] == "delivered"
    assert [r["id"] for r in run(s.waiting_requests(ADMIN, SLUG))["items"]] == [unanswered]
    # the next verified owner receives it
    again = waiting_claim(env, user=OWNER, target="new")
    run(s.review_decision(ADMIN, again["id"], decision="approve", reason="The real director, checked."))
    next_business = s.store.rows["claims"][again["id"]]["data"]["linked_business_id"]
    assert [r["id"] for r in run(s.business.load(next_business))["financials"]["rfq_requests"]] == [unanswered]


def revoked_new_workspace(env):
    s = svc_of(env)
    index(env)
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))
    business = s.store.rows["claims"][claim["id"]]["data"]["linked_business_id"]
    run(s.business.mutate(business, lambda data: data.update(note="added by them")))
    env.businesses[business]["members"] = {"m1": {"role": "member"}}
    run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Verified in error here.", reason_category="verified_in_error"))
    return s, claim, business


def test_a_workspace_the_claim_created_is_closed_with_it_and_can_be_restored():
    env = Env()
    s, claim, business = revoked_new_workspace(env)
    assert business not in [b["id"] for b in run(s.business.owned_by(NEW))]
    for person in (NEW, "m1"):
        with pytest.raises(BusinessAccessDenied):
            run(s.business.actor(person, business, {}))
    row = decided(s)[0]
    assert row["workspace"]["state"] == "closed" and "members" not in row["workspace"] and "owner_id" not in row["workspace"]
    assert s.sent_decisions[-1]["workspace_closed"] is True
    assert run(s.restore_workspace(ADMIN, claim["id"]))["workspace"] == "restored"
    assert business in [b["id"] for b in run(s.business.owned_by(NEW))]
    assert run(s.business.load(business))["note"] == "added by them"
    run(s.business.actor("m1", business, {}))      # the member is back
    assert decided(s)[0]["workspace"]["state"] == "restored" and decided(s)[0]["outcome"] == "removed"      # the claim stays revoked
    with pytest.raises(Conflict):
        run(s.restore_workspace(ADMIN, claim["id"]))


def test_the_email_points_to_another_workspace_or_to_creating_one(monkeypatch):
    env = Env()
    s, _claim, _business = revoked_new_workspace(env)
    assert s.sent_decisions[-1]["other_workspace"] is False      # the claim's workspace was their only one
    env2 = Env()
    run(env2.orch.rt.business.create(NEW, "Already mine", {}))
    s2, _claim2, _business2 = revoked_new_workspace(env2)
    assert s2.sent_decisions[-1]["other_workspace"] is True
    sent = {}

    async def fake(**kw):
        sent.update(kw)
        return SimpleNamespace(sent=True)
    monkeypatch.setattr("app.shared.email.resend.send_email_via_resend", fake)
    run(d._email_decision({"to": "a@b.test", "kind": "claim_revoked", "business_name": "Acme", "link": "/x", "workspace_closed": True, "other_workspace": True}))
    assert "other workspace" in sent["text_content"] and "/dashboard" in sent["text_content"]
    assert "has been closed" in sent["text_content"] and "within 30 days" in sent["text_content"] and "/x" not in sent["text_content"]
    run(d._email_decision({"to": "a@b.test", "kind": "claim_revoked", "business_name": "Acme", "link": "/x", "workspace_closed": True, "other_workspace": False}))
    assert "create a new workspace" in sent["text_content"] and "/onboarding" in sent["text_content"]


def test_their_other_workspace_and_its_data_are_untouched_by_the_close_the_restore_and_the_delete():
    env = Env()
    other = run(env.orch.rt.business.create(NEW, "Already mine", {"financials": {"rfq_requests": [{"id": "own", "status": "pending"}]}, "catalogue": {"products": [{"id": "p1"}]}}))
    env.businesses[other]["members"] = {"m2": {"role": "member"}}
    before = json.dumps(env.businesses[other], sort_keys=True, default=str)
    s, claim, business = revoked_new_workspace(env)
    assert business != other and json.dumps(env.businesses[other], sort_keys=True, default=str) == before
    assert [b["id"] for b in run(s.business.owned_by(NEW))] == [other]
    run(s.restore_workspace(ADMIN, claim["id"]))
    assert json.dumps(env.businesses[other], sort_keys=True, default=str) == before
    run(s.business.close(business))      # closed again, then its 30 days run out
    s.store.rows["claims"][claim["id"]]["data"]["workspace_hold"].update(state="closed", until="2000-01-01T00:00:00+00:00")
    assert run(s.sweep_closed_workspaces()) == 1 and business not in env.businesses
    assert json.dumps(env.businesses[other], sort_keys=True, default=str) == before


def test_a_closed_workspace_is_deleted_after_30_days_and_not_before():
    env = Env()
    s, claim, business = revoked_new_workspace(env)
    start = s.clock()
    s.clock = lambda: start + timedelta(days=29)
    assert run(s.sweep_closed_workspaces()) == 0 and business in env.businesses
    s.clock = lambda: start + timedelta(days=31)
    assert run(s.sweep_closed_workspaces()) == 1 and business not in env.businesses
    assert decided(s)[0]["workspace"]["state"] == "deleted"
    with pytest.raises(Conflict):
        run(s.restore_workspace(ADMIN, claim["id"]))
    assert run(s.sweep_closed_workspaces()) == 0


def test_a_restored_workspace_is_never_swept():
    env = Env()
    s, claim, business = revoked_new_workspace(env)
    start = s.clock()
    run(s.restore_workspace(ADMIN, claim["id"]))
    s.clock = lambda: start + timedelta(days=31)
    assert run(s.sweep_closed_workspaces()) == 0 and business in env.businesses


def test_a_workspace_they_already_had_stays_theirs_after_a_revoke():
    env = Env()
    s = svc_of(env)
    index(env)
    claim = waiting_claim(env, user=OWNER, target="A")
    run(s.review_decision(ADMIN, claim["id"], decision="approve", reason="Director on the filing."))
    run(s.review_decision(ADMIN, claim["id"], decision="revoke", reason="Verified in error here.", reason_category="verified_in_error"))
    assert "A" in [b["id"] for b in run(s.business.owned_by(OWNER))]
    assert decided(s)[0]["workspace"] is None and s.sent_decisions[-1]["workspace_closed"] is False


def test_only_the_team_can_restore_a_workspace():
    env = Env()
    s, claim, _business = revoked_new_workspace(env)
    with pytest.raises(Forbidden):
        run(s.restore_workspace(U(NEW), claim["id"]))


def test_a_rejected_claim_has_nothing_to_revoke():
    env = Env()
    s = svc_of(env)
    index(env)
    claim = waiting_claim(env)
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="Nothing supports this."))
    assert row_of(s)["revocable"] is False


def test_a_report_names_its_business_and_sender_for_the_team_but_not_for_the_business_itself():
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.report(SLUG, kind="unlist", message="We have ceased trading.", reporter_email="Someone@Example.com"))
    run(s.report(SLUG, kind="correction", message="The address is wrong."))
    rows = run(s.review_queue(ADMIN))["reports"]
    assert {r["profile"]["slug"] for r in rows} == {SLUG} and rows[0]["profile"]["name"]
    assert {r["reporter_email"] for r in rows} == {"someone@example.com", None}
    verified_claim(env)
    run(s.add_team_member(ADMIN, NEW))      # now on the team, and holding the profile the reports are about
    mine = run(s.review_queue(U(NEW)))["reports"]
    assert {r["reporter_email"] for r in mine} == {None} and all(r["needs_another_reviewer"] for r in mine)


def test_only_the_team_can_see_decisions():
    env = Env()
    s = svc_of(env)
    with pytest.raises(Forbidden):
        run(s.decisions(U(OUTSIDER)))
    run(s.add_team_member(ADMIN, "reviewer@enterprate.test"))
    assert run(s.decisions({"id": "r1", "email": "reviewer@enterprate.test"}))["items"] == []


def test_the_decisions_api(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_optional_user] = lambda: None
    try:
        client = TestClient(app, raise_server_exceptions=False)
        app.dependency_overrides[get_current_user] = lambda: dict(ADMIN)
        assert client.get("/admin/marketplace/decisions").json()["items"] == []
        app.dependency_overrides[get_current_user] = lambda: U(OUTSIDER)
        assert client.get("/admin/marketplace/decisions").status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("kind", ["claim_approved", "verification_approved", "claim_rejected", "claim_revoked", "listing_approved", "listing_suppressed"])
def test_the_emails_read_properly_and_are_safe(monkeypatch, kind):
    sent = {}

    async def fake(**kw):
        sent.update(kw)
        return SimpleNamespace(sent=True)
    monkeypatch.setattr("app.shared.email.resend.send_email_via_resend", fake)
    assert run(d._email_decision({"to": "a@b.test", "kind": kind, "business_name": "<b>Acme</b>", "link": "/marketplace/claim/acme", "reason": "Because <reasons>", "requests": 2, "key": "k"})) is True
    assert sent["to_email"] == "a@b.test" and sent["idempotency_key"] == "k"
    assert "<b>Acme" not in sent["html_content"] and "&lt;b&gt;Acme" in sent["html_content"] and "/marketplace/claim/acme" in sent["text_content"]
    assert "Next step:" in sent["text_content"]
    for dash in ("–", "—"):
        assert dash not in sent["text_content"] and dash not in sent["subject"]


def test_a_mailer_that_says_it_could_not_send_counts_as_failed(monkeypatch):
    async def fake(**_kw):
        return SimpleNamespace(sent=False)
    monkeypatch.setattr("app.shared.email.resend.send_email_via_resend", fake)
    assert run(d._email_decision({"to": "a@b.test", "kind": "claim_approved", "business_name": "Acme", "link": "/x"})) is False
