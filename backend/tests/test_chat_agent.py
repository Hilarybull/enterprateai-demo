"""The one Agent conversation with Claude (the owner, 11 Nov: "it should be able to chat and still carry out tasks when a task
is required", "for funding and launch readiness too"). Claude is scripted here, so these run offline: they check what the
loop does with what the model says and asks for, against the real orchestrator and workflows."""
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.modules.agent import chat_agent, conductor
from app.shared.llm import tool_chat
from app.shared.llm.tool_chat import Call, Reply
from test_agent import OWNER, Env, run

USER = {"id": OWNER, "email": OWNER}


def text(t):
    return Reply(text=t, provider="claude")


def tool(name, args, tid="t1"):
    return Reply(text="", calls=[Call(id=tid, name=name, input=args)], provider="claude")


@pytest.fixture
def claude(monkeypatch):
    """Claude, scripted: each call takes the next reply; what it was sent is kept."""
    script, seen = [], []
    monkeypatch.setattr(get_settings(), "claude_api_key", "test-key", raising=False)

    async def ask(items, user_id=None):
        seen.append([dict(m) if isinstance(m, dict) else m for m in items])
        return script.pop(0)
    monkeypatch.setattr(chat_agent, "_ask", ask)
    return script, seen


def say(env, words):
    known = env.businesses["A"]["data"]
    return run(conductor.turn(env.orch, USER, SimpleNamespace(business_id="A", text=words, locale=None), known))


def test_it_chats_then_drafts_the_invoice_for_a_service_not_in_the_catalogue(claude):
    script, seen = claude
    env = Env()
    script.append(text("Happy to. What's the price for SAP S4HANA Material Management? Next step: tell me the price."))
    out = say(env, "create a new invoice for Tosin Giwa. Service is SAP S4HANA Material Management")
    assert out["kind"] == "answer" and "price for SAP S4HANA" in out["message"]
    assert env.meter.balances[OWNER] == 98      # a written reply: one chat, charged once
    # The answer, with "no email": the invoice is drafted, waiting for approval, the email left for later
    script += [tool("create_invoice", {"customer_name": "Tosin Giwa", "customer_email": "", "items": [{"name": "SAP S4HANA Material Management", "quantity": 1, "unit_price": 300}],
                                       "due_date": "", "notes": "", "vat_rate": "", "price_agreed": False})]
    out = say(env, "300, no email for now")
    assert out["kind"] == "workflow" and out["run"]["status"] == "awaiting_approval"
    payload = run(env.store.list_approvals(run_id=out["run"]["id"], status="pending"))[0]["payload"]
    assert payload["customer_name"] == "Tosin Giwa" and [(i["description"], i["qty"], i["unit_price"]) for i in payload["items"]] == [("SAP S4HANA Material Management", 1, 300)]
    # The earlier turns were in what Claude read the second time
    assert "create a new invoice for Tosin Giwa" in str(seen[-1])


def test_a_missing_price_is_asked_for_and_nothing_is_left_half_started(claude):
    script, seen = claude
    env = Env()
    script += [tool("create_invoice", {"customer_name": "Tosin Giwa", "customer_email": "later", "items": [{"name": "Training", "quantity": 2, "unit_price": 0}],
                                       "due_date": "", "notes": "", "vat_rate": "", "price_agreed": False}),
               text("What's the price for each Training session? Next step: tell me the price.")]
    out = say(env, "invoice Tosin for 2 training sessions")
    assert out["kind"] == "answer" and "price" in out["message"]
    result = seen[-1][-1]["results"][0]["content"]
    assert "the price for Training" in result and "valid email" in result      # "later" is never kept as the address
    assert run(env.store.list_runs("A", statuses=["running"])) == []      # no task left waiting


def test_a_customer_on_record_and_a_catalogue_item_are_matched_for_a_quotation(claude):
    script, _seen = claude
    env = Env()
    script += [tool("create_quote", {"customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "items": [{"name": "Strategy Workshop", "quantity": 1, "unit_price": 1500}],
                                     "notes": "", "vat_rate": "", "price_agreed": False})]
    out = say(env, "quote BrightTech for a strategy workshop")
    assert out["kind"] == "workflow" and out["run"]["status"] == "awaiting_approval"
    payload = run(env.store.list_approvals(run_id=out["run"]["id"], status="pending"))[0]["payload"]
    assert payload["customer_name"] == "BrightTech Ltd" and payload["items"][0]["price_source"] == "catalogue"


def test_records_are_looked_up_instead_of_asked(claude):
    env = Env()
    assert chat_agent.find_customer(env.businesses["A"]["data"], "bright") == {"customers": [{"name": "BrightTech Ltd", "email": "buyer@brighttech.test"}]}
    assert chat_agent.find_customer(env.businesses["A"]["data"], "Tosin")["customers"] == []
    assert {"name": "Strategy Workshop", "price": 1500.0} in chat_agent.read_catalogue(env.businesses["A"]["data"])["items"]


def test_funding_work_goes_through_the_funding_chat_and_is_charged_once(claude, monkeypatch):
    script, _seen = claude
    env = Env()
    from app.modules.agent import converse
    asked = []

    async def funding_turn(*, orch, user, business_id, text):
        asked.append(text)
        res = await converse.paid_reply(orch, user, lambda: _reply())      # the funding chat charges its own replies when called alone
        return {"kind": "answer", "message": res.text, "actions": [{"label": "Search", "kind": "explain", "prompt": "Yes, start"}]}

    async def _reply():
        return SimpleNamespace(text="I'll search for programmes, lenders and investors that fit your case. Shall I start?",
                               kind="answer", message="I'll search for programmes, lenders and investors that fit your case. Shall I start?")
    monkeypatch.setattr(converse, "turn", funding_turn)
    script.append(tool("work_on_funding", {"request": "what are the funding options"}))
    out = say(env, "what are the funding options")
    assert asked == ["what are the funding options"]
    assert out["message"].endswith("Shall I start?") and out["actions"][0]["prompt"] == "Yes, start"      # its reply and buttons, as they are
    assert env.meter.balances[OWNER] == 98      # one reply, one charge, never two


def test_other_areas_are_handed_over_without_a_charge(claude):
    script, _seen = claude
    env = Env()
    script.append(tool("hand_over", {"module": "contract"}))
    assert say(env, "draft a contract for BrightTech") == conductor.PASS
    assert env.meter.balances[OWNER] == 100


def test_without_claude_the_chat_that_answers_today_answers(claude, monkeypatch):
    script, _seen = claude
    env = Env()

    async def broken(items, user_id=None):
        raise RuntimeError("model unavailable")
    monkeypatch.setattr(chat_agent, "_ask", broken)
    monkeypatch.setattr("app.modules.agent.research._default_llm", lambda _uid: None)
    assert say(env, "hello") is None
    assert env.meter.balances[OWNER] == 100      # nothing charged for a reply that wasn't written


# ── The provider layer: Claude first, OpenAI as the backup (the owner, 11 Nov) ──

def test_openai_answers_when_claude_cannot(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "claude_api_key", "k1", raising=False)
    monkeypatch.setattr(s, "openai_api_key", "k2", raising=False)
    tried = []

    async def claude_down(*a):
        tried.append("claude")
        raise RuntimeError("overloaded")

    async def openai_up(*a):
        tried.append("openai")
        return Reply(text="Hello from the backup.", provider="openai")
    monkeypatch.setattr(tool_chat, "_claude", claude_down)
    monkeypatch.setattr(tool_chat, "_openai", openai_up)
    got = run(tool_chat.chat(system="s", items=[{"role": "user", "text": "hi"}], tools=[]))
    assert tried == ["claude", "openai"] and got.text == "Hello from the backup."
    monkeypatch.setattr(s, "openai_api_key", None, raising=False)
    with pytest.raises(RuntimeError):
        run(tool_chat.chat(system="s", items=[{"role": "user", "text": "hi"}], tools=[]))
    monkeypatch.setattr(s, "claude_api_key", None, raising=False)
    assert tool_chat.providers() == [] and not chat_agent.available()


def test_one_conversation_reads_the_same_to_either_provider():
    items = [{"role": "user", "text": "invoice Tosin 300"},
             {"role": "note", "text": "CONTEXT: Apex"},
             {"role": "assistant", "text": "", "calls": [Call(id="call_1", name="create_invoice", input={"customer_name": "Tosin"})], "raw": None},
             {"role": "tool", "results": [{"id": "call_1", "name": "create_invoice", "content": '{"created": false}', "is_error": False}]}]
    claude = tool_chat.claude_messages(items)
    assert [m["role"] for m in claude] == ["user", "system", "assistant", "user"]
    assert claude[2]["content"][0] == {"type": "tool_use", "id": "call_1", "name": "create_invoice", "input": {"customer_name": "Tosin"}}
    assert claude[3]["content"][0]["tool_use_id"] == "call_1"
    openai = tool_chat.openai_input("SYSTEM", items)
    assert openai[0] == {"role": "system", "content": "SYSTEM"}
    assert openai[3] == {"type": "function_call", "call_id": "call_1", "name": "create_invoice", "arguments": '{"customer_name": "Tosin"}'}
    assert openai[4] == {"type": "function_call_output", "call_id": "call_1", "output": '{"created": false}'}
    tools = tool_chat.openai_tools(chat_agent.TOOLS)
    assert {t["name"] for t in tools} >= {"create_invoice", "work_on_funding"} and all(t["type"] == "function" for t in tools)
    assert next(t for t in tools if t["name"] == "create_invoice")["strict"] is True


def test_a_reply_brings_its_quick_actions_as_buttons(claude):
    script, _seen = claude
    env = Env()
    script.append(text("It's a **new registration rather than a renewal**. Next step: register it.\n<quick_actions>\n- Register piclehdest.org for me\n"
                       "Show me the registration price\nIs it still linked to my hosting plan?\nOne too many\n</quick_actions>"))
    out = say(env, "can I renew piclehdest.org?")
    assert out["message"] == "It's a **new registration rather than a renewal**. Next step: register it." and out["quick"] is True
    assert [a["prompt"] for a in out["actions"]] == ["Register piclehdest.org for me", "Show me the registration price", "Is it still linked to my hosting plan?"]
    assert "quick_actions" not in str(env.businesses["A"]["data"].get("agent_thread"))      # the thread keeps the words, not the buttons


def test_a_task_that_needs_details_is_asked_by_the_agent_in_its_own_words(claude, monkeypatch):
    # The owner, 12 Nov: "Hello" answered with the business plan's form, "Who will read it?"
    script, seen = claude
    env = Env()

    async def plan(orch, user, business_id, args):
        return {"final": {"kind": "needs_input", "message": "Happy to draft your business plan. One quick question so it fits.",
                          "fields": [{"key": "purpose", "label": "Who will read it?", "required": True,
                                      "options": [{"value": "investors", "label": "Investors, to raise funding"}, {"value": "bank", "label": "A bank or lender, for a loan"}]}]}}
    monkeypatch.setattr(conductor, "_business_plan", plan)
    script += [tool("write_business_plan", {"start": False}), text("Happy to. Who's it for: **investors** or a **bank**? Next step: tell me who'll read it.")]
    out = say(env, "I need a business plan")
    assert out["kind"] == "answer" and out["message"].startswith("Happy to. Who's it for")      # the Agent's words, not the form
    asked = seen[-1][-1]["results"][0]["content"]
    assert "Who will read it?" in asked and "Investors, to raise funding" in asked
