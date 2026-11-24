"""P2.18: background work that spent credits is said: the briefing counts what the Agent spent by itself while the owner
was away, and the task shows its cost in Recently Completed."""
from datetime import datetime, timezone

from app.modules.agent import router as agent_router
from app.modules.agent.summary import briefing_of


def test_what_the_agent_spent_by_itself_is_counted_and_shown():
    run = {"id": "r1", "workflow_key": "readiness_refresh", "status": "succeeded", "source_channel": "business_event",
           "completed_at": "2026-10-15T08:00:00+00:00", "created_at": "2026-10-15T07:59:00+00:00", "state": {"credits": [{"credits": 2}]}}
    asked = {**run, "id": "r2", "source_channel": "ui_action", "created_at": "2026-10-15T06:00:00+00:00"}
    b = briefing_of([run, asked], since="2026-10-15T07:00:00+00:00", needs_approval=0, now=datetime(2026, 10, 15, 9, tzinfo=timezone.utc))
    assert b["spent_while_away"] == 2
    assert agent_router._public_run(run)["credits_used"] == 2 and "credits_used" not in agent_router._public_run(asked)
