"""The one Agent conversation (the owner, 31 Oct: "one conversation engine for every surface… an interactive agent that assigns
to subagents"). One thread per person and business, holding everything said, whatever the topic. The model reads it with
the business's context and either answers, or assigns the work to a module (its tools): the idea check, the Idea Validation,
the business plan writer, or a hand-over to the modules that keep their own flow for now (funding, launch, documents,
the checks). Code keeps the hard rules: plan and price first, nothing started or sent without a yes, charged only when a
reply is written. Behind a switch: AGENT_CONDUCTOR=1, or a workspace's agent_settings.conductor."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

logger = logging.getLogger(__name__)

PASS = "pass"      # the module that owns this keeps its own flow: the request goes on as before
THREAD_TURNS = 30
STEPS = 3          # a reply may use up to two modules before it answers
MODEL_SECONDS = 45.0

SYSTEM = (
    "You are the EnterprateAI Agent, the one assistant a small business owner talks to. You are their pilot: you understand "
    "what they mean, guide them step by step, and assign the work to the right module. Warm, direct and specific; plain UK "
    "English; never use dashes; short paragraphs, under 120 words unless they ask for more.\n"
    "THREAD is the whole conversation so far: it is one conversation, so never ask again for anything already said there, "
    "and if they say 'I already told you', look in THREAD. CONTEXT is what the business has on record.\n"
    "Every reply: start from something real (progress or a strength), say where they are, recommend ONE next step and why, "
    "then give two ways on as buttons when it helps: the work done for them, and the free next step.\n"
    "Assign work with a tool when it is what they want. Tools:\n"
    "- save_idea {description, customer, where, price, cost, monthly_sales, capacity}: keep what they said about an idea "
    "(only the fields they said) and get its free viability check back. Use it as soon as an idea is described.\n"
    "- run_idea_validation {start}: the full Idea Validation of the saved idea. First call with start false: the app says its "
    "price. Only after they say yes to that price, call it with start true.\n"
    "- write_business_plan {description, customer, purpose, start}: the business plan. description is what the business does, in one plain sentence with no commentary about it. purpose is who reads it (investors, a "
    "bank or lender, a grant application, my own planning); ask for it if not said. First start false (its price is said), "
    "start true only after their yes.\n"
    "- hand_over {module}: funding (a funding need or readiness), launch (launching a product or service), invoice, "
    "quotation, contract, receipt, customers, risks, pricing, other. These modules run their own flow: hand over as soon "
    "as the request is clearly theirs.\n"
    "Rules: never invent figures, funders, customers or results; only use what THREAD, CONTEXT or a tool result says. Never "
    "say something was saved, started or charged unless a tool result says so. Never state a price yourself. If you are not "
    "sure what they meant, ask one short question.\n"
    'Reply with JSON only: {"say": "<your reply>", "tool": {"name": "<tool>", "args": {...}} or null, '
    '"buttons": [<0 to 3 of {"label": "<short>", "text": "<what pressing it says>"}>]}. When you call a tool, "say" may be '
    "empty: you will see the tool's result and reply after it."
)


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
            "idea_validations": history or None, "drafts_waiting": drafts or None}


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
    """The Agent's reply to one message: a response, PASS for a module that keeps its own flow, or None (no model: the
    existing chat answers)."""
    from app.modules.agent import research
    from app.modules.agent.converse import OutOfCredits, _parse, paid_reply
    llm = research._default_llm(user["id"])
    if llm is None:
        return None
    business_id = body.business_id
    turns = _thread(known, user["id"])
    text = str(body.text or "").strip()
    context = _context(known)
    results: list[dict] = []
    say, buttons = "", []
    for step in range(STEPS):
        prompt = json.dumps({"CONTEXT": context, "THREAD": turns[-THREAD_TURNS:], "MESSAGE": text[:2000], "TOOL_RESULTS": results},
                            ensure_ascii=False, default=str)
        call = lambda: llm.generate_text(system=SYSTEM, prompt=prompt, feature="agent_conversation", max_tokens=900)      # noqa: E731
        try:
            # one written reply is charged once, however many modules it used (the first call is the paid one)
            res = await asyncio.wait_for(paid_reply(orch, user, call) if step == 0 else call(), MODEL_SECONDS)
        except OutOfCredits:
            raise
        except Exception:      # noqa: BLE001 - the existing chat answers instead
            logger.warning("agent conductor: no model reply", exc_info=True)
            return None if step == 0 else {"kind": "answer", "conversational": True, "message": "I couldn't finish that just now. Nothing was started or charged; please try again."}
        got = _parse(getattr(res, "text", "") or "")
        say = " ".join(str(got.get("say") or "").split()).replace("—", ", ").replace("–", " to ")
        buttons = [b for b in (got.get("buttons") or []) if isinstance(b, dict) and str(b.get("label") or "").strip()][:3]
        tool = got.get("tool") if isinstance(got.get("tool"), dict) else None
        if not tool:
            break
        name, args = str(tool.get("name") or ""), tool.get("args") if isinstance(tool.get("args"), dict) else {}
        try:
            if name == "hand_over":
                await _keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]},
                                                            {"role": "agent", "text": f"(handed over to {args.get('module') or 'its module'})"}])
                return PASS
            if name == "save_idea":
                done = await _save_idea(orch, business_id, args)
            elif name == "run_idea_validation":
                done = await _idea_validation(user, business_id, args, getattr(body, "locale", None), known)
            elif name == "write_business_plan":
                done = await _business_plan(orch, user, business_id, args)
            else:
                done = {"error": f"no tool called {name}"}
        except Exception:      # noqa: BLE001 - said plainly, never a half-done claim
            logger.warning("agent conductor: %s failed", name, exc_info=True)
            done = {"error": "it couldn't be done just now; nothing was changed"}
        if done.get("final"):
            final = dict(done["final"])
            await _keep(orch, business_id, user["id"], [*turns, {"role": "owner", "text": text[:600]},
                                                        {"role": "agent", "text": str(final.get("message") or "")[:600]}])
            return final
        results.append({"tool": name, "args": args, "result": done})
    if not say:
        return None
    turns = [*turns, {"role": "owner", "text": text[:600]}, {"role": "agent", "text": say[:600],
                                                              **({"did": [r["tool"] for r in results]} if results else {})}]
    await _keep(orch, business_id, user["id"], turns)
    return {"kind": "answer", "conversational": True, "message": say,
            "actions": [{"label": str(b["label"]).strip()[:40], "kind": "explain", "prompt": str(b.get("text") or b["label"]).strip()[:300]} for b in buttons]}
