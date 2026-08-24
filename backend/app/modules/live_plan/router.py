from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.modules.credits.service import credit_guard
from app.shared.auth.deps import get_current_user
from app.modules.live_plan.schemas import (
    LivePlanAdoptRequest,
    LivePlanAlertResponse,
    LivePlanCompareResponse,
    LivePlanCreateRequest,
    LivePlanKPICreateRequest,
    LivePlanKPIListResponse,
    LivePlanKPIUpdateRequest,
    LivePlanNarrativeRefreshRequest,
    LivePlanPerformanceResponse,
    LivePlanResponse,
    LivePlanScenarioAdoptRequest,
    LivePlanVarianceResponse,
)
from app.modules.live_plan.service import (
    activate_live_plan,
    acknowledge_alert,
    adopt_scenario,
    build_performance,
    compare_versions,
    get_existing_live_plan,
    ensure_live_plan,
    get_live_plan,
    get_version,
    list_alerts,
    list_kpis,
    list_variances,
    list_versions,
    patch_kpi,
    refresh_narrative,
    upsert_kpi,
)

router = APIRouter(prefix="/businesses/{business_id}/live-plan", tags=["live-plan"])


@router.post("", response_model=LivePlanResponse)
async def create_live_plan(
    business_id: str,
    payload: LivePlanCreateRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanCreateRequest()
    # Initial plan seeding is deterministic; AI extraction is not performed here.
    await ensure_live_plan(user_id=user["id"], business_id=business_id, source_document_id=payload.source_document_id)
    return LivePlanResponse(
        business_id=business_id,
        plan=await get_live_plan(user_id=user["id"], business_id=business_id),
    )


@router.get("", response_model=LivePlanResponse)
async def get_live_plan_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    try:
        plan = await get_live_plan(user_id=user["id"], business_id=business_id)
    except ValueError as exc:
        if str(exc) == "LIVE_PLAN_NOT_FOUND":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live plan not found")
        raise
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.post("/adopt", response_model=LivePlanResponse)
async def adopt_live_plan_endpoint(
    business_id: str,
    payload: LivePlanAdoptRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanAdoptRequest()
    async with credit_guard(user["id"], "live_plan_scenario_adopt", payload.idempotency_key):
        plan = await activate_live_plan(user_id=user["id"], business_id=business_id)
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.get("/versions")
async def live_plan_versions_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> dict:
    versions = await list_versions(user_id=user["id"], business_id=business_id)
    return {"business_id": business_id, "versions": versions}


@router.get("/versions/compare", response_model=LivePlanCompareResponse)
async def live_plan_version_compare(
    business_id: str,
    version_a: str = Query(...),
    version_b: str = Query(...),
    user=Depends(get_current_user),
) -> LivePlanCompareResponse:
    comparison = await compare_versions(user_id=user["id"], business_id=business_id, version_a=version_a, version_b=version_b)
    return LivePlanCompareResponse(business_id=business_id, version_a=version_a, version_b=version_b, comparison=comparison)


@router.get("/versions/{version_id}")
async def live_plan_version_get(
    business_id: str,
    version_id: str,
    user=Depends(get_current_user),
) -> dict:
    try:
        version = await get_version(user_id=user["id"], business_id=business_id, version_id=version_id)
        return {"business_id": business_id, "version": version}
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")


@router.get("/kpis", response_model=LivePlanKPIListResponse)
async def live_plan_kpis_list(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanKPIListResponse:
    kpis = await list_kpis(user_id=user["id"], business_id=business_id)
    return LivePlanKPIListResponse(business_id=business_id, kpis=kpis)


@router.post("/kpis")
async def live_plan_kpi_create(
    business_id: str,
    payload: LivePlanKPICreateRequest,
    user=Depends(get_current_user),
) -> dict:
    async with credit_guard(user["id"], "live_plan_kpi_refresh", payload.idempotency_key):
        kpi = await upsert_kpi(user_id=user["id"], business_id=business_id, payload=payload.model_dump())
    return {"business_id": business_id, "kpi": kpi}


@router.patch("/kpis/{kpi_id}")
async def live_plan_kpi_patch(
    business_id: str,
    kpi_id: str,
    payload: LivePlanKPIUpdateRequest,
    user=Depends(get_current_user),
) -> dict:
    async with credit_guard(user["id"], "live_plan_kpi_refresh", payload.idempotency_key):
        kpi = await patch_kpi(user_id=user["id"], business_id=business_id, kpi_id=kpi_id, payload=payload.model_dump())
    return {"business_id": business_id, "kpi": kpi}


@router.get("/performance", response_model=LivePlanPerformanceResponse)
async def live_plan_performance_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanPerformanceResponse:
    performance = await build_performance(user_id=user["id"], business_id=business_id)
    return LivePlanPerformanceResponse(business_id=business_id, performance=performance)


@router.get("/variances", response_model=LivePlanVarianceResponse)
async def live_plan_variances_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanVarianceResponse:
    variances = await list_variances(user_id=user["id"], business_id=business_id)
    return LivePlanVarianceResponse(business_id=business_id, variances=variances)


@router.get("/alerts", response_model=LivePlanAlertResponse)
async def live_plan_alerts_endpoint(
    business_id: str,
    user=Depends(get_current_user),
) -> LivePlanAlertResponse:
    alerts = await list_alerts(user_id=user["id"], business_id=business_id)
    return LivePlanAlertResponse(business_id=business_id, alerts=alerts)


@router.post("/alerts/{alert_id}/acknowledge")
async def live_plan_alert_acknowledge(
    business_id: str,
    alert_id: str,
    user=Depends(get_current_user),
) -> dict:
    alert = await acknowledge_alert(user_id=user["id"], business_id=business_id, alert_id=alert_id, dismissed=False)
    return {"business_id": business_id, "alert": alert}


@router.post("/alerts/{alert_id}/dismiss")
async def live_plan_alert_dismiss(
    business_id: str,
    alert_id: str,
    user=Depends(get_current_user),
) -> dict:
    alert = await acknowledge_alert(user_id=user["id"], business_id=business_id, alert_id=alert_id, dismissed=True)
    return {"business_id": business_id, "alert": alert}


@router.post("/scenarios/{scenario_id}/adopt", response_model=LivePlanResponse)
async def live_plan_adopt_scenario(
    business_id: str,
    scenario_id: str,
    payload: LivePlanScenarioAdoptRequest | None = None,
    user=Depends(get_current_user),
) -> LivePlanResponse:
    payload = payload or LivePlanScenarioAdoptRequest()
    async with credit_guard(user["id"], "live_plan_scenario_adopt", payload.idempotency_key):
        plan = await adopt_scenario(user_id=user["id"], business_id=business_id, scenario_id=scenario_id)
    return LivePlanResponse(business_id=business_id, plan=plan)


@router.post("/narrative/refresh")
async def live_plan_narrative_refresh(
    business_id: str,
    payload: LivePlanNarrativeRefreshRequest | None = None,
    user=Depends(get_current_user),
) -> dict:
    payload = payload or LivePlanNarrativeRefreshRequest()
    async with credit_guard(user["id"], "live_plan_full_refresh", payload.idempotency_key):
        return await refresh_narrative(user_id=user["id"], business_id=business_id, section=payload.section)
