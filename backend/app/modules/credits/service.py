from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import Any

import anyio
from fastapi import HTTPException

from app.core.supabase import get_supabase_client, sb_select

PLAN_ORDER = ("explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os")
PLAN_RANK = {plan: index for index, plan in enumerate(PLAN_ORDER)}
LEGACY_PLAN_ALIASES = {
    "free_trial": "explorer",
    "insight_starter": "starter_insight",
    "strategic_intelligence": "growth_navigator",
}
DEFAULT_MIN_PLAN = "explorer"


def normalise_plan_key(plan_key: str | None) -> str:
    plan = (plan_key or "").strip()
    if not plan:
        return "explorer"
    return LEGACY_PLAN_ALIASES.get(plan, plan)


def _plan_rank(plan_key: str | None) -> int:
    return PLAN_RANK.get(normalise_plan_key(plan_key), 0)


def _meets_min_plan(plan_key: str | None, minimum_plan: str | None) -> bool:
    return _plan_rank(plan_key) >= _plan_rank(minimum_plan or DEFAULT_MIN_PLAN)


async def _current_plan_for_user(user_id: str) -> tuple[str, str]:
    sub = await _get_subscription(user_id)
    plan_code = normalise_plan_key((sub or {}).get("plan_key") or "explorer")
    status = str((sub or {}).get("status") or "")
    return plan_code, status


# ---------------------------------------------------------------------------
# RPC helpers (call stored Postgres functions for atomic operations)
# ---------------------------------------------------------------------------

def _rpc_sync(fn_name: str, params: dict) -> Any:
    client = get_supabase_client()
    res = client.rpc(fn_name, params).execute()
    return res.data


async def _rpc(fn_name: str, params: dict) -> Any:
    return await anyio.to_thread.run_sync(lambda: _rpc_sync(fn_name, params))


# ---------------------------------------------------------------------------
# Wallet / balance
# ---------------------------------------------------------------------------

async def get_wallet(user_id: str) -> dict | None:
    rows = await sb_select(
        "credit_wallets",
        filters=[("user_id", "eq", user_id)],
        single=True,
    )
    return rows


async def ensure_wallet(user_id: str) -> dict:
    """Return existing wallet, or create one with the correct plan allocation."""
    wallet = await get_wallet(user_id)
    if wallet:
        return wallet

    # Look up plan so the first wallet gets the right credit amount
    initial_credits, plan_code = await _initial_credits_for_user(user_id)

    await _rpc("grant_credits", {
        "p_user_id": user_id,
        "p_amount": initial_credits,
        "p_type": "allocation",
        "p_reason": f"{plan_code} initial credit allocation",
        "p_next_reset_at": None,
    })
    wallet = await get_wallet(user_id)
    return wallet  # type: ignore[return-value]


async def _get_subscription(user_id: str) -> dict | None:
    try:
        return await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    except Exception:
        return None


async def _get_plan_config(plan_code: str) -> dict | None:
    try:
        return await sb_select("plan_credit_config", filters=[("plan_code", "eq", plan_code)], single=True)
    except Exception:
        return None


async def _get_plan_feature_entitlement(plan_code: str, feature_code: str) -> dict | None:
    try:
        return await sb_select(
            "plan_feature_entitlements",
            filters=[("plan_code", "eq", normalise_plan_key(plan_code)), ("feature_code", "eq", feature_code)],
            single=True,
        )
    except Exception:
        return None


async def _feature_entitled(plan_code: str, feature_code: str, minimum_plan: str | None) -> bool:
    entitlement = await _get_plan_feature_entitlement(plan_code, feature_code)
    if entitlement is not None:
        return bool(entitlement.get("enabled", True))
    return _meets_min_plan(plan_code, minimum_plan)


def _is_credit_controlled(config: dict | None) -> bool:
    if not config:
        return True
    return bool(config.get("credit_controlled", True))


async def _initial_credits_for_user(user_id: str) -> tuple[int, str]:
    """Return (credits, plan_code) for a brand-new wallet based on the user's current plan."""
    sub = await _get_subscription(user_id)
    plan_code = normalise_plan_key((sub or {}).get("plan_key") or "explorer")
    plan_cfg = await _get_plan_config(plan_code)
    credits = int((plan_cfg or {}).get("credits_per_period") or 50)
    return credits, plan_code


async def get_balance(user_id: str) -> int:
    wallet = await get_wallet(user_id)
    return wallet["available_credits"] if wallet else 0


async def get_balance_info(user_id: str) -> dict:
    """Return full credit info: balance + plan allocation + reset date."""
    wallet = await get_wallet(user_id)
    if not wallet:
        wallet = await ensure_wallet(user_id)
    sub = await _get_subscription(user_id)
    plan_code = normalise_plan_key((sub or {}).get("plan_key") or "explorer")
    plan_cfg = await _get_plan_config(plan_code)
    monthly_allocation = int((plan_cfg or {}).get("credits_per_period") or 0)
    return {
        "available_credits": wallet["available_credits"] if wallet else 0,
        "held_credits": wallet["held_credits"] if wallet else 0,
        "lifetime_credits_issued": wallet["lifetime_credits_issued"] if wallet else 0,
        "lifetime_credits_used": wallet["lifetime_credits_used"] if wallet else 0,
        "next_reset_at": wallet.get("next_reset_at") if wallet else None,
        "monthly_allocation": monthly_allocation,
        "plan_code": plan_code,
        "plan": plan_code,
    }


async def reset_monthly_credits(user_id: str, plan_code: str, next_reset_at: str | None = None) -> dict:
    """Issue a fresh monthly allocation — called on Stripe invoice.paid."""
    return await provision_plan_credits(
        user_id, plan_code,
        reason=f"{plan_code} monthly credit renewal",
    )


# ---------------------------------------------------------------------------
# Feature config
# ---------------------------------------------------------------------------

async def get_feature_config(feature_code: str) -> dict | None:
    return await sb_select(
        "credit_feature_config",
        filters=[("feature_code", "eq", feature_code)],
        single=True,
    )


async def get_all_features() -> list[dict]:
    return await sb_select("credit_feature_config", order="feature_code")


async def update_feature_config(feature_code: str, updates: dict) -> dict | None:
    from app.core.supabase import sb_update
    allowed = {"credit_cost", "feature_name", "enabled", "minimum_plan", "credit_controlled", "refundable_on_failure"}
    payload = {k: v for k, v in updates.items() if k in allowed}
    if not payload:
        return None
    await sb_update("credit_feature_config", payload=payload, filters=[("feature_code", "eq", feature_code)])
    return await get_feature_config(feature_code)


# ---------------------------------------------------------------------------
# Atomic reserve / commit / release
# ---------------------------------------------------------------------------

async def reserve_credits(
    user_id: str,
    feature_code: str,
    generation_id: str | None = None,
) -> dict:
    """
    Reserve credits for a feature. Returns:
      {"ok": True, "transaction_id": ..., "generation_id": ...}  on success
      {"ok": False, "error": "INSUFFICIENT_CREDITS", "available": N, "required": N}
      {"ok": False, "error": "WALLET_NOT_FOUND"}
      {"ok": False, "error": "FEATURE_NOT_FOUND"}
      {"ok": False, "error": "FEATURE_DISABLED"}
    """
    config = await get_feature_config(feature_code)
    if not config:
        return {"ok": False, "error": "FEATURE_NOT_FOUND"}
    if not config["enabled"]:
        return {"ok": False, "error": "FEATURE_DISABLED"}

    credit_cost = int(config.get("credit_cost") or 0)
    plan_code, _status = await _current_plan_for_user(user_id)
    entitled = await _feature_entitled(plan_code, feature_code, config.get("minimum_plan"))
    if not entitled:
        return {
            "ok": False,
            "error": "FEATURE_NOT_ENTITLED",
            "plan": plan_code,
            "minimum_plan": config.get("minimum_plan") or DEFAULT_MIN_PLAN,
        }

    gen_id = generation_id or str(uuid.uuid4())
    idempotency_key = f"{user_id}:{feature_code}:{gen_id}"

    if not _is_credit_controlled(config) or credit_cost <= 0:
        return {
            "ok": True,
            "no_hold": True,
            "transaction_id": None,
            "generation_id": gen_id,
            "credit_cost": credit_cost,
            "credit_controlled": _is_credit_controlled(config),
            "plan": plan_code,
            "minimum_plan": config.get("minimum_plan") or DEFAULT_MIN_PLAN,
        }

    result = await _rpc("reserve_credits", {
        "p_user_id": user_id,
        "p_feature_code": feature_code,
        "p_credit_cost": credit_cost,
        "p_generation_id": gen_id,
        "p_idempotency_key": idempotency_key,
    })

    if isinstance(result, dict):
        result["generation_id"] = gen_id
        result["credit_cost"] = credit_cost
        result["credit_controlled"] = True
        result["plan"] = plan_code
        result["minimum_plan"] = config.get("minimum_plan") or DEFAULT_MIN_PLAN
    return result


async def commit_credits(
    generation_id: str,
    user_id: str,
    feature_code: str,
    no_hold: bool = False,
) -> dict:
    """Confirm a successful AI generation — finalize credit deduction."""
    if no_hold:
        return {"ok": True, "no_hold": True}
    idempotency_key = f"{user_id}:{feature_code}:{generation_id}"
    return await _rpc("commit_credits", {
        "p_generation_id": generation_id,
        "p_idempotency_key": idempotency_key,
    })


async def release_credits(
    generation_id: str,
    user_id: str,
    feature_code: str,
    no_hold: bool = False,
) -> dict:
    """Return held credits if generation failed."""
    if no_hold:
        return {"ok": True, "no_hold": True}
    idempotency_key = f"{user_id}:{feature_code}:{generation_id}"
    return await _rpc("release_credits", {
        "p_generation_id": generation_id,
        "p_idempotency_key": idempotency_key,
    })


# ---------------------------------------------------------------------------
# Plan provisioning (called on checkout completion / plan change)
# ---------------------------------------------------------------------------

async def provision_plan_credits(user_id: str, plan_code: str, reason: str = "") -> dict:
    """
    Grant the correct credits for plan_code to user_id.
    Safe to call on plan change — always grants the full allocation.
    """
    plan_code = normalise_plan_key(plan_code)
    plan_cfg = await _get_plan_config(plan_code)
    credits = int((plan_cfg or {}).get("credits_per_period") or 0)
    if credits <= 0:
        return {"ok": True, "granted": 0}
    return await grant_credits(
        user_id,
        credits,
        grant_type="allocation",
        reason=reason or f"{plan_code} plan credit allocation",
    )


# ---------------------------------------------------------------------------
# Grant credits (allocation / promotion / admin)
# ---------------------------------------------------------------------------

async def grant_credits(
    user_id: str,
    amount: int,
    grant_type: str = "allocation",
    reason: str = "Manual grant",
    next_reset_at: str | None = None,
) -> dict:
    return await _rpc("grant_credits", {
        "p_user_id": user_id,
        "p_amount": amount,
        "p_type": grant_type,
        "p_reason": reason,
        "p_next_reset_at": next_reset_at,
    })


# ---------------------------------------------------------------------------
# Admin deduction
# ---------------------------------------------------------------------------

async def deduct_credits_admin(user_id: str, amount: int, reason: str) -> dict:
    """Admin-only: remove credits from a wallet without affecting lifetime_credits_issued."""
    return await _rpc("admin_deduct_credits", {
        "p_user_id": user_id,
        "p_amount": abs(amount),
        "p_reason": reason,
    })


# ---------------------------------------------------------------------------
# Transaction history
# ---------------------------------------------------------------------------

async def get_transactions(
    user_id: str,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
    feature_code: str | None = None,
    transaction_type: str | None = None,
    status: str | None = None,
) -> list[dict]:
    filters: list[tuple[str, str, Any]] = [("user_id", "eq", user_id)]
    if feature_code:
        filters.append(("feature_code", "eq", feature_code))
    if transaction_type:
        filters.append(("transaction_type", "eq", transaction_type))
    if status:
        filters.append(("status", "eq", status))
    if start_date:
        filters.append(("created_at", "gte", start_date))
    if end_date:
        filters.append(("created_at", "lte", end_date))
    return await sb_select(
        "credit_transactions",
        filters=filters,
        order="created_at",
        desc=True,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Check credits (non-atomic, for pre-flight UI display only)
# ---------------------------------------------------------------------------

async def check_credits(user_id: str, feature_code: str) -> dict:
    """
    Non-atomic check: returns whether the user can afford the feature.
    Do NOT use this as the actual gate — use reserve_credits for that.
    """
    config = await get_feature_config(feature_code)
    if not config:
        return {"allowed": False, "can_afford": False, "reason": "FEATURE_NOT_FOUND"}

    balance = await get_balance(user_id)
    cost = int(config.get("credit_cost") or 0)
    plan_code, _status = await _current_plan_for_user(user_id)
    entitled = await _feature_entitled(plan_code, feature_code, config.get("minimum_plan"))
    credit_controlled = _is_credit_controlled(config)
    allowed = bool(config.get("enabled", True)) and entitled and (not credit_controlled or balance >= cost)
    return {
        "allowed": allowed,
        "can_afford": allowed,
        "entitled": entitled,
        "credit_controlled": credit_controlled,
        "available_credits": balance,
        "available": balance,
        "required_credits": cost,
        "required": cost,
        "remaining_after_action": balance - cost if credit_controlled else balance,
        "minimum_plan": config.get("minimum_plan") or DEFAULT_MIN_PLAN,
        "plan": plan_code,
        "plan_code": plan_code,
        "feature_code": feature_code,
    }


# ---------------------------------------------------------------------------
# Credit guard context manager
# ---------------------------------------------------------------------------

@asynccontextmanager
async def credit_guard(user_id: str, feature_code: str):
    """
    Usage:
        async with credit_guard(user_id, "idea_validation"):
            result = await run_ai_call(...)

    Atomically reserves credits before the AI call, commits on success,
    releases on failure. Raises HTTP 402 if the user has insufficient credits.
    """
    gen_id = str(uuid.uuid4())
    reservation = await reserve_credits(user_id, feature_code, gen_id)

    if not reservation.get("ok"):
        err = reservation.get("error", "UNKNOWN")
        if err == "INSUFFICIENT_CREDITS":
            available = reservation.get("available", 0)
            required = reservation.get("required", 0)
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "INSUFFICIENT_CREDITS",
                    "message": f"Not enough credits. You have {available} credits but this feature requires {required}.",
                    "available": available,
                    "required": required,
                    "feature_code": feature_code,
                },
            )
        if err == "WALLET_NOT_FOUND":
            # Auto-provision wallet (first use)
            await ensure_wallet(user_id)
            reservation = await reserve_credits(user_id, feature_code, gen_id)
            if not reservation.get("ok"):
                raise HTTPException(
                    status_code=402,
                    detail={"error": reservation.get("error"), "feature_code": feature_code},
                )
        else:
            raise HTTPException(
                status_code=402,
                detail={"error": err, "feature_code": feature_code},
            )

    no_hold = bool(reservation.get("no_hold"))
    _success = False
    try:
        yield gen_id
        _success = True
    finally:
        if _success:
            await commit_credits(gen_id, user_id, feature_code, no_hold=no_hold)
        else:
            await release_credits(gen_id, user_id, feature_code, no_hold=no_hold)
