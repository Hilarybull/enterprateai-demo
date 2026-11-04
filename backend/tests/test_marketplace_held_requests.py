"""Quotes and questions left on a profile nobody has claimed: open to the public, private until a claim is
verified, then handed to the business that proved it manages the profile, once, with nothing lost."""
import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.marketplace.directory import Conflict, Forbidden, Invalid, NotFound, RateLimited
from app.shared.auth.deps import get_current_user, get_optional_user
from test_agent import OUTSIDER, OWNER, Env, run
from test_marketplace_claim import ADMIN, NEW, NORTHWIND, U, index, svc_of, verified_claim
from test_marketplace_self_created import prepared

SLUG = "northwind-advisory-ltd-leeds"
BUYER = {"kind": "quote", "name": "Ada Buyer", "email": "ada@buyer.test", "company": "Buyer Ltd", "items": [{"name": "Pricing", "quantity": 2, "notes": None}, {"name": "Strategy", "quantity": 1}], "details": "For 3 shops in York."}
QUESTION = {"kind": "enquiry", "name": "Ben Asker", "email": "ben@buyer.test", "details": "Do you work with charities?"}


def public_env(level="public"):
    env = Env()
    s = svc_of(env)
    index(env)
    run(s.set_visibility(ADMIN, level))
    return env, s


def rows(s):
    return list(s.store.rows["requests"].values())


def inbox(env, business_id):
    return (env.businesses[business_id]["data"].get("financials") or {}).get("rfq_requests") or []


def test_anyone_can_leave_one_and_nothing_private_shows():
    env, s = public_env()
    before = set(env.businesses)
    saved = run(s.hold_request(SLUG, BUYER))
    assert saved["status"] == "held" and saved["new"] is True
    assert set(env.businesses) == before      # no business, no account
    page = run(s.public_profile(SLUG))
    assert page["held_requests_open"] is True and page["requests_waiting"] == 1
    assert "ada@buyer.test" not in json.dumps(page, default=str) and "3 shops" not in json.dumps(page, default=str)
    held_events = [e for e in s.store.rows["events"].values() if e["kind"] == "HeldRequestReceived"]
    assert len(held_events) == 1 and "ada@buyer.test" not in json.dumps(held_events[0]["data"], default=str)
    # Searchable as open for these two, and the business's own opportunity settings stay untouched.
    assert run(s.search(open_for="rfqs"))["total"] == 1 and run(s.search(open_for="enquiries"))["total"] == 1 and run(s.search(open_for="partnerships"))["total"] == 0
    assert page["opportunities"]["rfqs"] is False


def test_it_needs_a_real_name_email_and_request():
    env, s = public_env()
    for bad, field in (({**BUYER, "name": ""}, "name"), ({**BUYER, "email": "nope"}, "email"), ({**BUYER, "items": []}, "items"), ({**QUESTION, "details": ""}, "details")):
        with pytest.raises(Invalid) as e:
            run(s.hold_request(SLUG, bad))
        assert field in e.value.errors
    assert rows(s) == []


def test_a_hidden_or_archived_profile_takes_none_but_an_invitation_opens_it():
    env, s = public_env("invite_only")
    with pytest.raises(NotFound):
        run(s.hold_request(SLUG, BUYER))
    token = run(s.create_invitation(ADMIN, SLUG, reason="profile_control"))["link"].split("invite=")[1]
    assert run(s.hold_request(SLUG, BUYER, via={"invitation": token}))["status"] == "held"
    run(s.set_visibility(ADMIN, "public"))
    run(s.moderate_profile(ADMIN, SLUG, action="archive", reason="Closed last year"))
    with pytest.raises(NotFound):
        run(s.hold_request(SLUG, QUESTION))


def test_a_double_click_is_one_request_and_one_sender_is_limited():
    env, s = public_env()
    first = run(s.hold_request(SLUG, BUYER))
    again = run(s.hold_request(SLUG, BUYER))
    assert again["id"] == first["id"] and again["new"] is False and len(rows(s)) == 1
    for n in range(4):
        run(s.hold_request(SLUG, {**BUYER, "items": [{"name": f"Another thing {n}"}]}))
    with pytest.raises(RateLimited):
        run(s.hold_request(SLUG, {**BUYER, "items": [{"name": "One too many"}]}))


def test_a_verified_claim_hands_over_everything_with_the_real_dates_and_only_once():
    env, s = public_env()
    a = run(s.hold_request(SLUG, BUYER))
    b = run(s.hold_request(SLUG, QUESTION))
    sent_at = {str(r["id"]): str(r["created_at"]) for r in rows(s)}
    claim = verified_claim(env)
    assert claim["status"] == "verified" and claim["requests_delivered"] == 2
    got = {r["id"]: r for r in inbox(env, claim["business_id"])}
    assert set(got) == {a["id"], b["id"]}
    quote = got[a["id"]]
    assert (quote["customer_name"], quote["customer_email"], quote["customer_company"], quote["status"]) == ("Ada Buyer", "ada@buyer.test", "Buyer Ltd", "pending")
    assert [(i["name"], i["quantity"]) for i in quote["items"]] == [("Pricing", 2), ("Strategy", 1)] and quote["message"] == "For 3 shops in York." and quote["created_at"] == sent_at[a["id"]]
    assert got[b["id"]]["message"] == "Do you work with charities?" and got[b["id"]]["items"][0]["name"] == "A question"
    assert all(r["status"] == "delivered" and r["data"]["delivered_to"] == claim["business_id"] for r in rows(s))
    # Running it again, as a retry would, changes nothing.
    profile_id = rows(s)[0]["subject_id"]
    assert run(s._deliver_held(profile_id, claim["business_id"])) == 0 and len(inbox(env, claim["business_id"])) == 2
    with pytest.raises(Conflict):      # and from now on the business's own listing takes them
        run(s.hold_request(SLUG, {**BUYER, "items": [{"name": "After the claim"}]}))


def test_they_stay_private_until_authority_is_shown_and_a_rejected_claim_gets_nothing():
    env, s = public_env()
    run(s.hold_request(SLUG, BUYER))
    claim = run(s.start_claim(U(NEW), SLUG))
    claim = run(s.confirm_match(U(NEW), claim["id"], "new"))
    claim = run(s.start_verification(U(NEW), claim["id"], method="manual", note="I run this company and can show the filing."))
    assert "ada@buyer.test" not in json.dumps(claim, default=str)
    queue = run(s.review_queue(ADMIN))
    assert "ada@buyer.test" not in json.dumps(queue, default=str)      # reviewers see the claim, not the buyer
    run(s.review_decision(ADMIN, claim["id"], decision="reject", reason="The filing shows someone else."))
    assert [r["status"] for r in rows(s)] == ["held"] and not any(inbox(env, b) for b in env.businesses)
    # The real owner claims it later and gets it.
    done = verified_claim(env, user="owner@northwind.test")
    assert [r["customer_email"] for r in inbox(env, done["business_id"])] == ["ada@buyer.test"]


def test_the_team_can_read_the_requests_in_full_and_who_looked_is_kept():
    env, s = public_env()
    run(s.hold_request(SLUG, BUYER))
    read = run(s.waiting_requests(ADMIN, SLUG))
    assert read["items"][0]["email"] == "ada@buyer.test" and read["items"][0]["kind"] == "quote"
    viewed = [e for e in s.store.rows["events"].values() if e["kind"] == "HeldRequestsViewed"]
    assert len(viewed) == 1 and "ada@buyer.test" not in json.dumps(viewed[0], default=str)


def test_someone_outside_the_team_or_with_a_claim_on_the_profile_can_not_read_them():
    env, s = public_env()
    run(s.hold_request(SLUG, BUYER))
    with pytest.raises(Forbidden):
        run(s.waiting_requests(U(NEW), SLUG))
    run(s.add_team_member(ADMIN, NEW))
    run(s.start_claim(U(NEW), SLUG))      # a team member who is also after this business
    with pytest.raises(Forbidden):
        run(s.waiting_requests(U(NEW), SLUG))


def test_the_team_sees_how_many_wait_never_who_and_can_invite_truthfully():
    env, s = public_env()
    with pytest.raises(Invalid):      # nothing waiting: an opportunity invitation stays refused
        run(s.create_invitation(ADMIN, SLUG, reason="opportunity"))
    run(s.hold_request(SLUG, BUYER))
    listed = run(s.unclaimed_profiles(ADMIN))
    assert listed["items"][0]["requests_waiting"] == 1 and "ada@buyer.test" not in json.dumps(listed, default=str)
    invite = run(s.create_invitation(ADMIN, SLUG, reason="opportunity"))
    assert invite["reason"] == "opportunity"
    saved = next(i for i in s.store.rows["invitations"].values() if i["id"] == invite["id"])
    assert saved["data"]["opportunity_ref"].startswith("held:")      # the source is kept (AC-17)


def test_a_handover_that_fails_keeps_them_and_a_later_step_finishes_it(monkeypatch):
    env, s = public_env()
    run(s.hold_request(SLUG, BUYER))
    real = s.business.mutate
    calls = {"n": 0}

    async def flaky(business_id, fn):
        if getattr(fn, "__name__", "") == "put" and calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("database down")
        return await real(business_id, fn)
    monkeypatch.setattr(s.business, "mutate", flaky)
    claim = verified_claim(env)
    assert claim["status"] == "verified" and [r["status"] for r in rows(s)] == ["held"]      # the claim itself still stands
    run(s.complete_handoff(U(NEW), claim["id"]))
    assert [r["status"] for r in rows(s)] == ["delivered"] and len(inbox(env, claim["business_id"])) == 1


def test_the_api_needs_no_account(monkeypatch):
    env, s = public_env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_optional_user] = lambda: None
    app.dependency_overrides[get_current_user] = lambda: dict(ADMIN)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        sent = client.post(f"/marketplace/businesses/{SLUG}/requests", json=BUYER)
        assert sent.status_code == 201 and sent.json()["status"] == "held" and "new" not in sent.json()
        assert client.post(f"/marketplace/businesses/{SLUG}/requests", json={**BUYER, "email": "bad"}).status_code == 422
        assert client.post("/marketplace/businesses/nobody-here/requests", json=BUYER).status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_a_logo_is_kept_on_the_profile_shown_publicly_and_carried_to_a_new_business():
    env, s = public_env()
    logo = "data:image/png;base64,iVBORw0KGgo="
    run(s.edit_profile(ADMIN, SLUG, {"logo_data_url": logo}, "Their logo"))
    assert run(s.public_profile(SLUG))["logo_data_url"] == logo and run(s.search())["items"][0]["logo_data_url"] == logo
    assert run(s.unclaimed_profiles(ADMIN))["items"][0]["has_logo"] is True
    assert "iVBOR" not in json.dumps(run(s.profile_sources(ADMIN, SLUG))["edits"], default=str)      # the history doesn't keep a copy
    with pytest.raises(Invalid):
        run(s.edit_profile(ADMIN, SLUG, {"logo_data_url": "data:text/html;base64,PHNjcmlwdD4="}, "Not an image"))
    with pytest.raises(Invalid):
        run(s.edit_profile(ADMIN, SLUG, {"logo_data_url": "data:image/png;base64," + "A" * 70000}, "Too big"))
    claim = verified_claim(env)
    assert env.businesses[claim["business_id"]]["data"]["workspace_profile"]["logo_data_url"] == logo


def test_ai_fill_for_services_lists_clean_names_and_saves_nothing():
    env, s = public_env()

    async def writer(_prompt):
        return "Roofing, Roof repairs; Guttering, a very long sentence that is not a service name at all, Roofing"
    out = run(s.suggest_index_services(ADMIN, {"name": "Francal", "category": "Construction & Trades"}, writer))
    assert out["suggestion"] == "Roofing, Roof repairs, Guttering"
    with pytest.raises(Invalid):
        run(s.suggest_index_services(ADMIN, {"name": "Francal"}, writer))


def second_workspace(env, s, name="Second Co"):
    return run(s.business.create(OWNER, name, {"workspace_profile": {"company_name": name}}))


def test_claiming_into_an_existing_workspace_reaches_only_that_one_and_changes_nothing_else():
    env, s = public_env()
    env.businesses["A"]["data"].setdefault("financials", {})["rfq_requests"] = [{"id": "old", "status": "pending", "customer_email": "old@buyer.test"}]
    before = copy.deepcopy(env.businesses["A"]["data"]["workspace_profile"])
    other = second_workspace(env, s)
    run(s.hold_request(SLUG, BUYER))
    claim = verified_claim(env, user=OWNER, target="A")
    assert claim["business_id"] == "A" and claim["requests_delivered"] == 1
    assert [r["id"] != "old" and r["customer_email"] for r in inbox(env, "A")] == [False, "ada@buyer.test"]      # added to what was there
    assert inbox(env, other) == []
    assert env.businesses["A"]["data"]["workspace_profile"] == before      # the owner's profile is master data


def test_claiming_as_a_new_workspace_leaves_the_others_alone_and_starts_with_what_buyers_saw():
    env = Env()
    s = svc_of(env)
    index(env, {**NORTHWIND, "country": "Canada"})
    run(s.set_visibility(ADMIN, "public"))
    run(s.hold_request(SLUG, BUYER))
    existing = set(env.businesses)
    claim = verified_claim(env, user=OWNER, target="new")
    made = claim["business_id"]
    assert made not in existing and env.businesses[made]["owner"] == OWNER
    assert claim["requests_delivered"] == 1 and [r["customer_email"] for r in inbox(env, made)] == ["ada@buyer.test"] and inbox(env, "A") == []
    data = env.businesses[made]["data"]
    assert [x["service_name"] for x in data["workspace_profile"]["services"]] == ["Strategy", "Pricing"]      # the services the buyer chose from
    assert data["settings"]["currency"] == "CAD"


def test_verifying_a_self_made_profile_that_merges_into_the_sourced_one_gets_the_requests():
    env = Env()
    s = prepared(env, website="northwind-advisory.co.uk", registration_number="12345678")
    run(s.activate(U(OWNER), "A"))
    index(env)
    run(s.set_visibility(ADMIN, "public"))
    run(s.hold_request(SLUG, BUYER))
    claim = run(s.start_self_verification(U(OWNER), "A"))
    sent = run(s.start_verification(U(OWNER), claim["id"], method="email_domain", email="owner@northwind-advisory.co.uk"))
    done = run(s.complete_verification(U(OWNER), claim["id"], sent["verification"]["id"], s.sent_codes[-1][1]))
    assert done["status"] == "verified" and done["requests_delivered"] == 1
    assert [r["customer_email"] for r in inbox(env, "A")] == ["ada@buyer.test"]


def test_after_an_upheld_challenge_the_new_holder_is_not_told_the_old_requests_are_theirs():
    env, s = public_env()
    run(s.hold_request(SLUG, BUYER))
    verified_claim(env, user=OWNER, target="A")
    challenge = run(s.start_claim(U(OUTSIDER), SLUG))
    challenge = run(s.confirm_match(U(OUTSIDER), challenge["id"], "B"))
    challenge = run(s.start_verification(U(OUTSIDER), challenge["id"], method="manual", note="I am the registered director and can show the filing."))
    run(s.review_decision(ADMIN, challenge["id"], decision="approve", reason="Filing checked; this person is the director."))
    won = run(s.get_claim(U(OUTSIDER), challenge["id"]))
    assert won["business_id"] == "B" and won["requests_delivered"] == 0 and inbox(env, "B") == []
