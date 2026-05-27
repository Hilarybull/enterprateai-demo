from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from app.modules.idea_validation.schemas import (
    CreateValidationWorkspaceRequest,
    CreateWorkspaceResponse,
    EvaluateRequest,
    MarketResearchRequest,
    UpdateWorkspaceRequest,
    ValidationResult,
    WorkspaceResponse,
)
from app.modules.idea_validation.service import (
    create_workspace,
    evaluate,
    get_user_workspace,
    get_workspace,
    market_fit,
    update_workspace,
    upsert_user_workspace,
)
from app.modules.idea_validation.market_research_service import (
    flatten_fields_from_payload,
    run_market_research,
)
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/validation", tags=["idea_validation"])


@router.get("/market-fit")
async def market_fit_endpoint(
    keyword: str = Query(min_length=2),
    industry: str = Query(default="general"),
    location: str = Query(default="London"),
    uk_region: str = Query(default="GB-ENG"),
    sic_code: str | None = Query(default=None),
    radius_metres: int = Query(default=5000, ge=1000, le=50000),
    user=Depends(get_current_user),
) -> dict:
    # Auth required (same as validation); user id currently not used.
    _ = user
    return await market_fit(
        keyword=keyword,
        industry=industry,
        location=location,
        uk_region=uk_region,
        sic_code=sic_code,
        radius_metres=radius_metres,
    )


@router.post("/create", response_model=CreateWorkspaceResponse)
async def create_validation_workspace(
    payload: CreateValidationWorkspaceRequest,
    user=Depends(get_current_user),
) -> CreateWorkspaceResponse:
    workspace_id = await create_workspace(user_id=user["id"], name=payload.name, data=payload.data)
    ws = await get_workspace(user_id=user["id"], workspace_id=workspace_id)
    return CreateWorkspaceResponse(id=str(ws.id), name=ws.name, created_at=ws.created_at)


@router.get("/me", response_model=WorkspaceResponse)
async def get_my_workspace(
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_user_workspace(user_id=user["id"])
    if not ws:
        return Response(status_code=204)
    return WorkspaceResponse.from_doc(ws)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_validation_workspace(
    workspace_id: str,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_workspace(user_id=user["id"], workspace_id=workspace_id)
    return WorkspaceResponse.from_doc(ws)


@router.post("/evaluate", response_model=ValidationResult)
async def evaluate_validation(
    payload: EvaluateRequest,
    user=Depends(get_current_user),
) -> ValidationResult:
    result = await evaluate(
        user_id=user["id"],
        workspace_id=payload.workspace_id,
        inputs=payload.inputs,
        idea_validation=payload.idea_validation,
    )
    return ValidationResult(**result)


@router.patch("/me", response_model=WorkspaceResponse)
async def patch_my_workspace(
    payload: UpdateWorkspaceRequest,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await upsert_user_workspace(user_id=user["id"], data_patch=payload.data, name=payload.name)
    return WorkspaceResponse.from_doc(ws)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def patch_validation_workspace(
    workspace_id: str,
    payload: UpdateWorkspaceRequest,
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await update_workspace(
        user_id=user["id"],
        workspace_id=workspace_id,
        data_patch=payload.data,
        name=payload.name,
    )
    return WorkspaceResponse.from_doc(ws)


@router.post("/market-research")
async def market_research_endpoint(
    payload: MarketResearchRequest,
    user=Depends(get_current_user),
) -> dict:
    if payload.idea_validation:
        fields = flatten_fields_from_payload(payload.idea_validation)
    elif payload.workspace_id:
        ws = await get_workspace(user_id=user["id"], workspace_id=payload.workspace_id)
        ws_data = ws.data or {}
        iv = ws_data.get("idea_validation") or ws_data.get("draft_idea_validation") or {}
        fields = flatten_fields_from_payload(iv)
    else:
        fields = {}
    return await run_market_research(fields)
