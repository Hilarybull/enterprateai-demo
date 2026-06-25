from __future__ import annotations

from fastapi import APIRouter, Depends

from app.modules.service_ideas.schemas import ServiceIdeaValidateRequest
from app.modules.service_ideas.service import evaluate_service_idea
from app.modules.idea_validation.market_research_service import run_market_data_only
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/service-ideas", tags=["service_ideas"])


def _fields_from_payload(payload: ServiceIdeaValidateRequest) -> dict:
    return {
        "business_name": payload.service_name,
        "what_building": f"{payload.service_name} — {payload.service_description}".strip(" — "),
        "primary_industry": getattr(payload, "industry", "") or payload.service_category or "",
        "industry": getattr(payload, "industry", "") or payload.service_category or "",
        "sector": getattr(payload, "sector", "") or "",
        "customer_segment": payload.target_customer_type or "",
        "country": payload.country or "United Kingdom",
        "location": payload.country or "United Kingdom",
        "currency": getattr(payload, "currency", "GBP") or "GBP",
        "problem_short": getattr(payload, "problem_to_solve", "") or "",
        "alternatives": getattr(payload, "competitors_alternatives", "") or "",
        "differentiator": getattr(payload, "differentiator", "") or "",
        "market_scope": payload.target_market_scope or "",
    }


@router.post("/validate")
async def validate_service_idea(
    payload: ServiceIdeaValidateRequest,
    _user=Depends(get_current_user),
) -> dict:
    fields = _fields_from_payload(payload)
    # Deterministic eval is pure math (instant); market research is the slow part
    eval_result = evaluate_service_idea(payload)
    try:
        market_research = await run_market_data_only(fields)
    except Exception:
        market_research = {}
    return {**eval_result, "market_research": market_research}
