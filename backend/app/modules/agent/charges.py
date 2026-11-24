"""One charge per action of a task (F2). A step can be tried more than once: after a restart, a missed heartbeat or an
automatic retry. Each action it pays for ("reading the enquiry" in this step, sending this quotation, drafting this
plan) is charged once: what was paid for is written on the task, and a try the wallet gave back (it failed) is tried
again under a new wallet key, never the same one, so a released hold can't be taken later by mistake."""
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def charge_once(rt, run: dict, user_id: str, feature: str, action: str, what: str):
    """Yields True when it charged now, False when this action was already paid for on this task."""
    state = run.setdefault("state", {})
    paid = state.setdefault("paid", [])
    if action in paid:
        yield False
        return
    released = state.setdefault("released", {})
    n = int(released.get(action) or 0)
    try:
        async with rt.meter.charge(user_id, feature, key=f"{action}:{n}"):
            yield True
    except BaseException:
        released[action] = n + 1      # given back: the next try is a new charge
        raise
    paid.append(action)
    try:
        credits = int(await rt.meter.cost(feature))
    except Exception:      # noqa: BLE001 - the record of the cost never breaks the task
        credits = 0
    if credits:
        state.setdefault("credits", []).append({"feature": feature, "for": what, "credits": credits, "at": rt.clock().isoformat()})
    try:
        await rt.store.update_run(run["id"], {"state": state})      # written at once: a crash after this never charges again
    except Exception:      # noqa: BLE001 - written with the task's next save
        logger.info("charge recorded with the next save for task %s", run.get("id"))
