"""QA (Explorer plan): one plan gate for every capability, answers from the right records,
what the assistant is given, what it remembers, and what each event does."""
from types import SimpleNamespace

import pytest

from app.modules.agent import autostart, memory
from app.modules.agent import config as agent_config
from app.modules.agent.workflows import WORKFLOWS
from app.modules.business_assistant import service as assistant
from app.modules.business_assistant.schemas import BusinessAssistantChatRequest
from test_agent import MEMBER, OUTSIDER, OWNER, Env, accepted_quote, run
from test_agent_autostart import _assistant, on

PLANS = list(agent_config.PLAN_ORDER)
START = {
    "enquiry_to_quote": {"params": {"body": "Please quote for 2 x Strategy Workshop", "sender_name": "BrightTech Ltd", "sender_email": "buyer@brighttech.test"}},
    "quote_to_cash": {"params": {"quote_id": "q-accepted"}},
    "payment_followup": {"params": {"invoice_id": "i-overdue"}},
    "receipt_send": {"params": {"invoice_id": "i-paid"}},
    "risk_concentration": {},
    "scenario_help": {"text": "What if I lose my biggest customer?"},
}


def _records(env):
    env.fin["quotes"] = [{"id": "q-accepted", "reference": "QUO-1", "customer_id": "c1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test",
                          "status": "accepted", "total_amount": 500, "amount": 500, "subtotal_amount": 500,
                          "line_items": [{"id": "l1", "description": "Strategy Workshop", "qty": "1", "unit_price": "500"}]}]
    env.fin["invoices"] = [
        {"id": "i-overdue", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 500, "status": "sent",
         "due_date": "2026-09-01", "reference": "INV-1"},
        {"id": "i-paid", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
         "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]


# ══ 1. the plan gate ══════════════════════════════════════════════════════════

def test_the_table_covers_every_capability_the_agent_has():
    assert set(agent_config.CAPABILITY_MIN_PLAN) == set(WORKFLOWS)
    assert all(p in agent_config.PLAN_ORDER for p in agent_config.CAPABILITY_MIN_PLAN.values())
    assert agent_config.plan_allows("explorer", "something_new") is False      # nothing is open by omission


@pytest.mark.parametrize("capability", sorted(START))
@pytest.mark.parametrize("plan", PLANS)
def test_every_capability_checks_the_plan_before_anything_starts(plan, capability):
    env = Env(plan=plan)
    _records(env)
    res = env.submit(capability=capability, channel="ui_action", **START[capability])
    allowed = agent_config.plan_rank(plan) >= agent_config.plan_rank(agent_config.CAPABILITY_MIN_PLAN[capability])
    if allowed:
        assert res["kind"] == "workflow", res
        assert len(run(env.store.list_runs("A"))) == 1
    else:
        assert res["kind"] == "blocked" and res["reason_codes"] == ["plan_capability"] and res["upgrade"] is True
        assert res["message"].endswith(" plan.")
        assert run(env.store.list_runs("A")) == [] and run(env.store.list_enquiries("A")) == []      # nothing started, nothing drafted
        assert env.comms.sent == [] and env.meter.charges == [] and len(env.fin["invoices"]) == 2


def test_the_same_gate_stops_every_automatic_trigger_and_the_assistant_route():
    from app.modules.agent import rfq as agent_rfq
    env = Env(plan="explorer")
    _records(env)
    on(env)
    assert run(autostart.sweep(env.orch, "A")) == []                      # automatic starting
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "Buyer", "customer_email": "b@x.test", "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    assert run(agent_rfq.received(env.orch, "A", "r1")) is None           # a marketplace request arriving
    typed = env.submit(text="Prepare a quotation for BrightTech Ltd for 2 x Strategy Workshop", channel="text")      # typed to the assistant
    assert typed["kind"] == "blocked" and typed["reason_codes"] == ["plan_capability"]
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []
    # A task from before a downgrade can't be carried on either.
    paid = Env()
    r = paid.submit(capability="enquiry_to_quote", params={"body": "Please quote for your Unpriced Service"})["run"]
    run(paid.store.update_run(r["id"], {"status": "failed"}))
    paid.meter.plans[OWNER] = "explorer"
    with pytest.raises(Exception):
        run(paid.orch.retry(r["id"], OWNER))


def test_the_settings_page_gets_what_each_event_does():
    env = Env(plan="explorer")
    ent, policy = run(env.orch.entitlement("A")), run(env.store.get_policy("A"))
    assert {e["starts"] for e in autostart.events(policy, ent) if e["capability"]} >= {"upgrade"}      # what Explorer doesn't include asks for an upgrade; what it does include can start
    env = Env()
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))      # the owner has switched automatic starting off
    ent, policy = run(env.orch.entitlement("A")), run(env.store.get_policy("A"))
    by = {e["event"]: e for e in autostart.events(policy, ent)}
    assert by["A Marketplace request for a quotation arrives"]["starts"] == "automatic"      # its own switch, on unless switched off
    assert by["A customer accepts a quotation"]["starts"] == "suggested" and by["A payment is recorded"]["starts"] == "suggested"
    assert by["An invoice becomes overdue"]["approval"] == "You approve each reminder before it is sent."
    assert by["One customer becomes too large a share of revenue"]["starts"] == "suggested"
    assert by["A customer declines a quotation"]["starts"] == "nothing" and by["An Agent task finishes or stops"]["starts"] == "nothing"
    on(env)
    by = {e["event"]: e for e in autostart.events(run(env.store.get_policy("A")), ent)}
    assert [by[k]["starts"] for k in ("A customer accepts a quotation", "A payment is recorded", "An invoice becomes overdue")] == ["automatic"] * 3
    assert by["One customer becomes too large a share of revenue"]["starts"] == "automatic"      # worked out and reported, nothing sent
    top = Env(plan="decision_engine")
    run(top.store.set_policy("A", {"reminders": {"auto_send": True}}, OWNER))
    events = {e["event"]: e for e in autostart.events(run(top.store.get_policy("A")), run(top.orch.entitlement("A")))}
    assert events["An invoice becomes overdue"]["approval"].startswith("Reminders are sent within your schedule")


# ══ 3 and 4. requests: locked stays locked, and the answer comes from the requests ══

RFQS = [{"id": "r-old", "status": "approved", "customer_name": "Older Buyer", "customer_email": "old@buyer.test", "items": [{"name": "Financial Review", "quantity": 1}],
         "created_at": "2026-09-20T09:00:00+00:00"},
        {"id": "r-new", "status": "pending", "customer_name": "Dana Okoro", "customer_company": "Nova Labs", "customer_email": "dana@novalabs.test",
         "items": [{"name": "Strategy Workshop", "quantity": 2}], "message": "For our May offsite", "created_at": "2026-09-30T09:00:00+00:00"}]
QUESTION = "who sent my latest quotation request from the marketplace"
SECRETS = ("Dana", "Okoro", "Nova Labs", "novalabs", "Older Buyer", "old@buyer.test", "Strategy Workshop", "Financial Review", "May offsite")


def test_who_sent_my_latest_request_is_answered_from_the_requests_and_not_from_quotations_sent():
    env = Env()
    env.fin["rfq_requests"] = [dict(r) for r in RFQS]
    env.fin["quotes"] = [{"id": "q9", "reference": "QUO-9", "customer_name": "QA Round Six", "customer_email": "made-up@example.test", "status": "sent", "total_amount": 100}]
    a = env.submit(text=QUESTION)
    assert a["kind"] == "answer" and a["topic"] == "requests"
    assert "Nova Labs (dana@novalabs.test) on 2026-09-30" in a["message"] and "2 x Strategy Workshop" in a["message"] and "waiting for a reply" in a["message"]
    assert "QA Round Six" not in str(a) and "made-up@example.test" not in str(a) and "100" not in a["message"]
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []      # an answer from records: no task, no charge
    none = Env()
    none.fin["quotes"] = list(env.fin["quotes"])
    said = none.submit(text=QUESTION)
    assert said["message"].startswith("No request for a quotation has come in through the Marketplace yet.") and "QA Round Six" not in str(said)


def test_on_the_free_plan_the_answer_says_a_request_is_waiting_and_names_no_one():
    env = Env(plan="explorer")
    env.fin["rfq_requests"] = [dict(r) for r in RFQS]
    for question in (QUESTION, "show me my RFQs", "what did the buyer ask for in my marketplace request?"):
        a = env.submit(text=question)
        assert a["kind"] == "answer" and "2 requests" in a["message"] and "1 waiting for a reply" in a["message"]
        assert "locked on your plan" in a["message"] and "Upgrade to view" in a["message"] and a["actions"] == [{"label": "See plans", "to": "/pricing"}]
        for secret in SECRETS:
            assert secret not in str(a)
    masked = run(env.orch.visible_data("A"))["financials"]["rfq_requests"]
    assert all(r["locked"] and r["customer_name"] == "Locked request" and r["customer_email"] == "" for r in masked)
    paid = Env()
    paid.fin["rfq_requests"] = [dict(r) for r in RFQS]
    assert run(paid.orch.visible_data("A"))["financials"]["rfq_requests"][1]["customer_name"] == "Dana Okoro"


def test_the_assistants_sources_are_separate_labelled_and_masked_like_the_pages():
    env = Env()
    env.fin["rfq_requests"] = [dict(r) for r in RFQS]
    env.fin["quotes"] = [{"id": "q9", "reference": "QUO-9", "customer_name": "QA Round Six", "status": "sent", "total_amount": 100, "rfq_id": None}]
    data = env.businesses["A"]["data"]
    src = memory.sources(data, [], run(env.store.get_policy("A")), env.now)
    inbound = next(v for k, v in src.items() if k.startswith("INBOUND REQUESTS FOR QUOTATION"))
    sent = next(v for k, v in src.items() if k.startswith("QUOTATIONS THIS BUSINESS SENT"))
    assert [r["from"] for r in inbound["requests"]] == ["Nova Labs", "Older Buyer"] and inbound["waiting_for_a_reply"] == 1
    assert [q["customer"] for q in sent] == ["QA Round Six"] and "QA Round Six" not in str(inbound)
    assert any(k.startswith("AGENT TASKS") for k in src) and any(k.startswith("INVOICES") for k in src) and any(k.startswith("CATALOGUE") for k in src)
    rest = memory.without_sourced(data)
    assert "catalogue" not in rest and not {"quotes", "invoices", "rfq_requests", "sent_rfqs"} & set(rest["financials"])
    assert "I can't see that in this workspace." in memory.RULES and "Never guess" in memory.RULES
    # Locked: how many and when, and an instruction; nothing else.
    free = Env(plan="explorer")
    free.fin["rfq_requests"] = [dict(r) for r in RFQS]
    visible = memory.sources(run(free.orch.visible_data("A")), [], {}, free.now)
    locked = next(v for k, v in visible.items() if k.startswith("INBOUND REQUESTS"))
    assert locked["locked"] is True and locked["count"] == 2 and "requests" not in locked and "Never state or guess" in locked["note"]
    for secret in ("Dana", "Nova Labs", "novalabs", "May offsite", "Older Buyer"):
        assert secret not in str(visible)


def test_the_assistant_answers_about_the_business_on_screen_from_labelled_masked_sources(monkeypatch):
    llm, _charges = _assistant(monkeypatch, paid=False)
    from app.modules.idea_validation import service as workspaces
    seen = {}

    async def accessible(*, user_id, workspace_id):
        seen["asked"] = (user_id, workspace_id)
        data = {"workspace_profile": {"company_name": "Alchemy Test"}, "agent_memory": [{"id": "f1", "text": "we close at 5pm"}],
                "financials": {"rfq_requests": [{"id": "r1", "status": "pending", "customer_name": "Secret Buyer Ltd", "customer_email": "secret@buyer.test",
                                                 "items": [{"name": "Gizmo", "quantity": 1}], "message": "private note", "created_at": "2026-10-01T09:00:00+00:00"}],
                               "quotes": [{"id": "q1", "reference": "QUO-1", "customer_name": "QA Round Six", "status": "sent", "total_amount": 100}]}}
        return SimpleNamespace(id="ws-2", name="Apex Consulting Ltd", user_id=user_id, data=data), True

    monkeypatch.setattr(workspaces, "_get_accessible_workspace", accessible)
    run(assistant.chat_about_business(user_id=OWNER, payload=BusinessAssistantChatRequest(messages=[{"role": "user", "content": QUESTION}], workspace_id="ws-2")))
    prompt = llm.prompts[0]
    assert seen["asked"] == (OWNER, "ws-2") and "Business name: Alchemy Test" in prompt and "Apex Consulting" not in prompt
    for secret in ("Secret Buyer", "secret@buyer.test", "private note", "Gizmo"):
        assert secret not in prompt
    assert "INBOUND REQUESTS FOR QUOTATION" in prompt and '"locked": true' in prompt and "upgrading shows them" in prompt
    assert "QUOTATIONS THIS BUSINESS SENT TO ITS CUSTOMERS (outgoing documents, NOT requests)" in prompt
    assert "we close at 5pm" in prompt and "AGENT TASKS" in prompt and "RECENT EVENTS" in prompt
    assert prompt.count("QA Round Six") == 1                              # each record appears once, under its own label


# ══ 5. memory and what happened elsewhere ═════════════════════════════════════

def test_the_assistant_is_told_what_the_agent_did_and_what_happened_elsewhere():
    env = Env()
    q = accepted_quote(env)
    env.fin["quotes"].append({"id": "q2", "reference": "QUO-2", "customer_name": "Nova Labs", "status": "rejected", "declined_reason": "Too expensive"})
    env.fin["invoices"] = [{"id": "i1", "customer_name": "BrightTech Ltd", "total_amount": 500, "status": "sent", "due_date": "2026-09-01", "reference": "INV-1"}]
    env.fin["rfq_requests"] = [dict(RFQS[1])]
    runs = run(env.store.list_runs("A"))
    src = memory.sources(env.businesses["A"]["data"], runs, run(env.store.get_policy("A")), env.now)
    happened = " | ".join(src["RECENT EVENTS"])
    assert "1 Marketplace request for a quotation is waiting for a reply." in happened
    assert f"BrightTech Ltd accepted quotation {q['reference']}" in happened and "Nova Labs declined quotation QUO-2: Too expensive." in happened
    assert "Invoice INV-1 for BrightTech Ltd is overdue by 30 days." in happened and "Agent task “Enquiry to Quote” finished" in happened
    [task] = next(v for k, v in src.items() if k.startswith("AGENT TASKS"))
    assert task["task"] == "Enquiry to Quote" and task["state"] == "finished" and "was sent to buyer@brighttech.test" in task["outcome"]


FACTS = "SAVED FACTS (confirmed by the owner, about this business only)"


def test_a_fact_is_remembered_only_when_the_owner_confirms_and_only_for_that_business():
    env = Env()
    asked = env.submit(text="Remember that we don't take on work in August.")
    assert asked["kind"] == "remember" and asked["fact"] == "we don't take on work in August" and asked["can_save"] is True
    assert memory.facts(env.businesses["A"]["data"]) == [] and run(env.store.list_runs("A")) == []      # asking saved nothing
    saved = run(memory.add(env.orch, "A", OWNER, asked["fact"]))
    assert run(memory.add(env.orch, "A", OWNER, "We don't take on work in August"))["id"] == saved["id"]      # said twice: kept once
    assert memory.sources(env.businesses["A"]["data"], [], {}, env.now)[FACTS] == ["we don't take on work in August"]
    assert memory.facts(env.businesses["B"]["data"]) == [] and memory.sources(env.businesses["B"]["data"], [], {}, env.now)[FACTS] == []
    # A member can ask but not save; an outsider can do neither; the owner can remove it.
    assert env.submit(text="remember that invoices go out on Fridays", user=MEMBER)["can_save"] is False
    with pytest.raises(memory.MemoryError):
        run(memory.add(env.orch, "A", MEMBER, "invoices go out on Fridays"))
    with pytest.raises(Exception):
        run(memory.add(env.orch, "A", OUTSIDER, "anything at all"))
    assert run(memory.remove(env.orch, "A", OWNER, saved["id"])) is True and memory.facts(env.businesses["A"]["data"]) == []
    assert memory.fact_in("What do you remember?") is None and memory.fact_in("remember") is None
    assert env.submit(text="Prepare a quotation for BrightTech Ltd for 2 x Strategy Workshop")["kind"] == "workflow"      # an ordinary request is untouched


def test_the_memory_and_settings_endpoints(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    try:
        with TestClient(app) as client:
            app.dependency_overrides[get_current_user] = lambda: {"id": MEMBER, "email": MEMBER}
            assert client.post("/businesses/A/agent/memory", json={"text": "we close at 5pm"}).status_code == 403
            app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
            fact = client.post("/businesses/A/agent/memory", json={"text": "we close at 5pm"}).json()["fact"]
            listed = client.get("/businesses/A/agent/memory").json()
            assert [f["text"] for f in listed["facts"]] == ["we close at 5pm"] and listed["can_edit"] is True
            assert client.delete(f"/businesses/A/agent/memory/{fact['id']}").json() == {"removed": True}
            policy = client.get("/businesses/A/agent/policy").json()
            assert len(policy["events"]) == 18 and {c["capability"] for c in policy["capabilities"]} == set(WORKFLOWS)
            assert all(c["minimum_plan_label"] in ("Explorer", "Starter") and c["available"] for c in policy["capabilities"])
            asked = client.post("/agent/requests", json={"business_id": "A", "text": "remember that we close at 5pm"}).json()
            assert asked["kind"] == "remember" and asked["fact"] == "we close at 5pm"
            app.dependency_overrides[get_current_user] = lambda: {"id": OUTSIDER, "email": OUTSIDER}
            assert client.get("/businesses/A/agent/memory").status_code in (403, 404)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ══ the panel reports findings and what the Agent is doing, instead of asking to be told ══

def _panel(env):
    from app.modules.agent.summary import build_summary
    return run(build_summary(env.orch, OWNER, "A"))


def test_the_panel_states_the_finding_and_says_what_it_is_doing():
    env = Env()
    env.fin["invoices"] = [
        {"id": "i1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 900, "status": "paid", "reference": "INV-1",
         "payments": [{"id": "p1", "amount": 900, "paid_at": env.now.isoformat(), "receipt": {"number": "REC-1", "sent_at": env.now.isoformat()}}]},
        {"id": "i2", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "total_amount": 100, "status": "sent", "due_date": "2026-09-01", "reference": "INV-2"}]
    by = {s["key"]: s for s in _panel(env)["suggestions"]}
    assert by["concentration"]["text"] == "BrightTech Ltd is 100% of your revenue, above your 40% alert level."      # the figure (paid revenue), not "check your risk"
    assert by["followup"]["text"] == "1 overdue invoice (£100.00 outstanding): I'm preparing the reminder for your approval."
    assert by["followup"]["action"] == {"to": "/agent?tab=needs_approval"}
    # The Agent then does it; what needs the owner is in Needs Approval.
    started = {r["workflow_key"]: r for r in run(autostart.sweep(env.orch, "A"))}
    after = _panel(env)
    assert set(started) == {"payment_followup", "risk_concentration"} and after["needs_approval_count"] == 1
    assert started["risk_concentration"]["status"] == "succeeded" and "BrightTech Ltd is 100.0% of your revenue" in started["risk_concentration"]["summary"]
    assert "followup" not in {s["key"] for s in after["suggestions"]} and "approvals" in {s["key"] for s in after["suggestions"]}
    # Switched off, it asks instead of doing.
    off = Env()
    off.fin["invoices"] = [dict(env.fin["invoices"][1], reminders=[])]
    run(off.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    asks = {s["key"]: s for s in _panel(off)["suggestions"]}["followup"]
    assert asks["text"].endswith("Shall I prepare the reminder?") and asks["action"] == {"capability": "payment_followup"}


def test_the_panel_knows_whether_the_plan_has_agent_tasks():
    assert _panel(Env())["entitlement"]["agent_tasks"] is True
    free = _panel(Env(plan="explorer"))["entitlement"]
    # Explorer has Agent tasks of its own (the everyday documents); what it doesn't include is listed with the plan that does.
    assert free["agent_tasks"] is True and free["agent_tasks_from"] == "Explorer"
    assert "new_invoice" in free["capabilities"] and "scenario_help" not in free["capabilities"]
    assert free["locked"]["scenario_help"] == "Starter" and free["locked"]["new_proposal"] == "Starter" and "new_invoice" not in free["locked"]
    assert free["quotas"]["scenario_help"] == {"limit": 0, "used": 0} and free["allowance_counts"] is True
