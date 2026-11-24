"""Explorer (free) sees that there is an insight and an Upgrade button, never the insight: no figures, no names, no
evidence. A paid plan sees it in full. What waits for the owner's approval is shown on any plan."""
from app.modules.agent import dashboard as dash
from test_agent import OWNER, Env, run
from test_dashboard import invoice, operating


def _cards(plan):
    env = Env(plan=plan)
    operating(env)
    return run(dash.build_dashboard(env.orch, OWNER, "A", OWNER))


def test_the_free_plan_sees_only_that_there_is_an_insight():
    d = _cards("explorer")
    shown = [c for c in d["insights"] if c["key"] not in dash.FREE_PLAN_KEEPS]
    assert shown
    for c in shown:
        assert c["locked"] is True and c["cta"] == dash.UPGRADE and c["text"].endswith("Upgrade to see it in full.")
        assert not any(ch.isdigit() for ch in c["text"]) and "%" not in c["text"] and "£" not in c["text"]
        assert c["detail"] is None and c["why"]["evidence"] == [] and c["agent_action"] is None and c["items"] == []
    assert all(c["text"].endswith("Upgrade to see it in full.") for c in d["agent"]["insights"])


def test_a_paid_plan_sees_the_insight_in_full():
    d = _cards("starter_insight")
    assert not any(c.get("locked") for c in d["insights"])
    assert any(any(ch.isdigit() for ch in c["text"]) for c in d["insights"])
