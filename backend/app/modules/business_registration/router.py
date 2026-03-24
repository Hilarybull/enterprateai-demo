from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.config import Settings, get_settings
from app.modules.business_registration.schemas import (
    RegistrationGuideRequest,
    RegistrationGuideResponse,
    UkEntityTypesResponse,
    UkNameCheckResponse,
    UkSicSuggestRequest,
    UkSicSuggestResponse,
    UkSicSearchRequest,
    UkSicSearchResponse,
)
from app.modules.business_registration.service import (
    generate_registration_guide,
    uk_check_company_name,
    uk_entity_types,
    uk_sic_search,
    uk_sic_suggestions,
)
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/registration", tags=["business_registration"])


@router.post("/guide", response_model=RegistrationGuideResponse)
async def guide_registration(payload: RegistrationGuideRequest, _user=Depends(get_current_user)) -> RegistrationGuideResponse:
    return generate_registration_guide(payload)


@router.get("/uk/entity-types", response_model=UkEntityTypesResponse)
async def uk_entity_types_route(_user=Depends(get_current_user)) -> UkEntityTypesResponse:
    return uk_entity_types()


@router.get("/uk/name/check", response_model=UkNameCheckResponse)
async def uk_name_check_route(
    name: str = Query(min_length=2, max_length=160),
    settings: Settings = Depends(get_settings),
    _user=Depends(get_current_user),
) -> UkNameCheckResponse:
    return await uk_check_company_name(name=name, settings=settings)


@router.post("/uk/sic/suggest", response_model=UkSicSuggestResponse)
async def uk_sic_suggest_route(payload: UkSicSuggestRequest, _user=Depends(get_current_user)) -> UkSicSuggestResponse:
    return UkSicSuggestResponse(suggestions=uk_sic_suggestions(description=payload.description))


@router.post("/uk/sic/search", response_model=UkSicSearchResponse)
async def uk_sic_search_route(payload: UkSicSearchRequest, _user=Depends(get_current_user)) -> UkSicSearchResponse:
    return UkSicSearchResponse(results=uk_sic_search(query=payload.query, limit=payload.limit))
