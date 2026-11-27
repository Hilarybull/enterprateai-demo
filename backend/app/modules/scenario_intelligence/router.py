from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.shared.auth.deps import get_current_user
from app.modules.scenario_intelligence.schemas import (
    BusinessStateSnapshot,
    DoNothingRequest,
    DoNothingResponse,
    RecommendationGenerateRequest,
    RecommendationGenerateResponse,
    RiskDetectionRequest,
    RiskDetectionResponse,
    ScenarioDecisionRequest,
    ScenarioDecisionResponse,
    ScenarioHistoryResponse,
    ScenarioRunRequest,
    ScenarioRunResponse,
    ScenarioRunResult,
    ScenarioTemplateListResponse,
    ScenarioTimelineResponse,
)
from app.modules.scenario_intelligence.service import (
    ENGINE_VERSION,
    clear_history,
    create_scenario_run,
    detect_risks,
    do_nothing_projection,
    forecast_accuracy,
    generate_scenario_interpretation,
    get_recommendations,
    get_scenario_run,
    get_scenario_timeline,
    recommend_scenarios,
    resolve_template,
    save_decision,
    save_risk_signals,
    scenario_history,
    template_list,
)
from app.modules.scenario_intelligence.orchestration_service import run_full_engine_suite
from app.modules.credits.service import credit_guard

router = APIRouter(prefix="/v1/scenario-intelligence", tags=["scenario-intelligence"])


# ── Simulation audit, Phase 4: the caller must be able to see the business ─────────────────────────────────────────
# Every endpoint that names a business, or a run (which belongs to one), checks it the way the Agent does
# (goal_router._business_for): no access reads as "not found", so nothing about another business is revealed. If the
# check itself can't be made, the request is refused rather than answered without it.

async def _require_business(user: dict, business_id: str | None) -> None:
    if not business_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    from app.modules.agent.orchestrator import AccessDenied
    from app.modules.agent.router import get_orchestrator
    try:
        actor, _policy = await get_orchestrator().actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.") from e
    except Exception as e:      # noqa: BLE001 - fail closed
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Access to this business couldn't be checked just now. Please try again.") from e
    if not getattr(actor, "can_view", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


async def _require_run(user: dict, scenario_run_id: str) -> dict:
    run = await get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    try:
        await _require_business(user, run.get("business_id"))
    except HTTPException as e:
        if e.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found") from e
        raise
    return run


@router.post("/risk-detection/run", response_model=RiskDetectionResponse)
async def risk_detection_run(
    payload: RiskDetectionRequest,
    _user=Depends(get_current_user),
) -> RiskDetectionResponse:
    await _require_business(_user, payload.business_id)
    payload.state = await shared_state(_user, payload.business_id, payload.state)
    signals = detect_risks(payload.state)
    saved = await save_risk_signals(payload.tenant_id, payload.business_id, payload.state_version, signals)
    return RiskDetectionResponse(
        business_id=payload.business_id,
        engine_version=ENGINE_VERSION,
        risk_signals=saved,
    )


@router.post("/recommendations/generate", response_model=RecommendationGenerateResponse)
async def recommendations_generate(
    payload: RecommendationGenerateRequest,
    _user=Depends(get_current_user),
) -> RecommendationGenerateResponse:
    await _require_business(_user, payload.business_id)
    # AI-Powered Decision Recommendations are on Starter and above (the pricing PDF, 19 Oct 2026).
    from app.modules.plans.access import has_grant, plan_meets, refusal
    if not (await plan_meets(_user["id"], "starter_insight") or await has_grant(_user["id"], "simulation")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=await refusal(_user["id"], "starter_insight", "AI-Powered Decision Recommendations"))
    # In MVP, use current state to re-derive risk signals deterministically.
    payload.state = await shared_state(_user, payload.business_id, payload.state)
    risk_signals = detect_risks(payload.state)
    recs = recommend_scenarios(risk_signals)
    return RecommendationGenerateResponse(business_id=payload.business_id, recommended_scenarios=recs)


@router.get("/scenario-templates", response_model=ScenarioTemplateListResponse)
async def scenario_templates_list(
    business_type: str | None = Query(default=None),
    _user=Depends(get_current_user),
) -> ScenarioTemplateListResponse:
    # business_type reserved for future filtering
    return ScenarioTemplateListResponse(templates=template_list())


# QA PF1: which scenarios each plan can run, checked on the server too (the page's planAllowsScenario, the same
# rule): the baseline projection on every plan; four scenarios on Starter, 4 runs a month; every scenario, with no
# monthly limit, from Decision Engine.
# Running one is deterministic and free (Credit System v2 §6); only the AI explanation is charged.
STARTER_SCENARIOS = ("tmpl_client_loss", "tmpl_payment_delay", "tmpl_revenue_drop", "tmpl_cost_increase")
FREE_SCENARIOS = ("do_nothing_projection",)


def scenario_minimum_plan(template_id: str | None) -> str:
    if not template_id or template_id in FREE_SCENARIOS:
        return "explorer"
    return "starter_insight" if template_id in STARTER_SCENARIOS else "decision_engine"


STARTER_RUNS_A_MONTH = 4      # the owner (20 Oct 2026): 4 scenario simulations a month on Starter, as the Agent counts them


async def _require_scenario(user_id: str, template_id: str | None, name: str, business_id: str | None = None) -> None:
    from app.modules.plans.access import effective_plan_key, has_grant, plan_meets, refusal
    need = scenario_minimum_plan(template_id)
    if need == "explorer" or await has_grant(user_id, "simulation"):
        return
    if not await plan_meets(user_id, need):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=await refusal(user_id, need, name or "This scenario"))
    if business_id and await effective_plan_key(user_id) == "starter_insight":
        # Starter: 4 scenario simulations a month (the baseline projection is free and never counted).
        from datetime import datetime, timezone
        from app.core.supabase import sb_select
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        try:
            runs = await sb_select("scenario_runs", filters=[("business_id", "eq", business_id), ("created_at", "gte", start)], columns="scenario_template_id") or []
        except Exception:      # noqa: BLE001 - can't count: the run goes ahead
            runs = []
        if len([r for r in runs if r.get("scenario_template_id") not in FREE_SCENARIOS]) >= STARTER_RUNS_A_MONTH:
            detail = await refusal(user_id, "decision_engine", "More scenario simulations")
            detail["message"] = (f"You've used all {STARTER_RUNS_A_MONTH} scenario simulations included in the Starter plan this month. "
                                 "Decision Engine has no monthly limit.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# ── QA PF4: no run (and no charge) without the data a projection needs ──────────────────────────────────────────

async def estimate_baseline(user: dict, business_id: str) -> dict | None:
    """A forecast baseline from the owner's own pricing or idea answers (£70 × 25 a month), labelled "Estimate", for
    when nothing is on record yet. Only figures they gave; None when there are none."""
    try:
        from app.modules.agent.router import get_orchestrator
        orch = get_orchestrator()
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
        if not getattr(actor, "can_view", False):
            return None
        data = await orch.rt.business.load(business_id) or {}
    except Exception:      # noqa: BLE001 - no estimate then; the owner is told what is missing
        return None
    # QA R9-5: every fact the workspace holds (any check, any adopted review, the catalogue), the same reader the
    # premium reviews use; the baseline says where its figures came from, and that it is an estimate.
    from app.modules.agent import research
    checks = [v for v in (data.get("quick_check_answers") or {}).values() if isinstance(v, dict)]
    latest = max(checks, key=lambda v: v.get("at") or "").get("offering") if checks else None      # what was last worked on
    i = research.inputs_of("price_offer", {"sell": latest} if latest else {}, data)
    if i.get("price") and i.get("monthly_sales"):
        cur = research.context_of(data, i).get("currency")
        src = i.get("_from") or {}
        cost, fixed = i.get("cost") or 0, i.get("fixed_costs") or 0
        where = sorted({src[k] for k in ("price", "monthly_sales", "cost", "fixed_costs") if src.get(k)})
        return {"label": "Estimate", "from": where,
                "basis": f"{research.money(i['price'], cur)} × {i['monthly_sales']:g} a month" + (f", {', '.join(w[0].lower() + w[1:] for w in where)}" if where else ""),
                "state": {"revenue_monthly": round(i["price"] * i["monthly_sales"], 2), "cost_of_sales_monthly": round(cost * i["monthly_sales"], 2),
                          "expenses_monthly": round(fixed, 2)}}
    return None


async def shared_state(user: dict, business_id: str, state):
    """The state with the one set of figures in place (R-4, agent/figures.py): monthly revenue, monthly costs, cash and the
    biggest customer's share, the same the risk check and the dashboard show. Simulation's own figures stay for the rest."""
    try:
        from app.modules.agent import figures
        from app.modules.agent.router import get_orchestrator
        orch = get_orchestrator()
        actor, _policy = await orch.actor_for(user["id"], business_id, user.get("email"))
        if not getattr(actor, "can_view", False):
            return state
        data = await orch.rt.business.load(business_id) or {}
        from app.modules.agent import fx
        await fx.ensure(orch, business_id, data)
        f = figures.of(data)
    except Exception:      # noqa: BLE001 - Simulation's own figures then
        return state
    from app.modules.agent.business import receivable_timing as timing
    from datetime import datetime, timezone
    due = timing(data, datetime.now(timezone.utc).date())
    update: dict = {"overdue_receivables_count": len(due["overdue"]),
                    "approaching_receivables_count": len(due["approaching"])}
    sources = dict(state.figure_sources or {})
    said = f.get("sources") or {}
    if f.get("revenue_monthly") is not None:
        update["revenue_monthly"] = max(0.0, float(f["revenue_monthly"]))
        sources["revenue_monthly"] = str(said.get("revenue_monthly") or "the shared monthly revenue")
    if f.get("costs_monthly"):
        update["expenses_monthly"] = float(f["costs_monthly"])
        update["costs_monthly"] = round(float(f["costs_monthly"]) + float(state.cost_of_sales_monthly or 0), 2)
        sources["expenses_monthly"] = str(said.get("costs_monthly") or "the shared monthly costs")
    if sources:
        update["figure_sources"] = sources
    if f.get("cash") is not None:
        update["starting_cash"] = float(f["cash"])
        sources["starting_cash"] = str(said.get("cash") or "the shared cash figure")
    if f.get("top_share") is not None:
        update["top_client_share_pct"] = min(100.0, float(f["top_share"]))
    if f.get("clients"):
        update["clients_count"] = int(f["clients"])
    update.update(_phase5_from_records(state, data, update))
    return state.model_copy(update=update) if update else state


def _phase5_from_records(state, data: dict, update: dict, today=None) -> dict:
    """Fill settings from records and use one invoice-date window for revenue and both cost components.

    Owner-entered optional settings win; payment timing comes from invoice evidence.
    Current-month actuals, record checks and source descriptions travel with the snapshot.
    """
    from datetime import date as _date, datetime, timedelta, timezone
    from app.modules.agent import business as bz
    from app.modules.agent import figures
    from app.modules.scenario_intelligence import factors, records
    today = today or bz.local_now(data, datetime.now(timezone.utc)).date()
    out: dict = {}
    sources = dict(update.get("figure_sources") or state.figure_sources or {})
    try:
        rec = records.build(data, today)
    except Exception:      # noqa: BLE001 - the page's figures then
        rec = {"histories": {}, "fills": {}, "sources": {}}
    if rec.get("histories"):
        out.update(rec["histories"])
        sources["histories"] = rec["sources"].get("histories", "your records")
    owner_set = lambda k: getattr(state, k, None) not in (None, "")      # noqa: E731
    for k, v in (rec.get("fills") or {}).items():
        if k == "payment_terms_days" or not owner_set(k):      # payment terms are never typed in the settings: records win
            out[k] = v
            sources[k] = rec["sources"].get(k, "your records")
    if rec.get("current_month"):
        out["current_month_recorded"] = rec["current_month"]
        if rec["current_month"].get("cash") is not None:
            out["starting_cash"] = rec["current_month"]["cash"]
            sources["starting_cash"] = "recorded payments received less paid expenses and delivery costs in Business Operations"
    out.update(rec.get("position") or {})
    if rec.get("checks"):
        out["record_checks"] = rec["checks"]

    # A new business without complete sales months still needs the recorded payroll/direct-cost split.
    if not rec.get("levels"):
        since = today - timedelta(days=figures.WINDOW_DAYS)
        spent = [e for e in (data.get("financials") or {}).get("expenses") or []
                 if not e.get("archived") and bz.status_of(e) == "paid" and since <= (records.expense_date(e) or _date.min) <= today]
        kinds = factors.classify_expenses(spent)
        shared_costs = update.get("expenses_monthly")
        if kinds.get("total", 0) > 0 and shared_costs is not None:
            direct = round(float(shared_costs) * kinds["direct"] / kinds["total"], 2)
            out.update(cost_of_sales_monthly=direct, expenses_monthly=round(float(shared_costs) - direct, 2), costs_monthly=float(shared_costs))
            sources["cost_of_sales_monthly"] = "direct-cost categories in recorded expenses, last 92 days (no complete sales months)"
    # The same invoice-date window supplies revenue and both cost components.
    out.update(rec.get("levels") or {})
    for key in rec.get("levels") or {}:
        sources[key] = rec["sources"][key]
    out["figure_notes"] = rec.get("figure_notes") or []
    out["figure_sources"] = sources
    return out


async def _with_enough_data(user: dict, business_id: str, state, params: dict | None):
    """The state to project, or a 422 saying what is missing (and the estimate on offer). With `use_estimate`, the
    owner's own pricing answers are the baseline, and the run is labelled an estimate."""
    from app.modules.scenario_intelligence.service import sufficiency
    enough = sufficiency(state)
    if enough["enough"]:
        return state, None
    estimate = await estimate_baseline(user, business_id)
    if (params or {}).get("use_estimate") and estimate:
        return state.model_copy(update=estimate["state"]), estimate
    raise HTTPException(status_code=422, detail={
        "error": "INSUFFICIENT_DATA", "missing": enough["missing"], "estimate": estimate,
        "message": "There isn't enough on record to project yet: " + " and ".join(m.lower() for m in enough["missing"]) + ". Nothing was run and nothing was charged."
                   + (f" You can use your own figures as an estimate instead ({estimate['basis']})." if estimate else
                      " Record your sales and costs, or answer the pricing check, to project from them.")})


@router.post("/scenario-runs", response_model=ScenarioRunResponse)
async def scenario_runs_create(
    payload: ScenarioRunRequest,
    _user=Depends(get_current_user),
) -> ScenarioRunResponse:
    await _require_business(_user, payload.business_id)
    template = resolve_template(payload.scenario_template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario template not found")
    await _require_scenario(_user["id"], payload.scenario_template_id, getattr(template, "name", None) or payload.scenario_name or "This scenario",
                            business_id=payload.business_id)
    from app.modules.scenario_intelligence.service import CLIENT_SCENARIOS, has_client
    payload.state = await shared_state(_user, payload.business_id, payload.state)      # the risk check's figures (R-4)
    if payload.scenario_template_id in CLIENT_SCENARIOS and not has_client(payload.state):
        raise HTTPException(status_code=422, detail={"error": "NO_CLIENT_ON_RECORD",
                                                     "message": "There's no client on record, so there is no largest client to lose. Nothing was run."})
    state, estimate = await _with_enough_data(_user, payload.business_id, payload.state, payload.parameters)
    if estimate:
        payload.parameters = {**(payload.parameters or {}), "basis": "estimate", "estimate_basis": estimate["basis"]}
    payload.state = state

    run_doc = await create_scenario_run(
        tenant_id=payload.tenant_id,
        business_id=payload.business_id,
        state_version=payload.state_version,
        template_id=payload.scenario_template_id,
        scenario_mode=payload.scenario_mode,
        scenario_name=payload.scenario_name,
        scenario_type=template.scenario_type,
        params=payload.parameters,
        state=payload.state,
    )
    return ScenarioRunResponse(
        scenario_run_id=run_doc["scenario_run_id"],
        status=run_doc["status"],
        engine_version=run_doc["engine_version"],
        baseline_snapshot_id=run_doc["scenario_run_id"],
        timeline_months=run_doc["timeline_months"],
    )


@router.post("/scenario-runs/{scenario_run_id}/execute")
async def scenario_runs_execute(
    scenario_run_id: str,
    _user=Depends(get_current_user),
) -> dict:
    await _require_run(_user, scenario_run_id)
    return {"scenario_run_id": scenario_run_id, "status": "completed"}


@router.post("/scenario-runs/{scenario_run_id}/explain")
async def scenario_runs_explain(
    scenario_run_id: str,
    user=Depends(get_current_user),
) -> dict:
    run = await _require_run(user, scenario_run_id)

    # QA PF4: the narrative only describes the engine's output. With nothing on record behind it, it says so, with
    # no model call and no charge.
    base = run.get("baseline_snapshot") or {}
    if not any(float(base.get(k) or 0) for k in ("revenue_monthly", "costs_monthly", "expenses_monthly", "cost_of_sales_monthly")):
        return {"scenario_run_id": scenario_run_id, "interpretation": "There is not enough data on record to explain this scenario: no revenue or costs. "
                "Record your sales and costs, or run it from an estimate, and the explanation will describe what the projection shows.",
                "provider": None, "model": None, "total_tokens": 0, "not_enough_data": True}
    async with credit_guard(user["id"], "scenario_ai_interpretation"):
        try:
            return await generate_scenario_interpretation(scenario_run_id, user["id"])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")


@router.get("/scenario-runs/{scenario_run_id}", response_model=ScenarioRunResult)
async def scenario_runs_get(
    scenario_run_id: str,
    _user=Depends(get_current_user),
) -> ScenarioRunResult:
    run = await _require_run(_user, scenario_run_id)
    recs = await get_recommendations(scenario_run_id)
    timeline = await get_scenario_timeline(scenario_run_id)
    timeline_summary = {f"month_{t['month_index']}": t["state_label"] for t in timeline}

    scenario_snapshot = run.get("scenario_snapshot")
    # Use stored signals if they exist (calculated from timeline outcome)
    risk_signals = run.get("risk_signals", [])
    
    if not risk_signals and isinstance(scenario_snapshot, dict):
        try:
            scenario_state = BusinessStateSnapshot(**scenario_snapshot)
            for sig in detect_risks(scenario_state):
                risk_signals.append(dict(risk_signal_id=str(uuid4()), **sig))
        except Exception:
            risk_signals = []

    return ScenarioRunResult(
        scenario_run_id=run["scenario_run_id"],
        scenario_name=run["scenario_name"],
        scenario_type=run["scenario_type"],
        baseline_snapshot=run.get("baseline_snapshot"),
        scenario_snapshot=scenario_snapshot,
        baseline_metrics=run["baseline_metrics"],
        scenario_metrics=run["scenario_metrics"],
        deltas=run["deltas"],
        state_result=run.get("state_result", "neutral"),
        timeline_summary=timeline_summary,
        risk_signals=risk_signals,
        recommendations=recs,
        multi_engine=run.get("multi_engine"),
        parameters={k: v for k, v in (run.get("parameters") or {}).items() if k in ("basis", "estimate_basis", "timeline_months")},
    )


@router.get("/scenario-runs/{scenario_run_id}/timeline", response_model=ScenarioTimelineResponse)
async def scenario_runs_timeline(
    scenario_run_id: str,
    _user=Depends(get_current_user),
) -> ScenarioTimelineResponse:
    run = await _require_run(_user, scenario_run_id)
    timeline = await get_scenario_timeline(scenario_run_id)
    for row in timeline:
        if isinstance(row.get("state_label"), str):
            row["state_label"] = row["state_label"].replace(" ", "_")
    return ScenarioTimelineResponse(scenario_run_id=scenario_run_id, timeline=timeline)


@router.post("/do-nothing/run", response_model=DoNothingResponse)
async def do_nothing_run(
    payload: DoNothingRequest,
    _user=Depends(get_current_user),
) -> DoNothingResponse:
    await _require_business(_user, payload.business_id)
    state = await shared_state(_user, payload.business_id, payload.state)      # the risk check's figures (R-4)
    state, _estimate = await _with_enough_data(_user, payload.business_id, state, getattr(payload, "parameters", None) or {})
    result = await do_nothing_projection(
        tenant_id=payload.tenant_id,
        business_id=payload.business_id,
        state_version=payload.state_version,
        state=state,
        timeline_months=payload.timeline_months,
        params={"basis": "estimate", "estimate_basis": _estimate["basis"]} if _estimate else None,
    )
    return DoNothingResponse(**{**result, "starting_cash": float(state.starting_cash or 0)})


@router.post("/forecast-snapshots")
async def forecast_snapshot_create(payload: DoNothingRequest, _user=Depends(get_current_user)):
    await _require_business(_user, payload.business_id)
    from datetime import datetime, timezone
    from app.modules.agent.router import get_orchestrator
    from app.modules.scenario_intelligence.forecast_archive import save_snapshot
    from app.modules.agent.business import local_now
    state = await shared_state(_user, payload.business_id, payload.state)
    data = await get_orchestrator().rt.business.load(payload.business_id)
    return await save_snapshot(_user["id"], payload.business_id, state, payload.timeline_months, data or {}, local_now(data or {}, datetime.now(timezone.utc)).date())


@router.get("/forecast-snapshots")
async def forecast_snapshot_list(business_id: str, _user=Depends(get_current_user)):
    await _require_business(_user, business_id)
    from datetime import datetime, timezone
    from app.modules.agent.router import get_orchestrator
    from app.modules.scenario_intelligence.forecast_archive import list_snapshots
    from app.modules.agent.business import local_now
    data = await get_orchestrator().rt.business.load(business_id)
    return {"items": await list_snapshots(business_id, data or {}, local_now(data or {}, datetime.now(timezone.utc)).date())}


@router.post("/accuracy")
async def accuracy_run(
    payload: RiskDetectionRequest,      # tenant_id, business_id, state_version, state (the page's figures and history)
    _user=Depends(get_current_user),
) -> dict:
    """How accurate the projections have been: earlier forecasts against the months that have since completed, and the
    method tested on the business's own history (simulation audit, Phase 3). Free: nothing is run or charged."""
    await _require_business(_user, payload.business_id)
    return await forecast_accuracy(payload.tenant_id, payload.business_id, payload.state)


def _require_platform_admin(user=Depends(get_current_user)):
    """The platform's admin check (modules/admin/router.require_admin), imported when used to avoid an import cycle."""
    from app.modules.admin.router import require_admin
    return require_admin(user)


@router.get("/admin/accuracy")
async def admin_accuracy(_user=Depends(_require_platform_admin)) -> dict:
    """Phase 7: forecast accuracy across every business, by model version and confidence, with alerts (admin only)."""
    from datetime import datetime, timezone
    from app.core.supabase import sb_select
    from app.modules.agent.router import get_orchestrator
    from app.modules.scenario_intelligence import monitoring, records
    from app.modules.scenario_intelligence.service import _MEM_DECISIONS, _MEM_RUNS
    try:
        runs = await sb_select("scenario_runs", order="created_at", desc=True, limit=5000) or []
    except Exception:      # noqa: BLE001 - in-memory runs (local and tests)
        runs = []
    if not runs:
        runs = list(_MEM_RUNS.values())
    try:
        decisions = {d["scenario_run_id"]: d.get("decision_status") for d in (await sb_select("scenario_decisions", limit=10000) or [])}
    except Exception:      # noqa: BLE001
        decisions = {d.get("scenario_run_id"): d.get("decision_status") for d in _MEM_DECISIONS.values()}
    by_business: dict = {}
    for r in runs:
        if r.get("business_id"):
            by_business.setdefault(r["business_id"], []).append(r)
    today = datetime.now(timezone.utc).date()
    orch = get_orchestrator()
    revenue = {}
    for bid in by_business:
        try:
            data = await orch.rt.business.load(bid) or {}
            revenue[bid] = (records.build(data, today).get("histories") or {}).get("revenue_by_month") or {}
        except Exception:      # noqa: BLE001 - a business that can't be read is left out
            revenue[bid] = {}
    return monitoring.evaluate(by_business, revenue, decisions, today)


@router.get("/model")
async def model_information(_user=Depends(get_current_user)) -> dict:
    """The model's current version and what changed in each version, in plain words (Phase 6: model-update notices)."""
    from app.modules.scenario_intelligence import model_info
    return model_info.info()


@router.post("/scenario-runs/{scenario_run_id}/reproduce")
async def scenario_run_reproduce(scenario_run_id: str, _user=Depends(get_current_user)) -> dict:
    """Run a saved scenario again from its stored inputs and say whether it gives the same figures (Phase 6). Free."""
    from app.modules.scenario_intelligence.service import reproduce
    return reproduce(await _require_run(_user, scenario_run_id))


@router.post("/compare")
async def scenario_runs_compare(payload: dict, _user=Depends(get_current_user)) -> dict:
    """Saved runs side by side (Phase 6): {"run_ids": [...]} (2 to 6), all from businesses the caller can see. Free."""
    from app.modules.scenario_intelligence.service import comparison_row
    ids = [str(i) for i in (payload or {}).get("run_ids") or []][:6]
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="Choose at least two runs to compare.")
    rows = [comparison_row(await _require_run(_user, i)) for i in ids]
    return {"runs": rows, "note": "Each run against doing nothing over its own months. Runs made with an earlier model are marked."}


@router.post("/scenario-runs/{scenario_run_id}/decision", response_model=ScenarioDecisionResponse)
async def scenario_decision(
    scenario_run_id: str,
    payload: ScenarioDecisionRequest,
    _user=Depends(get_current_user),
) -> ScenarioDecisionResponse:
    run = await _require_run(_user, scenario_run_id)
    doc = await save_decision(
        tenant_id=run["tenant_id"],
        business_id=run["business_id"],
        run_id=scenario_run_id,
        decision_status=payload.decision_status,
        selected_recommendation_id=payload.selected_recommendation_id,
        notes=payload.notes,
    )
    return ScenarioDecisionResponse(
        scenario_run_id=scenario_run_id,
        decision_status=payload.decision_status,
        decision_memory_id=doc["decision_memory_id"],
    )


@router.get("/history", response_model=ScenarioHistoryResponse)
async def scenario_history_list(
    business_id: str,
    tenant_id: str,
    _user=Depends(get_current_user),
) -> ScenarioHistoryResponse:
    await _require_business(_user, business_id)
    history = await scenario_history(tenant_id=tenant_id, business_id=business_id)
    return ScenarioHistoryResponse(history=history)


@router.delete("/history")
async def scenario_history_clear(
    business_id: str,
    tenant_id: str,
    _user=Depends(get_current_user),
) -> dict:
    await _require_business(_user, business_id)
    deleted = await clear_history(tenant_id=tenant_id, business_id=business_id)
    return {"deleted_runs": deleted}


@router.post("/intelligence/run")
async def intelligence_run(
    payload: DoNothingRequest,
    _user=Depends(get_current_user),
) -> dict:
    await _require_business(_user, payload.business_id)
    result = await run_full_engine_suite(payload.state)
    return result
