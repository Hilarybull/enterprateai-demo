from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.shared.auth.deps import get_current_user
from app.modules.credits import service as credit_svc

router = APIRouter(prefix="/credits", tags=["credits"])

ADMIN_EMAIL = "tech.support@enterprateai.com"


@router.get("/balance")
async def get_balance(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    info = await credit_svc.get_balance_info(user_id)
    return info


@router.get("/features")
async def get_features(current_user: dict = Depends(get_current_user)):
    features = await credit_svc.get_all_features()
    return {"features": features}


@router.put("/admin/features/{feature_code}")
async def admin_update_feature(feature_code: str, body: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await credit_svc.update_feature_config(feature_code, body)
    if result is None:
        raise HTTPException(status_code=400, detail="No valid fields to update or feature not found")
    return result


@router.get("/admin/features")
async def admin_list_features(current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    features = await credit_svc.get_all_features()
    return {"features": features}


@router.post("/check")
async def check_credits(body: dict, current_user: dict = Depends(get_current_user)):
    feature_code = body.get("feature_code")
    if not feature_code:
        raise HTTPException(status_code=400, detail="feature_code required")
    result = await credit_svc.check_credits(current_user["id"], feature_code)
    return result


@router.post("/reserve")
async def reserve_credits(body: dict, current_user: dict = Depends(get_current_user)):
    feature_code = body.get("feature_code")
    if not feature_code:
        raise HTTPException(status_code=400, detail="feature_code required")
    generation_id = body.get("generation_id")
    return await credit_svc.reserve_credits(current_user["id"], feature_code, generation_id)


@router.post("/commit")
async def commit_credits(body: dict, current_user: dict = Depends(get_current_user)):
    generation_id = body.get("generation_id")
    feature_code = body.get("feature_code")
    if not generation_id or not feature_code:
        raise HTTPException(status_code=400, detail="generation_id and feature_code required")
    return await credit_svc.commit_credits(
        generation_id,
        current_user["id"],
        feature_code,
        no_hold=bool(body.get("no_hold")),
    )


@router.post("/release")
async def release_credits(body: dict, current_user: dict = Depends(get_current_user)):
    generation_id = body.get("generation_id")
    feature_code = body.get("feature_code")
    if not generation_id or not feature_code:
        raise HTTPException(status_code=400, detail="generation_id and feature_code required")
    return await credit_svc.release_credits(
        generation_id,
        current_user["id"],
        feature_code,
        no_hold=bool(body.get("no_hold")),
    )


@router.get("/transactions")
async def get_transactions(
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
    feature_code: str | None = None,
    transaction_type: str | None = None,
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    txns = await credit_svc.get_transactions(
        current_user["id"],
        limit=min(limit, 200),
        start_date=start_date,
        end_date=end_date,
        feature_code=feature_code,
        transaction_type=transaction_type,
        status=status,
    )
    return {"transactions": txns}


@router.post("/admin/grant")
async def admin_grant_credits(body: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = body.get("user_id")
    amount = body.get("amount")
    reason = body.get("reason", "Admin grant")
    grant_type = body.get("grant_type", "admin_adjustment")
    if not user_id or amount is None:
        raise HTTPException(status_code=400, detail="user_id and amount required")
    result = await credit_svc.grant_credits(user_id, int(amount), grant_type, reason)
    return result


@router.post("/admin/deduct")
async def admin_deduct_credits(body: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    user_id = body.get("user_id")
    amount = body.get("amount")
    reason = body.get("reason", "Admin deduction")
    if not user_id or amount is None:
        raise HTTPException(status_code=400, detail="user_id and amount required")
    result = await credit_svc.deduct_credits_admin(user_id, int(amount), reason)
    return result


@router.get("/admin/wallet/{user_id}")
async def admin_get_wallet(user_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    wallet = await credit_svc.get_wallet(user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet
