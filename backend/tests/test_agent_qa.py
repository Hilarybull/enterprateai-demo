"""Regression tests for the QA findings against PRD-AO-001 (D-1 to D-6).

The Agent routes run in the real FastAPI app (real middleware order: CORS outside
the error guard), with the orchestrator backed by in-memory services.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.agent import summary as summary_mod
from app.shared.auth.deps import get_current_user
from test_agent import ENQUIRY, OWNER, Env, run

ORIGIN = "http://localhost:5173"


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


def call(client, method, path, body=None):
    return client.request(method, path, json=body, headers={"Origin": ORIGIN})


def add_revenue(env):
    """Paid invoices where one customer carries most of the revenue, plus one overdue invoice."""
    env.fin["invoices"] += [
        {"id": "i1", "customer_name": "BrightTech Ltd", "total_amount": 9000, "status": "paid", "paid_at": "2026-09-01"},
        {"id": "i2", "customer_name": "Nova Labs", "total_amount": 1000, "status": "paid", "paid_at": "2026-09-10"},
        {"id": "i3", "customer_name": "Nova Labs", "total_amount": 500, "status": "delivered", "issued_at": "2026-08-01",
         "due_date": "2026-09-01"},
    ]


# ── D-1: errors keep CORS headers; unknown or invalid ids are 404 ───────────────

def test_unhandled_errors_return_json_with_cors_headers(client):
    async def boom():
        raise RuntimeError("unexpected")

    class MissingTable(Exception):
        code = "PGRST205"

    async def missing():
        raise MissingTable("Could not find the table 'public.agent_workflow_runs' in the schema cache")

    app.add_api_route("/__test/boom", boom)
    app.add_api_route("/__test/missing-table", missing)
    try:
        r = call(client, "GET", "/__test/boom")
        assert r.status_code == 500 and r.json()["code"] == "server_error"
        assert r.headers.get("access-control-allow-origin")
        r = call(client, "GET", "/__test/missing-table")
        assert r.status_code == 503 and r.json()["code"] == "feature_unavailable"
        assert r.headers.get("access-control-allow-origin")
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes if not getattr(rt, "path", "").startswith("/__test/")]


def test_unknown_or_invalid_run_ids_are_404(env, client):
    assert call(client, "GET", "/workflow-runs/not-a-uuid").status_code == 404
    assert call(client, "GET", "/workflow-runs/00000000-0000-0000-0000-000000000000").status_code == 404
    assert call(client, "POST", "/workflow-runs/nope/approvals/nope/approve", {}).status_code == 404
    assert call(client, "POST", "/workflow-runs/nope/cancel", {}).status_code == 404


def test_workflow_endpoints_work_end_to_end(env, client):
    res = call(client, "POST", "/agent/requests", {"business_id": "A", "capability": "enquiry_to_quote",
                                                   "params": ENQUIRY, "source_channel": "ui_action"})
    assert res.status_code == 200, res.text
    run_id = res.json()["run"]["id"]
    assert call(client, "GET", f"/workflow-runs/{run_id}").status_code == 200
    for path in ("/businesses/A/workflow-runs", "/businesses/A/approvals", "/businesses/A/agent/metrics",
                 "/businesses/A/agent/summary"):
        assert call(client, "GET", path).status_code == 200, path
    approval = call(client, "GET", "/businesses/A/approvals").json()["items"][0]
    ok = call(client, "POST", f"/workflow-runs/{run_id}/approvals/{approval['approval_id']}/approve", {})
    assert ok.status_code == 200 and ok.json()["changed"]


# ── D-2: questions are answered from authoritative data, with evidence ─────────

def test_risk_question_is_answered_from_records_with_evidence():
    env = Env()
    add_revenue(env)
    res = env.submit(text="What is my biggest risk?")
    assert res["kind"] == "answer"
    assert "biggest risk" in res["message"] and "BrightTech Ltd" in res["message"] and "85.7%" in res["message"]
    labels = {e["label"]: e["value"] for e in res["evidence"]}
    assert labels["Largest customer"].startswith("BrightTech Ltd: 85.7%")
    assert labels["Overdue invoices"].startswith("1 ·")
    assert res["actions"][0]["capability"] == "risk_concentration"
    assert not run(env.store.list_runs("A"))          # a question never starts a workflow


def test_risk_question_with_no_records_says_so_honestly():
    res = Env().submit(text="What is my biggest risk?")
    assert res["kind"] == "answer" and "no revenue recorded" in res["message"]


def test_other_questions_go_to_the_assistant():
    res = Env().submit(text="please write me a poem")
    assert res["kind"] == "assistant" and "no supported action" not in res["message"]


# ── D-3: future capabilities are declined clearly, with what is possible ───────

@pytest.mark.parametrize("capability", ["business_planning"])      # marketplace requests and proposals are handled now
def test_future_capability_requests_explain_and_offer_alternatives(capability):
    env = Env()
    res = env.submit(capability=capability, channel="ui_action")
    assert res["kind"] == "unavailable" and res["capability"] == capability
    assert "isn't available as an Agent action yet" in res["message"]
    kinds = {o["kind"] for o in res["offers"]}
    assert kinds == {"explain", "draft"}
    assert not run(env.store.list_runs("A"))


def test_future_capability_named_in_text_is_declined_not_misrouted():
    env = Env()
    made = Env().submit(text="Write a proposal for Acme")                  # proposals are prepared now, not declined
    assert made["kind"] == "workflow" and made["run"]["workflow_key"] == "new_proposal" and made["run"]["pending_question"]
    none = env.submit(text="Respond to the RFQ from Nova Labs")           # marketplace requests are handled now: nothing waiting
    assert none["kind"] == "answer" and none["message"] == "Every Marketplace request has been answered: none is waiting for a reply."
    env.fin["rfq_requests"] = [
        {"id": "r1", "status": "pending", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "items": [{"name": "Strategy Workshop", "quantity": 1}]},
        {"id": "r2", "status": "pending", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "items": [{"name": "Financial Review", "quantity": 1}]},
        {"id": "r3", "status": "approved", "customer_name": "Old", "customer_email": "old@x.test", "items": []}]
    did = env.submit(text="Reply to my marketplace requests")
    assert did["kind"] == "workflow" and len(did["runs"]) == 2 and all(r["status"] == "awaiting_approval" for r in did["runs"])
    assert {r["source_reference"] for r in did["runs"]} == {"rfq:r1", "rfq:r2"} and env.comms.sent == []      # drafted, waiting in Needs Approval
    again = env.submit(text="Respond to my RFQs")
    assert len(run(env.store.list_runs("A"))) == 2 and again["kind"] == "workflow"      # asked twice: still one task each
    assert env.submit(text="Prepare a quotation for BrightTech Ltd")["kind"] == "workflow"   # supported work still runs


# ── D-5: one definition of Needs Approval ───────────────────────────────────────

def test_needs_approval_lists_only_real_approvals_and_counts_match(env, client):
    add_revenue(env)                       # concentration alert is active
    call(client, "POST", "/agent/requests", {"business_id": "A", "capability": "enquiry_to_quote",
                                             "params": ENQUIRY, "source_channel": "ui_action"})
    summary = call(client, "GET", "/businesses/A/agent/summary").json()
    assert summary["needs_approval_count"] == 1
    assert all(i["type"] == "approval" for i in summary["needs_approval"])
    assert summary["needs_approval"][0]["payload"]["customer_name"] == "BrightTech Ltd"     # the exact payload
    assert any(s["key"] == "concentration" for s in summary["suggestions"])                # the alert lives here
    approvals = call(client, "GET", "/businesses/A/approvals").json()
    runs = call(client, "GET", "/businesses/A/workflow-runs").json()
    assert approvals["count"] == runs["counts"]["needs_approval"] == summary["needs_approval_count"]


def test_expired_approval_leaves_needs_approval_everywhere(env, client):
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]
    approval = env.pending(r)[0]
    env.store.approvals[approval["id"]]["expires_at"] = "2000-01-01T00:00:00+00:00"
    assert summary_mod.live_pending([env.store.approvals[approval["id"]]], [run(env.store.get_run(r["id"]))], env.now) == []
    assert call(client, "GET", "/businesses/A/agent/summary").json()["needs_approval_count"] == 0
    assert call(client, "GET", "/businesses/A/approvals").json()["count"] == 0
    assert call(client, "GET", "/businesses/A/workflow-runs").json()["counts"].get("needs_approval", 0) == 0


# ── D-6: system-only channels are refused from signed-in users ──────────────────

@pytest.mark.parametrize("channel", ["business_event", "api"])
def test_system_channels_are_rejected_from_user_requests(env, client, channel):
    r = call(client, "POST", "/agent/requests", {"business_id": "A", "capability": "receipt_send", "source_channel": channel})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "channel_not_allowed"
    assert r.headers.get("access-control-allow-origin")
    assert not run(env.store.list_runs("A"))


def test_forwarded_enquiries_from_users_use_a_user_channel(env, client):
    r = call(client, "POST", "/businesses/A/enquiries", {"body": "Quote for 2 x Strategy Workshop please", "source": "email"})
    assert r.status_code == 200, r.text
    assert run(env.store.list_runs("A"))[0]["source_channel"] == "ui_action"
