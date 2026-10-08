"""The plan map: the Agent runs a task the plan includes and charges AI Credits for it; a task
outside the plan is never started and never charged. One table decides (app/modules/plans/capabilities.py)."""
import pytest

from app.modules.agent import config
from app.modules.agent.workflows import WORKFLOWS
from app.modules.plans import capabilities as plan_map
from test_agent import ENQUIRY, OWNER, Env, run


def test_every_task_is_on_a_plan_and_states_what_it_costs():
    assert plan_map.all_capabilities() == set(WORKFLOWS)                  # nothing left off the map, nothing on it that doesn't exist
    assert all(config.cost_of(c) for c in WORKFLOWS)
    assert all(plan_map.PLAN_CAPABILITIES[a] <= plan_map.PLAN_CAPABILITIES[b] for a, b in zip(plan_map.PLAN_ORDER, plan_map.PLAN_ORDER[1:]))      # each plan includes the one before
    assert config.CAPABILITY_MIN_PLAN["new_invoice"] == "explorer" and config.CAPABILITY_MIN_PLAN["scenario_help"] == "starter_insight"


@pytest.mark.as_shipped
def test_explorer_runs_what_it_includes_and_pays_in_credits_with_no_monthly_count():
    env = Env(plan="explorer", credits=50)
    for n in range(7):                                                    # past the old five-a-month count: credits are the limit
        res = env.submit(capability="record_expense", channel="ui_action", text=f"record an expense of £{20 + n} for travel")
        assert res["kind"] != "blocked", (n, res.get("reason_codes"))


@pytest.mark.parametrize("capability", ["scenario_help", "new_proposal", "risk_concentration", "enquiry_to_quote"])
def test_explorer_is_never_run_or_charged_for_what_it_does_not_include(capability):
    env = Env(plan="explorer", credits=50)
    res = env.submit(capability=capability, channel="ui_action", params=dict(ENQUIRY) if capability == "enquiry_to_quote" else {})
    assert res["kind"] == "blocked" and res["reason_codes"] == ["plan_capability"] and res["reason"] == "plan"
    assert res["message"] == f"{WORKFLOWS[capability].title} is on the Starter plan."
    assert (res["plan_required"], res["plan_required_label"]) == ("starter_insight", "Starter")
    assert res["actions"][0] == {"label": "Upgrade", "to": "/pricing", "upgrade": True}
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == [] and env.meter.balances[OWNER] == 50
    if capability == "enquiry_to_quote":
        assert res["actions"][1] == {"label": "Create an invoice instead", "capability": "new_invoice"}      # something the plan does include


def test_starter_gets_four_scenarios_a_month_and_the_fifth_is_blocked_by_the_plan():
    env = Env(plan="starter_insight", credits=100)
    for n in range(4):
        assert env.submit(capability="scenario_help", channel="ui_action")["kind"] != "blocked", n
    before = (len(run(env.store.list_runs("A"))), list(env.meter.charges))
    fifth = env.submit(capability="scenario_help", channel="ui_action")
    assert fifth["kind"] == "blocked" and fifth["reason_codes"] == ["plan_quota"] and fifth["reason"] == "plan"
    assert fifth["message"] == "You've used all 4 scenario simulations included in the Starter plan this month."
    assert fifth["plan_required_label"] == "Decision Engine"
    assert (len(run(env.store.list_runs("A"))), list(env.meter.charges)) == before      # no run, no charge
    assert Env(plan="decision_engine", credits=100).orch and plan_map.quota("decision_engine", "scenario_help") is None      # no count from Decision Engine up


def test_with_no_credits_an_included_task_is_blocked_with_a_way_to_top_up():
    env = Env(plan="starter_insight", credits=0)
    res = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    assert res["kind"] == "blocked" and res["reason_codes"] == ["credits_exhausted"] and res["reason"] == "credits"
    assert res["balance"] == 0 and res["cost"] and res["actions"] == [{"label": "Top up", "to": "/pricing", "upgrade": True}]
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []


def test_every_task_has_a_price_and_an_asked_for_task_always_costs_the_same():
    from app.modules.agent.tools import REGISTRY
    for key, wf in WORKFLOWS.items():
        priced = any(REGISTRY[t].credit_feature for t in wf.tools) or key in config.SELF_PRICED or config.CREDIT_FEATURES[config.BASE_TASK_FEATURE]["cost"] >= 2
        assert priced and config.cost_of(key) != "Free", key               # no task is free, and each says its price
    assert all(f["cost"] >= 2 for f in config.CREDIT_FEATURES.values())    # nothing below the 2 credit minimum
    spent = []
    for _ in range(2):                                                     # the same request twice: the same price twice
        env = Env(plan="starter_insight", credits=50)
        res = env.submit(capability="registration_checklist", channel="ui_action")
        assert res["kind"] == "workflow" and res["credits_used"] == 2 and res["credits_left"] == 48
        spent.append([c[1:] for c in env.meter.charges])
    assert spent[0] == spent[1] == [("agent_task", 2)]


def test_a_task_that_does_not_succeed_costs_nothing_and_none_starts_on_an_empty_balance():
    empty = Env(plan="explorer", credits=0)
    res = empty.submit(capability="registration_checklist", channel="ui_action")
    assert res["kind"] == "blocked" and res["reason"] == "credits" and run(empty.store.list_runs("A")) == [] and empty.meter.charges == []
    env = Env(plan="explorer", credits=50)
    asked = env.submit(text="invoice BrightTech Ltd for a Strategy Workshop")      # waits for approval: only the draft is charged, the send is not
    assert [c[1:] for c in env.meter.charges] == [("agent_invoice_draft", 2)] and asked["credits_used"] == 2 and asked["credits_left"] == 48


def test_the_pricing_page_is_given_the_same_map_the_agent_checks():
    import asyncio
    from app.modules.plans.router import agent_tasks_by_plan
    out = asyncio.run(agent_tasks_by_plan())
    assert out["order"] == list(plan_map.PLAN_ORDER)
    assert "New Invoice" in out["plans"]["explorer"]["adds"] and "Scenario Help" in out["plans"]["starter_insight"]["adds"]
    assert "Scenario Help" not in out["plans"]["explorer"]["adds"] and out["plans"]["decision_engine"]["adds"] == []
    assert out["plans"]["starter_insight"]["quotas"]["scenario_help"] == 4 and out["plans"]["decision_engine"]["quotas"]["scenario_help"] is None
    assert sum(len(p["adds"]) for p in out["plans"].values()) == len(WORKFLOWS)      # every task appears once, on the plan that first includes it

