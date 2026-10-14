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
    where: str | None = Field(default=None, max_length=20)      # "app" or "homepage": which surface it happened on (QA PF7)


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
    where = body.where if body.where in ("app", "homepage") else None
    await goals.track(get_store(), body.name, session, entry_mode=None if session else mode, goal_key=None if session else key,
                      **({"where": where} if where else {}))
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
    await goals.track(get_store(), "first_value_shown", session)
    return {"session_id": session["id"], "goal_key": session.get("goal_key"), "result": result}


class QuickCheckIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


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
    for q in goals.questions_for(goal_key):
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
    try:
        if plans:
            plan = plans[0]
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
            "topics": [t["label"] for t in topics], "connected": link["connected"],
            "not_connected": None if link["connected"] or not topics else
            f"{research.NOT_CONNECTED}. What can be worked out from your figures, and asked, still is; nothing is charged.",
            "plan": {"research": sum(1 for t in topics if not t.get("number")) if link["connected"] else 0,
                     "estimate": sum(1 for t in topics if t.get("number")) if link["connected"] else 0,
                     "worked_out": len(waiting), "asked": len(items)}}
    if not agent_config.plan_allows(plan, capability):
        need = agent_config.CAPABILITY_MIN_PLAN.get(capability) or "starter_insight"
        return {**base, "allowed": False, "gate": first_value.premium_gate(result, entitled=False),
                "refusal": {"minimum_plan": need, "minimum_plan_label": agent_config.PLAN_LABEL.get(need, need)}}
    # Each field the AI fills (looked up, or estimated from a benchmark) is charged; what is worked out from the owner's
    # figures, and every question, is free (Credit System v2 §6). Each topic fills one field at most: that is the most it costs.
    per_field = await orch.rt.meter.cost(research.FEATURE) if (topics and link["connected"]) else 0
    most = per_field * len(topics)
    balance = await orch.rt.meter.balance(user["id"])
    if per_field and balance is not None and balance < per_field:
        return {**base, "allowed": False, "cost": most, "per_field": per_field, "balance": balance, "gate": first_value.premium_gate(result, entitled=True, credits=0)}
    return {**base, "allowed": True, "cost": most, "per_field": per_field, "fields_max": len(topics) if per_field else 0, "balance": balance,
            "after": None if balance is None else balance - most}


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
    run = await research.start(get_orchestrator(), user=user, business_id=business_id, goal=goal_key, answers=answers, data=data)
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
async def session_premium(session_id: str, user=Depends(get_current_user)):
    from app.modules.agent import research
    session, goal, data, answers, result = await _session_premium_context(session_id, user)
    quote = await _premium_quote(user, goal, result, answers, data)
    if not quote["allowed"]:
        return {"started": False, "gate": quote["gate"], "quote": quote}
    run = await research.start(get_orchestrator(), user=user, business_id=session["business_id"], goal=goal, answers=answers, data=data)
    return {"started": True, "research": run, "quote": quote, "run_id": run["id"], "capability": quote["capability"], "business_id": session["business_id"]}


class ResearchReview(BaseModel):
    decisions: dict[str, dict] = Field(default_factory=dict)      # {item id: {"decision": "accept"|"edit"|"reject", "value"?}}


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
    read = {**(await goals.understood_answers(said, goal_key)), **goals.extract(said, goal_key)} if said and said.strip() else {}
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
        await get_orchestrator().rt.business.mutate(business_id, lambda d: answer_memory.remember(d, goal_key, answers, result=result))
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
    from app.modules.agent import assessment_summary
    if goal_key in assessment_summary.KIND_OF_GOAL:
        result["assessment"] = await assessment_summary.current(get_orchestrator(), user["id"], business_id, assessment_summary.KIND_OF_GOAL[goal_key], user.get("email"))
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
    return {"saved": True, "created": bool(saved.get("created")), "product": saved.get("product")}


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
