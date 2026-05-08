from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, EmailStr

VALID_PLAN_KEYS = Literal[
    "free_trial",
    "insight_starter",
    "decision_engine",
    "strategic_intelligence",
]

VALID_BILLING = Literal["monthly", "annual"]


class SubscribeRequest(BaseModel):
    email: EmailStr
    plan_key: VALID_PLAN_KEYS
    billing_period: Optional[VALID_BILLING] = "monthly"


class SubscribeResponse(BaseModel):
    status: str = "ok"
    message: str = "Subscription request received! We'll be in touch shortly."


class CheckoutRequest(BaseModel):
    plan_key: VALID_PLAN_KEYS
    billing_period: Optional[VALID_BILLING] = "monthly"


class CheckoutResponse(BaseModel):
    checkout_url: str


class SubscriptionOut(BaseModel):
    plan_key: str
    billing_period: str
    status: str
    current_period_end: Optional[str] = None
    trial_started_at: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
