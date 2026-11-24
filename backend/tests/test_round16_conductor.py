"""The one Agent conversation (the owner, 31 Oct): one thread whatever the topic; the model answers or assigns the work to a
module. Through the real route, with the model scripted (chat_agent.py): no real model, search or charge beyond the stand-in meter."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from app.core.config import get_settings
from app.modules.agent import chat_agent
from app.shared.llm.tool_chat import Call, Reply


class _Script:
    """The model, scripted: each call takes the next reply; what it was sent is kept."""
    def __init__(self):
        self.replies, self.seen = [], []

    async def __call__(self, items, user_id=None):
        self.seen.append(list(items))
        return self.replies.pop(0)


def _text(t):
    return Reply(text=t, provider="claude")


def _tool(name, args):
    return Reply(text="", calls=[Call(id="t1", name=name, input=args)], provider="claude")


@pytest.fixture
def agent(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    monkeypatch.setenv("AGENT_CONDUCTOR", "1")
    monkeypatch.setattr(get_settings(), "claude_api_key", "test-key", raising=False)
    model = _Script()
    monkeypatch.setattr(chat_agent, "_ask", model)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()      # noqa: E731
    return env, ask, model


def _idea(env):
    return ((run(env.orch.rt.business.load("A")).get("quick_check_answers") or {}).get("test_idea") or {}).get("answers") or {}


def test_an_idea_said_in_the_chat_is_saved_and_checked_then_the_reply_uses_its_result(agent):
    env, ask, model = agent
    model.replies += [_tool("save_idea", {"description": "Mobile coffee van", "customer": "office workers", "price": "3"}),
                      _text("Your coffee van idea is saved and at a starting score. Next step: tell me what one coffee costs you.\n"
                            "<quick_actions>\nRun the idea validation\n</quick_actions>")]
    out = ask("I want to start a mobile coffee van for office workers, £3 a coffee. Is it a good idea?")
    assert _idea(env)["description"] == "Mobile coffee van" and float(_idea(env)["price"]) == 3
    assert out["message"].startswith("Your coffee van idea is saved") and out["actions"][0]["label"] == "Run the idea validation"
    assert '"saved": true' in model.seen[-1][-1]["results"][0]["content"]      # the reply saw the module's result


def test_one_thread_whatever_was_pressed_in_between(agent):
    # The owner, 31 Oct: "i already told you" after pressing "Am I ready to launch?" went to another brain
    env, ask, model = agent
    model.replies += [_text("Got it: £29,000 for equipment. What stage is the business at?"), _text("You said £29,000 for equipment. Let's carry on.")]
    ask("29000 for equipments")
    ask("i already told you")
    assert "29000 for equipments" in model.seen[-1][0]["text"]      # the whole conversation, never lost


def test_a_funding_request_is_handed_to_its_own_flow(agent):
    env, ask, model = agent
    model.replies += [_tool("work_on_funding", {"request": "I need £15,000 for a coffee van"})]
    out = ask("I need £15,000 for a coffee van")
    assert out.get("kind") and "hand" not in str(out.get("message") or "").lower()      # the funding chat answered, as before


def test_a_direct_business_plan_request_uses_its_workflow_without_charging_for_intake(agent):
    env, ask, model = agent
    env.meter.balances[OWNER] = 100
    out = ask("Write my business plan for the coffee van, for the bank")
    assert out["kind"] == "needs_input" and out["capability"] == "business_plan_draft"
    assert out["fields"] and model.seen == []
    assert env.meter.balances[OWNER] == 100
    assert not run(env.store.list_runs("A"))      # nothing started before the yes


def test_a_document_asked_on_a_module_page_continues_in_the_same_chat(world):
    # The owner, 31 Oct: "I need an invoice" on the idea page; its answer then went to the idea's chat
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/agent/requests", json={"business_id": "A", "text": "I need an invoice", "source_channel": "text", "page": "idea"}).json()
    assert out.get("elsewhere") is None
    assert out["kind"] == "workflow" and out["capability"] == "new_invoice"
