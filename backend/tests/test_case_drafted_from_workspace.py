"""The case's fields are filled from the workspace and drafted by the paid run (the owner's QA, 20 Oct: "use AI, fetch
from the workspace data, just fill the fields accurately"): only from what the workspace and research hold, never made up."""
import asyncio
from datetime import date
from types import SimpleNamespace

from app.modules.agent import research
from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService

DATA = {"workspace_profile": {"company_name": "E2E Car Wash Abuja", "city": "Abuja", "country": "Nigeria", "currency": "NGN",
                              "target_customer": "Busy professionals and ride-hailing drivers in Abuja", "usp": "Waterless wash at your door in 30 minutes",
                              "marketing_channels": ["Instagram", "WhatsApp groups"]}}


class Model:
    def __init__(self, text):
        self.text, self.prompts = text, []

    async def generate_text(self, system, prompt, feature, max_tokens):
        self.prompts.append(prompt)
        return SimpleNamespace(text=self.text)


def test_the_profile_fills_the_market_fields_for_free():
    values, prov = ReadinessService.already_said(rules.FUNDING, DATA, date(2026, 10, 20))
    assert values["market.target_segment"].startswith("Busy professionals")
    assert values["market.location"] == "Abuja, Nigeria"
    assert values["market.differentiation"] == "Waterless wash at your door in 30 minutes"
    assert values["market.acquisition_approach"] == "Instagram, WhatsApp groups"
    assert prov["market.differentiation"]["source"] == "your workspace profile"


def test_the_run_drafts_from_the_workspace_facts_and_keeps_only_its_fields():
    model = Model('{"fields": {"market.acquisition_owner": "The founder", "market.acquisition_cost": "About ₦50,000 a month on Instagram ads",'
                  ' "traction.summary": null, "made.up": "x"}}')
    out = asyncio.run(research.draft_case_fields(model, "need_funding", research.workspace_facts(DATA, {"amount": 5000000}, {}, [])))
    # A cost not on record is never drafted: it is asked (the owner, 28 Oct: "Drafts must not invent figures")
    assert out == {"market.acquisition_owner": "The founder"}
    assert "Waterless wash" in model.prompts[0]      # the facts it drafted from are the workspace's own


def test_the_drafts_reach_the_case_only_where_it_is_blank():
    run = {"id": "rr_1", "goal": "need_funding", "status": "review", "created_at": "2026-10-20T10:00:00+00:00", "items": [],
           "case_drafts": {"market.acquisition_owner": "The founder", "market.differentiation": "Something else"}}
    values, prov = ReadinessService.already_said(rules.FUNDING, {**DATA, "research_runs": {"rr_1": run}}, date(2026, 10, 20))
    assert values["market.acquisition_owner"] == "The founder" and "Agent's draft" in prov["market.acquisition_owner"]["source"]
    assert values["market.differentiation"] == "Waterless wash at your door in 30 minutes"      # the profile's own words first


def test_no_model_no_drafts():
    assert asyncio.run(research.draft_case_fields(None, "need_funding", {})) == {}
