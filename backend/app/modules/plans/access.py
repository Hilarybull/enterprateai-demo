from __future__ import annotations

from datetime import datetime, timezone

from app.core.supabase import sb_select
from app.modules.credits.service import _plan_rank
from app.modules.plans.schemas import SubscriptionOut

# Users created before this date are grandfathered — no plan-based access restrictions.
GRANDFATHERED_BEFORE = datetime(2026, 5, 7, 0, 0, 0, tzinfo=timezone.utc)


async def resolve_subscription(user_id: str) -> SubscriptionOut:
    """The user's effective plan: an active/trial subscription row, else
    grandfathered (early accounts), else the permanent free Explorer plan."""
    try:
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    except Exception:
        sub = None

    if sub and sub.get("status") in ("active", "trial"):
        return SubscriptionOut(
            plan_key=sub["plan_key"],
            billing_period=sub.get("billing_period") or "monthly",
            status=sub["status"],
            current_period_start=sub.get("current_period_start"),
            current_period_end=sub.get("current_period_end"),
            trial_started_at=sub.get("trial_started_at"),
            stripe_subscription_id=sub.get("stripe_subscription_id"),
        )

    # No active paid subscription → check user creation date
    user_row = await sb_select("users", filters=[("id", "eq", user_id)], single=True)
    created_at_str = (user_row or {}).get("created_at")
    if created_at_str:
        try:
            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            if created_at < GRANDFATHERED_BEFORE:
                return SubscriptionOut(
                    plan_key="free_trial",
                    billing_period="monthly",
                    status="grandfathered",
                    trial_started_at=created_at_str,
                )
        except Exception:
            pass

    return SubscriptionOut(plan_key="explorer", billing_period="monthly", status="active")


async def has_paid_access(user_id: str) -> bool:
    """True for grandfathered accounts and any active plan above Explorer.
    Mirrors hasPaidAccess() in frontend/src/lib/plans.js."""
    sub = await resolve_subscription(user_id)
    if sub.status == "grandfathered":
        return True
    if sub.status != "active":
        return False
    return _plan_rank(sub.plan_key) >= _plan_rank("starter_insight")


async def _has_module_grant(user_id: str, module_key: str) -> bool:
    try:
        rows = await sb_select(
            "user_platform_grants",
            filters=[("user_id", "eq", user_id), ("module_key", "eq", module_key)],
            columns="id,feature_key",
        )
        return any(not r.get("feature_key") for r in (rows or []))
    except Exception:
        return False


async def plan_meets(user_id: str, minimum_plan: str, *, grant_module: str | None = None) -> bool:
    """True if the user's effective plan is at least `minimum_plan`.
    Grandfathered accounts and admin module grants always qualify."""
    if grant_module and await _has_module_grant(user_id, grant_module):
        return True
    sub = await resolve_subscription(user_id)
    if sub.status == "grandfathered":
        return True
    if sub.status != "active":
        return False
    return _plan_rank(sub.plan_key) >= _plan_rank(minimum_plan)


async def effective_plan_key(user_id: str) -> str:
    """Normalised plan key; grandfathered accounts count as the top plan."""
    from app.modules.credits.service import normalise_plan_key
    sub = await resolve_subscription(user_id)
    if sub.status == "grandfathered":
        return "strategic_business_os"
    if sub.status != "active":
        return "explorer"
    return normalise_plan_key(sub.plan_key)
