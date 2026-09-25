from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.shared.auth.deps import get_current_user
from app.modules.workspace_profile.schemas import (
    WorkspaceProfilePatchRequest,
    WorkspaceProfileResponse,
    WorkspaceProfileUpsertRequest,
)
from app.modules.workspace_profile.service import complete_onboarding, get_profile, patch_profile, upsert_profile

router = APIRouter(prefix="/workspace/profile", tags=["workspace_profile"])


@router.get("", response_model=None)
async def read_profile(
    workspace_id: str | None = None,
    user=Depends(get_current_user),
):
    return await get_profile(user_id=user["id"], workspace_id=workspace_id)


@router.post("", response_model=WorkspaceProfileResponse)
async def create_or_update_profile(
    payload: WorkspaceProfileUpsertRequest,
    user=Depends(get_current_user),
):
    return await upsert_profile(user_id=user["id"], workspace_id=payload.workspace_id, profile=payload.profile)


@router.patch("", response_model=WorkspaceProfileResponse)
async def patch_workspace_profile(
    payload: WorkspaceProfilePatchRequest,
    user=Depends(get_current_user),
):
    return await patch_profile(user_id=user["id"], workspace_id=payload.workspace_id, profile_patch=payload.profile)


class OnboardingRequest(BaseModel):
    answers: dict = {}


@router.post("/onboarding")
async def submit_onboarding(
    payload: OnboardingRequest,
    user=Depends(get_current_user),
):
    """Sign-up workspace form: save whatever the user filled in (skipped
    fields keep their defaults) and mark onboarding complete."""
    return await complete_onboarding(user_id=user["id"], email=user.get("email") or user["id"], answers=payload.answers)
