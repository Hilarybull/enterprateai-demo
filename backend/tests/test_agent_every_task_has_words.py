"""Every task the Agent can do can be asked for in words. From the browser: "write a business plan"
was answered "Writing business plans isn't available as an Agent action yet", although the Agent
has a Business Plan Draft task: it had only ever been started from a dashboard button."""
import pytest

from app.modules.agent import intent
from app.modules.agent.workflows import WORKFLOWS
from test_agent import Env


def test_no_task_is_reachable_only_by_a_button():
    assert sorted(set(WORKFLOWS) - {key for key, _pattern in intent._GOAL_RULES}) == []


@pytest.mark.parametrize("said, task", [
    ("write a business plan", "business_plan_draft"), ("help me create my business plan", "business_plan_draft"), ("draft a business plan for a bakery", "business_plan_draft"),
    ("validate my business idea", "idea_validation"), ("test my idea", "idea_validation"), ("score this startup idea", "idea_validation"),
    ("size my market", "market_size"), ("work out the market size", "market_size"),
    ("prepare a funding pack", "funding_pack_draft"), ("make me a pitch deck", "funding_pack_draft"),
    ("check what's missing before my launch", "launch_evidence_gaps"), ("am I ready to launch", "launch_evidence_gaps"),
    ("refresh my readiness", "readiness_refresh"), ("run a readiness check", "readiness_refresh"),
    ("register my company", "registration_checklist"), ("help me incorporate", "registration_checklist"),
    ("help me price my service", "price_test"), ("help me work out what to charge", "price_test"), ("I want to raise my prices", "price_test"),
    ("check my capacity", "capacity_check"), ("check if we can take on more", "capacity_check"),
    ("review what sells", "offer_review"), ("review my services", "offer_review"),
    ("help me grow my business", "expansion_scenario"), ("I want to open a second site", "expansion_scenario"),
    # (A plain question, "how big is my market?", is still answered by the Assistant, not turned into a task.)
    # The documents keep their own words: a plan, an idea or a price is not mistaken for one of them.
    ("invoice Mark for a business plan review £300", "new_invoice"), ("quote Frank for pricing advice", "enquiry_to_quote"), ("write a proposal for Acme", "new_proposal"),
])
def test_asking_in_words_reaches_the_task(said, task):
    assert intent.rule_capability(said, list(WORKFLOWS)) == task, said


def test_write_a_business_plan_starts_the_task_and_is_never_called_unavailable():
    env = Env()
    for said in ("write a business plan", "validate my business idea", "help me work out what to charge"):
        out = env.submit(text=said)
        assert "isn't available as an Agent action" not in str(out.get("message") or ""), said
        assert out.get("run") or out.get("kind") in ("needs_input", "workflow"), (said, out.get("kind"), out.get("message"))
    plan = env.submit(text="write a business plan")
    assert plan["run"]["workflow_key"] == "business_plan_draft"
    # Something the Agent really does not do yet is still said plainly.
    tender = env.submit(text="respond to this tender for me")
    assert not tender.get("run") or tender["run"]["workflow_key"] != "business_plan_draft"
