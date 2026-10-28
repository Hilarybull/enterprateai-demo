"""The Agent as a conversation (the owner, 27 Oct: "just look how you carry out tasks... just by typing, you show buttons,
options when needed... not these static deterministic chats"). Funding first.

One model call per message reads what the owner typed with their funding case and the conversation so far, and says what
to do: answer, change the case from the owner's own words, run the free check, or offer a button (open the case, "Do all for
me" with its price first). The tools are the existing ones; only the conversation is new. Nothing here is charged (chat
replies never cost), the workspace profile is never written, and without a model the scripted chat carries on as before."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

TOPIC_MINUTES = 30      # a follow-up within this long ("make it ₦10m") is part of the same conversation
MAX_TURNS = 12
MODEL_SECONDS = 25.0
ROUTES = ("loan", "grant", "equity", "unsure")
STAGES = ("idea", "pre_revenue", "trading", "growing")

# How the Agent talks: the owner's brief (27 Oct, "Role and Identity"), condensed so each reply stays quick
_MANNER = (
    "You are EnterprateAI's business agent: a naturally conversational partner to a small business owner, not a form or a "
    "workflow. Understand before you respond: read their message with the conversation so far (TURNS), what they mean, and "
    "whether they want an answer, a discussion, advice, clarification or an action, and whether they already told you. Reply to "
    "what they actually said: a greeting, a remark, a worry or an idea is a real message, and a conversational reply is often "
    "enough. Answer direct questions directly. Build on what was said; never restart, never ask for what is already known, and "
    "notice corrections. Ask one question at a time, only when it genuinely helps; don't end every reply with a question or offer "
    "more help. Let them change topic, interrupt or come back to something unfinished. Match their tone and length: short for "
    "simple messages, more only when asked. Plain, warm and natural, with contractions; never start with Certainly, Absolutely, "
    "Great question or I understand; no artificial enthusiasm, no repeating their words back, no lists unless asked, no dashes. "
    "When they're frustrated, acknowledge it and help. Be honest: never invent facts, figures or results, never say something was "
    "done unless it was, and say plainly when you don't know. Disagree respectfully when they're wrong.\n")

_SYSTEM = (
    _MANNER +
    "Right now you can see and act on their funding readiness: their funding case (CASE). Use a tool only when the message "
    "needs it; most messages don't. Reply with JSON only:\n"
    '{"say": "<what you tell them>", "change": {<case fields from their own words only>}, "check": <true to score the case again>, '
    '"do_all": <true when they want the research and drafting done for them>, "replace": <true only once they said the new need replaces the current one>, "buttons": [<0 to 3 of: {"kind": "open_case"}, {"kind": "do_all"}, {"kind": "reply", "label": "<short>", "text": "<what it says for them>"}>], "show": [<cards shown under your reply, only when they help: "records" (what you checked in their records), "result" (the score, gaps and what is known), "next" (what they could do next), "approvals" (approvals waiting)>], "drafts": {<only when they decide about the drafts waiting: "accept": [<paths>] or "all", "edit": {<path>: <the value as they want it>}, "reject": [<paths>]>}}\n'
    "RECORDS is what the business's own records show. Always answer from them: when RECORDS says trading is true, the business "
    "is trading, whatever the case's stage says; never call it pre-revenue or say it has no revenue. "
    "Never say research has started, is running or is done: research starts only with do_all, and its price is asked first. "
    "Never state a price or cost for the work yourself, in money or credits: set do_all and the app says its price. "
    "Never say you changed, updated or saved anything: the app saves the change and says so itself. "
    "Rules: change only what the owner clearly said in THIS message (target_amount as a number, currency as a 3-letter code, "
    "purpose, route_preference one of loan/grant/equity/unsure, receipt_date as YYYY-MM-DD, stage one of idea/pre_revenue/trading/"
    "growing, fixed_costs_monthly as a number a month, price as a number per sale); never guess a figure; ask for what is missing in plain words instead. When something changes, set check true. "
    "Answer questions about where they stand from CASE (its score_out_of_100, always said as N/100; what is still to do), never invent. Offer do_all only when "
    "they want the work done for them: set do_all true (its price is said and asked before anything starts). CASE.research "
    "says what an earlier run found. Offer a button only when a choice helps; most "
    "replies need none. If there is no case and they want funding, ask for the amount and what it is for, then set both. A "
    "correction of the current need ('make it', 'change it to', 'update it', 'actually') just updates it: set the change and "
    "never ask. Only when they ask for a clearly different need (another purpose or kind of funding, not a correction), ask in "
    "plain words whether it replaces their current need (kept in their history) or updates it, and put the new need in change "
    "in that reply (it is held, not saved, until they answer); set replace true only once they say it replaces it. Ask that once. A business has one funding case: never "
    "offer to keep both, a second case or anything 'separately'. Never use an amount or purpose they haven't said "
    "in this conversation; ask. Say kinds of funding as people do (a loan, a grant, investors), never 'route'."
    " When the conversation starts (TURNS is empty) and CASE exists, begin from what you already know: say you've checked their "
    "records and case (what you checked and the result are shown under your reply), give the score, and ask only for what is "
    "still missing, never for what CASE or the records already hold."
    " Drafts waiting (DRAFTS) are what an earlier run prepared; nothing counts until the owner accepts. When they approve, change or reject drafts in their words, say which in drafts (an edit is the draft as they asked it changed, then accepted); otherwise leave drafts out. WAITING lists approvals waiting for them (an invoice reminder, a quotation): mention them only when it helps, and show \"approvals\" to list them.")


def wants_funding(text: str) -> bool:
    """A message about funding: the funding goal, or a readiness question about it."""
    from app.modules.agent import goals, readiness_answer
    t = str(text or "")
    if readiness_answer.asked_about(t) == "funding":
        return True
    return (goals.resolve(text=t) or {}).get("goal_key") == "need_funding"


def in_conversation(data: dict, user_id: str, now: datetime, topic: str = "funding") -> bool:
    """Whether the owner is mid-way through a funding (or launch) conversation (a follow-up belongs to it)."""
    c = ((data or {}).get("agent_conversations") or {}).get(str(user_id)) or {}
    try:
        at = datetime.fromisoformat(str(c.get("at")))
    except (TypeError, ValueError):
        return False
    return c.get("topic") == topic and now - at <= timedelta(minutes=TOPIC_MINUTES)


OPTIONS_ONLY = ["materials"]      # the funding-case check whose research is the routes: equity schemes, loans and grants
ASKS_OPTIONS = re.compile(r"\b(?:funding options?|which (?:loans?|grants?|investors?|lenders?)|any (?:loans?|grants?|investors?|lenders?)|"
                          r"(?:loans?|grants?|lenders?|investors?|programmes?|programs?|schemes?) (?:i|we) can (?:apply|get|go)|options? (?:fit|for) my)\b", re.I)


def options_found(data: dict) -> dict | None:
    """The funding options the latest research found, each with its source: {"at", "options"}; None when there is no recent
    research to answer from."""
    from app.modules.agent import research
    state = research.research_state(data, "need_funding")
    if state.get("state") not in ("review", "adopted"):
        return None
    run = (research._runs(data) or {}).get(state["run_id"]) or {}
    answers = ((data.get("quick_check_answers") or {}).get("need_funding") or {}).get("answers") or {}
    options = [o for o in research.funding_options(answers, run.get("items") or [], limit=5) if (o.get("source") or {}).get("url")]
    return {"at": state.get("at"), "options": options} if options else None


def records_of(data: dict) -> dict:
    """What the business's own records show, for the model to answer from (the owner, 28 Oct: called "pre-revenue" with
    ₦994,276 received)."""
    from datetime import date
    from app.modules.agent import figures, research
    paid = research.paid_invoices(data, date.today())
    f = figures.of(data)
    ccy = research.task_currency(data)
    return {"revenue_received_all_time": research.money(sum(v for _i, _d, v in paid), ccy) if paid else None,
            "monthly_revenue": research.money(f["revenue_monthly"], ccy) if f.get("revenue_monthly") else None,
            "paid_invoices": len(paid), "trading": bool(paid), "paying_customers": f.get("clients") or 0}


def _figures(case: dict | None) -> dict:
    """The case as the model sees it: the fields it may change, the score and what is still to do."""
    if not case:
        return {"exists": False}
    data, summary = case.get("data") or {}, case.get("summary") or {}
    return {"exists": True, "title": case.get("title") or data.get("title"),
            **{k: data.get(k) for k in ("target_amount", "currency", "purpose", "route_preference", "receipt_date", "stage") if data.get(k) not in (None, "")},
            **{k: (data.get("economics") or {}).get(k) for k in _ECONOMICS if (data.get("economics") or {}).get(k) not in (None, "")},
            "score_out_of_100": summary.get("score"), "score_so_far": bool(summary.get("score_partial")), "classification": summary.get("classification"),
            "things_to_do": summary.get("open_actions"), "next": (summary.get("next_action") or {}).get("title"),
            "blockers": [b.get("label") for b in summary.get("blockers") or []][:3], "research": case.get("research")}


def clean_change(change: Any) -> dict:
    """Only the case's own fields, each as the form takes it; anything else is dropped (never the workspace profile)."""
    out: dict = {}
    if not isinstance(change, dict):
        return out
    try:
        amount = float(str(change.get("target_amount")).replace(",", "")) if change.get("target_amount") not in (None, "") else None
    except ValueError:
        amount = None
    if amount and amount > 0:
        out["target_amount"] = round(amount, 2)
    cur = str(change.get("currency") or "").strip().upper()
    if re.fullmatch(r"[A-Z]{3}", cur):
        out["currency"] = cur
    purpose = " ".join(str(change.get("purpose") or "").split())[:300]
    if purpose:
        out["purpose"] = purpose
    route = str(change.get("route_preference") or "").strip().lower()
    if route in ROUTES:
        out["route_preference"] = route
    day = str(change.get("receipt_date") or "").strip()[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        out["receipt_date"] = day
    stage = str(change.get("stage") or "").strip().lower()
    if stage in STAGES:
        out["stage"] = stage
    for k in _ECONOMICS:
        try:
            v = float(str(change.get(k)).replace(",", "")) if change.get(k) not in (None, "") else None
        except ValueError:
            v = None
        if v is not None and v >= 0:
            out[k] = round(v, 2)
    return out


_ECONOMICS = ("fixed_costs_monthly", "price")      # said in chat, kept under the case's economics


_ROUTE_WORDS = {"loan": r"\b(?:loan|borrow|debt|bank)", "grant": r"\bgrant", "equity": r"\b(?:equity|invest|investors?|shares?|stake)", "unsure": r"\b(?:not sure|unsure|don'?t know)"}
_STAGE_WORDS = {"idea": r"\bidea\b", "pre_revenue": r"\b(?:not trading|pre.?revenue|no sales|haven'?t started)", "trading": r"\b(?:trading|selling|customers|revenue)",
                "growing": r"\b(?:growing|grow|scal)"}
_STOP = {"the", "a", "an", "for", "to", "of", "and", "my", "our", "it", "is", "in", "on", "with", "new", "need", "want", "funding", "money"}


def _figures_in(text: str) -> set[float]:
    """Every amount said: "200k", "₦25m", "25 million", "60,000"."""
    out = set()
    for n, unit in re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*(k|m|bn|b|thousand|million|billion)?\b", str(text or "").lower()):
        v = float(n.replace(",", ""))
        v *= {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "bn": 1e9, "billion": 1e9}.get(unit, 1)
        out.add(round(v, 2))
    return out


def grounded(change: dict, said: str) -> dict:
    """Only what the owner said (the owner, 27 Oct: "I want a new one" set ₦200,000 for equipment from an old conversation):
    an amount said in their words, a purpose sharing their words, a kind of funding, timing or stage they named."""
    t = str(said or "").lower()
    out = {}
    for k, v in change.items():
        if k in ("target_amount", *_ECONOMICS):
            ok = any(abs(v - f) <= max(1, v * 0.001) for f in _figures_in(t))
        elif k == "purpose":
            words = {w for w in re.findall(r"[a-z]{3,}", str(v).lower()) if w not in _STOP}
            ok = bool(words & set(re.findall(r"[a-z]{3,}", t)))
        elif k == "route_preference":
            ok = bool(re.search(_ROUTE_WORDS.get(v, r"$^"), t))
        elif k == "stage":
            ok = bool(re.search(_STAGE_WORDS.get(v, r"$^"), t))
        elif k == "currency":
            ok = bool(re.search(r"[£$€₦]|\b(?:naira|pounds?|dollars?|euros?|ngn|gbp|usd|eur|ghs|kes)\b", t))
        else:      # receipt_date: a time said
            ok = bool(re.search(r"\b(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|month|week|year|soon|asap|quarter)", t))
        if ok:
            out[k] = v
    return out


_SIGN = {"$": "USD", "£": "GBP", "€": "EUR", "₦": "NGN"}


def need_in(text: str, data: dict | None = None) -> dict:
    """A funding need as the owner said it ("funding readiness for working capital of $27000"): the amount, its currency, what
    it's for and the kind of funding, each only when said. {} when no amount is said."""
    t = str(text or "")
    figures = sorted(_figures_in(t))
    if not figures or figures[-1] <= 0:
        return {}
    out: dict = {"target_amount": figures[-1]}
    sign = re.search(r"[$£€₦]|\b(naira|pounds?|dollars?|euros?|ngn|gbp|usd|eur)\b", t, re.I)
    if sign:
        w = sign.group(0).lower()
        out["currency"] = _SIGN.get(sign.group(0)) or {"naira": "NGN", "pound": "GBP", "pounds": "GBP", "dollar": "USD", "dollars": "USD",
                                                       "euro": "EUR", "euros": "EUR"}.get(w) or w.upper()
    m = re.search(r"\bfor\s+(?:a\s+|an\s+|the\s+|my\s+|our\s+)?(.+?)(?=\s+(?:of|worth|at|about|around)\s+[$£€₦]?\d|\s+[$£€₦]\d|[.?!,]|$)", t, re.I)
    if m and m.group(1).strip().lower() not in ("funding", "readiness", "funding readiness") and not re.match(r"^[$£€₦]?\d", m.group(1).strip()):
        out["purpose"] = m.group(1).strip()[:300]
    for route, pattern in _ROUTE_WORDS.items():
        if route != "unsure" and re.search(pattern, t, re.I):
            out["route_preference"] = route
            break
    return clean_change(out)


def _parse(text: str) -> dict:
    m = re.search(r"\{.*\}", str(text or ""), re.S)
    try:
        got = json.loads(m.group(0)) if m else {}
    except ValueError:
        got = {}
    return got if isinstance(got, dict) else {}


async def turn(*, orch, user: dict, business_id: str, text: str, llm=None, now: datetime | None = None, history: list[dict] | None = None) -> dict | None:
    """One message in the funding conversation: {"kind": "answer", "message", "actions"}; None when there is no model or it
    can't answer (the scripted chat then carries on, as before)."""
    from app.modules.agent.router import _subjects_with_summary
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    now = now or datetime.now(timezone.utc)
    if llm is None:
        from app.modules.agent import research
        llm = research._default_llm(user["id"])
    if llm is None:
        return None
    try:
        cases = await _subjects_with_summary(user, business_id, "funding")
    except Exception:      # noqa: BLE001 - no access or no module: the scripted chat answers
        return None
    # The case the dashboard shows (the owner, 27 Oct: the Agent spoke of another case than the pinned one), else the newest
    from app.modules.agent import assessment_summary
    try:
        shown = (await assessment_summary.current(orch, user["id"], business_id, "funding", user.get("email")) or {}).get("case_id")
    except Exception:      # noqa: BLE001
        shown = None
    case = next((c for c in cases if str(c["id"]) == str(shown)), None) or (cases[0] if cases else None)
    data = await orch.rt.business.load(business_id) or {}
    mine = ((data.get("agent_conversations") or {}).get(str(user["id"])) or {}) if in_conversation(data, user["id"], now) else {}
    turns = list(mine.get("turns") or [])[-MAX_TURNS:]
    if not turns and history:      # an earlier conversation, opened again: what was said there
        turns = [{"role": "owner" if h.get("role") == "user" else "agent", "text": str(h.get("content") or "")[:500]} for h in history if h.get("content")][-MAX_TURNS:]
    if case:
        from app.modules.agent import research as _research
        case = {**case, "research": _research.research_state(data, "need_funding")}
    asked = mine.get("pending_do_all")
    if asked and case and (_yes(text) or _YES_LEAD.match(str(text))):
        return await _start_do_all(orch, user, business_id, case, asked, text, now)
    if asked and _no(text):
        return await _said(orch, user, business_id, text, "No problem, nothing was started or charged.", [], now)
    if case and asks_help(text) and not ASKS_OPTIONS.search(str(text)):
        return await _ask_do_all(orch, user, business_id, case, data, text, now)      # its price, the chooser, then the yes
    if case and ASKS_OPTIONS.search(str(text)):
        # Which loans, grants or investors fit: the researched ones, each with where it was found; else said that research is
        # needed, with its price (the owner, 28 Oct: "got generic advice")
        found = None if re.search(r"\bresearch\b", str(text), re.I) else options_found(data)      # "Research …": always a new search
        if not found:      # the loans, grants and investors that fit this case, searched for on their own (the owner, 28 Oct)
            return await _ask_do_all(orch, user, business_id, case, data, text, now, only=OPTIONS_ONLY)
        lines = " ".join(f"{n}. {o['title']}: {str(o['text']).rstrip('.')}. ({o['fits']['fit']} fit; source: {o['source'].get('url')})"
                         for n, o in enumerate(found["options"], 1))
        return await _said(orch, user, business_id, text, f"From your research of {found['at']}, these fit your case: {lines} Ask me about any of them, or to research again.",
                           [{"label": "Research again", "kind": "explain", "prompt": "Research it for me"}], now)
    svc = service_for(orch)
    # A change is shown with Apply and Cancel and made only on Apply (the owner, 27 Oct: "the agent must not say I'll update
    # your case unless it actually updates it"); "replace or update?" is answered with its buttons
    held, which = mine.get("pending_change"), mine.get("pending_which")
    if mine.get("last_change") and _UNDO.match(str(text)):
        return await _undone(orch, svc, user, business_id, mine["last_change"], text, now)
    if held and held.get("fields") and (_APPLY.match(str(text)) or _yes(text)):
        return await _fields_applied(orch, svc, user, business_id, case, held, text, now)
    if held and (_APPLY.match(str(text)) or _yes(text)):
        return await _applied(orch, svc, user, business_id, case, held.get("change") or {}, bool(held.get("replace")), text, now, data)
    if held and _CANCEL.match(str(text)):
        return await _said(orch, user, business_id, text, "Cancelled. Nothing was changed.", [], now)
    if which and case:
        # Their answer to "replace or update?" (the owner, 28 Oct: "new one" asked again, then "Replace it" lost the $27,000):
        # the need held when it was asked, else read again from what they said before
        held_change = which.get("change") or next((n for n in (need_in(t.get("text") or "", data) for t in reversed(turns) if t.get("role") == "owner") if n), {})
        if not held_change:
            which = None      # nothing to replace or update with (the owner, 28 Oct: "There's nothing to change now")
    if which and case:
        if re.search(r"\b(?:replace|new|another|different|instead|separate)\b", str(text), re.I) and not re.search(r"\bupdat", str(text), re.I):
            return await _confirm(orch, user, business_id, case, held_change, True, text, now, data)
        if re.search(r"\b(?:updat|same|change it|amend)", str(text), re.I):
            return await _confirm(orch, user, business_id, case, held_change, False, text, now, data)
        if re.search(r"\b(?:both|in addition|as well|keep (?:it|them|the old))\b", str(text), re.I):
            return await _said(orch, user, business_id, text, "A business has one funding case, so I can't keep both. Should the new need replace your current one (the old one stays in your history), or update it?",
                               _WHICH_BUTTONS, now, keep={"pending_which": {"change": held_change}})
        if _yes(text) or _APPLY.match(str(text)):
            return await _said(orch, user, business_id, text, "Should it replace your current need (the old one stays in your history), or update it?",
                               _WHICH_BUTTONS, now, keep={"pending_which": which})
    named = field_change(text, case) if case else None
    if named and _same(named["before"], named["value"]):      # nothing to change: said so, never "Hilary → Hilary"
        return await _said(orch, user, business_id, text, f"{named['label']} is already set to {named['value']}.", [], now)
    if named:      # saved straight away, said with Undo (the owner, 28 Oct)
        return await _fields_applied(orch, svc, user, business_id, case, {"fields": {named["path"]: named["value"]}, "labels": {named["path"]: named["label"]},
                                                                         "before": {named["path"]: named["before"]}}, text, now)
    from app.modules.agent import draft_review
    from app.modules.readiness import rules as _rules
    waiting = await approvals_waiting(orch, business_id)
    prompt = json.dumps({"CASE": _figures(case), "RECORDS": records_of(data), "DRAFTS": draft_review.view(_rules.FUNDING, (case or {}).get("data") or {}) if case else [],
                         "WAITING": waiting, "TURNS": turns, "MESSAGE": str(text)[:2000]}, ensure_ascii=False, default=str)
    try:
        res = await asyncio.wait_for(llm.generate_text(system=_SYSTEM, prompt=prompt, feature="agent_conversation", max_tokens=500), MODEL_SECONDS)
    except Exception:      # noqa: BLE001 - the scripted chat answers instead
        logger.info("funding conversation: no model reply", exc_info=True)
        return None
    got = _parse(getattr(res, "text", "") or "")
    if asks_gaps(text):
        got["show"] = [*(got.get("show") if isinstance(got.get("show"), list) else []), "result"]
    say = " ".join(str(got.get("say") or "").split())
    if not say:
        return None
    say = say.replace("—", ", ").replace("–", " to ")      # no dashes in what the owner reads

    asking_which = False
    if case and _asks_which(say):
        if _CORRECTION.match(str(text)) and got.get("change"):
            got = {**got, "replace": False}      # a correction updates the need, never "replace or keep both?"
        else:
            asking_which = True      # asked: nothing changes until they say, with Replace and Update as buttons
    said = " ".join([str(text)] + [t.get("text") or "" for t in turns if t.get("role") == "owner"][-1:])      # this message and the one before
    wanted = clean_change(got.get("change"))
    change = grounded(wanted, said)
    dropped = [k for k in wanted if k not in change]
    if dropped and (not case or change or re.search(r"\b(?:new|another|different)\b", str(text), re.I)):
        # Never a change from words not said: what wasn't said is asked for instead
        need = [w for k, w in (("target_amount", "how much you need"), ("purpose", "what it's for"), ("route_preference", "whether it's a loan, a grant or investors"),
                               ("receipt_date", "when you need it"), ("stage", "where the business is now"), ("currency", "which currency")) if k in dropped]
        say = (("Got that. " if change else "") + "Before I set that up, tell me " + (need[0] if len(need) == 1 else ", ".join(need[:-1]) + " and " + need[-1]) + ".")
    elif dropped and _CLAIMS.search(say):
        say = "Tell me what you'd like to change and I'll show you the change before anything is saved."      # nothing was changed
    keep, actions, extra_cards = {}, [], []
    if change and (case or (change.get("target_amount") and change.get("purpose"))):
        doubt = _amount_doubt(change, case, str(text), data)
        if doubt:
            say, actions = doubt      # "₦25,000 or ₦25,000,000?", each a button
        elif asking_which:
            keep["pending_which"] = {"change": change}
            actions = list(_WHICH_BUTTONS)
        else:      # what they said is saved straight away and said in one line (the owner, 28 Oct)
            return await _applied(orch, svc, user, business_id, case, change, bool(got.get("replace")) and bool(case), text, now, data)
    elif asking_which:
        keep["pending_which"] = {"change": need_in(str(text), data) or {}}
        actions = list(_WHICH_BUTTONS)
        say = re.sub(r"[^.?!]*\b(?:keep both|both separate|separately|in addition|alongside)\b[^.?!]*[.?!]?", "", say).strip() \
            or "Should this replace your current funding need (the old one stays in your history), or update it?"
    done: list[str] = []
    try:
        if case and await apply_drafts(svc, user, business_id, rules.FUNDING, case["id"], text, got, now):
            done.append("adopted")      # on the owner's own word about the drafts
        if case and ((got.get("check") and not keep) or done):
            fresh = await svc.store.get("subjects", case["id"])
            await svc.request_assessment(user["id"], business_id, rules.FUNDING, case["id"], idempotency_key=f"converse:{case['id']}:{(fresh or {}).get('revision')}",
                                         email=user.get("email"))
            done.append("checked")
    except Exception:      # noqa: BLE001 - said plainly, nothing half-done claimed
        logger.warning("funding conversation: the case could not be updated for %s", business_id, exc_info=True)
        say = "I couldn't update your funding case just now. Nothing was changed; please try again."
        done = []

    if not done and not keep and case and _PRICE_SAID.search(say):
        return await _ask_do_all(orch, user, business_id, case, data, text, now)      # its real price, in credits (the owner, 28 Oct: "₦50,000 how?")
    if not done and not keep and not got.get("do_all") and case and _RESEARCH_CLAIM.search(say):
        return await _ask_do_all(orch, user, business_id, case, data, text, now)      # the price first, then the real start
    if not done and not keep and _UPDATE_CLAIM.search(say):
        say = "Nothing has been changed yet. Tell me what you'd like to change and I'll show you the change before anything is saved."
    got["_done"] = done
    before, after = ((case or {}).get("summary") or {}).get("score"), None
    if "checked" in done:
        after, line = await _score_now(user, business_id, before)
        say += line      # only when it moved (the owner, 27 Oct: not "Your score is now 73/100" after every reply)

    if got.get("do_all") and case and not done and not keep:
        return await _ask_do_all(orch, user, business_id, case, data, text, now)
    to = f"/funding/{case['id']}?tab=overview" if case else None
    if not actions:
        for b in (got.get("buttons") or [])[:3]:
            kind = (b or {}).get("kind") if isinstance(b, dict) else None
            if kind == "open_case" and to:
                actions.append({"label": "Open your funding case", "to": to})
            elif kind == "do_all" and to:
                actions.append({"label": "Do all for me", "to": to})      # its price first, on the case page's own button
            elif kind == "reply" and str(b.get("label") or "").strip() and str(b.get("text") or "").strip() \
                    and not _BOTH.search(f"{b.get('label')} {b.get('text')}"):      # one funding case: never "keep both"
                actions.append({"label": str(b["label"]).strip()[:40], "kind": "explain", "prompt": str(b["text"]).strip()[:300]})
    cards = cards_for(got, not turns, bool(case), str(case["id"]) if case else None, before, after, bool(waiting)) + extra_cards
    out = await _said(orch, user, business_id, text, say, actions, now, keep=keep, cards=cards)
    return {**out, "changed": done}


_APPLY = re.compile(r"^\s*(?:apply(?: it| that| the change| them)?|confirm|yes,? apply(?: it)?|go ahead and apply)\b[\s.!]*$", re.I)
_CANCEL = re.compile(r"^\s*(?:cancel|no|nope|don'?t|leave it|never mind|not now|keep it as it is)\b", re.I)
_YES_LEAD = re.compile(r"^\s*(?:yes|yeah|yep|ok|okay|sure|go ahead|please do|do it)\b(?!.*\b(?:but|not|don'?t|no)\b)", re.I)
# Said as done or started when it wasn't (the owner, 28 Oct: "I have started the research" with nothing running)
_RESEARCH_CLAIM = re.compile(r"\b(?:let me (?:do|get|start) (?:that|it|this|on it)(?: for you)?(?: now)?|i(?:'ll| will) (?:start by |now )?(?:research|gather|look (?:up|into)|find)|"
                             r"i(?:'ve| have)? (?:started|begun|begin|kicked off)|i(?:'ll| will) (?:start|begin) (?:the )?research|i'?m (?:now )?(?:researching|looking into|gathering))"
                             r"|\bresearch(?:ing)? (?:has |is )?(?:started|underway|under way|in progress|running)", re.I)
# A price the model said for the work (only the app's quote says one, in credits)
_PRICE_SAID = re.compile(r"\b(?:price|cost|fee|charge)s?\b[^.?!]{0,60}(?:[₦£$€]\s?\d|\d[\d,]*\s*(?:naira|pounds?|dollars?|credits?)\b)"
                         r"|\b(?:it|this|that) (?:costs?|will cost|is) [₦£$€]?\d", re.I)
_UPDATE_CLAIM = re.compile(r"\b(?:i(?:'ve| have) (?:updated|changed|saved|set|replaced|added|recorded)|(?:it'?s|that'?s|has been|is now) (?:updated|changed|saved|set))\b", re.I)
_CLAIMS = re.compile(r"\b(?:i'?ve|i have|i'?ll|i will|done|updated|changed|replaced|set (?:it|that|your|up))\b", re.I)
_WHICH_BUTTONS = [{"label": "Replace it", "kind": "explain", "prompt": "Replace it"}, {"label": "Update it", "kind": "explain", "prompt": "Update it"}]
_LABEL = {"target_amount": "Amount", "currency": "Currency", "purpose": "What it's for", "route_preference": "Kind of funding", "receipt_date": "When you need it",
          "stage": "Stage", "fixed_costs_monthly": "Fixed costs", "price": "Price per sale"}
_WORDS = {"loan": "A loan", "grant": "A grant", "equity": "Investors", "unsure": "Not sure yet", "idea": "Just an idea", "pre_revenue": "Not trading yet",
          "trading": "Trading", "growing": "Trading and growing"}


def _show(key: str, value: Any, currency: str) -> str:
    if value in (None, ""):
        return "Not set"
    if key in ("target_amount", *_ECONOMICS):
        from app.modules.agent.research import money
        try:
            return money(float(str(value).replace(",", "")), currency) + (" a month" if key == "fixed_costs_monthly" else "")
        except ValueError:
            return str(value)
    return _WORDS.get(str(value), str(value))


def _change_rows(change: dict, before: dict, data: dict) -> list[dict]:
    """The change as the card shows it: each field, what it is now and what it would be."""
    from app.modules.agent import business as bz
    currency = str(change.get("currency") or before.get("currency") or bz.currency_of(data) or "GBP")
    return [{"label": _LABEL.get(k, k), "before": _show(k, before.get(k), currency), "after": _show(k, v, currency)} for k, v in change.items()]


def _amount_doubt(change: dict, case: dict | None, text: str, data: dict):
    """An amount a thousand or a million times off the case's, typed without a unit ("25000" against ₦25m): asked, with
    both as buttons (the owner, 27 Oct)."""
    from app.modules.agent import business as bz
    from app.modules.agent.research import money
    new = change.get("target_amount")
    try:
        old = float(str(((case or {}).get("data") or {}).get("target_amount") or "").replace(",", ""))
    except ValueError:
        old = 0
    if not new or not old or re.search(r"\d\s*(?:k|m|bn|thousand|million|billion)\b", text, re.I):
        return None
    currency = str(change.get("currency") or ((case or {}).get("data") or {}).get("currency") or bz.currency_of(data) or "GBP")
    if money(new, currency) in text:
        return None      # one of the two picked ("Make it ₦25,000"): asked once, never again
    for f in (1e3, 1e6):
        if abs(new * f - old) <= old * 0.01:
            a, b = money(new, currency), money(new * f, currency)
            return f"Did you mean {a} or {b}?", [{"label": a, "kind": "explain", "prompt": f"Make it {a}"}, {"label": b, "kind": "explain", "prompt": f"Make it {b}"}]
    return None


async def _score_now(user: dict, business_id: str, before: Any) -> tuple[Any, str]:
    """The score after a check, and a line about it only when it moved."""
    from app.modules.agent.router import _subjects_with_summary
    try:
        fresh = await _subjects_with_summary(user, business_id, "funding")
        s = ((fresh[0] if fresh else {}) or {}).get("summary") or {}
    except Exception:      # noqa: BLE001
        return None, ""
    after = s.get("score") if isinstance(s.get("score"), (int, float)) else None
    if after is None or (isinstance(before, (int, float)) and round(before) == round(after)):
        return after, ""
    left = s.get("open_actions")
    return after, (f" Your score is now {round(after)}/100{' so far' if s.get('score_partial') else ''}"
                   + (f", with {left} thing{'s' if left != 1 else ''} to do." if isinstance(left, int) and left else "."))


async def _confirm(orch, user: dict, business_id: str, case: dict, change: dict, replace: bool, text: str, now: datetime, data: dict) -> dict:
    """The change, shown with Apply and Cancel: nothing is written until Apply."""
    if not change:
        return await _said(orch, user, business_id, text, "There's nothing to change now. Tell me what you'd like to change.", [], now)
    doubt = _amount_doubt(change, case, str(text), data)
    if doubt:
        return await _said(orch, user, business_id, text, doubt[0], doubt[1], now)
    from app.modules.readiness.service import service_for
    return await _applied(orch, service_for(orch), user, business_id, case, change, replace, text, now, data)


_APPLY_BUTTONS = ({"label": "Apply", "kind": "explain", "prompt": "Apply"}, {"label": "Cancel", "kind": "explain", "prompt": "Cancel"})


_EDIT_NAMED = re.compile(r"^\s*(?:please\s+|can you\s+|could you\s+)?(?:change|set|update|make|put)\s+(?P<what>.+?)\s+(?:to|as)\s+(?P<value>.+?)\s*[.!]?\s*$", re.I)
_STOP = {"the", "a", "an", "my", "our", "of", "for", "who", "what", "is", "on", "in", "case", "field", "please", "funding"}


def field_change(text: str, case: dict) -> dict | None:
    """A field of the case changed by its name, as the checklist asks it ("who owns customer acquisition" is "Who owns
    customer acquisition?"): {path, label, value, before}; None when no field is named. Amounts, dates and the need itself go
    their own way (case_edit, the model): only plain text fields here."""
    from app.modules.readiness import engine, rules
    m = _EDIT_NAMED.match(str(text or ""))
    if not m:
        return None
    words = {w for w in re.findall(r"[a-z]+", m.group("what").lower()) if w not in _STOP}
    if not words:
        return None
    data = case.get("data") or {}
    try:
        profile = rules.get_profile(data.get("profile") or rules.CURRENT[rules.FUNDING])
    except Exception:      # noqa: BLE001
        return None
    best = None
    for sec in profile.get("sections") or []:
        for fld in sec.get("fields") or []:
            if fld.get("type", "text") not in ("text", "textarea") or "." not in str(fld.get("key")):
                continue
            label = {w for w in re.findall(r"[a-z]+", str(fld.get("label")).lower()) if w not in _STOP}
            if words <= label and (best is None or len(label) < len(best[1])):
                best = (fld, label)
    if not best:
        return None
    value = " ".join(m.group("value").split()).strip(" .\"'")[:300]
    if not value:
        return None
    return {"path": best[0]["key"], "label": str(best[0]["label"]).rstrip("?"), "value": value, "before": engine.get(data, best[0]["key"])}


def _same(a, b) -> bool:
    """The same value, whether held as a number or as text ("25000000.0" and 25000000, "Hilary" and " hilary ")."""
    try:
        return float(str(a).replace(",", "")) == float(str(b).replace(",", ""))
    except (TypeError, ValueError):
        return a not in (None, "") and " ".join(str(a).lower().split()) == " ".join(str(b).lower().split())


def _shown_value(v) -> str:
    return "Not set" if v in (None, "", [], {}) else str(v)


async def _fields_applied(orch, svc, user: dict, business_id: str, case: dict, held: dict, text: str, now: datetime) -> dict:
    """Applied: the named fields saved in the case, read back to be sure, and said only once they are (the owner, 28 Oct:
    "confirm the change is saved")."""
    from app.modules.readiness import engine, rules
    fields = held.get("fields") or {}
    try:
        row = await svc.store.get("subjects", case["id"])
        data = (row or {}).get("data") or {}
        patch: dict = {}
        for path, value in fields.items():
            top, _, rest = path.partition(".")
            patch[top] = {**(patch.get(top) or data.get(top) or {}), rest: value} if rest else value
        stamp = {p: f"From you, {now.day} {now.strftime('%b')}" for p in fields}
        old_prov = data.get("provenance") or {}
        undo = {"case_id": str(case["id"]), "data": {top: data.get(top) for top in patch},
                "sources": {p: old_prov[p].get("source") for p in fields if isinstance(old_prov.get(p), dict) and old_prov[p].get("source")}}
        await svc.update_subject(user["id"], business_id, rules.FUNDING, case["id"], row["revision"], patch, user.get("email"), provenance=stamp)
        fresh = (await svc.store.get("subjects", case["id"]) or {}).get("data") or {}
        saved = all(str(engine.get(fresh, p)) == str(v) for p, v in fields.items())
    except Exception:      # noqa: BLE001 - said plainly, nothing half-done claimed
        logger.warning("funding conversation: a field could not be saved for %s", business_id, exc_info=True)
        saved = False
    if not saved:
        return await _said(orch, user, business_id, text, "I couldn't save that just now. Nothing was changed; please try again.", [], now)
    labels, was = held.get("labels") or {}, held.get("before") or {}
    said = "; ".join(f"{labels.get(p, p)}: {_shown_value(was.get(p))} → {v}" if p in was else f"{labels.get(p, p)}: {v}" for p, v in fields.items())
    out = await _said(orch, user, business_id, text, f"Updated {said}.", [{"label": "Undo", "kind": "explain", "prompt": "Undo"}], now, keep={"last_change": undo})
    return {**out, "changed": ["updated"], "case_id": str(case["id"])}


async def _applied(orch, svc, user: dict, business_id: str, case: dict | None, change: dict, replace: bool, text: str, now: datetime, data: dict) -> dict:
    """The change the owner applied: made, checked, and said with the score when it moved."""
    from app.modules.agent import goals
    from app.modules.readiness import rules
    if not change:
        return await _said(orch, user, business_id, text, "There's nothing to apply now. Tell me what you'd like to change.", [], now)
    if case and not replace:
        held = (case.get("data") or {})
        olds = {**held, **(held.get("economics") or {})}
        same = {k: v for k, v in change.items() if _same(olds.get(k), v)}
        change = {k: v for k, v in change.items() if k not in same}
        if not change:      # all of it as it is already: said so, nothing saved (the owner, 28 Oct)
            from app.modules.agent import business as bz
            currency = str(held.get("currency") or bz.currency_of(data) or "GBP")
            said = "; ".join(f"{_LABEL.get(k, k)} is already set to {_show(k, v, currency)}" for k, v in same.items())
            return await _said(orch, user, business_id, text, f"{said}.", [], now)
    stamp = {(f"economics.{p}" if p in _ECONOMICS else p): f"From you, {now.day} {now.strftime('%b')}" for p in change}
    done: list[str] = []
    before = ((case or {}).get("summary") or {}).get("score")
    undo, extra, econ, was = None, "", {}, {}
    try:
        if case:
            row = await svc.store.get("subjects", case["id"])
            was = (row or {}).get("data") or {}
            econ = {k: v for k, v in change.items() if k in _ECONOMICS}
            change = {k: v for k, v in change.items() if k not in _ECONOMICS}
            if econ:
                change["economics"] = {**(was.get("economics") or {}), **econ}
            mine = {**(was.get("provenance") or {}), **{p: {"source": v} for p, v in stamp.items()}}
            follow = {"target_amount", "purpose"} & set(change) or (econ.get("fixed_costs_monthly") is not None and was.get("use_of_funds"))
            lines = svc.lines_for_request(was, {**change, "provenance": mine}) if follow else None      # the lines follow
            if replace:
                after_data = {**was, **change}
                await svc.replace_need(user["id"], business_id, case["id"], {**change, "title": goals.need_title(after_data), **({"use_of_funds": lines} if lines else {})},
                                       user.get("email"), provenance=stamp, summary=goals.need_summary(was))
                done.append("replaced")
            else:
                patch = {**change, **({"use_of_funds": lines} if lines else {})}
                if {"target_amount", "purpose", "route_preference"} & set(change) and goals.is_made_title(was.get("title"), was):
                    patch["title"] = goals.need_title({**was, **change})      # a title made from the need follows it
                await svc.update_subject(user["id"], business_id, rules.FUNDING, case["id"], row["revision"], patch, user.get("email"), provenance=stamp)
                done.append("updated")
                old_prov = was.get("provenance") or {}
                undo = {"case_id": str(case["id"]), "data": {k: was.get(k) for k in patch},
                        "sources": {p: old_prov[p].get("source") for p in stamp if isinstance(old_prov.get(p), dict) and old_prov[p].get("source")}}
                fixed_lines = [x for x in lines or [] if "fixed costs" in str(x.get("purpose") or "").lower()]
                if fixed_lines and all(str(x.get("amount") or "") == "" for x in fixed_lines):
                    extra = " Tell me your monthly fixed costs and I'll work out working capital and reserve."
                elif fixed_lines:
                    extra = " Working capital and reserve recalculated."
        else:
            made = await svc.create_subject(user["id"], business_id, rules.FUNDING, {**change, "title": goals.need_title(change), "pinned": True},
                                            user.get("email"), provenance=stamp)
            case = {"id": made["id"], "title": made.get("data", {}).get("title")}
            done.append("created")
        fresh = await svc.store.get("subjects", case["id"])
        await svc.request_assessment(user["id"], business_id, rules.FUNDING, case["id"], idempotency_key=f"converse:{case['id']}:{(fresh or {}).get('revision')}",
                                     email=user.get("email"))
        done.append("checked")
    except Exception:      # noqa: BLE001 - said plainly, nothing half-done claimed
        logger.warning("funding conversation: the change could not be applied for %s", business_id, exc_info=True)
        return await _said(orch, user, business_id, text, "I couldn't apply that just now. Nothing was changed; please try again.", [], now)
    after, line = await _score_now(user, business_id, before)
    cards = [{"type": "score_change", "case_id": str(case["id"]), "before": round(before), "after": round(after)}] \
        if isinstance(before, (int, float)) and isinstance(after, (int, float)) and round(before) != round(after) else []
    if undo:
        # One short line on what changed, with Undo (the owner, 28 Oct: "Updated fixed costs: ₦40,000 → ₦60,000 a month")
        from app.modules.agent import business as bz
        currency = str(was.get("currency") or bz.currency_of(data) or "GBP")
        flat = {**{k: v for k, v in change.items() if k != "economics"}, **econ}
        olds = {**was, **(was.get("economics") or {})}
        said = "; ".join(f"{_LABEL.get(k, k).lower()}: {_show(k, olds.get(k), currency)} → {_show(k, v, currency)}" for k, v in flat.items())
        out = await _said(orch, user, business_id, text, f"Updated {said}.{extra}{line}", [{"label": "Undo", "kind": "explain", "prompt": "Undo"}], now,
                          keep={"last_change": undo}, cards=cards)
        return {**out, "changed": done, "case_id": str(case["id"])}
    word = {"replaced": "replaced your funding need (the old one is in your history)", "updated": "updated your funding case",
            "created": "set up your funding case"}[done[0]]
    out = await _said(orch, user, business_id, text, f"Done. I've {word}.{line}", [], now, cards=cards)
    return {**out, "changed": done, "case_id": str(case["id"])}


_UNDO = re.compile(r"^\s*undo(?: (?:it|that|the (?:last )?change))?\b[\s.!]*$", re.I)


async def _undone(orch, svc, user: dict, business_id: str, held: dict, text: str, now: datetime) -> dict:
    """Undo: the fields the last change saved put back as they were, with where they came from, and the case checked again."""
    from app.modules.readiness import rules
    try:
        row = await svc.store.get("subjects", held["case_id"])
        await svc.update_subject(user["id"], business_id, rules.FUNDING, held["case_id"], row["revision"], held.get("data") or {}, user.get("email"),
                                 provenance=held.get("sources") or None)
        fresh = await svc.store.get("subjects", held["case_id"])
        await svc.request_assessment(user["id"], business_id, rules.FUNDING, held["case_id"], idempotency_key=f"converse:{held['case_id']}:{(fresh or {}).get('revision')}",
                                     email=user.get("email"))
    except Exception:      # noqa: BLE001 - said plainly, nothing half-done claimed
        logger.warning("funding conversation: the change could not be undone for %s", business_id, exc_info=True)
        return await _said(orch, user, business_id, text, "I couldn't undo that just now. Your case still has the change; please try again.", [], now)
    out = await _said(orch, user, business_id, text, "Undone. Your case is back as it was.", [], now)
    return {**out, "changed": ["updated", "checked"], "case_id": str(held["case_id"])}


_SHOW = {"records", "result", "next", "approvals"}


def cards_for(got: dict, first: bool, has_case: bool, case_id: str | None, before: Any, after: Any, approvals: bool = False) -> list[dict]:
    """The cards a reply carries in the conversation (the owner's mockups, 27 Oct): what was checked in the records and the
    result on a conversation's first look at the case, or when the model shows them; the score before and after a change."""
    if not has_case:
        return []
    asked = [s for s in (got.get("show") or []) if s in _SHOW] if isinstance(got.get("show"), list) else []
    want = (["records", "result"] if first and not asked else []) + asked
    if "adopted" in (got.get("_done") or []):
        want.append("next")      # drafts accepted: what to do next, as the mockups end
    if approvals and "next" in want:
        want.append("approvals")      # and what is waiting for their approval
    out = [{"type": k, "case_id": case_id} for k in dict.fromkeys(want) if k != "approvals" or approvals]
    if isinstance(after, (int, float)) and isinstance(before, (int, float)) and round(after) != round(before):
        out.append({"type": "score_change", "case_id": case_id, "before": round(before), "after": round(after)})
    return out


async def apply_drafts(svc, user: dict, business_id: str, subject_type: str, case_id: str, text: str, got: dict, now) -> bool:
    """The owner's decision on the drafts, in their words: applied to the case (accepted ones in their fields, the rest off)."""
    from app.modules.agent import draft_review
    if not got.get("drafts"):
        return False
    row = await svc.store.get("subjects", case_id)
    dec = draft_review.decided(str(text), got.get("drafts"), (row or {}).get("data") or {})
    if not dec:
        return False
    stamp = {p: f"Accepted from the Agent's draft in your conversation, {now.day} {now.strftime('%b')}" for p in dec["accept"]}
    await svc.update_subject(user["id"], business_id, subject_type, case_id, row["revision"], draft_review.changes_for(dec, row["data"] or {}),
                             user.get("email"), provenance=stamp)
    return True


async def approvals_waiting(orch, business_id: str) -> list[str]:
    """What is waiting for the owner's approval (an invoice reminder, a quotation), by title."""
    from app.modules.agent import summary as summary_mod
    try:
        now = orch.rt.clock()
        return [summary_mod.approval_card(a, now)["title"] for a in await summary_mod.pending_approvals(orch.rt.store, business_id, now)][:5]
    except Exception:      # noqa: BLE001
        return []

# Two things the owner says that always mean the same (the owner's test, 27 Oct: "Help me complete it" was answered by asking
# for milestones; "What's missing?" got prose with no card): the research and drafting, asked with its price first; the gaps card
HELP = re.compile(r"\b(?:help me (?:complete|finish|fill|do) (?:it|this|them|the rest|everything)|complete it for me|do (?:it )?all for me|do it for me|"
                  r"(?:get|do|find|gather|fill) (?:it )?(?:all|everything)(?: (?:for me|of it|requirements?|that'?s needed|needed))?|get (?:all|everything) (?:i|we) need|"
                  r"fill (?:it|them|the gaps) in for me|research (?:it|and draft)|prepare (?:the )?missing|research it for me)\b", re.I)
MISSING = re.compile(r"\b(?:what(?:'| i)?s (?:missing|left|holding (?:it|me) back)|what (?:is|are) (?:still )?(?:missing|left)|what(?:'s| is| are) the gaps|"
                     r"what do i (?:still )?need|show (?:me )?the gaps)\b", re.I)


def asks_gaps(text: str) -> bool:
    return bool(MISSING.search(str(text or "")))


def asks_help(text: str) -> bool:
    return bool(HELP.search(str(text or "")))


_YES = re.compile(r"^\s*(?:yes|yeah|yep|ok|okay|sure|go ahead|go on|do it|start(?: it)?(?: do all for me)?|proceed|please do|let'?s do it|go for it)\b[\s.!,]*(?:start|please)?[\s.!]*$", re.I)
_CORRECTION = re.compile(r"^\s*(?:(?:ok(?:ay)?|actually|no|sorry)[,\s]+)*(?:make it|change it|change that|change the|update it|update that|update the|set it to|let'?s make it|let'?s say)\b", re.I)
_BOTH = re.compile(r"\b(?:keep both|both options|both needs|separately|alongside|second case)\b", re.I)


def _asks_which(say: str) -> bool:
    """The reply asks whether the new need replaces the current one (or offers to keep both)."""
    return "?" in say and bool(re.search(r"\breplace", say, re.I) or _BOTH.search(say)
                               or re.search(r"\b(?:in addition|on top of|as well as|another need|instead of)\b", say, re.I))      # "update it, or is this in addition?"


_NOPE = re.compile(r"^\s*(?:no|nope|not now|cancel|stop|later|leave it|never mind)\b[\s.!]*$", re.I)


def _yes(text: str) -> bool:
    return bool(_YES.match(str(text or "")))


def _no(text: str) -> bool:
    return bool(_NOPE.match(str(text or "")))


async def _said(orch, user: dict, business_id: str, text: str, say: str, actions: list, now: datetime, pending: dict | None = None,
                topic: str = "funding", keep: dict | None = None, cards: list | None = None) -> dict:
    """The reply, kept with the conversation (and what is waiting for a yes, if anything)."""
    def _keep(d: dict) -> None:
        convo = d.setdefault("agent_conversations", {})
        mine = convo.get(str(user["id"])) or {}
        kept = list(mine.get("turns") or []) if in_conversation(d, user["id"], now, topic) else []
        kept += [{"role": "owner", "text": str(text)[:500]}, {"role": "agent", "text": say[:500]}]
        convo[str(user["id"])] = {"topic": topic, "at": now.isoformat(), "turns": kept[-MAX_TURNS:], **(keep or {}),
                                  **({"pending_do_all": pending} if pending else {})}
    try:
        await orch.rt.business.mutate(business_id, _keep)
    except Exception:      # noqa: BLE001
        logger.info("funding conversation not kept for %s", business_id, exc_info=True)
    return {"kind": "answer", "message": say, "actions": actions, "conversational": True, **({"cards": cards} if cards else {})}


async def _session_for(orch, user: dict, business_id: str, case: dict, topic: str, now: datetime) -> str | None:
    """The research session for a case or plan that has none (made in a launch chat, on its form or from another flow): from
    what it holds now, kept with it as the chat's would be. None when it can't be made."""
    from app.modules.agent import goal_router, goals
    import secrets
    d = case.get("data") or {}
    if topic == "launch":
        goal = "launch"
        answers = {k: v for k, v in {"sell": d.get("name") or case.get("title"), "customer": d.get("audience"), "where": d.get("geography"),
                                     "target_date": d.get("target_date"), "price": (d.get("offer") or {}).get("price") or (d.get("economics") or {}).get("price_per_unit"),
                                     "cost": (d.get("economics") or {}).get("variable_cost_per_unit")}.items() if v not in (None, "")}
    else:
        goal = "need_funding"
        answers = goal_router._case_answers(d)
    stamp = now.isoformat()
    session = {"id": secrets.token_urlsafe(24), "state": "handed_off", "entry_mode": "free_text", "goal_key": goal, "original_goal": str(answers.get("sell") or d.get("title") or goal),
               "resolution": {"goal_key": goal}, "inputs": answers, "proposed": {}, "user_id": user["id"], "business_id": business_id, "currency": d.get("currency"),
               "handoff": {"subject_id": str(case["id"])}, "events": [], "created_at": stamp, "updated_at": stamp,
               "expires_at": (now + goals.timedelta(days=goals.SESSION_DAYS)).isoformat()}
    try:
        await goal_router.get_store().put(session)
        await orch.rt.business.mutate(business_id, lambda x: x.setdefault("chat_sessions", {}).__setitem__(str(case["id"]), session["id"]))
    except Exception:      # noqa: BLE001 - said plainly by the caller
        logger.warning("research session not made for %s", case.get("id"), exc_info=True)
        return None
    return session["id"]


async def _ask_do_all(orch, user: dict, business_id: str, case: dict, data: dict, text: str, now: datetime, topic: str = "funding",
                      keep: dict | None = None, only: list[str] | None = None) -> dict:
    """ "Do all for me", asked in the conversation (the owner, 27 Oct): what it researches and its price, then "Shall I start?". """
    from app.modules.agent import goal_router
    to, noun = (f"/launch/{case['id']}", "launch plan") if topic == "launch" else (f"/funding/{case['id']}?tab=overview", "funding case")
    said = lambda *a, **k: _said(*a, topic=topic, keep=keep, **k)      # noqa: E731
    sid = (data.get("chat_sessions") or {}).get(str(case["id"])) or await _session_for(orch, user, business_id, case, topic, now)
    if not sid:
        return await said(orch, user, business_id, text, f"I couldn't set up the research for this {noun} just now. Nothing was charged; please try again.", [], now)
    session, goal, d, answers, result = await goal_router._session_premium_context(sid, user)
    quote = await goal_router._premium_quote(user, goal, result, answers, d, only=only)
    fresh = False
    if only and quote.get("reuse"):
        from app.modules.agent import research as _research
        before = (_research._runs(d) or {}).get(quote["reuse"]) or {}
        if sorted(before.get("only") or []) != sorted(only):      # that run was the general one: this search hasn't run yet
            fresh = True
            quote = await goal_router._premium_quote(user, goal, result, answers, d, only=only, fresh=True)
    if not quote.get("allowed"):
        gate = quote.get("gate") or {}
        primary = gate.get("primary") or {}
        return await said(orch, user, business_id, text, gate.get("message") or "That isn't included in your plan yet.",
                          [{"label": primary.get("label") or "See plans", "to": primary.get("to") or "/pricing"}], now)
    topics = [str(t)[:1].lower() + str(t)[1:] for t in quote.get("topics") or []][:3]
    if only == OPTIONS_ONLY and not quote.get("topics") and not quote.get("reuse"):
        return await said(orch, user, business_id, text, "I couldn't set up a search for funding options for this case just now. Nothing was charged; please try again.", [], now)
    what = ("I'll search for programmes, lenders and investors that fit your case (its country, kind of funding, amount and sector), each with its source."
            if only == OPTIONS_ONLY else None) or ("I'll research " + (", ".join(topics[:-1]) + " and " + topics[-1] if len(topics) > 1 else topics[0]) + f" for your {'plan' if topic == 'launch' else 'case'}, and draft what I can."
            if topics else f"I'll research what your {'plan' if topic == 'launch' else 'case'} still needs and draft what I can.")
    price = int(quote.get("max") or quote.get("cost") or 0)
    fixed = quote.get("variable") is False
    cost = ((f" It costs {price} credits." if fixed else f" Up to {price} credits, and you only pay for what I find.")
            + (f" You have {quote['balance']}." if isinstance(quote.get("balance"), int) else "") if price else " This one is free.")
    return await said(orch, user, business_id, text, f"{what}{cost} Shall I start?",
                      [{"label": f"{'Search' if only == OPTIONS_ONLY else 'Start'}{(f' · {price} credits' if fixed else f' · up to {price} credits') if price else ''}", "kind": "explain", "prompt": "Yes, start"},
                       {"label": "Not now", "kind": "explain", "prompt": "Not now"}], now, pending={"session": sid, "price": price, **({"only": only} if only else {}), **({"fresh": True} if fresh else {})},
                      cards=[{"type": "choose", "case_id": str(case["id"]), "price": price, "topics": quote.get("topics") or [], "reuse": bool(quote.get("reuse")),
                              **({"options": True} if only == OPTIONS_ONLY else {}), **({"fixed": True} if fixed else {})}])


async def _start_do_all(orch, user: dict, business_id: str, case: dict, asked: dict, text: str, now: datetime, topic: str = "funding",
                        keep: dict | None = None) -> dict:
    """The yes: the research starts and carries on by itself; the owner is told it has, and where it will be."""
    from app.modules.agent import goal_router

    async def mark(on: bool, failed: str | None = None) -> None:
        # Shown on the Assistant tab as in progress until it ends (the owner's mockups, 27 Oct); one that didn't start or
        # finish keeps why, for the card to say with Retry (the owner, 28 Oct: "never leave the progress card spinning")
        def _m(d: dict) -> None:
            w = d.setdefault("agent_working", {})
            if on:
                w[str(case["id"])] = {"at": now.isoformat(), "topic": topic}
            elif failed:
                w[str(case["id"])] = {"failed": failed[:300], "ended": datetime.now(timezone.utc).isoformat(), "topic": topic}
            else:
                w.pop(str(case["id"]), None)
        try:
            await orch.rt.business.mutate(business_id, _m)
        except Exception:      # noqa: BLE001
            pass

    async def go() -> None:
        failed = None
        try:
            out = await goal_router.session_premium(asked["session"], goal_router.QuickCheckIn(only=asked["only"], fresh=bool(asked.get("fresh")))
                                                    if asked.get("only") else None, user)
            if not (out or {}).get("started"):      # refused (a plan, a price, nothing new to look up): said, never silent
                failed = ((out or {}).get("gate") or {}).get("message") or "The research didn't start. Nothing was charged."
        except Exception:      # noqa: BLE001 - nothing is charged for a run that didn't finish
            logger.warning("Do all for me from the conversation did not finish for %s", business_id, exc_info=True)
            failed = "The research didn't finish. Nothing was charged."
        finally:
            await mark(False, failed)
    await mark(True)
    to, noun = (f"/launch/{case['id']}", "launch plan") if topic == "launch" else (f"/funding/{case['id']}?tab=overview", "funding case")
    try:
        task = asyncio.get_running_loop().create_task(go())
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)
    except RuntimeError:
        return await _said(orch, user, business_id, text, "I couldn't start that just now. Nothing was charged; please try again.", [], now, topic=topic, keep=keep)
    if asked.get("only") == OPTIONS_ONLY:
        return await _said(orch, user, business_id, text,
                           "Searching for programmes, lenders and investors that fit your case. It takes a minute or two; I'll list each one with its source. Ask me how it went any time.",
                           [{"label": f"Open your {noun}", "to": to}], now, topic=topic, keep=keep, cards=[{"type": "progress", "case_id": str(case["id"]), "options": True}])
    return await _said(orch, user, business_id, text,
                       f"Started. It takes a minute or two; the drafts go on your {'plan' if topic == 'launch' else 'case'} for you to accept, edit or reject. Ask me how it went any time.",
                       [{"label": f"Open your {noun}", "to": to}], now, topic=topic, keep=keep, cards=[{"type": "progress", "case_id": str(case["id"])}])


_RUNNING: set = set()
