"""QA R5: "Customer enquiry from jo@test.example: …" never proposes "enquiry from" as the customer's name.
With only an email address, the name is asked with nothing filled in."""
from datetime import date

from app.modules.agent import said
from test_agent_ask_then_deliver import _env, _fields

TEXT = "Customer enquiry from jo@test.example: Hi, we need a quote for 2 home cleans next week."


def test_stop_phrases_are_not_names():
    for text in (TEXT, "Request for a quote from jo@test.example", "Enquiry from jo@test.example about a deep clean"):
        assert "party" not in said.read(text, date(2026, 10, 11)), text
    assert said.read("new customer called Brightway Ltd", date(2026, 10, 11))["party"] == "Brightway Ltd"      # a real name still is one


def test_the_quote_asks_the_name_with_nothing_filled_in_and_keeps_the_email():
    env = _env()
    f = _fields(env.submit(text=TEXT)["run"])
    name = f.get("customer_name")
    assert name is not None and not name.get("default") and "enquiry" not in str(name.get("default") or "").lower()
    assert f["customer_email"]["default"] == "jo@test.example"
