"""The one AI gateway (the owner's QA, 15 Oct): Claude first, then OpenAI on an error (an empty balance, 429, 5xx, a
timeout); with every provider failing, the business plan keeps its inputs, waits to finish by itself (said once in plain
words), and nothing is charged. No raw error ever reaches the owner."""
import asyncio
import re

from test_agent import OWNER, Env, run
from test_agent_wording_all import _described

from app.shared.llm.openai_client import ChainLLMClient, LLMTextResult


class Fails:
    async def generate_text(self, **_k):
        raise RuntimeError('Anthropic API error 400: {"type":"error","error":{"message":"Your credit balance is too low"},"request_id":"req_1"}')


class Answers:
    async def generate_text(self, **_k):
        return LLMTextResult(text="The plan section.", provider="openai", model="gpt-4.1-mini")


def test_an_empty_claude_balance_is_served_by_openai():
    res = asyncio.run(ChainLLMClient([Fails(), Answers()]).generate_text(system="s", prompt="p", feature="blueprint.business_plan"))
    assert res.text == "The plan section." and res.provider == "openai"


RAW = re.compile(r"RuntimeError|API error|request_id|[{}]|Anthropic|OpenAI|HTTP \d{3}")


def test_with_every_provider_failing_the_plan_waits_to_finish_and_nothing_is_charged():
    env = Env()
    _described(env)

    async def broken(**_k):
        raise RuntimeError('Anthropic API error 400: {"request_id":"req_1"}')
    env.orch.rt.studio.draft_plan = broken
    r = env.submit(capability="business_plan_draft", channel="ui_action")["run"]
    want = "I couldn't write your business plan just now. I've saved your inputs and will finish it automatically. Nothing was charged."
    assert r["status"] == "failed" and r["reason_code"] == "generation_unavailable" and r["error"] == want
    assert env.orch.retrying(r) and env.orch.next_attempt_at(r) is not None      # tried again by itself
    assert not [c for c in env.meter.charges if c[1] == "business_plan_full"]
    filed = getattr(env.orch.rt.studio, "filed", {})
    pending = r["state"]["pending_doc"]
    assert filed[pending]["title"] == "Business plan (waiting to write)" and "Waiting to write." in filed[pending]["markdown"]
    from app.modules.agent import router as agent_router
    shown = agent_router._public_run(r)
    said = " ".join(str(shown.get(k) or "") for k in ("error", "summary", "next_action", "status_label"))
    assert not RAW.search(said), said
