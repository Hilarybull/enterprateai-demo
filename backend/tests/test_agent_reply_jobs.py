import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.agent import reply_jobs
from app.modules.agent.router import AgentRequestIn


class Business:
    def __init__(self): self.data = {}
    async def load(self, _id): return self.data
    async def mutate(self, _id, fn): return fn(self.data)


def world():
    business = Business()
    async def actor(*args): return SimpleNamespace(can_view=True), None
    return SimpleNamespace(rt=SimpleNamespace(business=business), actor_for=actor), {"id": "owner"}


def test_a_slow_reply_is_polled_without_repeating_the_turn_and_retains_handover_answers():
    async def scenario():
        orch, user = world()
        gate, begun = asyncio.Event(), asyncio.Event()
        calls = []
        words = "I need funding: NGN 1m for food, a loan, March next year. The business is trading."
        body = AgentRequestIn(business_id="business", text=words, client_request_id="same-message", background=True, defer_reply=True, chat_id="chat")
        async def handler(request, actor):
            calls.append(request)
            begun.set()
            await gate.wait()
            return {"kind": "answer", "message": "Your funding details are ready."}
        first = await reply_jobs.start(orch, user, body, handler)
        await begun.wait()
        duplicate = await reply_jobs.start(orch, user, body, handler)
        assert first["job_id"] == duplicate["job_id"] and len(calls) == 1
        pending = await reply_jobs.status(orch, user, "business", first["job_id"])
        assert pending["state"] == "pending" and pending["user_message"] == words
        assert calls[0].text == words and not calls[0].defer_reply and calls[0].background
        gate.set()
        await asyncio.gather(*list(reply_jobs._TASKS))
        result = await reply_jobs.status(orch, user, "business", first["job_id"])
        assert result["state"] == "complete" and result["result"]["message"] == "Your funding details are ready."
        assert result["chat_id"] == "chat"
    asyncio.run(scenario())


def test_saved_reply_is_private_to_its_owner_even_inside_a_shared_workspace():
    async def scenario():
        orch, user = world()
        orch.rt.business.data["agent_reply_jobs"] = {"job": {"user_id": user["id"], "state": "complete", "result": {"message": "private"}}}
        with pytest.raises(HTTPException) as error:
            await reply_jobs.status(orch, {"id": "other-person"}, "business", "job")
        assert error.value.status_code == 404
    asyncio.run(scenario())


def test_shutdown_waits_for_the_reply_and_persists_it_before_returning():
    async def scenario():
        orch, user = world()
        gate = asyncio.Event()
        async def handler(*args):
            await gate.wait()
            return {"kind": "answer", "message": "Saved before restart"}
        job = await reply_jobs.start(orch, user, AgentRequestIn(business_id="business", text="Continue", defer_reply=True), handler)
        shutdown = asyncio.create_task(reply_jobs.drain())
        await asyncio.sleep(0)
        assert not shutdown.done()
        gate.set()
        await shutdown
        result = await reply_jobs.status(orch, user, "business", job["job_id"])
        assert result["state"] == "complete"
        assert result["result"]["message"] == "Saved before restart"
    asyncio.run(scenario())


def test_database_replaying_a_committed_claim_still_starts_one_worker():
    async def scenario():
        orch, user = world()
        original = orch.rt.business.mutate
        async def replayed(business_id, fn):
            await original(business_id, fn)
            return await original(business_id, fn)
        orch.rt.business.mutate = replayed
        calls = []
        async def handler(*args):
            calls.append(True)
            return {"kind": "answer", "message": "Ready"}
        job = await reply_jobs.start(orch, user, AgentRequestIn(business_id="business", text="Continue", defer_reply=True), handler)
        await reply_jobs.drain()
        assert calls == [True]
        assert (await reply_jobs.status(orch, user, "business", job["job_id"]))["state"] == "complete"
    asyncio.run(scenario())


def test_interrupted_reply_has_a_terminal_recovery_state_instead_of_spinning_forever():
    async def scenario():
        orch, user = world()
        orch.rt.business.data["agent_reply_jobs"] = {"job": {"user_id": user["id"], "state": "pending",
            "created_at": (datetime.now(timezone.utc) - timedelta(seconds=reply_jobs.TURN_SECONDS + 31)).isoformat()}}
        result = await reply_jobs.status(orch, user, "business", "job")
        assert result["state"] == "failed" and "interrupted" in result["message"]
    asyncio.run(scenario())


def test_failed_generation_is_saved_as_failed_and_never_disguised_as_an_answer():
    async def scenario():
        orch, user = world()
        async def handler(*args): raise RuntimeError("provider failed")
        job = await reply_jobs.start(orch, user, AgentRequestIn(business_id="business", text="Funding", defer_reply=True), handler)
        await asyncio.gather(*list(reply_jobs._TASKS))
        result = await reply_jobs.status(orch, user, "business", job["job_id"])
        assert result["state"] == "failed" and "result" not in result
    asyncio.run(scenario())


def test_timed_out_generation_is_cancelled_and_original_message_is_kept(monkeypatch):
    monkeypatch.setattr(reply_jobs, "TURN_SECONDS", 0.01)
    async def scenario():
        orch, user = world()
        stopped = asyncio.Event()
        async def handler(*args):
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        job = await reply_jobs.start(orch, user, AgentRequestIn(business_id="business", text="My funding request", defer_reply=True), handler)
        await asyncio.gather(*list(reply_jobs._TASKS))
        result = await reply_jobs.status(orch, user, "business", job["job_id"])
        assert stopped.is_set() and result["state"] == "failed"
        assert result["message"] != "My funding request"
        assert orch.rt.business.data["agent_reply_jobs"][job["job_id"]]["user_message"] == "My funding request"
    asyncio.run(scenario())


def test_stale_workspace_save_cannot_erase_or_overwrite_reply_results():
    from app.shared.workspace_merge import preserve_server_fields
    stored = {"agent_reply_jobs": {"job": {"state": "complete", "result": {"message": "Ready"}}}}
    for incoming in ({}, {"agent_reply_jobs": {"job": {"state": "pending"}}}):
        assert preserve_server_fields(incoming, stored)["agent_reply_jobs"] == stored["agent_reply_jobs"]


def test_http_handover_acknowledges_then_serves_one_saved_reply(monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from app.modules.agent import router as agent_router
    orch, user = world()
    app = FastAPI()
    app.include_router(agent_router.router)
    app.dependency_overrides[agent_router.get_current_user] = lambda: user
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: orch)
    calls = []
    async def reply(body, actor):
        calls.append(body.text)
        return {"kind": "answer", "message": "Your loan request is ready."}
    # The registered endpoint remains real; its background handler is scripted.
    monkeypatch.setattr(agent_router, "submit_request", reply)
    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            body = {"business_id": "business", "text": "NGN 1m for food, loan, March next year", "defer_reply": True, "client_request_id": "handover"}
            first = await client.post("/agent/requests", json=body)
            duplicate = await client.post("/agent/requests", json=body)
            assert first.status_code == duplicate.status_code == 200
            assert first.json() == duplicate.json() and first.json()["kind"] == "pending_reply"
            await asyncio.gather(*list(reply_jobs._TASKS))
            result = await client.get(f"/businesses/business/agent/replies/{first.json()['job_id']}")
            assert result.status_code == 200 and result.json()["state"] == "complete"
            assert result.json()["result"]["message"] == "Your loan request is ready."
            assert calls == [body["text"]]
    asyncio.run(scenario())
