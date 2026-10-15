"""Every answer is read against all the slots still missing, for every goal (as the goal text is), and a question to the
Agent is answered and the same question asked again, with nothing saved. Rules only (no model): what the owner gets when
the model is down, and what the model's reading is checked against."""
import asyncio

import pytest

from app.modules.agent import goals
from app.modules.agent.intake_turn import resolve_when

RICH = [
    ("need_funding", "amount", "£25k for a second van and a driver, we are already trading, need it by March",
     {"amount": 25000.0, "use": "second van and a driver", "stage": "trading", "timing": resolve_when("by March")}, "route",
     f"Got it: £25,000 for a second van and a driver, trading, by {resolve_when('by March')}. What funding route are you considering?"),
    ("test_idea", "description", "A mobile car wash in Abuja for busy office workers, I'd charge £25 a wash and could do 60 a month",
     {"description": "mobile car wash", "where": "Abuja", "customer": "busy office workers", "price": 25.0, "monthly_sales": 60.0}, "cost", None),
    ("launch", "kind", "A dog walking service in Leeds next month, for busy professionals",
     {"kind": "service", "sell": "dog walking service", "where": "Leeds", "customer": "busy professionals", "target_date": "next month"}, "stage", None),
    ("more_customers", "sell", "a bakery in Manchester, selling to local offices through Instagram",
     {"sell": "bakery", "where": "Manchester", "customer": "local offices", "channel": "Instagram"}, "price", None),
    ("create_quotation", "customer", "ABC Ltd, 20 chairs at £45 each", {"customer": "ABC Ltd", "quantity": 20.0, "item": "chairs", "amount": 45.0}, "customer_email", None),
    ("create_invoice", "customer", "Mark, $300 for catering", {"customer": "Mark", "amount": 300.0, "item": "catering"}, "customer_email", None),
    ("price_offer", "sell", "Cupcake boxes for HR teams, I charge £30 a box and it costs me £12",
     {"sell": "Cupcake boxes", "customer": "HR teams", "price": 30.0, "cost": 12.0}, "monthly_sales", None),
]


def started(goal):
    store = goals.SessionStore()
    return store, asyncio.run(goals.start(store, text=None, key=goal, entry_mode="business_goal"))


@pytest.mark.parametrize("goal, asked, message, want, after, reply", RICH, ids=[r[0] for r in RICH])
def test_a_rich_answer_fills_every_slot_it_gives(goal, asked, message, want, after, reply):
    store, s = started(goal)
    s = asyncio.run(goals.add_inputs(store, s, {asked: message}, message=message, asked=asked))
    assert {k: s["inputs"].get(k) for k in want} == want
    last = goals.public(s)["turns"][-1]
    assert last["next"] == after
    if reply:
        assert last["content"] == reply
    if goal == "create_invoice":
        assert s["currency"] == "USD"


# (Worked out inside the test, never at import: asyncio.run at collection would leave the main thread with no event loop.)
QUESTION_GOALS = ("need_funding", "test_idea", "launch", "more_customers", "price_offer", "create_quotation", "create_invoice")


@pytest.mark.parametrize("goal", QUESTION_GOALS)
def test_a_question_to_the_agent_is_answered_and_the_same_question_asked_again(goal):
    store, s = started(goal)
    asked = goals._asking(s)["key"]
    s = asyncio.run(goals.add_inputs(store, s, {asked: "why do you need to know that?"}, message="why do you need to know that?", asked=asked))
    assert asked not in s["inputs"] and not s["inputs"]
    last = goals.public(s)["turns"][-1]
    label = next(q["label"] for q in goals.public(s)["questions"] if q["key"] == asked)
    assert last["next"] == asked and last["content"].endswith(f"So, {label[:1].lower()}{label[1:]}")
    assert goals._asking(s)["key"] == asked      # the pending question is never marked answered or skipped


def test_the_launch_answer_is_said_back_naturally():
    store, s = started("launch")
    m = "A dog walking service in Leeds next month, for busy professionals"
    s = asyncio.run(goals.add_inputs(store, s, {"kind": m}, message=m, asked="kind"))
    assert goals.public(s)["turns"][-1]["content"].startswith("Dog walking service in Leeds for busy professionals, got it: a service, next month.")
