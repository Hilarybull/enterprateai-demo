"""A4: a written answer says what it cost; one that finds nothing, declines or has nothing to do is free (its hold is
released); a question that a task exists to answer runs that task at its price instead of a chat answer."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

import app.modules.business_assistant.service as chat
import app.modules.credits.service as credits
from app.modules.business_assistant.schemas import BusinessAssistantChatRequest
from test_agent import Env


@pytest.fixture
def wired(monkeypatch):
    held = {"committed": 0, "released": 0}

    @asynccontextmanager
    async def guard(_user, _feature, _key=None):
        try:
            yield
        except BaseException:
            held["released"] += 1
            raise
        held["committed"] += 1

    reply = {"text": ""}

    class LLM:
        async def generate_text(self, **_k):
            return SimpleNamespace(text=reply["text"], provider="stub", model="stub")

    async def llm_for(_u):
        return LLM()

    async def workspace(**_k):
        return SimpleNamespace(id="A", user_id="u1", name="Apex", data={}), True

    async def same(d, _u):
        return d

    async def nothing(*_a, **_k):
        return []

    async def price(_f):
        return {"credit_cost": 2}

    async def ok():
        return None
    monkeypatch.setattr(credits, "credit_guard", guard)
    monkeypatch.setattr(credits, "get_feature_config", price)
    monkeypatch.setattr(chat, "pick_llm_for_user", llm_for)
    import app.modules.addons.service as addons
    import app.modules.idea_validation.service as validation
    monkeypatch.setattr(validation, "_get_accessible_workspace", workspace)
    monkeypatch.setattr(addons, "redact_workspace_data_for_owner", same)
    monkeypatch.setattr(chat, "sb_select", nothing)
    monkeypatch.setattr(chat, "_ensure_chat_price", ok)
    return held, reply


def _ask(text="Which customers pay late?"):
    return asyncio.run(chat.chat_about_business(user_id="u1", payload=BusinessAssistantChatRequest(messages=[{"role": "user", "content": text}], workspace_id="A")))


def test_an_answer_says_what_it_cost(wired):
    held, reply = wired
    reply["text"] = "Nova Labs paid 12 days late on average."
    out = _ask()
    assert out.credits_used == 2 and held == {"committed": 1, "released": 0}


def test_an_answer_that_finds_nothing_is_free(wired):
    held, reply = wired
    reply["text"] = f"{chat.NOTHING} There's no sales data on record yet, so I can't say which services sell best."
    out = _ask("Which of my services sell best?")
    assert out.credits_used == 0 and held == {"committed": 0, "released": 1}
    assert out.answer.startswith("There's no sales data") and chat.NOTHING not in out.answer


def test_a_question_a_task_answers_runs_that_task():
    env = Env(plan="starter_insight", credits=50)
    first = env.submit(text="What evidence am I missing before I launch?")
    assert first.get("run", {}).get("workflow_key") == "launch_evidence_gaps", first
    r = env.submit(text="Which of my services sell best?")
    assert r.get("run", {}).get("workflow_key") == "offer_review"
    assert env.submit(text="What is my biggest risk?")["kind"] == "answer"      # answered from the records, free


def test_e2_a_chat_reply_that_would_act_starts_the_task_or_offers_it_and_costs_nothing(wired):
    held, reply = wired
    reply["text"] = "[ACTION:update_record]"
    out = _ask("the item called Oven deep clean to my catalogue should just be named Oven deep clean")
    assert out.action == "update_record" and out.credits_used == 0 and held == {"committed": 0, "released": 1} and out.answer == ""
    reply["text"] = "Sure, I will rename it now. Let me take care of that."
    out = _ask("sort the name out")
    assert out.action == "none" and out.credits_used == 0 and "rename" not in out.answer


def test_e2_indirect_rename_wording_reaches_the_rename_task():
    from app.modules.agent import intent
    from app.modules.agent.workflows import WORKFLOWS
    for text in ("the item called 'Oven deep clean to my catalogue' should just be named Oven deep clean",
                 "can you fix the name of Window clean, it should be Window clean (inside)", "change the name of Nova Labs to Nova Labs Ltd"):
        assert intent.rule_capability(text, list(WORKFLOWS)) == "update_record", text
