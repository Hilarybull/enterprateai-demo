from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.modules.idea_validation.calculations import CapacityInputs as CapacityCalcInputs
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
from app.modules.idea_validation.market_fit_service import build_fallback_market_fit, get_market_fit
from app.modules.idea_validation.schemas import FinancialInputsPayload, IdeaValidationPayload
from app.modules.idea_validation.idea_validation_engine import IdeaValidationInputs, ResearchSignals, evaluate_idea_v1
from app.modules.idea_validation.market_research_service import (
    run_research_data,
    run_ai_narration,
    extract_research_signals,
    flatten_fields_from_payload
)
from app.shared.schemas.common import WorkspaceDocument
from app.core.supabase import sb_insert, sb_select, sb_update

logger = logging.getLogger(__name__)


async def create_workspace(
    *,
    user_id: str,
    name: str,
    data: Dict[str, Any],
) -> str:
    now = datetime.now(timezone.utc)
    data = _augment_workspace_patch(data or {})
    existing = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
        limit=1,
        single=True,
    )
    if existing:
        merged = dict(existing.get("data") or {})
        for k, v in (data or {}).items():
            if k == "financials" and isinstance(v, dict) and isinstance(merged.get("financials"), dict):
                merged[k] = {**merged[k], **v}
            else:
                merged[k] = v
        update = {"data": merged, "updated_at": now.isoformat()}
        if name and name.strip():
            update["name"] = name.strip()
        await sb_update(
            "workspaces",
            filters=[("id", "eq", existing["id"]), ("user_id", "eq", user_id)],
            payload=update,
        )
        return str(existing["id"])

    workspace_id = str(uuid4())
    doc = {
        "id": workspace_id,
        "user_id": user_id,
        "name": name,
        "data": data,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await sb_insert("workspaces", doc)
    return workspace_id


async def get_user_workspace(*, user_id: str) -> WorkspaceDocument | None:
    doc = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        order="updated_at",
        desc=True,
        limit=1,
        single=True,
    )
    if not doc:
        return None
    return WorkspaceDocument(**doc)


async def _get_accessible_workspace(*, user_id: str, workspace_id: str) -> tuple[WorkspaceDocument, bool]:
    doc = await sb_select(
        "workspaces",
        filters=[("id", "eq", workspace_id)],
        single=True,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace = WorkspaceDocument(**doc)
    if workspace.user_id == user_id:
        return workspace, True

    membership = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id)],
        single=True,
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return workspace, False


async def get_workspace(*, user_id: str, workspace_id: str) -> WorkspaceDocument:
    workspace, _is_owner = await _get_accessible_workspace(user_id=user_id, workspace_id=workspace_id)
    return workspace


def _inputs_from_payload(payload: FinancialInputsPayload) -> FinancialInputs:
    return FinancialInputs(
        price_per_unit=float(payload.price_per_unit),
        units_per_month=float(payload.units_per_month),
        fixed_costs_monthly=float(payload.fixed_costs_monthly),
        variable_cost_per_unit=float(payload.variable_cost_per_unit),
        starting_cash=float(payload.starting_cash),
    )


def _inputs_from_idea_validation(payload: IdeaValidationPayload) -> tuple[FinancialInputs, int, int, CapacityCalcInputs | None]:
    price = float(payload.offer.price_per_unit)
    units = float(payload.demand.expected_units_per_month)
    fixed = float(payload.costs.fixed_costs_monthly) + float(payload.costs.founder_draw_monthly) + float(payload.costs.contractor_costs_monthly)
    variable = float(payload.costs.variable_cost_per_unit)
    cash = float(payload.cash.starting_cash) if payload.cash else 0.0

    fin = FinancialInputs(
        price_per_unit=price,
        units_per_month=units,
        fixed_costs_monthly=fixed,
        variable_cost_per_unit=variable,
        starting_cash=cash,
    )

    payment_terms_days = int(payload.demand.payment_terms_days)
    sales_cycle_days = int(payload.demand.sales_cycle_days)

    cap: CapacityCalcInputs | None = None
    if payload.capacity:
        cap = CapacityCalcInputs(
            demand_units_per_month=units,
            team_size=int(payload.capacity.team_size),
            capacity_units_per_person_per_month=float(payload.capacity.capacity_units_per_person_per_month),
        )

    return fin, payment_terms_days, sales_cycle_days, cap


def _market_fit_params_from_idea_validation(payload: IdeaValidationPayload) -> dict[str, Any] | None:
    ctx = payload.context
    business_name = (ctx.business_name or "").strip() or (payload.offer.service_type or "").strip()
    industry = (getattr(ctx, "primary_industry", "") or "").strip() or (ctx.business_type or "").strip() or (payload.offer.service_type or "").strip()
    location = (ctx.location or "").strip() or "London"
    uk_region = (getattr(ctx, "uk_region", "") or "").strip() or "GB-ENG"
    keyword = " ".join([p for p in [business_name, industry] if p]).strip()
    if not keyword:
        return None
    return {"keyword": keyword, "industry": industry or "general", "location": location, "uk_region": uk_region}


async def _safe_market_fit(params: dict[str, Any], *, timeout_sec: float = 1.5) -> dict | None:
    try:
        return await asyncio.wait_for(get_market_fit(**params), timeout=timeout_sec)
    except asyncio.TimeoutError:
        return build_fallback_market_fit(**params, reason="timeout")
    except Exception:
        return build_fallback_market_fit(**params, reason="error")


async def check_user_usage(user_id: str, limit: int = 5) -> bool:
    """
    Check if the user has reached their daily validation limit.
    Returns True if allowed, False if limit reached.
    Gracefully allows the request if the usage table doesn't exist yet.
    """
    try:
        today = datetime.now(timezone.utc).date().isoformat()
        usage = await sb_select(
            "idea_validation_usage",
            filters=[("user_id", "eq", user_id), ("request_date", "eq", today)],
            single=True
        )

        if not usage:
            await sb_insert("idea_validation_usage", {
                "user_id": user_id,
                "request_date": today,
                "request_count": 1
            })
            return True

        count = usage.get("request_count", 0)
        if count >= limit:
            return False

        await sb_update(
            "idea_validation_usage",
            payload={"request_count": count + 1, "last_request_at": datetime.now(timezone.utc).isoformat()},
            filters=[("id", "eq", usage["id"])]
        )
        return True
    except Exception:
        # Table not yet migrated — allow the request rather than blocking all validations
        return True


async def save_validation_result(
    user_id: str,
    workspace_id: str | None,
    pathway: str,
    eval_result: dict,
    narrative_report: dict,
    fields: dict
) -> str:
    """
    Persist a snapshot of the validation result to the database.
    """
    business_name = fields.get("business_name") or fields.get("business_idea_name") or "Concept"
    
    row = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "pathway": pathway,
        "business_name": business_name,
        "total_score": eval_result.get("score", eval_result.get("viability_score", 0)),
        "confidence_score": eval_result.get("confidence_score", 100),
        "scoring_details": eval_result.get("dimension_scores", eval_result.get("scoring_details", {})),
        "metrics": eval_result.get("metrics", {}),
        "report_narration": narrative_report.get("executive_summary") or str(narrative_report),
    }
    
    res = await sb_insert("idea_validation_results", row)
    return res[0]["id"] if res else ""


async def evaluate(
    *,
    user_id: str,
    workspace_id: str | None,
    inputs: FinancialInputsPayload | None,
    idea_validation: IdeaValidationPayload | None = None,
) -> dict:
    """
    Main evaluation entry point.
    Now follows the deterministic research-backed flow for idea validation.
    """
    # 1. Usage Limit Check
    is_allowed = await check_user_usage(user_id)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily validation limit reached. Please upgrade or try again tomorrow."
        )
    
    # Always prefer the user's current input payloads when provided.
    iv_payload = None
    if idea_validation:
        iv_payload = idea_validation
    elif workspace_id:
        ws = await get_workspace(user_id=user_id, workspace_id=workspace_id)
        ws_iv = ws.data.get("idea_validation") or ws.data.get("draft_idea_validation")
        if isinstance(ws_iv, dict):
            try:
                iv_payload = IdeaValidationPayload(**ws_iv)
            except Exception:
                iv_payload = None

    if iv_payload:
        # NEW FLOW: Research -> Scoring -> Narration
        # Defensive conversion for Pydantic v1/v2 compatibility
        payload_dict = iv_payload.model_dump() if hasattr(iv_payload, "model_dump") else iv_payload.dict()
        fields = flatten_fields_from_payload(payload_dict)
        
        # Map payload to engine inputs
        engine_inputs = IdeaValidationInputs(
            idea_name=iv_payload.context.business_name,
            idea_description=iv_payload.context.business_offering,
            target_customer=iv_payload.problem.customer_segment,
            problem_description=iv_payload.problem.problem_type,
            pain_level=iv_payload.problem.severity,
            alternatives=iv_payload.problem.alternatives,
            differentiation=iv_payload.offer.service_type,
            market_scope=iv_payload.context.location,
            evidence_signals=iv_payload.validation.demand_proof,
            spoken_to_count=iv_payload.validation.spoken_count,
            estimated_price=iv_payload.offer.price_per_unit,
            expected_units_per_month=iv_payload.demand.expected_units_per_month,
            variable_cost_per_unit=iv_payload.costs.variable_cost_per_unit,
            fixed_costs_monthly=iv_payload.costs.fixed_costs_monthly,
            currency=iv_payload.context.currency or "GBP"
        )

        # A. Research Retrieval
        logger.info(f"Starting research retrieval for idea: {engine_inputs.idea_name}")
        try:
            research_res = await run_research_data(fields)
        except Exception as e:
            logger.error(f"Research retrieval failed: {e}")
            # Provide a fallback research result so the flow can continue
            research_res = {
                "evidence": {},
                "sources": {},
                "shopping": [],
                "search_queries": {}
            }
        
        # B. Signal Extraction
        logger.info("Extracting research signals...")
        try:
            signals_dict = extract_research_signals(research_res["evidence"], research_res["sources"])
            research_signals = ResearchSignals(**signals_dict)
        except Exception as e:
            logger.error(f"Signal extraction failed: {e}")
            research_signals = ResearchSignals() # Empty signals fallback
        
        # C. Deterministic Scoring
        logger.info("Calculating deterministic scores...")
        try:
            eval_result = evaluate_idea_v1(engine_inputs, research_signals)
        except Exception as e:
            logger.error(f"Deterministic scoring failed: {e}")
            eval_result = {"score": 50, "classification": "Fair", "reasons": ["Scoring engine error, using baseline."], "metrics": {}}

        # D. Claude Narration
        logger.info("Generating AI narration...")
        try:
            narration_fields = {**fields, "deterministic_evaluation": eval_result}
            narrative_report = await run_ai_narration(narration_fields, research_res["evidence"], research_res["shopping"])
        except Exception as e:
            logger.error(f"AI narration failed: {e}")
            narrative_report = {
                "executive_summary": "Our AI narration service is temporarily unavailable, but your deterministic scores are ready below.",
                "dimension_explanations": {}
            }
        
        # E. Final Result Assembly
        logger.info("Assembling final validation report...")
        final_result = {
            "score": eval_result.get("score", 50),
            "classification": eval_result.get("classification", "Fair"),
            "reasons": eval_result.get("reasons", []),
            "recommendations": eval_result.get("recommendations", []),
            "dimension_scores": eval_result.get("dimension_scores", {}),
            "metrics": {
                **(eval_result.get("metrics") or {}),
                "market_evidence": {
                    "items": research_res["evidence"],
                    "sources": research_res["sources"],
                    "queries": research_res["search_queries"]
                }
            },
            "pathway": iv_payload.pathway,
            "business_name": engine_inputs.idea_name,
            "service_name": engine_inputs.idea_name,
            "validation_explanation": narrative_report.get("executive_summary") or "",
            "dimension_explanations": narrative_report.get("dimension_explanations") or {},
        }
        
        # F. Persist to History
        try:
            result_id = await save_validation_result(
                user_id=user_id,
                workspace_id=workspace_id,
                pathway=iv_payload.pathway,
                eval_result=eval_result,
                narrative_report=narrative_report,
                fields=fields
            )
            final_result["result_id"] = result_id
            logger.info(f"Validation result saved to history: {result_id}")
        except Exception as e:
            logger.warning(f"Failed to save validation history: {e}")
        
        return final_result

    # Fallback to legacy behavior if no idea validation structure is found
    if inputs is not None:
        return evaluate_viability_v3(_inputs_from_payload(inputs))

    if workspace_id:
        ws = await get_workspace(user_id=user_id, workspace_id=workspace_id)
        ws_inputs = ws.data.get("assumptions", ws.data.get("inputs"))
        if isinstance(ws_inputs, dict):
            try:
                inputs_payload = FinancialInputsPayload(**ws_inputs)
                return evaluate_viability_v3(_inputs_from_payload(inputs_payload))
            except Exception:
                pass
    
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not determine evaluation path")


async def market_fit(
    *,
    keyword: str,
    industry: str,
    location: str,
    uk_region: str = "GB-ENG",
    sic_code: str | None = None,
    radius_metres: int = 5000,
) -> dict:
    _ = get_settings()
    params = {
        "keyword": keyword,
        "industry": industry,
        "location": location,
        "uk_region": uk_region,
        "sic_code": sic_code,
        "radius_metres": radius_metres,
    }
    try:
        return await asyncio.wait_for(get_market_fit(**params), timeout=6.0)
    except asyncio.TimeoutError:
        return build_fallback_market_fit(**params, reason="timeout")
    except Exception:
        return build_fallback_market_fit(**params, reason="error")


MAX_SNAPSHOTS = 50


async def _save_snapshot_to_mongo(workspace_id: str, workspace_name: str, data: Dict[str, Any], now_iso: str) -> None:
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        await col.insert_one({
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "data": data,
            "created_at": now_iso,
        })
        # Keep only the most recent MAX_SNAPSHOTS per workspace
        oldest_ids = await col.find(
            {"workspace_id": workspace_id},
            {"_id": 1},
        ).sort("created_at", -1).skip(MAX_SNAPSHOTS).to_list(length=None)
        if oldest_ids:
            await col.delete_many({"_id": {"$in": [d["_id"] for d in oldest_ids]}})
    except Exception:
        pass  # Snapshot failure must never break the main save path


async def update_workspace(
    *,
    user_id: str,
    workspace_id: str,
    data_patch: Dict[str, Any],
    name: str | None = None,
) -> WorkspaceDocument:
    ws, _is_owner = await _get_accessible_workspace(user_id=user_id, workspace_id=workspace_id)
    now = datetime.now(timezone.utc)

    merged = dict(ws.data or {})
    data_patch = _augment_workspace_patch(data_patch or {}, existing=merged)
    for k, v in (data_patch or {}).items():
        # Deep-merge financials so keys written by other endpoints (e.g. rfq_requests)
        # are never wiped by a frontend patch that doesn't include them.
        if k == "financials" and isinstance(v, dict) and isinstance(merged.get("financials"), dict):
            merged[k] = {**merged[k], **v}
        else:
            merged[k] = v

    ws_name = (name and str(name).strip()) or ws.name or "Unnamed"

    # Fire-and-forget snapshot to MongoDB (never blocks the save)
    await _save_snapshot_to_mongo(str(ws.id), ws_name, dict(ws.data or {}), now.isoformat())

    update = {"data": merged, "updated_at": now.isoformat()}
    if name and str(name).strip():
        update["name"] = str(name).strip()

    await sb_update(
        "workspaces",
        filters=[("id", "eq", ws.id), ("user_id", "eq", ws.user_id)],
        payload=update,
    )
    return await get_workspace(user_id=user_id, workspace_id=workspace_id)


async def upsert_user_workspace(
    *,
    user_id: str,
    data_patch: Dict[str, Any],
    name: str | None = None,
) -> WorkspaceDocument:
    data_patch = _augment_workspace_patch(data_patch or {})
    existing = await get_user_workspace(user_id=user_id)
    if existing:
        return await update_workspace(
            user_id=user_id,
            workspace_id=str(existing.id),
            data_patch=data_patch,
            name=name,
        )

    default_name = str(name).strip() if name and str(name).strip() else "My workspace"
    workspace_id = await create_workspace(user_id=user_id, name=default_name, data=data_patch or {})
    return await get_workspace(user_id=user_id, workspace_id=workspace_id)


def _augment_workspace_patch(data_patch: Dict[str, Any], *, existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
    # Validation details must never overwrite workspace/business profile details.
    # The workspace profile is set independently via the workspace creation/editing flow.
    return dict(data_patch or {})


def _derive_business_profile_from_idea_validation(iv: Dict[str, Any]) -> Dict[str, Any]:
    ctx = iv.get("context") if isinstance(iv.get("context"), dict) else {}
    prob = iv.get("problem") if isinstance(iv.get("problem"), dict) else {}
    offer = iv.get("offer") if isinstance(iv.get("offer"), dict) else {}

    return {
        "business_name": str(ctx.get("business_name") or "").strip() or None,
        "business_type": str(ctx.get("business_type") or "").strip() or None,
        "primary_industry": str(ctx.get("primary_industry") or "").strip() or None,
        "location": str(ctx.get("location") or "").strip() or None,
        "currency": str(ctx.get("currency") or "").strip() or None,
        "target_market": str(prob.get("customer_segment") or "").strip() or None,
        "problem": str(prob.get("problem_type") or "").strip() or None,
        "solution": str(offer.get("service_type") or "").strip() or None,
        "pricing_model": str(offer.get("pricing_model") or "").strip() or None,
    }
