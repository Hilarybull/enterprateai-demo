"""QA round 3 (Phase 1 with live tables): Q-1 to Q-8 and the Edit draft path (AC-09)."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.agent.orchestrator import Conflict
from app.modules.agent.tools import similar_names
from app.shared.auth.deps import get_current_user
from test_agent import ENQUIRY, OWNER, Env, run


@pytest.fixture
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: e.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    yield e
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def awaiting(env, **kw):
    return env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", **kw)["run"]


# ── Q-1: one run per source reference ──────────────────────────────────────────

def test_repeated_request_returns_the_existing_run_and_uses_no_quota():
    env = Env()
    first = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-001")
    again = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-001")
    assert again["duplicate"] and again["run"]["id"] == first["run"]["id"]
    assert len(run(env.store.list_runs("A"))) == 1
    assert len(env.fin["quotes"]) == 1                                   # no second quotation
    assert run(env.orch._usage("A"))["monthly_runs"] == 1                # no second task counted


def test_simultaneous_duplicates_are_caught_by_the_unique_key(monkeypatch):
    env = Env()
    env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-002")

    async def not_seen_yet(*_a, **_k):        # the other request's check ran before this run existed
        return []
    real = env.store.runs_for_reference
    calls = {"n": 0}

    async def first_miss(*a, **k):
        calls["n"] += 1
        return [] if calls["n"] == 1 else await real(*a, **k)
    monkeypatch.setattr(env.store, "runs_for_reference", first_miss)
    res = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-002")
    assert res["duplicate"] and len(run(env.store.list_runs("A"))) == 1
    assert any(e["status"] == "duplicate" for e in env.store.enquiries.values())     # the losing enquiry is marked


def test_a_cancelled_run_frees_its_source_reference():
    env = Env()
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-003")["run"]
    run(env.orch.cancel(r["id"], OWNER))
    again = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action", source_reference="qa-dup-003")
    assert not again.get("duplicate") and again["run"]["id"] != r["id"]


def test_read_only_helpers_can_be_rerun_with_the_same_reference():
    env = Env()
    a = env.submit(capability="risk_concentration", channel="ui_action", source_reference="risk:concentration")
    b = env.submit(capability="risk_concentration", channel="ui_action", source_reference="risk:concentration")
    assert a["run"]["id"] != b["run"]["id"] and not b.get("duplicate")


# ── Q-2: never sent under a placeholder ─────────────────────────────────────────

def test_missing_business_name_is_asked_for_before_anything_can_be_approved():
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"]["company_name"] = ""
    r = awaiting(env)
    assert r["status"] == "running" and r["substatus"] == "waiting_for_information"
    assert r["pending_question"]["fields"][0]["key"] == "business_name"
    assert not env.pending(r)                                            # no approval under "Your business"
    r = run(env.orch.provide_input(r["id"], OWNER, {"business_name": "Apex Consulting Ltd"}))
    assert r["status"] == "awaiting_approval"
    assert env.pending(r)[0]["payload"]["company"] == "Apex Consulting Ltd"
    assert env.businesses["A"]["data"]["workspace_profile"]["company_name"] == "Apex Consulting Ltd"   # asked once


# ── Q-3: the audit says where each price came from ──────────────────────────────

def test_user_entered_prices_are_recorded_as_such():
    env = Env()
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={"body": "Please quote for some bespoke consulting", "sender_name": "BrightTech Ltd",
                           "sender_email": "buyer@brighttech.test"})["run"]
    assert r["pending_question"]["fields"][0]["key"] == "items"
    r = run(env.orch.provide_input(r["id"], OWNER, {"items": [{"name": "Business consulting", "quantity": 3, "unit_price": 100}]}))
    priced = [a for a in run(env.store.list_audit(r["id"])) if a["event_type"] == "items_priced"][-1]
    assert priced["detail"]["lines"][0]["price_source"] == "user_confirmed"
    notes = " ".join(s.get("note") or "" for s in run(env.store.list_steps(r["id"])))
    assert "the price you entered" in notes and "approved pricing" not in notes
    assert env.pending(r)[0]["payload"]["items"][0]["price_source"] == "user_confirmed"


def test_catalogue_prices_are_recorded_as_catalogue():
    env = Env()
    r = awaiting(env)
    notes = " ".join(s.get("note") or "" for s in run(env.store.list_steps(r["id"])))
    assert "your catalogue price" in notes


# ── Q-4: details in the enquiry text are pre-filled and confirmed ───────────────

def test_customer_details_in_the_enquiry_text_are_prefilled_for_confirmation():
    env = Env()
    body = "Hi, this is Sam from QA Test Ltd (qa-test@example.com). Please quote 3 x Strategy Workshop."
    r = env.submit(capability="enquiry_to_quote", channel="ui_action", params={"body": body})["run"]
    q = r["pending_question"]
    assert "found these customer details" in q["question"]
    defaults = {f["key"]: f.get("default") for f in q["fields"]}
    assert defaults == {"customer_name": "QA Test Ltd", "customer_email": "qa-test@example.com"}
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer_name": "QA Test Ltd", "customer_email": "qa-test@example.com"}))
    assert r["status"] == "awaiting_approval"
    assert env.pending(r)[0]["payload"]["to_email"] == "qa-test@example.com"


# ── Q-5 / Q-6: actions that can't apply return 409 ──────────────────────────────

def test_approving_a_rejected_approval_is_a_conflict(env, client):
    r = awaiting(env)
    approval = env.pending(r)[0]
    assert client.post(f"/workflow-runs/{r['id']}/approvals/{approval['id']}/reject", json={}).status_code == 200
    res = client.post(f"/workflow-runs/{r['id']}/approvals/{approval['id']}/approve", json={})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "approval_not_pending"
    assert not env.comms.sent


@pytest.mark.parametrize("action,body", [("cancel", {}), ("retry", {}), ("input", {"answers": {"x": 1}})])
def test_actions_on_a_cancelled_run_are_conflicts(env, client, action, body):
    r = awaiting(env)
    assert client.post(f"/workflow-runs/{r['id']}/cancel", json={}).status_code == 200
    res = client.post(f"/workflow-runs/{r['id']}/{action}", json=body)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "run_finished"


def test_answering_a_run_that_is_awaiting_approval_is_a_conflict(env, client):
    r = awaiting(env)
    res = client.post(f"/workflow-runs/{r['id']}/input", json={"answers": {"items": [{"name": "X", "quantity": 1, "unit_price": 9}]}})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "no_pending_question"
    assert env.pending(r)[0]["payload"]["total"] == 3600.0            # unchanged


# ── Q-7: customer matching ──────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b,expected", [
    ("Inject Test Ltd", "QA Test Ltd", False),
    ("Acme Ltd", "Apex Ltd", False),
    ("BrightTech", "BrightTech Ltd", True),
    ("BrightTech Solutions", "BrightTech Ltd", True),
    ("Nova Labs", "Nova Labs Limited", True),
    ("Meadow Supplies Ltd", "Meadow Supplies UK Ltd", True),
])
def test_customer_name_similarity(a, b, expected):
    assert similar_names(a, b) is expected


# ── Q-8: one timeline entry per step ────────────────────────────────────────────

def test_timeline_shows_the_latest_state_of_each_step(env, client):
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={"body": "Hi, this is Sam from QA Test Ltd (qa-test@example.com). Please quote 3 x Strategy Workshop."})["run"]
    run(env.orch.provide_input(r["id"], OWNER, {"customer_name": "QA Test Ltd", "customer_email": "qa-test@example.com"}))
    data = client.get(f"/workflow-runs/{r['id']}").json()
    keys = [s["step_key"] for s in data["steps"]]
    assert len(keys) == len(set(keys))
    assert next(s for s in data["steps"] if s["step_key"] == "customer")["state"] == "succeeded"
    assert len(data["step_attempts"]) > len(data["steps"])          # full detail kept


# ── Edit draft: a new payload version; the old approval can't be used (AC-09) ──

def test_editing_the_draft_invalidates_the_pending_approval(env, client):
    r = awaiting(env)
    old = env.pending(r)[0]
    assert old["payload"]["total"] == 3600.0 and old["payload_version"] == 1
    res = client.post(f"/workflow-runs/{r['id']}/draft", json={"items": [{"name": "Strategy Workshop", "quantity": 2, "unit_price": 1600}]})
    assert res.status_code == 200, res.text
    assert run(env.store.get_approval(old["id"]))["status"] == "superseded"
    new = env.pending(r)[0]
    assert new["payload_version"] == 2 and new["payload"]["total"] == 3840.0 and new["payload_hash"] != old["payload_hash"]
    assert new["payload"]["items"][0]["price_source"] == "user_edited"
    stale = client.post(f"/workflow-runs/{r['id']}/approvals/{old['id']}/approve", json={})
    assert stale.status_code == 409 and not env.comms.sent                       # the old approval sends nothing
    ok = client.post(f"/workflow-runs/{r['id']}/approvals/{new['id']}/approve", json={})
    assert ok.status_code == 200 and ok.json()["run"]["status"] == "succeeded"
    assert len(env.comms.sent) == 1 and "3,840.00" in env.comms.sent[0]["text"]


def test_draft_edits_are_validated_and_only_allowed_while_awaiting_approval(env, client):
    r = awaiting(env)
    bad = client.post(f"/workflow-runs/{r['id']}/draft", json={"items": [{"name": "X", "quantity": 1, "unit_price": 0}]})
    assert bad.status_code == 409 and bad.json()["detail"]["code"] == "invalid_edit"
    client.post(f"/workflow-runs/{r['id']}/cancel", json={})
    late = client.post(f"/workflow-runs/{r['id']}/draft", json={"vat_rate": 0})
    assert late.status_code == 409 and late.json()["detail"]["code"] == "not_awaiting_approval"
