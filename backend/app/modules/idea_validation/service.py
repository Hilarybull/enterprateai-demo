from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import get_settings
from app.modules.idea_validation.calculations import CapacityInputs as CapacityCalcInputs
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
from app.modules.idea_validation.market_fit_service import build_fallback_market_fit, get_market_fit
from app.modules.idea_validation.schemas import FinancialInputsPayload, IdeaValidationPayload
from app.shared.schemas.common import WorkspaceDocument
from app.core.supabase import sb_insert, sb_select, sb_update


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


async def evaluate(
    *,
    user_id: str,
    workspace_id: str | None,
    inputs: FinancialInputsPayload | None,
    idea_validation: IdeaValidationPayload | None = None,
) -> dict:
    # Always prefer the user's current input payloads when provided.
    if idea_validation is not None:
        fin, payment_terms_days, sales_cycle_days, cap = _inputs_from_idea_validation(idea_validation)
        mf_params = _market_fit_params_from_idea_validation(idea_validation)
        market_fit = await _safe_market_fit(mf_params) if mf_params else None
        mf_score = market_fit.get("market_fit_score") if isinstance(market_fit, dict) else None
        result = evaluate_viability_v3(
            fin,
            payment_terms_days=payment_terms_days,
            sales_cycle_days=sales_cycle_days,
            capacity=cap,
            market_fit_score=mf_score,
        )
        if isinstance(market_fit, dict):
            result.setdefault("metrics", {})["market_fit"] = market_fit
        result["pathway"] = idea_validation.pathway
        return result

    if inputs is not None:
        return evaluate_viability_v3(_inputs_from_payload(inputs))

    if workspace_id:
        ws = await get_workspace(user_id=user_id, workspace_id=workspace_id)

        ws_iv = ws.data.get("idea_validation")
        if isinstance(ws_iv, dict):
            try:
                iv_payload = IdeaValidationPayload(**ws_iv)
            except Exception:
                # Auto-clear invalid idea_validation and continue with assumptions/inputs if available.
                await update_workspace(
                    user_id=user_id,
                    workspace_id=str(ws.id),
                    data_patch={"idea_validation": None},
                )
                ws = await get_workspace(user_id=user_id, workspace_id=str(ws.id))
                ws_iv = None
            else:
                fin, payment_terms_days, sales_cycle_days, cap = _inputs_from_idea_validation(iv_payload)
                mf_params = _market_fit_params_from_idea_validation(iv_payload)
                market_fit = await _safe_market_fit(mf_params) if mf_params else None
                mf_score = market_fit.get("market_fit_score") if isinstance(market_fit, dict) else None
                result = evaluate_viability_v3(
                    fin,
                    payment_terms_days=payment_terms_days,
                    sales_cycle_days=sales_cycle_days,
                    capacity=cap,
                    market_fit_score=mf_score,
                )
                if isinstance(market_fit, dict):
                    result.setdefault("metrics", {})["market_fit"] = market_fit
                result["pathway"] = iv_payload.pathway
                return result

        ws_inputs = ws.data.get("assumptions", ws.data.get("inputs"))
        if not isinstance(ws_inputs, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace missing assumptions/inputs")
        try:
            inputs_payload = FinancialInputsPayload(**ws_inputs)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace inputs invalid")
        return evaluate_viability_v3(_inputs_from_payload(inputs_payload))

    if inputs is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide workspace_id or inputs")
    return evaluate_viability_v3(_inputs_from_payload(inputs))


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
    existing = existing or {}
    patch = dict(data_patch or {})
    iv = patch.get("idea_validation")
    if isinstance(iv, dict):
        derived = _derive_business_profile_from_idea_validation(iv)
        if derived:
            current_profile = {}
            if isinstance(existing.get("business_profile"), dict):
                current_profile.update(existing.get("business_profile") or {})
            if isinstance(patch.get("business_profile"), dict):
                current_profile.update(patch.get("business_profile") or {})
            for k, v in derived.items():
                if v and not current_profile.get(k):
                    current_profile[k] = v
            if current_profile:
                patch["business_profile"] = current_profile
    return patch


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
