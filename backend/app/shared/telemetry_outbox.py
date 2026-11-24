"""Persist non-critical tracking locally; deliver it without holding user replies."""
import asyncio
import json
import logging
import os
import sqlite3
from pathlib import Path
from uuid import uuid4
from contextlib import contextmanager

logger = logging.getLogger(__name__)
_task = None
_writers = {}


@contextmanager
def _db():
    path = Path(os.environ.get("TELEMETRY_OUTBOX_PATH") or Path(__file__).resolve().parents[2] / ".runtime" / "telemetry.sqlite3")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=1)
    try:
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, target TEXT NOT NULL, payload TEXT NOT NULL)")
            yield db
    finally:
        db.close()


async def enqueue(target, payload, writer=None):
    if target not in ("ai_usage_events", "goal_events"):
        raise ValueError("Not a telemetry destination")
    if writer:
        _writers[target] = writer
    key = str(payload.get("id") or uuid4())
    with _db() as db:
        db.execute("INSERT OR IGNORE INTO pending VALUES (?, ?, ?)", (key, target, json.dumps(payload, default=str)))
    start()
    await asyncio.sleep(0)  # Fast writes can finish now; a slow database never holds the caller.


async def flush_once():
    with _db() as db:
        rows = db.execute("SELECT id,target,payload FROM pending ORDER BY CASE target WHEN 'ai_usage_events' THEN 0 ELSE 1 END, rowid LIMIT 20").fetchall()
    for key, target, raw in rows:
        try:
            writer = _writers.get(target)
            if writer:
                if await writer(json.loads(raw)) is False:
                    return False
            else:
                from app.core.supabase import sb_insert, sb_upsert
                if target == "ai_usage_events":
                    await sb_upsert(target, payload=json.loads(raw), on_conflict="id")
                else:
                    await sb_insert(target, json.loads(raw))
            with _db() as db:
                db.execute("DELETE FROM pending WHERE id=?", (key,))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Telemetry delivery deferred; the event remains on disk", exc_info=True)
            return False
    return True


def start():
    global _task
    if _task is not None and not _task.done():
        return
    async def deliver():
        delay = 5
        while True:
            success = await flush_once()
            delay = 5 if success else min(60, delay * 2)
            await asyncio.sleep(delay)
    _task = asyncio.create_task(deliver())


async def stop():
    global _task
    if _task:
        _task.cancel()
        await asyncio.gather(_task, return_exceptions=True)
        _task = None
