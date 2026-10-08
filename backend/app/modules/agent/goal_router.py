"""HTTP surface for goal-driven onboarding (PRD-GO-001 s18). Starting, reading and answering a
session need no account; attaching, resuming and preparing need a signed-in user."""
from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.modules.agent import goals
from app.shared.auth.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["goal-onboarding"])

_store: goals.SessionStore | None = None


def get_store() -> goals.SessionStore:
    global _store
    if _store is None:
        try:
            from app.core.config import get_settings
            s = get_settings()
            _store = goals.SupabaseSessionStore() if (s.supabase_url and s.supabase_service_role_key) else goals.SessionStore()
        except Exception:      # noqa: BLE001
            _store = goals.SessionStore()
    return _store


def get_orchestrator():
    from app.modules.agent.router import get_orchestrator as agent_orchestrator
    return agent_orchestrator()


# Anonymous visitors can start sessions, so starts are capped per address (PRD s24: abuse controls).
_STARTS: dict[str, list[float]] = {}
START_LIMIT, START_WINDOW_S, EVENT_LIMIT, CODE_LIMIT = 30, 3600, 300, 20


def _allow(request: Request, bucket: str = "starts", limit: int | None = None) -> None:
    limit = START_LIMIT if limit is None else limit
    who = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "") or "unknown").split(",")[0].strip()
    who = who if bucket == "starts" else f"{bucket}:{who}"
    now = time.monotonic()
    recent = [t for t in _STARTS.get(who, []) if now - t < START_WINDOW_S]
    if len(recent) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many tasks started from here. Please try again later.")
    _STARTS[who] = recent + [now]
    if len(_STARTS) > 5000:
        _STARTS.clear()


class StartIn(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    key: str | None = Field(default=None, max_length=64)                 # a homepage goal or quick task
    entry_mode: str = Field(default="free_text", max_length=20)          # business_goal | quick_task | free_text


class InputsIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    confirm: bool = False      # "that's right": accept what was read from the visitor's own sentence


class EmailIn(BaseModel):
    email: str | None = Field(default=None, max_length=254)      # omitted: send a new code to the address already given
    name: str | None = Field(default=None, max_length=120)       # the person's own name, for their account
    marketing_consent: bool | None = None                        # the unticked box: tips and the newsletter. Never needed for the task itself.


class CodeIn(BaseModel):
    code: str = Field(max_length=12)
    timezone: str | None = Field(default=None, max_length=64)


class Accounts:
    """The accounts a verified email belongs to. Kept behind this so the flow can be tested without a database."""

    async def find(self, email: str) -> dict | None:
        from app.core.supabase import sb_select
        return await sb_select("users", filters=[("id", "eq", email)], single=True)

    async def create(self, email: str, timezone_name: str | None = None, name: str | None = None) -> dict:
        """A goal-first account: the email is verified, and there is no password yet (one can be set later in Account settings)."""
        from datetime import datetime, timezone
        from app.core.supabase import sb_insert
        row = {"id": email, "email": email, "email_verified": True, "auth_provider": "email_code", "verified_at": datetime.now(timezone.utc).isoformat(),
               **({"name": name} if name else {}), **({"timezone": timezone_name[:64]} if timezone_name else {})}
        try:
            await sb_insert("users", row)
        except Exception:      # noqa: BLE001 - a column that isn't there yet must not stop someone getting in
            await sb_insert("users", {"id": email, "email": email, "email_verified": True, "auth_provider": "email_code", **({"name": name} if name else {})})
        return row

    async def set_name(self, email: str, name: str) -> None:
        from app.core.supabase import sb_update
        await sb_update("users", filters=[("id", "eq", email)], payload={"name": name})

    async def remember(self, email: str, facts: dict) -> None:
        """What is known about the person from the homepage flow: their first name, how they came, what
        they first asked for, and their marketing choice. Each is written by itself, so a column the
        database doesn't have yet (before migration 040) loses only that one fact, never the account."""
        from app.core.supabase import sb_update
        for key, value in facts.items():
            try:
                await sb_update("users", filters=[("id", "eq", email)], payload={key: value})
            except Exception:      # noqa: BLE001
                logger.info("users.%s could not be saved (is migration 040 run?)", key)

    async def permit(self, user_id: str, consent: dict) -> None:
        """Record that this person asked for tips and the newsletter: when, where, and which wording they saw."""
        from app.modules.activation.router import get_service
        await get_service().set_permission(user_id, "subscribed", source=consent.get("consent_source") or "homepage_agent", wording=consent.get("consent_version"))

    async def mark_verified(self, email: str) -> None:
        from app.core.supabase import sb_update
        await sb_update("users", filters=[("id", "eq", email)], payload={"email_verified": True, "email_verification_token": None})

    def token(self, user_id: str) -> str:
        from app.shared.auth.security import create_access_token
        return create_access_token(subject=user_id)


_accounts: Accounts | None = None


def get_accounts() -> Accounts:
    global _accounts
    if _accounts is None:
        _accounts = Accounts()
    return _accounts


async def send_code_email(email: str, code: str, saving: str) -> None:
    from app.shared.email.resend import send_task_code_email
    await send_task_code_email(to_email=email, code=code, saving=saving)


class EventIn(BaseModel):
    name: str = Field(max_length=60)
    session_id: str | None = Field(default=None, max_length=80)
    entry_mode: str | None = Field(default=None, max_length=20)
    key: str | None = Field(default=None, max_length=64)


class ResumeIn(BaseModel):
    business_name: str | None = Field(default=None, max_length=120)
    business_id: str | None = Field(default=None, max_length=80)      # which of their workspaces, when they have several


async def _session(session_id: str) -> dict:
    session = await goals.load(get_store(), session_id)
    if not session:
        raise HTTPException(status_code=404, detail="This task has expired or was not found. Start again from the homepage.")
    return session


def _mine(session: dict, user: dict) -> None:
    if session.get("user_id") and session["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This task belongs to another account.")


@router.get("/goal-suggestions")
async def goal_suggestions():
    """What the homepage may offer right now: only suggestions with a registered path behind them."""
    return goals.suggestions()


@router.post("/goal-resolution")
async def goal_resolution(body: StartIn):
    """Resolve a goal without starting anything (zero-credit; no session, nothing stored)."""
    return goals.resolve(text=body.text, key=body.key)


@router.post("/task-sessions", status_code=201)
async def start_session(body: StartIn, request: Request):
    if not (body.text or "").strip() and not body.key:
        raise HTTPException(status_code=422, detail="Say what you want to do, or pick a suggestion.")
    _allow(request)
    return goals.public(await goals.start(get_store(), text=body.text, key=body.key, entry_mode=body.entry_mode))


@router.get("/task-sessions/{session_id}")
async def read_session(session_id: str):
    return goals.public(await _session(session_id))


@router.post("/task-sessions/{session_id}/inputs")
async def session_inputs(session_id: str, body: InputsIn):
    session = await _session(session_id)
    if session["state"] == goals.ABANDONED:
        raise HTTPException(status_code=410, detail="This task has expired. Start again from the homepage.")
    return goals.public(await goals.add_inputs(get_store(), session, body.answers, confirm=body.confirm))


@router.post("/goal-events", status_code=202)
async def goal_event(body: EventIn, request: Request):
    """A funnel step seen by the page (PRD s20). Only known event names, a goal or task key and the
    entry mode are taken: there is nowhere to put what someone typed."""
    if body.name not in goals.CLIENT_EVENTS:
        raise HTTPException(status_code=422, detail="Unknown event.")
    _allow(request, bucket="events", limit=EVENT_LIMIT)
    session = await goals.load(get_store(), body.session_id) if body.session_id else None
    mode = body.entry_mode if body.entry_mode in ("business_goal", "quick_task", "free_text") else None
    key = body.key if body.key in goals._BY_KEY else None
    await goals.track(get_store(), body.name, session, entry_mode=None if session else mode, goal_key=None if session else key)
    return {"ok": True}


@router.post("/task-sessions/{session_id}/email")
async def session_email(session_id: str, body: EmailIn, request: Request):
    """Send the 6-digit code that saves this task. The same answer for every address, whether or not it has an account."""
    session = await _session(session_id)
    if session["state"] == goals.ABANDONED:
        raise HTTPException(status_code=410, detail="This task has expired. Start again from the homepage.")
    _allow(request, bucket="codes", limit=CODE_LIMIT)
    try:
        session = await goals.send_code(get_store(), session, body.email, send_code_email, name=body.name, marketing_consent=body.marketing_consent,
                                        consent_source="start_goal" if session.get("entry_mode") == "business_goal" else "homepage_agent")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return goals.public(session)


@router.post("/task-sessions/{session_id}/verify")
async def session_verify(session_id: str, body: CodeIn):
    """The code is right: the email is theirs. An existing account is signed in; a new one is made
    (no password needed now). Either way the task is bound to it and carries on."""
    session = await _session(session_id)
    try:
        email = await goals.check_code(get_store(), session, body.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    accounts = get_accounts()
    user = await accounts.find(email)
    if user and user.get("is_blocked"):
        raise HTTPException(status_code=403, detail="Account suspended. Contact support at tech.support@enterprateai.com")
    created = not user
    name = str(session.get("name") or "").strip() or None
    if created:
        user = await accounts.create(email, body.timezone, name)
    else:
        if user.get("email_verified") is False:
            await accounts.mark_verified(email)      # they have just proved the address is theirs
        if name and not str(user.get("name") or "").strip():
            try:
                await accounts.set_name(email, name)      # an account with no name on it takes the one just given; a name already there is left alone
            except Exception:      # noqa: BLE001
                logger.warning("could not save the name for %s", email, exc_info=True)
    facts: dict = {}
    visitor = session.get("visitor") or {}
    if visitor.get("first_name") and not str(user.get("first_name") or "").strip():
        facts["first_name"] = visitor["first_name"]
    if created:
        facts["signup_source"] = "start_goal" if session.get("entry_mode") == "business_goal" else "homepage_agent"
        facts["first_goal"] = str(session.get("goal_key") or "")[:80] or None
    if (session.get("consent") or {}).get("marketing_consent"):
        # A ticked box is recorded where every other marketing choice is (the account's email permission), so the
        # one-click unsubscribe in each email, and Account settings, undo it at once. An unticked box changes nothing.
        try:
            await accounts.permit(user["id"], session["consent"])
        except Exception:      # noqa: BLE001 - never a reason not to let them in
            logger.warning("could not record the marketing choice for %s", email, exc_info=True)
    if facts:
        try:
            await accounts.remember(email, facts)
        except Exception:      # noqa: BLE001 - never a reason not to let them in
            logger.warning("could not save what is known about %s", email, exc_info=True)
    try:
        session = await goals.attach(get_store(), session, user["id"])
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return {"access_token": accounts.token(user["id"]), "token_type": "bearer", "email": email, "new_account": created, "session": goals.public(session),
            "first_name": visitor.get("first_name") or (str(user.get("name") or "").split(" ")[0] or None)}


@router.post("/task-sessions/{session_id}/attach-user")
async def attach_user(session_id: str, user=Depends(get_current_user)):
    session = await _session(session_id)
    _mine(session, user)
    return goals.public(await goals.attach(get_store(), session, user["id"]))


@router.post("/task-sessions/{session_id}/resume")
async def resume_session(session_id: str, body: ResumeIn | None = None, user=Depends(get_current_user)):
    session = await _session(session_id)
    _mine(session, user)
    if not session.get("user_id"):
        session = await goals.attach(get_store(), session, user["id"])
    try:
        session = await goals.resume(get_store(), session, get_orchestrator(), user["id"], business_name=(body.business_name if body else None),
                                     business_id=(body.business_id if body else None))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return goals.public(session)


@router.post("/task-sessions/{session_id}/prepare")
async def prepare_session(session_id: str, user=Depends(get_current_user)):
    session = await _session(session_id)
    _mine(session, user)
    if goals.public(session)["missing"]:
        raise HTTPException(status_code=409, detail="A few details are still needed before this can be prepared.")
    try:
        session = await goals.prepare(get_store(), session, get_orchestrator(), user["id"], user.get("email"))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return goals.public(session)


@router.get("/task-sessions/{session_id}/status")
async def session_status(session_id: str):
    session = await _session(session_id)
    return {"id": session["id"], "state": session["state"], "handoff": session.get("handoff"), "problem": session.get("problem")}
