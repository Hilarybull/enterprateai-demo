"""The funding pack is included from Decision Engine (the owner, 16 Oct); the funding check and its research stay on Starter."""
from app.modules.agent import config as agent_config, research
from test_agent import Env
from test_readiness import _pre, _suggestion, funding_case


def test_the_pack_is_decision_engine_and_above_only():
    assert agent_config.CAPABILITY_MIN_PLAN["funding_pack_draft"] == "decision_engine"
    assert [p for p in agent_config.PLAN_ORDER if agent_config.plan_allows(p, "funding_pack_draft")] == ["decision_engine", "growth_navigator", "strategic_business_os"]


def test_funding_research_is_not_locked_with_the_pack():
    assert agent_config.plan_allows("starter_insight", research.CAPABILITY["need_funding"])


def test_on_starter_the_agent_refuses_and_the_tile_says_which_plan():
    env = Env(plan="starter_insight")
    out = env.submit(capability="funding_pack_draft", channel="ui_action")
    assert "run" not in out or out["run"].get("status") != "succeeded"
    funding_case(env)
    tile = _suggestion(_pre(env), "stage_funding")
    assert tile["text"] == "The funding pack is included on the Decision Engine plan and above." and tile["action"] == {"to": "/pricing"}
