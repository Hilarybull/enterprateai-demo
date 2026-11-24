"""The one Agent conversation (the owner, 31 Oct: "one conversation engine for every surface… an interactive agent that assigns
to subagents"): its switch, its thread (one per person and business, whatever the topic), the business context it reads, and
the modules it assigns work to. The conversation itself, Claude or OpenAI with tools, is chat_agent.py. Code keeps the hard
rules: plan and price first, nothing started or sent without a yes, charged only when a reply is written. Behind a switch:
AGENT_CONDUCTOR=1, or a workspace's agent_settings.conductor."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from types import SimpleNamespace

logger = logging.getLogger(__name__)

PASS = "pass"      # the module that owns this keeps its own flow: the request goes on as before
THREAD_TURNS = 30


def enabled(data: dict | None) -> bool:
    if str(os.getenv("AGENT_CONDUCTOR", "")).strip().lower() in ("1", "true", "yes", "on"):
        return True
    try:
        from app.core.config import get_settings
        if get_settings().agent_conductor:
            return True
    except Exception:      # noqa: BLE001
        pass
    return bool(((data or {}).get("agent_settings") or {}).get("conductor"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _context(data: dict) -> dict:
    """What the business has on record, in short: enough to guide, never a dump."""
    from app.modules.agent import business as bz, first_value
    p = data.get("workspace_profile") or {}
    idea = first_value.known_answers("test_idea", data) or {}
    try:
        from app.modules.agent import figures
        f = figures.of(data)
    except Exception:      # noqa: BLE001
        f = {}
    drafts = [{"kind": d.get("kind"), "title": d.get("title")} for d in data.get("agent_drafts") or [] if isinstance(d, dict) and d.get("status") == "pending"][:6]
    history = [{"idea": e.get("title"), "score": e.get("score"), "status": e.get("status")} for e in data.get("validation_history") or [] if isinstance(e, dict)][:3]
    return {"business": p.get("company_name") or p.get("business_name") or data.get("name"), "country": p.get("country"),
            "currency": bz.currency_of(data), "stage": p.get("business_stage") or p.get("operating_stage"), "sector": p.get("primary_industry"),
            "revenue_all_time": f.get("revenue_all_time"), "paying_customers": f.get("clients") or 0,
            "idea": {k: v for k, v in idea.items() if v not in (None, "") and not str(k).startswith("_")} or None,
            "idea_validations": history or None, "drafts_waiting": drafts or None,
            "chat_documents": [{k: item.get(k) for k in ("id", "name", "kind")} for item in data.get("agent_files") or [] if isinstance(item, dict)][:20]}


def _thread(data: dict, user_id: str) -> list[dict]:
    return list(((data.get("agent_thread") or {}).get(str(user_id)) or {}).get("turns") or [])


async def _keep(orch, business_id: str, user_id: str, turns: list[dict]) -> None:
    def _apply(d: dict) -> None:
        d.setdefault("agent_thread", {})[str(user_id)] = {"at": _now().isoformat(), "turns": turns[-THREAD_TURNS:]}
    try:
        await orch.rt.business.mutate(business_id, _apply)
    except Exception:      # noqa: BLE001 - the reply still goes out
        logger.info("agent thread not kept for %s", business_id, exc_info=True)


# ── The modules the Agent assigns work to ──────────────────────────────────────────────────────────────────────────────

_IDEA_FIELDS = ("description", "customer", "where", "price", "cost", "monthly_sales", "capacity")


async def _save_idea(orch, business_id: str, args: dict) -> dict:
    from app.modules.agent import answer_memory, business as bz, first_value
    data = await orch.rt.business.load(business_id) or {}
    said = {k: args[k] for k in _IDEA_FIELDS if args.get(k) not in (None, "")}
    if not said:
        return {"saved": False, "note": "nothing to save: ask what the idea is"}
    held = first_value.known_answers("test_idea", data) or {}
    new_idea = bool(said.get("description")) and str(said["description"]).strip().lower() != str(held.get("description") or "").strip().lower()
    merged = dict(said) if new_idea else {**held, **said}
    result = first_value.assess("test_idea", merged, data) or {}

    def _apply(d: dict) -> None:
        answer_memory.remember(d, "test_idea", merged, result=result, currency=bz.currency_of(d))
    await orch.rt.business.mutate(business_id, _apply)
    missing = [w for k, w in (("customer", "who it's for"), ("price", "the price"), ("cost", "the cost per sale"), ("monthly_sales", "expected sales a month"))
               if merged.get(k) in (None, "")]
    return {"saved": True, "idea": merged.get("description"), "score": result.get("score"), "viability": result.get("classification"),
            "still_needed": missing}


async def _business_plan(orch, user: dict, business_id: str, args: dict) -> dict:
    from app.modules.agent.models import AgentRequest
    answers = {k: args[k] for k in ("description", "customer") if args.get(k)}
    purpose = str(args.get("purpose") or "").strip()
    out = await orch.submit(AgentRequest(requesting_actor_id=user["id"], business_id=business_id, source_channel="text",
                                         raw_input=f"Write a business plan: {answers.get('description') or ''}"[:500], requested_capability="business_plan_draft",
                                         params={**({"answers": answers} if answers else {}), **({"purpose": purpose} if purpose else {})},
                                         confirmed=bool(args.get("start")), background=True), email=user.get("email"))
    kind = (out or {}).get("kind")
    if kind == "needs_confirmation":
        return {"final": {"kind": "answer", "conversational": True, "message": str(out.get("message") or "This has a price. Shall I start?"),
                          "actions": [{"label": "Start", "kind": "explain", "prompt": "Yes, start the business plan"},
                                      {"label": "Not now", "kind": "explain", "prompt": "Not now"}]}}
    if kind == "blocked":
        return {"final": {**out, "actions": out.get("actions") or [{"label": "See plans", "to": "/pricing"}]}}
    return {"final": out}      # started: the task's own reply and its link, as the Agent Centre shows tasks


async def _idea_validation(user: dict, business_id: str, args: dict, locale: str | None, known: dict) -> dict:
    from app.modules.agent.router import _validate_idea
    text = "Start the idea validation" if args.get("start") else "Run the idea validation"
    got = await _validate_idea(user, SimpleNamespace(text=text, business_id=business_id, locale=locale), known)
    return {"final": got} if got else {"saved": False, "note": "there is no idea saved yet: ask what the idea is, then save_idea"}


# ── One turn ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async def turn(orch, user: dict, body, known: dict) -> dict | str | None:
    """The Agent's reply to one message: a response, PASS for a module that keeps its own flow, or None (no model set up: the
    existing chat answers)."""
    from app.modules.agent import chat_agent
    if not chat_agent.available():
        return None
    # A greeting must never be mistaken for an answer to the last tool question, or cause that
    # question to be repeated. The regular fallback chat applies the same social boundary below.
    return await chat_agent.turn(orch, user, body, known)
