"""AgentSummary for the Adaptive Dashboard (s18.1, AC-28, AC-29).

Everything here is derived deterministically from authoritative business
records and workflow state. The panel is a general task-and-prompt surface: it
surfaces work across capability families and never hard-codes one workflow.
"""
from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent.documents import fmt_money
from app.modules.agent.models import APPROVAL_PENDING, RUN_AWAITING_APPROVAL, RUN_FAILED, RUN_RUNNING, RUN_SUCCEEDED, RUN_TERMINAL
from app.modules.agent.store import merge_policy

# Until migration 027 has been run the Agent tables don't exist, and asking the database
# for a missing table is both pointless and erratic (anything from 0.2s to several seconds).
# Once it says "no such table", the dashboard stops asking for a few minutes.
_TABLES_RECHECK_SECONDS = 300.0
_tables_missing_until = 0.0


def _is_missing_table(exc: BaseException) -> bool:
    return getattr(exc, "code", None) == "PGRST205" or "PGRST205" in str(exc)

_TOOL_KIND = {"send_quotation": "quote", "send_contract": "contract", "send_invoice": "invoice",
              "send_payment_reminder": "payment", "send_receipt": "receipt", "send_proposal": "proposal", "send_purchase_order": "purchase_order", "send_credit_note": "credit_note"}


def _ago(iso: str | None, now: datetime) -> str:
    if not iso:
        return ""
    try:
        seconds = (now - datetime.fromisoformat(str(iso).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        return ""
    if seconds < 3600:
        return f"{max(1, int(seconds // 60))}m ago"
    if seconds < 86400:
        return f"{int(seconds // 3600)}h ago"
    return f"{int(seconds // 86400)}d ago"


def approval_card(a: dict, now: datetime) -> dict:
    p = a.get("payload") or {}
    kind = _TOOL_KIND.get(a["tool_id"], "action")
    title = {
        "quote": f"Quote #{p.get('reference')}",
        "contract": f"Contract #{p.get('reference')}",
        "invoice": f"Invoice #{p.get('reference')}",
        "payment": "Payment follow-up draft",
        "receipt": "Receipt ready to send",
        "proposal": f"Proposal #{p.get('reference')}", "purchase_order": f"Purchase order #{p.get('reference')}", "credit_note": f"Credit note #{p.get('reference')}",
    }.get(kind, a.get("title") or "Action")
    subtitle = {
        "quote": f"Ready to send to {p.get('customer_name')}",
        "contract": f"Ready to send to {p.get('customer_name')}",
        "invoice": f"Ready to send to {p.get('customer_name')}",
        "payment": f"For {p.get('customer_name')}",
        "receipt": f"{p.get('invoice_reference')} – {p.get('customer_name')}",
        "proposal": f"Ready to send to {p.get('customer_name')}", "purchase_order": f"Ready to send to {p.get('customer_name')}",
        "credit_note": f"{p.get('invoice_reference')} – {p.get('customer_name')}",
    }.get(kind, "")
    return {"type": "approval", "kind": kind, "approval_id": a["id"], "run_id": a["run_id"], "title": title,
            "subtitle": subtitle, "age": _ago(a.get("created_at"), now), "created_at": a.get("created_at"),
            "tool_id": a["tool_id"], "payload": p, "payload_version": a.get("payload_version"),
            "expires_at": a.get("expires_at")}


def live_pending(approvals: list[dict], runs: list[dict], now: datetime) -> list[dict]:
    """The one definition of "needs approval", used by the dashboard, the Agent Centre and
    the approvals API: a pending approval, not expired, on a run still waiting for it."""
    waiting = {r["id"] for r in runs if r["status"] == RUN_AWAITING_APPROVAL}
    cutoff = now.isoformat()
    return [a for a in approvals if a.get("status", APPROVAL_PENDING) == APPROVAL_PENDING and a["run_id"] in waiting
            and (not a.get("expires_at") or a["expires_at"] >= cutoff)]


async def waiting_for_approval(store, business_id: str, now: datetime) -> tuple[list[dict], list[dict]]:
    """The one query behind every "Needs Approval" list and count: the live pending approvals,
    and the tasks they belong to (however old those tasks are)."""
    approvals, runs = await asyncio.gather(
        store.list_approvals(business_id=business_id, status=APPROVAL_PENDING),
        store.list_runs(business_id, statuses=[RUN_AWAITING_APPROVAL], limit=500),
    )
    live = live_pending(approvals, runs, now)
    wanted = {a["run_id"] for a in live}
    return live, [r for r in runs if r["id"] in wanted]


async def pending_approvals(store, business_id: str, now: datetime) -> list[dict]:
    return (await waiting_for_approval(store, business_id, now))[0]


# The same list and count as Orchestrator.AUTO_RETRY_REASONS / AUTO_RETRY_AFTER.
_SELF_HEALING = ("stalled", "action_failed", "unexpected_error", "delivery_status_uncertain")
_SELF_HEALING_TRIES = 3


def short_question(q: dict) -> str:
    """A question in a few words for its tile. The full wording is shown when it is opened."""
    import re
    text = str(q.get("question") or "")
    keys = {f.get("key") for f in q.get("fields") or []}
    who = re.match(r"^(.+?) wrote from ", text)
    if "customer_id" in keys and who:
        name = who.group(1).strip()
        return f"Which customer is {name}{chr(39)}s request for?" if not name.endswith("s") else f"Which customer is {name}{chr(39)} request for?"
    if "customer_id" in keys:
        return "Which customer is this for?"
    if "items" in keys:
        return "Which items and prices should I quote?"
    if "vat_rate" in keys:
        return "What VAT rate should I use?"
    if "customer_email" in keys and len(text) > 70:
        return "Which email address should I send this to?"
    first = re.split(r"(?<=[?.])\s", text, maxsplit=1)[0]
    return first if len(first) <= 90 else first[:87].rstrip() + "…"


# What a task is called on a tile, in a word or two.
TASK_NOUN = {
    "new_invoice": "Invoice", "quote_to_cash": "Invoice", "enquiry_to_quote": "Quotation", "new_proposal": "Proposal", "new_contract": "Contract",
    "receipt_send": "Receipt", "payment_followup": "Payment reminder", "credit_note": "Credit note", "new_purchase_order": "Purchase order",
    "supplier_bill": "Supplier bill", "record_expense": "Expense", "record_payment": "Payment", "add_customer": "New customer", "add_vendor": "New supplier",
    "add_catalogue_item": "Catalogue item", "update_record": "Record update", "business_plan_draft": "Business plan", "market_size": "Market size",
    "funding_pack_draft": "Funding pack", "registration_checklist": "Registration checklist", "marketplace_profile": "Marketplace profile",
    "marketplace_offering": "Marketplace offering", "scenario_help": "Scenario", "risk_concentration": "Risk check",
}
# The question for a field, in a few words. Anything else is "Confirm {label}?" or "Add {label}?".
_FIELD_ASK = {
    "customer_id": "Which customer?", "customer_name": "Who is it for?", "vendor_id": "Which supplier?", "items": "Add the items and prices?",
    "total": "Add a price?", "amount": "Add the amount?", "price": "Add a price?", "unit_price": "Add a price?", "vat_rate": "Confirm the VAT rate?",
    "customer_email": "Add their email?", "email": "Add their email?", "due_date": "Confirm the due date?", "solution": "Say what you are proposing?",
    "customer": "Who is your customer?", "problem": "What problem does it solve?", "industry": "Which industry?", "location": "Where will you sell?",
    "description": "What does the business do?",
}
_GENERIC = re.compile(r"^(?:is this right|is this (?:correct|ok|okay)|which customer is this for|who is (?:it|this) for|confirm|ok)\W*$", re.I)


_DOC_WORDS = re.compile(r"(?:(?:business|sales|formal|quick|short|simple|detailed|new|final|draft|proper|professional|tax|vat|commercial|project|service|client)\s+)*"
                        r"(?:invoices?|quotations?|quotes?|estimates?|proposals?|contracts?|agreements?|purchase orders?|credit notes?|receipts?|reminders?|bills?|expenses?"
                        r"|ideas?|idea validation|validation|business plans?|plans?|tasks?|documents?|customers?|clients?|suppliers?|vendors?)", re.I)
_POINTER = re.compile(r"\b(?:rfqs?|requests?|enquir(?:y|ies)|inquir(?:y|ies)|marketplace|latest|newest|most recent|last one|previous|someone|somebody|anyone|them|it|this|that)\b", re.I)


def bad_subject(value: Any, workflow_key: str | None = None) -> bool:
    """True when something is not fit to stand as who or what a task is about: empty, the name of
    the task or of a kind of document ("business proposal"), a way of pointing at a record ("my
    latest marketplace RFQ"), or not real words ("MMMM"; for an idea, a single made-up word)."""
    text = re.sub(r"\s+", " ", str(value or "")).strip(" .,:;-")
    if len(text) < 2 or re.search(r"(.)\1{4,}", text, re.I):
        return True
    if _DOC_WORDS.fullmatch(re.sub(r"^(?:a|an|the|my|our)\s+", "", text, flags=re.I)) or _POINTER.search(text):
        return True
    wf = WORKFLOWS_TITLE(workflow_key)
    if text.lower() in {wf.lower(), TASK_NOUN.get(workflow_key or "", "").lower(), str(workflow_key or "").replace("_", " ")} - {""}:
        return True
    if workflow_key in ("idea_validation", "market_size", "business_plan_draft"):
        return len(text.split()) < 2 or len(text) < 8      # an idea is a few words: "Gooat" is not one
    return False


def WORKFLOWS_TITLE(key: str | None) -> str:
    from app.modules.agent.workflows import WORKFLOWS
    wf = WORKFLOWS.get(key or "")
    return wf.title if wf else ""


def _subject_of(run: dict) -> str:
    """Who or what the task is about: the customer, the idea, or the document's number."""
    state = run.get("state") or {}
    answers, params = state.get("answers") or {}, state.get("params") or {}
    # A task held for its plan keeps its question aside: who it is for is still read from there.
    asked = run.get("pending_question") or (state.get("held_for_plan") or {}).get("pending_question") or {}
    fields = asked.get("fields") or []
    said = {f.get("key"): f.get("said_text") or "" for f in fields if f.get("said_text")}
    for source in (answers, params, said, state.get("rfq") or {}):
        for key in ("customer_name", "party_name", "recipient", "customer", "company", "name"):
            value = source.get(key)
            if isinstance(value, str) and 1 < len(value.strip()) <= 80 and not value.strip().lower().startswith(("new", "http")):
                return re.sub(r"\s*\(new\)$", "", value.strip())
    for f in fields:      # a name already in the form (read from the message, or typed)
        if f.get("key") in ("customer_name", "vendor_name", "party_name", "recipient") and isinstance(f.get("default"), str) and f["default"].strip():
            return f["default"].strip()
    for f in fields:      # a customer chosen in the form, by name
        if f.get("key") in ("customer_id", "vendor_id") and f.get("default") not in (None, "", "new"):
            label = next((o.get("label") for o in f.get("options") or [] if o.get("value") == f.get("default")), None)
            if label:
                return str(label)
    wrote = re.match(r"^(.+?) wrote from ", str((run.get("pending_question") or {}).get("question") or ""))
    if wrote:      # an enquiry or a marketplace request: whoever sent it
        return wrote.group(1).strip()
    refs = run.get("refs") or {}
    return str(refs.get("invoice_reference") or refs.get("quote_reference") or "")


def question_title(run: dict) -> dict:
    """What a waiting question is about, for its tile: "{Task} for {subject}. {short question}", and
    under it the value being confirmed or the field that is missing. A bare question ("Is this
    right?") is never the title, and neither is a subject that isn't one: "Proposal for business
    proposal" becomes "New Proposal. Who is it for?". A task held for its plan says so."""
    q = run.get("pending_question") or {}
    fields = [f for f in q.get("fields") or [] if isinstance(f, dict)]
    key = run.get("workflow_key") or ""
    noun = TASK_NOUN.get(key) or str(run.get("title") or "Task")
    full = WORKFLOWS_TITLE(key) or noun
    found = _subject_of(run)
    subject = "" if bad_subject(found, key) else found
    if run.get("reason_code") == "plan" and run.get("substatus") == "blocked":
        need = ((run.get("state") or {}).get("held_for_plan") or {}).get("plan_required") or "Starter"
        return {"title": f"{noun} for {subject}. On the {need} plan. Upgrade or cancel" if subject else f"{full}. On the {need} plan. Upgrade or cancel", "detail": ""}
    field = next((f for f in fields if f.get("confirm")), None) or next((f for f in fields if f.get("required") and f.get("default") in (None, "", [])), None) or (fields[0] if fields else {})
    label = str(field.get("label") or "").strip().rstrip("?")
    ask = _FIELD_ASK.get(field.get("key") or "")
    if field.get("confirm") and field.get("key") == "description":
        ask = "Confirm what it does?"
    if not ask:
        ask = (f"Confirm {label[:1].lower() + label[1:]}?" if field.get("confirm") else f"Add {label[:1].lower() + label[1:]}?") if label else "Add what is missing?"
    value = field.get("default") if field.get("confirm") or field.get("default") not in (None, "", []) else None
    detail = str(value).strip() if isinstance(value, (str, int, float)) and str(value).strip() else label
    if isinstance(value, str) and bad_subject(value, key) and field.get("key") in ("customer_name", "description", "solution", "vendor_name"):
        detail = ""      # the second line is held to the same standard as the first
    if key in ("idea_validation", "market_size", "business_plan_draft"):
        idea = str(((run.get("state") or {}).get("answers") or {}).get("description") or (value if field.get("key") == "description" else "") or "").strip()
        if bad_subject(idea, key):
            return {"title": f"{full}. What's the idea?", "detail": ""}
        short = re.sub(r"\s+(?:in|for|at|across|near)\s+.*$", "", idea, flags=re.I).strip()[:40]
        lead = {"idea_validation": "Validating", "market_size": "Sizing the market for", "business_plan_draft": "Planning"}[key]
        return {"title": f"{lead} your {short[:1].lower() + short[1:]} idea. {ask}", "detail": idea}
    if subject:
        title = f"{noun} for {subject}. {ask}"
    elif found:      # something was stored as the subject, and it isn't one: ask who it is for
        title = f"{full}. Who is it for?"
    else:
        title = f"{noun}. {ask}"
    return {"title": title, "detail": detail if detail and detail.lower() not in title.lower() else ""}


def is_bare_question(text: str | None) -> bool:
    """True for a tile title that says nothing about what it is asking about."""
    return bool(_GENERIC.match(str(text or "").strip()))


def bucket_of(run: dict) -> str:
    """Agent Centre section for a run (s18.2)."""
    if run["status"] == RUN_AWAITING_APPROVAL:
        return "needs_approval"
    if run["status"] == RUN_FAILED and run.get("reason_code") in _SELF_HEALING \
            and int((run.get("state") or {}).get("auto_retries") or 0) < _SELF_HEALING_TRIES:
        return "active"      # the Agent is trying it again itself: nothing for the owner to do
    if run["status"] == RUN_FAILED or (run["status"] == RUN_RUNNING and run.get("substatus") in ("waiting_for_information", "blocked")):
        return "needs_attention"
    if run["status"] in (RUN_RUNNING, "created"):
        return "active"
    if run["status"] == RUN_SUCCEEDED:
        return "completed"
    return "history"


def risks_of(data: dict, policy: dict, today) -> list[dict]:
    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert_pct)
    overdue = bz.overdue_invoices(data, today)
    cash = bz.cash_position(data, today)
    risks = []
    if conc["alert"]:
        risks.append({"key": "concentration", "label": "Customer concentration", "severity": "high"})
    if overdue:
        risks.append({"key": "overdue", "label": f"{len(overdue)} overdue invoice{'s' if len(overdue) != 1 else ''}", "severity": "medium"})
    if cash["cash"] < 0:
        risks.append({"key": "cash_negative", "label": "Negative cash position", "severity": "high"})
    elif cash["runway_months"] is not None and cash["runway_months"] < 3:
        risks.append({"key": "runway", "label": "Less than 3 months of runway", "severity": "high"})
    return risks


def insights_of(data: dict, policy: dict, today) -> list[dict]:
    """The four Adaptive Insight cards. Figures come from deterministic calculations only."""
    cur = bz.currency_of(data)
    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert_pct)
    overdue = bz.overdue_invoices(data, today)
    cash = bz.cash_position(data, today)
    overdue_total = sum(bz.invoice_outstanding(i) for i in overdue)

    if overdue:
        nxt = {"text": "Your receivables are slipping past terms. I'm preparing reminders for your approval.",
               "cta": {"label": "See the scenario", "to": "/simulation"},
               "more": {"capability": "payment_followup"}}
    elif conc["alert"]:
        nxt = {"text": "A few customers carry most of your revenue. I'm working out what losing one would mean.",
               "cta": {"label": "See the scenario", "capability": "scenario_help", "params": {"scenario": "client_loss"}},
               "more": {"capability": "risk_concentration"}}
    elif not (data.get("financials") or {}).get("invoices"):
        nxt = {"text": "Record your first invoice or quotation so EnterprateAI can start tracking performance.",
               "cta": {"label": "Open Essentials", "to": "/operations"}, "more": {"to": "/operations"}}
    else:
        nxt = {"text": "Everything is on track: nothing is overdue and no risk is above your thresholds. I'm watching both.",
               "cta": {"label": "See the scenario", "to": "/simulation"}, "more": {"to": "/simulation"}}

    if conc["customer_count"] == 0:
        risk_text = "No revenue recorded yet, so there is nothing to measure customer concentration against."
    elif conc["alert"]:
        n = 2 if conc["customer_count"] >= 2 and conc["top1_share_pct"] < alert_pct else 1
        share = conc["top2_share_pct"] if n == 2 else conc["top1_share_pct"]
        risk_text = (f"{n} customer{'s' if n > 1 else ''} make{'s' if n == 1 else ''} up {share:g}% of your revenue. "
                     "I'm watching it and will flag any rise.")
    else:
        risk_text = f"Your largest customer is {conc['top1_share_pct']:g}% of revenue, within your {alert_pct:g}% threshold."

    if cash["runway_months"] is not None:
        health = "healthy" if cash["runway_months"] >= 3 else "tight"
        cash_text = f"Your cash position is {health} with {cash['runway_months']:g} months of runway at current burn rate."
    elif cash["cash"] < 0:
        cash_text = f"Your cash position is negative at {fmt_money(cash['cash'], cur)}. Review costs and collect what you're owed."
    else:
        cash_text = f"Your cash position is {fmt_money(cash['cash'], cur)}. Record expenses to see your runway."

    return [
        {"key": "next_step", "title": "Recommended Next Step", "tone": "brand", **nxt,
         "detail": f"{len(overdue)} overdue · {fmt_money(overdue_total, cur)}" if overdue else None},
        {"key": "risk", "title": "Fragility / Risk Alert", "tone": "rose", "text": risk_text,
         "cta": {"label": "View risk details", "capability": "risk_concentration"}, "more": {"capability": "risk_concentration"}},
        {"key": "scenario", "title": "Suggested Scenario", "tone": "indigo",
         "text": "A 10% cost rise is the standard stress test for your margins.",
         "cta": {"label": "See the scenario", "capability": "scenario_help", "params": {"scenario": "cost_increase", "params": {"pct": 10}}},
         "more": {"to": "/simulation"}},
        {"key": "cash", "title": "Cash Position", "tone": "emerald", "text": cash_text,
         "cta": {"label": "View cash forecast", "to": "/operations?tab=Reports"}, "more": {"to": "/operations?tab=Reports"}},
    ]


async def build_summary(orch, user_id: str, business_id: str, email: str | None = None,
                        with_context: bool = False) -> dict[str, Any]:
    from app.modules.agent.orchestrator import AccessDenied

    rt = orch.rt
    now = rt.clock()
    today = now.date()

    global _tables_missing_until
    no_tables = time.monotonic() < _tables_missing_until

    async def _or(default, coro):      # Agent tables not created yet: insights and risks still work
        global _tables_missing_until
        try:
            return await coro
        except Exception as exc:
            if _is_missing_table(exc):
                _tables_missing_until = time.monotonic() + _TABLES_RECHECK_SECONDS
            return default

    async def _value(value):
        return value

    # Independent lookups run together: the dashboard waits for the slowest one, not the sum.
    # The plan that counts is the owner's, and the owner is nearly always the person asking,
    # so their plan is looked up here too instead of in a further round afterwards.
    policy, record, runs, approvals, awaiting, credits, own_plan = await asyncio.gather(
        _value(merge_policy(None)) if no_tables else rt.store.get_policy(business_id),
        rt.business.record(business_id),
        _value([]) if no_tables else _or([], rt.store.list_runs(business_id, limit=300)),
        _value([]) if no_tables else _or([], rt.store.list_approvals(business_id=business_id, status=APPROVAL_PENDING)),
        # Every task waiting for approval, however old: the same list the Agent Centre counts.
        _value([]) if no_tables else _or([], rt.store.list_runs(business_id, statuses=[RUN_AWAITING_APPROVAL], limit=500)),
        _or(0, rt.meter.balance(user_id)),
        _or(None, rt.meter.plan(user_id)),
        return_exceptions=True,
    )
    if isinstance(record, bz.BusinessAccessDenied):
        raise AccessDenied(str(record))
    for value in (policy, record):
        if isinstance(value, Exception):
            raise value
    data, owner_id = record["data"], record["owner_id"]
    if user_id == owner_id:
        actor = bz.build_actor(user_id=user_id, email=email, business_id=business_id, owner_id=owner_id, membership=None, policy=policy)
    else:
        actor, _ = await orch.actor_for(user_id, business_id, email)      # business scope enforced (raises if no access)
    plan = own_plan if (user_id == owner_id and isinstance(own_plan, str) and own_plan) else await rt.meter.plan(owner_id)
    from app.modules.agent.config import with_dev_overrides
    ent = {"plan": plan, "is_paid": plan != "explorer", **with_dev_overrides(await rt.store.plan_limits(plan))}
    have = {r["id"] for r in runs}
    pending = live_pending(approvals, runs + [r for r in awaiting if r["id"] not in have], now)

    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert_pct)
    overdue = bz.overdue_invoices(data, today)
    invoices = (data.get("financials") or {}).get("invoices") or []
    invoiced = {i.get("quote_id") for i in invoices if i.get("quote_id") and not i.get("archived")}
    in_flight = {r["state"].get("quote_id") for r in runs if r["status"] not in RUN_TERMINAL} | \
                {r["state"].get("invoice_id") for r in runs if r["status"] not in RUN_TERMINAL}
    accepted = [q for q in bz.quotes_of(data) if bz.status_of(q) in ("accepted", "won")
                and q["id"] not in invoiced and q["id"] not in in_flight and not q.get("archived")]
    unreceipted = [i for i in invoices if not i.get("archived") and i["id"] not in in_flight
                   and any(not (p.get("receipt") or {}).get("sent_at") for p in (i.get("payments") or []))]
    attention = [r for r in runs if bucket_of(r) == "needs_attention"]

    # Suggestion cards: what the Agent can help with right now, across capability families.
    suggestions: list[dict] = []
    # Approvals and stopped tasks are different things, counted and linked separately. The
    # approvals count is the same one the Needs Approval panel shows.
    can_see_approvals = actor.can_send or actor.can_prepare
    if pending and can_see_approvals:
        n = len(pending)
        suggestions.append({"key": "approvals", "icon": "doc", "tone": "amber", "mood": "needs_you", "text": f"{n} approval{'s' if n != 1 else ''} waiting for you.",
                            "action": {"to": "/agent?tab=needs_approval"}})
    if attention:
        n = len(attention)
        suggestions.append({"key": "attention", "icon": "alert", "tone": "rose", "mood": "problem", "text": f"{n} task{'s' if n != 1 else ''} need{'s' if n == 1 else ''} attention.",
                            "action": {"to": "/agent?tab=needs_attention"}})
    draft = next((a for a in pending if a["tool_id"] == "send_quotation"), None)
    if draft:
        suggestions.append({"key": "draft_quote", "icon": "doc", "tone": "amber", "mood": "needs_you", "text": f"A draft quotation for {draft['payload'].get('customer_name')} is ready.",
                            "action": {"run_id": draft["run_id"]}})
    from app.modules.agent import autostart
    from app.modules.agent import config as agent_config
    doing = autostart.enabled(policy)      # the follow-on task is started for them: say so, don't ask
    can = lambda capability: agent_config.plan_allows(ent["plan"], capability)      # noqa: E731
    spend = autostart.budget(policy, runs, now)
    if doing and spend["paused"] and spend["cap"] >= 0:
        suggestions.append({"key": "budget", "icon": "info", "tone": "amber", "mood": "needs_you",
                            "text": f"Paused: monthly automatic budget used ({spend['used']} credit{'s' if spend['used'] != 1 else ''}). Raise it in Agent settings.",
                            "action": {"to": "/agent?settings=1"}})
    for r in sorted(runs, key=lambda r: r.get("created_at") or "")[-40:]:
        q = r.get("pending_question") if r.get("status") == "running" else None
        if q and not q.get("optional") and actor.can_prepare and len([s for s in suggestions if s.get("question")]) < 2:
            suggestions.insert(0, {"key": f"question:{r['id']}", "icon": "chat", "tone": "amber", "mood": "needs_you", "text": question_title(r)["title"], "detail": question_title(r)["detail"],
                                   "question": {"run_id": r["id"], "question": q["question"], "fields": q["fields"]},
                                   "action": {"run_id": r["id"]}})
    for r in runs:
        if r.get("status") in ("running", "created", "awaiting_approval") and r.get("substatus") == "blocked" and r.get("reason_code") == "plan" and actor.can_prepare:
            need = ((r.get("state") or {}).get("held_for_plan") or {}).get("plan_required") or "Starter"
            suggestions.insert(0, {"key": f"held:{r['id']}", "icon": "lock", "tone": "amber", "mood": "needs_you", "text": question_title(r)["title"],
                                   "held": {"run_id": r["id"], "plan_required_label": need, "task": WORKFLOWS_TITLE(r.get("workflow_key"))},
                                   "action": {"to": "/pricing"}})
    if conc["alert"]:
        # The finding itself, already worked out from the invoices: nothing to run to see it.
        top = conc["top_customers"][0]
        suggestions.append({"key": "concentration", "icon": "alert", "tone": "rose", "mood": "problem",
                            "text": f"{top['customer']} is {top['share_pct']:g}% of your revenue, above your {conc['threshold_pct']:g}% alert level.",
                            "action": {"capability": "risk_concentration", "source_reference": "risk:concentration"}})
    if bz.eligible_for_reminder(data, policy, now) and not any(r["workflow_key"] == "payment_followup" and r["status"] not in RUN_TERMINAL for r in runs):
        due = bz.eligible_for_reminder(data, policy, now)
        owed = sum(bz.invoice_outstanding(i) for i in due)
        what = f"{len(due)} overdue invoice{'s' if len(due) != 1 else ''} ({fmt_money(owed, bz.currency_of(data))} outstanding)"
        if doing and can("payment_followup"):
            suggestions.append({"key": "followup", "icon": "chat", "text": f"{what}: I'm preparing the reminder{'s' if len(due) != 1 else ''} for your approval.",
                                "action": {"to": "/agent?tab=needs_approval"}})
        else:
            suggestions.append({"key": "followup", "icon": "chat", "text": f"{what}. Shall I prepare the reminder{'s' if len(due) != 1 else ''}?",
                                "action": {"capability": "payment_followup"}})
    for q in accepted[:1]:
        suggestions.append({"key": f"accepted:{q['id']}", "icon": "doc",
                            "text": f"{q.get('customer_name') or 'A customer'} accepted quotation {q.get('reference') or q.get('quotation_id') or ''}. "
                                    + ("I'm preparing the invoice for your approval." if doing and can("quote_to_cash") else "Shall I prepare the invoice?"),
                            "action": {"capability": "quote_to_cash", "params": {"quote_id": q["id"]}, "source_reference": f"quote:{q['id']}"}})
    for i in unreceipted[:1]:
        suggestions.append({"key": f"receipt:{i['id']}", "icon": "doc",
                            "text": f"A payment was received from {i.get('customer_name') or 'a customer'}. "
                                    + ("I'm preparing the receipt for your approval." if doing and can("receipt_send") else "Shall I send the receipt?"),
                            "action": {"capability": "receipt_send", "params": {"invoice_id": i["id"]},
                                       "source_reference": "receipt:" + i["id"] + ":" + ",".join(
                                           str(p.get("id")) for p in (i.get("payments") or []) if not (p.get("receipt") or {}).get("sent_at"))}})

    # Only real approvals, newest first. Risk alerts appear in suggestions and risks instead.
    needs_approval = sorted((approval_card(a, now) for a in pending), key=lambda c: c.get("created_at") or "", reverse=True) \
        if actor.can_send or actor.can_prepare else []

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    used = sum(1 for r in runs if (r.get("created_at") or "") >= month_start)
    result = {
        "business_id": business_id,
        "entitlement": {
            "plan": ent["plan"], "is_paid": ent["is_paid"], "max_autonomy": ent["max_autonomy"],
            # Whether this plan can start Agent tasks at all (config.CAPABILITY_MIN_PLAN), and from which plan.
            "agent_tasks": any(agent_config.plan_allows(ent["plan"], c) for c in agent_config.CAPABILITY_MIN_PLAN),
            # What the plan includes and what it counts, from the plan map, so the pages offer only what can run.
            "capabilities": sorted(c for c in agent_config.CAPABILITY_MIN_PLAN if agent_config.plan_allows(ent["plan"], c)),
            "locked": {c: agent_config.PLAN_LABEL[need] for c, need in sorted(agent_config.CAPABILITY_MIN_PLAN.items()) if not agent_config.plan_allows(ent["plan"], c)},
            "quotas": {key: {"limit": agent_config.plan_map.quota(ent["plan"], key),
                             "used": sum(1 for r in runs if r.get("workflow_key") == key and (r.get("created_at") or "") >= month_start)}
                       for key in agent_config.plan_map.QUOTA_WORDS},
            "allowance_counts": bool(agent_config.MONTHLY_TASK_ALLOWANCE_APPLIES),
            # What a task costs to start, in credits (the first figure of its price in words); None where its own product sets the price.
            "prices": {c: (int(m.group()) if (m := re.search(r"\d+", agent_config.cost_of(c))) else None) for c in sorted(agent_config.CAPABILITY_MIN_PLAN)},
            "agent_tasks_from": agent_config.PLAN_LABEL[min(agent_config.CAPABILITY_MIN_PLAN.values(), key=agent_config.plan_rank)],
            "monthly_runs": ent["monthly_runs"], "monthly_runs_used": used,
            "credits": credits,
            "can_prepare": actor.can_prepare, "can_approve": actor.can_send, "can_manage_policy": actor.can_manage_policy,
        },
        "suggestions": suggestions[:4],
        "needs_approval": needs_approval[:8],
        "needs_approval_count": len(needs_approval),
        "needs_attention_count": len(attention),
        "active_runs": [r for r in runs if bucket_of(r) == "active"][:5],
        "risks": risks_of(data, policy, today),
        "insights": insights_of(data, policy, today),
        "currency": bz.currency_of(data),
    }
    if with_context:      # for the dashboard composition, which reads the same records once
        result["_ctx"] = {"data": data, "policy": policy, "now": now, "pending": pending, "runs": runs,
                          "role": "owner" if actor.is_owner else "member", "actor": actor}
    return result


def _hours(a: str | None, b: str | None) -> float | None:
    try:
        return (datetime.fromisoformat(str(b).replace("Z", "+00:00")) - datetime.fromisoformat(str(a).replace("Z", "+00:00"))).total_seconds() / 3600
    except (TypeError, ValueError):
        return None


def _avg(values: list) -> float | None:
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 2) if values else None


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


async def build_metrics(orch, user_id: str, business_id: str, email: str | None = None) -> dict[str, Any]:
    """Instrumentation (s23): measured from workflow, approval and audit records.
    Numerical targets are set after a production baseline (s23.1)."""
    await orch.actor_for(user_id, business_id, email)      # business scope enforced
    store = orch.rt.store
    runs = await store.list_runs(business_id, limit=1000)
    audit = await store.list_audit_business(business_id)
    approvals = await store.list_approvals(business_id=business_id)

    def count(event: str) -> int:
        return sum(1 for a in audit if a["event_type"] == event)

    by_capability: dict[str, int] = {}
    by_channel: dict[str, int] = {}
    for r in runs:
        by_capability[r["capability"]] = by_capability.get(r["capability"], 0) + 1
        channel = r.get("source_channel") or "text"
        by_channel[channel] = by_channel.get(channel, 0) + 1
    finished = [r for r in runs if r["status"] in ("succeeded", "failed", "cancelled")]
    succeeded = [r for r in runs if r["status"] == RUN_SUCCEEDED]
    decided = [a for a in approvals if a["status"] in ("approved", "consumed", "rejected")]
    granted = [a for a in decided if a["status"] != "rejected"]
    tools = [a for a in audit if a["event_type"] == "tool_executed"]
    started = [a for a in audit if a["event_type"] == "workflow_started"]
    free_starts = [a for a in started if (a.get("detail") or {}).get("plan") == "explorer"]
    stops: dict[str, int] = {}
    for a in audit:
        if a["event_type"] == "guardrail_stop":
            code = (a.get("detail") or {}).get("reason_code") or "unknown"
            stops[code] = stops.get(code, 0) + 1

    def sent(tool: str) -> int:
        return sum(1 for a in tools if (a.get("detail") or {}).get("tool") == tool)

    def to_first_approval(r: dict) -> float | None:
        first = next((a for a in audit if a.get("run_id") == r["id"] and a["event_type"] == "approval_requested"), None)
        return _hours(r.get("created_at"), first.get("created_at")) if first else None

    return {
        "adoption": {"workflow_starts": len(runs), "active_users": len({r["requester_id"] for r in runs}),
                     "capability_mix": by_capability, "source_channels": by_channel},
        "quality": {"approval_rate_pct": _rate(len(granted), len(decided)),
                    "cancellation_rate_pct": _rate(sum(1 for r in runs if r["status"] == "cancelled"), len(finished)),
                    "approvals_invalidated": count("approval_invalidated"),
                    "clarifications_answered": count("input_provided")},
        "reliability": {"completion_rate_pct": _rate(len(succeeded), len(finished)),
                        "failed_runs": sum(1 for r in runs if r["status"] == RUN_FAILED),
                        "retries": count("workflow_retried"), "duplicates_prevented": count("duplicate_prevented"),
                        "waiting_runs": sum(1 for r in runs if r["status"] == RUN_RUNNING and r.get("substatus"))},
        "speed": {"avg_hours_to_first_approval_request": _avg([to_first_approval(r) for r in runs if r["workflow_key"] == "enquiry_to_quote"]),
                  "avg_approval_wait_hours": _avg([_hours(a.get("created_at"), a.get("decided_at")) for a in decided]),
                  "avg_workflow_hours": _avg([_hours(r.get("created_at"), r.get("completed_at")) for r in succeeded])},
        "commercial": {"quotations_sent": sent("send_quotation"), "contracts_sent": sent("send_contract"),
                       "invoices_sent": sent("send_invoice"), "reminders_sent": sent("send_payment_reminder"),
                       "receipts_sent": sent("send_receipt"),
                       "quote_to_cash_completed": sum(1 for r in succeeded if r["workflow_key"] == "quote_to_cash")},
        "safety": {"guardrail_stops": stops, "stale_approval_blocks": count("approval_invalidated") + count("approval_expired"),
                   # Duplicates are prevented by design; each prevention is counted under reliability.
                   "duplicate_external_actions": 0,
                   "permission_blocks": stops.get("permission_denied", 0) + stops.get("permission_changed", 0)},
        "economics": {"effectful_actions": len(tools),
                      "actions_per_completed_workflow": round(len(tools) / len(succeeded), 2) if succeeded else None},
        "conversion": {"free_plan_workflow_starts": len(free_starts),
                       "free_plan_users_activated": len({a.get("actor_id") for a in free_starts})},
    }


# ── The Agent's briefing: what it did while the owner was away, and what is waiting ──

_DONE = ("succeeded", "awaiting_approval")


def briefing_of(runs: list[dict], *, since: str | None, needs_approval: int, now: datetime) -> dict:
    """Counts for the dashboard's greeting, from the business's own tasks. `since`: when the owner
    was last here (None if never recorded). Nothing here is a sentence: the page writes those, so the
    wording and its plurals live in one place."""
    waiting = [r for r in runs if r.get("status") == "running" and r.get("pending_question") and not (r.get("pending_question") or {}).get("optional")]
    working = next((r for r in runs if r.get("status") in ("running", "created") and not r.get("pending_question")), None)
    done: dict[str, int] = {}
    if since:
        for r in runs:
            when = r.get("completed_at") or r.get("updated_at") or r.get("created_at") or ""
            if r.get("status") in _DONE and when > since and not (r.get("state") or {}).get("duplicate_of"):
                done[r.get("workflow_key") or "task"] = done.get(r.get("workflow_key") or "task", 0) + 1
    return {
        "last_seen_at": since, "first_visit": since is None and not runs,
        "done_since_last_visit": done, "needs_approval_count": int(needs_approval), "needs_input_count": len(waiting),
        "first_input_run_id": waiting[0]["id"] if waiting else None,
        "working_on": ({"run_id": working["id"], "title": working.get("title") or working.get("goal") or "your task"} if working else None),
        "generated_at": now.isoformat(),
    }

