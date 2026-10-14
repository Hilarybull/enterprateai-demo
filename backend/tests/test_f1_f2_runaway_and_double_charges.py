"""F1: work the Agent started by itself that never reached the owner is refunded; tasks asked twice share one plan
document; a plan for another idea is titled for that idea and kept on its record. F2: each action of a task is charged
once, however often its step is tried again (the same step retried twice is charged once)."""
import copy
from types import SimpleNamespace

import pytest

from app.modules.agent import charges, workflows
from app.modules.agent.models import RUN_CANCELLED, RUN_FAILED
from test_agent import OWNER, Env, run
from test_round10_a2_second_idea import IDEA_A, _answer_all


def _env(credits=200):
    env = Env(plan="starter_insight", credits=credits)
    env.businesses["A"]["data"].update(copy.deepcopy(IDEA_A))
    return env


def _run(env, **state):
    """A real task on record, then set up as the case needs: started by the Agent itself, with what it was charged."""
    r = env.submit(capability="registration_checklist", channel="ui_action")["run"]
    env.meter.charges.clear()
    r.update({"source_channel": "business_event", "status": "running", "reason_code": None})
    r["state"] = {k: v for k, v in r["state"].items() if k not in ("credits", "paid", "task_charged")}
    r["state"].update(state)
    return r


# ══ F2 ════════════════════════════════════════════════════════════════════════

def test_the_same_step_tried_twice_is_charged_once():
    env = _env()
    r = _run(env)

    async def twice():
        for _ in range(2):
            async with charges.charge_once(env.orch.rt, r, OWNER, "agent_classify", "agent_classify:read", "read"):
                pass
    run(twice())
    assert env.meter.charges == [(OWNER, "agent_classify", 2)] and len(r["state"]["credits"]) == 1


def test_a_try_given_back_is_charged_again_under_a_new_key_and_then_never_again():
    env = _env()
    r = _run(env)

    async def tries():
        with pytest.raises(RuntimeError):
            async with charges.charge_once(env.orch.rt, r, OWNER, "agent_classify", "read", "read"):
                raise RuntimeError("the model failed")      # released: nothing kept
        for _ in range(2):
            async with charges.charge_once(env.orch.rt, r, OWNER, "agent_classify", "read", "read"):
                pass
    run(tries())
    assert env.meter.charges == [(OWNER, "agent_classify", 2)] and r["state"]["released"] == {"read": 1} and r["state"]["paid"] == ["read"]


def test_a_generator_step_tried_again_uses_what_it_made_and_charges_nothing_more():
    env = _env()
    r = _run(env)
    ctx = SimpleNamespace(run=r, rt=env.orch.rt, orch=env.orch, actor=SimpleNamespace(user_id=OWNER))
    studio = env.orch.rt.studio
    for _ in range(3):
        made = run(workflows._studio(ctx, "business_plan_full", studio.draft_plan(user_id=OWNER, business_id="A", idea={"name": "X"})))
    assert made["document_id"] == "doc-1" and [c[0] for c in studio.calls] == ["draft_plan"]
    assert [c[1] for c in env.meter.charges] == ["business_plan_full"]


# ══ F1 ════════════════════════════════════════════════════════════════════════

def test_automatic_work_that_never_reached_the_owner_is_refunded_once():
    env = _env()
    r = _run(env, credits=[{"feature": "business_plan_full", "credits": 40}])
    before = env.meter.balances[OWNER]
    run(env.orch._finish(r, RUN_CANCELLED, None, "duplicate", "Closed."))
    assert env.meter.balances[OWNER] == before + 40 and r["state"]["refunded"]["credits"] == 40
    assert run(env.orch.refund_undelivered(r)) == 0 and len(env.meter.refunds) == 1      # never twice


def test_a_failure_the_agent_will_still_retry_is_not_refunded_yet_and_asked_for_work_is_charged_as_before():
    env = _env()
    r = _run(env, credits=[{"feature": "agent_task", "credits": 2}], failed_at=None)
    r.update({"reason_code": next(iter(env.orch.AUTO_RETRY_REASONS))})
    run(env.orch._finish(r, RUN_FAILED, None, r["reason_code"], "Stopped part-way."))
    assert "refunded" not in r["state"]                                    # it will be tried again
    asked = {**_run(env, credits=[{"feature": "agent_task", "credits": 2}]), "source_channel": "text"}
    run(env.orch._finish(asked, RUN_CANCELLED, None, None, "Cancelled."))
    assert "refunded" not in asked["state"] and not getattr(env.meter, "refunds", [])


def test_a_plan_asked_for_twice_is_one_document_charged_once():
    env = _env()
    for _ in range(2):
        r = _answer_all(env, env.submit(text="write a business plan for my office deep cleaning business", capability="business_plan_draft")["run"])
        assert r["status"] == "succeeded", r.get("summary")
    assert [c[0] for c in env.orch.rt.studio.calls].count("draft_plan") == 1
    assert [c[1] for c in env.meter.charges].count("business_plan_full") == 1
    assert "Nothing was charged" in r["summary"] and r["state"]["outcome"]["reused"] is True


def test_an_automatic_plan_never_makes_a_second_document_for_the_same_business():
    env = _env()
    env.businesses["A"]["data"]["agent_studio"] = {"plan": {"document_id": "doc-earlier", "title": "Business plan", "at": "2026-10-13T22:59:00+00:00"}}
    r = env.submit(capability="business_plan_draft", channel="business_event")["run"]
    r = _answer_all(env, r)
    assert "draft_plan" not in [c[0] for c in env.orch.rt.studio.calls] and not [c for c in env.meter.charges if c[1] == "business_plan_full"]
    assert r["state"]["outcome"]["plan"]["document_id"] == "doc-earlier"


def test_a_plan_for_another_idea_is_titled_for_it_and_kept_on_its_record():
    env = _env()
    data = env.businesses["A"]["data"]
    r = _answer_all(env, env.submit(text="write a business plan for a mobile dog grooming van")["run"])
    assert r["workflow_key"] == "business_plan_draft"
    assert r["status"] == "succeeded", r.get("summary")
    [call] = [c for c in env.orch.rt.studio.calls if c[0] == "draft_plan"]
    assert call[1]["name"].lower().startswith("mobile dog grooming van")      # the plan's title is the idea's, not the business's
    [record] = data["agent_ideas"].values()
    assert record["plan"]["document_id"] == "doc-1" and "plan" not in (data.get("agent_studio") or {})


def test_the_same_task_advanced_twice_at_once_makes_one_document():
    """Four drafts in seventy seconds from one automatic plan (F1): two advances of one task at the same time."""
    import asyncio
    env = _env()
    r = _run(env)
    studio = env.orch.rt.studio
    slow_calls = []

    async def slow_plan(**kw):
        slow_calls.append(kw)
        await asyncio.sleep(0.05)
        return {"document_id": f"doc-{len(slow_calls)}", "title": "Business plan"}

    async def both():
        ctxs = [SimpleNamespace(run={**r, "state": dict(r["state"])}, rt=env.orch.rt, orch=env.orch, actor=SimpleNamespace(user_id=OWNER)) for _ in range(2)]
        return await asyncio.gather(*(workflows._studio(c, "business_plan_full", slow_plan(idea={})) for c in ctxs))
    made = run(both())
    assert len(slow_calls) == 1 and made[0] == made[1] and [c[1] for c in env.meter.charges] == ["business_plan_full"]
    assert studio.calls == []
