"""Asked on the dashboard's check who the customer is, the owner is never asked again by the plan draft (or the idea
check, the market size, the sales letter) for the same offering. An answer given about another offering is not used."""
from datetime import datetime, timezone

from app.modules.agent import answer_memory, workflows

NOW = datetime(2026, 10, 14, 17, 0, tzinfo=timezone.utc)


def _told(sell="Bookkeeping for small firms", customer="Sole traders in Leeds", where="Leeds"):
    data = {"workspace_profile": {}}
    answer_memory.remember(data, "launch", {"sell": sell, "customer": customer, "where": where}, NOW)
    return data


def test_the_dashboard_answers_are_used_and_not_asked_again():
    idea = workflows.idea_of(_told())
    assert (idea["description"], idea["customer"], idea["location"]) == ("Bookkeeping for small firms", "Sole traders in Leeds", "Leeds")
    assert not idea["customer_guessed"] and not idea["description_guessed"]
    assert workflows._ask_idea(idea, ("description", "customer")) is None


def test_the_same_offering_on_the_profile_carries_the_customer():
    data = _told(sell="bookkeeping")
    data["workspace_profile"]["description"] = "Bookkeeping and payroll for small firms"
    assert workflows.idea_of(data)["customer"] == "Sole traders in Leeds"


def test_an_answer_about_another_offering_is_never_used():
    data = _told(sell="Mobile dog grooming van", customer="Busy pet owners")
    data["workspace_profile"]["description"] = "Domestic cleaning for homes in Leeds"
    idea = workflows.idea_of(data)
    assert idea["customer"] != "Busy pet owners"
    assert workflows._ask_idea(idea, ("description", "customer")).fields[0]["key"] == "customer"
