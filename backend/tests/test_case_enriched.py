"""The funding case is filled from what the owner already said (the owner's QA, 17 Oct): the funding chat, the research
(adopted or not yet), and the workspace profile. Blank fields only, each once; nothing estimated beyond the research."""
from datetime import date

from app.modules.agent import research
from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService

TODAY = date(2026, 10, 17)
DATA = {
    "workspace_profile": {"city": "Lagos", "country": "Nigeria", "target_customer_type": "SMEs"},
    "quick_check_answers": {"need_funding": {"answers": {"amount": 250000, "use": "a second van", "route": "unknown", "traction": "12 paying clients",
                                                         "where": "Lekki, Lagos"}}},
    "research_runs": {"rr_1": {"goal": "need_funding", "status": "review", "created_at": "2026-10-16T10:00:00", "answers": {},
                               "inputs": {"price": 400.0, "cost": 150.0, "fixed_costs": 5000.0, "monthly_sales": 20.0, "amount": 250000.0},
                               "items": [{"id": "c1", "derive": "use_of_funds", "basis": "calculated", "decision": None,
                                          "table": [{"line": "First month's delivery costs", "amount": 3000, "how": "x"},
                                                    {"line": "Working capital: three months of fixed costs", "amount": 15000, "how": "y"},
                                                    {"line": "Not yet allocated: say what it is for", "amount": 232000, "how": "z"}]}]}},
}


def test_the_case_is_filled_from_the_chat_the_research_and_the_profile():
    values, prov = ReadinessService.already_said(rules.FUNDING, DATA, TODAY)
    assert values["target_amount"] == "250000" and values["purpose"] == "a second van" and values["route_preference"] == "unsure"
    assert values["traction.summary"] == "12 paying clients" and values["market.location"] == "Lekki, Lagos"
    assert values["market.target_segment"] == "SMEs" and prov["market.target_segment"]["source"] == "your workspace profile"
    assert (values["economics.price"], values["economics.direct_cost"], values["economics.fixed_costs_monthly"]) == ("400.0", "150.0", "5000.0")
    assert prov["economics.price"]["source"] == "your research (not adopted yet)" and prov["economics.price"]["as_of"] == "2026-10-17"
    assert [x["category"] for x in values["use_of_funds"]] == ["Operations", "Operations"]      # the unallocated line is never invented


def test_only_blank_fields_each_once():
    svc = ReadinessService.__new__(ReadinessService)
    row = {"data": {"purpose": "my own words", "filled_from_records": ["market.location"], "cleared_by_owner": ["market.location"]}}
    out = svc._fill_blanks(rules.FUNDING, row, DATA, TODAY)
    assert out["purpose"] == "my own words"                 # the owner's own answer stays
    assert "location" not in (out.get("market") or {})      # cleared by the owner after it was filled once: stays clear
    # Filled once and blank again without the owner clearing it (the Agent's own clean-up): filled again (the owner's QA, 21 Oct)
    # Fills wait as drafts for the owner's approval, never written for them (the owner, 28 Oct)
    again = svc._fill_blanks(rules.FUNDING, {"data": {"filled_from_records": ["market.location"]}}, DATA, TODAY)
    assert again["agent_drafts"]["market.location"]["value"] == "Lekki, Lagos"
    assert out["agent_drafts"]["target_amount"]["value"] == "250000" and "target_amount" not in out


def test_a_preview_updates_calculations_with_an_edit_and_an_edited_calculation_is_the_owners():
    run = {"inputs": {"price": 400.0, "cost": 150.0, "fixed_costs": 5000.0, "monthly_sales": 20.0}, "inputs_from": {}, "context": {"currency": "GBP"},
           "items": [{"id": "u1", "kind": "reused", "field": "cost", "value": "150", "label": "Cost per sale"},
                     {"id": "c1", "kind": "estimated", "basis": "calculated", "derive": "margin", "criterion": "economics", "label": "Margin", "decision": None}]}
    before = research.preview(run, {"u1": {"decision": "accept"}, "c1": {"decision": "accept"}})[0]["value"]
    after = research.preview(run, {"u1": {"decision": "edit", "value": "300"}, "c1": {"decision": "accept"}})[0]["value"]
    assert before != after
    mine = research.preview(run, {"u1": {"decision": "accept"}, "c1": {"decision": "edit", "value": "60%"}})[0]
    assert mine["value"] == "60%" and mine["decision"] == "edited" and mine["calculated_value"] == before


def test_the_purpose_is_linked_only_to_a_milestone_the_case_holds():
    """The owner, 28 Oct: the funding goal stayed To do, its purpose linked to a milestone that was only a draft."""
    svc = ReadinessService.__new__(ReadinessService)
    out = svc._fill_blanks(rules.FUNDING, {"data": {"purpose": "Working capital", "purpose_milestone_id": "gone"}}, DATA, TODAY)
    assert (out or {}).get("purpose_milestone_id") in (None, "gone")      # never linked to a draft's milestone
    held = {"purpose": "Working capital", "purpose_milestone_id": "gone", "milestones": [{"id": "m1", "outcome": "10 paying customers", "measure": "Paying customers", "target": "10"}]}
    again = svc._fill_blanks(rules.FUNDING, {"data": held}, DATA, TODAY)
    assert again["purpose_milestone_id"] == "m1"      # pointing at nothing: linked to the milestone the case has


def test_a_draft_with_an_invented_figure_gives_way_to_a_new_suggestion():
    svc = ReadinessService.__new__(ReadinessService)
    bad = {"value": [{"id": "x", "outcome": "Achieve monthly revenue of ₦1,200,000 based on 40 sales", "measure": "Revenue", "target": "₦1,200,000"}], "source": "suggested by the Agent"}
    out = svc._fill_blanks(rules.FUNDING, {"data": {"purpose": "a van", "agent_drafts": {"milestones": bad}}}, DATA, TODAY)
    assert "₦1,200,000" not in str((out.get("agent_drafts") or {}).get("milestones"))
