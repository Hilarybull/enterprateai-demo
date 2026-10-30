"""Every launch plan is its own case: its research is never reused, waited on or replaced by another plan's; funding has
one case, so its latest research is the one (the owner, 30 Oct: "every launch readiness is new and different... like the
business plan"; "funding readiness is the one that should be overwritten, replacing with the most recent")."""
from datetime import datetime, timezone

from app.modules.agent import research

NOW = datetime.now(timezone.utc)
RUN = {"goal": "launch", "status": "review", "fingerprint": "fp", "created_at": NOW.isoformat(), "counts": {"sources": 3}, "items": []}
DATA = {"research_runs": {"r_sneaker": {**RUN, "id": "r_sneaker", "case_id": "sneaker"}}}


def test_another_launch_plans_research_is_never_reused():
    assert research.reuse_for(DATA, "launch", "fp", {}, NOW, case_id="soap") is None
    assert research.reuse_for(DATA, "launch", "fp", {}, NOW, case_id="sneaker")["id"] == "r_sneaker"


def test_funding_keeps_its_one_case_reuse():
    data = {"research_runs": {"r_f": {**RUN, "id": "r_f", "goal": "need_funding", "case_id": "f1"}}}
    assert research.reuse_for(data, "need_funding", "fp", {}, NOW, case_id="other")["id"] == "r_f"


def test_own_runs_keeps_other_goals():
    data = {"research_runs": {"a": {**RUN, "case_id": "x"}, "b": {**RUN, "goal": "test_idea"}}}
    assert set(research.own_runs(data, "launch", "y")["research_runs"]) == {"b"}
