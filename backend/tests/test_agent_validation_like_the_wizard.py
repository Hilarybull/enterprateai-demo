"""The Agent's idea validation sends the Idea Validation wizard's own steps, filled from what the workspace holds, so its
score comes from the same information as one made by hand (it sent only the first two steps)."""
from app.modules.agent.services import validation_payload
from app.modules.agent.workflows import known_for_validation


def test_the_wizard_steps_are_filled_from_the_workspace():
    data = {"workspace_profile": {"operating_stage": "pre_revenue", "competitors": "Local bookkeepers", "channels": "Referrals"},
            "catalogue": {"products": [{"name": "Monthly bookkeeping", "base_price": 300, "cost_of_sales": 120}]},
            "shared_answers": {"fixed_costs": {"value": 450, "offering": "Monthly bookkeeping", "goal": "launch", "at": "2026-10-01"}}}
    known = known_for_validation(data, {"sell": "Monthly bookkeeping"})
    idea = {"name": "Apex", "description": "Bookkeeping for cafés", "industry": "Accounting", "location": "Leeds, United Kingdom",
            "customer": "Independent cafés", "problem": "Month-end takes a week", "currency": "GBP", "known": known}
    p = validation_payload(idea, "A")
    assert p["validation_mode"] == "basic" and p["workspace_id"] == "A"
    assert p["step1"]["business_stage"] == "pre_revenue" and p["step3"] == {"primary_segment": "Independent cafés", "channels": "Referrals"}
    assert p["step4"] == {"direct_competitors": "Local bookkeepers"} and p["step5"]["solution_description"] == "Bookkeeping for cafés"
    assert p["step7"]["proposed_price"] == "300" and p["step8"]["variable_cost_per_unit"] == "120"
    assert p["steps_completed"] == sorted(int(k[4:]) for k in p if k.startswith("step") and k != "steps_completed")


def test_nothing_is_guessed_for_what_is_not_on_record():
    p = validation_payload({"name": "Apex", "description": "Bookkeeping", "customer": "Cafés", "problem": "Slow month-end", "known": {}}, "A")
    assert "step7" not in p and "step8" not in p and "step9" not in p and "step4" not in p
