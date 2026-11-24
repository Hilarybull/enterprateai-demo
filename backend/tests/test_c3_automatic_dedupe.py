"""C3: an automatic trigger starts one task per period, even when two sweeps (or two starts) arrive at the same moment."""
import asyncio

from app.modules.agent.models import AgentRequest
from test_agent import OWNER, Env, run


def test_the_same_automatic_trigger_at_the_same_moment_is_one_task():
    env = Env()

    async def both():
        req = lambda: AgentRequest(requesting_actor_id=OWNER, business_id="A", source_channel="business_event",      # noqa: E731
                                   source_reference="price:test:2026-10", requested_capability="registration_checklist", params={})
        return await asyncio.gather(env.orch.submit(req()), env.orch.submit(req()))
    first, second = run(both())
    runs = [r for r in run(env.store.list_runs("A")) if r.get("source_reference") == "price:test:2026-10"]
    assert len(runs) == 1 and (first.get("duplicate") or second.get("duplicate"))


def test_the_next_period_is_a_new_task():
    env = Env()
    for ref in ("price:test:2026-10", "price:test:2026-11"):
        env.submit(capability="registration_checklist", channel="business_event", source_reference=ref)
    assert len([r for r in run(env.store.list_runs("A")) if str(r.get("source_reference")).startswith("price:test:")]) == 2
