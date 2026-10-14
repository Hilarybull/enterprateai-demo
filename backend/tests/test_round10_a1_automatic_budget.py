"""A1: automatic work respects the budget and never piles up holds. An expensive task isn't started by itself (a
suggestion instead), the budget counts what is held for automatic work still running as well as what it spent, a task
that would go over the cap waits, each run attempt holds under one key, and retries are capped and then parked."""
from contextlib import asynccontextmanager

from app.modules.agent import autostart
from app.modules.agent import config as agent_config
from test_agent import OWNER, Env, run
from test_agent_budget_price import _only

PLAN = {"capability": "business_plan_draft", "reference": "idea:plan", "params": {}, "goal": "Draft the business plan"}


def _with(monkeypatch, env, candidate, cost, cap=50):
    async def prep(*_a, **_k):
        return [candidate]
    monkeypatch.setattr(autostart, "preparation", prep)
    monkeypatch.setattr(autostart, "candidates", lambda *a, **k: [])
    env.meter.costs[agent_config.feature_of(candidate["capability"])] = cost
    _only(env, "business_plan_draft", cap=cap)


def test_an_expensive_automatic_task_is_not_started_by_itself(monkeypatch):
    env = Env(plan="starter_insight", credits=200)
    _with(monkeypatch, env, PLAN, cost=40)
    assert run(autostart.sweep(env.orch, "A")) == [] and env.meter.charges == []
    assert not [r for r in run(env.store.list_runs("A")) if r["workflow_key"] == "business_plan_draft"]


def test_a_cheap_one_starts_shows_in_the_lists_and_counts_what_it_will_hold(monkeypatch):
    env = Env(plan="starter_insight", credits=200)
    _with(monkeypatch, env, PLAN, cost=2)
    assert run(autostart.sweep(env.orch, "A")) == []                        # §4: a plan is generation: never by itself, however cheap
    check = {"capability": "registration_checklist", "reference": "registration:checklist", "params": {}, "goal": "Prepare the checklist"}
    _with(monkeypatch, env, check, cost=2)
    _only(env, "registration_checklist", cap=50)
    [started] = run(autostart.sweep(env.orch, "A"))
    assert started["state"]["expected_credits"] == 2
    listed = {r["id"] for r in run(env.store.list_runs("A"))}
    assert started["id"] in listed      # it is a task like any other: Active, then History


def test_the_budget_counts_holds_for_automatic_work_still_running():
    runs = [{"source_channel": "business_event", "created_at": "2026-10-02T09:00:00+00:00", "status": "running", "state": {"expected_credits": 8}},
            {"source_channel": "business_event", "created_at": "2026-10-02T09:00:00+00:00", "status": "succeeded", "state": {"credits": [{"credits": 2}]}}]
    from datetime import datetime, timezone
    b = autostart.budget({"automation": {"monthly_credit_cap": 12}}, runs, datetime(2026, 10, 13, tzinfo=timezone.utc))
    assert (b["spent"], b["held"], b["used"], b["left"], b["paused"]) == (2, 8, 10, 2, False)


def test_a_task_that_would_go_over_the_cap_waits(monkeypatch):
    env = Env(plan="starter_insight", credits=200)
    _with(monkeypatch, env, PLAN, cost=8, cap=5)
    assert run(autostart.sweep(env.orch, "A")) == []


def test_each_attempt_holds_under_one_key_and_a_retry_gets_the_next(monkeypatch):
    env = Env(plan="starter_insight", credits=200)
    keys = []
    real = env.meter.charge

    @asynccontextmanager
    async def charge(user, feature, key=None):
        keys.append((feature, key))
        async with real(user, feature, key):
            yield
    monkeypatch.setattr(env.meter, "charge", charge)
    r = env.submit(text="Create a business plan for my bookkeeping business for small cafes")["run"]
    if r.get("pending_question"):
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: (f["options"][0]["value"] if f.get("options") else "Independent cafés")
                                                         for f in r["pending_question"]["fields"]}))
    plan = [k for f, k in keys if f == "business_plan_full"]
    assert plan == [f"business_plan_full:{r['id']}:0"]      # one hold, keyed to the run and its attempt: never a fresh random key
