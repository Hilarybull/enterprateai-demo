"""Activation emails: the public unsubscribe and preference routes, the provider's delivery
webhook, the administrator views, and the scheduled job."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.modules.activation import rules
from app.modules.activation.service import ActivationService, Config, SendResult
from app.modules.activation.store import NotSetUp, SupabaseStore
from app.shared.auth.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["activation"])
ADMIN_EMAIL = "tech.support@enterprateai.com"
_service: ActivationService | None = None
_task: asyncio.Task | None = None


def parse_emails(value) -> frozenset:
    """Addresses from a setting, however they were typed: commas, semicolons, spaces or new lines, with or without quotes."""
    import re
    return frozenset(e.strip().strip("'\"<>").lower() for e in re.split(r"[,;\s]+", str(value or "")) if "@" in e)


NOT_SET_UP = {"code": "not_set_up", "message": "Activation emails aren't set up on this server: run migration 033."}


async def _run(coro):
    """A missing table or column is "not set up" (503), said plainly, never a generic failure."""
    try:
        return await coro
    except NotSetUp:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_SET_UP)


def read_config() -> Config:
    """The journey settings, from the environment. Read on each use, so a change takes effect on the next run."""
    from app.core.config import get_settings
    s = get_settings()
    base = str(s.frontend_url or "").split(",")[0].strip().rstrip("/")
    start = rules.parse(s.activation_start_at) if s.activation_start_at else None
    return Config(
        enabled=bool(s.activation_emails_enabled), dry_run=bool(s.activation_dry_run), cohort=str(s.activation_cohort or "internal").lower(),
        internal_emails=parse_emails(s.activation_internal_emails),
        sample_percent=int(s.activation_sample_percent), holdout_percent=int(s.activation_holdout_percent), start_at=start, backlog_batch=int(s.activation_backlog_batch),
        base_url=base or "http://localhost:5173", api_base_url=str(s.activation_api_base_url or "").strip(), secret=str(s.jwt_secret_key or "dev-activation-secret"),
        reply_to=str(s.activation_reply_to or "").strip() or None, postal_address=str(s.activation_postal_address or "").strip())


async def _send(message: dict) -> SendResult:
    from app.shared.email.resend import send_email_via_resend
    r = await send_email_via_resend(to_email=message["to"], subject=message["subject"], text_content=message["text"], html_content=message["html"],
                                    reply_to_email=message.get("reply_to"), idempotency_key=message["idempotency_key"], headers=message.get("headers"), marketing=True)
    return SendResult(sent=bool(r.sent), message_id=getattr(r, "message_id", None), uncertain=bool(getattr(r, "uncertain", False)),
                      recipient_rejected=bool(getattr(r, "recipient_rejected", False)), error=getattr(r, "error", None))


async def _plan_of(user_id: str) -> str:
    try:
        from app.modules.plans.access import effective_plan_key
        return await effective_plan_key(user_id)
    except Exception:      # noqa: BLE001 - when the plan can't be read, assume the smallest
        return "explorer"


def get_service() -> ActivationService:
    global _service
    if _service is None:
        _service = ActivationService(store=SupabaseStore(), send=_send, config=read_config, plan_of=_plan_of)
    return _service


def require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not available.")
    return user


# ── the scheduled job ─────────────────────────────────────────────────────────

async def _loop(interval_s: int) -> None:
    while True:
        try:
            if read_config().enabled:
                out = await get_service().tick()
                logger.info("activation run: %d selected, %d handled", len(out["selected"]), len(out["delivered"]))
        except asyncio.CancelledError:
            raise
        except NotSetUp:
            logger.warning("activation emails are switched on but not set up: run migration 033")
        except Exception as e:      # noqa: BLE001 - one bad run never stops the next
            logger.warning("activation run failed: %s", e)
        await asyncio.sleep(interval_s)


def start_scheduler(interval_s: int = 900) -> None:
    """Every 15 minutes (the brief asks for at least hourly), in the same in-process way as the Agent's job."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_loop(interval_s))


def stop_scheduler() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None


# ── unsubscribe and preferences (the link in every email; no sign-in needed) ──

class PreferencesIn(BaseModel):
    product_tips: bool


def _user_from(token: str) -> str:
    user_id = get_service().user_from_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link isn't valid.")
    return user_id


@router.post("/email/unsubscribe")
async def unsubscribe(token: str = Query(max_length=400)):
    """One click, from the email's link or the mail client's own unsubscribe button. Effective at once."""
    try:
        await _run(get_service().set_permission(_user_from(token), "unsubscribed", source="unsubscribe_link"))
    except KeyError:
        pass      # the account is gone: there is nothing left to email
    return {"ok": True, "message": "You won't receive any more tips from EnterprateAI. Messages about your account, such as password resets, are not affected."}


@router.get("/email/preferences")
async def read_preferences(token: str = Query(max_length=400)):
    prefs = await _run(get_service().preferences(_user_from(token)))
    if not prefs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link isn't valid.")
    return prefs


@router.put("/email/preferences")
async def change_preferences(body: PreferencesIn, token: str = Query(max_length=400)):
    svc, user_id = get_service(), _user_from(token)
    try:
        await _run(svc.set_permission(user_id, "subscribed" if body.product_tips else "unsubscribed", source="preference_page"))
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link isn't valid.")
    return await _run(svc.preferences(user_id))


UNAVAILABLE = {"available": False, "product_tips": False, "status": "unknown", "can_resubscribe": False, "ask_once": False}


@router.get("/auth/me/email-preferences")
async def my_preferences(user=Depends(get_current_user)):
    """A person's own setting. Where the feature isn't set up this says so (available: false) rather than
    failing: an ordinary user never sees an error for something that isn't there yet."""
    try:
        return await get_service().preferences(user["id"]) or UNAVAILABLE
    except NotSetUp:
        return UNAVAILABLE


@router.put("/auth/me/email-preferences")
async def change_my_preferences(body: PreferencesIn, user=Depends(get_current_user)):
    svc = get_service()
    await _run(svc.set_permission(user["id"], "subscribed" if body.product_tips else "unsubscribed", source="account_settings"))
    return await _run(svc.preferences(user["id"]))


@router.post("/auth/me/email-preferences/prompt")
async def answer_tips_prompt(body: PreferencesIn, user=Depends(get_current_user)):
    """The one-time question after signing up with Google. A tick is recorded as consent; closing it is recorded so it isn't asked again."""
    try:
        return await get_service().answer_prompt(user["id"], bool(body.product_tips)) or UNAVAILABLE
    except NotSetUp:
        return UNAVAILABLE


# ── delivery events from Resend ───────────────────────────────────────────────

def verify_webhook(secret: str, msg_id: str, timestamp: str, body: bytes, signatures: str, *, now: float | None = None) -> bool:
    """Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_"."""
    try:
        if abs((now if now is not None else time.time()) - int(timestamp)) > 300:
            return False
        key = base64.b64decode(secret.split("_", 1)[1] if secret.startswith("whsec_") else secret)
    except Exception:      # noqa: BLE001
        return False
    expected = base64.b64encode(hmac.new(key, f"{msg_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()).decode()
    return any(hmac.compare_digest(expected, part.split(",", 1)[-1]) for part in signatures.split())


@router.post("/webhooks/resend")
async def resend_webhook(request: Request):
    from app.core.config import get_settings
    secret = str(get_settings().resend_webhook_secret or "")
    body = await request.body()
    msg_id = request.headers.get("svix-id", "")
    if not secret or not verify_webhook(secret, msg_id, request.headers.get("svix-timestamp", ""), body, request.headers.get("svix-signature", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature not accepted.")
    try:
        event = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not JSON.")
    data = event.get("data") or {}
    return await _run(get_service().delivery_event(event_id=msg_id, type_=str(event.get("type") or ""), message_id=data.get("email_id") or data.get("id"),
                                              at=rules.parse(event.get("created_at")) or datetime.now(timezone.utc)))


# ── administrators ────────────────────────────────────────────────────────────

class PermissionIn(BaseModel):
    status: str
    source: str = Field(min_length=5, max_length=200)      # the evidence: where and how permission was given


@router.get("/admin/activation")
async def activation_dashboard(user=Depends(require_admin)):
    return await _run(get_service().dashboard())


@router.get("/admin/activation/dry-run")
async def activation_dry_run(at: str | None = Query(default=None, max_length=40), user=Depends(require_admin)):
    """Who would be enrolled, cancelled or emailed if the job ran now, or at `?at=` (an ISO date and time), and why.
    Nothing is written or sent."""
    when = None
    if at:
        when = rules.parse(at)
        if when is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Give the time as an ISO date and time, for example 2026-10-06T08:30:00Z.")
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)      # no zone given: read it as UTC
    return await _run(get_service().dry_run(when))


@router.get("/admin/activation/users/{user_id}")
async def activation_user(user_id: str, user=Depends(require_admin)):
    found = await _run(get_service().user_journey(user_id.strip().lower()))
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No account with that email.")
    return found


@router.put("/admin/activation/users/{user_id}/permission")
async def record_permission(user_id: str, body: PermissionIn, user=Depends(require_admin)):
    """Record permission for one account after checking the evidence for it. There is no bulk version on purpose."""
    if body.status not in rules.STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a status from: " + ", ".join(rules.STATUSES))
    svc = get_service()
    try:
        await _run(svc.set_permission(user_id.strip().lower(), body.status, source=f"{body.source} (recorded by {user['email']})", actor="admin"))
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No account with that email.")
    return await _run(svc.user_journey(user_id.strip().lower()))
