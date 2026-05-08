from __future__ import annotations

import json
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plans", tags=["plans"])

TRIAL_DAYS = 14

# Users created before this date are grandfathered — no plan-based access restrictions.
GRANDFATHERED_BEFORE = datetime(2026, 5, 7, 0, 0, 0, tzinfo=timezone.utc)

# Maps (plan_key, billing_period) → settings attribute name
_PRICE_ATTR = {
    ("insight_starter", "monthly"): "stripe_price_insight_starter_monthly",
    ("insight_starter", "annual"):  "stripe_price_insight_starter_annual",
    ("decision_engine", "monthly"): "stripe_price_decision_engine_monthly",
    ("decision_engine", "annual"):  "stripe_price_decision_engine_annual",
    ("strategic_intelligence", "monthly"): "stripe_price_strategic_intelligence_monthly",
    ("strategic_intelligence", "annual"):  "stripe_price_strategic_intelligence_annual",
}


def _stripe_client() -> stripe.Stripe:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Payment system not configured. Contact support.")
    return stripe.Stripe(settings.stripe_secret_key)


def _get_price_id(plan_key: str, billing_period: str) -> str:
    settings = get_settings()
    attr = _PRICE_ATTR.get((plan_key, billing_period))
    if not attr:
        raise HTTPException(status_code=400, detail="Invalid plan or billing period.")
    price_id = getattr(settings, attr, None)
    if not price_id:
        raise HTTPException(status_code=503, detail=f"Price not configured for {plan_key} ({billing_period}).")
    return price_id


def _frontend_url() -> str:
    settings = get_settings()
    url = settings.frontend_url
    if isinstance(url, list):
        url = url[0]
    return str(url).rstrip("/")


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
        customer = client.customers.create(
            email=user["email"],
            metadata={"user_id": str(user["id"])},
        )
        customer_id = customer.id

    subscription = client.subscriptions.create(
        customer=customer_id,
        items=[{"price": price_id}],
        payment_behavior="default_incomplete",
        expand=["latest_invoice.payment_intent"],
        metadata={
            "user_id": str(user["id"]),
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
    )

    pi = subscription.latest_invoice.payment_intent  # type: ignore[union-attr]
    return {
        "client_secret": pi.client_secret,
        "subscription_id": subscription.id,
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

    session = client.checkout.sessions.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        customer_email=user["email"],
        metadata={
            "user_id": user["id"],
            "plan_key": payload.plan_key,
            "billing_period": payload.billing_period,
        },
        success_url=f"{base}/pricing/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base}/pricing",
    )
    return CheckoutResponse(checkout_url=session.url)


# ── Stripe webhook ────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request):
    settings = get_settings()
    payload_bytes = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if settings.stripe_webhook_secret:
        client = _stripe_client()
        try:
            event = client.webhooks.construct_event(
                payload_bytes, sig_header, settings.stripe_webhook_secret
            )
        except stripe.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        # Dev mode: accept unsigned events
        event = json.loads(payload_bytes)

    etype = event.get("type") if isinstance(event, dict) else event.type

    if etype == "checkout.session.completed":
        session = event["data"]["object"] if isinstance(event, dict) else event.data.object
        meta = session.get("metadata", {}) if isinstance(session, dict) else session.metadata
        user_id = meta.get("user_id")
        plan_key = meta.get("plan_key")
        billing_period = meta.get("billing_period", "monthly")

        if user_id and plan_key:
            sub_id = session.get("subscription") if isinstance(session, dict) else session.subscription
            customer_id = session.get("customer") if isinstance(session, dict) else session.customer
            now = datetime.now(timezone.utc)
            end = now + timedelta(days=30 if billing_period == "monthly" else 365)
            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": user_id,
                    "plan_key": plan_key,
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": now.isoformat(),
                    "current_period_end": end.isoformat(),
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )

    elif etype in ("customer.subscription.deleted", "customer.subscription.updated"):
        sub_obj = event["data"]["object"] if isinstance(event, dict) else event.data.object
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else sub_obj.id
        new_status = sub_obj.get("status") if isinstance(sub_obj, dict) else sub_obj.status
        cancel_at = sub_obj.get("canceled_at") if isinstance(sub_obj, dict) else getattr(sub_obj, "canceled_at", None)
        customer_id = sub_obj.get("customer") if isinstance(sub_obj, dict) else getattr(sub_obj, "customer", None)
        meta = sub_obj.get("metadata", {}) if isinstance(sub_obj, dict) else getattr(sub_obj, "metadata", {})

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
            await sb_update(
                "user_subscriptions",
                payload=updates,
                filters=[("stripe_subscription_id", "eq", sub_id)],
            )
        elif new_status == "active" and meta.get("user_id"):
            # New subscription activated via embedded card form — upsert the row
            billing_period = meta.get("billing_period", "monthly")
            now = datetime.now(timezone.utc)
            end = now + timedelta(days=30 if billing_period == "monthly" else 365)
            await sb_upsert(
                "user_subscriptions",
                payload={
                    "user_id": meta["user_id"],
                    "plan_key": meta.get("plan_key"),
                    "billing_period": billing_period,
                    "status": "active",
                    "stripe_subscription_id": sub_id,
                    "stripe_customer_id": customer_id,
                    "current_period_start": now.isoformat(),
                    "current_period_end": end.isoformat(),
                    "updated_at": now.isoformat(),
                },
                on_conflict="user_id",
            )

    return {"received": True}


# ── Authenticated: get current subscription ───────────────────────────────────

@router.get("/my", response_model=SubscriptionOut)
async def get_my_subscription(user=Depends(get_current_user)) -> SubscriptionOut:
    try:
        sub = await sb_select(
            "user_subscriptions",
            filters=[("user_id", "eq", user["id"])],
            single=True,
        )
    except Exception:
        sub = None

    if sub and sub.get("status") in ("active", "trial"):
        return SubscriptionOut(
            plan_key=sub["plan_key"],
            billing_period=sub.get("billing_period", "monthly"),
            status=sub["status"],
            current_period_end=sub.get("current_period_end"),
            trial_started_at=sub.get("trial_started_at"),
            stripe_subscription_id=sub.get("stripe_subscription_id"),
        )

    # No active paid subscription → check user creation date
    user_row = await sb_select("users", filters=[("id", "eq", user["id"])], single=True)
    created_at_str = (user_row or {}).get("created_at")
    if created_at_str:
        try:
            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))

            # Grandfathered: signed up before restrictions were introduced
            if created_at < GRANDFATHERED_BEFORE:
                return SubscriptionOut(
                    plan_key="free_trial",
                    billing_period="monthly",
                    status="grandfathered",
                    trial_started_at=created_at_str,
                )

            # Still within trial window
            trial_end = created_at + timedelta(days=TRIAL_DAYS)
            if datetime.now(timezone.utc) < trial_end:
                return SubscriptionOut(
                    plan_key="free_trial",
                    billing_period="monthly",
                    status="trial",
                    trial_started_at=created_at_str,
                    current_period_end=trial_end.isoformat(),
                )
        except Exception:
            pass

    # Trial expired, no paid plan
    return SubscriptionOut(
        plan_key="free_trial",
        billing_period="monthly",
        status="expired",
    )
