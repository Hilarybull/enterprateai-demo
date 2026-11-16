"""The one Agent conversation (the owner, 31 Oct): one thread whatever the topic; the model answers or assigns the work to a
module. A stand-in model; no real model, search or charge beyond the stand-in meter."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import research


@pytest.fixture
def agent(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    monkeypatch.setenv("AGENT_CONDUCTOR", "1")
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()      # noqa: E731
    return env, ask, model


def _idea(env):
    return ((run(env.orch.rt.business.load("A")).get("quick_check_answers") or {}).get("test_idea") or {}).get("answers") or {}


def test_an_idea_said_in_the_chat_is_saved_and_checked_then_the_reply_uses_its_result(agent):
    env, ask, model = agent
    model.replies += [{"say": "", "tool": {"name": "save_idea", "args": {"description": "Mobile coffee van", "customer": "office workers", "price": 3}}},
                      {"say": "Your coffee van idea is saved and at a starting score. Next, what does one coffee cost you?", "tool": None,
                       "buttons": [{"label": "Run the idea validation", "text": "Run the idea validation"}]}]
    out = ask("I want to start a mobile coffee van for office workers, £3 a coffee. Is it a good idea?")
    assert _idea(env)["description"] == "Mobile coffee van" and float(_idea(env)["price"]) == 3
    assert out["message"].startswith("Your coffee van idea is saved") and out["actions"][0]["label"] == "Run the idea validation"
    assert model.prompts[-1]["TOOL_RESULTS"][0]["result"]["saved"] is True      # the reply saw the module's result


def test_one_thread_whatever_was_pressed_in_between(agent):
    # The owner, 31 Oct: "i already told you" after pressing "Am I ready to launch?" went to another brain
    env, ask, model = agent
    model.replies += [{"say": "Got it: £29,000 for equipment. What stage is the business at?", "tool": None},
                      {"say": "You said £29,000 for equipment. Let's carry on.", "tool": None}]
    ask("29000 for equipments")
    ask("i already told you")
    assert any(t["text"] == "29000 for equipments" for t in model.prompts[-1]["THREAD"])      # the whole conversation, never lost


def test_a_funding_request_is_handed_to_its_own_flow(agent):
    env, ask, model = agent
    model.replies += [{"say": "", "tool": {"name": "hand_over", "args": {"module": "funding"}}}]
    out = ask("I need £15,000 for a coffee van")
    assert out.get("kind") and "hand" not in str(out.get("message") or "").lower()      # the funding chat answered, as before


def test_the_business_plan_says_its_price_first_and_starts_only_on_yes(agent):
    env, ask, model = agent
    env.meter.balances[OWNER] = 100
    model.replies += [{"say": "", "tool": {"name": "write_business_plan", "args": {"description": "Mobile coffee van", "purpose": "a bank or lender", "start": False}}}]
    out = ask("Write my business plan for the coffee van, for the bank")
    assert [a["label"] for a in out["actions"]] == ["Start", "Not now"] and "credits" in out["message"]
    assert not run(env.store.list_runs("A"))      # nothing started before the yes


def test_a_document_asked_on_a_module_page_goes_to_the_agent_centre(world):
    # The owner, 31 Oct: "I need an invoice" on the idea page; its answer then went to the idea's chat
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/agent/requests", json={"business_id": "A", "text": "I need an invoice", "source_channel": "text", "page": "idea"}).json()
    assert out.get("elsewhere") == "/agent"
