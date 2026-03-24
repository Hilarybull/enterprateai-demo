from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.shared.auth.deps import get_current_user
from app.modules.scenario_intelligence.schemas import (
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
    create_scenario_run,
    detect_risks,
    do_nothing_projection,
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

router = APIRouter(prefix="/v1/scenario-intelligence", tags=["scenario-intelligence"])


@router.post("/risk-detection/run", response_model=RiskDetectionResponse)
async def risk_detection_run(
    payload: RiskDetectionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> RiskDetectionResponse:
    signals = detect_risks(payload.state)
    saved = await save_risk_signals(db, payload.tenant_id, payload.business_id, payload.state_version, signals)
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


@router.post("/scenario-runs", response_model=ScenarioRunResponse)
async def scenario_runs_create(
    payload: ScenarioRunRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScenarioRunResponse:
    template = resolve_template(payload.scenario_template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario template not found")

    run_doc = await create_scenario_run(
        db=db,
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


@router.get("/scenario-runs/{scenario_run_id}", response_model=ScenarioRunResult)
async def scenario_runs_get(
    scenario_run_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScenarioRunResult:
    run = await get_scenario_run(db, scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    recs = await get_recommendations(db, scenario_run_id)
    timeline = await get_scenario_timeline(db, scenario_run_id)
    timeline_summary = {f"month_{t['month_index']}": t["state_label"] for t in timeline}

    return ScenarioRunResult(
        scenario_run_id=run["scenario_run_id"],
        scenario_name=run["scenario_name"],
        scenario_type=run["scenario_type"],
        baseline_metrics=run["baseline_metrics"],
        scenario_metrics=run["scenario_metrics"],
        deltas=run["deltas"],
        state_result=run.get("state_result", "neutral"),
        timeline_summary=timeline_summary,
        recommendations=recs,
    )


@router.get("/scenario-runs/{scenario_run_id}/timeline", response_model=ScenarioTimelineResponse)
async def scenario_runs_timeline(
    scenario_run_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScenarioTimelineResponse:
    run = await get_scenario_run(db, scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    timeline = await get_scenario_timeline(db, scenario_run_id)
    return ScenarioTimelineResponse(scenario_run_id=scenario_run_id, timeline=timeline)


@router.post("/do-nothing/run", response_model=DoNothingResponse)
async def do_nothing_run(
    payload: DoNothingRequest,
    _user=Depends(get_current_user),
) -> DoNothingResponse:
    result = await do_nothing_projection(
        tenant_id=payload.tenant_id,
        business_id=payload.business_id,
        state_version=payload.state_version,
        state=payload.state,
        timeline_months=payload.timeline_months,
    )
    return DoNothingResponse(**result)


@router.post("/scenario-runs/{scenario_run_id}/decision", response_model=ScenarioDecisionResponse)
async def scenario_decision(
    scenario_run_id: str,
    payload: ScenarioDecisionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScenarioDecisionResponse:
    run = await get_scenario_run(db, scenario_run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    doc = await save_decision(
        db=db,
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
    db: AsyncIOMotorDatabase = Depends(get_db),
    _user=Depends(get_current_user),
) -> ScenarioHistoryResponse:
    history = await scenario_history(db, tenant_id=tenant_id, business_id=business_id)
    return ScenarioHistoryResponse(history=history)
