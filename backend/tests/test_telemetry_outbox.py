import asyncio
import json
from unittest.mock import AsyncMock

from app.shared import telemetry_outbox as queue


def pending():
    with queue._db() as db:
        return db.execute("SELECT payload FROM pending").fetchall()


def test_slow_tracking_write_does_not_hold_the_reply_and_event_is_durable(monkeypatch):
    async def scenario():
        gate = asyncio.Event()
        async def slow(payload):
            await gate.wait()
            return True
        await asyncio.wait_for(queue.enqueue("ai_usage_events", {"id": "one", "total_tokens": 400}, slow), 1)
        assert json.loads(pending()[0][0])["total_tokens"] == 400
        await queue.stop()
        assert len(pending()) == 1
    asyncio.run(scenario())


def test_failed_delivery_stays_queued_and_recovers_without_another_ai_call():
    async def scenario():
        failed = AsyncMock(return_value=False)
        await queue.enqueue("ai_usage_events", {"id": "retry-same-event", "total_tokens": 500}, failed)
        await queue.stop()
        assert len(pending()) == 1
        recovered = AsyncMock(return_value=True)
        queue._writers["ai_usage_events"] = recovered
        assert await queue.flush_once()
        assert not pending()
        assert recovered.call_args.args[0]["id"] == "retry-same-event"
    asyncio.run(scenario())


def test_repeated_enqueue_of_same_usage_event_does_not_create_two_charges():
    async def scenario():
        writer = AsyncMock(return_value=False)
        await queue.enqueue("ai_usage_events", {"id": "same-event"}, writer)
        await queue.enqueue("ai_usage_events", {"id": "same-event"}, writer)
        await queue.stop()
        assert len(pending()) == 1
    asyncio.run(scenario())


def test_restart_recovers_usage_without_a_registered_writer(monkeypatch):
    from app.core import supabase
    written = []
    async def upsert(table, *, payload, on_conflict):
        written.append((table, payload, on_conflict))
    monkeypatch.setattr(supabase, "sb_upsert", upsert)
    monkeypatch.setattr(queue, "_writers", {})
    with queue._db() as db:
        db.execute("INSERT INTO pending VALUES (?, ?, ?)", ("saved", "ai_usage_events", json.dumps({"id": "saved", "total_tokens": 500})))
    assert asyncio.run(queue.flush_once())
    assert written == [("ai_usage_events", {"id": "saved", "total_tokens": 500}, "id")]
    assert not pending()


def test_restart_keeps_usage_on_disk_if_database_delivery_fails(monkeypatch):
    from app.core import supabase
    async def unavailable(table, *, payload, on_conflict):
        raise RuntimeError("database unavailable")
    monkeypatch.setattr(supabase, "sb_upsert", unavailable)
    monkeypatch.setattr(queue, "_writers", {})
    with queue._db() as db:
        db.execute("INSERT INTO pending VALUES (?, ?, ?)", ("saved", "ai_usage_events", json.dumps({"id": "saved"})))
    assert not asyncio.run(queue.flush_once())
    assert len(pending()) == 1
