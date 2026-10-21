"""§4 (R4, FV §4.1): paid research and generation run only when the owner asks. Checked in order: what kind of task it
is, then the plan, then credits. A free account's credits never unlock premium-only intelligence; free deterministic
checks may still run by themselves; research and generation are suggestions with a button."""
from app.modules.agent import autostart, config, first_value
from test_agent import OWNER, Env, run
from test_agent_employee import Chat


def test_a_free_account_with_50_credits_asking_for_premium_launch_research_is_refused_with_an_upgrade_and_charged_nothing():
    result = first_value.assess("launch", {"stage": "idea", "sell": "Dog grooming"}, {})
    gate = first_value.premium_gate(result, entitled=False, credits=50)      # the plan is checked before credits
    assert gate["allowed"] is False and gate["reason"] == "plan" and gate["primary"]["upgrade"] is True
    assert first_value.premium_gate(result, entitled=True, credits=0)["reason"] == "credits"      # included, but no credits: said as such


def test_mentioning_a_new_idea_in_chat_is_a_suggestion_only_and_costs_nothing(monkeypatch):
    env = Env()
    chat = Chat(monkeypatch, env)
    out = chat.say("I'm thinking about starting a dog grooming van in Leeds")
    assert out["kind"] == "answer" and "Nothing has been started" in out["message"]
    assert [o["capability"] for o in out["offers"]] == ["idea_validation", "market_size", "business_plan_draft"]
    assert chat.charges == [] and env.meter.charges == [] and chat.prompts == []      # no model answer, no charge
    assert not run(env.store.list_runs("A"))                                       # nothing started


def test_research_and_generation_are_never_started_by_the_agent_and_free_checks_still_are():
    env = Env(plan="decision_engine")
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {}}}, OWNER))
    rows = {e["capability"]: e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["capability"]}
    for cap in config.SUGGEST_ONLY:
        if cap in rows:
            assert rows[cap]["starts"] == "suggested" and not rows[cap]["switchable"], cap      # "Suggests it" in Agent settings
    for cap in config.FREE_DETERMINISTIC:
        if cap in rows and rows[cap]["available"]:
            assert rows[cap]["starts"] == "automatic", cap
    assert config.SUGGEST_ONLY.isdisjoint(config.FREE_DETERMINISTIC)
    started = run(autostart.sweep(env.orch, "A"))
    assert not [r for r in started if r["workflow_key"] in config.SUGGEST_ONLY]
    assert "registration_checklist" in {r["workflow_key"] for r in started}       # a free check, started by itself
