"""Tasks the Agent starts by itself when the business's records call for one.

Other modules change records (a customer accepts a quotation, a payment is recorded, an
invoice falls overdue). When the owner has switched this on, the Agent notices and starts
the task that follows: the invoice, the receipt, the reminder. Starting is all that is
automatic. Every task still stops for approval before anything is sent, exactly as if the
owner had asked for it, and plan limits and credits apply in the same way.

A record gets one automatic task. If the owner cancels or declines it, it is not started
again for that record.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta

from app.modules.agent import business as bz
from app.modules.agent.models import RUN_TERMINAL, AgentRequest

logger = logging.getLogger(__name__)

CHANNEL = "business_event"
MAX_PER_SWEEP = 5
_MIN_GAP_S = 30.0
_last_sweep: dict[str, float] = {}
_tasks: set[asyncio.Task] = set()


# Every automatic item, by key: the event, the task it starts, and the plan the task needs.
ITEMS = {
    "rfq_arrives": ("A Marketplace request for a quotation arrives", "enquiry_to_quote", "Enquiry to Quote"),
    "quote_accepted": ("A customer accepts a quotation", "quote_to_cash", "Quote to Cash"),
    "payment_recorded": ("A payment is recorded", "receipt_send", "Receipt Sending"),
    "invoice_overdue": ("An invoice becomes overdue", "payment_followup", "Payment Follow-up"),
    "concentration_alert": ("One customer becomes too large a share of revenue", "risk_concentration", "Risk & Concentration"),
    "readiness_refresh": ("A launch or funding check goes out of date", "readiness_refresh", "Readiness Refresh"),
    "launch_evidence_gaps": ("A launch check finds missing evidence or a blocker", "launch_evidence_gaps", "Launch Evidence Gaps"),
    "funding_pack_draft": ("A funding case is on record with no pack drafted", "funding_pack_draft", "Funding Pack Draft"),
    "registration_checklist": ("The business has no company number yet", "registration_checklist", "Registration Checklist"),
    "price_test": ("A new month begins for a growing business", "price_test", "Price Test"),
    "capacity_check": ("A new month begins for a growing business", "capacity_check", "Capacity Check"),
    "offer_review": ("A new month begins for a growing business", "offer_review", "Offer Review"),
    "expansion_scenario": ("A new month begins for a growing business", "expansion_scenario", "Expansion Scenario"),
    "idea_validation": ("An idea is described and has not been scored", "idea_validation", "Idea Validation"),
    "market_size": ("An idea is described and its market has not been sized", "market_size", "Market Size"),
    "business_plan_draft": ("An idea is described and has no business plan", "business_plan_draft", "Business Plan Draft"),
}


def enabled(policy: dict) -> bool:
    return bool((policy.get("automation") or {}).get("auto_start"))


AUTOMATIC_CHANNELS = ("business_event", "marketplace_rfq")


def budget(policy: dict, runs: list[dict], now) -> dict:
    """The month's automatic spend against the owner's cap: credits charged to tasks the Agent
    started by itself this calendar month (as recorded on each task)."""
    cap = int((policy.get("automation") or {}).get("monthly_credit_cap") or 0)
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    used = sum(int(c.get("credits") or 0) for r in runs if r.get("source_channel") in AUTOMATIC_CHANNELS and (r.get("created_at") or "") >= month
               for c in (r.get("state") or {}).get("credits") or [])
    return {"cap": cap, "used": used, "paused": used >= cap}


def item_on(policy: dict, key: str) -> bool:
    """Is this automatic item switched on for the business. Each has its own switch; the
    marketplace one keeps the setting it has always had."""
    if key == "rfq_arrives":
        return bool((policy.get("marketplace_rfq") or {}).get("auto_start", True))
    auto = policy.get("automation") or {}
    return bool(auto.get("auto_start")) and bool((auto.get("items") or {}).get(key, True))


def events(policy: dict, ent: dict) -> list[dict]:
    """What the Agent does when something happens elsewhere in the product, for this business as it
    is set up now. `starts` is automatic | suggested | upgrade | nothing; `approval` says what a
    person still decides. Shown in Agent settings, so the behaviour is never a surprise."""
    from app.modules.agent import config
    plan = ent.get("plan")
    auto = enabled(policy)
    rfq_auto = bool((policy.get("marketplace_rfq") or {}).get("auto_start", True))
    a4 = bool((policy.get("reminders") or {}).get("auto_send")) and ent.get("max_autonomy") == "A4"

    by_capability = {cap: key for key, (_event, cap, _task) in ITEMS.items()}

    def row(event, capability, task, on, approval, how):
        key = by_capability.get(capability)
        if key:
            on = item_on(policy, key)
        if capability and not config.plan_allows(plan, capability):
            starts = "upgrade"
        else:
            starts = "nothing" if not capability else ("automatic" if on else "suggested")
        need = config.CAPABILITY_MIN_PLAN.get(capability, "starter_insight") if capability else None
        return {"event": event, "task": task, "capability": capability, "starts": starts, "approval": approval, "setting": how,
                "credits": config.AUTOMATIC_COST.get(capability) if capability else None,
                "key": key, "switchable": bool(key), "on": bool(key and on), "minimum_plan": need,
                "minimum_plan_label": config.PLAN_LABEL[need] if need else None,
                "available": bool(capability and config.plan_allows(plan, capability))}

    return [
        row("A Marketplace request for a quotation arrives", "enquiry_to_quote", "Enquiry to Quote", rfq_auto,
            "You approve the quotation before it is sent.", "Start drafting a quotation as soon as a Marketplace request arrives"),
        row("A customer accepts a quotation", "quote_to_cash", "Quote to Cash", auto,
            "You approve the invoice (and any contract) before it is sent.", "Start the next task by itself when records change"),
        row("A payment is recorded", "receipt_send", "Receipt Sending", auto,
            "You approve the receipt before it is sent.", "Start the next task by itself when records change"),
        row("An invoice becomes overdue", "payment_followup", "Payment Follow-up", auto,
            "Reminders are sent within your schedule without asking." if a4 else "You approve each reminder before it is sent.",
            "Start the next task by itself when records change"),
        row("One customer becomes too large a share of revenue", "risk_concentration", "Risk & Concentration", auto,
            "Nothing is sent: the Agent works out what losing them would mean and reports it.", "Start the next task by itself when records change"),
        row("A launch or funding check goes out of date", "readiness_refresh", "Readiness Refresh", auto,
            "Nothing is sent: the check is run again and the new result is reported.", None),
        row("A launch check finds missing evidence or a blocker", "launch_evidence_gaps", "Launch Evidence Gaps", auto,
            "Nothing is sent: the gaps are listed for you to fill in.", None),
        row("A funding case is on record with no pack drafted", "funding_pack_draft", "Funding Pack Draft", auto,
            "A draft for you to review. It is never sent to an investor or lender by the Agent.", None),
        row("The business has no company number yet", "registration_checklist", "Registration Checklist", auto,
            "Nothing is filed: registering a company is never automatic.", None),
        row("A new month begins for a growing business", "price_test", "Price Test", auto,
            "Nothing changes: the effect of a 5% and a 10% price rise is worked out and reported. Prices are never changed by the Agent.", None),
        row("A new month begins for a growing business", "capacity_check", "Capacity Check", auto, "Nothing changes: work delivered is compared with what you can deliver.", None),
        row("A new month begins for a growing business", "offer_review", "Offer Review", auto, "Nothing changes: what sells and what doesn't is reported.", None),
        row("A new month begins for a growing business", "expansion_scenario", "Expansion Scenario", auto, "Nothing changes: the effect of growing 20% is worked out and reported.", None),
        row("An idea is described and has not been scored", "idea_validation", "Idea Validation", auto, "Nothing is sent: the score, risks and next steps are reported.", None),
        row("An idea is described and its market has not been sized", "market_size", "Market Size", auto, "Nothing is sent: the figures, sources and assumptions are reported.", None),
        row("An idea is described and has no business plan", "business_plan_draft", "Business Plan Draft", auto, "A draft for you to review. It is never sent to anyone by the Agent.", None),
        row("A customer declines a quotation", None, None, False, "Nothing starts. The assistant knows about it when you ask.", None),
        row("An Agent task finishes or stops", None, None, False, "Nothing starts. The assistant knows the outcome when you ask.", None),
    ]


def candidates(data: dict, policy: dict, runs: list[dict], now) -> list[dict]:
    """What the records call for right now and has no task yet: {capability, params, reference, goal}."""
    invoices = [i for i in (data.get("financials") or {}).get("invoices") or [] if isinstance(i, dict) and not i.get("archived")]
    references = {r.get("source_reference") for r in runs if r.get("source_reference")}

    def tasks_for(workflow: str, key: str, record_id: str) -> list[dict]:
        return [r for r in runs if r.get("workflow_key") == workflow and str((r.get("state") or {}).get(key)) == str(record_id)]

    out: list[dict] = []
    # An accepted quotation that hasn't been invoiced: prepare the invoice.
    invoiced = {i.get("quote_id") for i in invoices if i.get("quote_id")}
    for q in bz.quotes_of(data) if item_on(policy, "quote_accepted") else []:
        if bz.status_of(q) in ("accepted", "won") and not q.get("archived") and q["id"] not in invoiced \
                and f"quote:{q['id']}" not in references and not tasks_for("quote_to_cash", "quote_id", q["id"]):
            ref = q.get("reference") or q.get("quotation_id") or ""
            out.append({"capability": "quote_to_cash", "params": {"quote_id": q["id"]}, "reference": f"quote:{q['id']}",
                        "goal": f"Started automatically: quotation {ref} was accepted".strip()})
    # A recorded payment with no receipt sent: prepare the receipt.
    for i in invoices if item_on(policy, "payment_recorded") else []:
        waiting = [str(p.get("id")) for p in i.get("payments") or [] if isinstance(p, dict) and not (p.get("receipt") or {}).get("sent_at")]
        reference = f"receipt:{i.get('id')}:{','.join(waiting)}"
        if waiting and reference not in references \
                and not any(r["status"] not in RUN_TERMINAL for r in tasks_for("receipt_send", "invoice_id", i.get("id"))):
            out.append({"capability": "receipt_send", "params": {"invoice_id": i["id"]}, "reference": reference,
                        "goal": f"Started automatically: a payment was recorded on {i.get('reference') or 'an invoice'}"})
    # An overdue invoice that is due a reminder under the business's own schedule.
    gap = timedelta(days=int((policy.get("reminders") or {}).get("min_interval_days") or 7))
    for i in bz.eligible_for_reminder(data, policy, now) if item_on(policy, "invoice_overdue") else []:
        recent = [r for r in tasks_for("payment_followup", "invoice_id", i.get("id"))
                  if r["status"] not in RUN_TERMINAL or (bz._moment(r.get("created_at")) or now) > now - gap]
        reference = f"followup:{i.get('id')}:{len(i.get('reminders') or [])}"
        if not recent and reference not in references:
            out.append({"capability": "payment_followup", "params": {"invoice_id": i["id"]}, "reference": reference,
                        "goal": f"Started automatically: {i.get('reference') or 'an invoice'} is overdue"})
    # One customer has passed the alert level: work out what losing them would mean and report it.
    # Once a month for the same customer; nothing is sent to anyone.
    if item_on(policy, "concentration_alert"):
        conc = bz.concentration(data, float((policy.get("risk") or {}).get("concentration_alert_pct") or 40))
        if conc["alert"] and conc["top_customers"]:
            top = conc["top_customers"][0]["customer"]
            reference = f"risk:concentration:{now:%Y-%m}:{top}"
            if reference not in references:
                out.append({"capability": "risk_concentration", "params": {}, "reference": reference,
                            "goal": f"Started automatically: {top} is {conc['top1_share_pct']:g}% of revenue"})
    return out


async def preparation(orch, business_id: str, data: dict, policy: dict, runs: list[dict], owner_id: str) -> list[dict]:
    """The launch, funding and registration work the records call for and that has no task yet.
    Each is done once for the state it was prepared from, and again only when that state changes."""
    references = {r.get("source_reference") for r in runs if r.get("source_reference")}
    wanted = [k for k in ("readiness_refresh", "launch_evidence_gaps", "funding_pack_draft", "registration_checklist") if item_on(policy, k)]
    out: list[dict] = []

    def add(capability: str, reference: str, goal: str) -> None:
        if reference not in references:
            out.append({"capability": capability, "params": {}, "reference": reference, "goal": goal})

    def covered(workflow: str, assessment_id: str | None) -> bool:
        """Has this already been prepared from this very check (whatever started the task)."""
        return bool(assessment_id) and any(r.get("workflow_key") == workflow and r.get("status") == "succeeded"
                                           and ((r.get("state") or {}).get("outcome") or {}).get("assessment_id") == assessment_id for r in runs)

    if set(wanted) - {"registration_checklist"}:
        try:
            from app.modules.readiness.service import service_for
            actor, _ = await orch.actor_for(owner_id, business_id)
            picks = await service_for(orch).dashboard_summaries(business_id, data, actor, orch.rt.clock())
        except Exception:      # noqa: BLE001 - readiness is optional: without it there is simply nothing to prepare
            logger.warning("could not read readiness for business %s", business_id, exc_info=True)
            picks = {}
        launch, funding = picks.get("launch"), picks.get("funding")
        if "readiness_refresh" in wanted:
            stale = [p for p in (launch, funding) if p and p.get("freshness") == "stale" and p.get("assessment_id")]
            if stale:
                add("readiness_refresh", "readiness:refresh:" + ",".join(sorted(p["assessment_id"] for p in stale)), "Started automatically: a readiness check was out of date")
        if "launch_evidence_gaps" in wanted and launch and launch.get("freshness") != "stale":
            if not launch.get("assessment_id"):      # a launch with no check yet: the Agent runs the first one itself
                add("launch_evidence_gaps", f"launch:gaps:first:{launch['initiative_id']}", "Started automatically: a launch is on record and has not been checked")
            elif (launch.get("missing_count") or launch.get("blockers")) and not covered("launch_evidence_gaps", launch["assessment_id"]):
                add("launch_evidence_gaps", f"launch:gaps:{launch['assessment_id']}", "Started automatically: the launch check found gaps")
        if "funding_pack_draft" in wanted and funding and not covered("funding_pack_draft", funding.get("assessment_id")):
            add("funding_pack_draft", f"funding:pack:{funding.get('assessment_id') or funding['case_id']}", "Started automatically: a funding case has no pack drafted")
    if item_on(policy, "price_test"):
        try:
            from app.modules.agent.dashboard import stage_of
            growing = stage_of(data, orch.rt.clock()).get("stage") == "growth"
        except Exception:      # noqa: BLE001
            growing = False
        if growing:
            add("price_test", f"price:test:{orch.rt.clock():%Y-%m}", "Started automatically: this month's price test")
    stage = None
    try:
        from app.modules.agent.dashboard import stage_of
        stage = stage_of(data, orch.rt.clock()).get("stage")
    except Exception:      # noqa: BLE001
        stage = None
    month = f"{orch.rt.clock():%Y-%m}"
    if stage == "growth":
        for key, goal in (("capacity_check", "this month's capacity check"), ("offer_review", "this month's review of what sells"),
                          ("expansion_scenario", "this month's expansion scenario")):
            if item_on(policy, key):
                add(key, f"{key}:{month}", f"Started automatically: {goal}")
    if stage in ("idea", "pre_launch"):
        # Done once from what the business has said about itself. The generators cost credits,
        # so the monthly budget for automatic work applies to them like any other paid item.
        from app.modules.agent.workflows import idea_of
        idea, done = idea_of(data), data.get("agent_studio") or {}
        described = bool(idea["description"])
        validated = bool((data.get("validation") or {}).get("overall_score") or (data.get("decision") or {}).get("status") == "accepted" or done.get("validation"))
        # Not yet described: the task still starts, and asks the one thing it needs on the Agent card.
        if item_on(policy, "idea_validation") and not validated:
            add("idea_validation", "idea:validation", "Started automatically: the idea has not been scored")
        if stage == "idea" and item_on(policy, "market_size") and described and not done.get("market"):
            add("market_size", "idea:market", "Started automatically: the market has not been sized")
        if stage == "idea" and item_on(policy, "business_plan_draft") and described and not done.get("plan") \
                and not (data.get("business_plan") or data.get("live_plan") or data.get("blueprints")):
            add("business_plan_draft", "idea:plan", "Started automatically: there is no business plan yet")
    if "registration_checklist" in wanted:
        from app.modules.agent.workflows import registration_number
        trading = any(isinstance(i, dict) for i in (data.get("financials") or {}).get("invoices") or [])
        if not registration_number(data) and not trading:      # before the first invoice: still setting up
            add("registration_checklist", "registration:checklist", "Started automatically: the business has no company number yet")
    return out


_ASKS_ABOUT_THE_BUSINESS = ("idea_validation", "market_size", "business_plan_draft")


async def answer_from_profile(orch, business_id: str, data: dict, runs: list[dict]) -> int:
    """Tasks waiting on a question about the business are checked against the profile again:
    one the profile now answers carries on, and one it can now guess at switches to the
    "Is this right?" form. Returns how many changed."""
    from app.modules.agent import current
    changed = 0
    for r in runs:
        if r.get("status") != "running" or not r.get("pending_question"):
            continue
        before = (r.get("pending_question") or {}).get("question")
        after = await current.recheck_against_profile(orch, r, data)
        if after.get("status") != "running" or (after.get("pending_question") or {}).get("question") != before:
            changed += 1
    return changed


async def sweep(orch, business_id: str, limit: int = MAX_PER_SWEEP) -> list[dict]:
    """Start the tasks the records call for, in the owner's name. Returns the tasks started.
    Does nothing unless the owner has switched automatic starting on."""
    policy = await orch.rt.store.get_policy(business_id)
    try:      # housekeeping that applies whether or not automatic starting is on
        await orch.close_unanswered(await orch.rt.store.list_runs(business_id, limit=500))
    except Exception:      # noqa: BLE001
        logger.warning("could not close unanswered tasks for %s", business_id, exc_info=True)
    if not enabled(policy):
        return []
    _last_sweep[business_id] = time.monotonic()
    ent = await orch.entitlement(business_id)
    data = await orch.rt.business.load(business_id)
    runs = await orch.rt.store.list_runs(business_id, limit=500)
    if await orch.release_stalled(runs) + await orch.auto_retry(await orch.rt.store.list_runs(business_id, limit=500)) \
            + await answer_from_profile(orch, business_id, data, runs):
        runs = await orch.rt.store.list_runs(business_id, limit=500)      # picked up again before anything new is started
    started: list[dict] = []
    todo = [*candidates(data, policy, runs, orch.rt.clock()), *await preparation(orch, business_id, data, policy, runs, ent["owner_id"])]
    from app.modules.agent import config as agent_config
    if budget(policy, runs, orch.rt.clock())["paused"]:
        # The month's automatic budget is used: work that costs credits waits. Free work carries on.
        todo = [c for c in todo if c["capability"] in agent_config.FREE_CAPABILITIES]
    for c in todo[:limit]:
        res = await orch.submit(AgentRequest(
            requesting_actor_id=ent["owner_id"], business_id=business_id, source_channel=CHANNEL,
            source_reference=c["reference"], requested_capability=c["capability"], params=c["params"], resolved_goal=c["goal"]))
        if res.get("kind") == "blocked":
            break      # the plan's limit or the credit balance: the rest wait, like any other request
        if res.get("kind") == "workflow" and not res.get("duplicate") and not res.get("repeat"):
            started += res.get("runs") or []
    if started:
        logger.info("agent started %s task(s) automatically for business %s", len(started), business_id)
    return started


def later(business_id: str, orch=None) -> None:
    """Records have just changed somewhere else in the product: look at them shortly, in the
    background, without holding up whatever changed them. Several changes close together are one look."""
    if not business_id or time.monotonic() - _last_sweep.get(business_id, -_MIN_GAP_S) < _MIN_GAP_S:
        return
    _last_sweep[business_id] = time.monotonic()

    async def _run():
        try:
            from app.modules.agent.router import get_orchestrator
            the = orch or get_orchestrator()
            if not enabled(await the.rt.store.get_policy(business_id)):
                # Automatic starting is off, but a task that stopped part-way is still surfaced.
                await the.release_stalled(await the.rt.store.list_runs(business_id, limit=200))
                await the.auto_retry(await the.rt.store.list_runs(business_id, limit=200))
                await answer_from_profile(the, business_id, await the.rt.business.load(business_id), await the.rt.store.list_runs(business_id, limit=200))
            await sweep(the, business_id)
        except Exception:      # noqa: BLE001 - never surfaces in the save that triggered it
            logger.warning("automatic start failed for business %s", business_id, exc_info=True)

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def sweep_all(orch) -> int:
    """The scheduler's pass: time alone makes an invoice overdue, with no record changing."""
    started = 0
    for business_id in await orch.rt.store.auto_start_businesses():
        try:
            started += len(await sweep(orch, business_id))
        except Exception:      # noqa: BLE001 - one business never stops the rest
            logger.warning("automatic start failed for business %s", business_id, exc_info=True)
    return started
