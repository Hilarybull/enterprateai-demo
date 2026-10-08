from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.core.supabase import sb_select
from app.modules.credits.service import _plan_rank
from app.modules.plans.schemas import SubscriptionOut

# Users created before this date are grandfathered — no plan-based access restrictions.
GRANDFATHERED_BEFORE = datetime(2026, 5, 7, 0, 0, 0, tzinfo=timezone.utc)


# One page load asks for the same user's plan from several endpoints at once (the plan
# itself, the workspace, the agent summary, the credit balance). Lookups already in
# progress are shared; nothing is kept once a lookup finishes, so a change of plan is
# seen by the very next request.
_resolving: dict[str, "asyncio.Future[SubscriptionOut]"] = {}


async def resolve_subscription(user_id: str) -> SubscriptionOut:
    """The user's effective plan: an active/trial subscription row, else
    grandfathered (early accounts), else the permanent free Explorer plan."""
    pending = _resolving.get(user_id)
    if pending is None or pending.get_loop() is not asyncio.get_running_loop():
        pending = asyncio.ensure_future(_resolve_subscription(user_id))
        _resolving[user_id] = pending
        pending.add_done_callback(lambda done, uid=user_id: _resolving.pop(uid, None) if _resolving.get(uid) is done else None)
    return (await asyncio.shield(pending)).model_copy()


async def _resolve_subscription(user_id: str) -> SubscriptionOut:
    # Both lookups run together: the account row is only needed when there is no paid
    # subscription, but waiting to find that out would double the response time.
    sub, user_row = await asyncio.gather(
        sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True),
        sb_select("users", filters=[("id", "eq", user_id)], columns="id,created_at", single=True),
        return_exceptions=True,
    )
    if isinstance(sub, BaseException):
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
    if isinstance(user_row, BaseException):
        raise user_row
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
    if sub.status == "active" and _plan_rank(sub.plan_key) >= _plan_rank("starter_insight"):
        return True
    return is_full_access(await module_grants(user_id))      # an admin's full-access grant is paid access


# The modules "Grant Full Access" has always given. A user holding all of them has full access:
# the top plan wherever a plan is checked (Agent tasks, automatic drafts, RFQs, team size).
FULL_ACCESS_MODULES = ("dashboard", "validation", "blueprint", "simulation", "catalogue", "financials", "integrations", "registration")
# Access that isn't a page of its own, grantable one at a time: Agent tasks, and viewing and
# replying to Marketplace requests for a quotation. Full access includes both.
EXTRA_GRANTS = ("agent", "marketplace_rfq")
TOP_PLAN = "strategic_business_os"


async def module_grants(user_id: str) -> set[str]:
    """The whole-module grants an admin has given this user (feature-level grants don't count here)."""
    try:
        rows = await sb_select("user_platform_grants", filters=[("user_id", "eq", user_id)], columns="module_key,feature_key")
    except Exception:
        return set()
    return {str(r.get("module_key")) for r in rows or [] if not r.get("feature_key")}


def is_full_access(grants: set[str]) -> bool:
    return all(m in grants for m in FULL_ACCESS_MODULES)


async def has_grant(user_id: str, module_key: str) -> bool:
    """This grant, or full access (which includes every grant)."""
    grants = await module_grants(user_id)
    return module_key in grants or is_full_access(grants)


async def effective_access(user_id: str) -> dict:
    """What this user can actually use, and why: their subscription, then what admin grants add."""
    from app.modules.credits.service import normalise_plan_key
    sub = await resolve_subscription(user_id)
    grants = await module_grants(user_id)
    full = is_full_access(grants)
    subscribed = TOP_PLAN if sub.status == "grandfathered" else (normalise_plan_key(sub.plan_key) if sub.status == "active" else "explorer")
    plan = TOP_PLAN if full else subscribed
    paid = _plan_rank(plan) >= _plan_rank("starter_insight")
    return {
        "subscription_plan": normalise_plan_key(sub.plan_key), "subscription_status": sub.status,
        "effective_plan": plan, "full_access": full,
        "source": "admin full-access grant" if full and subscribed != TOP_PLAN else ("early-access account" if sub.status == "grandfathered" else "subscription"),
        "agent_tasks": paid or "agent" in grants,
        "marketplace_rfqs": paid or "marketplace_rfq" in grants,
        "grants": sorted(grants),
    }


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
    """Normalised plan key; grandfathered accounts and accounts with an admin full-access
    grant count as the top plan."""
    from app.modules.credits.service import normalise_plan_key
    sub = await resolve_subscription(user_id)
    if sub.status == "grandfathered":
        return TOP_PLAN
    plan = normalise_plan_key(sub.plan_key) if sub.status == "active" else "explorer"
    if plan != TOP_PLAN and is_full_access(await module_grants(user_id)):
        return TOP_PLAN
    return plan
