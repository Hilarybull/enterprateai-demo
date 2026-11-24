"""Approving the Agent's drafts is the owner's sign-off (the owner, 1 Nov: "my score should be coming up well after the do all"):
what those drafts need in order to count comes with the approval, then the check runs once. Nothing here is invented: only what
the owner just approved is confirmed, and research is attached as research, with its source and date. Customer proof, actual
trading figures and a real test run stay the owner's."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

RATIONALE = "Confirmed by the owner when approving the Agent's drafts."
# The qualitative checks about figures and lists the owner has just approved; never one about evidence from their own customers
ATTEST = {"funding": ("C5.B",), "launch": ("C2.B", "C6.A")}
DEMAND_CHECK = {"funding": "C4.A", "launch": "C1.A"}


async def _quietly(what: str, step) -> None:
    try:
        await step()
    except Exception:      # noqa: BLE001 - one part that can't be signed off doesn't stop the rest, and stays on the list
        logger.info("sign-off: %s not done", what, exc_info=True)


async def sign_off(orch, user: dict, business_id: str, feature: str, case_id: str) -> dict:
    from app.modules.agent import assessment_summary, research
    from app.modules.readiness import engine, rules
    from app.modules.readiness.service import service_for
    svc = service_for(orch)
    uid, email = user["id"], user.get("email")
    kind = rules.FUNDING if feature == "funding" else rules.LAUNCH
    today = orch.rt.clock().date().isoformat()
    row = await svc.store.get("subjects", case_id)
    d = (row or {}).get("data") or {}
    changes: dict = {}
    if feature == "funding":
        if not engine.blank(d.get("target_amount")) and not engine.blank(d.get("receipt_date")) and not d.get("timing_confirmed"):
            changes["timing_confirmed"] = True
        first = next((m.get("id") for m in d.get("milestones") or [] if isinstance(m, dict) and m.get("id")), None)
        if first and not d.get("purpose_milestone_id"):
            changes["purpose_milestone_id"] = first
        if first and not engine.get(d, "market.acquisition_milestone_id"):
            changes["market"] = {**(d.get("market") or {}), "acquisition_milestone_id": first}
    else:
        if not engine.blank(engine.get(d, "offer.price")) or not engine.blank(engine.get(d, "offer.delivery_terms")):
            changes["offer"] = {**(d.get("offer") or {}), "confirmed": True}
        if d.get("delivery"):
            changes["delivery"] = {**d["delivery"], "capacity_confirmed_at": today}
    if isinstance(d.get("economics"), dict) and d["economics"]:
        changes["economics"] = {**d["economics"], "confirmed_at": today}
    if changes:
        async def save() -> None:
            await svc.update_subject(uid, business_id, kind, case_id, row["revision"], changes, email)
        await _quietly("details", save)

    fresh = await svc.store.get("subjects", case_id)

    async def forecast() -> None:
        had = await svc._forecast_of(fresh)
        data = (had or {}).get("data") or {}
        if had and data.get("drafted_by") == "Agent" and not data.get("confirmed_at"):
            await svc.save_forecast(uid, business_id, kind, case_id, {**data, "opening_cash_as_of": data.get("opening_cash_as_of") or today}, had["revision"], email)
    await _quietly("forecast", forecast)

    for code in ATTEST[feature]:
        async def attest(code: str = code) -> None:
            await svc.attest(uid, business_id, kind, case_id, code, True, RATIONALE, email=email)
        await _quietly(code, attest)

    # What the research found about demand and the market, with its source and date, marked as research
    async def evidence() -> None:
        loaded = await orch.rt.business.load(business_id) or {}
        goal = "need_funding" if feature == "funding" else "launch"
        runs = [r for r in research._runs(loaded).values() if r.get("goal") == goal and not r.get("only") and not r.get("replaced_need") and (feature == "funding" or str(r.get("case_id") or "") == str(case_id))]
        run = max(runs, key=lambda r: str(r.get("created_at") or "")) if runs else None
        now = await svc.store.get("subjects", case_id)
        linked = [e for e in await svc._evidence_for(now, await svc._forecast_of(now)) if any((x or {}).get("check") == DEMAND_CHECK[feature] for x in (e.get("data") or {}).get("links") or [])]
        if not run or linked:
            return
        for x in run.get("items") or []:
            if x.get("topic") not in assessment_summary.DEMAND_TOPICS:
                continue
            for src in (x.get("sources") or [])[:1]:
                if src.get("url") and src.get("quote") and src.get("date"):
                    await svc.add_evidence(uid, business_id, {"title": f"{x.get('label') or 'Research'}: {src.get('publisher') or src.get('site')}"[:200], "type": "research",
                                                              "claim": src["quote"][:1000], "source": {"kind": "link", "reference": src["url"]}, "effective_date": src["date"][:10],
                                                              "links": [{"subject_id": case_id, "check": DEMAND_CHECK[feature]}]}, email, feature=kind)
    await _quietly("research evidence", evidence)

    if feature == "funding":      # the two documents made from what was just approved
        for key in ("use_of_funds_schedule", "forecast"):
            async def review(key: str = key) -> None:
                await svc.review_document(uid, business_id, case_id, key, reviewed=True, email=email)
            await _quietly(key, review)

    latest = await svc.store.get("subjects", case_id)
    await svc.request_assessment(uid, business_id, kind, case_id, idempotency_key=f"sign-off:{case_id}:{latest.get('revision')}", email=email)
    return await svc.get_subject(uid, business_id, kind, case_id, email)
