"""Launch readiness as a conversation, as funding is (the owner, 27 Oct: "let's do other flows"). One model call per message
reads what the owner typed with their launch plans and the conversation so far, and says what to do: answer, change a plan
from the owner's own words, start a new plan, run the free check, or offer a button. A business can have many launches, so a
new offering is a new plan, never "replace?". Nothing here is charged, the workspace profile is never written, and without a
model the scripted launch chat carries on as before."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from app.modules.agent.converse import (MAX_TURNS, MODEL_SECONDS, _BOTH, _MANNER, _ask_do_all, _figures_in, _no, _parse, _said, _start_do_all,
                                        _yes, apply_drafts, approvals_waiting, asks_gaps, asks_help, cards_for, in_conversation)

logger = logging.getLogger(__name__)

TOPIC = "launch"
MAX_PLANS = 5

_SYSTEM = (
    _MANNER +
    "Right now you can see and act on their launch readiness: their launch plans (PLANS; a business can have several) and the "
    "plan you are talking about (ON, a plan id or null). Use a tool only when the message needs it; most messages don't. Reply "
    "with JSON only:\n"
    '{"say": "<what you tell them>", "plan": "<the id of the plan this is about, or \\"new\\" for a new launch, or null>", '
    '"change": {<plan fields from their own words only>}, "check": <true to score the plan again>, '
    '"do_all": <true when they want the research and drafting done for them>, "buttons": [<0 to 3 of: {"kind": "open_plan"}, '
    '{"kind": "do_all"}, {"kind": "reply", "label": "<short>", "text": "<what it says for them>"}>], "show": [<cards shown under your reply, only when they help: "records" (what you checked in their records), "result" (the score, gaps and what is known), "next" (what they could do next), "approvals" (approvals waiting)>], "drafts": {<only when they decide about the drafts waiting: "accept": [<paths>] or "all", "edit": {<path>: <the value as they want it>}, "reject": [<paths>]>}}\n'
    "Fields: name (what they are launching, a few words), audience (who it is for), geography (where), target_date "
    "(YYYY-MM-DD), price (a number, per unit or per month as they said), cost (what one costs them to deliver, a number). "
    "Rules: change only what the owner clearly said in this message or the one before; never guess a figure or a date; ask "
    "for what is missing in plain words instead, one thing at a time. When something changes, set check true. A correction "
    "('make it', 'change it to', 'actually') updates the plan you are on. Something different they want to launch is a new "
    "plan (plan \"new\" with its name): launches can be many, so never ask whether it replaces another. When it isn't clear "
    "which of their plans they mean, ask by name and leave change empty. Answer questions about where they stand from the plan "
    "(its score_out_of_100, always said as N/100; what is still to do), never invent. Offer do_all only when they want the "
    "work done for them (its price is said and asked before anything starts). A plan's research says what an earlier run "
    "found. Offer a button only when a choice helps; most replies need none." " Drafts waiting (DRAFTS) are what an earlier run prepared; nothing counts until the owner accepts. When they approve, change or reject drafts in their words, say which in drafts (an edit is the draft as they asked it changed, then accepted); otherwise leave drafts out. WAITING lists approvals waiting for them (an invoice reminder, a quotation): mention them only when it helps, and show \"approvals\" to list them.")


_DO_ALL = re.compile(r"\bdo\s+(?:it\s+)?al+\b|\bdo\s+everything\b", re.I)      # "do alll for me" too
_FILL_REST = re.compile(r"\b(?:fill|populate|complete|draft)\b.{0,20}\b(?:them|the rest|the gaps|everything|it all|all|pending|missing)\b", re.I)


async def _fill_rest(orch, user: dict, business_id: str, plan: dict, data: dict, text: str, now, keep: dict) -> dict:
    """Every field of the plan still blank drafted, estimates where the records give no figure, each waiting for review (the
    owner, 29 Oct: "fill them and bring for review"). Nothing is written on the plan until approved."""
    from app.modules.agent import research
    from app.modules.agent.converse import _said
    from app.modules.readiness import engine, rules
    from app.modules.readiness.service import service_for
    svc = service_for(orch)
    row = await svc.store.get("subjects", plan["id"])
    d = (row or {}).get("data") or {}
    waiting = d.get("agent_drafts") or {}
    fields = research.CASE_DRAFT_FIELDS.get("launch") or {}
    blank = {k: v for k, v in fields.items() if engine.blank(engine.get(d, k)) and k not in waiting}
    from app.modules.agent.converse import launch_ask
    if "loses money" in launch_ask(d):
        # A price at or below cost: a price and cost that work are drafted beside the plan's own (the owner, 29 Oct)
        blank.update({k: fields[k] + "; the price must be above the cost per unit" for k in ("economics.price_per_unit", "economics.variable_cost_per_unit")})
    # First what Business Operations and the profile already prove (the owner, 29 Oct: "it can fetch these from the business
    # operations"): demand evidence attached, the test run and the permit as drafts
    from app.modules.agent import operations_evidence
    try:
        ops = await operations_evidence.gather(svc, user, business_id, str(plan["id"]), d, data, now.date())
    except Exception:      # noqa: BLE001 - the drafts below come either way
        logger.info("records not gathered for launch %s", plan["id"], exc_info=True)
        ops = {"drafts": {}, "found": [], "none": []}
    rejected = set(d.get("rejected_drafts") or [])
    blank = {k: v for k, v in blank.items() if k not in rejected}
    from_records = {k: v for k, v in ops["drafts"].items() if k not in waiting and k not in rejected}
    records_line = operations_evidence.said(ops)
    review = f"/launch/{plan['id']}?tab=assistant&review=1"
    waiting = {p: x for p, x in waiting.items() if isinstance(x, dict) and str(x.get("value")) != str(engine.get(d, p))}      # as the page counts them
    summary = plan.get("summary") or {}
    open_actions = summary.get("open_actions")
    next_action = (summary.get("next_action") or {}).get("title")
    if isinstance(open_actions, int) and open_actions > 0:
        checklist_line = f"After that, {open_actions} checklist item{'s' if open_actions != 1 else ''} still need attention"
        if next_action:
            checklist_line += f", starting with {str(next_action).rstrip('.')}"
        checklist_line += ". I'll show them below so we can work through them."
    else:
        checklist_line = "I'll show the remaining checklist steps below so we can work through them."
    steps = [{"type": "steps", "case_id": str(plan["id"])}]
    if not blank and not from_records:
        # Separate "nothing else can be drafted" from "the plan is complete" and put the live checklist actions in the chat.
        say = " ".join(x for x in (
            "I can't draft the remaining items from the records I have.", records_line,
            f"First, review the {len(waiting)} draft{'s' if len(waiting) != 1 else ''} waiting and approve what's right." if waiting else "",
            checklist_line,
        ) if x)
        actions = [{"label": f"Review drafts ({len(waiting)})", "to": review}] if waiting else []
        return await _said(orch, user, business_id, text, say, actions, now, topic=TOPIC, keep=keep, cards=steps)
    drafted = {}
    if blank:
        facts = research.workspace_facts(data, {}, {"offering": d.get("name"), "customer": d.get("audience"), "where": d.get("geography")}, [])
        facts["plan"] = {k: v for k, v in d.items() if k not in ("agent_drafts", "provenance") and not str(k).startswith("_")}
        facts["today"] = now.date().isoformat()      # the launch date and milestones are drafted from it
        drafted = await research.draft_estimates(research._default_llm(user["id"]), "launch", facts, blank)
    if not drafted and not from_records:
        return await _said(orch, user, business_id, text,
                           "I couldn't prepare those drafts just now, so nothing was changed. " + checklist_line,
                           [], now, topic=TOPIC, keep=keep, cards=steps)
    at = now.date().isoformat()
    place = d.get("geography") or "your area"
    new = {k: {"value": v, "source": f"an estimate by the Agent, typical for {place}; check it before you approve", "at": at,
               **({"replaces": engine.get(d, k)} if not engine.blank(engine.get(d, k)) else {})} for k, v in drafted.items()}
    new.update(from_records)
    row = await svc.store.get("subjects", plan["id"])      # evidence was just attached: its latest revision
    saved = await svc.update_subject(user["id"], business_id, rules.LAUNCH, plan["id"], row["revision"], {"agent_drafts": {**waiting, **new}}, user.get("email"))
    n = len(new)
    # Count the saved drafts, using the same pending-draft rule as the review UI. Counting the local proposal here can
    # disagree with the banner after the service normalizes or drops a draft that no longer changes its field.
    from app.modules.agent import draft_review
    total = len(draft_review.waiting((saved or {}).get("data") or {}))
    return await _said(orch, user, business_id, text, " ".join(x for x in (
        f"I've added {n} new draft{'s' if n != 1 else ''}, with estimates where your records have no figure.", records_line,
        f"There {'are' if total != 1 else 'is'} {total} draft{'s' if total != 1 else ''} waiting for your review. Edit anything that's off and approve; nothing goes on your plan until then, and your score goes up as you approve.",
        checklist_line) if x),
                       [{"label": f"Review drafts ({total})", "to": review}], now, topic=TOPIC, keep=keep, cards=steps)


def wants_launch(text: str) -> bool:
    """A message about launching: the launch goal, or a readiness question about a launch."""
    from app.modules.agent import goals, readiness_answer
    t = str(text or "")
    if readiness_answer.asked_about(t) == "launch":
        return True
    return (goals.resolve(text=t) or {}).get("goal_key") == "launch"


def _plan_view(p: dict) -> dict:
    """A plan as the model sees it: what it is, the fields it may change, its score and what is still to do."""
    data, summary = p.get("data") or {}, p.get("summary") or {}
    offer, econ = data.get("offer") or {}, data.get("economics") or {}
    seen = {"id": str(p["id"]), "name": data.get("name") or p.get("title"), "audience": data.get("audience"), "geography": data.get("geography"),
            "target_date": data.get("target_date"), "price": offer.get("price") or econ.get("price_per_unit"), "cost": econ.get("variable_cost_per_unit"),
            "score_out_of_100": summary.get("score"), "score_so_far": bool(summary.get("score_partial")), "classification": summary.get("classification"),
            "things_to_do": summary.get("open_actions"), "next": (summary.get("next_action") or {}).get("title"),
            "blockers": [b.get("label") for b in summary.get("blockers") or []][:3]}
    return {k: v for k, v in seen.items() if v not in (None, "", [])}


def _num(v: Any) -> float | None:
    try:
        n = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return round(n, 2) if n > 0 else None


def clean_change(change: Any) -> dict:
    """Only the plan's own fields, each as the plan takes it; anything else is dropped."""
    out: dict = {}
    if not isinstance(change, dict):
        return out
    for k, n in (("name", 80), ("audience", 300), ("geography", 120)):
        v = " ".join(str(change.get(k) or "").split())[:n]
        if v:
            out[k] = v
    day = str(change.get("target_date") or "").strip()[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        out["target_date"] = day
    for k in ("price", "cost"):
        n = _num(change.get(k))
        if n is not None:
            out[k] = n
    return out


_STOP = {"the", "a", "an", "for", "to", "of", "and", "my", "our", "it", "is", "in", "on", "with", "new", "launch", "launching", "want", "plan",
         "people", "who", "service", "product"}


def grounded(change: dict, said: str) -> dict:
    """Only what the owner said: a figure in their words, a name, audience or place sharing their words, a time they named."""
    t = str(said or "").lower()
    words = set(re.findall(r"[a-z]{3,}", t))
    out = {}
    for k, v in change.items():
        if k in ("price", "cost"):
            ok = any(abs(v - f) <= max(1, v * 0.001) for f in _figures_in(t))
        elif k == "target_date":
            ok = bool(re.search(r"\b(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|month|week|year|soon|quarter|christmas|easter|summer|spring|autumn|winter)", t))
        else:
            ok = bool({w for w in re.findall(r"[a-z]{3,}", str(v).lower()) if w not in _STOP} & words)
        if ok:
            out[k] = v
    return out


def _fields(change: dict, before: dict) -> dict:
    """The change in the plan's own fields (the launch chat's fields, as goals.launch_fields keeps them)."""
    out = {k: change[k] for k in ("name", "audience", "geography", "target_date") if k in change}
    if "audience" in change:
        out["customers"] = {**(before.get("customers") or {}), "target_segment": change["audience"]}      # the demand check reads it here (C1.A)
    if "price" in change:
        out["offer"] = {**(before.get("offer") or {}), "price": change["price"]}
    if {"price", "cost"} & set(change):
        out["economics"] = {**(before.get("economics") or {}), **({"price_per_unit": change["price"]} if "price" in change else {}),
                            **({"variable_cost_per_unit": change["cost"]} if "cost" in change else {})}
    return out


def _typed_change(text: str, now: datetime) -> dict:
    """Ground launch fields in a short message when the conversational model is unavailable."""
    t = str(text or "")
    out: dict = {}
    name = re.search(r"\b(?:launch|sell|offer)\s+(?:a|an|the|my)?\s*(.{2,120}?)(?=\s+(?:for|to|in|at|by|on)\b|[,;.?!]|$)", t, re.I)
    if name:
        value = re.sub(r"^(?:a|an|the|my)\s+", "", name.group(1).strip(), flags=re.I)
        if value:
            out["name"] = value
    audience = re.search(r"\bfor\s+(?:the\s+)?(offices?|office workers|businesses|families|students|[\w -]{2,60}?)(?=\s+(?:in|at|by|on|for)\b|[,;.?!]|$)", t, re.I)
    if audience:
        out["audience"] = audience.group(1).strip()
    place = re.search(r"\bin\s+([A-Z][\w -]{1,50}?)(?=\s+(?:in|at|by|on|for)\b|[,;.?!]|$)", t)
    if place and not re.fullmatch(r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?", place.group(1).strip(), re.I):
        out["geography"] = place.group(1).strip()
    amount = next((m for m in re.finditer(r"(?:[£$€₦]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b", t, re.I)
                  if re.search(r"\b(?:at|for)\s+[£$€₦]?\s*" + re.escape(m.group(1)), t, re.I)), None)
    if amount:
        n = float(amount.group(1).replace(",", "")) * ({"k": 1000, "m": 1_000_000}.get((amount.group(2) or "").lower(), 1))
        out["price"] = n
    month = re.search(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(20\d\d))?", t, re.I)
    if month:
        import calendar
        months = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
        year = int(month.group(2) or now.year)
        mi = months[month.group(1).lower()]
        if not month.group(2) and (year, mi) < (now.year, now.month):
            year += 1
        out["target_date"] = f"{year:04d}-{mi:02d}-01"
    return clean_change(out)


_NEW_PLAN = re.compile(r"\b(?:new|another|second|start(?:ing)?)\b.{0,25}\b(?:launch|plan|product|service)\b|\blaunch (?:a |an )?new\b", re.I)
_NO_NAME = re.compile(r"(?:a\s+|an\s+)?(?:new\s+)?(?:launch\s+)?(?:product|service|product or service|plan|readiness|launch plan)s?", re.I)


def _typed_reply(text: str, now: datetime, on: str | None, by_id: dict, typed: dict | None = None) -> dict | None:
    """No model reply: the launch details typed, as the model's reply would carry them, asking for the next one missing
    (QA F3, 30 Oct). None when nothing was typed to read: the scripted chat answers that."""
    from app.modules.readiness.service import _vague
    typed = dict(typed) if typed is not None else _typed_change(text, now)
    if typed.get("name") and (_vague(typed["name"]) or re.fullmatch(r"(?:new\s+)?(?:launch\s+)?(?:readiness|plan|check)s?", typed["name"], re.I)):
        typed.pop("name")      # "new launch readiness" names no offering (the dashboard's "start a launch plan")
    if not typed:
        return None
    known = ((by_id.get(str(on)) if on else None) or {}).get("data") or {}
    combined = {**known, **_fields(typed, known)}
    missing = next((ask for ask, present in (
        ("what you're launching", combined.get("name")),
        ("who you want to reach", (combined.get("customers") or {}).get("target_segment") or combined.get("audience")),
        ("where you want to launch", combined.get("geography")),
        ("when you want to launch", combined.get("target_date")),
        ("what you'll charge", (combined.get("offer") or {}).get("price")),
        ("what each sale costs you to deliver", (combined.get("economics") or {}).get("variable_cost_per_unit"))) if not present), None)
    say = f"Got those details. Before I finish the launch plan, tell me {missing}." if missing else "I've picked up the launch details you gave me."
    return {"say": say, "change": typed, "plan": "new" if typed.get("name") and not on else (on or ""), "check": True}


_PATHS = {"name": "name", "audience": "audience", "geography": "geography", "target_date": "target_date", "price": "offer.price",
          "cost": "economics.variable_cost_per_unit"}


async def turn(*, orch, user: dict, business_id: str, text: str, llm=None, now: datetime | None = None, history: list[dict] | None = None,
               plan_id: str | None = None, on_page: bool = False) -> dict | None:
    """One message in the launch conversation: {"kind": "answer", "message", "actions"}; None when there is no model or it
    can't answer (the scripted launch chat then carries on, as before)."""
    from app.modules.agent.router import _subjects_with_summary
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    now = now or datetime.now(timezone.utc)
    if llm is None:
        from app.modules.agent import research
        llm = research._default_llm(user["id"])
    no_model = llm is None      # what was typed is still read (QA F3); a question with nothing typed goes to the scripted chat
    try:
        plans = (await _subjects_with_summary(user, business_id, "launch"))[:MAX_PLANS]
    except Exception:      # noqa: BLE001 - no access or no module: the scripted chat answers
        return None
    data = await orch.rt.business.load(business_id) or {}
    mine = ((data.get("agent_conversations") or {}).get(str(user["id"])) or {}) if in_conversation(data, user["id"], now, TOPIC) else {}
    turns = list(mine.get("turns") or [])[-MAX_TURNS:]
    if not turns and history:      # an earlier conversation, opened again: what was said there
        turns = [{"role": "owner" if h.get("role") == "user" else "agent", "text": str(h.get("content") or "")[:500]} for h in history if h.get("content")][-MAX_TURNS:]
    by_id = {str(p["id"]): p for p in plans}
    # On a plan's own page, that plan, never "which launch?" (the owner, 28 Oct)
    on = str(plan_id) if plan_id and str(plan_id) in by_id else mine.get("plan_id") if str(mine.get("plan_id")) in by_id else (str(plans[0]["id"]) if len(plans) == 1 else None)
    keep = {"plan_id": on} if on else {}
    asked = mine.get("pending_do_all")
    if asked and on and _yes(text):
        return await _start_do_all(orch, user, business_id, by_id[on], asked, text, now, topic=TOPIC, keep=keep)
    if asked and _no(text):
        return await _said(orch, user, business_id, text, "No problem, nothing was started or charged.", [], now, topic=TOPIC, keep=keep)
    if on and _FILL_REST.search(str(text)):
        return await _fill_rest(orch, user, business_id, by_id[on], data, text, now, keep)
    from app.modules.agent import research as _research
    researched = bool(on) and (_research.research_state(data, "launch", case_id=on, answers={}) or {}).get("state") in ("review", "adopted")
    if on and (asks_help(text) or _DO_ALL.search(str(text))):
        # Research already done for this plan: the rest is drafted at once, free, never its price asked again (the owner,
        # 30 Oct: "do all for me" after the research)
        if researched:
            return await _fill_rest(orch, user, business_id, by_id[on], data, text, now, keep)
        return await _ask_do_all(orch, user, business_id, by_id[on], data, text, now, topic=TOPIC, keep=keep)
    # A new launch plan asked for without saying what: asked once, and the answer is its name, so the plan is made (QA,
    # 30 Oct: "a new plan" and Start a launch plan looped on the plan list and never made one)
    from app.modules.readiness.service import _vague
    said_name = _typed_change(text, now).get("name")
    if on_page and _NEW_PLAN.search(str(text)) and (not said_name or _vague(said_name) or _NO_NAME.fullmatch(said_name)):
        return await _said(orch, user, business_id, text, "What are you launching? A few words is enough, for example \"window cleaning for offices\".",
                           [], now, topic=TOPIC, keep={"new_plan": True})
    forced = None
    if mine.get("new_plan") and not str(text).strip().endswith("?"):
        typed = _typed_change(text, now)
        if not typed.get("name"):
            said = re.sub(r"^(?:it'?s|i'?m launching|launching|a|an|the)\s+", "", str(text).strip(), flags=re.I)
            typed = clean_change({**typed, "name": re.split(r"\s+(?:for|in|at|by)\s+", said, maxsplit=1)[0]})      # "for offices" is who, not what
        forced = _typed_reply(text, now, None, by_id, typed=typed)
    view = [_plan_view(p) for p in plans]
    from app.modules.agent import draft_review
    waiting = await approvals_waiting(orch, business_id)
    prompt = json.dumps({"PLANS": view, "ON": on, "DRAFTS": draft_review.view(rules.LAUNCH, (by_id[on].get("data") or {})) if on else [], "WAITING": waiting, "research": _research.research_state(data, "launch") if plans else None, "TURNS": turns,
                         "MESSAGE": str(text)[:2000]}, ensure_ascii=False, default=str)
    got = forced
    if got is None and not no_model:
        try:
            res = await asyncio.wait_for(llm.generate_text(system=_SYSTEM, prompt=prompt, feature="agent_conversation", max_tokens=500), MODEL_SECONDS)
            got = _parse(getattr(res, "text", "") or "")
        except Exception:      # noqa: BLE001 - what was typed is still read below
            logger.info("launch conversation: no model reply", exc_info=True)
    if got is None:
        got = _typed_reply(text, now, on, by_id)
        # Only a launch named or a plan open: "starting a dog grooming van in Leeds" is an idea, the scripted chat's to answer
        if got is None or (not on and not (got.get("change") or {}).get("name")):
            return None      # nothing typed to read: the scripted launch chat answers, as before
    if asks_gaps(text):
        got["show"] = [*(got.get("show") if isinstance(got.get("show"), list) else []), "result"]
    say = " ".join(str(got.get("say") or "").split())
    if not say:
        return None
    say = say.replace("—", ", ").replace("–", " to ")      # no dashes in what the owner reads

    which = str(got.get("plan") or "").strip()
    new = which.lower() == "new"
    plan = None if new else by_id.get(which) or (by_id.get(on) if on else None)
    said = " ".join([str(text)] + [t.get("text") or "" for t in turns if t.get("role") == "owner"][-1:])      # this message and the one before
    wanted = clean_change(got.get("change"))
    change = grounded(wanted, said)
    dropped = [k for k in wanted if k not in change]
    if dropped:
        # Never a change claimed that wasn't made: what wasn't said is asked for instead
        need = [w for k, w in (("name", "what you're launching"), ("audience", "who it's for"), ("geography", "where you'll launch"),
                               ("target_date", "when you want to launch"), ("price", "what you'll charge"), ("cost", "what each one costs you")) if k in dropped]
        say = (("Got that. " if change else "") + "Before I set that up, tell me " + (need[0] if len(need) == 1 else ", ".join(need[:-1]) + " and " + need[-1]) + ".")
    svc = service_for(orch)
    done: list[str] = []
    stamp = {_PATHS[k]: f"From you, {now.day} {now.strftime('%b')}" for k in change}
    try:
        if change and (new or not plans) and change.get("name"):
            # The newest plan is the one the dashboard shows (QA, 30 Oct: the old carpet plan stayed pinned): pinned like the
            # landing chat's, the newest pinned first
            payload = {"scope": "commercial", "pinned": True, **_fields(change, {})}
            made = await svc.create_subject(user["id"], business_id, rules.LAUNCH, payload, user.get("email"), provenance=stamp)
            plan = {"id": made["id"], "title": payload["name"]}
            done.append("created")
        elif change and plan:
            row = await svc.store.get("subjects", plan["id"])
            await svc.update_subject(user["id"], business_id, rules.LAUNCH, plan["id"], row["revision"], _fields(change, (row or {}).get("data") or {}),
                                     user.get("email"), provenance=stamp)
            done.append("updated")
        elif change and not plan:
            say = "Which launch is this for? Tell me what you're launching." if plans else "Before I set that up, tell me what you're launching."
        if plan and not new and await apply_drafts(svc, user, business_id, rules.LAUNCH, plan["id"], text, got, now):
            done.append("adopted")
        if plan and (got.get("check") or done):
            fresh = await svc.store.get("subjects", plan["id"])
            await svc.request_assessment(user["id"], business_id, rules.LAUNCH, plan["id"], idempotency_key=f"converse:{plan['id']}:{(fresh or {}).get('revision')}",
                                         email=user.get("email"))
            done.append("checked")
    except Exception:      # noqa: BLE001 - said plainly, nothing half-done claimed
        logger.warning("launch conversation: the plan could not be updated for %s", business_id, exc_info=True)
        say = "I couldn't update your launch plan just now. Nothing was changed; please try again."
        done = []
    if plan:
        keep = {"plan_id": str(plan["id"])}

    got["_done"] = done
    before, after = (((by_id.get(str(plan["id"])) if plan else None) or {}).get("summary") or {}).get("score"), None
    if "checked" in done:
        try:
            fresh = next((p for p in await _subjects_with_summary(user, business_id, "launch") if str(p["id"]) == str(plan["id"])), None)
            s = (fresh or {}).get("summary") or {}
            if isinstance(s.get("score"), (int, float)):
                left, after = s.get("open_actions"), s["score"]
            if isinstance(after, (int, float)) and not (isinstance(before, (int, float)) and round(before) == round(after)):      # only when it moved
                say += f" Your launch score is now {round(s['score'])}/100{' so far' if s.get('score_partial') else ''}" + (
                    f", with {left} thing{'s' if left != 1 else ''} to do." if isinstance(left, int) and left else ".")
        except Exception:      # noqa: BLE001
            pass

    from app.modules.agent.converse import _RESEARCH_CLAIM, _PRICE_SAID
    if not done and re.search(r"\bi(?:'ll| will)\s+(?:attach|add|update|save|upload|record)\b|\bi(?:'ve| have)\s+(?:attached|added|updated|saved|uploaded|recorded)\b", say, re.I):
        say = "Nothing has been attached or changed yet. Attach a file with the paperclip below, or tell me what to change, and I'll show you the change."
    if plan and not done and (got.get("do_all") or _RESEARCH_CLAIM.search(say) or _PRICE_SAID.search(say)):
        # Research only starts with its price said and Start pressed (the owner, 28 Oct: "Let me do that for you now", nothing started)
        return await _ask_do_all(orch, user, business_id, plan, data, text, now, topic=TOPIC, keep=keep)
    to = f"/launch/{plan['id']}" if plan else None
    actions = []
    for b in (got.get("buttons") or [])[:3]:
        kind = (b or {}).get("kind") if isinstance(b, dict) else None
        if kind == "open_plan" and to:
            actions.append({"label": "Open your launch plan", "to": to})
        elif kind == "do_all" and to:
            actions.append({"label": "Do all for me", "to": to})      # its price first, on the plan page's own button
        elif kind == "reply" and str(b.get("label") or "").strip() and str(b.get("text") or "").strip() \
                and not _BOTH.search(f"{b.get('label')} {b.get('text')}"):
            actions.append({"label": str(b["label"]).strip()[:40], "kind": "explain", "prompt": str(b["text"]).strip()[:300]})
    if plan and not actions and done:
        actions.append({"label": "Open your launch plan", "to": to})
    if not plan and len(plans) > 1 and not new:
        named = [(p.get("data") or {}).get("name") or p.get("title") or "Launch plan" for p in plans]
        scores = [((p.get("summary") or {}).get("score")) for p in plans]
        listed = "; ".join(f"{n} ({round(sc)}/100)" if isinstance(sc, (int, float)) else n for n, sc in zip(named, scores))
        say = f"You have {len(plans)} launch plans: {listed}. Which one shall I look at? Or tell me what you want to launch next."
        actions = [{"label": n[:40], "kind": "explain", "prompt": f"How ready is my {n} launch?"} for n in named[:4]]
    from app.modules.agent.converse import _ASKS_READY, launch_ask, offer_things_left, suggested, with_do_all
    if not (not plan and len(plans) > 1 and not new):
        actions = with_do_all(actions, bool(plan) and not done)
        if plan:
            pid = str(plan["id"])
            researched = (_research.research_state(data, "launch", case_id=pid, answers={}) or {}).get("state") in ("review", "adopted")
            if researched:
                actions = [a for a in actions if str(a.get("label") or "").strip().lower() != "do all for me"]
            row = await svc.store.get("subjects", pid) if researched else None
            say, actions = offer_things_left(say, got, actions, researched, launch_ask((row or {}).get("data") or {}) if researched else "")
    if plan and _ASKS_READY.search(str(text)):
        got["show"] = [*(got.get("show") if isinstance(got.get("show"), list) else []), "result", "next"]      # the result, never only words
    if not actions:
        actions = suggested("launch", bool(plan))
    out = await _said(orch, user, business_id, text, say, actions, now, topic=TOPIC, keep=keep,
                      cards=cards_for(got, not turns, bool(plan), str(plan["id"]) if plan else None, before, after, bool(waiting)))
    return {**out, "changed": done, **({"case_id": str(plan["id"])} if plan else {})}
