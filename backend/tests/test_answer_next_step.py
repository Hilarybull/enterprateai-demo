"""QA, 15 Oct: "What services do I have?" with "AI Automation Service" on the profile but nothing in the catalogue: the
answer ends with the next step, "Do you want me to add AI Automation Service to your catalogue, or create a new service?",
with a button for each. Only when the answer is about what the business sells, and only for what is not listed yet."""
from app.modules.agent.router import catalogue_gaps, next_step

PROFILE = {"workspace_profile": {"key_offering_focus": "AI Automation Service", "services": [{"service_name": "AI Automation Service"}, {"service_name": "Chatbot setup"}]},
           "catalogue": {"products": [{"name": "Chatbot setup", "base_price": 500}]}}


def test_the_offering_not_in_the_catalogue_is_proposed_with_its_buttons():
    out = next_step("What services do I have?", "You have no products listed.", PROFILE, "B1")
    assert out["ask"] == "Do you want me to add AI Automation Service to your catalogue, or create a new service?"
    assert [o["label"] for o in out["offers"]] == ["Add AI Automation Service to my catalogue", "Create a new service"]
    assert out["offers"][0]["post"] == {"url": "/businesses/B1/catalogue/from-check", "body": {"name": "AI Automation Service"}}
    assert out["offers"][1]["capability"] == "add_catalogue_item"


def test_nothing_is_proposed_off_topic_or_when_everything_is_listed():
    assert next_step("How is my cash this month?", "Your cash is fine.", PROFILE, "B1") is None
    listed = {**PROFILE, "catalogue": {"products": [{"name": "ai automation service"}, {"name": "Chatbot setup"}]}}
    assert catalogue_gaps(listed) == [] and next_step("What services do I have?", "Two.", listed, "B1") is None
