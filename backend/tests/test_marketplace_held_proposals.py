"""Proposals for a profile nobody has claimed (the owner, 9 Nov): the team opens a profile for proposals, or
publishes an RFP for it. Replies are kept like quotes and questions, and go to the business's Proposals inbox once its claim is verified."""
import pytest

from app.modules.marketplace.directory import Conflict, Forbidden, Invalid
from test_agent import run
from test_marketplace_claim import ADMIN, NEW, U, verified_claim
from test_marketplace_held_requests import QUESTION, SLUG, inbox, public_env, rows

PROPOSAL = {"kind": "proposal", "name": "Pat Supplier", "email": "pat@supplier.test", "company": "Supplier Ltd",
            "title": "Managed IT for your offices", "details": "Monthly support for 20 seats, on site within a day."}


def proposals(env, business_id):
    return env.businesses[business_id]["data"].get("proposal_inbox") or []


def test_a_proposal_needs_the_profile_opened_by_the_team():
    env, s = public_env()
    assert run(s.public_profile(SLUG))["held_proposals_open"] is False
    with pytest.raises(Conflict):
        run(s.hold_request(SLUG, PROPOSAL))
    assert run(s.set_held_proposals(ADMIN, SLUG, True))["proposals_open"] is True
    assert run(s.public_profile(SLUG))["held_proposals_open"] is True
    row = next(p for p in run(s.unclaimed_profiles(ADMIN))["items"] if p["slug"] == SLUG)
    assert row["proposals_open"] is True
    assert run(s.hold_request(SLUG, PROPOSAL))["status"] == "held"
    assert [e["kind"] for e in s.store.rows["events"].values() if e["kind"].startswith("HeldProposals")] == ["HeldProposalsOpened"]
    run(s.set_held_proposals(ADMIN, SLUG, False))
    with pytest.raises(Conflict):
        run(s.hold_request(SLUG, {**PROPOSAL, "email": "other@supplier.test"}))


def test_a_proposal_needs_a_title_and_a_real_description():
    env, s = public_env()
    run(s.set_held_proposals(ADMIN, SLUG, True))
    with pytest.raises(Invalid) as e:
        run(s.hold_request(SLUG, {**PROPOSAL, "title": "", "details": "Short"}))
    assert {"title", "details"} <= set(e.value.errors)


RFP = {"title": "Office fit-out in Leeds", "description": "We need a contractor to fit out a 2,000 sq ft office by March.", "budget_range": "20000 - 30000", "deadline": "2099-01-31", "requirements": ["Insurance certificate"]}


def test_only_the_team_opens_a_profile_or_publishes_for_it():
    env, s = public_env()
    with pytest.raises(Forbidden):
        run(s.set_held_proposals(U(NEW), SLUG, True))
    with pytest.raises(Forbidden):
        run(s.publish_rfp(U(NEW), SLUG, RFP))


def test_the_team_publishes_an_rfp_listed_like_any_other_and_replies_are_kept():
    env, s = public_env()
    with pytest.raises(Invalid) as e:
        run(s.publish_rfp(ADMIN, SLUG, {**RFP, "title": "", "description": "short", "deadline": "2000-01-01"}))
    assert {"title", "description", "deadline"} <= set(e.value.errors)
    rfp = run(s.publish_rfp(ADMIN, SLUG, RFP))
    listed = run(s.public_rfps())
    assert [(r["id"], r["company_name"], r["directory_slug"], r["workspace_id"], r["status"]) for r in listed] == [(rfp["id"], "Northwind Advisory Ltd", SLUG, None, "PUBLISHED")]
    assert "published_by_team" not in listed[0]
    # A reply needs no "open for proposals": the RFP itself takes them, and its title comes with it.
    reply = run(s.hold_request(SLUG, {**PROPOSAL, "title": "", "request_id": rfp["id"]}))
    waiting = run(s.waiting_requests(ADMIN, SLUG))["items"]
    assert waiting[0]["id"] == reply["id"] and waiting[0]["request_title"] == "Office fit-out in Leeds" and waiting[0]["title"] == "Office fit-out in Leeds"
    assert run(s.profile_rfps(ADMIN, SLUG))["items"][0]["replies_waiting"] == 1
    run(s.close_rfp(ADMIN, SLUG, rfp["id"]))
    assert run(s.public_rfps()) == []
    with pytest.raises(Conflict):
        run(s.hold_request(SLUG, {**PROPOSAL, "email": "late@supplier.test", "request_id": rfp["id"]}))


def test_a_verified_claim_puts_proposals_in_the_proposals_inbox_and_hands_over_the_rfp():
    env, s = public_env()
    run(s.set_held_proposals(ADMIN, SLUG, True))
    p = run(s.hold_request(SLUG, PROPOSAL))
    rfp = run(s.publish_rfp(ADMIN, SLUG, RFP))
    reply = run(s.hold_request(SLUG, {**PROPOSAL, "email": "rfp@supplier.test", "request_id": rfp["id"]}))
    q = run(s.hold_request(SLUG, QUESTION))
    claim = verified_claim(env)
    assert claim["requests_delivered"] == 3
    got = {x["id"]: x for x in proposals(env, claim["business_id"])}
    assert set(got) == {p["id"], reply["id"]}
    mine = got[p["id"]]
    assert (mine["status"], mine["title"], mine["summary"], mine["proposer_name"], mine["proposer_email"], mine["recipient_workspace_id"], mine["request_id"]) == (
        "SUBMITTED", "Managed IT for your offices", PROPOSAL["details"], "Supplier Ltd", "pat@supplier.test", claim["business_id"], None)
    assert (got[reply["id"]]["request_id"], got[reply["id"]]["request_title"]) == (rfp["id"], "Office fit-out in Leeds")
    own = env.businesses[claim["business_id"]]["data"]["proposal_requests"]
    assert [(r["id"], r["status"], r["workspace_id"]) for r in own] == [(rfp["id"], "PUBLISHED", claim["business_id"])]
    assert run(s.public_rfps()) == []      # listed from the business's own workspace now
    assert [r["id"] for r in inbox(env, claim["business_id"])] == [q["id"]]      # the question stays a request
    assert all(r["status"] == "delivered" for r in rows(s))
    with pytest.raises(Conflict):      # claimed: it chooses for itself now
        run(s.set_held_proposals(ADMIN, SLUG, False))
    with pytest.raises(Conflict):
        run(s.publish_rfp(ADMIN, SLUG, RFP))


def test_the_marketplace_rfp_list_and_page_show_it(monkeypatch):
    from app.modules.marketplace import directory_router, service as mp

    env, s = public_env()
    rfp = run(s.publish_rfp(ADMIN, SLUG, RFP))

    async def no_workspaces(*_a, **_k):
        return []
    monkeypatch.setattr(mp, "sb_select", no_workspaces)
    monkeypatch.setattr(directory_router, "get_service", lambda: s)
    monkeypatch.setattr(directory_router, "enabled", lambda: True)
    listed = run(mp.list_public_proposal_requests(search="fit-out"))
    assert listed["total"] == 1 and listed["items"][0]["id"] == rfp["id"] and listed["items"][0]["directory_slug"] == SLUG
    assert run(mp.list_public_proposal_requests(search="plumbing"))["total"] == 0
    assert run(mp.get_public_proposal_request(request_id=rfp["id"]))["title"] == "Office fit-out in Leeds"
