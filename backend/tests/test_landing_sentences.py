"""The owner, 1 Nov: "why asking me what I already answered on the landing page", "it should handle properly across all flows from
the landing page". Every flow, a full sentence, no model: the right flow, and what it says outright is read, so it's not asked again."""
import pytest

from test_goal_onboarding import world  # noqa: F401

FLOWS = [
    ("need_funding", "I need funding: N5m for stock, a loan, within 3 months. The business is just an idea, no traction yet.",
     {"amount": 5000000.0, "use": "stock", "route": "loan", "timing": "Within 3 months", "traction": "No traction yet"}),
    ("need_funding", "I want a £20,000 grant for a new van by June 2027, we are already trading in Leeds",
     {"amount": 20000.0, "use": "new van", "route": "grant", "timing": "June 2027", "stage": "trading", "where": "Leeds"}),
    ("launch", "I want to launch a sock making service for students in Lagos at N2000 in 3 months",
     {"sell": "sock making service", "customer": "students", "where": "Lagos", "target_date": "in 3 months", "price": 2000.0}),
    ("test_idea", "I have an idea for a mobile dog grooming van for busy pet owners in Leeds, charging £40 per groom", {}),
    ("more_customers", "I need more customers for my bakery, office workers in Abuja, we use word of mouth, goal is 20 new customers",
     {"sell": "bakery", "where": "Abuja", "customer": "office workers", "channel": "word_of_mouth", "goal": "20"}),
    ("business_risks", "What are the risks in my business? I have £2000 in the bank and my costs are £1500 a month",
     {"cash_in_bank": 2000.0, "monthly_costs": 1500.0, "runway": "under_3"}),
    ("price_offer", "Help me price my logo design service, I charge £100, it costs me £45, for cafes",
     {"sell": "logo design service", "price": 100.0, "cost": 45.0, "customer": "cafes"}),
    ("create_business_plan", "Write a business plan for a designer scarf brand for investors", {}),
    ("create_invoice", "Create an invoice for Joe for 2 cakes at £50 each, due in 7 days",
     {"customer": "Joe", "item": "cakes", "quantity": 2, "amount": 50.0, "due_days": 7}),
    ("create_quotation", "Make a quotation for Laura for food at $200", {"customer": "Laura", "item": "food", "amount": 200.0}),
    ("prepare_proposal", "Prepare a proposal for Ada for website design at £900", {"customer": "Ada", "solution": "website design", "amount": 900.0}),
]


@pytest.mark.parametrize("goal,text,expected", FLOWS, ids=[f"{i}-{f[0]}" for i, f in enumerate(FLOWS)])
def test_a_landing_sentence_goes_to_its_flow_and_is_read(world, goal, text, expected):  # noqa: F811
    env, store, client, who = world
    who["user"] = None
    out = client.post("/task-sessions", json={"text": text, "entry_mode": "free_text"}).json()
    assert out.get("goal_key") == goal, (text, out.get("goal_key"), out.get("next"))
    read = {**(out.get("proposed") or {}), **(out.get("inputs") or {})}
    for key, value in expected.items():
        assert read.get(key) == value, (key, read)
    assert not set(expected) & set(out.get("missing") or []), (out.get("missing"), read)      # what was said is never asked as missing


def test_a_currency_written_on_the_landing_page_stays_with_it(world):  # noqa: F811
    env, store, client, who = world
    who["user"] = None
    out = client.post("/task-sessions", json={"text": "Make a quotation for Laura for food at $200", "entry_mode": "free_text"}).json()
    assert (out.get("said_currency") or out.get("currency")) == "USD", {k: out.get(k) for k in ("said_currency", "currency")}
    out = client.post("/task-sessions", json={"text": "I need funding: N5m for stock, a loan, within 3 months", "entry_mode": "free_text"}).json()
    from app.modules.agent import intake_turn
    assert intake_turn.currency_of("I need funding: N5m for stock") == "NGN" and intake_turn.currency_of("Plan B for 5 stores") is None
