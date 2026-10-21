"""The landing chat answers like it understood (the owner's QA, 16 Oct): "what if I don't know the amount?" is fine and moves
on; a reply about one thing never marks other questions "not sure"; nothing reads "not sure yet on one"."""
import asyncio

from app.modules.agent import goals, intake_turn


def _session():
    store = goals.SessionStore()
    return store, asyncio.run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))


def _say(store, s, msg, asked):
    s = asyncio.run(goals.add_inputs(store, s, {asked: msg}, message=msg, asked=asked, rules_only=True))
    return s, s["agent_turn"]


def test_not_knowing_the_amount_is_fine_and_the_chat_moves_on():
    store, s = _session()
    s, t = _say(store, s, "what if I dont know the amount?", "amount")
    assert s["inputs"]["amount"] == "unknown" and not (s.get("rejected") or {}).get("amount")
    assert t["next"] == "use" and t["reply"].startswith("No problem, we can leave the amount open for now.")


def test_an_earlier_number_error_clears_once_the_reply_is_handled():
    store, s = _session()
    s, _ = _say(store, s, "a lot", "amount")
    assert s["rejected"]["amount"]
    s, _ = _say(store, s, "I'm not sure how much yet", "amount")
    assert not s["rejected"].get("amount") and s["inputs"]["amount"] == "unknown"


def test_what_it_is_for_reads_without_the_speakers_words():
    store, s = _session()
    s, _ = _say(store, s, "not sure", "amount")
    s, t = _say(store, s, "I want new customers", "use")
    assert "for new customers" in t["reply"] and "i want" not in t["reply"].lower() and "not sure yet on one" not in t["reply"]


def test_the_models_unknowns_never_reach_questions_not_asked_or_named():
    store, s = _session()
    slots = goals._questions(s)

    async def model(llm, payload, message, seconds=0):
        return {"intent": "answer", "extracted": [{"slot": "use", "value": "new customers", "evidence": "new customers", "confidence": 0.9}],
                "marked_unknown": ["amount", "timing", "traction"], "reply": "Got it: not sure yet on one", "asks_for": "stage"}, {}
    real, intake_turn._ask_model = intake_turn._ask_model, model
    try:
        r = asyncio.run(intake_turn.turn(goal_key="need_funding", message="I want new customers", slots=slots, known={"amount": "unknown"}, asked="use", llm=object()))
    finally:
        intake_turn._ask_model = real
    assert r["values"] == {"use": "new customers"} and r["reply"] == "Good, so the money is for new customers. What stage is the business at?"


def test_left_open_is_said_once_by_name():
    slots = {"amount": {"key": "amount"}, "timing": {"key": "timing"}}
    assert intake_turn.acknowledgement({"amount": "unknown", "timing": "unknown"}, slots, {}, "GBP") == "No problem, we can leave the amount and the timing open for now."


def test_a_question_handed_back_is_never_an_answer():
    store, s = _session()
    s, _ = _say(store, s, "10000", "amount")
    for said in ("what do you think", "you tell me", "any ideas?", "whatever you think"):
        s, t = _say(store, s, said, "use")
        assert "use" not in s["inputs"], said
        assert t["next"] == "use" and "equipment, stock, hiring, marketing or working capital" in t["reply"], said
        assert "for a what" not in t["reply"].lower()
