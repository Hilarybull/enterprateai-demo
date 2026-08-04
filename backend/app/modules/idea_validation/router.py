from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from typing import Optional
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
    evaluate_v4_idea,
    get_user_workspace,
    get_workspace,
    market_fit,
    update_workspace,
    upsert_user_workspace,
)
from app.modules.idea_validation.market_research_service import (
    flatten_fields_from_payload,
    run_market_research,
    _call_claude,
    _call_openai,
)
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import credit_guard

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


@router.post("/evaluate-v4")
async def evaluate_v4_endpoint(
    payload: dict,
    user=Depends(get_current_user),
) -> dict:
    async with credit_guard(user["id"], "idea_validation"):
        return await evaluate_v4_idea(user_id=user["id"], payload=payload)


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


class FieldSuggestRequest(BaseModel):
    field: str
    description: Optional[str] = ""
    tagline: Optional[str] = ""
    problem: Optional[str] = ""
    alternatives: Optional[str] = ""
    solution: Optional[str] = ""
    segment: Optional[str] = ""
    location: Optional[str] = ""
    industry: Optional[str] = ""
    sector: Optional[str] = ""
    country: Optional[str] = ""
    # V4 extended context
    who_affected: Optional[str] = ""
    pain_severity: Optional[str] = ""
    frequency: Optional[str] = ""
    beachhead: Optional[str] = ""
    economic_buyer: Optional[str] = ""
    competitors: Optional[str] = ""
    substitutes: Optional[str] = ""
    why_better: Optional[str] = ""
    core_outcome: Optional[str] = ""
    market_category: Optional[str] = ""
    business_stage: Optional[str] = ""
    customer_model: Optional[str] = ""


_NO_DASH_RULE = (
    "IMPORTANT: Write only clean flowing prose sentences. "
    "Absolutely NO hyphens, NO en dashes, NO em dashes, NO bullet points, NO asterisks, NO numbered lists, NO markdown formatting anywhere in the text. "
    "One or two complete natural sentences only. "
)

_FIELD_PROMPTS = {
    "description": (
        "You are a startup advisor. Suggest a clear, one-sentence business idea for a founder. "
        "Segment: {segment}. Location: {location}. "
        'Respond in JSON only: {{"suggestion": "<your suggestion, max 30 words>"}}'
    ),
    "problem": (
        "Suggest a concise problem statement for this business idea: '{description}'. "
        "Target segment: {segment}. "
        'Respond in JSON only: {{"suggestion": "<problem text, max 25 words>"}}'
    ),
    "alternatives": (
        "For the business idea '{description}' solving '{problem}', briefly describe how people currently "
        "solve this problem without the new solution. "
        'Respond in JSON only: {{"suggestion": "<alternatives text, max 25 words>"}}'
    ),
    "solution": (
        "For the business idea '{description}' solving '{problem}', where current alternatives are '{alternatives}', "
        "suggest how this solution is better in one sentence. "
        'Respond in JSON only: {{"suggestion": "<solution text, max 30 words>"}}'
    ),
    # Service / product form fields
    "service_description": (
        "You are a startup advisor. Write a clear one-sentence description for a product or service called '{description}'. "
        "Target segment: {segment}. Industry: {industry}. Country: {country}. "
        'Respond in JSON only: {{"suggestion": "<description, max 30 words>"}}'
    ),
    "service_problem": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Suggest the single most likely pain point this product/service solves for those customers in that industry. "
        "Base your answer strictly on the product/service and industry above — do not invent an unrelated problem. "
        'Respond in JSON only: {{"suggestion": "<problem text, max 25 words>"}}'
    ),
    "service_alternatives": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Name the actual tools, competitors, or workarounds those customers currently use for this specific need in the {industry} space. "
        "Base your answer strictly on the product/service and industry — do not suggest tools from an unrelated industry. "
        'Respond in JSON only: {{"suggestion": "<alternatives text, max 25 words>"}}'
    ),
    "service_differentiator": (
        "You are a startup advisor. "
        "Product/service: '{description}'. Industry: {industry}{sector_part}. Target customers: {segment}. Country: {country}. "
        "Current alternatives: '{alternatives}'. "
        "Suggest the single strongest reason customers in the {industry} space would choose this over those alternatives. "
        "Base your answer on the product/service and industry context. "
        'Respond in JSON only: {{"suggestion": "<differentiator text, max 25 words>"}}'
    ),
    # V4 Universal wizard fields
    "v4_problem_trigger": (
        "You are a startup advisor. "
        "Idea: '{description}'. Problem: '{problem}'. Who affected: {who_affected}. Industry: {industry}. "
        "Suggest the most common real-world event or situation that triggers this specific problem for the customer. "
        "Be concrete and tie the trigger directly to the problem above. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<trigger, max 20 words>"}}'
    ),
    "v4_if_nothing": (
        "You are a startup advisor. "
        "Idea: '{description}'. Problem: '{problem}'. Who affected: {who_affected}. Pain severity: {pain_severity}. "
        "Describe in one sentence the specific negative outcome the customer will continue to face if they ignore this problem and do nothing. "
        "Be concrete and tie the consequence directly to the problem described above. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<consequence, max 25 words>"}}'
    ),
    "v4_idea_description": (
        "You are a startup advisor. "
        "Idea name: '{description}'. Industry: {industry}. Country: {country}. "
        "Write 2-3 sentences describing what this business is building, the problem it solves, and who it serves. "
        "Be specific and grounded. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<description, 40-60 words>"}}'
    ),
    "v4_evidence_problem": (
        "You are a startup advisor. "
        "Idea: '{description}'. Problem: '{problem}'. Who affected: {who_affected}. Industry: {industry}. "
        "Suggest concrete evidence that this problem is real — e.g. industry reports, customer interviews, research data. "
        "Be realistic and specific to the industry. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<evidence, max 25 words>"}}'
    ),
    "v4_primary_segment": (
        "You are a startup advisor. "
        "Idea: '{description}'. Problem: '{problem}'. Industry: {industry}. Country: {country}. "
        "Describe the primary customer segment most likely to buy this — include role, company size, or demographic detail. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<segment description, max 20 words>"}}'
    ),
    "v4_beachhead": (
        "You are a startup advisor. "
        "Idea: '{description}'. Primary segment: {segment}. Country: {country}. Problem: '{problem}'. "
        "Suggest the narrowest possible initial niche within the primary segment to target first to get early traction. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<beachhead niche, max 20 words>"}}'
    ),
    "v4_objections": (
        "You are a startup advisor. "
        "Idea: '{description}'. Customer segment: {segment}. Alternatives: '{alternatives}'. Industry: {industry}. "
        "List the 2-3 most likely objections this customer segment would raise before buying. Be specific and brief. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<objections, max 30 words>"}}'
    ),
    "v4_direct_competitors": (
        "You are a startup advisor. "
        "Idea: '{description}'. Industry: {industry}. Country: {country}. Problem: '{problem}'. "
        "List 3-5 real competitors or alternatives (direct rivals, substitutes, workarounds) a customer might use. "
        "Return them as a comma-separated list with no extra explanation. "
        'Respond in JSON only: {{"suggestion": "<competitor1, competitor2, competitor3>"}}'
    ),
    "v4_alternative_frustrations": (
        "You are a startup advisor. "
        "Idea: '{description}'. Current alternatives: '{alternatives}'. Competitors: {competitors}. Segment: {segment}. "
        "Describe the main frustrations customers have with these existing alternatives. Be specific and grounded in the problem. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<frustrations, max 25 words>"}}'
    ),
    "v4_existing_spending": (
        "You are a startup advisor. "
        "Idea: '{description}'. Competitors: {competitors}. Segment: {segment}. Country: {country}. "
        "Estimate what customers in this segment typically spend per month on their current alternatives. Be realistic and include the currency unit. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<spending estimate, max 15 words>"}}'
    ),
    "v4_switching_barriers": (
        "You are a startup advisor. "
        "Idea: '{description}'. Competitors: {competitors}. Segment: {segment}. Alternatives: '{alternatives}'. "
        "Describe the main barriers that would prevent this segment from switching away from their current solution. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<barriers, max 20 words>"}}'
    ),
    "v4_core_outcome": (
        "You are a startup advisor. "
        "Idea: '{description}'. Problem: '{problem}'. Solution: '{solution}'. Segment: {segment}. "
        "Describe the single most valuable measurable outcome the customer achieves after using this solution. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<outcome, max 20 words>"}}'
    ),
    "v4_defensibility": (
        "You are a startup advisor. "
        "Idea: '{description}'. Industry: {industry}. Why better: '{why_better}'. Competitors: {competitors}. "
        "Suggest the strongest competitive moat for this business — e.g. proprietary data, network effects, switching costs, brand, or IP. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<moat description, max 25 words>"}}'
    ),
    "v4_market_category": (
        "You are a startup advisor. "
        "Idea: '{description}'. Industry: {industry}. Segment: {segment}. Country: {country}. "
        "Name the specific market category this business competes in — e.g. 'SME Payroll Software' or 'B2B Food Delivery Logistics'. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<market category name, max 8 words>"}}'
    ),
    "v4_estimated_customers": (
        "You are a startup advisor. "
        "Idea: '{description}'. Market category: {market_category}. Segment: {segment}. Country: {country}. "
        "Estimate the realistic number of potential customers in this target market, including the unit and a brief qualifier. " + _NO_DASH_RULE +
        'Respond in JSON only: {{"suggestion": "<number + unit + qualifier, max 15 words>"}}'
    ),
}


@router.post("/suggest-field")
async def suggest_field(
    payload: FieldSuggestRequest,
    user=Depends(get_current_user),
) -> dict:
    template = _FIELD_PROMPTS.get(payload.field)
    if not template:
        return {"suggestion": ""}
    industry = payload.industry or payload.location or "the relevant industry"
    sector = payload.sector or ""
    sector_part = f" / {sector}" if sector else ""
    prompt = template.format(
        description=payload.description or "",
        tagline=payload.tagline or "",
        problem=payload.problem or "",
        alternatives=payload.alternatives or "",
        solution=payload.solution or "",
        segment=payload.segment or "general audience",
        location=payload.country or payload.location or "the target market",
        industry=industry,
        sector_part=sector_part,
        country=payload.country or payload.location or "their market",
        who_affected=payload.who_affected or "",
        pain_severity=payload.pain_severity or "",
        frequency=payload.frequency or "",
        beachhead=payload.beachhead or "",
        economic_buyer=payload.economic_buyer or "",
        competitors=payload.competitors or "",
        substitutes=payload.substitutes or "",
        why_better=payload.why_better or "",
        core_outcome=payload.core_outcome or "",
        market_category=payload.market_category or industry,
        business_stage=payload.business_stage or "",
        customer_model=payload.customer_model or "",
    )
    suggestion = ""
    async with credit_guard(user["id"], "suggest_field"):
        try:
            result = await _call_claude(prompt, user_id=user["id"], feature="suggest_field")
            suggestion = result.get("suggestion") or result.get("text") or ""
        except Exception:
            try:
                result = await _call_openai(prompt, user_id=user["id"], feature="suggest_field")
                suggestion = result.get("suggestion") or result.get("text") or ""
            except Exception:
                suggestion = ""
    return {"suggestion": suggestion.strip()}


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
    async with credit_guard(user["id"], "market_data_refresh"):
        return await run_market_research(fields, user_id=user["id"])
