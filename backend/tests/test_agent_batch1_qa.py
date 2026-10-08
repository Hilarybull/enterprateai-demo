"""Agent batch 1, local QA: splitting a message into tasks, money with its currency, and
when the Agent offers to remember something."""
import re

import pytest

from app.modules.agent import intent, memory
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run

KNOWN = list(WORKFLOWS)


def _trading(env, currency="GBP"):
    def paid(n, who, amount):
        at = env.now.isoformat()
        return {"id": f"i{n}", "reference": f"INV-{n}", "customer_name": who, "total_amount": amount, "status": "paid", "paid_at": at,
                "created_at": at, "issued_at": env.now.date().isoformat(),
                "payments": [{"id": f"p{n}", "amount": amount, "paid_at": at, "receipt": {"number": f"REC-{n}", "sent_at": at}}]}
    env.businesses["A"]["data"]["settings"] = {"currency": currency}
    env.fin["invoices"] = [paid(1, "Frank", 410), paid(2, "Nova Labs", 288)]
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))


# ══ A-1 ═══════════════════════════════════════════════════════════════════════

def test_check_my_risk_and_then_run_a_what_if_is_two_tasks_in_one_reply():
    env = Env()
    _trading(env)
    res = env.submit(text="Check my concentration risk and then run a what-if on losing Frank")
    assert res["kind"] == "multi" and [r["capability"] for r in res["results"]] == ["risk_concentration", "scenario_help"]
    risk, what_if = (r["run"] for r in res["results"])
    assert risk["status"] == what_if["status"] == "succeeded" and len(run(env.store.list_runs("A"))) == 2
    assert "Frank is 58.7% of your revenue" in risk["summary"] and what_if["summary"].startswith("If you lost Frank (58.7% of all your revenue")
    # The same from the Agent box, which sends typed text the same way.
    box = Env()
    _trading(box)
    assert box.submit(text="Check my concentration risk and then run a what-if on losing Frank", channel="ui_action")["kind"] == "multi"


@pytest.mark.parametrize("message, parts", [
    ("Check my concentration risk and then run a what-if on losing Frank", 2),
    ("Check my concentration risk, then run a what-if on losing Frank", 2),
    ("Check my concentration risk then run a what-if on losing Frank", 2),
    ("Check my concentration risk. After that, run a what-if on losing Frank", 2),
    ("Send the receipt for INV-2, also chase the overdue invoice", 2),
    ("1. Send the receipt for INV-2 2. Chase the overdue invoice 3. Check my concentration risk", 3),
    ("1) Send the receipt for INV-2\n2) Chase the overdue invoice", 2),
])
def test_the_ways_of_asking_for_several_things(message, parts):
    assert len(intent.split_requests(message, KNOWN)) == parts


@pytest.mark.parametrize("message", [
    "Prepare a quotation for Nova Labs and also thank them for their patience",      # one part isn't a task
    "Remind BrightTech and then chase Nova Labs",                                     # the same task twice
    "Prepare a quotation for 2 x Strategy Workshop for BrightTech Ltd",               # a number is not a list
    "If I lose Frank then what happens?",                                             # "then" inside one question
    "What is my biggest risk?",
])
def test_messages_that_stay_one_request(message):
    assert intent.split_requests(message, KNOWN) == []


def test_a_what_if_is_recognised_however_it_is_written():
    for text in ("run a what-if on losing Frank", "what if I lose Frank", "run a what if for losing my biggest client", "simulate losing Frank"):
        assert intent.rule_capability(text, KNOWN) == "scenario_help", text


# ══ A-3 ═══════════════════════════════════════════════════════════════════════

def test_amounts_in_agent_replies_carry_the_business_currency():
    env = Env()
    _trading(env)
    said = env.submit(text="what if I lose Frank")["run"]["summary"]
    assert "from £232.67 to £96.00" in said and "you would clear £96.00 a month" in said
    assert not re.search(r"(?<![£\d,.])\d[\d,]*\.\d\d(?!%)", said), said      # no bare amount anywhere in the reply
    risk = env.submit(capability="risk_concentration", channel="ui_action")["run"]["summary"]
    assert "to £96.00, and you would clear £96.00 a month" in risk
    # Another currency is shown as that currency, not as pounds.
    usd = Env()
    _trading(usd, "USD")
    assert "from $232.67 to $96.00" in usd.submit(text="what if I lose Frank")["run"]["summary"]
    cost = Env()
    _trading(cost)
    cost.fin["expenses"] = [{"id": "e1", "vendor_name": "Rent", "price": 300, "status": "paid", "date": cost.now.date().isoformat()}]
    up = cost.submit(text="What happens if my costs rise by 10%?")["run"]["summary"]
    assert "£" in up and not re.search(r"(?<![£\d,.])\d[\d,]*\.\d\d(?!%)", up), up


# ══ A-4 ═══════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("text, fact", [
    ("Remember that we close at 5pm.", "we close at 5pm"),
    ("please remember this: invoices go out on Fridays", "invoices go out on Fridays"),
    ("Always quote in pounds, never in dollars", "Always quote in pounds, never in dollars"),
    ("From now on, payment terms are 14 days", "From now on, payment terms are 14 days"),
])
def test_only_these_offer_to_save_a_fact(text, fact):
    assert memory.fact_in(text) == fact
    asked = Env().submit(text=text)
    assert asked["kind"] == "remember" and asked["fact"] == fact


@pytest.mark.parametrize("text", [
    "Note for this chat: I'm only asking about October",
    "Keep in mind I'm in a hurry",
    "Make a note of the invoice total please",
    "Note that this is a test",
    "I always forget what my margin is",
    "What do you remember about my business?",
])
def test_everything_else_is_part_of_the_conversation_not_a_request_to_save(text):
    assert memory.fact_in(text) is None
    assert Env().submit(text=text).get("kind") != "remember"
