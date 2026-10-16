"""HTTP surface for goal-driven onboarding (PRD-GO-001 s18). Starting, reading and answering a
session need no account; attaching, resuming and preparing need a signed-in user."""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.modules.agent import first_value
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


AI_TURNS_PER_IP = 120      # signed-out intake turns read by the model, per address per hour; past it the rules read them


def _within(request: Request, bucket: str, limit: int) -> bool:
    """As _allow, without refusing: True while this address is under the limit (and counts this one)."""
    try:
        _allow(request, bucket=bucket, limit=limit)
        return True
    except HTTPException:
        return False


class StartIn(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    key: str | None = Field(default=None, max_length=64)                 # a homepage goal or quick task
    entry_mode: str = Field(default="free_text", max_length=20)          # business_goal | quick_task | free_text


class InputsIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    confirm: bool = False      # "that's right": accept what was read from the visitor's own sentence
    # The reply as typed, and the question it answers: read in full by the Agent's intake turn (every slot it gives a value for).
    message: str | None = Field(default=None, max_length=3000)
    asked: str | None = Field(default=None, max_length=64)
    picked: str | None = Field(default=None, max_length=200)      # a chip's words, when the answer was a chip
    # The page's own id for this message: a retry of the same message is answered once (never two bubbles, never two turns).
    client_message_id: str | None = Field(default=None, max_length=64)


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
    where: str | None = Field(default=None, max_length=20)      # "app" or "homepage": which surface it happened on (QA PF7)
    ms: int | None = Field(default=None, ge=0, le=120000)      # first_question_shown: how long it took, a number only


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
async def session_inputs(session_id: str, body: InputsIn, request: Request):
    session = await _session(session_id)
    if session["state"] == goals.ABANDONED:
        raise HTTPException(status_code=410, detail="This task has expired. Start again from the homepage.")
    # Signed out, the model reads a limited number of turns per address; past it the rules read them (the chat carries on).
    rules_only = bool(body.message) and not session.get("user_id") and not _within(request, "ai_turns", AI_TURNS_PER_IP)
    mid = body.client_message_id
    if mid and mid in (session.get("seen_message_ids") or []):
        return goals.public(session)      # the same message again (a retry): already answered
    try:
        out = await goals.add_inputs(get_store(), session, body.answers, confirm=body.confirm, message=body.message, asked=body.asked,
                                     rules_only=rules_only, picked=body.picked)
    except Exception as e:      # noqa: BLE001 - P1.8: the cause logged, then the rules read it (never a lost message)
        logger.warning("intake turn failed for session %s (%s: %s): reading it with the rules instead", session_id[:8], type(e).__name__, e, exc_info=True)
        session = await _session(session_id)      # as stored: nothing half-applied
        try:
            out = await goals.add_inputs(get_store(), session, body.answers, confirm=body.confirm, message=body.message, asked=body.asked,
                                         rules_only=True, picked=body.picked)
        except Exception as e2:      # noqa: BLE001
            logger.error("intake turn failed twice for session %s: %s: %s", session_id[:8], type(e2).__name__, e2, exc_info=True)
            raise HTTPException(status_code=503, detail={"code": "turn_failed", "message": "That didn't go through. Try again."}) from e2
    if mid:
        out["seen_message_ids"] = list(out.get("seen_message_ids") or [])[-19:] + [mid]
        await get_store().put(out)
    return goals.public(out)


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
    where = body.where if body.where in ("app", "homepage") else None
    await goals.track(get_store(), body.name, session, entry_mode=None if session else mode, goal_key=None if session else key,
                      **({"where": where} if where else {}), **({"ms": body.ms} if body.ms is not None and body.name == "first_question_shown" else {}))
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


@router.get("/task-sessions/{session_id}/first-value")
async def session_first_value(session_id: str, user=Depends(get_current_user)):
    """The free first-value result for a covered goal: a score or a check, how much of the evidence is known,
    what looks ready and what is missing. Worked out from the answers and the business's own records only; no
    model and no outside research is involved, so it is there whatever else is unavailable (PRD 5.1, SIF-03)."""
    session = await _session(session_id)
    if session.get("user_id") and session["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Not found.")
    return await _first_value_reply(session, user)


class EditAnswersIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


@router.post("/task-sessions/{session_id}/answers")
async def edit_session_answers(session_id: str, body: EditAnswersIn, user=Depends(get_current_user)):
    """Edit and run again, from the result card (the owner's QA, 15 Oct): the changed answers update the case or plan
    this request set up, the check runs again, and the new result comes back. Free: no model and no research."""
    session = await _session(session_id)
    if session.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        session = await goals.edit_answers(get_store(), session, get_orchestrator(), user["id"], body.answers, user.get("email"))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return await _first_value_reply(session, user)


async def _first_value_reply(session: dict, user: dict) -> dict:
    data = None
    if session.get("business_id"):
        try:
            data = await get_orchestrator().rt.business.load(session["business_id"])
        except Exception:      # noqa: BLE001 - the answers alone still give a result
            data = None
    result = goals.first_value_of(session, data)
    if not result:
        raise HTTPException(status_code=404, detail="This task has no first-value result.")
    plan = "explorer"
    try:
        plan = await get_orchestrator().rt.meter.plan(user["id"])
    except Exception:      # noqa: BLE001
        pass
    # The premium step: the plan is checked first, and only then credits (PRD 4.1). It is asked for only when chosen.
    result["premium_gate"] = first_value.premium_gate(result, entitled=plan != "explorer")
    from app.modules.agent import research as _research
    if session.get("goal_key") in _research.CAPABILITY:
        result["research"] = _research.research_state(data, session["goal_key"])      # which button the result shows
    # §2 (R3): the launch or funding readiness the business already has is the one shown beside it, never a second score.
    from app.modules.agent import assessment_summary
    linked = (session.get("handoff") or {}).get("subject_id")
    kind = assessment_summary.KIND_OF_GOAL.get(session.get("goal_key") or "")
    if session.get("business_id") and kind and (kind == "funding" or linked):      # P0.6b: a launch result shows only its own initiative
        result["assessment"] = await assessment_summary.current(get_orchestrator(), user["id"], session["business_id"],
                                                                assessment_summary.KIND_OF_GOAL[session["goal_key"]], user.get("email"),
                                                                subject_id=(session.get("handoff") or {}).get("subject_id"))
    await goals.track(get_store(), "first_value_shown", session)
    # What the card's "Edit answers" shows: the questions asked, with the answers given (changed there, then run again).
    editable = bool(session.get("user_id") == user["id"] and session.get("business_id"))
    return {"session_id": session["id"], "goal_key": session.get("goal_key"), "business_id": session.get("business_id"), "result": result,
            "edit": {"questions": goals.editable_questions(session), "answers": {**(session.get("proposed") or {}), **(session.get("inputs") or {})},
                     "currency": session.get("currency")} if editable else None}


@router.get("/businesses/{business_id}/first-results")
async def first_results(business_id: str, user=Depends(get_current_user)):
    """Agent Centre > Results: the latest first result of each check on this business (the dashboard's, a quick check's, or
    one updated by adopted research), newest first. Kept after it is dismissed or saved for later on the dashboard."""
    data = await _business_for(user, business_id)
    found: dict[str, dict] = {}
    for goal, rec in (data.get("quick_check_answers") or {}).items():
        if isinstance(rec, dict) and isinstance(rec.get("result"), dict):
            found[goal] = {"goal_key": goal, "at": rec.get("at"), "result": rec["result"], "adopted": None}
    for goal, versions in (data.get("assessment_datasets") or {}).items():
        full = [v for v in versions or [] if isinstance(v, dict) and isinstance(v.get("full_result"), dict)]
        if full:
            latest = max(full, key=lambda v: str(v.get("created_at") or ""))
            if str(latest.get("created_at") or "") >= str((found.get(goal) or {}).get("at") or ""):
                found[goal] = {"goal_key": goal, "at": latest.get("created_at"), "result": first_value.after_review(goal, latest["full_result"], latest),
                               "adopted": latest.get("version")}
    items = []
    for row in found.values():
        result = {**row["result"], **first_value.at_a_glance(row["result"])}
        from app.modules.agent import research as _research
        if row["goal_key"] in _research.CAPABILITY:
            result["research"] = _research.research_state(data, row["goal_key"])
        items.append({**row, "result": result, "headline": result.get("headline"), "band": result.get("band")})
    return {"items": sorted(items, key=lambda r: str(r.get("at") or ""), reverse=True)}


class QuickCheckIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    progress_key: str | None = Field(default=None, max_length=64)      # the page's key for live progress while it researches


async def _business_for(user: dict, business_id: str) -> dict:
    """The business's records, for someone who can see it (404 otherwise: nothing about it is said)."""
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001 - no access reads as not found
        raise HTTPException(status_code=404, detail="Not found.") from e
    if not getattr(actor, "can_view", False):
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        return await orch.rt.business.load(business_id) or {}
    except Exception:      # noqa: BLE001 - the answers alone still give a result
        return {}


def _quick_questions(goal_key: str, data: dict, said: dict | None = None) -> list[dict]:
    known = first_value.known_sources(goal_key, data)
    said = said or {}
    questions = []
    fields = goals.questions_for(goal_key)
    if goal_key == "launch":
        # A form, not a chat: where and when are two fields side by side; what is only kept from a chat (price, cost) is not asked.
        fields = [({**f, "label": "Where do you want to launch?"} if f["key"] == "where" else
                   {**f, "hidden": False, "label": "When do you want to launch?", "unsure": "Not decided yet", "chips": goals.WHEN_CHIPS} if f["key"] == "target_date" else f)
                  for f in fields if f["key"] not in ("price", "cost")]
    for q in fields:
        q = dict(q)
        if q["key"] in said:
            # QA P5-1: read from the owner's own words. Shown once under "From what you said", not asked again.
            q["default"], q["said"], q["said_text"] = said[q["key"]], True, goals._shown(q, said[q["key"]])
        elif q["key"] in known:
            k = known[q["key"]]
            q["default"], q["prefilled"], q["source"] = k["value"], True, k["source"]
            if k.get("proposal_id"):
                q["proposal_id"] = k["proposal_id"]      # can be saved to the profile, only if the owner says so
        questions.append(q)
    return questions


# QA PF3: each check's premium step is a research run (app/modules/agent/research.py); its plan comes from the registry.
_LAUNCH_FIELDS = (("customer", "audience"), ("where", "geography"))


async def _launch_plans(user: dict, business_id: str) -> list[dict]:
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    try:
        listed = await service_for(get_orchestrator()).list_subjects(user["id"], business_id, rr.LAUNCH, user.get("email"), include_archived=False)
    except Exception:      # noqa: BLE001 - no launch module, or not allowed: there is nothing to link
        return []
    return [x for x in (listed.get("items") or []) if x.get("status") not in ("cancelled", "archived")]


def _iso_date(value) -> str | None:
    import re as _re
    v = str(value or "").strip()
    return v if _re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else None


@router.post("/businesses/{business_id}/quick-check/launch/attach")
async def quick_check_attach(business_id: str, body: QuickCheckIn, user=Depends(get_current_user)):
    """QA E4: the launch quick check's answers go onto the launch plan (the one on record, or a new one made from
    them), into its empty fields only, and the plan is checked again, so it no longer shows 0% evidence."""
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    from app.modules.agent import answer_memory
    await _business_for(user, business_id)
    svc = service_for(get_orchestrator())
    a = body.answers or {}
    plans = await _launch_plans(user, business_id)
    # Several launches are allowed (the owner's QA, 15 Oct): the answers go onto the plan for THIS offering, or a new plan
    # (a draft) is made from them; never onto another launch's plan.
    said = " ".join(str(a.get("sell") or "").lower().split())
    norm = lambda t: " ".join(str(t or "").lower().split())      # noqa: E731
    same = [p for p in plans if said and (norm(p.get("name") or p.get("title")) == said or said in norm(p.get("name") or p.get("title")))]
    try:
        if same:
            plan = same[0]
            full = await svc.get_subject(user["id"], business_id, rr.LAUNCH, plan["id"], user.get("email"))
            current = (full.get("data") or full) if isinstance(full, dict) else {}
            changes = {field: str(a[key]).strip() for key, field in _LAUNCH_FIELDS if str(a.get(key) or "").strip() and not current.get(field)}
            if str(a.get("customer") or "").strip() and not (current.get("customers") or {}).get("target_segment"):
                changes["customers"] = {"target_segment": str(a["customer"]).strip()}      # the demand check reads it here (C1.A)
            when = answer_memory.target_date_from(a.get("target_date"), _today())
            if when and not current.get("target_date"):
                changes["target_date"] = when
            if changes:
                await svc.update_subject(user["id"], business_id, rr.LAUNCH, plan["id"], full.get("revision"), changes, user.get("email"))
            made, subject_id, title = False, plan["id"], plan.get("name") or plan.get("title")
        else:
            payload = {"name": (str(a.get("sell") or "My launch").strip())[:80], "scope": "commercial",
                       **({"customers": {"target_segment": str(a["customer"]).strip()}} if str(a.get("customer") or "").strip() else {}),
                       **{field: str(a[key]).strip() for key, field in _LAUNCH_FIELDS if str(a.get(key) or "").strip()},
                       **({"target_date": when} if (when := answer_memory.target_date_from(a.get("target_date"), _today())) else {})}
            created = await svc.create_subject(user["id"], business_id, rr.LAUNCH, payload, user.get("email"))
            made, subject_id, title = True, created.get("id"), payload["name"]
        evidence = await _attach_demand_evidence(svc, user, business_id, subject_id, a)
        try:
            await svc.request_assessment(user["id"], business_id, rr.LAUNCH, subject_id, idempotency_key=f"quick-check:{subject_id}:{len(str(a))}", email=user.get("email"))
        except Exception:      # noqa: BLE001 - the plan is saved; it is checked from its own page
            logger.info("quick check: the launch plan %s was not re-checked", subject_id)
    except HTTPException:
        raise
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=409, detail="Your launch plan couldn't be updated just now. Nothing was changed.") from e
    # Said plainly: what the plan's own demand check still needs before this evidence counts (never filled in for them).
    still = [] if not evidence else ["The problem it solves for your customers (on the plan's Customers and offer section)"]
    return {"initiative_id": subject_id, "created": made, "title": title, "to": f"/launch/{subject_id}", "evidence_id": evidence,
            "target_date": None if not (when := answer_memory.target_date_from(a.get("target_date"), _today())) else when, "still_needed": still}


def _today():
    """The business's own today (the clock the readiness checks use), so evidence is never "in the future"."""
    try:
        return get_orchestrator().rt.clock().date()
    except Exception:      # noqa: BLE001
        return datetime.now(timezone.utc).date()


# The demand ladder's rungs as the readiness module's evidence types.
_EVIDENCE_TYPE = {"paid_pilot": "pilot", "paying_customers": "sale", "repeat_paying_customers": "sale", "LOIs": "letter_of_intent",
                  "enquiries": "enquiry", "market_research": "research"}


async def _attach_demand_evidence(svc, user: dict, business_id: str, subject_id: str, a: dict) -> str | None:
    """QA PF5: the quick check's demand evidence ("5 neighbours booked a paid trial clean") goes on the launch plan as a
    dated evidence item, linked to its demand check, unverified until the owner reviews it."""
    from app.modules.readiness import rules as rr
    said = str(a.get("evidence") or "").strip()
    if not first_value._known(said) or said.lower() in ("none", "no", "nothing yet", "not yet", "none yet"):
        return None
    level = first_value.demand_level(said)
    try:
        made = await svc.add_evidence(user["id"], business_id, {
            "title": f"{level[1] if level else 'Demand evidence'} (from your launch quick check)", "type": _EVIDENCE_TYPE.get(level[0] if level else "", "other"),
            "claim": said[:1000], "source": {"kind": "note", "reference": "Said in your launch quick check"},
            "effective_date": _today().isoformat(), "links": [{"subject_id": subject_id, "check": "C1.A"}]},
            user.get("email"), feature=rr.LAUNCH)
        return made.get("id")
    except Exception:      # noqa: BLE001 - the plan is updated either way; the evidence can be added on its page
        logger.info("quick check: demand evidence not added to launch plan %s", subject_id, exc_info=True)
        return None


async def _premium_context(user: dict, business_id: str, goal_key: str, raw: dict | None) -> tuple:
    from app.modules.agent import research
    if goal_key not in research.CAPABILITY:
        raise HTTPException(status_code=404, detail="This check has no premium step yet.")
    data = await _business_for(user, business_id)
    answers = {**first_value.known_answers(goal_key, data), **_read_answers(goal_key, raw)}
    return data, answers, first_value.assess(goal_key, answers, data)


async def _premium_quote(user: dict, goal_key: str, result: dict, answers: dict | None = None, data: dict | None = None) -> dict:
    """QA PF1/PF3: entitlement first (the registry's plan for what the research stands for, admin grants included),
    then the cost, then what will be researched. Nothing has started; nothing is charged."""
    from app.modules.agent import config as agent_config, research
    orch = get_orchestrator()
    capability = research.CAPABILITY[goal_key]
    plan = await orch.rt.meter.plan(user["id"])
    i = research.inputs_of(goal_key, answers or {}, data)
    topics, items, waiting = research.plan_run(goal_key, result, i, research.context_of(data, i))
    link = research.health()
    # QA R7-1: said before it starts: what will be researched, worked out and asked, and whether research is connected.
    base = {"capability": capability, "label": result["premium_next_action"]["label"], "blockers": len(result["blockers"]),
            "action": research.ACTION_NAME.get(goal_key, result["premium_next_action"]["label"]), "variable": True,
            "topics": [t["label"] for t in topics], "connected": link["connected"],
            # What the research is looking at, said while it works ("grants for a small transport business in the UK").
            "looking_at": research.looking_at(topics, research.context_of(data, i)),
            "not_connected": None if link["connected"] or not topics else
            "Research isn't available right now. What I can work out from your figures still will be, and nothing is charged.",
            "plan": {"research": sum(1 for t in topics if not t.get("number")) if link["connected"] else 0,
                     "estimate": sum(1 for t in topics if t.get("number")) if link["connected"] else 0,
                     "worked_out": len(waiting), "asked": len(items)}}
    # The same research within 30 days is opened again, free: no quote, no hold, no charge (the owner's QA, 15 Oct).
    fp = research.fingerprint_of(answers or {}, {k: v for k, v in i.items() if not k.startswith("_")}, [t["topic"] for t in topics],
                                 research.context_of(data, i).get("country"))
    again = research.reusable(data, goal_key, fp)
    if again:
        return {**base, "allowed": True, "reuse": again["id"], "cost": 0, "max": 0, "balance": None,
                "existing": {"at": again["created_at"][:10], "findings": (again.get("counts") or {}).get("researched", 0)}}
    if not agent_config.plan_allows(plan, capability):
        need = agent_config.CAPABILITY_MIN_PLAN.get(capability) or "starter_insight"
        return {**base, "allowed": False, "gate": first_value.premium_gate(result, entitled=False, feature=base["action"],
                                                                         plan=agent_config.PLAN_LABEL.get(need, need)),
                "refusal": {"minimum_plan": need, "minimum_plan_label": agent_config.PLAN_LABEL.get(need, need)}}
    # One price for the run, the check's own on the price list (credit allocation v2); charged only when it finds something
    # with a checked source. What is worked out from the owner's figures, and every question, is free (Credit System v2 §6).
    price = await orch.rt.meter.cost(research.feature_of(goal_key)) if (topics and link["connected"]) else 0
    balance = await orch.rt.meter.balance(user["id"])
    if price and balance is not None and balance < price:
        return {**base, "allowed": False, "cost": price, "max": price, "balance": balance,
                "gate": first_value.premium_gate(result, entitled=True, credits=balance, cost=price)}
    return {**base, "allowed": True, "cost": price, "max": price, "per_finding": research.per_finding(price, len(topics)), "balance": balance,
            "after": None if balance is None else balance - price}


@router.post("/businesses/{business_id}/quick-check/{goal_key}/premium/quote")
async def quick_check_premium_quote(business_id: str, goal_key: str, body: QuickCheckIn, user=Depends(get_current_user)):
    """What the premium step would do and cost, before it starts (PRD 4.1, 12.3)."""
    data, answers, result = await _premium_context(user, business_id, goal_key, body.answers)
    return await _premium_quote(user, goal_key, result, answers, data)


@router.post("/businesses/{business_id}/quick-check/{goal_key}/premium")
async def quick_check_premium(business_id: str, goal_key: str, body: QuickCheckIn, user=Depends(get_current_user)):
    """QA PF3: the premium step for real. The plan, then credits; then the research run for this check's missing
    evidence, with the check's answers and what is on record. It returns the run, to review in place.
    "Find my best price" is research too, never a Price Test (that needs three months of revenue)."""
    from app.modules.agent import research
    data, answers, result = await _premium_context(user, business_id, goal_key, body.answers)
    quote = await _premium_quote(user, goal_key, result, answers, data)
    if not quote["allowed"]:
        return {"started": False, "gate": quote["gate"], "quote": quote}
    run = await research.start(get_orchestrator(), user=user, business_id=business_id, goal=goal_key, answers=answers, data=data,
                               progress_key=body.progress_key)
    run = {**run, "balance": await get_orchestrator().rt.meter.balance(user["id"])}
    await goals.track(get_store(), "premium_started", {"id": run["id"], "goal_key": goal_key, "events": []})
    return {"started": True, "research": run, "quote": quote, "run_id": run["id"], "capability": quote["capability"]}


async def _session_premium_context(session_id: str, user: dict) -> tuple:
    """A homepage task's first-value premium step (the card on the start page and the dashboard): the same research,
    from the answers the task was given and its business. Only the account the task belongs to."""
    session = await _session(session_id)
    if not session.get("user_id") or session["user_id"] != user["id"] or not session.get("business_id"):
        raise HTTPException(status_code=404, detail="Not found.")
    goal = session.get("goal_key")
    from app.modules.agent import research
    if goal not in research.CAPABILITY:
        raise HTTPException(status_code=404, detail="This task has no premium step.")
    raw = {**(session.get("proposed") or {}), **(session.get("inputs") or {})}
    data, answers, result = await _premium_context(user, session["business_id"], goal, raw)
    return session, goal, data, answers, result


@router.post("/task-sessions/{session_id}/premium/quote")
async def session_premium_quote(session_id: str, user=Depends(get_current_user)):
    _s, goal, data, answers, result = await _session_premium_context(session_id, user)
    return await _premium_quote(user, goal, result, answers, data)


@router.post("/task-sessions/{session_id}/premium")
async def session_premium(session_id: str, body: QuickCheckIn | None = None, user=Depends(get_current_user)):
    from app.modules.agent import research
    session, goal, data, answers, result = await _session_premium_context(session_id, user)
    quote = await _premium_quote(user, goal, result, answers, data)
    if not quote["allowed"]:
        return {"started": False, "gate": quote["gate"], "quote": quote}
    run = await research.start(get_orchestrator(), user=user, business_id=session["business_id"], goal=goal, answers=answers, data=data,
                               progress_key=body.progress_key if body else None)
    run = {**run, "balance": await get_orchestrator().rt.meter.balance(user["id"])}
    return {"started": True, "research": run, "quote": quote, "run_id": run["id"], "capability": quote["capability"], "business_id": session["business_id"]}


class ResearchReview(BaseModel):
    decisions: dict[str, dict] = Field(default_factory=dict)      # {item id: {"decision": "accept"|"edit"|"reject", "value"?}}


class CaseEditIn(BaseModel):
    changes: dict[str, Any] = Field(default_factory=dict)


_FIX = {"G1": ("Confirm the amount and date", "goal"), "G2": ("Fix allocations", "finances"), "G3": ("Complete the forecast", "finances"),
        "G4": ("Resolve the document figures", "documents")}


@router.post("/businesses/{business_id}/funding-cases/{case_id}/agent-edit")
async def agent_edit_case(business_id: str, case_id: str, body: CaseEditIn, user=Depends(get_current_user)):
    """[Yes, update] on the Agent's confirm: the change written to the case ("Changed via Agent"), the check run again (free),
    and the reply: "Updated. Score 55 → 42.5. 1 blocker: Allocations reconcile to the target." [Fix allocations] [Open funding case]."""
    from app.modules.agent import case_edit
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    allowed = {"target_amount", "receipt_date", "route_preference", "purpose", "currency", "stage"}
    changes = {k: v for k, v in (body.changes or {}).items() if k in allowed}
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    svc = service_for(get_orchestrator())
    row = await svc.store.get("subjects", case_id)
    if not row or row.get("business_id") != business_id or row.get("kind") != rr.FUNDING:
        raise HTTPException(status_code=404, detail="Not found.")
    before = (await svc.get_subject(user["id"], business_id, rr.FUNDING, case_id, user.get("email")))["summary"]
    await svc.update_subject(user["id"], business_id, rr.FUNDING, case_id, row["revision"], changes, user.get("email"),
                             provenance=case_edit.provenance(changes))
    fresh = await svc.store.get("subjects", case_id)
    checked = await svc.request_assessment(user["id"], business_id, rr.FUNDING, case_id, idempotency_key=f"agent-edit:{case_id}:{fresh['revision']}",
                                           email=user.get("email"))
    result = checked.get("result") or {}
    after = result.get("score_display")
    failed = [g for g in result.get("gates") or [] if g.get("state") == "failed"]
    score = (f"Score {before.get('score') or 'not scored'} → {after or 'not scored'}." if after is not None or before.get("score")
             else f"Checked again: {str(result.get('headline') or 'not enough evidence for a score yet').rstrip('.')}.")
    said = (f" {len(failed)} blocker{'s' if len(failed) != 1 else ''}: {failed[0]['label']}." if failed else " No blockers.")
    to = f"/funding/{case_id}"
    actions = [{"label": _FIX[g["code"]][0], "to": f"{to}?tab=setup&section={_FIX[g['code']][1]}"} for g in failed[:1] if g.get("code") in _FIX]
    return {"kind": "answer", "message": f"Updated. {score}{said}".replace("  ", " ").strip(),
            "actions": actions + [{"label": "Open funding case", "to": f"{to}?tab=results"}], "assessment_id": checked.get("id")}


@router.get("/businesses/{business_id}/pinned")
async def pinned_cards(business_id: str, user=Depends(get_current_user)):
    """P1.14: what the owner pinned to the dashboard (a funding case, launch plans), live: title, score, verdict, coverage,
    the pack count, and where to open it. Stored on the record itself (per workspace), at most three shown."""
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    await _business_for(user, business_id)
    svc = service_for(get_orchestrator())
    out = []
    for kind in (rr.FUNDING, rr.LAUNCH):
        listed = await svc.list_subjects(user["id"], business_id, kind, user.get("email"), include_archived=False)
        for item in listed.get("items") or []:
            if not item.get("pinned"):
                continue
            summary = item.get("summary") or {}
            base = f"/{'funding' if kind == rr.FUNDING else 'launch'}/{item['id']}"
            cls = summary.get("classification")
            verdict = None
            if kind == rr.FUNDING:
                verdict = "Ready to approach funders" if cls == "ready" else "Not ready to approach funders yet"
            elif cls:
                verdict = "Ready to launch" if cls == "ready" else "Not enough evidence to judge the launch yet" if cls == "insufficient_evidence" else "Not ready to launch yet"
            out.append({"id": item["id"], "kind": "funding" if kind == rr.FUNDING else "launch",
                        "label": f"{'Funding readiness' if kind == rr.FUNDING else 'Launch readiness'} · {item.get('title')}",
                        "score": summary.get("score"), "classification": cls, "verdict": verdict, "coverage": summary.get("evidence_coverage") or summary.get("coverage"),
                        "pack": summary.get("pack"), "blockers": summary.get("blockers") or [], "open": f"{base}?tab=results", "updated_at": item.get("updated_at")})
    out.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    # All of them (up to 20): the dashboard leaves out the one already shown as the result card, then shows three.
    return {"items": out[:20], "more": max(0, len(out) - 3)}


@router.post("/businesses/{business_id}/pinned/{subject_id}/{action}")
async def set_pinned(business_id: str, subject_id: str, action: str, user=Depends(get_current_user)):
    """Unpin (or pin again, for Undo) from the dashboard card."""
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    if action not in ("pin", "unpin"):
        raise HTTPException(status_code=404, detail="Not found.")
    await _business_for(user, business_id)
    svc = service_for(get_orchestrator())
    row = await svc.store.get("subjects", subject_id)
    if not row or row.get("business_id") != business_id:
        raise HTTPException(status_code=404, detail="Not found.")
    await svc.update_subject(user["id"], business_id, row["kind"], subject_id, row["revision"], {"pinned": action == "pin"}, user.get("email"))
    return {"ok": True, "pinned": action == "pin"}


class DraftDecisionIn(BaseModel):
    decision: str = Field(..., pattern="^(accept|reject)$")


@router.post("/businesses/{business_id}/agent-drafts/{draft_id}/decide")
async def decide_draft(business_id: str, draft_id: str, body: DraftDecisionIn, user=Depends(get_current_user)):
    """[Accept] or [Reject] in the draft's header: the draft leaves Needs Approval, and the task that made it reads Done."""
    from app.modules.agent import drafts
    await _business_for(user, business_id)
    orch = get_orchestrator()
    d = await orch.rt.business.mutate(business_id, lambda data: drafts.decide(data, draft_id, body.decision))
    if not d:
        raise HTTPException(status_code=404, detail="Not found.")
    if d.get("run_id"):
        r = await orch.rt.store.get_run(d["run_id"])
        if r:
            state = {**(r.get("state") or {}), "draft": {"id": d["id"], "status": d["status"]}}
            await orch.rt.store.update_run(r["id"], {"state": state})
    return {"draft": d, "message": "Accepted." if body.decision == "accept" else "Rejected. Nothing else was changed."}


class ConflictIn(BaseModel):
    choice: str = Field(..., pattern="^(update|keep|task|other|set:[A-Za-z .'-]{2,60})$")


@router.get("/businesses/{business_id}/profile/updates")
async def profile_updates(business_id: str, user=Depends(get_current_user)):
    """What the Agent added to the business profile ("I added your country, city and target customer…") and the
    conflicts waiting for one answer each."""
    from app.modules.agent import profile_fill
    data = await _business_for(user, business_id)
    filled = data.get("profile_filled") or {}
    conflicts = [c for c in data.get("profile_conflicts") or [] if not c.get("resolved")]
    asked = profile_fill.country_question(data)
    return {"filled": filled.get("fields") or [], "message": profile_fill.told(filled.get("fields") or [], data), "source": filled.get("source"),
            "provenance": data.get("profile_provenance") or {},
            "conflicts": [{**c, "question": profile_fill.question(c), "options": profile_fill.options(c)} for c in conflicts] + ([asked] if asked else []),
            "currency_set": (filled.get("fields") or []) == ["currency"]}


@router.post("/businesses/{business_id}/profile/updates/seen")
async def profile_updates_seen(business_id: str, user=Depends(get_current_user)):
    await _business_for(user, business_id)
    await get_orchestrator().rt.business.mutate(business_id, lambda d: d.pop("profile_filled", None))
    return {"ok": True}


@router.post("/businesses/{business_id}/profile/keep/{field}")
async def profile_keep(business_id: str, field: str, user=Depends(get_current_user)):
    """[Keep] one field (or "all": Keep all, or the panel's X): the value accepted, its hint gone."""
    from app.modules.agent import profile_fill
    await _business_for(user, business_id)
    done = await get_orchestrator().rt.business.mutate(business_id, lambda d: profile_fill.keep(d, field))
    return {"kept": bool(done)}


@router.post("/businesses/{business_id}/profile/redo/{field}")
async def profile_redo(business_id: str, field: str, user=Depends(get_current_user)):
    """[Redo] on "Removed": the value put back."""
    from app.modules.agent import profile_fill
    await _business_for(user, business_id)
    done = await get_orchestrator().rt.business.mutate(business_id, lambda d: profile_fill.redo(d, field))
    return {"redone": bool(done)}


@router.post("/businesses/{business_id}/profile/undo/{field}")
async def profile_undo(business_id: str, field: str, user=Depends(get_current_user)):
    from app.modules.agent import profile_fill
    await _business_for(user, business_id)
    done = await get_orchestrator().rt.business.mutate(business_id, lambda d: profile_fill.undo(d, field))
    return {"undone": bool(done)}


@router.post("/businesses/{business_id}/profile/conflicts/{field}")
async def profile_conflict(business_id: str, field: str, body: ConflictIn, user=Depends(get_current_user)):
    from app.modules.agent import profile_fill
    await _business_for(user, business_id)
    done = await get_orchestrator().rt.business.mutate(business_id, lambda d: profile_fill.resolve(d, field, body.choice))
    return {"resolved": bool(done)}


@router.get("/research-progress/{key}")
async def research_progress(key: str, user=Depends(get_current_user)):
    """While a run researches: each topic's state and sources so far ("Looking at grants in {country}… 4 sources found").
    The key is the page's own random one; nothing about a business is said beyond the topic labels."""
    from app.modules.agent import research
    p = research.PROGRESS.get(key) or {}
    return {"stage": p.get("stage"), "topics": [{"label": v.get("label"), "state": v.get("state"), "sources": v.get("sources", 0)}
                                                for v in (p.get("topics") or {}).values()]}


@router.get("/businesses/{business_id}/research-runs")
async def research_runs(business_id: str, goal: str | None = None, user=Depends(get_current_user)):
    """The saved research for a check (the funding case's Research tab): each run's date, findings and review state, free
    to open at any time."""
    data = await _business_for(user, business_id)
    runs = [r for r in (data.get("research_runs") or {}).values() if isinstance(r, dict) and (not goal or r.get("goal") == goal)
            and r.get("status") in ("review", "adopted")]
    return {"runs": [{"id": r["id"], "goal": r.get("goal"), "created_at": r.get("created_at"), "status": r.get("status"), "counts": r.get("counts"),
                      "findings": sum(1 for x in r.get("items") or [] if x.get("sources")), "charged": r.get("charged", 0)}
                     for r in sorted(runs, key=lambda r: r.get("created_at") or "", reverse=True)]}


@router.get("/businesses/{business_id}/research/{run_id}")
async def research_run(business_id: str, run_id: str, user=Depends(get_current_user)):
    data = await _business_for(user, business_id)
    run = (data.get("research_runs") or {}).get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Not found.")
    return {"research": run}


@router.post("/businesses/{business_id}/research/{run_id}/review")
async def research_review(business_id: str, run_id: str, body: ResearchReview, user=Depends(get_current_user)):
    """Accept, edit or reject each item; the accepted ones become the check's next dataset version, and the
    deterministic engine is run again on it. Returns the before and after."""
    from app.modules.agent import research
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=404, detail="Not found.") from e
    if not (getattr(actor, "is_owner", False) or getattr(actor, "can_prepare", False)):
        raise HTTPException(status_code=403, detail="Only someone who can edit this business can adopt research.")
    try:
        out = await research.review(orch, user=user, business_id=business_id, run_id=run_id, decisions=body.decisions)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Not found.") from e
    except ValueError as e:
        raise HTTPException(status_code=409, detail="This research has already been reviewed, or has nothing to review.") from e
    # §2 (R3): a launch or funding review feeds the one assessment, and what the page shows is that assessment's summary.
    from app.modules.agent import assessment_summary
    goal = (out.get("goal") or "")
    if goal in assessment_summary.KIND_OF_GOAL:
        inputs = ((((await orch.rt.business.load(business_id)).get("assessment_datasets") or {}).get(goal) or [{}])[-1]).get("inputs") or {}
        accepted = [x for x in out.get("items") or [] if x.get("decision") in ("accepted", "edited") and x.get("kind") == "researched"]
        summary = await assessment_summary.feed(orch, user, business_id, goal, inputs, out.get("answers") or {}, f"review:{run_id}:{out.get('dataset_version')}",
                                                research=accepted)
        out["assessment"] = summary

        def _keep(d: dict) -> None:
            (research._runs(d).get(run_id) or {})["assessment"] = summary
        await orch.rt.business.mutate(business_id, _keep)
    return {"research": {k: v for k, v in out.items() if k != "result"}, "result": out["result"], "assessment": out.get("assessment")}


class UseFigures(BaseModel):
    figures: dict[str, float] = Field(default_factory=dict)      # {"price": 65}: the review's figures the owner chose


@router.post("/businesses/{business_id}/assessment/{kind}/use-figures")
async def use_review_figures(business_id: str, kind: str, body: UseFigures, user=Depends(get_current_user)):
    """R2: where the launch plan or funding case already held a different figure, the owner chose the review's: it is
    updated and checked again. The readiness module checks that they may edit it."""
    from app.modules.agent import assessment_summary
    if kind not in ("launch", "funding"):
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        summary = await assessment_summary.use_figures(get_orchestrator(), user, business_id, kind, body.figures,
                                                       f"use-figures:{uuid.uuid4().hex[:12]}")
    except Exception as e:      # noqa: BLE001 - no access or no case: said plainly
        raise HTTPException(status_code=409, detail="That couldn't be updated just now. Nothing was changed.") from e
    if summary is None:
        raise HTTPException(status_code=404, detail="There's no case to update.")
    return {"assessment": summary}


class RecordChoice(BaseModel):
    field: str = Field(max_length=40)
    choice: str = Field(pattern="^(update|case_only)$")


@router.post("/businesses/{business_id}/research/{run_id}/record-choice")
async def research_record_choice(business_id: str, run_id: str, body: RecordChoice, user=Depends(get_current_user)):
    """§1: an accepted value differs from the business's own record. "update" writes the record (write permission needed,
    logged, with Undo); "case_only" keeps the record as it is and uses the value for this case only."""
    from app.modules.agent import record_sync, research
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=404, detail="Not found.") from e
    if body.choice == "update" and not (getattr(actor, "is_owner", False) or getattr(actor, "can_prepare", False)):
        raise HTTPException(status_code=403, detail="Updating the Catalogue needs permission to edit this business. It is used for this case only.")
    now = orch.rt.clock().isoformat()
    out: dict = {}

    def _apply(d: dict) -> None:
        run = research._runs(d).get(run_id) or {}
        conflict = next((c for c in (run.get("record_sync") or {}).get("conflicts") or [] if c.get("field") == body.field and not c.get("choice")), None)
        if not conflict:
            raise KeyError(body.field)
        out.update(record_sync.choose(d, conflict, body.choice, now, user["id"]))
    try:
        await orch.rt.business.mutate(business_id, _apply)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="There is nothing to decide for that figure.") from e
    await orch.rt.store.audit({"id": uuid.uuid4().hex, "business_id": business_id, "run_id": None, "actor_id": user["id"], "event_type": "record_choice",
                               "detail": {"research_run": run_id, "field": body.field, "choice": body.choice}, "created_at": now})
    return out


@router.post("/businesses/{business_id}/record-changes/{change_id}/undo")
async def undo_record_change(business_id: str, change_id: str, user=Depends(get_current_user)):
    """§1: Undo a value saved to the business's own record from a review: the field goes back as it was, and it is logged."""
    from app.modules.agent import record_sync
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=404, detail="Not found.") from e
    if not (getattr(actor, "is_owner", False) or getattr(actor, "can_prepare", False)):
        raise HTTPException(status_code=403, detail="Only someone who can edit this business can undo this.")
    now = orch.rt.clock().isoformat()
    out: dict = {}

    def _apply(d: dict) -> None:
        out.update(record_sync.undo(d, change_id, now, user["id"]))
    try:
        await orch.rt.business.mutate(business_id, _apply)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Not found.") from e
    await orch.rt.store.audit({"id": uuid.uuid4().hex, "business_id": business_id, "run_id": None, "actor_id": user["id"], "event_type": "record_change_undone",
                               "detail": {"change_id": change_id, **out}, "created_at": now})
    return out


class ProposalDecision(BaseModel):
    confirm: bool


@router.post("/businesses/{business_id}/profile-proposals/{proposal_id}")
async def decide_profile_proposal(business_id: str, proposal_id: str, body: ProposalDecision, user=Depends(get_current_user)):
    """Save a proposed value to the company profile (with where it came from), or dismiss it. Nothing else writes it (QA R1)."""
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001
        raise HTTPException(status_code=404, detail="Not found.") from e
    if not (getattr(actor, "is_owner", False) or getattr(actor, "can_prepare", False)):
        raise HTTPException(status_code=403, detail="Only someone who can edit this business can change its profile.")
    from app.modules.agent import profile_proposals
    decided: dict = {}

    def _apply(d: dict) -> None:
        decided.update(profile_proposals.decide(d, proposal_id, confirm=body.confirm, user_id=user["id"]))
    try:
        await orch.rt.business.mutate(business_id, _apply)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="That suggestion is no longer waiting.") from e
    return {"proposal": decided}


def _read_answers(goal_key: str, raw: dict | None) -> dict:
    """QA H: the quick check's answers, read by the shared normalisers: "about sixty" is 60, "£45 per groom" is 45,
    "not sure" stays an answer ("unknown"). Only the check's own questions; nothing read that isn't there."""
    from app.modules.agent import understanding as und
    kinds = {q["key"]: q.get("type") for q in goals.questions_for(goal_key)}
    out = {}
    for k, v in (raw or {}).items():
        if k not in kinds or v in (None, ""):
            continue
        if isinstance(v, str) and und.is_unsure(v):
            out[k] = "unknown"
        elif kinds[k] == "number" and isinstance(v, str):
            read = und.vat_of(v) if k == "vat_rate" else und.number_of(v)
            if read is not None:
                out[k] = read
        else:
            out[k] = v
    return out


def _read_said(said: str, goal_key: str, read: dict) -> dict:
    """The owner's whole sentence read by the shared intake reader too (P1.10): every figure ("₦15,000 per wash", "it costs
    me 6,000", "about 120 a month") and, from its first clause, the idea, who it is for and where ("a mobile car wash in
    Abuja for office workers"). Only what was plainly said; the rest is asked."""
    import re as _re
    from app.modules.agent import intake_turn, said as _said
    slots = goals.questions_for(goal_key)
    keys = {q["key"] for q in slots}
    for k, v in intake_turn.rule_read(said, slots, None).items():
        value = v.get("normalized") if v.get("normalized") is not None else v.get("value")
        if k in keys and value not in (None, "") and k not in ("description", "sell"):
            read[k] = value
    clause = _re.split(r",|\.\s|;", said.split(":", 1)[-1])[0].strip()
    who = _re.search(r"\bfor\s+([a-z][\w\s'-]{2,60}?)\s*$", clause, _re.I)
    where = _re.search(r"\b(?:in|around|based in)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)", clause)
    if "customer" in keys and who and not read.get("customer"):
        read["customer"] = who.group(1).strip()
    if "where" in keys and where and not read.get("where"):
        read["where"] = where.group(1)
    idea = _said.idea_in(said) or clause
    if "," in idea or len(idea) > len(clause) + 20:
        idea = clause      # only the idea itself: the figures after it are answers of their own
    if idea:
        idea = _re.sub(r"\s+for\s+[a-z][\w\s'-]{2,60}$", "", idea, flags=_re.I)
        idea = _re.sub(r"\s+(?:in|around|based in)\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?", "", idea).strip(" ,.")
        idea = _re.sub(r"^(?:please\s+)?(?:help me\s+|can you\s+)?(?:i\s+(?:want|need|would like)\s+to\s+)?(?:launch|start|validate|test|check|open|run|price)\s+", "", idea, flags=_re.I)
        idea = _re.sub(r"^(?:a|an|my|our|the)\s+", "", idea, flags=_re.I)
        for k in ("description", "sell"):
            if k in keys and (not read.get(k) or len(str(read[k])) > 80):
                read[k] = idea[:1].upper() + idea[1:]
    return read


@router.get("/businesses/{business_id}/quick-check/{goal_key}")
async def quick_check_questions(business_id: str, goal_key: str, said: str | None = Query(default=None, max_length=1000),
                                user=Depends(get_current_user)):
    """In the app: the short first-value conversation for Launch, Funding, Pricing or Customer Growth,
    with what the Company already holds filled in (QA P1-7, First-Value PRD 8, SIF-01/02)."""
    if not first_value.covered(goal_key):
        raise HTTPException(status_code=404, detail="No quick check for that.")
    data = await _business_for(user, business_id)
    kind = first_value.ASSESSMENT_OF[goal_key]
    # The owner's own sentence, when they started here from one: read by the same readers as the homepage (QA P5-1).
    read = _read_said(said, goal_key, {**(await goals.understood_answers(said, goal_key)), **goals.extract(said, goal_key)}) if said and said.strip() else {}
    # QA R8-8: the latest result for this check (and offering), shown on return instead of asking the questions again.
    last = (data.get("quick_check_answers") or {}).get(goal_key) or {}
    return {"goal_key": goal_key, "headline": first_value.HEADLINE[kind], "value": goals.value_of(goal_key),
            "questions": _quick_questions(goal_key, data, read),
            "last": ({"result": last["result"], "answers": last.get("answers") or {}, "at": last.get("at")} if last.get("result") and not said else None)}


@router.post("/businesses/{business_id}/quick-check/{goal_key}")
async def quick_check_result(business_id: str, goal_key: str, body: QuickCheckIn, user=Depends(get_current_user)):
    """The provisional, deterministic result: score, evidence coverage, strengths and blockers, the premium
    next action and the free ones. No model, no credits. The premium step checks the plan before credits."""
    if not first_value.covered(goal_key):
        raise HTTPException(status_code=404, detail="No quick check for that.")
    data = await _business_for(user, business_id)
    allowed = {q["key"] for q in goals.questions_for(goal_key)}
    answers = {**first_value.known_answers(goal_key, data), **_read_answers(goal_key, body.answers)}
    # Nothing here changes the company's records (QA R1): the answers are this check's own. They are kept, with the
    # offering they are about, so the next check and the launch plan start from them (QA PF5); the profile is untouched.
    result = first_value.assess(goal_key, answers, data)
    try:
        from app.modules.agent import answer_memory
        from app.modules.agent import business as _bz
        from app.modules.agent import profile_fill

        def _keep(d):
            answer_memory.remember(d, goal_key, answers, result=result, currency=_bz.currency_of(d))
            profile_fill.fill(d, answers, goal_key)      # the profile's empty fields, from what was said (P0.4)
        await get_orchestrator().rt.business.mutate(business_id, _keep)
        goals._brand_later(get_orchestrator(), business_id, user["id"])
    except Exception:      # noqa: BLE001 - the result stands; the next check simply asks again
        logger.info("quick check: answers for %s not kept", goal_key)
    plan, credits = "explorer", None
    try:
        plan = await get_orchestrator().rt.meter.plan(user["id"])
        credits = await get_orchestrator().rt.meter.balance(user["id"])
    except Exception:      # noqa: BLE001
        pass
    result["premium_gate"] = first_value.premium_gate(result, entitled=plan != "explorer", credits=credits if plan != "explorer" else None)
    # §2/§3: the quick check's own score is provisional; where the full assessment exists, its summary is what is shown.
    result["provisional"] = True
    from app.modules.agent import research as _research
    if goal_key in _research.CAPABILITY:
        result["research"] = _research.research_state(data, goal_key, answers=answers)
    from app.modules.agent import assessment_summary
    if assessment_summary.KIND_OF_GOAL.get(goal_key) == "funding":
        # P0.6b: the business's one funding case is this need's; a launch quick check is about a launch not set up yet, so it
        # is never shown with another initiative's full check (several launches are allowed).
        result["assessment"] = await assessment_summary.current(get_orchestrator(), user["id"], business_id, "funding", user.get("email"))
    return {"goal_key": goal_key, "result": result}


class CatalogueItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_price: float | None = Field(default=None, ge=0)
    cost_of_sales: float | None = Field(default=None, ge=0)


@router.post("/businesses/{business_id}/catalogue/from-check")
async def catalogue_from_check(business_id: str, body: CatalogueItemIn, user=Depends(get_current_user)):
    """A check's "Save the price in your catalogue" / "Add it to your catalogue": the offering it was about, with its
    price and cost when given, saved in one press. An item of the same name is updated, never duplicated."""
    orch = get_orchestrator()
    try:
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
    except Exception as e:      # noqa: BLE001 - no access reads as not found
        raise HTTPException(status_code=404, detail="Not found.") from e
    if not getattr(actor, "can_prepare", False):
        raise HTTPException(status_code=403, detail="You can't change this workspace's catalogue.")
    from app.modules.agent import answer_memory
    name, now = body.name.strip(), datetime.now(timezone.utc).isoformat()
    saved: dict = {}

    def _put(d: dict) -> None:
        products = d.setdefault("catalogue", {}).setdefault("products", [])
        item = next((p for p in products if isinstance(p, dict) and not p.get("archived") and answer_memory.norm(p.get("name")) == answer_memory.norm(name)), None)
        if item is None:
            item = {"id": str(uuid4()), "name": name, "type": "service", "description": "", "base_price": 0, "cost_of_sales": 0, "discount": 0,
                    "freight_cost": 0, "marketplace_listed": True, "archived": False, "created_at": now}
            products.insert(0, item)
            saved["created"] = True
        if body.base_price is not None:
            item["base_price"] = body.base_price
        if body.cost_of_sales is not None:
            item["cost_of_sales"] = body.cost_of_sales
        item["updated_at"] = now
        saved["product"] = dict(item)
    await orch.rt.business.mutate(business_id, _put)
    p = saved.get("product") or {}
    return {"saved": True, "created": bool(saved.get("created")), "product": p,
            "message": f"{'Added' if saved.get('created') else 'Updated'} in your catalogue: {p.get('name') or name}."
                       + ("" if p.get("base_price") else " Add its price in Catalogue so it can go on quotes and invoices."),
            "actions": [{"label": "Open catalogue", "to": "/catalogue"}]}


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


class PrepareIn(BaseModel):
    confirmed: bool = False      # the price was shown and Start pressed


@router.post("/task-sessions/{session_id}/prepare")
async def prepare_session(session_id: str, body: PrepareIn | None = None, user=Depends(get_current_user)):
    session = await _session(session_id)
    _mine(session, user)
    if goals.public(session)["missing"]:
        raise HTTPException(status_code=409, detail="A few details are still needed before this can be prepared.")
    try:
        session = await goals.prepare(get_store(), session, get_orchestrator(), user["id"], user.get("email"), confirmed=bool(body and body.confirmed))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return goals.public(session)


@router.get("/task-sessions/{session_id}/status")
async def session_status(session_id: str):
    session = await _session(session_id)
    return {"id": session["id"], "state": session["state"], "handoff": session.get("handoff"), "problem": session.get("problem")}
