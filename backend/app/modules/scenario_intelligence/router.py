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


@router.post("/risk-detection/run", response_model=RiskDetectionResponse)
async def risk_detection_run(
    payload: RiskDetectionRequest,
    _user=Depends(get_current_user),
) -> RiskDetectionResponse:
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
    # AI-Powered Decision Recommendations are on Starter and above (the pricing PDF, 19 Oct 2026).
    from app.modules.plans.access import has_grant, plan_meets, refusal
    if not (await plan_meets(_user["id"], "starter_insight") or await has_grant(_user["id"], "simulation")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=await refusal(_user["id"], "starter_insight", "AI-Powered Decision Recommendations"))
    # In MVP, use current state to re-derive risk signals deterministically.
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
        f = figures.of(await orch.rt.business.load(business_id) or {})
    except Exception:      # noqa: BLE001 - Simulation's own figures then
        return state
    update: dict = {}
    if f.get("revenue_monthly") is not None:
        update["revenue_monthly"] = max(0.0, float(f["revenue_monthly"]))
    if f.get("costs_monthly"):
        update["expenses_monthly"] = float(f["costs_monthly"])
        update["costs_monthly"] = round(float(f["costs_monthly"]) + float(state.cost_of_sales_monthly or 0), 2)
    if f.get("cash") is not None:
        update["starting_cash"] = float(f["cash"])
    if f.get("top_share") is not None:
        update["top_client_share_pct"] = min(100.0, float(f["top_share"]))
    if f.get("clients"):
        update["clients_count"] = int(f["clients"])
    return state.model_copy(update=update) if update else state


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
    return {"scenario_run_id": scenario_run_id, "status": "completed"}


@router.post("/scenario-runs/{scenario_run_id}/explain")
async def scenario_runs_explain(
    scenario_run_id: str,
    user=Depends(get_current_user),
) -> dict:
    run = await get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")

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
    run = await get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
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
    run = await get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
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
    state = await shared_state(_user, payload.business_id, payload.state)      # the risk check's figures (R-4)
    state, _estimate = await _with_enough_data(_user, payload.business_id, state, getattr(payload, "parameters", None) or {})
    result = await do_nothing_projection(
        tenant_id=payload.tenant_id,
        business_id=payload.business_id,
        state_version=payload.state_version,
        state=state,
        timeline_months=payload.timeline_months,
    )
    return DoNothingResponse(**result)


@router.post("/scenario-runs/{scenario_run_id}/decision", response_model=ScenarioDecisionResponse)
async def scenario_decision(
    scenario_run_id: str,
    payload: ScenarioDecisionRequest,
    _user=Depends(get_current_user),
) -> ScenarioDecisionResponse:
    run = await get_scenario_run(scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
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
    history = await scenario_history(tenant_id=tenant_id, business_id=business_id)
    return ScenarioHistoryResponse(history=history)


@router.delete("/history")
async def scenario_history_clear(
    business_id: str,
    tenant_id: str,
    _user=Depends(get_current_user),
) -> dict:
    deleted = await clear_history(tenant_id=tenant_id, business_id=business_id)
    return {"deleted_runs": deleted}


@router.post("/intelligence/run")
async def intelligence_run(
    payload: DoNothingRequest,
    _user=Depends(get_current_user),
) -> dict:
    result = await run_full_engine_suite(payload.state)
    return result
