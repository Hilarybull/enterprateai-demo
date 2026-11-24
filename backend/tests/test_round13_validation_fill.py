"""The owner, 26 Oct: "many things are empty here", "description is not even making sense": the Agent fills every empty
question on the Idea Validation form in one call, as the form allows; a name alone is never the description; the owner's
answers are never replaced; a separate idea is placed where the owner is, in their currency."""
import asyncio
import json

from app.modules.agent import validation_fill
from app.modules.agent.services import validation_payload


class _Llm:
    def __init__(self, answer):
        self.answer, self.prompts = answer, []

    async def generate_text(self, **kw):
        self.prompts.append(kw["prompt"])
        return type("R", (), {"text": json.dumps(self.answer)})()


ANSWER = {"step1": {"idea_tagline": "Bush clearing for landowners and farms around Abuja.",
                    "idea_description": "Clearing overgrown land for landowners, farms and developers around Abuja, by the job.",
                    "idea_type": "local service", "customer_model": "B2C and more"},
          "step2": {"pain_severity": "Moderate", "urgency": "whenever"},
          "step3": {"channels": ["Referrals", "Social media", "Billboards"], "economic_buyer": "The landowner"},
          "step5": {"solution_description": "A crew with brush cutters clears the land and removes the waste.", "delivery_method": "In-person service"},
          "step12": {"regulatory_risk_level": "low"}}


def test_every_empty_question_is_filled_as_the_form_allows():
    idea = {"name": "Bush Clearing", "description": "Bush Clearing", "customer": "Landowners", "problem": "Overgrown land",
            "location": "Abuja, Nigeria", "country": "Nigeria", "currency": "NGN"}
    form = {k: v for k, v in validation_payload(idea, None).items() if k.startswith("step") and isinstance(v, dict)}
    for s, f in (("step1", "idea_tagline"), ("step1", "idea_description"), ("step5", "solution_description")):
        form[s].pop(f, None)
    llm = _Llm(ANSWER)
    filled, took = asyncio.run(validation_fill.fill(llm, form, {"description": "Bush Clearing", "location": "Abuja, Nigeria"}))
    assert filled["step1"]["idea_type"] == "Local service"                    # the form's own option, whatever the case
    assert "customer_model" not in filled["step1"]                             # not one of its options: left for the owner
    assert filled["step2"]["pain_severity"] == "moderate" and "urgency" not in filled["step2"]
    assert filled["step3"]["channels"] == ["Referrals", "Social media"]        # only the form's choices
    assert filled["step3"]["primary_segment"] == "Landowners"                   # the owner's answer, never replaced
    assert "step1.idea_description" in took and "step3.primary_segment" not in took
    asked = json.loads(llm.prompts[0].split("FIELDS TO FILL:\n", 1)[1])
    assert "has_paying_customers" not in json.dumps(asked) and "founder_capital_available" not in json.dumps(asked)      # only the owner knows


def test_a_name_alone_is_never_the_description_once_the_agent_has_written_one():
    idea = {"name": "Bush Clearing", "description": "Bush Clearing", "customer": "Landowners", "problem": "Overgrown land", "country": "Nigeria",
            "location": "Abuja, Nigeria", "currency": "NGN",
            "form_fill": {"step1": {"idea_description": "Clearing overgrown land around Abuja, by the job.", "idea_tagline": "Bush clearing around Abuja."},
                          "step5": {"solution_description": "A crew clears the land."}}}
    p = validation_payload(idea, None)
    assert p["step1"]["idea_name"] == "Bush Clearing" and p["step1"]["idea_description"].startswith("Clearing overgrown land")
    assert p["step1"]["idea_tagline"] == "Bush clearing around Abuja." and p["step5"]["solution_description"] == "A crew clears the land."
    assert p["step2"]["proposed_solution"] == "A crew clears the land."
    assert p["step1"]["operating_country"] == "Nigeria" and p["currency"] == "NGN"


def test_without_a_model_the_form_is_as_it_was():
    form = {"step1": {"idea_name": "Bush Clearing"}}
    assert asyncio.run(validation_fill.fill(None, form, {})) == (form, [])
