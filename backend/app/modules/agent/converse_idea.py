"""Idea validation as a conversation (the owner's mockups, 27 Oct: "I have a new service idea. How do I know if it's worth
launching?"). One model call per message reads what the owner typed with the idea's answers and its viability result (the
existing Viability Engine's, worked out from those answers), and says what to do: answer, change an answer from the owner's
own words (the score is then worked out again), offer the research, or show a card. Nothing here is charged and the
workspace profile is never written; without a model the scripted idea check carries on as before."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from app.modules.agent.converse import MAX_TURNS, MODEL_SECONDS, _BOTH, _MANNER, _figures_in, _parse, _said, in_conversation

logger = logging.getLogger(__name__)

TOPIC = "idea"
GOAL = "test_idea"
DEMAND = ("assumption", "research", "enquiries", "lois", "pilot", "paying", "repeat")
NUMBERS = ("price", "monthly_sales", "cost", "fixed_costs", "capacity")
_SHOW = {"idea_inputs", "viability", "launch_fit", "next", "approvals", "risk"}

_SYSTEM = (
    _MANNER +
    "Right now you are helping them test a product or service idea: its answers and its viability result (IDEA, worked out "
    "by the viability engine from those answers; never your own score). Use a tool only when the message needs it. Reply "
    "with JSON only:\n"
    '{"say": "<what you tell them>", "change": {<answers from their own words only>}, "do_all": <true when they want the '
    'research done for them>, "buttons": [<0 to 3 of: {"kind": "reply", "label": "<short>", "text": "<what it says for '
    'them>"}>], "show": [<cards under your reply, only when they help: "idea_inputs" (what you checked), "viability" (the '
    'score, strengths and weaknesses), "launch_fit" (whether it is ready to launch or should be tested first), "next" '
    '(what to do next), "approvals" (approvals waiting), "risk" (a customer concentration risk in their records)>]}\n'
    "Answers: description (the idea, a sentence), customer (who it is for and where), price (a number), monthly_sales (how "
    "many a month), cost (what one sale costs them), fixed_costs (new monthly fixed costs), capacity (how many they can "
    "deliver a month), demand (one of assumption/research/enquiries/lois/pilot/paying/repeat). Rules: change only what the "
    "owner said in this message or the one before; a different idea (another product or service) is a new check: set its description and only what they said about it; a figure as they said it, or changed as they asked ('reduce it "
    "slightly' is about a tenth less); never guess a figure; ask for what is missing in plain words. Say the score as N/100 "
    "with its range in words (Weak, Fair, Strong or Very Strong viability). When they ask whether they are ready to launch, "
    "answer from IDEA (offer, pricing, capacity, economics, real customers) and show launch_fit; with little real demand, "
    "recommend testing it first, for example on the EnterprateAI Marketplace. RISK is what their records show about "
    "reliance on one customer: mention it only when it matters. WAITING lists approvals waiting for them.")


def wants_idea(text: str) -> bool:
    from app.modules.agent import goals
    t = str(text or "")
    if (goals.resolve(text=t) or {}).get("goal_key") == GOAL:
        return True
    return bool(re.search(r"\b(?:worth (?:launching|doing|it)|(?:service|product|business) idea|viab\w+|validat\w+ (?:my|an?|the) idea)\b", t, re.I))


def _num(v: Any) -> float | None:
    try:
        n = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return round(n, 2) if n >= 0 else None


def clean_change(change: Any) -> dict:
    out: dict = {}
    if not isinstance(change, dict):
        return out
    for k, n in (("description", 300), ("customer", 200)):
        v = " ".join(str(change.get(k) or "").split())[:n]
        if v:
            out[k] = v
    for k in NUMBERS:
        n = _num(change.get(k))
        if n is not None:
            out[k] = n
    d = str(change.get("demand") or "").strip().lower()
    if d in DEMAND:
        out["demand"] = d
    return out


_DEMAND_WORDS = {"assumption": r"\b(?:assum|no evidence|none yet|guess)", "research": r"\bresearch", "enquiries": r"\b(?:enquir|inquir|interest)",
                 "lois": r"\b(?:letters? of intent|lois?)\b", "pilot": r"\bpilot", "paying": r"\b(?:paying|paid|customers? (?:pay|bought))", "repeat": r"\brepeat"}
_RELATIVE = re.compile(r"\b(?:reduce|lower|cut|drop|decrease|increase|raise|bump|up|down|slightly|a bit|a little|less|more)\b", re.I)
_STOP = {"the", "a", "an", "for", "to", "of", "and", "my", "our", "it", "is", "in", "on", "with", "new", "idea", "service", "product", "who", "people"}


def grounded(change: dict, said: str, known: dict) -> dict:
    """Only what the owner said: a figure in their words (or the one they asked to change, by a modest step), a description
    or customer sharing their words, the evidence they named."""
    t = str(said or "").lower()
    words = set(re.findall(r"[a-z]{3,}", t))
    out = {}
    for k, v in change.items():
        if k in NUMBERS:
            old = _num(known.get(k))
            said_it = any(abs(v - f) <= max(1, v * 0.001) for f in _figures_in(t))
            nudged = bool(_RELATIVE.search(t)) and old and 0.5 * old <= v <= 1.5 * old and v != old
            ok = said_it or nudged
        elif k == "demand":
            ok = bool(re.search(_DEMAND_WORDS[v], t))
        else:
            ok = bool({w for w in re.findall(r"[a-z]{3,}", str(v).lower()) if w not in _STOP} & words)
        if ok:
            out[k] = v
    return out


# A chip that states a value ("Fixed costs are ₦250,000", "Demand level is pilot") is an answer the owner never gave
_STATES = re.compile(r"\d|[£$€₦]|\b(?:is|are|was|were|will be)\s+(?!it\b|this\b|that\b)\w", re.I)
_ADD = (("price", "Add my price"), ("cost", "Add my cost per sale"), ("monthly_sales", "Add my expected sales"), ("fixed_costs", "Add my fixed costs"),
        ("capacity", "Add my capacity"), ("demand", "Add my demand evidence"), ("customer", "Add my target customer"))


_NEW_IDEA = re.compile(r"\b(?:new|another|different|second|other)\b.{0,25}\b(?:idea|service|product)\b", re.I)


def _same_idea(a, b) -> bool:
    """The same idea said again ("mobile car detailing" and "car interior detailing"), not another one ("carpet washing")."""
    words = lambda t: {w for w in re.findall(r"[a-z]{4,}", str(t or "").lower()) if w not in {"service", "business", "selling", "mobile", "new", "idea"}}      # noqa: E731
    one, two = words(a), words(b)
    return bool(one & two) or not one or not two


def _score(result: dict | None) -> float | None:
    s = (result or {}).get("score")
    return s if isinstance(s, (int, float)) else None


def view(answers: dict, result: dict | None) -> dict:
    r = result or {}
    return {"answers": answers, "score_out_of_100": _score(r), "partial_score": r.get("partial_score"), "viability": r.get("classification"),
            "strengths": r.get("strengths"), "weaknesses": [b.get("label") for b in r.get("blockers") or []][:6], "metrics": r.get("metrics")}


def concentration(data: dict) -> dict | None:
    """Reliance on one customer: the biggest customer's share of revenue, worked out as the dashboard does (the owner,
    27 Oct: "Agent Centre says Raphael is 53% of revenue; the dashboard said 99.9%. Use one calculation for both")."""
    from app.modules.agent import business as bz
    conc = bz.concentration(data or {}, 40)
    if not conc["customer_count"] or conc["total_revenue"] <= 0:
        return None
    top = conc["top_customers"]
    share = top[0]["share_pct"]
    others = round(sum(t["share_pct"] for t in top[1:4]), 1)
    return {"customer": top[0]["customer"], "share": share, "amount": bz.money(top[0]["revenue"]), "others": others,
            "tail": max(0.0, round(100 - share - others, 1)), "tail_count": max(0, conc["customer_count"] - 4),
            "level": "High" if share >= 50 else "Medium" if share >= 30 else "Low"}


async def turn(*, orch, user: dict, business_id: str, text: str, llm=None, now: datetime | None = None, history: list[dict] | None = None) -> dict | None:
    from app.modules.agent import answer_memory, business as bz, first_value
    from app.modules.agent.converse import approvals_waiting, cards_for
    now = now or datetime.now(timezone.utc)
    if llm is None:
        from app.modules.agent import research
        llm = research._default_llm(user["id"])
    if llm is None:
        return None
    data = await orch.rt.business.load(business_id) or {}
    answers = dict((((data.get("quick_check_answers") or {}).get(GOAL) or {}).get("answers")) or {})
    result = first_value.assess(GOAL, answers, data) if answers else None
    mine = ((data.get("agent_conversations") or {}).get(str(user["id"])) or {}) if in_conversation(data, user["id"], now, TOPIC) else {}
    turns = list(mine.get("turns") or [])[-MAX_TURNS:]
    if not turns and history:
        turns = [{"role": "owner" if h.get("role") == "user" else "agent", "text": str(h.get("content") or "")[:500]} for h in history if h.get("content")][-MAX_TURNS:]
    waiting = await approvals_waiting(orch, business_id)
    risk = concentration(data)
    prompt = json.dumps({"IDEA": view(answers, result), "RISK": risk, "WAITING": waiting, "TURNS": turns, "MESSAGE": str(text)[:2000]},
                        ensure_ascii=False, default=str)
    try:
        res = await asyncio.wait_for(llm.generate_text(system=_SYSTEM, prompt=prompt, feature="agent_conversation", max_tokens=500), MODEL_SECONDS)
    except Exception:      # noqa: BLE001 - the scripted check answers instead
        logger.info("idea conversation: no model reply", exc_info=True)
        return None
    got = _parse(getattr(res, "text", "") or "")
    from app.modules.agent.converse import asks_gaps, asks_help
    if asks_help(text):
        got["do_all"] = True      # the research, chosen on its card at the price shown there
    if asks_gaps(text):
        got["show"] = [*(got.get("show") if isinstance(got.get("show"), list) else []), "viability"]
    say = " ".join(str(got.get("say") or "").split())
    if not say:
        return None
    say = say.replace("—", ", ").replace("–", " to ")      # no dashes in what the owner reads
    from app.modules.agent.converse import _PRICE_SAID, _RESEARCH_CLAIM
    if _RESEARCH_CLAIM.search(say) or _PRICE_SAID.search(say):
        got["do_all"] = True

    said = " ".join([str(text)] + [t.get("text") or "" for t in turns if t.get("role") == "owner"][-1:])
    wanted = {} if asks_help(text) else clean_change(got.get("change"))      # "research it for me" asks for research, never an edit
    change = grounded(wanted, said, answers)
    dropped = [k for k in wanted if k not in change]
    # Another idea is a new check: its own answers from what is said about it, never the last idea's figures (the owner, 28 Oct:
    # "carpet washing" researched with the car detailing idea's price, cost and sales)
    new_idea = bool(change.get("description")) and bool(answers.get("description")) and not _same_idea(answers.get("description"), change["description"])
    # "I need new idea validation" without the idea: asked for it, and what comes next is that idea, from nothing (the owner, 28 Oct:
    # "it still went and continued from the last one")
    asked_new, opening = bool(_NEW_IDEA.search(str(text))), False
    if mine.get("which_idea"):      # the answer to "carry on, or a new idea?"
        if re.search(r"\bcarry on\b|\bcontinue\b|\bsame\b|\bthis one\b", str(text), re.I):
            asked_new, opening = False, True      # its check shown as at the start: what was checked and the result
        elif re.search(r"\bnew\b|\banother\b|\bdifferent\b", str(text), re.I) and not change.get("description"):
            out = await _said(orch, user, business_id, text, "What's the new idea? Tell me the product or service, and who it's for.", [], now,
                              topic=TOPIC, keep={"new_idea": True})
            return {**out, "changed": []}
    if mine.get("new_idea") and not asked_new:
        said_idea = change.get("description") or (str(text).strip()[:300] if not asks_help(text) and len(str(text).split()) <= 12 else "")
        if said_idea:
            change = {**{k: v for k, v in change.items()}, "description": said_idea}
            new_idea, dropped = True, []
    if asked_new and not change.get("description") and not mine.get("which_idea"):
        held_idea = str(answers.get("description") or "").strip()
        if held_idea:      # one on record: carry on with it, or a new one, each a button
            short = held_idea if len(held_idea) <= 40 else held_idea[:38].rstrip() + "…"
            out = await _said(orch, user, business_id, text, f"Do you want to carry on with “{held_idea}”, or check a new idea?",
                              [{"label": f"Carry on with {short}", "kind": "explain", "prompt": f"Carry on with {held_idea}"},
                               {"label": "A new idea", "kind": "explain", "prompt": "A new idea"}], now, topic=TOPIC, keep={"which_idea": True})
            return {**out, "changed": []}
        asked_new = False      # nothing on record: this is the first idea, checked as it is said
    if asked_new and change.get("description"):
        new_idea = True
    if dropped:
        need = [w for k, w in (("description", "what the idea is"), ("customer", "who it's for"), ("price", "what you'll charge"), ("monthly_sales", "how many you could sell a month"),
                               ("cost", "what one sale costs you"), ("fixed_costs", "any new monthly fixed costs"), ("capacity", "how many you can deliver a month"),
                               ("demand", "what evidence of demand you have")) if k in dropped]
        say = (("Got that. " if change else "") + "Before I change that, tell me " + (need[0] if len(need) == 1 else ", ".join(need[:-1]) + " and " + need[-1]) + ".")
    before, after, done = _score(result), None, []
    if change:
        merged = dict(change) if new_idea else {**answers, **change}
        fresh = first_value.assess(GOAL, merged, data)
        try:
            await orch.rt.business.mutate(business_id, lambda d: answer_memory.remember(d, GOAL, merged, result=fresh, currency=bz.currency_of(d)))
            done.append("updated")
            answers, result = merged, fresh      # what follows (the research offer) is about the idea as it is now
            after = _score(fresh)
            if after is not None:
                say += f" Your idea is now at {round(after)}/100" + (f", {fresh.get('classification')} viability." if fresh.get("classification") else ".")
        except Exception:      # noqa: BLE001
            logger.warning("idea conversation: the answers could not be kept for %s", business_id, exc_info=True)
            say = "I couldn't update your idea just now. Nothing was changed; please try again."
    shown = [s for s in (got.get("show") or []) if s in _SHOW] if isinstance(got.get("show"), list) else []
    first = not turns or opening
    want = (["idea_inputs", "viability"] if first and not shown else []) + shown
    quote = {}
    if got.get("do_all"):
        want.append("choose")
        # From what the idea already holds, never asking for it again; "free" said before Start when the earlier research is
        # reused (the owner, 28 Oct)
        try:
            from app.modules.agent import goal_router
            quote = await goal_router._premium_quote(user, GOAL, result, answers, data) if result else {}
        except Exception:      # noqa: BLE001 - the card still offers it, priced on Start
            quote = {}
        from app.modules.agent.research import money as _money
        currency = bz.currency_of(data)
        held = [w for w in (("price", lambda v: f"a price of {_money(v, currency)}"),
                            ("cost", lambda v: f"a cost of {_money(v, currency)} a sale"),
                            ("capacity", lambda v: f"capacity of {v:g} a month" if isinstance(v, (int, float)) else f"capacity of {v} a month"),
                            ("monthly_sales", lambda v: f"{v:g} sales a month" if isinstance(v, (int, float)) else f"{v} sales a month"))
                if answers.get(w[0]) not in (None, "")]
        try:
            known = ", ".join(f(float(str(answers[k]).replace(",", ""))) for k, f in held)
        except (TypeError, ValueError):
            known = ""
        say = (f"I'll research it from what your idea already has ({known})." if known else "I'll research comparable services, pricing and demand for your idea.") \
            + (" This one is free: nothing has changed since your last research, so it reuses it." if quote.get("reuse") else "")
    if waiting and "next" in want:
        want.append("approvals")
    cards = [{"type": k, "case_id": "idea", **({"price": quote.get("max"), "reuse": bool(quote.get("reuse"))} if k == "choose" and quote else {})}
             for k in dict.fromkeys(want) if (k != "approvals" or waiting) and (k != "risk" or risk)]
    cards += [c for c in cards_for({}, False, True, "idea", before, after) if c["type"] == "score_change"]
    actions = [{"label": str(b["label"]).strip()[:40], "kind": "explain", "prompt": str(b["text"]).strip()[:300]}
               for b in (got.get("buttons") or [])[:3] if isinstance(b, dict) and b.get("kind") == "reply" and str(b.get("label") or "").strip()
               and str(b.get("text") or "").strip() and not _BOTH.search(f"{b.get('label')} {b.get('text')}")
               and not _STATES.search(f"{b.get('label')} {b.get('text')}")]
    if not actions and (got.get("buttons") or []):
        held = {**answers, **change}
        actions = [{"label": w, "kind": "explain", "prompt": w} for k, w in _ADD if held.get(k) in (None, "")][:3]
    out = await _said(orch, user, business_id, text, say, actions, now, topic=TOPIC, cards=cards)
    return {**out, "changed": done}
