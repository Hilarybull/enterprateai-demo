from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_db
from app.modules.idea_validation.schemas import (
    CreateValidationWorkspaceRequest,
    CreateWorkspaceResponse,
    EvaluateRequest,
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
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> CreateWorkspaceResponse:
    workspace_id = await create_workspace(db, user_id=user["id"], name=payload.name, data=payload.data)
    ws = await get_workspace(db, user_id=user["id"], workspace_id=workspace_id)
    return CreateWorkspaceResponse(id=str(ws.id), name=ws.name, created_at=ws.created_at)


@router.get("/me", response_model=WorkspaceResponse)
async def get_my_workspace(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_user_workspace(db, user_id=user["id"])
    if not ws:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return WorkspaceResponse.from_doc(ws)


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_validation_workspace(
    workspace_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await get_workspace(db, user_id=user["id"], workspace_id=workspace_id)
    return WorkspaceResponse.from_doc(ws)


@router.post("/evaluate", response_model=ValidationResult)
async def evaluate_validation(
    payload: EvaluateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> ValidationResult:
    result = await evaluate(
        db,
        user_id=user["id"],
        workspace_id=payload.workspace_id,
        inputs=payload.inputs,
        idea_validation=payload.idea_validation,
    )
    return ValidationResult(**result)


@router.patch("/me", response_model=WorkspaceResponse)
async def patch_my_workspace(
    payload: UpdateWorkspaceRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await upsert_user_workspace(db, user_id=user["id"], data_patch=payload.data, name=payload.name)
    return WorkspaceResponse.from_doc(ws)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def patch_validation_workspace(
    workspace_id: str,
    payload: UpdateWorkspaceRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user=Depends(get_current_user),
) -> WorkspaceResponse:
    ws = await update_workspace(
        db,
        user_id=user["id"],
        workspace_id=workspace_id,
        data_patch=payload.data,
        name=payload.name,
    )
    return WorkspaceResponse.from_doc(ws)
