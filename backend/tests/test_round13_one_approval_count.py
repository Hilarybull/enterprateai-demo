"""The owner, 26 Oct: the Agent card said "2 approvals waiting" while Needs Approval showed 4, and the Agent Centre 2: a draft
waiting for review counts in each."""
from datetime import datetime, timezone

from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import drafts


def test_a_waiting_draft_counts_on_the_card_and_in_the_agent_centre(world):
    env, store, client, who = world
    who["user"] = OWNER
    drafts.add(env.businesses["A"]["data"], kind="business_plan", title="Palm oil", to="/blueprint", run_id="r1", ref="doc-1", now=datetime.now(timezone.utc))
    brief = client.get("/businesses/A/agent/briefing").json()
    summary = client.get("/businesses/A/agent/summary").json()
    assert brief["needs_approval_count"] == summary["needs_approval_count"] >= 1
