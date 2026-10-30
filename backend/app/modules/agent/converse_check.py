"""The free checks as a conversation (the owner, 30 Oct: the landing page's shortcuts "should be in a chat", as the idea,
launch and funding ones are, never a pop-up or a result page alone): more customers, business risks and pricing. One model
call per message reads what the owner typed with the check's answers and its result (the existing check's, worked out from
those answers and the records; never the model's own), and says what to do: answer, change an answer from the owner's own
words (the result is then worked out again), or show the result. Every reply ends with the next step and its button.
Nothing here is charged and the workspace profile is never written; without a model the scripted check carries on."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.modules.agent.converse import MAX_TURNS, MODEL_SECONDS, _BOTH, _MANNER, _figures_in, _parse, _said, in_conversation

logger = logging.getLogger(__name__)

# The page each check talks on, and the check it is
GOALS = {"customers": "more_customers", "risks": "business_risks", "pricing": "price_offer"}
WHAT = {"customers": "winning more customers", "risks": "the risks in their business", "pricing": "pricing a product or service"}
PAGE = {"customers": "/check/customers", "risks": "/check/risks", "pricing": "/check/pricing"}


def _system(topic: str, fields: list[dict]) -> str:
    named = "; ".join(f"{f['key']} ({f.get('label') or f['key']}{', a number' if f.get('type') == 'money' else ''})" for f in fields)
    return (_MANNER +
            f"Right now you are helping them with {WHAT[topic]}: the check's answers and its result (CHECK, worked out by the check "
            "from those answers and their records; never your own result). Reply with JSON only:\n"
            '{"say": "<what you tell them>", "change": {<answers from their own words only>}, "buttons": [<0 to 3 of: {"kind": '
            '"reply", "label": "<short>", "text": "<what it says for them>"}>], "show": [<"result" to show the check\'s result '
            'under your reply, only when it helps>]}\n'
            f"Answers: {named}. Rules: change only what the owner said in this message or the one before; never guess a figure; "
            "ask for what is missing in plain words, one thing at a time. Answer from CHECK: its headline, what is strong, what "
            "is missing and the next actions; never invent figures or results. End with the one next step from CHECK's next "
            "actions, in plain words.")


def _num(v: Any) -> float | None:
    try:
        n = float(str(v).replace(",", "").replace("₦", "").replace("£", "").replace("$", "").replace("€", "").strip())
    except (TypeError, ValueError):
        return None
    return round(n, 2) if n >= 0 else None


def clean_change(change: Any, fields: list[dict]) -> dict:
    """Only the check's own answers, each as the check takes it."""
    out: dict = {}
    if not isinstance(change, dict):
        return out
    for f in fields:
        k = f["key"]
        if k not in change:
            continue
        if f.get("type") == "money":
            n = _num(change[k])
            if n is not None:
                out[k] = n
        else:
            v = " ".join(str(change.get(k) or "").split())[:300]
            if v:
                out[k] = v
    return out


def grounded(change: dict, said: str, fields: list[dict]) -> dict:
    """Only what the owner said: a figure in their words, words sharing theirs."""
    import re
    money = {f["key"] for f in fields if f.get("type") == "money"}
    t = str(said or "").lower()
    words = set(re.findall(r"[a-z]{3,}", t))
    out = {}
    for k, v in change.items():
        ok = any(abs(v - f) <= max(1, v * 0.001) for f in _figures_in(t)) if k in money else bool(set(re.findall(r"[a-z]{3,}", str(v).lower())) & words)
        if ok:
            out[k] = v
    return out


def view(answers: dict, result: dict | None) -> dict:
    r = result or {}
    return {"answers": answers, "headline": r.get("headline"), "score": r.get("score"), "score_label": r.get("score_label"),
            "classification": r.get("classification"), "strengths": r.get("strengths"),
            "missing": [b.get("label") for b in r.get("blockers") or []][:6], "metrics": r.get("metrics"),
            "next_actions": [a.get("label") for a in r.get("free_next_actions") or [] if not a.get("save")][:4]}


def next_actions(topic: str, result: dict | None) -> list[dict]:
    """The check's own next actions as buttons: a page to open, never a pop-up; "Save for later" is the chat itself."""
    out = []
    for a in (result or {}).get("free_next_actions") or []:
        if a.get("save") or not a.get("to") or not str(a.get("label") or "").strip():
            continue
        out.append({"label": str(a["label"])[:40], "to": a["to"]})
    return out[:2]


async def turn(*, orch, user: dict, business_id: str, text: str, topic: str, llm=None, now: datetime | None = None,
               history: list[dict] | None = None) -> dict | None:
    from app.modules.agent import answer_memory, business as bz, first_value, goals
    goal = GOALS.get(topic)
    if not goal:
        return None
    now = now or datetime.now(timezone.utc)
    if llm is None:
        from app.modules.agent import research
        llm = research._default_llm(user["id"])
    if llm is None:
        return None
    fields = [f for f in (goals._BY_KEY.get(goal) or {}).get("questions") or [] if isinstance(f, dict) and f.get("key")]
    data = await orch.rt.business.load(business_id) or {}
    answers = dict((((data.get("quick_check_answers") or {}).get(goal) or {}).get("answers")) or {})
    result = first_value.assess(goal, answers, data)
    mine = ((data.get("agent_conversations") or {}).get(str(user["id"])) or {}) if in_conversation(data, user["id"], now, topic) else {}
    turns = list(mine.get("turns") or [])[-MAX_TURNS:]
    if not turns and history:
        turns = [{"role": "owner" if h.get("role") == "user" else "agent", "text": str(h.get("content") or "")[:500]} for h in history if h.get("content")][-MAX_TURNS:]
    prompt = json.dumps({"CHECK": view(answers, result), "TURNS": turns, "MESSAGE": str(text)[:2000]}, ensure_ascii=False, default=str)
    try:
        res = await asyncio.wait_for(llm.generate_text(system=_system(topic, fields), prompt=prompt, feature="agent_conversation", max_tokens=500), MODEL_SECONDS)
    except Exception:      # noqa: BLE001 - the scripted check answers instead
        logger.info("%s conversation: no model reply", topic, exc_info=True)
        return None
    got = _parse(getattr(res, "text", "") or "")
    say = " ".join(str(got.get("say") or "").split())
    if not say:
        return None
    say = say.replace("—", ", ").replace("–", " to ")      # no dashes in what the owner reads

    said = " ".join([str(text)] + [t.get("text") or "" for t in turns if t.get("role") == "owner"][-1:])
    wanted = clean_change(got.get("change"), fields)
    change = grounded(wanted, said, fields)
    dropped = [k for k in wanted if k not in change]
    if dropped:
        labels = {f["key"]: str(f.get("label") or f["key"]).rstrip("?").lower() for f in fields}
        say = ("Got that. " if change else "") + "Before I change that, tell me " + " and ".join(labels.get(k, k) for k in dropped) + "."
    done: list[str] = []
    if change:
        merged = {**answers, **change}
        fresh = first_value.assess(goal, merged, data)
        try:
            await orch.rt.business.mutate(business_id, lambda d: answer_memory.remember(d, goal, merged, result=fresh, currency=bz.currency_of(d)))
            answers, result = merged, fresh
            done.append("updated")
        except Exception:      # noqa: BLE001
            logger.warning("%s conversation: the answers could not be kept for %s", topic, business_id, exc_info=True)
            say = "I couldn't update that just now. Nothing was changed; please try again."
    shown = [s for s in (got.get("show") or []) if s == "result"] if isinstance(got.get("show"), list) else []
    first = not turns
    cards = [{"type": "check_result", "case_id": topic, "goal": goal, "result": view(answers, result)}] if (first or shown or done) and result else []
    actions = [{"label": str(b["label"]).strip()[:40], "kind": "explain", "prompt": str(b["text"]).strip()[:300]}
               for b in (got.get("buttons") or [])[:2] if isinstance(b, dict) and b.get("kind") == "reply" and str(b.get("label") or "").strip()
               and str(b.get("text") or "").strip() and not _BOTH.search(f"{b.get('label')} {b.get('text')}")]
    # Always the next step, with its button (the owner, 30 Oct: "we are assuming the user is clueless about the next steps")
    steps = next_actions(topic, result)
    if steps and "next step" not in say.lower():
        say += f" Next step: {steps[0]['label'][:1].lower() + steps[0]['label'][1:]}."
    actions = [*actions, *steps][:3] or [{"label": "Where do I stand?", "kind": "explain", "prompt": "Where do I stand?"},
                                         {"label": "What should I do next?", "kind": "explain", "prompt": "What should I do next?"}]
    out = await _said(orch, user, business_id, text, say, actions, now, topic=topic, cards=cards)
    return {**out, "changed": done, "case_id": topic}
