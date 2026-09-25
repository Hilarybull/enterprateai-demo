from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.core.config import get_settings
from app.core.supabase import sb_insert, sb_select, sb_upsert
from app.modules.plans.schemas import (
    CheckoutRequest, CheckoutResponse,
    SubscribeRequest, SubscribeResponse,
    SubscriptionOut,
)
from app.shared.auth.deps import get_current_user
from app.modules.credits.service import provision_plan_credits, reset_monthly_credits
from app.modules.referral import service as ref_svc
from app.modules.plans.access import resolve_subscription
from app.modules.addons import service as addon_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plans", tags=["plans"])

TRIAL_DAYS = 14


# Maps (plan_key, billing_period) → settings attribute name
_PRICE_ATTR = {
    # Current active plans
    ("starter_insight", "monthly"): "stripe_price_insight_starter_monthly",
    ("starter_insight", "annual"):  "stripe_price_insight_starter_annual",
    ("decision_engine", "monthly"): "stripe_price_decision_engine_monthly",
    ("decision_engine", "annual"):  "stripe_price_decision_engine_annual",
    ("growth_navigator", "monthly"): "stripe_price_strategic_intelligence_monthly",
    ("growth_navigator", "annual"):  "stripe_price_strategic_intelligence_annual",
    ("strategic_business_os", "monthly"): "stripe_price_strategic_business_os_monthly",
    ("strategic_business_os", "annual"):  "stripe_price_strategic_business_os_annual",
    # Legacy aliases
    ("insight_starter", "monthly"): "stripe_price_insight_starter_monthly",
    ("insight_starter", "annual"):  "stripe_price_insight_starter_annual",
    ("strategic_intelligence", "monthly"): "stripe_price_strategic_intelligence_monthly",
    ("strategic_intelligence", "annual"):  "stripe_price_strategic_intelligence_annual",
}


def _stripe_client():
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Payment system not configured. Contact support.")
    # stripe.StripeClient is the constructor in SDK v5–v11; v12+ also accepts stripe.Stripe
    cls = getattr(stripe, "StripeClient", None) or getattr(stripe, "Stripe", None)
    if cls is None:
        raise HTTPException(status_code=503, detail="Stripe SDK version not supported.")
    return cls(settings.stripe_secret_key)


def _get_price_id(plan_key: str, billing_period: str) -> str:
    settings = get_settings()
    attr = _PRICE_ATTR.get((plan_key, billing_period))
    if not attr:
        raise HTTPException(status_code=400, detail="Invalid plan or billing period.")
    price_id = getattr(settings, attr, None)
    if not price_id or not str(price_id).startswith("price_"):
        raise HTTPException(
            status_code=503,
            detail=f"Payment not yet configured for this plan. Please use Bank Transfer or contact support.",
        )
    return price_id


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


# ── Subscription credit provisioning (idempotent) ────────────────────────────
# Credits for a new subscription can be granted from two places: the eager
# /activate-subscription call made by the success page, and the Stripe webhook
# (checkout.session.completed). Whichever arrives first grants; the other is a
# no-op. Each grant is tagged with the Stripe subscription id in the ledger
# description so the check survives restarts, and the per-subscription lock
# closes the race when both arrive at the same moment (single uvicorn worker).

_credit_locks: dict[str, asyncio.Lock] = {}


def _subscription_credit_reason(plan_key: str, subscription_id: str) -> str:
    return f"{plan_key} subscription credit allocation [{subscription_id}]"


async def _provision_subscription_credits_once(user_id: str, plan_key: str, subscription_id: str | None) -> bool:
    """Grant the plan's credits for this Stripe subscription exactly once.
    Returns True if credits were granted by this call."""
    if not subscription_id:
        # Nothing to key idempotency on — fall back to a plain grant.
        await provision_plan_credits(user_id, plan_key, reason=f"{plan_key} subscription credit allocation")
        return True

    lock = _credit_locks.setdefault(subscription_id, asyncio.Lock())
    async with lock:
        reason = _subscription_credit_reason(plan_key, subscription_id)
        existing = await sb_select(
            "credit_transactions",
            filters=[("user_id", "eq", user_id), ("description", "eq", reason)],
            columns="id",
            limit=1,
        )
        if existing:
            return False
        await provision_plan_credits(user_id, plan_key, reason=reason)
        return True


def _cancel_superseded_subscription(previous: dict | None, new_subscription_id: str | None) -> None:
    """When a user changes plan, Checkout creates a brand-new Stripe
    subscription. Cancel the one it replaces so they aren't billed for both.
    prorate=True credits the unused time to the customer's balance, which
    Stripe applies to the new subscription's next invoice (same customer)."""
    old_id = (previous or {}).get("stripe_subscription_id")
    if not old_id or not new_subscription_id or old_id == new_subscription_id:
        return
    try:
        _stripe_client().subscriptions.cancel(old_id, {"prorate": True})
        logger.info("Cancelled superseded subscription %s (replaced by %s)", old_id, new_subscription_id)
    except Exception as e:
        # Already cancelled, or Stripe unreachable — log for manual follow-up.
        logger.error("Failed to cancel superseded subscription %s: %s", old_id, e)


# ── Add-on catalogue ─────────────────────────────────────────────────────────

ADDONS = [
    # Featured listing boosts — recurring monthly
    {"key": "addon_featured_1",  "label": "Extra Featured Listing",        "price": 15,  "currency": "gbp", "mode": "subscription", "desc": "1 featured listing slot added to your plan, billed monthly.",       "price_attr": "stripe_price_addon_featured_1"},
    {"key": "addon_featured_5",  "label": "5 Featured Listing Boosts",     "price": 49,  "currency": "gbp", "mode": "subscription", "desc": "5 featured listing boosts per month, billed monthly.",              "price_attr": "stripe_price_addon_featured_5"},
    {"key": "addon_featured_20", "label": "20 Featured Listing Boosts",    "price": 149, "currency": "gbp", "mode": "subscription", "desc": "20 featured listing boosts per month, billed monthly.",             "price_attr": "stripe_price_addon_featured_20"},
    # RFQ credit packs — one-time
    {"key": "addon_rfq_20",      "label": "RFQ Credits — 20",              "price": 10,  "currency": "gbp", "mode": "payment",      "desc": "20 RFQ response credits. Use to respond to buyer requests.",      "price_attr": "stripe_price_addon_rfq_20"},
    {"key": "addon_rfq_50",      "label": "RFQ Credits — 50",              "price": 20,  "currency": "gbp", "mode": "payment",      "desc": "50 RFQ response credits. Best value for active suppliers.",       "price_attr": "stripe_price_addon_rfq_50"},
    {"key": "addon_rfq_100",     "label": "RFQ Credits — 100",             "price": 35,  "currency": "gbp", "mode": "payment",      "desc": "100 RFQ response credits. Maximum pack for high-volume sellers.", "price_attr": "stripe_price_addon_rfq_100"},
]

_ADDON_BY_KEY = {a["key"]: a for a in ADDONS}


@router.get("/addons")
async def list_addons():
    """Return available marketplace add-ons."""
    return ADDONS


@router.post("/addons/checkout")
async def addon_checkout(
    payload: dict,
    user=Depends(get_current_user),
):
    """Create a Stripe Checkout session for a marketplace add-on."""
    addon_key = payload.get("addon_key")
    addon = _ADDON_BY_KEY.get(addon_key)
    if not addon:
        raise HTTPException(status_code=400, detail="Unknown add-on.")

    client = _stripe_client()
    settings = get_settings()
    price_id = getattr(settings, addon["price_attr"], None)
    if not price_id or not price_id.startswith("price_"):
        raise HTTPException(status_code=503, detail=f"Add-on '{addon['label']}' is not yet available for purchase.")

    base = _frontend_url()
    session_params: dict = {
        "mode": addon["mode"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "metadata": {
            "user_id": user["id"],
            "addon_key": addon_key,
        },
        "success_url": f"{base}/pricing/success?addon={addon_key}&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/pricing",
    }
    current = await sb_select("user_subscriptions", filters=[("user_id", "eq", user["id"])], single=True) or {}
    if current.get("stripe_customer_id"):
        session_params["customer"] = current["stripe_customer_id"]
    else:
        session_params["customer_email"] = user["email"]
    session = client.checkout.sessions.create(session_params)
    return {"checkout_url": session.url}


def _obj_get(obj, key: str, default=None):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _period_iso(stripe_sub) -> tuple[str | None, str | None]:
    """Subscription period as ISO strings. Newer Stripe API versions moved the
    period onto the subscription items, so fall back to the first item."""
    ps = _obj_get(stripe_sub, "current_period_start")
    pe = _obj_get(stripe_sub, "current_period_end")
    if not (ps and pe):
        items = _obj_get(_obj_get(stripe_sub, "items"), "data") or []
        if items:
            ps = ps or _obj_get(items[0], "current_period_start")
            pe = pe or _obj_get(items[0], "current_period_end")

    def to_iso(t):
        return datetime.fromtimestamp(t, tz=timezone.utc).isoformat() if t else None

    return to_iso(ps), to_iso(pe)


async def _fulfil_addon_session(session) -> dict:
    """Deliver a paid add-on Checkout session. Safe to call more than once."""
    meta = _obj_get(session, "metadata") or {}
    user_id = meta.get("user_id")
    addon_key = meta.get("addon_key")
    session_id = _obj_get(session, "id")
    if not (user_id and addon_key and session_id):
        raise ValueError("Add-on session missing metadata")
    if _obj_get(session, "payment_status") not in ("paid", "no_payment_required"):
        raise HTTPException(status_code=402, detail="Payment for this add-on has not completed yet.")

    sub_id = _obj_get(session, "subscription")
    if sub_id and not isinstance(sub_id, str):
        sub_id = _obj_get(sub_id, "id")
    period_start = period_end = None
    if sub_id:
        try:
            period_start, period_end = _period_iso(_stripe_client().subscriptions.retrieve(sub_id))
        except Exception as e:
            logger.error("Add-on %s: could not read subscription period: %s", sub_id, e)
    return await addon_svc.fulfil_addon(
        user_id=user_id,
        addon_key=addon_key,
        session_id=session_id,
        subscription_id=sub_id,
        period_start=period_start,
        period_end=period_end,
    )


@router.post("/addons/activate")
async def activate_addon(payload: dict, user=Depends(get_current_user)):
    """Called by the success page right after an add-on Checkout, so the
    purchase is delivered even if the webhook is slow. Idempotent."""
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required.")
    try:
        session = _stripe_client().checkout.sessions.retrieve(session_id)
    except Exception as e:
        logger.error("activate_addon: retrieve session failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not verify checkout session with Stripe.")
    meta = _obj_get(session, "metadata") or {}
    if str(meta.get("user_id") or "") != str(user["id"]):
        raise HTTPException(status_code=403, detail="This payment belongs to a different account.")
    if not meta.get("addon_key"):
        raise HTTPException(status_code=400, detail="Not an add-on purchase.")
    result = await _fulfil_addon_session(session)
    return {"activated": True, "addon_key": meta["addon_key"], "already_fulfilled": bool(result.get("already_fulfilled"))}


# ── Public: subscribe interest capture ───────────────────────────────────────

@router.post("/waitlist", response_model=SubscribeResponse)
async def subscribe_interest(payload: SubscribeRequest) -> SubscribeResponse:
    """Capture subscription interest (used when Stripe is not yet configured)."""
    existing = await sb_select(
        "plan_waitlist",
        filters=[("email", "eq", payload.email), ("plan_key", "eq", payload.plan_key)],
        single=True,
    )
    if not existing:
        await sb_insert(
            "plan_waitlist",
            {
                "email": payload.email,
                "plan_key": payload.plan_key,
                "billing_period": payload.billing_period,
                "joined_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    return SubscribeResponse()


# ── Authenticated: embedded card payment (Stripe Elements) ───────────────────

@router.post("/create-subscription")
async def create_subscription(
    payload: CheckoutRequest,
    user=Depends(get_current_user),
):
    """Create a Stripe Subscription and return a PaymentIntent client_secret
    for confirmation via Stripe Elements on the frontend."""
    client = _stripe_client()
    price_id = _get_price_id(payload.plan_key, payload.billing_period)

    # Reuse existing Stripe customer if we have one
    existing = await sb_select(
        "user_subscriptions",
        filters=[("user_id", "eq", user["id"])],
        single=True,
    )
    customer_id: str | None = (existing or {}).get("stripe_customer_id")

    if not customer_id:
        customer = client.customers.create({
            "email": user["email"],
            "metadata": {"user_id": str(user["id"])},
        })
        customer_id = customer.id

    sub_params: dict = {
        "customer": customer_id,
        "items": [{"price": price_id}],
        "payment_behavior": "default_incomplete",
        "expand": ["latest_invoice.payment_intent"],
        "metadata": {
            "user_id": str(user["id"]),
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
    }
    if payload.promo_code:
        try:
            codes = client.promotion_codes.list({"code": payload.promo_code, "active": True, "limit": 1})
            if not codes.data:
                raise HTTPException(status_code=400, detail="Invalid or expired promo code.")
            sub_params["promotion_code"] = codes.data[0].id
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Promo code lookup failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not validate promo code. Please try again.")

    subscription = client.subscriptions.create(sub_params)

    pi = subscription.latest_invoice.payment_intent  # type: ignore[union-attr]
    invoice = subscription.latest_invoice  # type: ignore[union-attr]
    discount_pct: int | None = None
    discount_amt: int | None = None
    try:
        disc = getattr(invoice, "discount", None) or getattr(subscription, "discount", None)
        if disc:
            coupon = getattr(disc, "coupon", None)
            if coupon:
                discount_pct = getattr(coupon, "percent_off", None)
                discount_amt = getattr(coupon, "amount_off", None)
    except Exception:
        pass
    return {
        "client_secret": pi.client_secret,
        "subscription_id": subscription.id,
        "discount_pct": discount_pct,
        "discount_amt": discount_amt,
    }


# ── Authenticated: eagerly activate subscription after payment ───────────────

@router.post("/activate-subscription")
async def activate_subscription(
    payload: dict,
    user=Depends(get_current_user),
):
    """Called by the frontend right after confirmCardPayment or on the Stripe
    Checkout success page.  Reads the subscription/session from Stripe and
    immediately writes the active row to Supabase so the user doesn't have to
    wait for the webhook."""
    client = _stripe_client()
    subscription_id: str | None = payload.get("subscription_id")
    session_id: str | None = payload.get("session_id")

    stripe_sub = None
    plan_key: str | None = None
    billing_period: str = "monthly"
    customer_id: str | None = None
    owner_id: str | None = None

    if subscription_id:
        try:
            stripe_sub = client.subscriptions.retrieve(subscription_id)
            meta = getattr(stripe_sub, "metadata", {}) or {}
            plan_key = meta.get("plan_key")
            billing_period = meta.get("billing_period", "monthly")
            customer_id = getattr(stripe_sub, "customer", None)
            owner_id = meta.get("user_id")
        except Exception as e:
            logger.error("activate_subscription: retrieve sub failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not verify subscription with Stripe.")

    elif session_id:
        try:
            session = client.checkout.sessions.retrieve(session_id)
            meta = getattr(session, "metadata", {}) or {}
            plan_key = meta.get("plan_key")
            billing_period = meta.get("billing_period", "monthly")
            customer_id = getattr(session, "customer", None)
            owner_id = meta.get("user_id")
            sub_id = getattr(session, "subscription", None)
            if sub_id:
                stripe_sub = client.subscriptions.retrieve(sub_id)
                subscription_id = sub_id
        except Exception as e:
            logger.error("activate_subscription: retrieve session failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not verify checkout session with Stripe.")
    else:
        raise HTTPException(status_code=400, detail="subscription_id or session_id required.")

    if not stripe_sub:
        raise HTTPException(status_code=400, detail="Subscription not found.")

    # The session/subscription must have been created for this user.
    if str(owner_id or "") != str(user["id"]):
        raise HTTPException(status_code=403, detail="This payment belongs to a different account.")

    # Stripe's subscription can briefly still read "incomplete" right after the
    # payment succeeds; retry a few times before treating it as not active.
    for attempt in range(3):
        if getattr(stripe_sub, "status", None) in ("active", "trialing"):
            break
        await asyncio.sleep(0.75 * (attempt + 1))
        try:
            stripe_sub = client.subscriptions.retrieve(subscription_id)
        except Exception as e:
            logger.error("activate_subscription: re-retrieve sub failed: %s", e)
            break

    sub_status = getattr(stripe_sub, "status", None)
    if sub_status not in ("active", "trialing"):
        raise HTTPException(status_code=402, detail=f"Subscription not yet active (status: {sub_status}).")

    if not plan_key:
        raise HTTPException(status_code=400, detail="Plan key missing from subscription metadata.")

    now = datetime.now(timezone.utc)
    ps = getattr(stripe_sub, "current_period_start", None)
    pe = getattr(stripe_sub, "current_period_end", None)
    period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat() if ps else now.isoformat()
    period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat() if pe else (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()

    previous = await sb_select("user_subscriptions", filters=[("user_id", "eq", user["id"])], single=True)
    await sb_upsert(
        "user_subscriptions",
        payload={
            "user_id": user["id"],
            "plan_key": plan_key,
            "billing_period": billing_period,
            "status": "active",
            "stripe_subscription_id": subscription_id,
            "stripe_customer_id": customer_id,
            "current_period_start": period_start,
            "current_period_end": period_end,
            "updated_at": now.isoformat(),
        },
        on_conflict="user_id",
    )
    _cancel_superseded_subscription(previous, subscription_id)

    # Grant the plan's credits here too, so a paying user is credited even if
    # the Stripe webhook is slow or not configured. Idempotent with the webhook.
    credits_granted = False
    try:
        credits_granted = await _provision_subscription_credits_once(user["id"], plan_key, subscription_id)
        if credits_granted:
            logger.info("Provisioned credits for user %s plan %s on activate-subscription", user["id"], plan_key)
    except Exception as e:
        logger.error("Failed to provision credits on activate-subscription for user %s: %s", user["id"], e)

    return {
        "activated": True,
        "plan_key": plan_key,
        "billing_period": billing_period,
        "period_end": period_end,
        "credits_granted": credits_granted,
    }


# ── Authenticated: Stripe checkout ───────────────────────────────────────────

@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    payload: CheckoutRequest,
    user=Depends(get_current_user),
) -> CheckoutResponse:
    client = _stripe_client()
    price_id = _get_price_id(payload.plan_key, payload.billing_period)
    base = _frontend_url()

    current = await sb_select("user_subscriptions", filters=[("user_id", "eq", user["id"])], single=True) or {}
    if (
        current.get("status") == "active"
        and current.get("stripe_subscription_id")
        and current.get("plan_key") == payload.plan_key
        and current.get("billing_period") == payload.billing_period
    ):
        raise HTTPException(status_code=409, detail="You're already on this plan.")

    session_params: dict = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "metadata": {
            "user_id": user["id"],
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
        "success_url": f"{base}/pricing/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/pricing",
        "allow_promotion_codes": True,
    }
    # Reuse the Stripe customer on plan changes so the proration credit from
    # the cancelled old subscription lands on the same customer balance.
    if current.get("stripe_customer_id"):
        session_params["customer"] = current["stripe_customer_id"]
    else:
        session_params["customer_email"] = user["email"]
    if payload.promo_code:
        try:
            codes = client.promotion_codes.list({"code": payload.promo_code, "active": True, "limit": 1})
            if not codes.data:
                raise HTTPException(status_code=400, detail="Invalid or expired promo code.")
            session_params["discounts"] = [{"promotion_code": codes.data[0].id}]
            session_params.pop("allow_promotion_codes", None)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Promo code lookup failed: %s", e)
            raise HTTPException(status_code=400, detail="Could not validate promo code. Please try again.")

    session = client.checkout.sessions.create(session_params)
    return CheckoutResponse(checkout_url=session.url)


# ── Referral reward helper ────────────────────────────────────────────────────

async def _create_referral_reward(
    *,
    referred_user_id: str,
    subtotal_minor: int,
    discount_minor: int,
    idempotency_key: str,
    stripe_invoice_id: str | None,
    stripe_subscription_id: str | None,
) -> None:
    """Look up referral attribution for the referred user and create a pending reward if eligible."""
    attribution = await ref_svc.get_attribution_for_referred(referred_user_id)
    if not attribution:
        return

    referrer_id = attribution["referrer_user_id"]
    # Verify referrer is still an active participant
    participant_row = await sb_select(
        "referral_participants",
        filters=[("user_id", "eq", referrer_id), ("status", "eq", "active")],
        single=True,
    )
    if not participant_row:
        return

    config = await ref_svc.get_active_config()
    if not config.get("recurring") and stripe_invoice_id and not idempotency_key.startswith("checkout_"):
        # Recurring disabled — only credit first payment (checkout events)
        return

    eligible_base = max(0, subtotal_minor - discount_minor)
    if eligible_base <= 0:
        return

    effective_rate = (
        participant_row.get("custom_rate_bps")
        if participant_row.get("custom_rate_bps") is not None
        else config["rate_bps"]
    )
    commission = ref_svc.calculate_commission(eligible_base, effective_rate)
    if commission <= 0:
        return

    await ref_svc.create_pending_reward(
        referrer_user_id=referrer_id,
        attribution_id=attribution["id"],
        amount_minor=commission,
        idempotency_key=idempotency_key,
        config_version_id=config.get("id"),
        calc_snapshot={
            "eligible_base_minor": eligible_base,
            "subtotal_minor": subtotal_minor,
            "discount_minor": discount_minor,
            "rate_bps": effective_rate,
            "custom_rate": participant_row.get("custom_rate_bps") is not None,
            "commission_minor": commission,
            "referred_user_id": referred_user_id,
        },
        stripe_invoice_id=stripe_invoice_id,
        stripe_subscription_id=stripe_subscription_id,
        hold_days=config["hold_days"],
    )
    logger.info(
        "Referral reward %d pence created for referrer %s (referred: %s, key: %s)",
        commission, referrer_id, referred_user_id, idempotency_key,
    )


# ── Stripe webhook ────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request):
    settings = get_settings()
    payload_bytes = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # Never accept unsigned events: an unsigned checkout.session.completed would
    # let anyone grant themselves a paid plan and credits. For local testing,
    # `stripe listen --forward-to .../plans/webhook` prints a whsec_ secret.
    if not settings.stripe_webhook_secret:
        logger.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set — rejecting.")
        raise HTTPException(status_code=503, detail="Webhook not configured")
    try:
        event = stripe.Webhook.construct_event(
            payload_bytes, sig_header, settings.stripe_webhook_secret
        )
    except (stripe.SignatureVerificationError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    etype = event.get("type") if isinstance(event, dict) else event.type

    if etype == "checkout.session.completed":
        session = event["data"]["object"] if isinstance(event, dict) else event.data.object
        meta = session.get("metadata", {}) if isinstance(session, dict) else session.metadata
        user_id = meta.get("user_id")
        plan_key = meta.get("plan_key")
        billing_period = meta.get("billing_period", "monthly")

        if user_id and meta.get("addon_key"):
            try:
                await _fulfil_addon_session(session)
                logger.info("Fulfilled add-on %s for user %s", meta.get("addon_key"), user_id)
            except Exception as e:
                logger.error("Failed to fulfil add-on %s for user %s: %s", meta.get("addon_key"), user_id, e)

        elif user_id and plan_key:
            sub_id = session.get("subscription") if isinstance(session, dict) else session.subscription
            customer_id = session.get("customer") if isinstance(session, dict) else session.customer
            now = datetime.now(timezone.utc)
            period_start: str = now.isoformat()
            period_end: str = (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()
            # Prefer Stripe's actual billing period from the subscription object
            if sub_id:
                try:
                    stripe_client = _stripe_client()
                    stripe_sub = stripe_client.subscriptions.retrieve(sub_id)
                    ps = getattr(stripe_sub, "current_period_start", None)
                    pe = getattr(stripe_sub, "current_period_end", None)
                    if ps:
                        period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat()
                    if pe:
                        period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat()
                except Exception:
                    pass
            previous = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": user_id,
                    "plan_key": plan_key,
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": period_start,
                    "current_period_end": period_end,
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )
            _cancel_superseded_subscription(previous, sub_id)
            # Issue initial credits for new subscription
            try:
                if await _provision_subscription_credits_once(user_id, plan_key, sub_id):
                    logger.info("Provisioned credits for user %s plan %s on checkout", user_id, plan_key)
            except Exception as e:
                logger.error("Failed to provision credits on checkout for user %s: %s", user_id, e)

            # Create referral reward for initial subscription payment
            try:
                amount_subtotal = session.get("amount_subtotal", 0) if isinstance(session, dict) else getattr(session, "amount_subtotal", 0) or 0
                total_details = session.get("total_details", {}) if isinstance(session, dict) else getattr(session, "total_details", {}) or {}
                amount_discount = total_details.get("amount_discount", 0) if isinstance(total_details, dict) else getattr(total_details, "amount_discount", 0) or 0
                stripe_invoice_id = session.get("invoice") if isinstance(session, dict) else getattr(session, "invoice", None)
                stripe_sub_id = session.get("subscription") if isinstance(session, dict) else getattr(session, "subscription", None)
                await _create_referral_reward(
                    referred_user_id=user_id,
                    subtotal_minor=amount_subtotal or 0,
                    discount_minor=amount_discount or 0,
                    idempotency_key=f"checkout_{session.get('id') if isinstance(session, dict) else session.id}",
                    stripe_invoice_id=str(stripe_invoice_id) if stripe_invoice_id else None,
                    stripe_subscription_id=str(stripe_sub_id) if stripe_sub_id else None,
                )
            except Exception as e:
                logger.error("Failed to create referral reward on checkout for user %s: %s", user_id, e)

    elif etype == "invoice.paid":
        # Monthly renewal — reset credits
        invoice = event["data"]["object"] if isinstance(event, dict) else event.data.object
        customer_id = invoice.get("customer") if isinstance(invoice, dict) else getattr(invoice, "customer", None)
        billing_reason = invoice.get("billing_reason") if isinstance(invoice, dict) else getattr(invoice, "billing_reason", None)
        # Only reset on renewal invoices, not the initial subscription invoice (that's handled in checkout.session.completed)
        inv_sub_id = _obj_get(invoice, "subscription") or _obj_get(
            _obj_get(_obj_get(invoice, "parent"), "subscription_details"), "subscription"
        )
        if billing_reason == "subscription_cycle" and inv_sub_id and await addon_svc.is_addon_subscription(inv_sub_id):
            # Recurring add-on renewed: open a new period (resets boost allowance).
            try:
                period_start, period_end = _period_iso(_stripe_client().subscriptions.retrieve(inv_sub_id))
                await addon_svc.renew_addon_subscription(inv_sub_id, period_start, period_end)
                logger.info("Renewed add-on subscription %s", inv_sub_id)
            except Exception as e:
                logger.error("Failed to renew add-on subscription %s: %s", inv_sub_id, e)
        elif billing_reason == "subscription_cycle" and customer_id:
            sub_row = await sb_select("user_subscriptions", filters=[("stripe_customer_id", "eq", customer_id)], single=True)
            # Only the plan subscription's own renewal resets plan credits.
            if inv_sub_id and sub_row and sub_row.get("stripe_subscription_id") and sub_row["stripe_subscription_id"] != inv_sub_id:
                sub_row = None
            if sub_row and sub_row.get("user_id") and sub_row.get("plan_key"):
                user_id = sub_row["user_id"]
                plan_key = sub_row["plan_key"]
                try:
                    await reset_monthly_credits(user_id, plan_key)
                    logger.info("Reset monthly credits for user %s plan %s on invoice.paid", user_id, plan_key)
                except Exception as e:
                    logger.error("Failed to reset monthly credits for user %s: %s", user_id, e)

                # Create referral reward for recurring subscription renewal
                try:
                    invoice_id = invoice.get("id") if isinstance(invoice, dict) else getattr(invoice, "id", None)
                    sub_id_inv = invoice.get("subscription") if isinstance(invoice, dict) else getattr(invoice, "subscription", None)
                    inv_subtotal = invoice.get("subtotal", 0) if isinstance(invoice, dict) else getattr(invoice, "subtotal", 0) or 0
                    inv_tax = invoice.get("tax", 0) if isinstance(invoice, dict) else getattr(invoice, "tax", 0) or 0
                    eligible_base = max(0, (inv_subtotal or 0) - (inv_tax or 0))
                    await _create_referral_reward(
                        referred_user_id=user_id,
                        subtotal_minor=eligible_base,
                        discount_minor=0,
                        idempotency_key=f"invoice_{invoice_id}",
                        stripe_invoice_id=str(invoice_id) if invoice_id else None,
                        stripe_subscription_id=str(sub_id_inv) if sub_id_inv else None,
                    )
                except Exception as e:
                    logger.error("Failed to create referral reward on invoice.paid for user %s: %s", user_id, e)

    elif etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        sub_obj = event["data"]["object"] if isinstance(event, dict) else event.data.object
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else sub_obj.id
        new_status = sub_obj.get("status") if isinstance(sub_obj, dict) else sub_obj.status
        cancel_at = sub_obj.get("canceled_at") if isinstance(sub_obj, dict) else getattr(sub_obj, "canceled_at", None)
        customer_id = sub_obj.get("customer") if isinstance(sub_obj, dict) else getattr(sub_obj, "customer", None)
        meta = sub_obj.get("metadata", {}) if isinstance(sub_obj, dict) else getattr(sub_obj, "metadata", {})

        if await addon_svc.is_addon_subscription(sub_id):
            if etype == "customer.subscription.deleted" or new_status in ("canceled", "unpaid", "incomplete_expired"):
                await addon_svc.cancel_addon_subscription(sub_id)
            return {"received": True}

        rows = await sb_select(
            "user_subscriptions",
            filters=[("stripe_subscription_id", "eq", sub_id)],
            single=True,
        )
        from app.core.supabase import sb_update
        if rows:
            updates: dict = {
                "status": "cancelled" if (new_status == "canceled" or cancel_at) else new_status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if cancel_at:
                updates["cancelled_at"] = datetime.fromtimestamp(cancel_at, tz=timezone.utc).isoformat()
            # Sync billing period on renewal / update
            ps = sub_obj.get("current_period_start") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_start", None)
            pe = sub_obj.get("current_period_end") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_end", None)
            if ps:
                updates["current_period_start"] = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat()
            if pe:
                updates["current_period_end"] = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat()
            await sb_update(
                "user_subscriptions",
                payload=updates,
                filters=[("stripe_subscription_id", "eq", sub_id)],
            )
        elif new_status == "active" and meta.get("user_id") and not (
            (await sb_select("user_subscriptions", filters=[("user_id", "eq", meta["user_id"])], single=True) or {}).get("stripe_subscription_id")
        ):
            # Subscription activated before any row was written (e.g. legacy
            # embedded card flow). Skip if the user already has a subscription
            # row — otherwise an event for an old, superseded subscription
            # would overwrite their current plan.
            billing_period = meta.get("billing_period", "monthly")
            now = datetime.now(timezone.utc)
            # Use Stripe's actual billing period timestamps from the subscription event object
            ps = sub_obj.get("current_period_start") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_start", None)
            pe = sub_obj.get("current_period_end") if isinstance(sub_obj, dict) else getattr(sub_obj, "current_period_end", None)
            period_start = datetime.fromtimestamp(ps, tz=timezone.utc).isoformat() if ps else now.isoformat()
            period_end = datetime.fromtimestamp(pe, tz=timezone.utc).isoformat() if pe else (now + timedelta(days=30 if billing_period == "monthly" else 365)).isoformat()
            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": meta["user_id"],
                    "plan_key": meta.get("plan_key"),
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": period_start,
                    "current_period_end": period_end,
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )

    return {"received": True}


# ── Authenticated: get current subscription ───────────────────────────────────

@router.get("/my", response_model=SubscriptionOut)
async def get_my_subscription(user=Depends(get_current_user)) -> SubscriptionOut:
    return await resolve_subscription(user["id"])
