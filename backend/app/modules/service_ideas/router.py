from __future__ import annotations

from fastapi import APIRouter, Depends

from app.modules.service_ideas.schemas import ServiceIdeaValidateRequest, ServiceIdeaValidateResponse
from app.modules.service_ideas.service import evaluate_service_idea
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/service-ideas", tags=["service_ideas"])


@router.post("/validate", response_model=ServiceIdeaValidateResponse)
async def validate_service_idea(
    payload: ServiceIdeaValidateRequest,
    _user=Depends(get_current_user),
):
    result = evaluate_service_idea(payload)
    return result
