"""A conversation decision cannot accidentally confirm a browser's draft form."""
import asyncio
from copy import deepcopy

import pytest

from app.modules.agent import goals, intake_turn


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("action", ["clarify", "respond"])
def test_interruption_keeps_draft_and_reply_without_form_recap(monkeypatch, action):
    store = goals.SessionStore()
    session = run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    session["inputs"] = {"amount": 10000, "use": "equipment"}
    before = deepcopy(session["inputs"])

    async def model(*args, **kwargs):
        return {"intent": "answer", "extracted": [{"slot": "stage", "value": "growing"}],
                "control": {"action": action}, "reply": "Have you started selling, or are you still getting set up?"}, {}

    monkeypatch.setattr(intake_turn, "intake_llm", lambda: object())
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    session = run(goals.add_inputs(store, session, {"amount": 9999, "stage": "hmm still getting there"},
                                  message="hmm still getting there", asked="stage"))
    assert session["inputs"] == before
    assert session["turns"][-1]["content"] == "Have you started selling, or are you still getting set up?"
    assert goals.public(session)["agent_turn"]["control"]["action"] == action


def test_switch_and_resume_keep_one_thread_and_separate_task_drafts(monkeypatch):
    store = goals.SessionStore()
    session = run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    session["inputs"] = {"amount": 10000, "use": "equipment"}
    session["rejected"] = {"stage": "an old validation error"}
    session["subject_choice"] = "funding-case-id"
    sid, history = session["id"], deepcopy(session["turns"])
    target = "create_business_plan"

    async def model(*args, **kwargs):
        return {"control": {"action": "switch", "target": target}, "reply": "Let's change tasks."}, {}

    monkeypatch.setattr(intake_turn, "intake_llm", lambda: object())
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    session = run(goals.add_inputs(store, session, {"amount": 123, "stage": "business plan"},
                                  message="I'd like a business plan instead", asked="stage"))
    assert session["id"] == sid and session["goal_key"] == target
    assert session["inputs"] == {} and not session.get("rejected") and not session.get("subject_choice")
    assert session["turns"][:len(history)] == history
    assert session["paused_tasks"]["need_funding"]["inputs"]["amount"] == 10000
    assert goals.public(session)["goal_key"] == target
    session["inputs"] = {"description": "A mobile repair shop"}
    target = "need_funding"
    session = run(goals.add_inputs(store, session, {}, message="Let's return to funding", asked="description"))
    assert session["id"] == sid and session["goal_key"] == "need_funding"
    assert session["inputs"] == {"amount": 10000, "use": "equipment"}
    assert session["subject_choice"] == "funding-case-id"
    assert session["paused_tasks"]["create_business_plan"]["inputs"] == {"description": "A mobile repair shop"}
    assert session["agent_turn"]["next"] == "stage"


def test_switch_cannot_invent_a_capability_or_write_task_values(monkeypatch):
    async def model(*args, **kwargs):
        return {"control": {"action": "switch", "target": "transfer_bank_funds"}, "intent": "change_goal",
                "reply": "I can help you plan, but cannot transfer funds.", "extracted": []}, {}

    monkeypatch.setattr(intake_turn, "_ask_model", model)
    r = run(intake_turn.turn(goal_key="need_funding", message="Transfer funds", slots=[], known={}, llm=object()))
    assert not r.get("control") and r["values"] == {}


def test_failed_turn_can_be_retried_without_retyping_or_duplicating_history(monkeypatch):
    store = goals.SessionStore()
    session = run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    session["inputs"] = {"amount": 1000000}
    calls = 0

    async def model(llm, payload, message, seconds=0):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError()
        assert "trouble connecting" not in str(payload["LAST_TURNS"])
        return {"intent": "answer", "control": {"action": "continue"}, "extracted": [
            {"slot": "use", "value": "food", "evidence": "food", "confidence": 0.95}],
            "reply": "What stage is the business at?", "asks_for": "stage"}, {}

    monkeypatch.setattr(intake_turn, "intake_llm", lambda: object())
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    session = run(goals.add_inputs(store, session, {}, message="food", asked="use"))
    retry = goals.public(session)["agent_turn"]["retry"]
    assert retry == {"message": "food", "asked": "use"}
    assert session["inputs"] == {"amount": 1000000}
    session = run(goals.add_inputs(store, session, {}, **retry))
    assert session["inputs"]["use"] == "food"
    assert sum(t["role"] == "user" and t["content"] == "food" for t in session["turns"]) == 1
    assert not goals.public(session)["agent_turn"].get("retry")


def test_old_saved_timeout_gets_the_same_retry_control():
    session = {"turns": [{"role": "user", "content": "food"}, {"role": "assistant", "at": "now", "next": "use"}],
               "fallbacks": [{"why": "error:ReadTimeout", "at": "now"}]}
    assert goals.retry_message(session) == {"message": "food", "asked": "use"}


@pytest.mark.parametrize("value", ["food", "coffee beans", "solar panels"])
def test_repeating_the_pending_value_confirms_it_and_moves_on_without_another_model_call(monkeypatch, value):
    store = goals.SessionStore()
    session = run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    session["inputs"] = {"amount": 1000000}
    session["pending_confirm"] = [{"slot": "use", "value": value, "question": f"Just to check: {value}?"}]
    session["turns"].extend([{"role": "user", "content": value}, {"role": "assistant", "content": f"Just to check: {value}?", "next": "use"}])

    async def forbidden(*args, **kwargs):
        raise AssertionError("A confirmed value should not need another model call")
    monkeypatch.setattr(intake_turn, "turn", forbidden)
    session = run(goals.add_inputs(store, session, {"use": value}, message=value, asked="use"))
    assert session["inputs"]["use"] == value
    assert session["agent_turn"]["next"] == "stage"
    assert not session.get("pending_confirm")
    assert session["turns"][-2]["content"] == value
    assert session["turns"][-1]["content"] == session["agent_turn"]["reply"]
    assert "Just to check" not in session["agent_turn"]["reply"]


@pytest.mark.parametrize("value", ["food", "coffee beans", "solar panels"])
def test_literal_text_is_not_an_inferred_fact_that_needs_echo_confirmation(monkeypatch, value):
    async def model(*args, **kwargs):
        return {"intent": "answer", "control": {"action": "continue"}, "extracted": [
            {"slot": "use", "value": value, "evidence": value, "confidence": 0.6}],
            "asks_for": "stage", "reply": "What stage is the business at?"}, {}
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    slots = goals.questions_for("need_funding")
    result = run(intake_turn.turn(goal_key="need_funding", message=value, slots=slots, known={"amount": 1000000}, asked="use", llm=object()))
    assert result["values"]["use"] == value and result["confirm"] == []
    assert result["next"] == "stage"


def test_yes_with_a_new_request_is_not_mistaken_for_blanket_confirmation(monkeypatch):
    store = goals.SessionStore()
    session = run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    session["inputs"] = {"amount": 1000000}
    session["pending_confirm"] = [{"slot": "use", "value": "stock"}]
    async def model(*args, **kwargs):
        return {"control": {"action": "switch", "target": "create_business_plan"}, "reply": "Let's work on your business plan."}, {}
    monkeypatch.setattr(intake_turn, "intake_llm", lambda: object())
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    session = run(goals.add_inputs(store, session, {}, message="Yes, but I want a business plan instead", asked="use"))
    assert session["goal_key"] == "create_business_plan"
    assert "use" not in session["paused_tasks"]["need_funding"]["inputs"]
