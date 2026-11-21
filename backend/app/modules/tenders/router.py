"""Public discovery and authenticated watchlist / admin operations."""
import asyncio
import logging
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, StrictBool, Field

from app.modules.admin.router import require_admin
from app.modules.tenders import service
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/public-tenders", tags=["public-tenders"])
logger = logging.getLogger(__name__)
_scheduler = None
Stage = Literal["open", "planning", "award", "closed", "other", "all"]


@router.get("")
async def browse(q: str = Query("", max_length=150), stage: Stage = "open",
                 page: int = Query(1, ge=1, le=500), industry: str = Query("", max_length=2, pattern=r"^(?:[0-9]{2})?$"),
                 location: str = Query("", max_length=150), category: Literal["", "goods", "services", "works"] = "",
                 deadline_from: date | None = None, deadline_to: date | None = None,
                 sme: Literal["suitable", "all", "unspecified"] = "suitable"):
    if deadline_from and deadline_to and deadline_from > deadline_to:
        from fastapi import HTTPException
        raise HTTPException(422, "The end date must be on or after the start date.")
    return await service.search(q, stage, page, industry=industry, location=location, category=category,
        deadline_from=deadline_from.isoformat() if deadline_from else None,
        deadline_to=deadline_to.isoformat() if deadline_to else None, sme=sme)


@router.get("/watchlist")
async def watchlist(workspace_id: str = Query(min_length=1), user=Depends(get_current_user)):
    return await service.watchlist(user["id"], workspace_id)


@router.get("/recommendations")
async def recommendations(workspace_id: str = Query(min_length=1),
                          stage: Literal["open", "award"] | None = None,
                          page: int = Query(1, ge=1, le=5000),
                          page_size: int = Query(10, ge=1, le=50), user=Depends(get_current_user)):
    from app.modules.tenders.recommendations import recommend
    return await recommend(user["id"], workspace_id, stage=stage, page=page, page_size=page_size)


@router.get("/admin/health")
async def health(_user=Depends(require_admin)):
    return await service.sync_health()


@router.get("/admin/history")
async def history(before: datetime | None = None, page_size: int = Query(10, ge=1, le=50),
                  _user=Depends(require_admin)):
    return await service.sync_history(before=before, page_size=page_size)


class DismissErrorIn(BaseModel):
    attempt: datetime


@router.post("/admin/dismiss-error")
async def dismiss_error(body: DismissErrorIn, _user=Depends(require_admin)):
    return await service.dismiss_sync_error(body.attempt)


class ScheduleIn(BaseModel):
    enabled: StrictBool
    interval_minutes: int | None = Field(default=None, strict=True, ge=5, le=1440)
    import_scope: Literal["suitable", "all"] | None = None


@router.put("/admin/schedule")
async def update_schedule(body: ScheduleIn, _user=Depends(require_admin)):
    result = await service.set_automatic_sync(body.enabled, interval_minutes=body.interval_minutes,
                                              import_scope=body.import_scope)
    _schedule_changed.set()
    return result


@router.post("/admin/sync", status_code=202)
async def sync(tasks: BackgroundTasks, _user=Depends(require_admin)):
    tasks.add_task(_manual_sync)
    return {"status": "queued"}


async def _manual_sync():
    if not _sync_lock.locked():
        async with _sync_lock:
            try:
                await service.sync_once(manual=True)
            except Exception:
                logger.exception("Find a Tender manual sync failed")


@router.get("/{listing_id}")
async def detail(listing_id: str, user=Depends(get_current_user)):
    from app.modules.tenders.access import require_detail_access
    notice = await service.get_listing(listing_id)
    await require_detail_access(user["id"], notice)
    return notice


@router.get("/{listing_id}/evaluation")
async def saved_evaluation(listing_id: str, workspace_id: str = Query(min_length=1), user=Depends(get_current_user)):
    from app.modules.tenders.evaluation import saved_evaluation as read_saved
    return await read_saved(user["id"], workspace_id, listing_id)


@router.put("/{listing_id}/watchlist")
async def save(listing_id: str, workspace_id: str = Query(min_length=1), user=Depends(get_current_user)):
    return await service.set_saved(user["id"], workspace_id, listing_id, True)


@router.delete("/{listing_id}/watchlist")
async def unsave(listing_id: str, workspace_id: str = Query(min_length=1), user=Depends(get_current_user)):
    return await service.set_saved(user["id"], workspace_id, listing_id, False)


_sync_lock = asyncio.Lock()
_schedule_changed = asyncio.Event()


async def _loop():
    while True:
        _schedule_changed.clear()
        try:
            async with _sync_lock:
                if await service.scheduled_sync_enabled():
                    await service.sync_once()
        except Exception:
            logger.exception("Find a Tender scheduler failed")
        try:
            await asyncio.wait_for(_schedule_changed.wait(), timeout=300)
        except TimeoutError:
            pass


def start_scheduler():
    global _scheduler
    if _scheduler is None or _scheduler.done():
        _scheduler = asyncio.create_task(_loop())


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.cancel()
        _scheduler = None
