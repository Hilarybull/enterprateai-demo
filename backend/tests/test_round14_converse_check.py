"""The free checks as a conversation on their own pages (the owner, 30 Oct: the landing page's shortcuts "should be in a
chat"): more customers, business risks and pricing. A stand-in model; no real model, search or charge. The result is
always the check's own, from its answers and the records."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import research


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text, page, **kw: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "page": page, **kw}).json()      # noqa: E731
    return env, ask, model, client


def _answers(env, goal):
    return ((run(env.orch.rt.business.load("A")).get("quick_check_answers") or {}).get(goal) or {}).get("answers") or {}


def test_the_customers_page_talks_with_its_result_and_a_next_step(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Here's where your customer plan stands."}]
    out = ask("I need more customers", "customers")
    assert out.get("conversational") and out["cards"][0]["type"] == "check_result" and out["cards"][0]["goal"] == "more_customers"
    assert out["cards"][0]["result"].get("headline")
    assert out["actions"]      # always a button to press


def test_an_answer_from_the_owners_words_is_kept_and_the_check_worked_out_again(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Got it.", "change": {"sell": "Liquid soap for car washes", "customer": "Car wash owners in Abuja"}}]
    out = ask("I sell liquid soap for car washes to car wash owners in Abuja", "customers")
    assert _answers(env, "more_customers")["sell"] == "Liquid soap for car washes" and "updated" in out["changed"]


def test_a_price_never_said_is_never_set(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "I've set your price to 5000.", "change": {"price": 5000}}]
    out = ask("what should my price be?", "pricing")
    assert "price" not in _answers(env, "price_offer") and out["message"].startswith("Before I change that")


def test_the_risks_page_is_its_own_chat_never_the_funding_one(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Your biggest risk is relying on a few customers."}]
    out = ask("What are the risks in my business?", "risks")
    assert out.get("conversational") and out.get("case_id") == "risks"
