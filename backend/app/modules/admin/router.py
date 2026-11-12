from __future__ import annotations

import asyncio
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import stripe
from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator

from app.core.config import get_settings
from app.core.supabase import sb_delete, sb_insert, sb_select, sb_update, sb_upsert
from app.shared.auth.deps import get_current_user

ADMIN_EMAIL = "tech.support@enterprateai.com"

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access only.")
    return user


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _select_restrictions(user_id: str, columns: str = "id,module_key,feature_key,created_at") -> list:
    """Gracefully returns [] if the table doesn't exist yet (pre-migration)."""
    try:
        return await sb_select(
            "user_platform_restrictions",
            filters=[("user_id", "eq", user_id)],
            columns=columns,
            order="created_at",
        )
    except Exception:
        return []


async def _select_users_with_block(columns: str = "id,email,name,phone,company,created_at,is_blocked,block_reason,email_verified", **kwargs) -> list:
    """Falls back to base columns if is_blocked column doesn't exist yet (pre-migration)."""
    try:
        return await sb_select("users", columns=columns, **kwargs)
    except Exception:
        rows = await sb_select("users", columns="id,email,name,created_at", **kwargs)
        for r in rows:
            r.setdefault("is_blocked", False)
            r.setdefault("block_reason", None)
            r.setdefault("email_verified", None)
        return rows


# ── Read endpoints ────────────────────────────────────────────────────────────

AI_WINDOW_DAYS = 30
_PAGE = 1000
_MAX_PAGES = 50      # 50,000 rows a window; past that the totals say they are partial


async def _select_window(table: str, columns: str, since: str, filters: list | None = None) -> tuple[list, bool]:
    """Every row since `since`, newest first, read a page at a time. (rows, complete). [] when the table is missing."""
    rows: list = []
    before = None
    for _ in range(_MAX_PAGES):
        page_filters = [("created_at", "gte", since), *(filters or [])]
        if before:
            page_filters.append(("created_at", "lt", before))
        try:
            page = await sb_select(table, columns=columns, filters=page_filters, order="created_at", desc=True, limit=_PAGE)
        except Exception:
            return rows, not rows
        rows.extend(page or [])
        if len(page or []) < _PAGE:
            return rows, True
        last = page[-1].get("created_at")
        if not last or last == before:
            return rows, False
        before = last
    return rows, False


async def _select_ai_usage_events(since: str) -> tuple[list, bool]:
    return await _select_window(
        "ai_usage_events",
        "id,user_id,feature,provider,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,metadata,created_at",
        since,
    )


async def _select_agent_charges(since: str) -> tuple[list, bool]:
    """Credits the Agent took (committed charges on agent_* features)."""
    rows, complete = await _select_window(
        "credit_transactions",
        "id,user_id,feature_code,credits,transaction_type,status,created_at",
        since,
        filters=[("feature_code", "like", "agent%"), ("transaction_type", "eq", "deduction")],
    )
    return [r for r in rows if is_agent_feature(r.get("feature_code"))], complete


def is_agent_feature(feature) -> bool:
    return str(feature or "").startswith("agent_")


SEARCH_PROVIDERS = {"serpapi", "serper"}


def _rollup_agent(rows: list, charges: list, user_email_map: dict[str, str]) -> dict:
    """What the Agent cost to run (its model and search calls) and what it charged in credits, side by side."""
    def amount(value) -> float:
        try:
            return float(value or 0)
        except Exception:
            return 0.0

    calls = [r for r in rows if is_agent_feature(r.get("feature"))]
    searches = [r for r in calls if r.get("provider") in SEARCH_PROVIDERS]

    def search_count(r) -> int:
        meta = r.get("metadata") if isinstance(r.get("metadata"), dict) else {}
        return int(meta.get("searches") or 1)

    features: dict[str, dict] = {}
    people: dict[str, dict] = {}

    def feature(name) -> dict:
        return features.setdefault(name, {"label": name, "calls": 0, "tokens": 0, "estimated_cost_usd": 0.0, "credits": 0})

    def person(user_id: str) -> dict:
        label = user_email_map.get(user_id, user_id or "unknown")
        return people.setdefault(label, {"user_id": user_id, "email": label, "calls": 0, "estimated_cost_usd": 0.0, "credits": 0})

    for r in calls:
        f = feature(str(r.get("feature") or "unknown"))
        f["calls"] += 1
        f["tokens"] += int(r.get("total_tokens") or 0)
        f["estimated_cost_usd"] += amount(r.get("estimated_cost_usd"))
        p = person(str(r.get("user_id") or ""))
        p["calls"] += 1
        p["estimated_cost_usd"] += amount(r.get("estimated_cost_usd"))
    for c in charges:
        credits = abs(int(amount(c.get("credits"))))
        feature(str(c.get("feature_code") or "unknown"))["credits"] += credits
        person(str(c.get("user_id") or ""))["credits"] += credits

    def ranked(items) -> list[dict]:
        out = sorted(items, key=lambda x: (x["estimated_cost_usd"], x["credits"], x["calls"]), reverse=True)
        for item in out:
            item["estimated_cost_usd"] = round(item["estimated_cost_usd"], 6)
        return out

    return {
        "calls": len(calls) - len(searches),
        "searches": sum(search_count(r) for r in searches),
        "tokens": sum(int(r.get("total_tokens") or 0) for r in calls),
        "model_cost_usd": round(sum(amount(r.get("estimated_cost_usd")) for r in calls if r.get("provider") not in SEARCH_PROVIDERS), 6),
        "search_cost_usd": round(sum(amount(r.get("estimated_cost_usd")) for r in searches), 6),
        "estimated_cost_usd": round(sum(amount(r.get("estimated_cost_usd")) for r in calls), 6),
        "credits_charged": sum(abs(int(amount(c.get("credits")))) for c in charges),
        "charges": len(charges),
        "by_feature": ranked(features.values())[:12],
        "by_user": ranked(people.values())[:8],
    }


def _rollup_ai_usage(rows: list, user_email_map: dict[str, str]) -> dict:
    def amount(value) -> float:
        try:
            return float(value or 0)
        except Exception:
            return 0.0

    total_cost = sum(amount(r.get("estimated_cost_usd")) for r in rows)
    total_tokens = sum(int(r.get("total_tokens") or 0) for r in rows)
    input_tokens = sum(int(r.get("input_tokens") or 0) for r in rows)
    output_tokens = sum(int(r.get("output_tokens") or 0) for r in rows)

    def grouped(key: str, label_key: str | None = None, limit: int = 8) -> list[dict]:
        acc: dict[str, dict] = {}
        for row in rows:
            label = str(row.get(key) or "unknown")
            if label_key:
                label = f"{row.get(key) or 'unknown'} / {row.get(label_key) or 'unknown'}"
            item = acc.setdefault(label, {"label": label, "calls": 0, "tokens": 0, "estimated_cost_usd": 0.0})
            item["calls"] += 1
            item["tokens"] += int(row.get("total_tokens") or 0)
            item["estimated_cost_usd"] += amount(row.get("estimated_cost_usd"))
        out = sorted(acc.values(), key=lambda x: (x["estimated_cost_usd"], x["tokens"], x["calls"]), reverse=True)
        for item in out:
            item["estimated_cost_usd"] = round(item["estimated_cost_usd"], 6)
        return out[:limit]

    user_acc: dict[str, dict] = {}
    for row in rows:
        user_id = str(row.get("user_id") or "")
        label = user_email_map.get(user_id, user_id or "unknown")
        item = user_acc.setdefault(label, {"user_id": user_id, "email": label, "calls": 0, "tokens": 0, "estimated_cost_usd": 0.0})
        item["calls"] += 1
        item["tokens"] += int(row.get("total_tokens") or 0)
        item["estimated_cost_usd"] += amount(row.get("estimated_cost_usd"))
    top_users = sorted(user_acc.values(), key=lambda x: (x["estimated_cost_usd"], x["tokens"], x["calls"]), reverse=True)[:8]
    for item in top_users:
        item["estimated_cost_usd"] = round(item["estimated_cost_usd"], 6)

    recent = []
    for row in rows[:25]:
        user_id = str(row.get("user_id") or "")
        recent.append({
            "id": row.get("id"),
            "user_id": user_id,
            "user_email": user_email_map.get(user_id, user_id or "unknown"),
            "feature": row.get("feature") or "unknown",
            "provider": row.get("provider") or "unknown",
            "model": row.get("model") or "unknown",
            "input_tokens": int(row.get("input_tokens") or 0),
            "output_tokens": int(row.get("output_tokens") or 0),
            "total_tokens": int(row.get("total_tokens") or 0),
            "estimated_cost_usd": round(amount(row.get("estimated_cost_usd")), 6),
            "created_at": row.get("created_at"),
        })

    return {
        "total_calls": len(rows),
        "total_tokens": total_tokens,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": round(total_cost, 6),
        "by_feature": grouped("feature"),
        "by_model": grouped("provider", "model"),
        "by_user": top_users,
        "recent": recent,
    }


@router.get("/stats")
async def get_system_stats(days: int = AI_WINDOW_DAYS, user=Depends(require_admin)) -> dict:
    days = max(1, min(int(days or AI_WINDOW_DAYS), 365))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    (workspaces, users, members, invitations, upgrade_clicks, (ai_usage_events, ai_complete),
     (agent_charges, charges_complete)) = await asyncio.gather(
        sb_select("workspaces", columns="id,name,user_id,created_at,data"),
        _select_users_with_block(),
        sb_select("workspace_members", columns="id,workspace_id,user_id,permission_type,created_at"),
        sb_select("workspace_invitations", columns="id,workspace_id,email,status,created_at"),
        sb_select("upgrade_clicks", columns="id"),
        _select_ai_usage_events(since),
        _select_agent_charges(since),
    )

    user_email_map = {u["id"]: u["email"] for u in users}
    workspace_name_map = {ws["id"]: (ws.get("name") or "Unnamed") for ws in workspaces}
    ai_usage = _rollup_ai_usage(ai_usage_events, user_email_map)
    ai_usage["agent"] = _rollup_agent(ai_usage_events, agent_charges, user_email_map)
    ai_usage["window_days"] = days
    ai_usage["complete"] = ai_complete and charges_complete

    sim_count = 0
    blueprint_count = 0
    validation_count = 0
    for ws in workspaces:
        data = ws.get("data") or {}
        if isinstance(data, dict):
            sims = data.get("simulations") or []
            if isinstance(sims, list):
                sim_count += len(sims)
            bps = data.get("blueprints") or data.get("documents") or []
            if isinstance(bps, list):
                blueprint_count += len(bps)
            if data.get("decision") or data.get("idea_validation") or data.get("service_validation_history"):
                validation_count += 1

    return {
        "total_workspaces": len(workspaces),
        "total_users": len(users),
        "total_members": len(members),
        "total_invitations": len(invitations),
        "total_simulations": sim_count,
        "total_blueprints": blueprint_count,
        "total_validated_workspaces": validation_count,
        "total_upgrade_clicks": len(upgrade_clicks),
        "total_ai_calls": ai_usage["total_calls"],
        "total_ai_tokens": ai_usage["total_tokens"],
        "total_ai_cost_usd": ai_usage["estimated_cost_usd"],
        "ai_usage": ai_usage,
        "workspaces": [
            {
                "id": ws["id"],
                "name": ws.get("name") or "Unnamed",
                "owner_id": ws.get("user_id"),
                "owner_email": user_email_map.get(ws.get("user_id") or "", ""),
                "created_at": ws.get("created_at"),
                # "Open for proposals", and whether the Marketplace listing is live (proposals reach only a live listing)
                "proposals_open": bool(((ws.get("data") or {}).get("proposal_preferences") or {}).get("enabled")) if isinstance(ws.get("data"), dict) else False,
                "listing_live": bool(((ws.get("data") or {}).get("marketplace") or {}).get("is_active")) if isinstance(ws.get("data"), dict) else False,
            }
            for ws in workspaces
        ],
        "users": [
            {
                "id": u["id"],
                "email": u["email"],
                "name": u.get("name"),
                "phone": u.get("phone"),
                "company": u.get("company"),
                "created_at": u.get("created_at"),
                "is_blocked": bool(u.get("is_blocked", False)),
                "block_reason": u.get("block_reason"),
                "email_verified": u.get("email_verified"),
            }
            for u in users
        ],
        "members": [
            {
                "id": m["id"],
                "workspace_id": m["workspace_id"],
                "workspace_name": workspace_name_map.get(m["workspace_id"] or "", ""),
                "user_id": m["user_id"],
                "user_email": user_email_map.get(m["user_id"] or "", ""),
                "permission_type": m.get("permission_type"),
                "created_at": m.get("created_at"),
            }
            for m in members
        ],
        "invitations": [
            {
                "id": i["id"],
                "workspace_id": i["workspace_id"],
                "workspace_name": workspace_name_map.get(i["workspace_id"] or "", ""),
                "invited_email": i.get("email"),
                "status": i.get("status"),
                "created_at": i.get("created_at"),
            }
            for i in invitations
        ],
    }


@router.get("/workspaces")
async def list_all_workspaces(user=Depends(require_admin)) -> list:
    return await sb_select("workspaces", columns="id,name,created_at", order="created_at", desc=True)


@router.get("/users")
async def list_all_users(user=Depends(require_admin)) -> list:
    return await _select_users_with_block(order="created_at", desc=True)


# ── Contacts: everyone's name and email, how they came, and their marketing choice ──

# Marketing permission is the account's own record of it (the activation module's: marketing_email_status and its dates),
# so an unsubscribe from any email, or from Account settings, shows here at once.
CONTACT_COLUMNS = ("id,email,name,first_name,signup_source,first_goal,created_at,last_seen_at,email_verified,auth_provider,"
                   "marketing_email_status,marketing_permission_at,marketing_permission_source,marketing_permission_wording,marketing_unsubscribed_at")
CSV_FIELDS = ("name", "email", "signup_source", "first_goal", "plan", "created_at", "last_active", "marketing_consent", "consent_at",
              "consent_source", "consent_version", "email_verified", "unsubscribed")


def contact_of(row: dict, plan: str | None = None) -> dict:
    """One person as the Contacts view shows them. Someone who signed up without the homepage flow is a direct sign-up."""
    return {
        "id": row.get("id"), "name": str(row.get("name") or row.get("first_name") or "").strip(), "first_name": row.get("first_name") or None,
        "email": row.get("email") or row.get("id"), "signup_source": row.get("signup_source") or "direct_signup", "first_goal": row.get("first_goal") or None,
        "plan": plan or "explorer", "created_at": row.get("created_at"), "last_active": row.get("last_seen_at") or None,
        "marketing_consent": str(row.get("marketing_email_status") or "unknown") in ("subscribed", "soft_opt_in"),
        "consent_at": row.get("marketing_permission_at") or None,
        "consent_source": row.get("marketing_permission_source") or None, "consent_version": row.get("marketing_permission_wording") or None,
        "email_verified": row.get("email_verified"),
        "unsubscribed": str(row.get("marketing_email_status") or "") in ("unsubscribed", "suppressed") or bool(row.get("marketing_unsubscribed_at")),
    }


def may_be_sent_marketing(contact: dict) -> bool:
    """Tips, product updates and the newsletter go only to someone who ticked the box and has not unsubscribed.
    Messages about their own tasks (a quotation is ready, verify your email) never depend on this."""
    return bool(contact.get("marketing_consent")) and not contact.get("unsubscribed")


def filter_contacts(contacts: list[dict], *, q: str = "", consent: str = "", plan: str = "", source: str = "", since: str = "", until: str = "") -> list[dict]:
    words = q.strip().lower()
    out = []
    for c in contacts:
        if words and words not in f"{c['name']} {c['email']}".lower():
            continue
        if consent in ("yes", "no") and may_be_sent_marketing(c) != (consent == "yes"):
            continue
        if plan and c["plan"] != plan:
            continue
        if source and c["signup_source"] != source:
            continue
        made = str(c.get("created_at") or "")[:10]
        if (since and made < since) or (until and made > until):
            continue
        out.append(c)
    return out


def contacts_csv(contacts: list[dict]) -> str:
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_FIELDS)
    for c in contacts:
        w.writerow(["" if c.get(k) is None else ("yes" if c[k] is True else "no" if c[k] is False else c[k]) for k in CSV_FIELDS])
    return buf.getvalue()


async def _contacts() -> list[dict]:
    try:
        rows = await sb_select("users", columns=CONTACT_COLUMNS, order="created_at", desc=True)
    except Exception:      # before migration 040: the name and email are still listed
        rows = await sb_select("users", columns="id,email,name,created_at", order="created_at", desc=True)
    plans: dict[str, str] = {}
    try:
        for sub in await sb_select("user_subscriptions", columns="user_id,plan_key,status") or []:
            if str(sub.get("status") or "active") in ("active", "trialing"):
                plans[str(sub.get("user_id"))] = sub.get("plan_key") or "explorer"
    except Exception:
        pass
    return [contact_of(r, plans.get(str(r.get("id")))) for r in rows or [] if str(r.get("email") or r.get("id") or "") != "demo"]


async def _audit(actor: dict, action: str, detail: dict) -> None:
    """What a superadmin did with people's details. Before migration 040 there is no table: it is written to the server log instead."""
    try:
        await sb_insert("admin_audit_log", {"actor_email": actor.get("email"), "action": action, "detail": detail})
    except Exception:
        import logging
        logging.getLogger(__name__).warning("admin audit: %s by %s %s", action, actor.get("email"), detail)


class DiscountCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=3, max_length=50)
    percent_off: float = Field(gt=0, le=100)
    duration: str = "repeating"
    duration_in_months: Optional[int] = Field(default=None, ge=1, le=36)
    max_redemptions: Optional[int] = Field(default=None, ge=1)
    redeem_by: Optional[str] = None

    @model_validator(mode="after")
    def validate_duration(self):
        if self.duration not in {"once", "repeating", "forever"}:
            raise ValueError("Duration must be once, repeating or forever.")
        if self.duration == "repeating" and self.duration_in_months is None:
            raise ValueError("Repeating discounts need a duration in months.")
        return self


class DiscountStatusPayload(BaseModel):
    active: bool


def _stripe_admin_client():
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured for this environment.")
    client_class = getattr(stripe, "StripeClient", None) or getattr(stripe, "Stripe", None)
    if client_class is None:
        raise HTTPException(status_code=503, detail="The configured Stripe SDK is not supported.")
    return client_class(settings.stripe_secret_key)


def _stripe_attr(value, key, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _discount_response(promotion, coupon, livemode: bool) -> dict:
    metadata = _stripe_attr(promotion, "metadata", {})
    return {
        "id": _stripe_attr(promotion, "id"),
        "code": _stripe_attr(promotion, "code"),
        "name": _stripe_attr(metadata, "offer_name") or _stripe_attr(coupon, "name"),
        "coupon_name": _stripe_attr(coupon, "name"),
        "percent_off": _stripe_attr(coupon, "percent_off"),
        "amount_off": _stripe_attr(coupon, "amount_off"),
        "currency": _stripe_attr(coupon, "currency"),
        "duration": _stripe_attr(coupon, "duration"),
        "duration_in_months": _stripe_attr(coupon, "duration_in_months"),
        "active": bool(_stripe_attr(promotion, "active", False)) and bool(_stripe_attr(coupon, "valid", True)),
        "times_redeemed": _stripe_attr(promotion, "times_redeemed", 0),
        "max_redemptions": _stripe_attr(promotion, "max_redemptions"),
        "expires_at": _stripe_attr(promotion, "expires_at"),
        "redeem_by": _stripe_attr(coupon, "redeem_by"),
        "products": _stripe_attr(_stripe_attr(coupon, "applies_to", {}), "products", []) or [],
        "livemode": livemode,
    }


def _configured_plan_products(client) -> list[str]:
    """Resolve the configured plan prices to products so a plan offer cannot discount unrelated products."""
    from app.modules.plans.router import _PRICE_ATTR

    settings = get_settings()
    products = set()
    for attr in set(_PRICE_ATTR.values()):
        price_id = getattr(settings, attr, None)
        if not price_id:
            continue
        price = client.prices.retrieve(price_id)
        product = _stripe_attr(price, "product")
        product_id = _stripe_attr(product, "id") if not isinstance(product, str) else product
        if product_id:
            products.add(str(product_id))
    if not products:
        raise HTTPException(status_code=503, detail="No paid plan prices are configured in Stripe for this environment.")
    return sorted(products)


@router.get("/discounts")
async def list_discounts(user=Depends(require_admin)) -> dict:
    """List Stripe promotion codes and their coupon terms for the active environment."""
    client = _stripe_admin_client()
    settings = get_settings()
    livemode = str(settings.stripe_secret_key).startswith(("sk_live_", "rk_live_"))
    try:
        response = client.promotion_codes.list({"limit": 100, "expand": ["data.coupon"]})
        rows = []
        pages = 0
        while response and pages < 20:
            for promotion in response.data:
                coupon = _stripe_attr(promotion, "coupon")
                if isinstance(coupon, str):
                    coupon = client.coupons.retrieve(coupon)
                rows.append(_discount_response(promotion, coupon, livemode))
            if not response.has_more or not response.data:
                break
            response = client.promotion_codes.list({
                "limit": 100,
                "starting_after": response.data[-1].id,
                "expand": ["data.coupon"],
            })
            pages += 1
        return {"items": rows, "livemode": livemode, "partial": pages >= 20}
    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).exception("Stripe promotion codes could not be listed")
        raise HTTPException(status_code=502, detail="Discounts could not be loaded from Stripe.") from exc


@router.post("/discounts")
async def create_discount(payload: DiscountCreatePayload, user=Depends(require_admin)) -> dict:
    """Create a repeating percent-off coupon and customer-entered promotion code."""
    code = payload.code.strip()
    if not code.isascii() or not code.isalnum():
        raise HTTPException(status_code=400, detail="Use letters and numbers only for a discount code.")
    client = _stripe_admin_client()
    settings = get_settings()
    livemode = str(settings.stripe_secret_key).startswith(("sk_live_", "rk_live_"))
    name = payload.name.strip() or code
    expiry = None
    if payload.redeem_by:
        try:
            expiry = datetime.strptime(payload.redeem_by, "%Y-%m-%d").replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Choose a valid last redemption date.") from exc
        if expiry <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="The last redemption date must be in the future.")
    try:
        existing = client.promotion_codes.list({"code": code, "active": True, "limit": 100})
        if any(str(_stripe_attr(item, "code", "")).casefold() == code.casefold() for item in existing.data):
            raise HTTPException(status_code=409, detail="An active discount already uses this code.")

        plan_products = _configured_plan_products(client)
        coupon_params = {
            "name": name,
            "percent_off": payload.percent_off,
            "duration": payload.duration,
            "applies_to": {"products": plan_products},
            "metadata": {"created_by": "enterprateai_superadmin", "offer_name": name},
        }
        if payload.duration == "repeating":
            coupon_params["duration_in_months"] = payload.duration_in_months
        coupon = client.coupons.create(coupon_params)
        promo_params = {
            "coupon": coupon.id,
            "code": code,
            "metadata": {"created_by": "enterprateai_superadmin", "offer_name": name},
        }
        if payload.max_redemptions is not None:
            promo_params["max_redemptions"] = payload.max_redemptions
        if expiry:
            promo_params["expires_at"] = int(expiry.timestamp())
        promotion = client.promotion_codes.create(promo_params)
        await _audit(user, "discount_created", {
            "code": code, "coupon_id": coupon.id, "promotion_code_id": promotion.id,
            "percent_off": payload.percent_off, "duration": payload.duration,
            "duration_in_months": payload.duration_in_months,
            "plan_products": plan_products, "livemode": livemode,
        })
        return _discount_response(promotion, coupon, livemode)
    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).exception("Stripe discount could not be created")
        raise HTTPException(status_code=502, detail="Discount could not be created in Stripe.") from exc


@router.patch("/discounts/{promotion_code_id}")
async def update_discount(promotion_code_id: str, payload: DiscountStatusPayload, user=Depends(require_admin)) -> dict:
    """Activate or deactivate a promotion code without deleting its redemption history."""
    client = _stripe_admin_client()
    settings = get_settings()
    livemode = str(settings.stripe_secret_key).startswith(("sk_live_", "rk_live_"))
    try:
        promotion = client.promotion_codes.update(promotion_code_id, {"active": payload.active})
        coupon = _stripe_attr(promotion, "coupon")
        if isinstance(coupon, str):
            coupon = client.coupons.retrieve(coupon)
        await _audit(user, "discount_status_changed", {
            "code": _stripe_attr(promotion, "code"), "promotion_code_id": promotion_code_id,
            "active": payload.active, "livemode": livemode,
        })
        return _discount_response(promotion, coupon, livemode)
    except Exception as exc:
        logging.getLogger(__name__).exception("Stripe promotion code could not be updated")
        raise HTTPException(status_code=502, detail="Discount status could not be changed in Stripe.") from exc


@router.get("/contacts")
async def list_contacts(q: str = "", consent: str = "", plan: str = "", source: str = "", since: str = "", until: str = "", user=Depends(require_admin)) -> dict:
    """Superadmin only. Everyone with an account: name, email, how they came, plan, and their marketing choice."""
    found = filter_contacts(await _contacts(), q=q, consent=consent, plan=plan, source=source, since=since, until=until)
    return {"items": found, "total": len(found), "can_be_sent_marketing": sum(1 for c in found if may_be_sent_marketing(c))}


@router.get("/contacts/export")
async def export_contacts(q: str = "", consent: str = "", plan: str = "", source: str = "", since: str = "", until: str = "", user=Depends(require_admin)) -> Response:
    """The same list as a CSV, consent fields included. Every export is written to the audit log."""
    found = filter_contacts(await _contacts(), q=q, consent=consent, plan=plan, source=source, since=since, until=until)
    await _audit(user, "contacts_exported", {"rows": len(found), "filters": {"q": q, "consent": consent, "plan": plan, "source": source, "since": since, "until": until}})
    return Response(content=contacts_csv(found), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="contacts.csv"'})


@router.get("/waitlist")
async def list_plan_waitlist(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "plan_waitlist",
            columns="id,email,plan_key,billing_period,joined_at",
            order="joined_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/upgrade-clicks")
async def list_upgrade_clicks(user=Depends(require_admin)) -> list:
    return await sb_select(
        "upgrade_clicks",
        columns="id,user_id,email,feature,source,clicked_at",
        order="clicked_at",
        desc=True,
    )


@router.get("/mailing-list")
async def list_mailing_list(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "mailing_list",
            columns="id,email,source,subscribed_at",
            order="subscribed_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/module-interest")
async def list_module_interest(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "module_interest",
            columns="id,email,feature,clicked_at",
            order="clicked_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/support-messages")
async def list_support_messages(user=Depends(require_admin)) -> list:
    try:
        return await sb_select(
            "support_messages",
            columns="id,name,email,message,type,created_at",
            order="created_at",
            desc=True,
        )
    except Exception:
        return []


@router.get("/workspaces/{workspace_id}")
async def get_workspace_detail(workspace_id: str, user=Depends(require_admin)) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    members = await sb_select(
        "workspace_members",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id,user_id,permission_type,role,created_at",
    )
    invitations = await sb_select(
        "workspace_invitations",
        filters=[("workspace_id", "eq", workspace_id)],
        columns="id,email,status,permission_type,created_at",
        order="created_at",
        desc=True,
    )

    user_ids = [m["user_id"] for m in members if m.get("user_id")]
    users_map: dict = {}
    if user_ids:
        users_list = await sb_select("users", filters=[("id", "in", user_ids)], columns="id,email")
        users_map = {u["id"]: u["email"] for u in users_list}

    owner = None
    if ws.get("user_id"):
        owner = await sb_select("users", filters=[("id", "eq", ws["user_id"])], columns="id,email", single=True)

    raw_data = ws.get("data") or {}
    data = raw_data if isinstance(raw_data, dict) else {}

    raw_profile = data.get("workspace_profile") or {}
    decision_status = (data.get("decision") or {}).get("status") or None

    # Strip the logo (too large for the detail response) but flag its presence
    profile_out = {k: v for k, v in raw_profile.items() if k != "logo_data_url"}
    profile_out["has_logo"] = bool(raw_profile.get("logo_data_url"))
    profile_out["decision_status"] = decision_status

    return {
        "id": ws["id"],
        "name": ws.get("name") or "Unnamed",
        "created_at": ws.get("created_at"),
        "updated_at": ws.get("updated_at"),
        "owner_id": ws.get("user_id"),
        "owner_email": owner.get("email") if owner else None,
        "member_count": len(members),
        "invitation_count": len(invitations),
        "has_validation": bool(data.get("decision") or data.get("idea_validation")),
        "has_simulation": bool(data.get("simulations")),
        "profile": profile_out if raw_profile else None,
        "members": [
            {
                "id": m["id"],
                "user_id": m["user_id"],
                "email": users_map.get(m["user_id"] or "", "Unknown"),
                "permission_type": m.get("permission_type"),
                "role": m.get("role", "member"),
                "created_at": m.get("created_at"),
            }
            for m in members
        ],
        "invitations": [
            {
                "id": i["id"],
                "email": i.get("email"),
                "status": i.get("status"),
                "permission_type": i.get("permission_type"),
                "created_at": i.get("created_at"),
            }
            for i in invitations
        ],
    }


@router.get("/users/{user_id}/restrictions")
async def get_user_restrictions(user_id: str, user=Depends(require_admin)) -> list:
    return await _select_restrictions(user_id)


@router.get("/users/{user_id}/full-data")
async def get_user_full_data(user_id: str, user=Depends(require_admin)) -> dict:
    target = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    workspaces = await sb_select(
        "workspaces",
        filters=[("user_id", "eq", user_id)],
        columns="id,name,data,created_at,updated_at",
        order="created_at",
        desc=True,
    )

    memberships = await sb_select(
        "workspace_members",
        filters=[("user_id", "eq", user_id)],
        columns="id,workspace_id,permission_type,created_at",
    )
    ws_ids = [m["workspace_id"] for m in memberships if m.get("workspace_id")]
    ws_names: dict = {}
    if ws_ids:
        ws_list = await sb_select("workspaces", filters=[("id", "in", ws_ids)], columns="id,name")
        ws_names = {w["id"]: (w.get("name") or "Unnamed") for w in ws_list}

    blueprints = await sb_select(
        "blueprint_documents",
        filters=[("user_id", "eq", user_id)],
        columns="id,type,title,company_name,created_at",
        order="created_at",
        desc=True,
    )

    upgrade_clicks = await sb_select(
        "upgrade_clicks",
        filters=[("email", "eq", target["email"])],
        columns="id,feature,source,clicked_at",
        order="clicked_at",
        desc=True,
    )

    restrictions = await _select_restrictions(user_id)

    workspace_summaries = []
    for ws in workspaces:
        data = ws.get("data") or {}
        if not isinstance(data, dict):
            data = {}
        sims = data.get("simulations") or []
        bps = data.get("blueprints") or data.get("documents") or []
        workspace_summaries.append({
            "id": ws["id"],
            "name": ws.get("name") or "Unnamed",
            "created_at": ws.get("created_at"),
            "updated_at": ws.get("updated_at"),
            "sim_count": len(sims) if isinstance(sims, list) else 0,
            "blueprint_count": len(bps) if isinstance(bps, list) else 0,
            "has_validation": bool(data.get("decision") or data.get("idea_validation")),
            "has_service_validation": bool(data.get("service_validation_history")),
        })

    return {
        "user": {
            "id": target["id"],
            "email": target["email"],
            "name": target.get("name"),
            "phone": target.get("phone"),
            "company": target.get("company"),
            "auth_provider": target.get("auth_provider"),
            "email_verified": target.get("email_verified"),
            "created_at": target.get("created_at"),
            "is_blocked": bool(target.get("is_blocked", False)),
            "block_reason": target.get("block_reason"),
        },
        "owned_workspaces": workspace_summaries,
        "memberships": [
            {
                "id": m["id"],
                "workspace_id": m["workspace_id"],
                "workspace_name": ws_names.get(m["workspace_id"], m["workspace_id"]),
                "permission_type": m.get("permission_type"),
                "created_at": m.get("created_at"),
            }
            for m in memberships
        ],
        "blueprint_documents": blueprints,
        "upgrade_clicks": upgrade_clicks,
        "platform_restrictions": restrictions,
    }


# ── Control endpoints ─────────────────────────────────────────────────────────

class BlockPayload(BaseModel):
    reason: Optional[str] = "Blocked by administrator"


@router.patch("/users/{user_id}/block")
async def block_user(
    user_id: str,
    payload: BlockPayload = Body(default=BlockPayload()),
    user=Depends(require_admin),
) -> dict:
    if user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Cannot block your own admin account.")
    try:
        result = await sb_update(
            "users",
            payload={"is_blocked": True, "block_reason": payload.reason or "Blocked by administrator"},
            filters=[("id", "eq", user_id)],
        )
        if not result:
            raise HTTPException(status_code=404, detail="User not found.")
        u = result[0]
        return {"id": u["id"], "email": u["email"], "is_blocked": True, "block_reason": u.get("block_reason")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the is_blocked schema migration first. ({e})")


@router.patch("/users/{user_id}/unblock")
async def unblock_user(user_id: str, user=Depends(require_admin)) -> dict:
    try:
        result = await sb_update(
            "users",
            payload={"is_blocked": False, "block_reason": None},
            filters=[("id", "eq", user_id)],
        )
        if not result:
            raise HTTPException(status_code=404, detail="User not found.")
        u = result[0]
        return {"id": u["id"], "email": u["email"], "is_blocked": False, "block_reason": None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the is_blocked schema migration first. ({e})")


class RestrictionPayload(BaseModel):
    module_key: str
    feature_key: Optional[str] = None


@router.post("/users/{user_id}/restrictions")
async def add_user_restriction(
    user_id: str,
    payload: RestrictionPayload,
    user=Depends(require_admin),
) -> dict:
    feature_key = payload.feature_key or ""
    try:
        existing = await sb_select(
            "user_platform_restrictions",
            filters=[
                ("user_id", "eq", user_id),
                ("module_key", "eq", payload.module_key),
                ("feature_key", "eq", feature_key),
            ],
            single=True,
        )
        if existing:
            return existing
        doc = {
            "id": str(uuid4()),
            "user_id": user_id,
            "module_key": payload.module_key,
            "feature_key": feature_key,
            "created_by": user.get("id"),
        }
        result = await sb_insert("user_platform_restrictions", doc)
        return result[0] if isinstance(result, list) else result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration required: run the user_platform_restrictions schema migration first. ({e})")


@router.delete("/users/{user_id}/restrictions/{restriction_id}", status_code=204, response_class=Response)
async def remove_user_restriction(
    user_id: str,
    restriction_id: str,
    user=Depends(require_admin),
) -> Response:
    try:
        await sb_delete(
            "user_platform_restrictions",
            filters=[("id", "eq", restriction_id), ("user_id", "eq", user_id)],
        )
    except Exception:
        pass
    return Response(status_code=204)


# ── Platform grants ───────────────────────────────────────────────────────────

async def _select_grants(user_id: str, columns: str = "id,module_key,feature_key,created_at") -> list:
    try:
        return await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id)],
            columns=columns,
            order="created_at",
        )
    except Exception:
        return []


@router.get("/users/{user_id}/grants")
async def get_user_grants(user_id: str, user=Depends(require_admin)) -> list:
    return await _select_grants(user_id)


@router.post("/users/{user_id}/grants")
async def add_user_grant(
    user_id: str,
    payload: RestrictionPayload,
    user=Depends(require_admin),
) -> dict:
    feature_key = payload.feature_key or ""
    try:
        existing = await sb_select(
            "user_platform_grants",
            filters=[
                ("user_id", "eq", user_id),
                ("module_key", "eq", payload.module_key),
                ("feature_key", "eq", feature_key),
            ],
            single=True,
        )
        if existing:
            return existing
        doc = {
            "id": str(uuid4()),
            "user_id": user_id,
            "module_key": payload.module_key,
            "feature_key": feature_key,
            "created_by": user.get("id"),
        }
        result = await sb_insert("user_platform_grants", doc)
        return result[0] if isinstance(result, list) else result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Run the user_platform_grants schema migration first. ({e})")


# Full access gives every module, and the two kinds of access that aren't a page of their own.
from app.modules.plans.access import EXTRA_GRANTS, FULL_ACCESS_MODULES      # noqa: E402

ALL_MODULE_KEYS = [*FULL_ACCESS_MODULES, *EXTRA_GRANTS]


@router.get("/users/{user_id}/access")
async def get_user_access(user_id: str, user=Depends(require_admin)) -> dict:
    """What this user can actually use, and where it comes from (subscription or grants)."""
    from app.modules.plans.access import effective_access
    return await effective_access(user_id)


@router.post("/users/{user_id}/grants/full-access")
async def grant_full_access(user_id: str, user=Depends(require_admin)) -> dict:
    """Grant all modules to a user in one shot."""
    # Fetch existing grants in one query
    try:
        existing_rows = await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id)],
            columns="module_key,feature_key",
        )
    except Exception:
        existing_rows = []

    existing_keys = {r["module_key"] for r in existing_rows if not r.get("feature_key")}
    added = []
    already = []
    docs = []
    for module_key in ALL_MODULE_KEYS:
        if module_key in existing_keys:
            already.append(module_key)
        else:
            docs.append({
                "id": str(uuid4()),
                "user_id": user_id,
                "module_key": module_key,
                "feature_key": "",
                "created_by": user.get("id"),
            })
            added.append(module_key)

    if docs:
        try:
            await sb_insert("user_platform_grants", docs)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to insert grants: {e}")

    return {"added": added, "already_existed": already}


@router.delete("/users/{user_id}/grants/full-access", status_code=204, response_class=Response)
async def revoke_full_access(user_id: str, user=Depends(require_admin)) -> Response:
    """Remove all module grants from a user."""
    try:
        await sb_delete("user_platform_grants", filters=[("user_id", "eq", user_id)])
    except Exception:
        pass
    return Response(status_code=204)


@router.delete("/users/{user_id}/grants/{grant_id}", status_code=204, response_class=Response)
async def remove_user_grant(
    user_id: str,
    grant_id: str,
    user=Depends(require_admin),
) -> Response:
    try:
        await sb_delete(
            "user_platform_grants",
            filters=[("id", "eq", grant_id), ("user_id", "eq", user_id)],
        )
    except Exception:
        pass
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204, response_class=Response)
async def delete_user(user_id: str, user=Depends(require_admin)) -> Response:
    if user_id == user.get("id"):
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account.")
    # Everything the user owns goes with them: workspaces and their data, credits, plan, documents (the owner, 31 Oct:
    # "I'm deleting users... it should clear everything he owns")
    from app.shared.auth.purge import purge_account
    target = await sb_select("users", filters=[("id", "eq", user_id)], columns="id,email", single=True)
    await purge_account(user_id, (target or {}).get("email"))
    await sb_delete("users", filters=[("id", "eq", user_id)])
    return Response(status_code=204)


@router.patch("/workspaces/{workspace_id}")
async def rename_workspace(
    workspace_id: str,
    payload: dict = Body(...),
    user=Depends(require_admin),
) -> dict:
    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required.")
    result = await sb_update(
        "workspaces",
        payload={"name": new_name},
        filters=[("id", "eq", workspace_id)],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return {"id": workspace_id, "name": new_name}


@router.get("/workspaces/{workspace_id}/snapshots")
async def list_workspace_snapshots(workspace_id: str, user=Depends(require_admin)) -> list:
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        # Use aggregation to extract only data keys (not values) — avoids loading large blobs
        pipeline = [
            {"$match": {"workspace_id": workspace_id}},
            {"$sort": {"created_at": -1}},
            {"$limit": 50},
            {"$project": {
                "workspace_name": 1,
                "created_at": 1,
                "has_profile": {
                    "$and": [
                        {"$ne": [{"$type": "$data.workspace_profile"}, "missing"]},
                        {"$ne": ["$data.workspace_profile", None]},
                        {"$ne": ["$data.workspace_profile", {}]},
                    ]
                },
                "data_keys": {
                    "$filter": {
                        "input": {
                            "$map": {
                                "input": {"$objectToArray": {"$ifNull": ["$data", {}]}},
                                "as": "kv",
                                "in": {
                                    "$cond": [
                                        {"$and": [
                                            {"$ne": ["$$kv.v", None]},
                                            {"$ne": ["$$kv.v", ""]},
                                            {"$ne": ["$$kv.v", {}]},
                                            {"$ne": ["$$kv.k", "logo_data_url"]},
                                        ]},
                                        "$$kv.k",
                                        "$$REMOVE",
                                    ]
                                },
                            }
                        },
                        "as": "k",
                        "cond": {"$ne": ["$$k", None]},
                    }
                },
            }},
        ]
        docs = await col.aggregate(pipeline).to_list(length=50)
        return [
            {
                "snapshot_id": str(d["_id"]),
                "ws_name": d.get("workspace_name") or "Unnamed",
                "saved_at": d.get("created_at"),
                "has_profile": bool(d.get("has_profile")),
                "data_keys": d.get("data_keys") or [],
            }
            for d in docs
        ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}")


@router.get("/workspaces/{workspace_id}/data-diagnostic")
async def workspace_data_diagnostic(workspace_id: str, user=Depends(require_admin)) -> dict:
    """Returns a summary of what's actually stored in Supabase and MongoDB for this workspace."""
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found in Supabase.")

    data = ws.get("data") or {}
    supabase_summary = {
        "data_is_null": ws.get("data") is None,
        "data_keys": [k for k, v in data.items() if v] if isinstance(data, dict) else [],
        "has_workspace_profile": bool(data.get("workspace_profile")),
        "workspace_profile_keys": list((data.get("workspace_profile") or {}).keys()),
        "has_financials": bool(data.get("financials")),
        "has_idea_validation": bool(data.get("idea_validation")),
        "has_inputs": bool(data.get("inputs") or data.get("assumptions")),
        "updated_at": ws.get("updated_at"),
    }

    mongo_summary = {}
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        count = await col.count_documents({"workspace_id": workspace_id})
        latest = await col.find({"workspace_id": workspace_id}).sort("created_at", -1).limit(1).to_list(1)
        snapshots_with_profile = await col.count_documents({"workspace_id": workspace_id, "data.workspace_profile": {"$exists": True, "$ne": None}})
        mongo_summary = {
            "total_snapshots": count,
            "snapshots_with_profile_data": snapshots_with_profile,
            "latest_snapshot_saved_at": latest[0].get("created_at") if latest else None,
            "latest_snapshot_has_profile": bool((latest[0].get("data") or {}).get("workspace_profile")) if latest else False,
            "latest_snapshot_data_keys": [k for k, v in (latest[0].get("data") or {}).items() if v and k != "logo_data_url"] if latest else [],
        }
    except Exception as exc:
        mongo_summary = {"error": str(exc)}

    return {"workspace_id": workspace_id, "supabase": supabase_summary, "mongodb": mongo_summary}


@router.post("/workspaces/{workspace_id}/restore")
async def restore_workspace_snapshot(
    workspace_id: str,
    payload: dict = Body(...),
    user=Depends(require_admin),
) -> dict:
    snapshot_id = payload.get("snapshot_id")
    if not snapshot_id:
        raise HTTPException(status_code=400, detail="snapshot_id is required.")

    try:
        from app.core.database import get_mongo_db
        from bson import ObjectId
        db = get_mongo_db()
        col = db["workspace_snapshots"]
        snap = await col.find_one({"_id": ObjectId(snapshot_id), "workspace_id": workspace_id})
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}")

    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    # Save current state as a snapshot before overwriting
    try:
        from app.core.database import get_mongo_db
        db = get_mongo_db()
        await db["workspace_snapshots"].insert_one({
            "workspace_id": workspace_id,
            "workspace_name": ws.get("name") or "Unnamed",
            "data": ws.get("data") or {},
            "created_at": now,
        })
    except Exception:
        pass

    import json

    raw_data = snap.get("data") or {}
    # MongoDB may return datetime objects and other BSON types that aren't
    # JSON-serializable. Round-trip through JSON (using str fallback) to
    # produce a plain dict that Supabase can accept.
    try:
        restored_data = json.loads(json.dumps(raw_data, default=str))
    except Exception:
        restored_data = raw_data

    restored_name = snap.get("workspace_name") or ws.get("name") or "Unnamed"

    result = await sb_update(
        "workspaces",
        payload={"data": restored_data, "name": restored_name, "updated_at": now},
        filters=[("id", "eq", workspace_id)],
    )
    if not result:
        raise HTTPException(status_code=500, detail="Restore wrote to MongoDB but Supabase update returned no rows — workspace ID may not exist in Supabase.")

    return {"restored": True, "ws_name": restored_name, "saved_at": snap.get("created_at")}


class WorkspaceProposalsIn(BaseModel):
    enabled: bool


def open_for_proposals(data: dict, enabled: bool, now: str) -> dict:
    """The owner's own "Open for proposals" setting, switched by the superadmin. The listing is never published by this:
    a business that isn't live stays as its owner left it (the owner, 9 Nov)."""
    from app.modules.proposals.service import apply_proposal_preferences
    apply_proposal_preferences(data, {"enabled": enabled}, now, auto_publish=False)
    return {"enabled": enabled, "listing_live": bool((data.get("marketplace") or {}).get("is_active"))}


@router.patch("/workspaces/{workspace_id}/proposals")
async def set_workspace_proposals(workspace_id: str, body: WorkspaceProposalsIn, user=Depends(require_admin)) -> dict:
    from app.modules.agent.business import BusinessAccessDenied
    from app.modules.agent.router import get_orchestrator
    out: dict = {}
    now = datetime.now(timezone.utc).isoformat()
    try:
        await get_orchestrator().rt.business.mutate(workspace_id, lambda data: out.update(open_for_proposals(data, body.enabled, now)))
    except BusinessAccessDenied:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    await _audit(user, "workspace_proposals_changed", {"workspace_id": workspace_id, "enabled": body.enabled})
    return out


@router.delete("/workspaces/{workspace_id}", status_code=204, response_class=Response)
async def delete_workspace(workspace_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("workspaces", filters=[("id", "eq", workspace_id)])
    return Response(status_code=204)


@router.delete("/members/{member_id}", status_code=204, response_class=Response)
async def remove_workspace_member(member_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("workspace_members", filters=[("id", "eq", member_id)])
    return Response(status_code=204)


@router.delete("/upgrade-clicks/{record_id}", status_code=204, response_class=Response)
async def delete_upgrade_click(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("upgrade_clicks", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/module-interest/{record_id}", status_code=204, response_class=Response)
async def delete_module_interest(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("module_interest", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/mailing-list/{record_id}", status_code=204, response_class=Response)
async def delete_mailing_list_entry(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("mailing_list", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.delete("/support-messages/{record_id}", status_code=204, response_class=Response)
async def delete_support_message(record_id: str, user=Depends(require_admin)) -> Response:
    await sb_delete("support_messages", filters=[("id", "eq", record_id)])
    return Response(status_code=204)


@router.patch("/invitations/{invitation_id}/revoke")
async def revoke_workspace_invitation(invitation_id: str, user=Depends(require_admin)) -> dict:
    result = await sb_update(
        "workspace_invitations",
        payload={"status": "revoked"},
        filters=[("id", "eq", invitation_id)],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    return result[0]


TRIAL_DAYS = 14


@router.get("/users/{user_id}/subscription")
async def get_user_subscription(user_id: str, user=Depends(require_admin)) -> dict:
    try:
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    except Exception:
        sub = None
    if sub:
        return sub
    # Fall back to deriving from account creation date
    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")
    created_at_str = user_row.get("created_at", "")
    try:
        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        trial_end = created_at + timedelta(days=TRIAL_DAYS)
        now = datetime.now(timezone.utc)
        return {
            "user_id": user_id,
            "plan_key": "explorer",
            "status": "trial" if now < trial_end else "expired",
            "current_period_end": trial_end.isoformat(),
            "trial_started_at": created_at_str,
            "_derived": True,
        }
    except Exception:
        return {"user_id": user_id, "plan_key": "explorer", "status": "expired", "_derived": True}


@router.get("/users/{user_id}/credits")
async def get_user_credits(user_id: str, user=Depends(require_admin)) -> dict:
    from app.modules.credits import service as credit_svc
    wallet = await credit_svc.get_wallet(user_id)
    sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    plan_code = (sub or {}).get("plan_key") or "explorer"
    return {
        "available_credits": (wallet or {}).get("available_credits", 0),
        "held_credits": (wallet or {}).get("held_credits", 0),
        "lifetime_credits_issued": (wallet or {}).get("lifetime_credits_issued", 0),
        "lifetime_credits_used": (wallet or {}).get("lifetime_credits_used", 0),
        "plan_code": plan_code,
        "wallet_exists": wallet is not None,
    }


class CreditGrantPayload(BaseModel):
    amount: int
    reason: Optional[str] = "Admin credit grant"
    grant_type: Optional[str] = "admin_adjustment"


@router.post("/users/{user_id}/credits/grant")
async def admin_grant_user_credits(user_id: str, payload: CreditGrantPayload, user=Depends(require_admin)) -> dict:
    from app.modules.credits import service as credit_svc
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    try:
        result = await credit_svc.grant_credits(
            user_id,
            payload.amount,
            grant_type=payload.grant_type or "admin_adjustment",
            reason=payload.reason or "Admin credit grant",
        )
        return result or {"status": "granted", "user_id": user_id, "amount": payload.amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Credit grant failed: {e}")


class CreditDeductPayload(BaseModel):
    amount: int
    reason: Optional[str] = "Admin credit reduction"


@router.post("/users/{user_id}/credits/deduct")
async def admin_deduct_user_credits(user_id: str, payload: CreditDeductPayload, user=Depends(require_admin)) -> dict:
    """Take credits out of a user's available balance. It never goes below zero: asking for
    more than is available removes what is there, and the response says how many were removed."""
    from app.modules.credits import service as credit_svc
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    try:
        result = await credit_svc.deduct_credits_admin(user_id, payload.amount, (payload.reason or "").strip() or "Admin credit reduction")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Credit reduction failed: {e}")
    result = result or {}
    if result.get("ok") is False:
        if result.get("error") == "WALLET_NOT_FOUND":
            raise HTTPException(status_code=404, detail="This user has no credit wallet yet, so there is nothing to reduce.")
        raise HTTPException(status_code=400, detail=f"Credit reduction failed: {result.get('error') or 'unknown error'}")
    return {"status": "deducted", "user_id": user_id, "requested": payload.amount,
            "deducted": result.get("deducted", payload.amount), "balance": result.get("balance")}


@router.post("/users/{user_id}/credits/provision")
async def admin_provision_user_credits(user_id: str, user=Depends(require_admin)) -> dict:
    """Re-issue the plan's full credit allocation for this user (admin-only renewal)."""
    from app.modules.credits import service as credit_svc
    sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    plan_code = (sub or {}).get("plan_key") or "explorer"
    result = await credit_svc.provision_plan_credits(
        user_id, plan_code,
        reason=f"Admin-initiated {plan_code} credit renewal",
    )
    return {**result, "plan_code": plan_code}


@router.post("/users/{user_id}/renew-trial")
async def renew_user_trial(user_id: str, user=Depends(require_admin)) -> dict:
    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found.")
    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=TRIAL_DAYS)
    await sb_upsert(
        "user_subscriptions",
        payload={
            "user_id": user_id,
            "plan_key": "explorer",
            "billing_period": "monthly",
            "status": "trial",
            "stripe_subscription_id": None,
            "stripe_customer_id": None,
            "current_period_start": now.isoformat(),
            "current_period_end": trial_end.isoformat(),
            "trial_started_at": now.isoformat(),
            "cancelled_at": None,
            "updated_at": now.isoformat(),
        },
        on_conflict="user_id",
    )
    return {"renewed": True, "trial_end": trial_end.isoformat()}


@router.get("/research-runs/{business_id}")
async def research_diagnostics(business_id: str, limit: int = 10, user=Depends(require_admin)) -> dict:
    """Research diagnostics: a business's latest research runs, topic by topic (the queries sent, results, pages loaded,
    sources kept and dropped with why, the model's calls) and why a topic ended with no sources."""
    from app.modules.agent import research
    from app.modules.agent.router import get_orchestrator
    data = await get_orchestrator().rt.business.load(business_id) or {}
    runs = sorted((data.get("research_runs") or {}).values(), key=lambda r: r.get("created_at") or "", reverse=True)[:max(1, min(limit, 50))]
    return {"business_id": business_id, "health": research.health(),
            "runs": [{k: r.get(k) for k in ("id", "goal", "status", "created_at", "seconds", "error", "unavailable", "charged", "counts", "context", "diagnostics")}
                     for r in runs]}


# ── Emails: what was sent, which kinds are on, their wording, and one-off emails ───────────────

_EMAIL_SAMPLES = {
    "email_verification": {"greeting": "Hi Ada,", "app_name": "EnterprateAI", "link": "https://example.com/verify"},
    "password_reset": {"app_name": "EnterprateAI", "email": "ada@example.com", "minutes": 60, "link": "https://example.com/reset"},
    "password_otp": {"app_name": "EnterprateAI", "code": "482913"},
    "task_code": {"app_name": "EnterprateAI", "code": "482913", "saving": " and carry on with: your business plan"},
    "workspace_invitation": {"inviter_email": "owner@example.com", "app_name": "EnterprateAI", "access_level": "module access", "expires": "7 days", "link": "https://example.com/invite"},
    "proposal_invite": {"sender_name": "Apex Consulting Ltd", "request_title": "Office fit-out", "request_description": "A 2,000 sq ft office in Leeds.",
                        "requirements": "What you'll need to provide:\nRequired: Insurance certificate", "link": "https://example.com/request"},
    "document_share": {"sender_label": "Apex Consulting Ltd", "article": "a", "doc_label": "business plan", "app_name": "EnterprateAI", "expires": "7 days", "link": "https://example.com/doc"},
    "invoice_share": {"business_name": "Apex Consulting Ltd", "article": "an", "doc_type": "Invoice", "link": "https://example.com/invoice"},
    "quote_sent": {"customer_name": "Ada Lovelace", "business_name": "Apex Consulting Ltd", "reference": "Q-1A2B3C4D", "total": "\u00a31,500.00", "valid_days": 30},
    "quote_question": {"customer_name": "Ada Lovelace", "reference": "Q-1A2B3C4D", "question": "Does the price include delivery?", "business_name": "Apex Consulting Ltd",
                       "link": "https://example.com/operations"},
    "quote_customer_action": {"customer_name": "Ada Lovelace", "outcome": "accepted", "reference": "Q-1A2B3C4D", "detail": "Signed by Ada Lovelace.",
                              "business_name": "Apex Consulting Ltd", "link": "https://example.com/operations"},
    "claim_code": {"app_name": "EnterprateAI", "business_name": "Apex Consulting Ltd", "code": "482913"},
    "claim_invitation": {"headline": "Apex Consulting Ltd is now listed on the EnterprateAI Marketplace", "business_name": "Apex Consulting Ltd", "waiting": "2 requests are waiting for you.",
                         "message": "Apex Consulting Ltd is now listed on the EnterprateAI Marketplace, based on public information. 2 requests are waiting for you. Claim it for free to correct the details, reply to customers and choose the work you want.",
                         "link": "https://example.com/claim", "opt_out": "https://example.com/stop"},
    "claim_decision": {"headline": "You now manage Apex Consulting Ltd on EnterprateAI", "business_name": "Apex Consulting Ltd",
                       "message": "We've reviewed your claim and you now manage Apex Consulting Ltd on the EnterprateAI Marketplace.", "reason": "",
                       "waiting": "", "next_step": "Next step: check what the public sees and choose the opportunities you want.",
                       "action": "Finish setting up your profile", "link": "https://example.com/profile"},
    "marketplace_team_invite": {"app_name": "EnterprateAI", "email": "reviewer@example.com", "link": "https://example.com/team-invite"},
    "demo_request": {"name": "Ada Lovelace", "email": "ada@example.com", "company": "Apex Consulting Ltd", "phone": "Not given", "role": "Founder",
                     "message": "We'd like to see the Agent."},
}


class EmailKindIn(BaseModel):
    enabled: Optional[bool] = None
    subject: Optional[str] = Field(default=None, max_length=300)
    body: Optional[str] = Field(default=None, max_length=60000)      # plain lines, or HTML from the formatting editor
    button_label: Optional[str] = Field(default=None, max_length=80)


class EmailPreviewIn(BaseModel):
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=60000)
    button_label: str = Field(default="", max_length=80)


class EmailAttachment(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=14_000_000)      # base64, the way Resend takes it


class EmailSendIn(BaseModel):
    to: str = Field(max_length=4000)                 # addresses, separated by commas, spaces or new lines
    subject: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=5, max_length=8000)      # the message as plain words (mail apps without formatting)
    reply_to: Optional[str] = Field(default=None, max_length=200)
    html: Optional[str] = Field(default=None, max_length=200_000)      # the same message with its formatting, from the editor
    attachments: list[EmailAttachment] = Field(default_factory=list, max_length=10)


# ── Writing an email in the superadmin (the owner, 12 Nov): formatting, links, attachments and variables ──────────────

EMAIL_VARIABLES = {"name": "Their name", "first_name": "Their first name", "email": "Their email address", "login_link": "The sign in page",
                   "business": "Their business or workspace name", "profile_link": "Their Marketplace profile page",
                   "claim_link": "The page to claim their unclaimed profile"}
_GREETING = {"name", "first_name"}      # "there" when the name isn't known, so "Hi {name}" still reads well
_VARIABLE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_ATTACHMENT_BYTES = 10 * 1024 * 1024
_TAGS = {"p", "br", "div", "b", "strong", "i", "em", "u", "s", "strike", "h2", "h3", "ul", "ol", "li", "blockquote", "a"}
_STYLE = {"p": "margin:0 0 14px;", "div": "margin:0 0 6px;", "h2": "margin:18px 0 10px;font-size:20px;line-height:1.3;",
          "h3": "margin:16px 0 8px;font-size:17px;", "ul": "margin:0 0 14px;padding-left:22px;", "ol": "margin:0 0 14px;padding-left:22px;",
          "li": "margin:0 0 4px;", "blockquote": "margin:0 0 14px;padding:4px 0 4px 12px;border-left:3px solid #cbd5e1;color:#475569;",
          "a": "color:#4f46e5;text-decoration:underline;"}
_BUTTON_STYLE = ("display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;"
                 "font-weight:600;font-size:15px;line-height:1.2;")


def _clean_email_html(raw: str, hrefs: str = r"\{[a-z_]*_link\}") -> str:
    """Only plain formatting goes out: the tags the editor makes, links to web or email addresses, nothing else
    (no scripts, styles, images or event handlers). Each tag gets the inline style mail apps need. `hrefs` is which
    variables may stand for a link's address: the *_link ones here, any of an email kind's own in its wording."""
    from html import escape as _escape
    from html.parser import HTMLParser

    class _Clean(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.out, self.open, self.skip = [], [], 0

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style", "head", "title"):
                self.skip += 1
                return
            if self.skip or tag not in _TAGS:
                return
            if tag == "br":
                self.out.append("<br/>")
                return
            extra = ""
            if tag == "a":
                href = (dict(attrs).get("href") or "").strip()
                # A web or email address, or one of our link variables ({claim_link}), filled in with our own address later
                if not re.match(r"^(https?://|mailto:)", href, re.I) and not re.fullmatch(hrefs, href):
                    return
                extra = f' href="{_escape(href, quote=True)}" target="_blank" rel="noopener"'
            self.open.append(tag)
            style = _BUTTON_STYLE if tag == "a" and dict(attrs).get("data-button") else _STYLE.get(tag, "")      # a button from the editor
            if tag in ("p", "div", "h2", "h3", "li", "blockquote"):      # alignment from the editor is the one style kept
                given = dict(attrs)
                found = re.search(r"text-align\s*:\s*(left|center|right|justify)", given.get("style") or "", re.I)
                align = (found.group(1) if found else str(given.get("align") or "")).lower()
                if align in ("left", "center", "right", "justify"):
                    style += f"text-align:{align};"
            self.out.append(f'<{tag}{extra} style="{style}">' if style else f"<{tag}{extra}>")

        def handle_endtag(self, tag):
            if tag in ("script", "style", "head", "title"):
                self.skip = max(0, self.skip - 1)
                return
            if tag in self.open:
                while self.open:
                    t = self.open.pop()
                    self.out.append(f"</{t}>")
                    if t == tag:
                        break

        def handle_data(self, data):
            if not self.skip:      # a non-breaking space from the editor goes out as &nbsp;, which every mail app shows
                self.out.append(_escape(data, quote=False).replace(" ", "&nbsp;"))

    c = _Clean()
    c.feed(raw or "")
    c.close()
    return "".join(c.out) + "".join(f"</{t}>" for t in reversed(c.open))


def _unknown_variables(*parts: str | None) -> list[str]:
    return sorted({"{" + m + "}" for p in parts for m in _VARIABLE.findall(p or "") if m not in EMAIL_VARIABLES})


def _check_message(subject: str, body: str, html: str | None, attachments: list) -> list[dict]:
    """What can't go out, said plainly; otherwise the attachments as Resend takes them."""
    import base64
    unknown = _unknown_variables(subject, body, html)
    if unknown:
        raise HTTPException(status_code=422, detail=f"These can't be filled in: {', '.join(unknown)}. Use "
                                                    + ", ".join("{" + k + "}" for k in EMAIL_VARIABLES) + ", or take them out.")
    files, total = [], 0
    for a in attachments:
        try:
            size = len(base64.b64decode(a.content, validate=True))
        except Exception:      # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"{a.filename} couldn't be read. Attach it again.")
        total += size
        files.append({"filename": a.filename.strip()[:200], "content": a.content})
    if total > _ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="Attachments can add up to 10 MB at most.")
    return files


def _site() -> str:
    return str(getattr(get_settings(), "frontend_url", "") or "").split(",")[0].strip().rstrip("/")


def _person_values(*, name: str = "", email: str = "", business: str = "", slug: str = "", claimed: bool | None = None) -> dict:
    """Every variable for one person. A link they don't have is left out, so a message that needs it is stopped."""
    who = " ".join((name or "").split()) or " ".join((business or "").split())
    site = _site()
    values = {"name": who, "first_name": who.split(" ")[0] if who else "", "email": email, "login_link": f"{site}/login" if site else "",
              "business": " ".join((business or "").split())}
    if slug and site:
        values["profile_link"] = f"{site}/marketplace/business/{slug}"
        if claimed is False:
            values["claim_link"] = f"{site}/marketplace/claim/{slug}"
    return {k: v for k, v in values.items() if v}


def _missing_for(people: list[dict], subject: str, body: str, html: str | None) -> str | None:
    """Plain words for the variables some picked people have no value for (names fall back to "there")."""
    used = {m for p in (subject, body, html) for m in _VARIABLE.findall(p or "")} - _GREETING
    gaps = []
    for var in sorted(used):
        short = [p["email"] for p in people if not p["values"].get(var)]
        if short:
            gaps.append(f"{{{var}}} is empty for {len(short)} of {len(people)} ({', '.join(short[:3])}{'…' if len(short) > 3 else ''})")
    return "; ".join(gaps) + ". Take those people out or the variable." if gaps else None


def _compose(subject: str, body: str, html: str | None, values: dict | None = None) -> tuple[str, str, str]:
    """The email one person gets: variables filled with their details. With formatting from the editor it goes out as
    written (cleaned); without, each paragraph of the plain words becomes one."""
    from html import escape as _escape
    from app.shared.email.resend import WRITTEN_FOOTER_HTML, WRITTEN_FOOTER_TEXT
    values = {**{k: "there" for k in _GREETING}, **(values or {})}
    fill = lambda s, esc=False: _VARIABLE.sub(lambda m: (_escape(values[m.group(1)]) if esc else values[m.group(1)]) if m.group(1) in values else m.group(0), s or "")      # noqa: E731
    text = fill(body.strip())
    if (html or "").strip():
        inner = fill(_clean_email_html(html), esc=True)
    else:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        inner = "".join("<p style=\"margin:0 0 14px;\">" + "<br/>".join(_escape(line) for line in p.split("\n")) + "</p>" for p in paragraphs)
    page = ("<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
            + inner + WRITTEN_FOOTER_HTML + "</div>")
    return " ".join(fill(subject).split()), text + WRITTEN_FOOTER_TEXT, page


def _email_tables_missing() -> HTTPException:
    return HTTPException(status_code=503, detail="The Emails area isn't set up yet: run migration 047_email_admin.sql in Supabase.")


@router.get("/emails/kinds")
async def email_kinds(user=Depends(require_admin)) -> dict:
    from app.shared.email import catalog
    try:
        rows = {r["kind"]: r for r in (await sb_select("email_settings") or [])}
        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        try:
            recent = await sb_select("email_log", columns="kind,status,opened_at,clicked_at", filters=[("created_at", "gte", since)], limit=20000) or []
        except Exception:      # before migration 048: no tracking columns yet
            recent = await sb_select("email_log", columns="kind,status", filters=[("created_at", "gte", since)], limit=20000) or []
        set_up = True
    except Exception:
        rows, recent, set_up = {}, [], False
    counts: dict[str, dict[str, int]] = {}
    for r in recent:
        c = counts.setdefault(r.get("kind") or "other", {})
        c[r.get("status") or "sent"] = c.get(r.get("status") or "sent", 0) + 1
        for seen in ("opened", "clicked"):
            if r.get(f"{seen}_at"):
                c[seen] = c.get(seen, 0) + 1
    items = []
    for key, k in catalog.KINDS.items():
        row = rows.get(key) or {}
        t = catalog.TEMPLATES.get(key)
        items.append({
            "key": key, "label": k["label"], "description": k["description"], "essential": k["essential"], "editable": bool(t), "written": catalog.WRITTEN_ELSEWHERE.get(key),
            "enabled": row.get("enabled", True) is not False, "edited": bool(row.get("subject") or row.get("body")),
            "subject": row.get("subject") or (t or {}).get("subject"), "body": row.get("body") or (t or {}).get("body"),
            "button_label": row.get("button_label") or (t or {}).get("button"),
            "default": {"subject": t["subject"], "body": t["body"], "button_label": t["button"]} if t else None,
            "variables": (t or {}).get("variables", []), "required": (t or {}).get("required", []),
            "updated_by": row.get("updated_by"), "updated_at": row.get("updated_at"), "last_30_days": counts.get(key, {}),
        })
    return {"set_up": set_up, "items": items}


@router.put("/emails/kinds/{kind}")
async def save_email_kind(kind: str, body: EmailKindIn, user=Depends(require_admin)) -> dict:
    from app.shared.email import catalog
    if kind not in catalog.KINDS:
        raise HTTPException(status_code=404, detail="No such email.")
    try:
        current = await sb_select("email_settings", filters=[("kind", "eq", kind)], single=True) or {}
    except Exception:
        raise _email_tables_missing()
    row = {"kind": kind, "enabled": current.get("enabled", True), "subject": current.get("subject"), "body": current.get("body"),
           "button_label": current.get("button_label")}
    if body.enabled is not None:
        if body.enabled is False and catalog.KINDS[kind]["essential"]:
            raise HTTPException(status_code=400, detail="This email can't be switched off: people need it to get into their account, or asked for it themselves.")
        row["enabled"] = body.enabled
    if body.subject is not None or body.body is not None or body.button_label is not None:
        t = catalog.TEMPLATES.get(kind)
        subject = body.subject if body.subject is not None else (row["subject"] or (t or {}).get("subject", ""))
        text = body.body if body.body is not None else (row["body"] or (t or {}).get("body", ""))
        button = body.button_label if body.button_label is not None else (row["button_label"] or (t or {}).get("button", ""))
        errors = catalog.problems(kind, subject, text, button)
        if errors:
            raise HTTPException(status_code=422, detail={"errors": errors, "message": " ".join(errors.values())})
        row.update({"subject": subject.strip(), "body": text.strip(), "button_label": button.strip()})
    row.update({"updated_by": user.get("email"), "updated_at": datetime.now(timezone.utc).isoformat()})
    try:
        await sb_upsert("email_settings", payload=row, on_conflict="kind")
    except Exception:
        raise _email_tables_missing()
    catalog.forget(kind)
    await _audit(user, "email_setting_changed", {"kind": kind, "enabled": row["enabled"], "wording_edited": bool(row.get("body"))})
    return {"kind": kind, "enabled": row["enabled"], "edited": bool(row.get("subject") or row.get("body"))}


@router.delete("/emails/kinds/{kind}/wording")
async def reset_email_wording(kind: str, user=Depends(require_admin)) -> dict:
    """Back to the wording written in the product. Whether it is switched on is kept."""
    from app.shared.email import catalog
    if kind not in catalog.KINDS:
        raise HTTPException(status_code=404, detail="No such email.")
    try:
        await sb_update("email_settings", filters=[("kind", "eq", kind)],
                        payload={"subject": None, "body": None, "button_label": None, "updated_by": user.get("email"), "updated_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        raise _email_tables_missing()
    catalog.forget(kind)
    await _audit(user, "email_wording_reset", {"kind": kind})
    return {"kind": kind, "edited": False}


@router.post("/emails/kinds/{kind}/preview")
async def preview_email(kind: str, body: EmailPreviewIn, user=Depends(require_admin)) -> dict:
    from app.shared.email import catalog
    from app.shared.email.resend import _FOOTER_HTML, _FOOTER_TEXT
    if kind not in catalog.TEMPLATES:
        raise HTTPException(status_code=404, detail="This email's wording can't be edited here.")
    errors = catalog.problems(kind, body.subject, body.body, body.button_label)
    subject, text, html = catalog.render(kind, {"subject": body.subject, "body": body.body, "button_label": body.button_label},
                                         _EMAIL_SAMPLES.get(kind, {}), footer_html=_FOOTER_HTML, footer_text=_FOOTER_TEXT)
    return {"subject": subject, "text": text, "html": html, "errors": errors}


@router.get("/emails/log")
async def email_log(kind: Optional[str] = None, status_is: Optional[str] = None, q: Optional[str] = None, tracked: Optional[str] = None,
                    limit: int = 300, user=Depends(require_admin)) -> dict:
    filters = []
    if kind:
        filters.append(("kind", "eq", kind))
    if status_is:
        filters.append(("status", "eq", status_is))
    cap = max(1, min(limit, 1000))
    try:
        rows = await sb_select("email_log", filters=filters, order="created_at", desc=True, limit=3000 if (q or tracked) else cap) or []
    except Exception:
        raise _email_tables_missing()
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in str(r.get("to_email") or "").lower() or needle in str(r.get("subject") or "").lower()]
    if tracked in ("opened", "clicked", "bounced", "delivered", "complained"):
        rows = [r for r in rows if r.get(f"{tracked}_at")]
    elif tracked == "not_opened":
        rows = [r for r in rows if r.get("status") == "sent" and not r.get("opened_at")]
    return {"items": rows[:cap]}


@router.post("/emails/send")
async def send_one_off_email(body: EmailSendIn, user=Depends(require_admin)) -> dict:
    """A one-off email to named addresses, each sent on its own so nobody sees the others. Not for the mailing list:
    a bulk email needs an unsubscribe link first."""
    import re as _re
    from app.shared.email.resend import send_email_via_resend
    addresses: list[str] = []
    for a in _re.split(r"[\s,;]+", body.to.strip()):
        a = a.strip().lower()
        if a and a not in addresses:
            addresses.append(a)
    bad = [a for a in addresses if not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", a)]
    if not addresses or bad:
        raise HTTPException(status_code=422, detail=f"Check these addresses: {', '.join(bad)}." if bad else "Add at least one address.")
    if len(addresses) > 20:
        raise HTTPException(status_code=422, detail="Up to 20 addresses at a time.")
    files = _check_message(body.subject, body.body, body.html, body.attachments)
    people = [{"email": a, "name": "", "key": ""} for a in addresses]
    await _values_for(people)
    gaps = _missing_for(people, body.subject, body.body, body.html)
    if gaps:
        raise HTTPException(status_code=422, detail=gaps)
    results = []
    for p in people:
        s, t, h = _compose(body.subject, body.body, body.html, p["values"])
        r = await send_email_via_resend(to_email=p["email"], subject=s, text_content=t, html_content=h, attachments=files or None,
                                        reply_to_email=(body.reply_to or "").strip() or None, kind="manual", sent_by=user.get("email"))
        results.append({"to": p["email"], "sent": r.sent, "error": None if r.sent else r.error})
    await _audit(user, "email_sent_from_admin", {"to": addresses, "subject": body.subject.strip(), "sent": sum(1 for r in results if r["sent"])})
    return {"results": results, "sent": sum(1 for r in results if r["sent"]), "failed": sum(1 for r in results if not r["sent"])}


@router.get("/emails/optouts")
async def email_optouts(user=Depends(require_admin)) -> dict:
    try:
        rows = await sb_select("email_optouts", order="created_at", desc=True, limit=2000) or []
    except Exception:
        raise _email_tables_missing()
    return {"items": rows}


@router.delete("/emails/optouts")
async def remove_email_optout(email: str, kind: str, user=Depends(require_admin)) -> dict:
    """Undo an opt-out, for example when someone asks by phone to get these emails again. Kept in the audit log."""
    try:
        await sb_delete("email_optouts", filters=[("email", "eq", email.strip().lower()), ("kind", "eq", kind)])
    except Exception:
        raise _email_tables_missing()
    await _audit(user, "email_optout_removed", {"email": email.strip().lower(), "kind": kind})
    return {"ok": True}



# ── Bulk email (the owner, 11 Nov): many people at once, picked from users, workspaces and Marketplace profiles,
# or typed in. Each person gets their own copy with an unsubscribe link; opt-outs and marketing unsubscribes are skipped.

_BULK_JOBS: dict[str, dict] = {}
_BULK_CAP = 2000
_BULK_GAP_SECONDS = 0.6      # our email provider takes about two a second


def _marketing_state(c: dict | None) -> str:
    if not c:
        return "unknown"
    if c.get("unsubscribed"):
        return "unsubscribed"
    return "agreed" if may_be_sent_marketing(c) else "not_agreed"


async def _profile_slugs() -> dict[str, str]:
    """Each workspace's own Marketplace profile (the one it claimed), by workspace: its page's address name."""
    try:
        from app.modules.marketplace.directory import SCOPE
        from app.modules.marketplace.directory_router import get_service
        rows = await get_service().store.list("profiles", SCOPE, limit=5000)
    except Exception:      # noqa: BLE001 - no Marketplace: no profile links, everything else still works
        logging.getLogger(__name__).info("Marketplace profiles not read for email links", exc_info=True)
        return {}
    out: dict[str, str] = {}
    for r in rows:
        d = r.get("data") or {}
        if d.get("linked_business_id") and d.get("slug") and d.get("publication") != "merged":
            out.setdefault(str(d["linked_business_id"]), str(d["slug"]))
    return out


async def _bulk_audience(source: str) -> list[dict]:
    """Everyone in one source, with what the filters need. Rows without an email are listed but can't be picked."""
    if source == "users":
        # A user's business and profile link come from their workspace (the first one that has a profile, else the first)
        slugs = await _profile_slugs()
        theirs: dict[str, dict] = {}
        for w in await sb_select("workspaces", columns="id,name,user_id,created_at", order="created_at") or []:
            uid = str(w.get("user_id") or "")
            if uid and (uid not in theirs or (not slugs.get(str(theirs[uid]["id"])) and slugs.get(str(w["id"])))):
                theirs[uid] = w
        out = []
        for c in await _contacts():
            email = c["email"] if "@" in str(c.get("email") or "") else ""
            w = theirs.get(str(c["id"])) or {}
            out.append({"key": f"user:{c['id']}", "email": email, "name": c["name"], "plan": c["plan"], "marketing": _marketing_state(c),
                        "since": str(c.get("created_at") or "")[:10],
                        "values": _person_values(name=c.get("name") or "", email=email, business=w.get("name") or "",
                                                 slug=slugs.get(str(w.get("id") or ""), ""), claimed=True)})
        return out
    if source == "workspaces":
        people = {str(c["id"]): c for c in await _contacts()}
        slugs = await _profile_slugs()
        rows = await sb_select("workspaces", columns="id,name,user_id,created_at", order="created_at", desc=True) or []
        out = []
        for w in rows:
            c = people.get(str(w.get("user_id")))
            email = str((c or {}).get("email") or "")
            out.append({"key": f"workspace:{w['id']}", "email": email if "@" in email else "", "name": w.get("name") or "Unnamed workspace",
                        "owner": (c or {}).get("name") or "", "plan": (c or {}).get("plan") or "explorer", "marketing": _marketing_state(c),
                        "since": str(w.get("created_at") or "")[:10],
                        "values": _person_values(name=(c or {}).get("name") or "", email=email if "@" in email else "", business=w.get("name") or "",
                                                 slug=slugs.get(str(w["id"]), ""), claimed=True)})
        return out
    if source in ("claimed", "unclaimed"):
        from app.modules.marketplace.directory import SCOPE
        from app.modules.marketplace.directory_router import get_service
        rows = [r for r in await get_service().store.list("profiles", SCOPE, limit=5000) if (r.get("data") or {}).get("publication") != "merged"]
        owners: dict[str, str] = {}
        if source == "claimed":
            people = {str(c["id"]): c.get("email") for c in await _contacts()}
            for w in await sb_select("workspaces", columns="id,user_id") or []:
                owners[str(w["id"])] = str(people.get(str(w.get("user_id"))) or "")
        out = []
        for r in rows:
            d = r.get("data") or {}
            linked = d.get("linked_business_id")
            if bool(linked) != (source == "claimed"):
                continue
            email = str((owners.get(str(linked)) if linked else "") or d.get("contact_email") or "")
            out.append({"key": f"profile:{r['id']}", "email": email if "@" in email else "", "name": d.get("name") or "Unnamed business",
                        "category": d.get("category") or "", "location": d.get("location") or "", "since": str(r.get("created_at") or "")[:10],
                        "values": _person_values(email=email if "@" in email else "", business=d.get("name") or "", slug=d.get("slug") or "",
                                                 claimed=bool(linked))})
        return out
    raise HTTPException(status_code=422, detail="Choose users, workspaces, claimed or unclaimed profiles.")


@router.get("/emails/audience")
async def email_audience(source: str = "users", user=Depends(require_admin)) -> dict:
    items = await _bulk_audience(source)
    return {"items": items, "total": len(items)}


class BulkRecipient(BaseModel):
    email: str = Field(max_length=320)
    name: str = Field(default="", max_length=200)
    key: str = Field(default="", max_length=120)      # where they were picked from ("user:…", "workspace:…", "profile:…"); empty when typed in


async def _values_for(people: list[dict]) -> None:
    """Each person's variables, from the list they were picked from; someone typed in is matched to an account by email."""
    keys = {p["key"] for p in people if p.get("key")}
    sources = {"user": ["users"], "workspace": ["workspaces"], "profile": ["claimed", "unclaimed"]}
    known: dict[str, dict] = {}
    for prefix, names in sources.items():
        if any(k.startswith(prefix + ":") for k in keys):
            for source in names:
                known.update({r["key"]: r.get("values") or {} for r in await _bulk_audience(source)})
    accounts = None
    for p in people:
        if p.get("key") in known:
            p["values"] = {**known[p["key"]], "email": p["email"]}
            continue
        if accounts is None:      # typed in: an account's own details and links, when the address has one
            try:
                accounts = {str(r.get("email") or "").lower(): r.get("values") or {} for r in await _bulk_audience("users")}
            except Exception:      # noqa: BLE001 - names fall back to "there"; the email still goes
                logging.getLogger(__name__).info("Details for typed-in addresses not looked up", exc_info=True)
                accounts = {}
        found = accounts.get(p["email"])
        p["values"] = {**found, "email": p["email"]} if found else _person_values(name=p.get("name") or "", email=p["email"])


class BulkEmailIn(BaseModel):
    recipients: list[BulkRecipient] = Field(default_factory=list, max_length=5000)
    subject: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=5, max_length=8000)
    reply_to: Optional[str] = Field(default=None, max_length=200)
    test: bool = False      # one copy to the superadmin, filled with the first person's details
    html: Optional[str] = Field(default=None, max_length=200_000)
    attachments: list[EmailAttachment] = Field(default_factory=list, max_length=10)


async def _send_bulk(job_id: str, people: list[dict], subject: str, body: str, html: str | None, files: list[dict], reply_to: str | None,
                     sent_by: str | None) -> None:
    from app.shared.email.resend import MSG_OPTED_OUT, send_email_via_resend
    job = _BULK_JOBS[job_id]
    for p in people:
        try:
            s, t, h = _compose(subject, body, html, p["values"])
            r = await send_email_via_resend(kind="bulk", to_email=p["email"], subject=s, text_content=t, html_content=h, reply_to_email=reply_to,
                                            attachments=files or None, sent_by=sent_by, idempotency_key=f"bulk/{job_id}/{p['email']}")
            job["sent" if r.sent else "opted_out" if r.error == MSG_OPTED_OUT else "failed"] += 1
        except Exception:      # noqa: BLE001 - one bad address never stops the rest
            logging.getLogger(__name__).warning("Bulk email to one address failed", exc_info=True)
            job["failed"] += 1
        job["done"] += 1
        await asyncio.sleep(_BULK_GAP_SECONDS)
    job["finished_at"] = datetime.now(timezone.utc).isoformat()


@router.post("/emails/bulk")
async def send_bulk_email(body: BulkEmailIn, user=Depends(require_admin)) -> dict:
    from app.shared.email.resend import send_email_via_resend
    files = _check_message(body.subject, body.body, body.html, body.attachments)
    people, seen, invalid = [], set(), []
    for r in body.recipients:
        email = r.email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            invalid.append(r.email)
            continue
        if email in seen:
            continue
        seen.add(email)
        people.append({"email": email, "name": r.name.strip(), "key": r.key.strip()})
    duplicates = len(body.recipients) - len(people) - len(invalid)
    if not people:
        raise HTTPException(status_code=422, detail="Pick or add at least one person with an email address.")
    await _values_for(people)
    reply_to = (body.reply_to or "").strip() or None
    if body.test:
        s, t, h = _compose(body.subject, body.body, body.html, people[0]["values"])
        r = await send_email_via_resend(kind="manual", to_email=user.get("email"), subject=f"[Test] {s}", text_content=t, html_content=h,
                                        reply_to_email=reply_to, attachments=files or None, sent_by=user.get("email"))
        return {"test": True, "to": user.get("email"), "sent": bool(r.sent), "error": None if r.sent else r.error}
    if len(people) > _BULK_CAP:
        raise HTTPException(status_code=422, detail=f"Up to {_BULK_CAP:,} people at a time. Narrow the filters and send in parts.")
    # Account holders who unsubscribed from our marketing are left out; Unsubscribe-link opt-outs are skipped as each one is sent.
    unsubscribed = {str(c["email"]).lower() for c in await _contacts() if c.get("unsubscribed")}
    kept = [p for p in people if p["email"] not in unsubscribed]
    gaps = _missing_for(kept, body.subject, body.body, body.html)
    if gaps:
        raise HTTPException(status_code=422, detail=gaps)
    job_id = uuid4().hex[:12]
    _BULK_JOBS[job_id] = {"id": job_id, "total": len(kept), "done": 0, "sent": 0, "failed": 0, "opted_out": 0, "subject": body.subject.strip(),
                          "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None if kept else datetime.now(timezone.utc).isoformat()}
    if kept:
        _BULK_JOBS[job_id]["_task"] = asyncio.create_task(_send_bulk(job_id, kept, body.subject, body.body, body.html, files, reply_to, user.get("email")))
    await _audit(user, "bulk_email_started", {"job": job_id, "subject": body.subject.strip(), "people": len(kept), "attachments": len(files),
                                              "unsubscribed_left_out": len(people) - len(kept)})
    return {**_bulk_status(job_id), "left_out": {"invalid": invalid, "duplicates": duplicates, "unsubscribed": len(people) - len(kept)}}


def _bulk_status(job_id: str) -> dict:
    job = _BULK_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="That send isn't running on this server any more. The Sent tab shows every email it sent.")
    return {k: v for k, v in job.items() if not k.startswith("_")}


@router.get("/emails/bulk/{job_id}")
async def bulk_email_status(job_id: str, user=Depends(require_admin)) -> dict:
    return _bulk_status(job_id)
