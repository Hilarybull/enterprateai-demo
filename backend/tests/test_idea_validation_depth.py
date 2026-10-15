"""Idea Validation Basic or Comprehensive (the owner's QA, 15 Oct): Explorer runs Basic (the engine alone, free) and is
told what Comprehensive adds; a paid plan runs Comprehensive (its price first, charged as the price list's 25); an
upgrade validates the same draft again, with the same answers."""
from test_agent import OWNER, Env, run
from test_agent_wording_all import _described


def _priced(env):
    env.meter.costs.pop("idea_validation", None)      # the price list's own prices: Basic is free (042)
    return env


def _validate(env, **kw):
    return env.submit(capability="idea_validation", channel="ui_action", **kw)["run"]


def test_explorer_runs_basic_free_and_is_offered_the_full_check():
    env = Env()
    _described(env)
    _priced(env)
    env.meter.plans[OWNER] = "explorer"
    r = _validate(env)
    assert r["state"]["params"]["depth"] == "basic" and r["state"]["outcome"]["depth"] == "basic"
    assert "Comprehensive validation checks your market, competitors, pricing and unit economics. Available on Starter." in r["summary"]
    assert any(l.get("label") == "Upgrade to validate fully" for l in r["state"]["outcome"]["links"])
    assert not [c for c in env.meter.charges if c[1].startswith("idea_validation") and c[2]]      # nothing charged


def test_a_paid_plan_runs_comprehensive_and_the_upgrade_keeps_the_same_draft():
    env = Env()
    _described(env)
    _priced(env)
    env.meter.plans[OWNER] = "explorer"
    basic = _validate(env)
    first_id = basic["state"]["outcome"]["links"][0]["to"]
    env.meter.plans[OWNER] = "starter_insight"
    full = _validate(env)
    assert full["state"]["params"]["depth"] == "comprehensive"
    assert [c[1] for c in env.meter.charges if c[1].startswith("idea_validation") and c[2]] == ["idea_validation_comprehensive"]
    assert full["state"]["outcome"]["links"][0]["to"] == first_id      # the same draft, validated again
    drafts = [e for e in env.businesses["A"]["data"].get("validation_history") or [] if str(e.get("id", "")).startswith("agent-")]
    assert len(drafts) <= 1      # one draft per idea, never a second
