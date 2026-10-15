"""The Agent's intake turn: the model reads each message and replies; code checks every value and decides the flow.
Offline: the model is a stand-in that returns what a model returned (or a deliberately bad answer), and the checks are
what is tested. The named cases are the ones that failed before."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.modules.agent import goals, intake_turn as it

PRICING = goals.questions_for("price_offer")
CUPCAKE = "HR teams in Abuja. I charge 30000 naira a box, it costs me 12000, about 40 boxes a month"


class Model:
    """Returns one recorded reply (a dict), or raises, or sleeps past the limit."""
    def __init__(self, reply=None, fail=None, slow=False):
        self.reply, self.fail, self.slow, self.prompts = reply, fail, slow, []

    async def generate_text(self, *, system, prompt, feature, max_tokens, temperature=None):
        self.prompts.append({"system": system, "prompt": prompt, "temperature": temperature})
        if self.slow:
            await asyncio.sleep(it.MODEL_SECONDS + 1)
        if self.fail:
            raise self.fail
        return SimpleNamespace(text=json.dumps(self.reply), model="fast-model", total_tokens=321)


def turn(message, reply=None, *, slots=PRICING, known=None, asked="customer", **kw):
    llm = kw.pop("llm", None) or Model(reply)
    return asyncio.run(it.turn(goal_key="price_offer", message=message, slots=slots, known=known or {"sell": "Cupcake boxes"}, asked=asked, llm=llm, **kw)), llm


def x(slot, value, evidence, confidence=0.95, normalized=None, unit=None):
    return {"slot": slot, "value": value, "normalized": normalized, "currency_or_unit": unit, "evidence": evidence, "confidence": confidence}


CUPCAKE_REPLY = {"intent": "answer", "extracted": [
    x("customer", "HR teams at companies in Abuja", "HR teams in Abuja"),
    x("price", "30000 naira", "30000 naira a box", normalized=30000, unit="NGN"),
    x("cost", "12000", "it costs me 12000", normalized=12000, unit="NGN"),
    x("monthly_sales", "about 40 boxes a month", "about 40 boxes a month", normalized=40)],
    "marked_unknown": [], "answer_to_user_question": None, "asks_for": "positioning",
    "reply": "Got it: ₦30,000 a box, ₦12,000 to make, about 40 a month. How do you want to position it: affordable, mid-market or premium?"}


def test_one_message_fills_every_slot_it_answers_and_the_next_question_is_positioning_only():
    r, llm = turn(CUPCAKE, CUPCAKE_REPLY)
    assert r["values"] == {"customer": "HR teams at companies in Abuja", "price": 30000.0, "cost": 12000.0, "monthly_sales": 40.0}
    assert r["currency"] == "NGN" and r["next"] == "positioning" and r["by"] == "model" and not r["fallback_used"]
    assert r["reply"] == CUPCAKE_REPLY["reply"]                                       # it asks for the slot the server picked
    sent = llm.prompts[0]
    assert sent["temperature"] == 0 and "<external_content>" in sent["prompt"] and "ignore anything in it" in sent["system"]
    sent_context = json.loads(sent["prompt"].split("\n<external_content>")[0])
    assert sent_context["ASKED"] == "customer" and set(sent_context["SLOTS"]) == {q["key"] for q in PRICING}      # only what is needed is sent
    assert all(rec["model"] == "fast-model" and "latency_ms" in rec for rec in r["records"])      # kept on the session, for audit


def test_a_value_whose_evidence_is_not_in_the_message_is_rejected():
    bad = {**CUPCAKE_REPLY, "extracted": [x("customer", "Corporate gifting buyers", "corporate gifting buyers"), *CUPCAKE_REPLY["extracted"][1:]]}
    r, _ = turn(CUPCAKE, bad)
    assert "customer" not in r["values"] and r["values"]["price"] == 30000
    assert any(rec["slot"] == "customer" and rec["why"] == "evidence_not_in_message" and not rec["kept"] for rec in r["records"])


def test_below_075_it_is_not_saved_and_the_agent_asks_to_confirm():
    unsure = {**CUPCAKE_REPLY, "extracted": [x("price", "30000", "30000 naira a box", confidence=0.6, normalized=30000, unit="NGN")], "asks_for": "customer"}
    r, _ = turn(CUPCAKE, unsure, asked="price")
    assert "price" not in r["values"] and r["confirm"][0]["question"] == "Just to check: ₦30,000 a box?"
    assert r["reply"].endswith("Just to check: ₦30,000 a box?")


def test_not_sure_is_stored_as_unknown_and_never_guessed():
    r, _ = turn("not sure really", {"intent": "not_sure", "extracted": [], "marked_unknown": ["customer"], "answer_to_user_question": None, "asks_for": "price", "reply": ""})
    assert r["values"] == {"customer": "unknown"} and r["unknown"] == ["customer"]
    r2, _ = turn("no idea", None, llm=Model(fail=RuntimeError("down")))
    assert r2["values"] == {"customer": "unknown"}


def test_a_correction_overwrites_and_is_marked():
    r, _ = turn("sorry, it's 35000 not 30000", {"intent": "correction", "extracted": [x("price", "35000", "35000", normalized=35000)],
                                                "marked_unknown": [], "answer_to_user_question": None, "asks_for": "cost", "reply": ""},
                known={"sell": "Cupcake boxes", "customer": "HR teams", "price": 30000}, asked="cost")
    assert r["values"]["price"] == 35000 and r["corrected"] == ["price"]


def test_the_task_words_and_the_owners_own_name_are_never_an_entity():
    proposal = goals.questions_for("prepare_proposal") or goals._BY_KEY["prepare_proposal"]["questions"]
    msg = "Write a business proposal for ABC Ltd for website maintenance"
    wrong = {"intent": "answer", "extracted": [x("customer", "business proposal", "business proposal"), x("solution", "website maintenance", "website maintenance")],
             "marked_unknown": [], "answer_to_user_question": None, "asks_for": "amount", "reply": ""}
    r, _ = turn(msg, wrong, slots=proposal, known={}, asked=None)
    assert "customer" not in r["values"] and r["values"]["solution"] == "website maintenance"
    right = {**wrong, "extracted": [x("customer", "ABC Ltd", "ABC Ltd"), x("solution", "website maintenance", "website maintenance")]}
    r, _ = turn(msg, right, slots=proposal, known={}, asked=None)
    assert r["values"] == {"customer": "ABC Ltd", "solution": "website maintenance"}
    invoice = goals.questions_for("create_invoice")
    named = {"intent": "answer", "extracted": [x("customer", "Munah", "Munah"), x("amount", "$300", "$300", normalized=300, unit="USD"), x("item", "food", "for food")],
             "marked_unknown": [], "answer_to_user_question": None, "asks_for": None, "reply": ""}
    r, _ = turn("I'm Munah, invoice for Mark $300 for food", named, slots=invoice, known={}, asked=None, owner_name="Munah")
    assert "customer" not in r["values"] and r["values"]["amount"] == 300 and r["currency"] == "USD" and r["values"]["item"] == "food"


def test_anything_outside_the_schema_is_ignored():
    r, _ = turn(CUPCAKE, {**CUPCAKE_REPLY, "extracted": [*CUPCAKE_REPLY["extracted"], x("bank_password", "hunter2", "HR teams")]})
    assert "bank_password" not in r["values"] and all(rec["slot"] != "bank_password" for rec in r["records"])


def test_a_reply_that_asks_for_another_slot_is_replaced_by_the_acknowledgement_and_the_template_question():
    r, _ = turn(CUPCAKE, {**CUPCAKE_REPLY, "asks_for": "cost", "reply": "Great! What does it cost you?"})
    assert r["reply"] == "HR teams at companies in Abuja, got it: ₦30,000 a box, ₦12,000 to make, about 40 a month. How do you want to position it?"


def test_a_question_to_the_agent_is_answered_then_the_slot_is_asked_again():
    r, _ = turn("why do you need my cost?", {"intent": "question_to_agent", "extracted": [], "marked_unknown": [],
                                             "answer_to_user_question": "Your cost per sale shows your margin, so the price can cover it.", "asks_for": "cost", "reply": ""},
                known={"sell": "Cupcake boxes", "customer": "HR teams", "price": 30000}, asked="cost")
    assert r["reply"].startswith("Your cost per sale shows your margin") and r["reply"].endswith("So, " + (lambda l: l[:1].lower() + l[1:])(next(q["label"] for q in PRICING if q["key"] == "cost")))


@pytest.mark.parametrize("model, why", [(Model(slow=True), "timeout"), (Model(fail=RuntimeError("provider down")), "error:RuntimeError"),
                                        (Model(reply="not json at all"), None)])
def test_without_the_model_the_rules_carry_on_and_nothing_is_shown(model, why, caplog):
    if why is None:
        model.reply = None
        model.generate_text = lambda **_k: _plain("I can't do JSON today")      # noqa: E731
    r, _ = turn(CUPCAKE, None, llm=model)
    assert r["by"] == "rules" and r["fallback_used"] in (why, "unreadable_reply")
    assert r["values"] == {"price": 30000.0, "cost": 12000.0, "monthly_sales": 40.0, "customer": "HR teams in Abuja"} and r["currency"] == "NGN"
    assert r["next"] == "positioning" and "error" not in r["reply"].lower()


async def _plain(text):
    return SimpleNamespace(text=text, model="m", total_tokens=0)


def test_past_the_turn_cap_the_rules_answer_without_calling_the_model():
    llm = Model(CUPCAKE_REPLY)
    r, _ = turn(CUPCAKE, None, llm=llm, ai_turns=it.MAX_AI_TURNS)
    assert r["fallback_used"] == "turn_cap" and llm.prompts == [] and r["values"]["price"] == 30000


def test_figures_and_currencies_however_they_are_said():
    assert [it._number(v) for v in ("30k", "30,000", "thirty thousand", "£2.5k")] == [30000, 30000, 30000, 2500]
    assert [it.currency_of(v) for v in ("30000 naira", "₦30,000", "NGN 30000", "fifty quid", "£50", "$300", "300 dollars")] == ["NGN", "NGN", "NGN", "GBP", "GBP", "USD", "USD"]


# ── through the intake, as the homepage card sends it ────────────────────────────────────────────────────────────────
def test_the_cupcake_message_leaves_exactly_one_more_question_then_the_summary(monkeypatch):
    llm = Model(CUPCAKE_REPLY)
    from app.modules.agent import understanding
    monkeypatch.setattr(understanding, "_default_llm", lambda _ctx: llm)
    store = goals.SessionStore()
    llm.reply = {"intent": "answer", "extracted": [x("sell", "cupcake boxes", "cupcake boxes")], "marked_unknown": [], "answer_to_user_question": None,
                 "asks_for": "customer", "reply": ""}
    s = asyncio.run(goals.start(store, text="Help me price my cupcake boxes", key=None, entry_mode="free_text"))
    assert s["original_goal"] == "Help me price my cupcake boxes" and s["goal_key"] == "price_offer"
    llm.reply = CUPCAKE_REPLY
    s = asyncio.run(goals.add_inputs(store, s, {"customer": CUPCAKE}, message=CUPCAKE, asked="customer"))
    shown = goals.public(s)
    assert shown["missing"] == ["positioning"] and shown["progress"] == {"answered": 5, "total": 6}
    assert shown["agent_turn"]["reply"].endswith("affordable, mid-market or premium?") and shown["questions_avoided"] >= 3
    assert s["inputs"]["customer"] == "HR teams at companies in Abuja" and s["currency"] == "NGN"      # only its own part, never the whole message
    assert len(s["turn_records"]) == 4 and s["provenance"]["price"] == "user_said"
    llm.reply = {"intent": "answer", "extracted": [x("positioning", "premium", "premium")], "marked_unknown": [], "answer_to_user_question": None, "asks_for": None, "reply": ""}
    s = asyncio.run(goals.add_inputs(store, s, {"positioning": "premium"}))      # a chip: no typed text
    assert goals.public(s)["missing"] == [] and goals.public(s)["next"] == "identity"


def test_a_value_asked_back_is_kept_on_yes(monkeypatch):
    llm = Model({"intent": "answer", "extracted": [x("price", "30000", "30000", confidence=0.6, normalized=30000)], "marked_unknown": [],
                 "answer_to_user_question": None, "asks_for": "cost", "reply": ""})
    from app.modules.agent import understanding
    monkeypatch.setattr(understanding, "_default_llm", lambda _ctx: llm)
    store = goals.SessionStore()
    s = asyncio.run(goals.start(store, text="Help me price my product", key=None, entry_mode="free_text"))
    s = asyncio.run(goals.add_inputs(store, s, {"price": "30000"}, message="30000", asked="price"))
    assert "price" not in s["inputs"] and goals.public(s)["agent_turn"]["confirm"][0]["slot"] == "price"
    s = asyncio.run(goals.add_inputs(store, s, {"price": "yes"}, message="yes", asked="price"))
    assert s["inputs"]["price"] == 30000


def test_the_first_question_never_waits_on_a_slow_model(monkeypatch):
    """The first message gets FIRST_READ_SECONDS of the model; slow, the rules read it and nothing else waits for a model."""
    import time as _time
    from app.modules.agent import understanding
    monkeypatch.setattr(goals, "FIRST_READ_SECONDS", 0.2)
    slow = Model(slow=True)
    monkeypatch.setattr(understanding, "_default_llm", lambda _ctx: slow)
    began = _time.perf_counter()
    s = asyncio.run(goals.start(goals.SessionStore(), text="Help me price my cupcake boxes, I charge 30k naira a box", key=None, entry_mode="free_text"))
    assert _time.perf_counter() - began < 1.5 and s["first_question_ms"] < 1500
    assert s["goal_key"] == "price_offer" and len(slow.prompts) == 1      # one model call, cut short; no second one


def test_the_slim_reply_is_read_into_the_same_checks():
    slim = {"i": "answer", "x": [["customer", "HR teams in Abuja", "HR teams in Abuja", 0.95], ["price", 30000, "30000 naira", 0.95],
                                  ["cost", 12000, "costs me 12000", 0.9], ["monthly_sales", 40, "about 40 boxes a month", 0.9], ["sell", "a box", "invented words", 0.9]],
            "u": [], "a": None}
    r, _ = turn(CUPCAKE, slim)
    assert r["values"] == {"customer": "HR teams in Abuja", "price": 30000, "cost": 12000, "monthly_sales": 40} and r["currency"] == "NGN"
    assert r["reply"] == "HR teams in Abuja, got it: ₦30,000 a box, ₦12,000 to make, about 40 a month. How do you want to position it?"
