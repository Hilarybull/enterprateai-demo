"""QA round 3: E8 /plans/my says what the account can use (its plan plus admin grants) beside what it pays for;
E3/E8 the dashboard says "switched off" only when it is; E9 a scenario card with nothing behind it needs data,
so it never offers an upgrade."""
import asyncio

from app.modules.plans import router as plans_router
from app.modules.plans.schemas import SubscriptionOut
from test_dashboard import Env, build, idea


def test_e8_plans_my_carries_the_effective_plan(monkeypatch):
    async def subscription(_uid):
        return SubscriptionOut(plan_key="explorer", status="active")

    async def access(_uid):
        return {"effective_plan": "strategic_business_os", "source": "admin full-access grant"}
    monkeypatch.setattr(plans_router, "resolve_subscription", subscription)
    import app.modules.plans.access as acc
    monkeypatch.setattr(acc, "effective_access", access)
    out = asyncio.run(plans_router.get_my_subscription(user={"id": "u1"}))
    assert (out.plan_key, out.effective_plan_key, out.access_source) == ("explorer", "strategic_business_os", "admin full-access grant")


def test_e9_the_idea_stage_scenario_needs_data():
    env = Env()
    idea(env)
    card = next(c for c in build(env)["insights"] if c["key"] == "scenario")
    assert card["state"] == "insufficient_data"


def test_e3_a_task_the_plan_lacks_is_said_as_that_not_switched_off():
    env = Env(plan="explorer")
    idea(env)
    texts = [s["text"] for s in build(env)["agent"]["suggestions"]]
    assert not any("switched off in Agent settings" in t for t in texts if "Market sizing" in t or "Business plan" in t), texts
