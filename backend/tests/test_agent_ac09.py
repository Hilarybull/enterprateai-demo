"""AC-09 approval binding on the live-DB repro, refused recipients, and the QA limit override."""
import pytest
from fastapi.testclient import TestClient

from app.core import config as core_config
from app.main import app
from app.modules.agent import router as agent_router
from app.modules.agent.services import _recipient_message
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


def awaiting(env):
    return env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action")["run"]


def test_qa_repro_no_company_name_edit_then_approve_old_version(env, client):
    """Workspace without a company name, approval v1 pending, edit the price, approve v1."""
    r = awaiting(env)                                    # v1 prepared while the profile still had a name
    v1 = env.pending(r)[0]
    env.businesses["A"]["data"]["workspace_profile"]["company_name"] = ""     # ...now it has none

    edit = client.post(f"/workflow-runs/{r['id']}/draft",
                       json={"items": [{"name": "Strategy Workshop", "quantity": 2, "unit_price": 1650}]})
    assert edit.status_code == 200, edit.text
    assert edit.json()["run"]["substatus"] == "waiting_for_information"       # moved on to the business-name question
    assert run(env.store.get_approval(v1["id"]))["status"] == "superseded"     # ...but v1 was superseded first

    stale = client.post(f"/workflow-runs/{r['id']}/approvals/{v1['id']}/approve", json={})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "approval_superseded"
    assert not env.comms.sent
    assert "approval_granted" not in env.audit_types(r)

    # Answering the question produces v2 for the edited draft; only v2 can send.
    r = run(env.orch.provide_input(r["id"], OWNER, {"business_name": "Apex Consulting Ltd"}))
    v2 = env.pending(r)[0]
    assert v2["payload_version"] == 2 and v2["payload"]["total"] == 3960.0 and v2["payload"]["company"] == "Apex Consulting Ltd"
    ok = client.post(f"/workflow-runs/{r['id']}/approvals/{v2['id']}/approve", json={})
    assert ok.status_code == 200 and ok.json()["run"]["status"] == "succeeded"
    assert len(env.comms.sent) == 1 and "3,960.00" in env.comms.sent[0]["text"]


def test_approving_a_pending_approval_that_no_longer_matches_the_draft_is_refused(env, client):
    r = awaiting(env)
    v1 = env.pending(r)[0]
    env.fin["quotes"][0]["line_items"][0]["unit_price"] = "1700"       # the draft changed underneath it
    res = client.post(f"/workflow-runs/{r['id']}/approvals/{v1['id']}/approve", json={})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "approval_superseded"
    assert run(env.store.get_approval(v1["id"]))["status"] == "superseded" and not env.comms.sent


def test_send_time_check_blocks_an_approved_payload_that_no_longer_matches(env):
    r = awaiting(env)
    v1 = env.pending(r)[0]
    # Approved, then the quotation changes before the send step runs.
    run(env.store.update_approval(v1["id"], {"status": "approved", "approver_id": OWNER}))
    env.fin["quotes"][0]["line_items"][0]["unit_price"] = "1700"
    run(env.store.update_run(r["id"], {"status": "running"}))
    r = run(env.orch.advance(r["id"]))
    assert not env.comms.sent                                            # nothing sent
    assert run(env.store.get_approval(v1["id"]))["status"] == "invalidated"
    assert r["status"] == "awaiting_approval" and env.pending(r)[0]["payload"]["total"] == 4080.0   # fresh approval


def test_refused_address_asks_for_another_and_needs_a_new_approval(env):
    env.comms.refuse_domains.add("example.com")
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={**ENQUIRY, "sender_name": "Inject Test Ltd", "sender_email": "inject@example.com"})["run"]
    r = env.approve(r)
    assert not env.comms.sent
    assert r["status"] == "running" and r["substatus"] == "waiting_for_information"
    q = r["pending_question"]
    assert "example.com is a reserved test domain" in q["question"] and "safe to retry" not in q["question"]
    assert "Resend" not in q["question"] and "422" not in q["question"]
    assert q["fields"][0]["key"] == "customer_email"
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer_email": "accounts@inject-test.co.uk"}))
    assert r["status"] == "awaiting_approval"                            # a new address is a new payload
    assert env.pending(r)[0]["payload"]["to_email"] == "accounts@inject-test.co.uk"
    r = env.approve(r)
    assert r["status"] == "succeeded" and [m["to"] for m in env.comms.sent] == ["accounts@inject-test.co.uk"]


def test_email_failures_never_show_the_provider_to_customers(monkeypatch):
    """Provider names and raw provider text are logged, never shown (customer-facing copy)."""
    import asyncio
    import httpx
    from app.shared.email import resend as resend_mod

    class Settings:
        resend_api_key, resend_from_email, app_name = "k", "noreply@enterprate.test", "EnterprateAI"

    monkeypatch.setattr(resend_mod, "get_settings", lambda refresh=False: Settings())

    def fake(status, body):
        class Client:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, *a, **k):
                return httpx.Response(status, json=body)
        return Client

    cases = [
        (422, {"message": "Invalid `to` field. Please use our testing email address instead of domains like `example.com`."}, True),
        (500, {"message": "Internal server error at the provider"}, False),
    ]
    for status, body, refused in cases:
        monkeypatch.setattr(resend_mod.httpx, "AsyncClient", fake(status, body))
        res = asyncio.run(resend_mod.send_email_via_resend(to_email="inject@example.com", subject="s", text_content="t", html_content="h"))
        assert not res.sent and res.recipient_rejected is refused
        for leak in ("Resend", "resend", "`to`", str(status), "testing email", "provider"):
            assert leak not in res.error, (leak, res.error)
    msg = _recipient_message("inject@example.com")
    assert "reserved test domain" in msg and "Nothing was sent" in msg and "Resend" not in msg


def test_qa_limit_override_applies_outside_production_only(monkeypatch):
    env = Env(plan="explorer")
    settings = core_config.get_settings()
    monkeypatch.setattr(settings, "agent_monthly_runs_override", 500)
    monkeypatch.setattr(settings, "agent_max_active_runs_override", 50)
    monkeypatch.setattr(settings, "environment", "development")
    ent = run(env.orch.entitlement("A"))
    assert ent["monthly_runs"] == 500 and ent["max_active_runs"] == 50
    monkeypatch.setattr(settings, "environment", "production")
    ent = run(env.orch.entitlement("A"))
    assert ent["monthly_runs"] == 5 and ent["max_active_runs"] == 2
