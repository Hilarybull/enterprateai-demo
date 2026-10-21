"""Team plans (the pricing PDF, 19 Oct 2026): on Decision Engine the owner's plan covers the seats it includes. A member
works under the team's plan and draws on the team's pooled AI credits, within the monthly allowance the owner sets for
them. Explorer and Starter are one seat: the owner alone.

The member's own row (workspace_members) keeps their access (modules or features) and their credit allowance:
permissions["credits"] = {"monthly": int | None, "month": "YYYY-MM", "used": int}. None is no limit within the pool.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.supabase import sb_select, sb_update

TEAM_PLANS = ("decision_engine", "growth_navigator", "strategic_business_os")
ORDER = ("explorer", "starter_insight", "decision_engine", "growth_navigator", "strategic_business_os")
# The seats each plan includes, the owner counted (the pricing PDF): extra seats are bought on Decision Engine.
SEATS_INCLUDED = {"explorer": 1, "starter_insight": 1, "decision_engine": 3, "growth_navigator": 10, "strategic_business_os": 25}


def rank(plan: str | None) -> int:
    return ORDER.index(plan) if plan in ORDER else 0


def this_month(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def allowance_of(member: dict | None, now: datetime | None = None) -> dict:
    """{"monthly": N or None, "used": what this month has used}. A new month starts at 0."""
    c = ((member or {}).get("permissions") or {}).get("credits") or {}
    monthly = c.get("monthly")
    try:
        monthly = None if monthly in (None, "") else max(0, int(monthly))
    except (TypeError, ValueError):
        monthly = None
    used = int(c.get("used") or 0) if c.get("month") == this_month(now) else 0
    return {"monthly": monthly, "used": used, "left": None if monthly is None else max(0, monthly - used)}


async def team_of(user_id: str) -> dict | None:
    """The team plan this user works under as a member: the best Decision Engine (or higher) workspace they belong to.
    {"owner_id", "workspace_id", "plan", "member"}, or None."""
    from app.modules.plans.access import own_plan_key
    try:
        rows = await sb_select("workspace_members", filters=[("user_id", "eq", user_id)]) or []
    except Exception:      # noqa: BLE001 - no team known: the user's own plan stands
        return None
    best = None
    for m in rows:
        try:
            ws = await sb_select("workspaces", filters=[("id", "eq", m["workspace_id"])], columns="id,user_id", single=True)
        except Exception:      # noqa: BLE001
            ws = None
        owner = (ws or {}).get("user_id")
        if not owner or str(owner) == str(user_id):
            continue
        plan = await own_plan_key(owner)
        if plan in TEAM_PLANS and (best is None or rank(plan) > rank(best["plan"])):
            best = {"owner_id": owner, "workspace_id": m["workspace_id"], "plan": plan, "member": m}
    return best


async def payer_for(user_id: str) -> tuple[str, dict | None]:
    """Whose credits pay: a member under a team plan uses the team's pool (the owner's wallet); anyone else their own."""
    from app.modules.plans.access import own_plan_key
    team = await team_of(user_id)
    if team and rank(team["plan"]) > rank(await own_plan_key(user_id)):
        return team["owner_id"], team
    return user_id, None


async def record_use(team: dict | None, credits: int, now: datetime | None = None) -> None:
    """A member's charge, counted against their monthly allowance (a refund is a negative number)."""
    if not team or not credits:
        return
    m = team["member"]
    a = allowance_of(m, now)
    perms = dict(m.get("permissions") or {})
    perms["credits"] = {"monthly": a["monthly"], "month": this_month(now), "used": max(0, a["used"] + int(credits))}
    await sb_update("workspace_members", payload={"permissions": perms}, filters=[("id", "eq", m["id"])])


async def seats(owner_id: str) -> dict:
    """Seats on the owner's plan: included, extra bought, in use (the owner and members), free, and whether more can be bought."""
    from app.modules.addons.service import extra_seats
    from app.modules.plans.access import effective_plan_key
    plan = await effective_plan_key(owner_id)
    included = SEATS_INCLUDED.get(plan, 1)
    extra = await extra_seats(owner_id) if plan in TEAM_PLANS else 0
    used = 1
    try:
        ws = await sb_select("workspaces", filters=[("user_id", "eq", owner_id)], columns="id") or []
        ids = [w["id"] for w in ws]
        if ids:
            members = await sb_select("workspace_members", filters=[("workspace_id", "in", ids)], columns="user_id") or []
            used += len({str(m["user_id"]) for m in members if str(m["user_id"]) != str(owner_id)})
    except Exception:      # noqa: BLE001
        pass
    total = included + extra
    return {"plan": plan, "included": included, "extra": extra, "total": total, "used": used, "free": max(0, total - used),
            "can_invite": plan in TEAM_PLANS and used < total, "can_buy": plan in TEAM_PLANS, "seat_price": 15, "seat_credits": 250}
