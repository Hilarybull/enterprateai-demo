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


def _funding_at_route():
    store, session = _session()
    for key, value in (("amount", "10000"), ("use", "Equipment"), ("stage", "Trading")):
        session, _ = _say(store, session, value, key)
    return store, session


def test_funding_uncertainty_and_recommendations_do_not_repeat_the_route_menu():
    for message in ("I don't know", "dont know", "not sure", "recommend for me", "could you recommend something", "help me choose"):
        store, session = _funding_at_route()
        session, reply = _say(store, session, message, "route")
        assert session["inputs"]["route"] == "unknown", message
        assert reply["next"] == "timing", message
        assert "repayments" in reply["reply"] and "ownership" in reply["reply"], message
        assert "Are you thinking of a loan" not in reply["reply"], message
        assert "didn't quite get" not in reply["reply"], message
        assert "for the route" not in reply["reply"], message
        assert "equipment" in reply["reply"].lower(), message


def test_semantic_advice_uses_context_without_saving_a_suggested_funding_choice(monkeypatch):
    store, session = _funding_at_route()
    async def model(*_args, **_kwargs):
        return {"intent": "answer", "help_kind": "advice", "extracted": [{"slot": "route", "value": "loan", "evidence": "Steer me towards a sensible starting point", "confidence": 0.99}],
                "answer_to_user_question": "For your equipment purchase, compare repayments with the cash the equipment can generate. We can keep the funding type open while we check your timeline."}, {}
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    reply = asyncio.run(intake_turn.turn(goal_key="need_funding", message="Steer me towards a sensible starting point", slots=goals._questions(session), known=session["inputs"], asked="route", llm=object()))
    assert reply["values"]["route"] == "unknown"
    assert reply["next"] == "timing"
    assert "equipment purchase" in reply["reply"]
    assert all(not r["kept"] for r in reply["records"] if r["slot"] == "route")


def test_semantic_uncertainty_handles_unfamiliar_wording(monkeypatch):
    store, session = _funding_at_route()
    async def model(*_args, **_kwargs):
        return {"intent": "not_sure", "extracted": [], "marked_unknown": ["route", "timing"]}, {}
    monkeypatch.setattr(intake_turn, "_ask_model", model)
    reply = asyncio.run(intake_turn.turn(goal_key="need_funding", message="I'm completely at sea with those choices", slots=goals._questions(session), known=session["inputs"], asked="route", llm=object()))
    assert reply["values"] == {"route": "unknown"}
    assert reply["next"] == "timing"


def test_intake_model_receives_known_values_and_business_facts():
    payload = intake_turn._slim_payload({"GOAL": "need_funding", "CURRENT_QUESTION": "route", "NEXT_SLOT": "route", "SLOTS": [],
        "KNOWN": {"amount": {"value": 10000}, "use": {"value": "equipment"}, "stage": {"value": "trading"}},
        "FACTS_ON_FILE": {"company_name": "Example Ltd"}, "LAST_TURNS": [{"role": "user", "text": "For equipment"}]})
    assert payload["KNOWN"]["amount"]["value"] == 10000
    assert payload["KNOWN"]["use"]["value"] == "equipment"
    assert payload["FACTS_ON_FILE"]["company_name"] == "Example Ltd"
    assert payload["LAST_TURNS"][0]["role"] == "user"


def test_natural_choice_answers_and_typos_work_without_a_model():
    cases = [("hmmm, tradin for now", "trading"), ("we're trdaing already", "trading"),
             ("not tradin yet", "pre_revenue"), ("not currently tradin", "pre_revenue"),
             ("we are trading, not growing", "trading"), ("we're not currently growing but trading", "trading"),
             ("currently expanding", "growing"), ("it's just an idea right now", "idea")]
    for message, expected in cases:
        store, session = _session()
        for key, value in (("amount", "1000000"), ("use", "for entertainment")):
            session, _ = _say(store, session, value, key)
        session, reply = _say(store, session, message, "stage")
        assert session["inputs"].get("stage") == expected, (message, reply)
        assert reply["next"] == "route", (message, reply)
        assert "didn't quite get" not in reply["reply"]


def test_choice_typo_repair_is_scoped_to_the_current_options():
    slot = {"key": "route", "type": "choice", "options": [{"value": "grant", "label": "A grant"}, {"value": "loan", "label": "A loan"}]}
    assert intake_turn._choice_words("route", "a grnt please", slot) == "grant"
    assert intake_turn._choice_words("route", "not a loan", slot) is None
    assert intake_turn._choice_words("route", "a loan or a grant", slot) is None
    assert intake_turn._choice_words("route", "something completely different", slot) is None
    stage = {"options": [{"value": "trading", "label": "Trading"}, {"value": "growing", "label": "Growing"}]}
    assert intake_turn._choice_words("stage", "training", stage) is None
    assert intake_turn._choice_words("stage", "rowing", stage) is None


def test_frustration_does_not_become_business_data_or_repeat_the_question():
    for message in ("this is nonsense", "are you stupid?", "wait, are you joking?", "fuck you", "stop repeating yourself"):
        store, session = _funding_at_route()
        session, reply = _say(store, session, message, "route")
        assert "route" not in session["inputs"], (message, session["inputs"])
        assert reply["intent"] == "question_to_agent"
        assert "Are you thinking of a loan" not in goals.public(session)["turns"][-1]["content"]
        assert "didn't quite get" not in reply["reply"]


def test_general_enquiry_is_answered_then_the_owner_can_resume(monkeypatch):
    store, session = _funding_at_route()
    async def model(*_args, **_kwargs):
        return {"intent": "question_to_agent", "help_kind": "enquiry", "extracted": [],
                "answer_to_user_question": "This check uses your answers to assess how prepared you are to approach funders."}, {}
    with monkeypatch.context() as scoped:
        scoped.setattr(intake_turn, "_ask_model", model)
        scoped.setattr(intake_turn, "intake_llm", lambda: object())
        session = asyncio.run(goals.add_inputs(store, session, {"route": "Before that, how does this check work?"},
            message="Before that, how does this check work?", asked="route"))
    reply = session["agent_turn"]
    assert "assess how prepared" in reply["reply"]
    assert "Are you thinking of a loan" not in reply["reply"]
    assert "route" not in session["inputs"]
    session, reply = _say(store, session, "A loan", "route")
    assert session["inputs"]["route"] == "loan" and reply["next"] == "timing"


def test_product_of_course_is_a_kind_not_a_named_product():
    store = goals.SessionStore()
    session = asyncio.run(goals.start(store, text=None, key="launch", entry_mode="business_goal"))
    session, reply = _say(store, session, "a product of course", "kind")
    assert session["inputs"].get("kind") == "product"
    assert "sell" not in session["inputs"]
    assert reply["next"] == "sell"
    assert "Product of course" not in reply["reply"]
    assert reply["reply"] == "What product are you launching?"
    session, reply = _say(store, session, "a reusable water bottle", "sell")
    assert "water bottle" in session["inputs"]["sell"]
    assert reply["next"] == "stage"


def test_validated_model_reply_is_used_instead_of_a_formulaic_recap(monkeypatch):
    store = goals.SessionStore()
    session = asyncio.run(goals.start(store, text=None, key="launch", entry_mode="business_goal"))
    async def model(*_args, **_kwargs):
        return intake_turn._from_slim({"i":"answer","x":[["stage","prototype","a prototype",0.99]],"u":[],"a":None,"h":None,
            "n":"customer","r":"Who would you like to sell it to?"}), {}
    monkeypatch.setattr(intake_turn,"_ask_model",model)
    reply = asyncio.run(intake_turn.turn(goal_key="launch",message="We already have a prototype people can try",slots=goals._questions(session),
        known={"kind":"product","sell":"a reusable water bottle"},asked="stage",llm=object()))
    assert reply["reply"] == "Who would you like to sell it to?"
    assert reply["values"] == {"stage":"prototype"}
