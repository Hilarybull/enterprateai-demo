"""Marketplace requests for a quotation, handed to the Agent (Enquiry to Quote).

The real Marketplace service functions and the real orchestrator run together here, over
the in-memory business records, so the request and its task are exercised as one thing.
"""
import copy
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app.modules.agent import rfq as agent_rfq
from app.modules.agent import router as agent_router
from app.modules.agent.orchestrator import Conflict
from app.modules.agent.services import InsufficientCredits
from app.modules.marketplace import service as mkt
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run

BUYER = {"customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test"}
WORKSHOPS = [{"name": "Strategy Workshop", "quantity": 2, "notes": None}]


class Market:
    """The Marketplace's own storage and outside services, pointed at the test environment."""

    def __init__(self, monkeypatch, env):
        self.env, self.emails = env, []
        env.businesses["A"]["data"]["marketplace"] = {"is_active": True}
        env.businesses["B"]["data"]["marketplace"] = {"is_active": True}

        async def select(table, filters=None, single=False, **_):
            wid = {f[0]: f[2] for f in filters or []}["id"]
            b = env.businesses.get(wid)
            return {"id": wid, "user_id": b["owner"], "data": copy.deepcopy(b["data"])} if b else None

        async def update(table, filters=None, payload=None, **_):
            env.businesses[{f[0]: f[2] for f in filters}["id"]]["data"] = copy.deepcopy(payload["data"])

        async def load(user_id, workspace_id=None):
            return await select("workspaces", [("id", "eq", workspace_id or "A")])

        async def nothing(*_, **__):
            return None

        async def paid(owner_id):
            return (await env.meter.plan(owner_id)) != "explorer"

        async def email(**message):
            self.emails.append(message)

        @asynccontextmanager
        async def guard(user_id, feature):
            try:
                async with env.meter.charge(user_id, feature):
                    yield
            except InsufficientCredits as e:
                raise HTTPException(status_code=402, detail={"error": "INSUFFICIENT_CREDITS"}) from e

        for name, fake in (("sb_select", select), ("sb_update", update), ("_load_workspace", load), ("require_rfq_access", nothing),
                           ("has_paid_access", paid), ("send_email_via_resend", email), ("credit_guard", guard),
                           ("_build_quotation_pdf", lambda *_: b"")):
            monkeypatch.setattr(mkt, name, fake)
        monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)

    def request(self, items=None, message="Could you quote for two workshops in May, please?", buyer=None, **more):
        return run(mkt.submit_rfq(workspace_id="A", items=copy.deepcopy(items or WORKSHOPS), message=message, **(buyer or BUYER), **more))

    def rows(self):
        return run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))["items"]

    def row(self, rfq_id):
        return next(r for r in self.rows() if r["id"] == rfq_id)

    def runs(self):
        return run(self.env.store.list_runs("A"))

    def task(self, rfq):
        """The task for one request (tasks made in the same instant have no order of their own)."""
        return next(r for r in self.runs() if r["state"].get("rfq_id") == rfq["id"])

    def reply_by_hand(self, rfq_id, user=OWNER):
        return run(mkt.approve_rfq(user_id=user, workspace_id="A", rfq_id=rfq_id,
                                   item_prices=[{"product_name": "Strategy Workshop", "unit_price": 1400}]))


@pytest.fixture
def market(monkeypatch):
    return Market(monkeypatch, Env())


# ══ 1. the request becomes one task ═══════════════════════════════════════════

def test_a_request_starts_exactly_one_task_however_often_it_arrives(market):
    env = market.env
    rfq = market.request()
    [r] = market.runs()
    assert (r["workflow_key"], r["source_channel"], r["source_reference"]) == ("enquiry_to_quote", "marketplace_rfq", f"rfq:{rfq['id']}")
    assert r["state"]["rfq_id"] == rfq["id"] and r["requester_id"] == OWNER
    enquiry = run(env.store.get_enquiry(r["state"]["enquiry_id"]))
    assert (enquiry["source"], enquiry["sender_name"], enquiry["sender_email"]) == ("marketplace_rfq", "BrightTech Ltd", "buyer@brighttech.test")
    assert "2 x Strategy Workshop" in enquiry["body"] and "two workshops in May" in enquiry["body"]
    # The buyer's browser sends it again; the hand-off is repeated; the owner asks from the row.
    again = market.request()
    assert again["id"] == rfq["id"] and len(env.fin["rfq_requests"]) == 1
    run(agent_rfq.received(env.orch, "A", rfq["id"]))
    asked = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action", source_reference="anything")
    assert asked["duplicate"] is True and asked["run"]["id"] == r["id"]
    assert len(market.runs()) == 1 and len(run(env.store.list_enquiries("A"))) == 1
    # A different request is a different task.
    other = market.request(items=[{"name": "Financial Review", "quantity": 1}])
    assert other["id"] != rfq["id"] and len(market.runs()) == 2


def test_the_request_carries_the_buyers_company_and_date_into_the_enquiry(market):
    rfq = market.request(buyer={"customer_name": "Dana Okoro", "customer_email": "dana@novalabs.test"},
                         customer_company="Nova Labs", needed_by="2026-11-15", listing="Apex Consulting")
    [r] = market.runs()
    enquiry = run(market.env.store.get_enquiry(r["state"]["enquiry_id"]))
    assert enquiry["sender_name"] == "Nova Labs" and "Needed by: 2026-11-15" in enquiry["body"] and "Listing: Apex Consulting" in enquiry["body"]
    q = market.env.fin["quotes"][0]
    assert (q["customer_name"], q["contact_name"], q["customer_email"], q["rfq_id"]) == ("Nova Labs", "Dana Okoro", "dana@novalabs.test", rfq["id"])


# ══ 2. no classify question ═══════════════════════════════════════════════════

def test_a_marketplace_request_is_a_quotation_request_without_being_asked(market):
    market.request(message="hello there")                                 # by itself, too vague to classify
    [r] = market.runs()
    assert r["status"] == "awaiting_approval" and r["pending_question"] is None
    assert (r["state"]["classification"], r["state"]["classification_method"]) == ("quotation_request", "marketplace_rfq")
    assert not any(feature == "agent_classify" for _, feature, _ in market.env.meter.charges)
    steps = run(market.env.store.list_steps(r["id"]))
    assert [s["step_key"] for s in steps][:1] == ["classify"] and not any(s["state"] == "awaiting_input" for s in steps)


def test_only_a_message_that_plainly_isnt_a_quote_request_is_asked_about(market):
    market.request(message="I want a refund. The last workshop was terrible.")
    [r] = market.runs()
    q = r["pending_question"]
    assert r["substatus"] == "waiting_for_information" and q["fields"][0]["key"] == "classification" and "reads like a complaint" in q["question"]
    assert market.env.fin["quotes"] == []
    done = run(market.env.orch.provide_input(r["id"], OWNER, {"classification": "quotation_request"}))
    assert done["status"] == "awaiting_approval" and done["state"]["classification_method"] == "user"
    # A message that mentions a proposal but asks for a price is still a quotation request.
    assert agent_rfq.doubt("Please send a proposal") == "proposal_request" and agent_rfq.doubt("How much for your proposal workshop?") is None
    assert agent_rfq.doubt("") is None and agent_rfq.doubt(None) is None


# ══ 3. the customer ═══════════════════════════════════════════════════════════

def test_the_buyer_is_matched_to_a_customer_or_drafted_as_new_and_never_merged_silently(market):
    env = market.env
    market.request()
    assert env.fin["quotes"][0]["customer_id"] == "c1"                    # same email: the customer already on record
    assert len(env.businesses["A"]["data"]["catalogue"]["customers"]) == 1
    # Someone new: a draft customer, marked as made by the Agent for this task.
    newest = market.task(market.request(buyer={"customer_name": "Nova Labs", "customer_email": "dana@novalabs.test"}))
    new = env.businesses["A"]["data"]["catalogue"]["customers"][-1]
    assert (new["name"], new["email"], new["created_by_agent"], new["agent_run_id"]) == ("Nova Labs", "dana@novalabs.test", True, newest["id"])
    # A similar name with a different address is a question, not a merge.
    asking = market.task(market.request(buyer={"customer_name": "BrightTech Limited", "customer_email": "accounts@brighttech-group.test"},
                                        items=[{"name": "Financial Review", "quantity": 1}]))
    assert asking["pending_question"]["fields"][0]["key"] == "customer_id"
    assert [o["value"] for o in asking["pending_question"]["fields"][0]["options"]] == ["c1", "new"]
    assert len(env.businesses["A"]["data"]["catalogue"]["customers"]) == 2


# ══ 4. prices come from the catalogue, or are asked for ═══════════════════════

def test_a_listed_item_is_priced_from_the_catalogue(market):
    market.request()
    q = market.env.fin["quotes"][0]
    assert [(i["description"], i["qty"], i["unit_price"], i["price_source"]) for i in q["line_items"]] == [("Strategy Workshop", "2", "1500.0", "catalogue")]
    assert q["total_amount"] == 3600.0 and q["status"] == "draft"


def test_a_missing_price_is_asked_for_in_the_task_and_never_guessed(market):
    env = market.env
    market.request(items=[{"name": "Unpriced Service", "quantity": 1}, {"name": "Strategy Workshop", "quantity": 1}])
    [r] = market.runs()
    field = r["pending_question"]["fields"][0]
    assert r["substatus"] == "waiting_for_information" and field["key"] == "items" and "Unpriced Service" in r["pending_question"]["question"]
    assert {(s["name"], s["unit_price"]) for s in field["suggested"]} == {("Strategy Workshop", 1500.0), ("Unpriced Service", "")}
    assert env.fin["quotes"] == [] and env.comms.sent == []
    done = run(env.orch.provide_input(r["id"], OWNER, {"items": [
        {"product_id": "p1", "name": "Strategy Workshop", "quantity": 1},
        {"product_id": "p3", "name": "Unpriced Service", "quantity": 1, "unit_price": 250}]}))
    assert done["status"] == "awaiting_approval"
    assert [(i["description"], i["price_source"]) for i in env.fin["quotes"][0]["line_items"]] == [
        ("Strategy Workshop", "catalogue"), ("Unpriced Service", "user_confirmed")]
    # Something that isn't in the catalogue at all, or is only nearly the name of something that is.
    near = market.task(market.request(items=[{"name": "Workshop", "quantity": 3}],
                                      buyer={"customer_name": "Nova Labs", "customer_email": "dana@novalabs.test"}))
    assert near["pending_question"]["fields"][0]["key"] == "items" and len(env.fin["quotes"]) == 1


# ══ 5. a draft, an approval, one send, one credit ═════════════════════════════

def test_the_draft_is_linked_to_the_request_and_nothing_goes_without_approval(market):
    env = market.env
    rfq = market.request()
    [r] = market.runs()
    q = env.fin["quotes"][0]
    assert r["status"] == "awaiting_approval" and (q["status"], q["rfq_id"], q["agent_run_id"]) == ("draft", rfq["id"], r["id"])
    row = market.row(rfq["id"])
    assert (row["status"], row["quote_id"], row["draft_quote_id"]) == ("pending", None, q["id"])
    assert env.comms.sent == [] and market.emails == [] and env.meter.charges == []      # preparing the draft costs nothing
    [approval] = env.pending(r)
    assert approval["tool_id"] == "send_quotation" and approval["payload"]["rfq_id"] == rfq["id"]
    # A member who can prepare but not send can't approve it.
    with pytest.raises(Exception):
        run(env.orch.decide_approval(r["id"], approval["id"], MEMBER, True))
    assert env.comms.sent == [] and market.row(rfq["id"])["status"] == "pending"


def test_approving_sends_once_charges_one_credit_and_marks_the_request_responded(market):
    env = market.env
    env.businesses["B"]["data"]["financials"]["sent_rfqs"] = []
    rfq = market.request(sender_user_id=OUTSIDER, sender_workspace_id="B")
    [r] = market.runs()
    done = env.approve(r)
    assert done["status"] == "succeeded" and [m["to"] for m in env.comms.sent] == ["buyer@brighttech.test"]
    assert env.meter.charges == [(OWNER, "rfq_response", 2)] and env.meter.balances[OWNER] == 98
    q = env.fin["quotes"][0]
    row = market.row(rfq["id"])
    assert q["status"] == "sent" and (row["status"], row["quote_id"], row["responded_by"], row["agent_run_id"]) == ("approved", q["id"], "agent", r["id"])
    assert "draft_quote_id" not in env.fin["rfq_requests"][0]
    mine = env.businesses["B"]["data"]["financials"]["sent_rfqs"][0]      # the buyer's own record of what they asked for
    assert (mine["status"], mine["quote_id"], mine["quote_ref"], mine["quote_total"]) == ("approved", q["id"], q["reference"], 3600.0)
    # It can't be answered a second time, by hand or by the Agent, and nothing more is charged.
    with pytest.raises(HTTPException) as e:
        market.reply_by_hand(rfq["id"])
    assert e.value.status_code == 400 and e.value.detail == "RFQ is not pending"
    asked = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action")
    assert asked["duplicate"] is True and len(market.runs()) == 1
    assert env.meter.charges == [(OWNER, "rfq_response", 2)] and len(env.comms.sent) == 1 and market.emails == []
    assert len(env.fin["quotes"]) == 1


def test_an_ordinary_enquiry_is_still_charged_as_before(market):
    env = market.env
    r = env.submit(capability="enquiry_to_quote", params={"body": "Please quote for 2 x Strategy Workshop",
                                                          "sender_name": "BrightTech Ltd", "sender_email": "buyer@brighttech.test"})["run"]
    env.approve(r)
    assert [f for _, f, _ in env.meter.charges] == ["agent_quote_draft", "agent_send"] and "rfq_id" not in env.fin["quotes"][0]


# ══ 6. the request and its task stay in step ══════════════════════════════════

def test_replying_by_hand_after_the_agent_drafted_cancels_the_task_and_charges_once(market):
    env = market.env
    rfq = market.request()
    [r] = market.runs()
    [approval] = env.pending(r)
    draft = env.fin["quotes"][0]["id"]
    out = market.reply_by_hand(rfq["id"])
    assert out["rfq"]["status"] == "approved" and out["rfq"]["responded_by"] == "manual" and len(market.emails) == 1
    stopped = run(env.store.get_run(r["id"]))
    assert (stopped["status"], stopped["reason_code"]) == ("cancelled", "rfq_answered_manually") and "replied to this request yourself" in stopped["summary"]
    assert env.pending(r) == []
    quotes = {q["id"]: q for q in env.fin["quotes"]}
    assert quotes[draft]["status"] == "cancelled" and quotes[out["quote"]["id"]]["status"] == "sent" and len(quotes) == 2
    # The approval that was waiting can no longer send anything.
    with pytest.raises(Conflict):
        run(env.orch.decide_approval(r["id"], approval["id"], OWNER, True))
    assert env.comms.sent == [] and env.meter.charges == [(OWNER, "rfq_response", 2)]
    row = market.row(rfq["id"])
    assert row["agent"] is None and row["can_ask_agent"] is False and row["quote_id"] == out["quote"]["id"]
    assert "draft_quote_id" not in env.fin["rfq_requests"][0]


def test_an_approval_that_races_a_reply_by_hand_sends_nothing(market):
    """The task hasn't been stopped yet (the stop failed, or lost the race): the send itself checks the request."""
    env = market.env
    rfq = market.request()
    [r] = market.runs()
    env.fin["rfq_requests"][0].update({"status": "approved", "quote_id": "someone-elses"})
    out = env.approve(r)
    assert out["status"] == "failed" and out["reason_code"] == "source_state_changed" and "already been answered" in out["error"]
    assert env.comms.sent == [] and env.meter.charges == [] and env.fin["quotes"][0]["status"] == "draft"
    assert market.row(rfq["id"])["quote_id"] == "someone-elses"


def test_declining_or_removing_the_request_stops_the_task(market):
    env = market.env
    rfq = market.request()
    [r] = market.runs()
    run(mkt.reject_rfq(user_id=OWNER, workspace_id="A", rfq_id=rfq["id"]))
    stopped = run(env.store.get_run(r["id"]))
    assert (stopped["status"], stopped["reason_code"]) == ("cancelled", "rfq_rejected") and env.pending(r) == []
    assert env.fin["quotes"][0]["status"] == "cancelled" and env.comms.sent == [] and env.meter.charges == []
    asked = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action")
    assert asked["kind"] == "answer" and "already been answered or declined" in asked["message"] and len(market.runs()) == 1
    # Removing one that is still being worked on does the same.
    other = market.request(items=[{"name": "Financial Review", "quantity": 1}])
    second = market.task(other)
    run(mkt.delete_rfq(user_id=OWNER, workspace_id="A", rfq_id=other["id"]))
    assert run(env.store.get_run(second["id"]))["reason_code"] == "rfq_deleted"


def test_the_row_says_where_the_agent_has_got_to_and_links_to_the_task(market):
    env = market.env
    rfq = market.request(items=[{"name": "Unpriced Service", "quantity": 1}])
    [r] = market.runs()
    link = f"/agent/runs/{r['id']}"
    assert market.row(rfq["id"])["agent"] == {"run_id": r["id"], "status": "needs_answer", "label": "Agent needs an answer", "to": link}
    run(env.orch.provide_input(r["id"], OWNER, {"items": [{"product_id": "p3", "name": "Unpriced Service", "quantity": 1, "unit_price": 250}]}))
    assert market.row(rfq["id"])["agent"] == {"run_id": r["id"], "status": "awaiting_approval", "label": "Waiting for your approval", "to": link}
    env.approve(run(env.store.get_run(r["id"])))
    row = market.row(rfq["id"])
    assert row["agent"]["label"] == "Sent" and row["agent"]["to"] == link and row["status"] == "approved" and row["can_ask_agent"] is False
    # In between steps, and when something stops it.
    assert agent_rfq.state_of({"id": "x", "status": "running", "substatus": None})["label"] == "Agent drafting"
    assert agent_rfq.state_of({"id": "x", "status": "failed"})["label"] == "Agent needs attention"
    assert agent_rfq.state_of({"id": "x", "status": "cancelled"}) is None and agent_rfq.state_of(None) is None


# ══ the business's own setting ════════════════════════════════════════════════

def test_with_auto_start_off_the_owner_starts_it_from_the_row(market):
    env = market.env
    run(env.store.set_policy("A", {"marketplace_rfq": {"auto_start": False}}, OWNER))
    rfq = market.request()
    assert market.runs() == []
    row = market.row(rfq["id"])
    assert row["agent"] is None and row["can_ask_agent"] is True          # the row offers "Let the Agent draft this"
    started = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action", source_reference=f"rfq:{rfq['id']}")
    r = started["run"]
    assert (r["status"], r["source_channel"], r["source_reference"]) == ("awaiting_approval", "marketplace_rfq", f"rfq:{rfq['id']}")
    row = market.row(rfq["id"])
    assert row["agent"]["label"] == "Waiting for your approval" and row["can_ask_agent"] is False
    # A member who can prepare work may start it too; they still can't approve the send.
    other = market.request(items=[{"name": "Financial Review", "quantity": 1}])
    by_member = env.submit(capability="enquiry_to_quote", params={"rfq_id": other["id"]}, channel="ui_action", user=MEMBER)["run"]
    assert by_member["status"] == "awaiting_approval" and by_member["requester_id"] == MEMBER


def test_the_setting_is_on_unless_the_owner_turns_it_off_and_only_the_owner_can(market):
    env = market.env
    assert run(env.store.get_policy("A"))["marketplace_rfq"] == {"auto_start": True}
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    try:
        with TestClient(app) as client:
            app.dependency_overrides[get_current_user] = lambda: {"id": MEMBER, "email": MEMBER}
            assert client.put("/businesses/A/agent/policy", json={"rfq_auto_start": False}).status_code == 403
            app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
            saved = client.put("/businesses/A/agent/policy", json={"rfq_auto_start": False}).json()
            assert saved["policy"]["marketplace_rfq"] == {"auto_start": False}
            assert client.get("/businesses/A/agent/policy").json()["policy"]["marketplace_rfq"]["auto_start"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    market.request()
    assert market.runs() == []


def test_on_the_free_plan_requests_stay_locked_and_no_task_reads_them(monkeypatch):
    env = Env(plan="explorer")
    market = Market(monkeypatch, env)
    rfq = market.request()
    assert market.runs() == [] and run(env.store.list_enquiries("A")) == []
    listed = run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))
    assert listed["locked"] is True
    asked = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action")
    assert asked["kind"] == "blocked" and asked["reason_codes"] == ["plan_capability"] and asked["upgrade"] is True and market.runs() == []


def test_a_task_that_cant_start_never_fails_the_buyers_request(market):
    env = market.env
    env.meter.balances[OWNER] = 0                                         # out of credits: the task is refused at the start
    rfq = market.request()
    assert rfq["status"] == "pending" and market.runs() == [] and market.row(rfq["id"])["can_ask_agent"] is True

    async def broken(*_, **__):
        raise RuntimeError("the Agent is unavailable")
    env.meter.balances[OWNER] = 100
    env.orch.submit = broken
    other = market.request(items=[{"name": "Financial Review", "quantity": 1}])
    assert other["status"] == "pending" and len(env.fin["rfq_requests"]) == 2


def test_a_marketplace_request_cant_be_claimed_as_a_channel_by_a_signed_in_user():
    assert "marketplace_rfq" not in agent_router.USER_CHANNELS
