"""Durable, idempotent replies: a browser timeout must not lose or repeat a turn."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

TURN_SECONDS = 180
_TASKS: set[asyncio.Task] = set()
logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def job_id_for(business_id, user_id, request_id):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{business_id}:{user_id}:{request_id}"))


async def drain() -> None:
    """Finish and persist accepted turns before a graceful restart closes their event loop."""
    tasks = list(_TASKS)
    if tasks:
        logger.info("Waiting for %d accepted agent replies before shutdown", len(tasks))
        await asyncio.gather(*tasks, return_exceptions=True)


async def _access(orch, user, business_id):
    from app.modules.agent.orchestrator import AccessDenied
    from app.modules.agent.business import BusinessAccessDenied
    try:
        context = getattr(orch.rt.business, "context", None)
        actor, _ = await context(user["id"], business_id, user.get("email")) if context else await orch.actor_for(user["id"], business_id, user.get("email"))
    except (AccessDenied, BusinessAccessDenied):
        raise HTTPException(404, "Conversation not found.")
    if not actor.can_view:
        raise HTTPException(403, "You don't have access to this conversation.")


async def start(orch, user, body, handler):
    await _access(orch, user, body.business_id)
    request_id = body.client_request_id or str(uuid.uuid4())
    job_id = job_id_for(body.business_id, user["id"], request_id)
    worker_id = str(uuid.uuid4())
    stamp = _now().isoformat()
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(exclude={"client_request_id"}), sort_keys=True, default=str).encode()).hexdigest()

    def claim(data):
        jobs = data.setdefault("agent_reply_jobs", {})
        for job in jobs.values():
            if job.get("state") == "pending" and (_now() - datetime.fromisoformat(job["created_at"])).total_seconds() > TURN_SECONDS + 30:
                job.update({"state": "failed", "message": "The reply was interrupted. Your message is saved; please try again."})
        previous = jobs.get(job_id)
        if previous:
            if previous.get("fingerprint") != fingerprint:
                raise HTTPException(409, "This message identifier belongs to a different request.")
            # A database retry can replay this callback after its first save
            # committed but the acknowledgement was lost. That same claimant
            # must still start its worker; a separate POST must not start two.
            return previous.get("worker_id") == worker_id and previous.get("state") == "pending"
        if sum(j.get("user_id") == user["id"] and j.get("state") == "pending" and
               (_now() - datetime.fromisoformat(j["created_at"])).total_seconds() < TURN_SECONDS + 30 for j in jobs.values()) >= 3:
            raise HTTPException(429, "Your earlier replies are still being prepared. Please wait for them to finish.")
        # Preserve active replies. Retain the newest completed replies for recovery.
        old = sorted((key for key, job in jobs.items() if job.get("state") != "pending"), key=lambda key: jobs[key].get("created_at", ""))
        for key in old[:-19]:
            jobs.pop(key, None)
        jobs[job_id] = {"user_id": user["id"], "state": "pending", "created_at": stamp, "fingerprint": fingerprint,
                        "user_message": body.text, "chat_id": body.chat_id, "worker_id": worker_id}
        return True

    # Business.mutate uses compare-and-swap. Only the successful claimant starts
    # work, even when a retried POST reaches a different server worker.
    created = await orch.rt.business.mutate(body.business_id, claim)
    if created:
        async def work():
            try:
                from app.core.supabase import read_cache
                # The background turn outlives the HTTP request. Own its read cache,
                # rather than inheriting a cache that polling requests cannot use.
                with read_cache():
                    result = await asyncio.wait_for(handler(body.model_copy(update={"defer_reply": False}), user), TURN_SECONDS)
                if not isinstance(result, dict) or not result:
                    raise RuntimeError("Agent returned no reply")
                saved = {"state": "complete", "result": jsonable_encoder(result)}
            except asyncio.CancelledError:
                saved = {"state": "failed", "message": "The reply was interrupted. Your message is saved; please try again."}
            except Exception:
                logger.exception("Agent reply job %s failed", job_id)
                saved = {"state": "failed", "message": "I couldn't finish this reply. Your message is saved; please try again."}

            def finish(data):
                job = (data.get("agent_reply_jobs") or {}).get(job_id)
                if job:
                    job.update({**saved, "finished_at": _now().isoformat()})
            for attempt in range(3):
                try:
                    await orch.rt.business.mutate(body.business_id, finish)
                    break
                except Exception:
                    if attempt == 2:
                        logger.exception("Agent reply job %s result could not be saved", job_id)
                    else:
                        await asyncio.sleep(0.5 * (attempt + 1))

        task = asyncio.create_task(work())
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)
    return {"kind": "pending_reply", "job_id": job_id, "business_id": body.business_id}


async def status(orch, user, business_id, job_id):
    # One authorised read, rather than policy + workspace + workspace again on
    # every poll. Polling must not compete with the reply for database slots.
    context = getattr(orch.rt.business, "context", None)
    if context:
        from app.modules.agent.business import BusinessAccessDenied
        try:
            actor, record = await context(user["id"], business_id, user.get("email"))
        except BusinessAccessDenied:
            raise HTTPException(404, "Conversation not found.")
        if not actor.can_view:
            raise HTTPException(403, "You don't have access to this conversation.")
        data = record.get("data") or {}
    else:
        await _access(orch, user, business_id)
        data = await orch.rt.business.load(business_id) or {}
    job = (data.get("agent_reply_jobs") or {}).get(job_id)
    if not job or job.get("user_id") != user["id"]:
        raise HTTPException(404, "Reply not found.")
    context = {"user_message": job.get("user_message"), "chat_id": job.get("chat_id"), "job_id": job_id}
    if job.get("state") == "complete":
        return {"state": "complete", "result": job["result"], **context}
    if job.get("state") == "failed" or (_now() - datetime.fromisoformat(job["created_at"])).total_seconds() > TURN_SECONDS + 30:
        return {"state": "failed", "message": job.get("message") or "The reply was interrupted. Your message is saved; please try again.", **context}
    return {"state": "pending", **context}


async def status_for_request(orch, user, business_id, request_id):
    """Recover an accepted request even when its POST acknowledgement never reached the browser."""
    return await status(orch, user, business_id, job_id_for(business_id, user["id"], request_id))
