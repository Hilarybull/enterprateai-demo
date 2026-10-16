"""QA, 16 Oct (PRD 5.2): Idea Validation with the economics it needs unknown shows "Not enough evidence to score yet" with
what is missing, never a low score (the end-to-end run showed 10/100 for an idea with no price, cost or sales)."""
from app.modules.agent.workflows import economics_gaps


def test_missing_economics_are_named():
    assert economics_gaps({"known": {}}) == ["price per sale", "cost per sale", "expected sales a month"]
    assert economics_gaps({"known": {"price": 15000}}, {"cost": 6000}) == ["expected sales a month"]
    assert economics_gaps({"known": {"price": 15000, "cost": 6000, "monthly_sales": 40}}) == []


def test_the_task_says_not_enough_evidence_and_scores_once_the_economics_are_known():
    from test_agent import Env
    from test_agent_wording_all import _described
    env = Env()
    _described(env)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert r["summary"].startswith("Not enough evidence to score this idea yet. Still needed: price per sale, cost per sale and expected sales a month.")
    assert "/100" not in r["summary"]
    r2 = env.submit(capability="idea_validation", channel="ui_action", params={"answers": {"price": 30, "cost": 12, "monthly_sales": 40}})["run"]
    assert r2["summary"].startswith("Idea scored ")
