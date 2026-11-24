"""The owner, 29 Oct: with several launch plans, the Sneaker shop's finished research read as "didn't finish"."""
from datetime import datetime, timezone

from app.modules.agent import research


def _runs():
    now = datetime.now(timezone.utc).isoformat()
    return {"research_runs": {
        "r1": {"id": "r1", "goal": "launch", "status": "review", "case_id": "sneakers", "created_at": now, "answers": {"description": "Sneaker shop"},
               "items": [{"kind": research.RESEARCHED, "sources": [{"url": "u"}], "topic": "t"}]},
        "r2": {"id": "r2", "goal": "launch", "status": "adopted", "case_id": "bakery", "created_at": now[:-6] + "+00:00", "answers": {}}},
        "quick_check_answers": {"launch": {"answers": {"description": "Bakery"}}}}


def test_a_plans_research_is_its_own_and_never_stale_from_another_plans_answers():
    got = research.research_state(_runs(), "launch", case_id="sneakers", answers={})
    assert got["state"] == "review" and got["run_id"] == "r1"
    assert research.research_state(_runs(), "launch", case_id="bakery", answers={})["run_id"] == "r2"


def test_a_plan_with_no_research_of_its_own_has_none():
    assert research.research_state(_runs(), "launch", case_id="other", answers={})["state"] == "none"
