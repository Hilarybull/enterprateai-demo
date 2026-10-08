"""The Agent as one entry point: a written answer through /agent/requests with the conversation
so far, several requests in one message, one switch per automatic item, and the checks the
brief asks for (approve once, reject nothing, charge once, refund on failure)."""
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import autostart, intent
from app.modules.agent import router as agent_router
from app.modules.agent.workflows import WORKFLOWS
from app.modules.business_assistant import service as assistant
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run


class Chat:
    """The Agent's HTTP entry point over the test environment, with a stand-in model and wallet."""

    def __init__(self, monkeypatch, env, balance=10, fail=False):
        self.env, self.prompts, self.charges, self.released, self.balance, self.fail = env, [], [], [], balance, fail
        chat = self

        class LLM:
            async def generate_text(self, *, system, prompt, feature):
                chat.prompts.append(prompt)
                if chat.fail:
                    raise RuntimeError("the model is unavailable")
                return SimpleNamespace(text="Here is what I found.", provider="test", model="test")

        async def pick(user_id):
            return LLM()

        async def workspace(*, user_id, workspace_id):
            b = env.businesses[workspace_id]
            return SimpleNamespace(id=workspace_id, name="Apex", user_id=b["owner"], data=b["data"]), True

        async def nothing(*_, **__):
            return []

        async def paid(user_id):
            return True

        async def priced():
            return None

        @asynccontextmanager
        async def guard(user_id, feature):
            if chat.balance < 2:
                raise HTTPException(status_code=402, detail={"error": "INSUFFICIENT_CREDITS", "available": chat.balance, "required": 2})
            try:
                yield
            except BaseException:
                chat.released.append((user_id, feature))      # held, then given back
                raise
            chat.balance -= 2
            chat.charges.append((user_id, feature))

        from app.modules.addons import service as addons
        from app.modules.credits import service as credits
        from app.modules.idea_validation import service as workspaces
        monkeypatch.setattr(assistant, "pick_llm_for_user", pick)
        monkeypatch.setattr(assistant, "sb_select", nothing)
        monkeypatch.setattr(assistant, "_ensure_chat_price", priced)
        monkeypatch.setattr(workspaces, "_get_accessible_workspace", workspace)
        monkeypatch.setattr(addons, "has_paid_access", paid)
        monkeypatch.setattr(credits, "credit_guard", guard)
        monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
        app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
        self.client = TestClient(app)

    def say(self, text, history=()):
        res = self.client.post("/agent/requests", json={"business_id": "A", "text": text, "history": list(history)})
        assert res.status_code == 200, res.text
        return res.json()


@pytest.fixture
def chat(monkeypatch):
    c = Chat(monkeypatch, Env())
    yield c
    app.dependency_overrides.pop(get_current_user, None)


# ══ one entry point ═══════════════════════════════════════════════════════════

def test_the_separate_assistant_endpoint_is_gone_and_the_agent_writes_the_answer_itself(chat):
    assert chat.client.post("/business-assistant/chat", json={"messages": [{"role": "user", "content": "hello"}]}).status_code == 404
    out = chat.say("please write me a short note about my business")
    assert out["kind"] == "answer" and out["message"] == "Here is what I found." and out["conversational"] is True
    assert chat.charges == [(OWNER, "chat_message")] and len(chat.prompts) == 1      # one answer, charged once


def test_a_three_turn_chat_remembers_turn_one(chat):
    first = chat.say("My delivery van is a blue Ford Transit called Bluebell.")
    history = [{"role": "user", "content": "My delivery van is a blue Ford Transit called Bluebell."}, {"role": "assistant", "content": first["message"]}]
    second = chat.say("Thanks, noted?", history)
    history += [{"role": "user", "content": "Thanks, noted?"}, {"role": "assistant", "content": second["message"]}]
    chat.say("And the name of my van was?", history)
    last = chat.prompts[-1]
    assert "Bluebell" in last and last.index("Bluebell") < last.index("And the name of my van was?")      # turn one is in front of the model on turn three
    assert last.count("User: ") == 3 and last.count("Assistant: ") == 2
    assert chat.charges == [(OWNER, "chat_message")] * 3


def test_a_failed_answer_gives_the_credits_back_and_says_so(chat):
    chat.fail = True
    out = chat.say("please write me a short note about my business")
    assert out["kind"] == "answer" and "Nothing was charged" in out["message"]
    assert chat.charges == [] and chat.released == [(OWNER, "chat_message")] and chat.balance == 10


def test_no_credits_is_said_exactly_and_a_missing_price_is_never_called_out_of_credits(chat, monkeypatch):
    chat.balance = 0
    out = chat.say("please write me a short note about my business")
    assert out["kind"] == "blocked" and out["reason_codes"] == ["credits_exhausted"] and out["upgrade"] is True
    assert "out of AI Credits" in out["message"] and "needs 2 and you have 0" in out["message"] and chat.prompts == []

    @asynccontextmanager
    async def unpriced(user_id, feature):
        raise HTTPException(status_code=402, detail={"error": "FEATURE_NOT_FOUND", "feature_code": feature})
        yield
    from app.modules.credits import service as credits
    monkeypatch.setattr(credits, "credit_guard", unpriced)
    out = chat.say("please write me a short note about my business")
    assert out["reason_codes"] == ["pricing_unavailable"] and "price isn't set up" in out["message"] and "out of AI Credits" not in out["message"]


def test_answers_from_records_and_tasks_dont_use_the_model_or_the_chat_charge(chat):
    assert chat.say("What is my biggest risk?")["kind"] == "answer"
    task = chat.say("Prepare a quotation for BrightTech Ltd for 2 x Strategy Workshop")
    assert task["kind"] == "workflow" and task["run"]["status"] == "awaiting_approval"
    assert chat.prompts == [] and chat.charges == []


# ══ several requests in one message ═══════════════════════════════════════════

def test_several_requests_in_one_message_become_several_tasks_in_one_reply():
    env = Env()
    env.fin["invoices"] = [
        {"id": "i1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 500, "status": "sent",
         "due_date": "2026-09-01", "reference": "INV-1"},
        {"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
         "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    res = env.submit(text="Send the receipt for INV-2 and then chase the overdue invoice")
    assert res["kind"] == "multi" and [r["kind"] for r in res["results"]] == ["workflow", "workflow"]
    assert [r["capability"] for r in res["results"]] == ["receipt_send", "payment_followup"]
    assert all(r["run"]["status"] == "awaiting_approval" for r in res["results"]) and env.comms.sent == []      # each waits for approval
    assert len(run(env.store.list_runs("A"))) == 2


def test_a_message_is_only_split_when_every_part_is_plainly_a_different_task():
    known = list(WORKFLOWS)
    assert intent.split_requests("Send the receipt for INV-2; chase the overdue invoice", known) == ["Send the receipt for INV-2", "chase the overdue invoice"]
    assert intent.split_requests("Prepare a quotation for Nova Labs and also thank them for their patience", known) == []      # one part isn't a task
    assert intent.split_requests("Remind BrightTech and then chase Nova Labs", known) == []                                    # the same task twice: one request
    assert intent.split_requests("What is my biggest risk?", known) == [] and intent.split_requests(None, known) == []
    env = Env()
    one = env.submit(text="Prepare a quotation for BrightTech Ltd for 2 x Strategy Workshop")
    assert one["kind"] == "workflow" and len(run(env.store.list_runs("A"))) == 1


# ══ one switch per automatic item ═════════════════════════════════════════════

def _busy(env):
    env.fin["invoices"] = [
        {"id": "i1", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "total_amount": 100, "status": "sent", "due_date": "2026-09-01", "reference": "INV-1"},
        {"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 900, "status": "paid", "reference": "INV-2",
         "payments": [{"id": "pay1", "amount": 900, "paid_at": env.now.isoformat()}]}]


def test_turning_off_one_automatic_item_stops_that_item_and_only_that_item():
    env = Env()
    _busy(env)
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"invoice_overdue": False}}}, OWNER))
    started = {r["workflow_key"] for r in run(autostart.sweep(env.orch, "A"))}
    assert started == {"receipt_send", "risk_concentration"}              # no reminder was prepared
    by = {e["key"]: e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["key"]}
    assert (by["invoice_overdue"]["on"], by["invoice_overdue"]["starts"]) == (False, "suggested")
    assert (by["payment_recorded"]["on"], by["payment_recorded"]["starts"]) == (True, "automatic")
    assert all(e["minimum_plan_label"] in ("Explorer", "Starter") and e["switchable"] for e in by.values()) and set(by) == set(autostart.ITEMS)
    # Switched back on, it is prepared.
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {}}}, OWNER))
    assert {r["workflow_key"] for r in run(autostart.sweep(env.orch, "A"))} == {"payment_followup"}


def test_the_switches_are_saved_through_agent_settings(chat):
    env = chat.env
    saved = chat.client.put("/businesses/A/agent/policy", json={"automation_items": {"payment_recorded": False, "rfq_arrives": False}}).json()["policy"]
    assert saved["automation"]["items"] == {"payment_recorded": False} and saved["automation"]["auto_start"] is True
    assert saved["marketplace_rfq"] == {"auto_start": False}              # the marketplace switch keeps its own setting
    more = chat.client.put("/businesses/A/agent/policy", json={"automation_items": {"invoice_overdue": False}}).json()["policy"]
    assert more["automation"]["items"] == {"payment_recorded": False, "invoice_overdue": False}      # earlier switches are kept
    assert chat.client.put("/businesses/A/agent/policy", json={"automation_items": {"launch_rockets": True}}).status_code == 400
    listed = {e["key"]: e["on"] for e in chat.client.get("/businesses/A/agent/policy").json()["events"] if e["key"]}
    assert {k: v for k, v in listed.items() if not v} == {"rfq_arrives": False, "payment_recorded": False, "invoice_overdue": False}
    assert set(listed) == set(autostart.ITEMS) and listed["quote_accepted"] is True and listed["concentration_alert"] is True
    _busy(env)
    assert {r["workflow_key"] for r in run(autostart.sweep(env.orch, "A"))} == {"risk_concentration"}


def test_concentration_above_the_alert_is_worked_out_once_a_month_without_being_asked():
    env = Env()
    _busy(env)
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"invoice_overdue": False, "payment_recorded": False}}}, OWNER))
    [r] = run(autostart.sweep(env.orch, "A"))
    assert r["workflow_key"] == "risk_concentration" and r["status"] == "succeeded" and r["source_reference"] == "risk:concentration:2026-10:BrightTech Ltd"
    assert "BrightTech Ltd is 100.0% of your revenue" in r["summary"] and "Losing BrightTech Ltd would cut monthly revenue" in r["summary"]
    assert env.comms.sent == [] and run(autostart.sweep(env.orch, "A")) == []      # reported, nothing sent, not repeated


# ══ approve sends once; reject sends nothing ══════════════════════════════════

def test_approving_sends_exactly_once_and_rejecting_sends_nothing():
    env = Env()
    env.fin["invoices"] = [{"id": "i1", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "total_amount": 100, "status": "sent",
                            "due_date": "2026-09-01", "reference": "INV-1"}]
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"concentration_alert": False}}}, OWNER))
    [r] = run(autostart.sweep(env.orch, "A"))                             # the reminder draft is in Needs Approval, no click from the owner
    [approval] = env.pending(r)
    assert r["status"] == "awaiting_approval" and approval["tool_id"] == "send_payment_reminder" and env.comms.sent == []
    done = env.approve(r)
    assert [m["to"] for m in env.comms.sent] == ["dana@novalabs.test"]
    with pytest.raises(Exception):                                        # the same approval can't be used again
        run(env.orch.decide_approval(r["id"], approval["id"], OWNER, True))
    run(env.orch.advance(done["id"]))
    assert len(env.comms.sent) == 1
    # Rejecting: nothing leaves, and the task ends.
    other = Env()
    other.fin["invoices"] = [{"id": "i1", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "total_amount": 100, "status": "sent",
                              "due_date": "2026-09-01", "reference": "INV-1"}]
    run(other.store.set_policy("A", {"automation": {"auto_start": True, "items": {"concentration_alert": False}}}, OWNER))
    [r2] = run(autostart.sweep(other.orch, "A"))
    ended = other.approve(r2, ok=False)
    assert ended["status"] == "cancelled" and other.comms.sent == [] and other.pending(r2) == []
