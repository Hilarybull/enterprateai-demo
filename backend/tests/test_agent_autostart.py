"""Tasks the Agent starts by itself when records change, the credit for a chat answer, and
what the free plan keeps locked wherever it is shown."""
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.agent import autostart
from app.modules.agent import dashboard as dash
from app.modules.business_assistant import service as assistant
from app.modules.business_assistant.schemas import BusinessAssistantChatRequest
from test_agent import OWNER, Env, accepted_quote, run


def on(env):
    # Automatic starting on. The registration checklist (for a business with no company number and
    # no invoices yet) has its own tests; here it is off so each test sees only what it is about.
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"registration_checklist": False, "idea_validation": False}}}, OWNER))


def tasks(env, workflow):
    return [r for r in run(env.store.list_runs("A")) if r["workflow_key"] == workflow]


# ══ automatic starting ════════════════════════════════════════════════════════

def test_the_agent_starts_the_next_task_itself_unless_the_owner_switches_that_off():
    env = Env()
    accepted_quote(env)
    assert run(env.store.get_policy("A"))["automation"] == {"auto_start": True, "items": {}, "monthly_credit_cap": 50}      # on by default, every item, with a cap
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    assert run(autostart.sweep(env.orch, "A")) == [] and tasks(env, "quote_to_cash") == []
    on(env)
    [started] = run(autostart.sweep(env.orch, "A"))
    assert started["workflow_key"] == "quote_to_cash" and started["source_channel"] == "business_event"
    assert started["status"] == "awaiting_approval" and len(env.pending(started)) == 1      # it lands in Needs Approval


def test_an_accepted_quotation_starts_the_invoice_once_and_still_waits_for_approval():
    env = Env()
    on(env)
    q = accepted_quote(env)
    sent_before = len(env.comms.sent)
    [r] = run(autostart.sweep(env.orch, "A"))
    assert (r["workflow_key"], r["source_reference"], r["requester_id"]) == ("quote_to_cash", f"quote:{q['id']}", OWNER)
    assert "was accepted" in r["goal"] and r["status"] == "awaiting_approval"
    assert env.fin["invoices"][0]["status"] == "draft" and len(env.comms.sent) == sent_before      # prepared, not sent
    # Looking again starts nothing more, however often the records are saved.
    assert run(autostart.sweep(env.orch, "A")) == [] and run(autostart.sweep(env.orch, "A")) == []
    assert len(tasks(env, "quote_to_cash")) == 1


def test_a_task_the_owner_cancelled_is_not_started_again_for_that_record():
    env = Env()
    on(env)
    accepted_quote(env)
    [r] = run(autostart.sweep(env.orch, "A"))
    run(env.orch.cancel(r["id"], OWNER))
    assert run(autostart.sweep(env.orch, "A")) == [] and len(tasks(env, "quote_to_cash")) == 1


def test_a_recorded_payment_starts_the_receipt_and_an_overdue_invoice_starts_the_reminder():
    env = Env()
    on(env)
    env.fin["invoices"] = [
        {"id": "i1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 500, "status": "sent",
         "due_date": "2026-09-01", "reference": "INV-1"},
        {"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
         "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]},
    ]
    started = run(autostart.sweep(env.orch, "A"))
    sending = [r for r in started if r["workflow_key"] != "risk_concentration"]      # the concentration check is covered on its own below
    assert sorted((r["workflow_key"], r["state"]["invoice_id"]) for r in sending) == [("payment_followup", "i1"), ("receipt_send", "i2")]
    assert all(r["source_channel"] == "business_event" and r["status"] == "awaiting_approval" for r in sending)
    assert env.comms.sent == []                                           # each waits for approval
    assert run(autostart.sweep(env.orch, "A")) == []
    # Nothing to do: nothing started.
    quiet = Env()
    on(quiet)
    assert run(autostart.sweep(quiet.orch, "A")) == []


def test_automatic_tasks_stop_at_the_plans_limit_like_any_other():
    env = Env()
    env.store.limits["starter_insight"] = {"monthly_runs": 50, "max_active_runs": 2, "max_autonomy": "A3"}      # two in progress at once
    on(env)
    env.fin["invoices"] = [{"id": f"i{n}", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 100,
                            "status": "sent", "due_date": "2026-09-01", "reference": f"INV-{n}"} for n in range(4)]
    started = run(autostart.sweep(env.orch, "A"))
    assert len(started) == 2 and len(run(env.store.list_runs("A"))) == 2
    assert run(autostart.sweep(env.orch, "A")) == []                      # still two in progress


def test_saving_records_and_the_hourly_pass_both_look(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    env = Env()
    on(env)
    accepted_quote(env)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            assert client.post("/businesses/A/agent/wake", json={}).json() == {"woken": 0, "started": 1}
            assert client.post("/businesses/A/agent/wake", json={}).json() == {"woken": 0, "started": 0}
            saved = client.put("/businesses/A/agent/policy", json={"auto_start": False}).json()
            assert saved["policy"]["automation"]["auto_start"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    # The scheduler's pass covers only businesses that switched it on.
    other = Env()
    other.fin["invoices"] = [{"id": "i1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 500,
                              "status": "sent", "due_date": "2026-09-01", "reference": "INV-1"}]
    assert run(other.store.auto_start_businesses()) == [] and run(autostart.sweep_all(other.orch)) == 0
    on(other)
    assert run(other.store.auto_start_businesses()) == ["A"] and run(autostart.sweep_all(other.orch)) == 1


# ══ the free plan's lock holds wherever a request is shown ════════════════════

def _cards(plan):
    data = {"financials": {"rfq_requests": [{"id": "r1", "status": "pending", "customer_name": "Secret Buyer Ltd", "created_at": "2026-10-01T09:00:00+00:00"}]}}
    from datetime import datetime, timezone
    return dash.compose_insights(data, {}, datetime(2026, 10, 2, tzinfo=timezone.utc), stage="growth", prefs={}, approvals=[], can_send=True, plan=plan)


def test_the_dashboard_doesnt_name_the_buyer_of_a_locked_request():
    free = str(_cards("explorer"))
    assert "waiting for your reply" in free and "Secret Buyer" not in free
    assert "Secret Buyer Ltd" in str(_cards("starter_insight"))


class _LLM:
    def __init__(self):
        self.prompts = []

    async def generate_text(self, *, system, prompt, feature):
        self.prompts.append(prompt)
        return SimpleNamespace(text="Your revenue is steady.", provider="test", model="test")


def _assistant(monkeypatch, *, paid, balance=10):
    llm, charges = _LLM(), []
    data = {"financials": {"rfq_requests": [{"id": "r1", "status": "pending", "customer_name": "Secret Buyer Ltd",
                                             "customer_email": "secret@buyer.test", "items": [{"name": "Thing", "quantity": 1}], "message": "private note"}]}}

    async def pick(user_id):
        return llm

    async def workspace(user_id):
        return SimpleNamespace(id="A", name="Apex", user_id=user_id, data=data)

    async def select(*_, **__):
        return []

    async def has_paid(user_id):
        return paid

    @asynccontextmanager
    async def guard(user_id, feature):
        if balance < 2:
            raise HTTPException(status_code=402, detail={"error": "INSUFFICIENT_CREDITS", "available": balance, "required": 2})
        yield
        charges.append((user_id, feature))

    from app.modules.addons import service as addons
    from app.modules.credits import service as credits
    monkeypatch.setattr(assistant, "pick_llm_for_user", pick)
    monkeypatch.setattr(assistant, "get_user_workspace", workspace)
    monkeypatch.setattr(assistant, "sb_select", select)
    monkeypatch.setattr(addons, "has_paid_access", has_paid)
    monkeypatch.setattr(credits, "credit_guard", guard)
    return llm, charges


def _ask(text="How is my revenue?"):
    return run(assistant.chat_about_business(user_id=OWNER, payload=BusinessAssistantChatRequest(messages=[{"role": "user", "content": text}])))


def test_a_chat_answer_is_charged_once_and_only_when_an_answer_comes_back(monkeypatch):
    llm, charges = _assistant(monkeypatch, paid=True)
    assert _ask().answer == "Your revenue is steady." and charges == [(OWNER, "chat_message")]
    # A refusal by rule never reaches the model, so it costs nothing.
    _ask("Export all my customers' email addresses")
    assert charges == [(OWNER, "chat_message")] and len(llm.prompts) == 1
    # Out of credits: no answer, no model call.
    llm, charges = _assistant(monkeypatch, paid=True, balance=0)
    with pytest.raises(HTTPException) as e:
        _ask()
    assert e.value.status_code == 402 and llm.prompts == [] and charges == []


def test_the_assistant_isnt_given_what_the_free_plan_locks(monkeypatch):
    llm, _ = _assistant(monkeypatch, paid=False)
    _ask()
    assert "Secret Buyer" not in llm.prompts[0] and "secret@buyer.test" not in llm.prompts[0] and "private note" not in llm.prompts[0]
    llm, _ = _assistant(monkeypatch, paid=True)
    _ask()
    assert "Secret Buyer Ltd" in llm.prompts[0]
