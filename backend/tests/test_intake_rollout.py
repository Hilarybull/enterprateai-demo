"""The AI intake on every goal: what the goal message itself says is read (funding, idea, pricing); a correction changes
the slot it refers to; a question to the Agent is answered and nothing is saved; the thread is what was said, once each;
progress counts filled slots; and the first result is there within 3 seconds of the last answer."""
import asyncio
import time

from app.modules.agent import goals, intake_turn
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401

FUNDING = "£25k for a second van and a driver, we're already trading, need it by March"


def go(text):
    store = goals.SessionStore()
    return store, asyncio.run(goals.start(store, text=text, key=None, entry_mode="free_text"))


def test_funding_is_read_from_the_goal_message_and_only_route_and_traction_are_asked():
    _store, s = go(FUNDING)
    shown = goals.public(s)
    assert s["goal_key"] == "need_funding"
    assert s["proposed"] == {"amount": 25000.0, "use": "second van and a driver", "stage": "trading", "timing": intake_turn.resolve_when("by March")}
    assert shown["missing"] == ["route", "traction"] and shown["currency"] == "GBP"
    assert intake_turn.resolve_when("by March", __import__("datetime").date(2026, 10, 14)) == "March 2027"


def test_an_idea_is_read_from_the_goal_text_and_the_first_question_is_the_customer():
    _store, s = go("Validate my idea: a mobile car wash in Abuja")
    assert s["goal_key"] == "test_idea" and s["proposed"] == {"description": "mobile car wash", "where": "Abuja"}
    assert goals._asking(s)["key"] == "customer" and goals.public(s)["turns"][-1]["next"] == "customer"
    assert goals.public(s)["acknowledged"] == "Mobile car wash in Abuja, nice."


def test_a_correction_changes_the_slot_it_refers_to_not_the_question_on_screen():
    store, s = go(FUNDING)
    s = asyncio.run(goals.add_inputs(store, s, {"route": "actually make it 40k"}, message="actually make it 40k", asked="route"))
    assert s["inputs"]["amount"] == 40000 and "route" not in s["inputs"]
    assert goals.public(s)["agent_turn"]["ack"] == "Updated: £40,000." and s["provenance"]["amount"] == "user_corrected"


def test_a_question_to_the_agent_is_answered_the_question_asked_again_and_nothing_saved():
    store, s = go("Help me price my cupcake boxes")
    s = asyncio.run(goals.add_inputs(store, s, {"customer": "why do you need to know who I sell to?"}, message="why do you need to know who I sell to?", asked="customer"))
    assert "customer" not in s["inputs"] and "customer" not in (s.get("proposed") or {})
    reply = goals.public(s)["turns"][-1]
    assert reply["content"].startswith("Who buys it shapes the price") and reply["content"].endswith("So, who are you selling it to?") and reply["next"] == "customer"


def test_the_thread_is_what_was_said_once_each_and_progress_counts_filled_slots():
    store, s = go("Help me price my cupcake boxes")
    msg = "HR teams in Abuja. I charge 30000 naira a box, it costs me 12000, about 40 boxes a month"
    s = asyncio.run(goals.add_inputs(store, s, {"customer": msg}, message=msg, asked="customer"))
    turns = goals.public(s)["turns"]
    assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]
    assert turns[2]["content"] == msg                                                # the owner's message exactly as typed, one bubble
    assert turns[3]["content"] == "HR teams in Abuja, got it: ₦30,000 a box, ₦12,000 to make, about 40 a month. How do you want to position it?"
    assert goals.public(s)["progress"] == {"answered": 5, "total": 6}                 # positioning still open: 5 of 6
    assert goals.public(s)["currency"] == "NGN" and goals.public(s)["agent_turn"]["next"] == "positioning"


def test_the_first_result_is_there_within_3_seconds_of_the_last_answer_and_no_model_reads_the_request_again(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    from app.modules.agent import extraction

    async def slow(*_a, **_k):
        await asyncio.sleep(10)
        return {"by": "model", "fields": {}}
    monkeypatch.setattr(extraction, "understand", slow)      # a second read would take 10 seconds: it must not happen
    s = client.post("/task-sessions", json={"key": "price_offer", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"sell": "Cupcake boxes", "customer": "Office managers", "price": 30, "cost": 12,
                                                                     "monthly_sales": 40, "positioning": "premium"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    began = time.perf_counter()
    first = client.get(f"/task-sessions/{s['id']}/first-value").json()
    shown_in = time.perf_counter() - began
    assert first["result"]["assessment_type"] == "pricing_health_initial" and shown_in < 3
    began = time.perf_counter()
    client.post(f"/task-sessions/{s['id']}/prepare")
    assert time.perf_counter() - began < 3
