from __future__ import annotations

import logging
from datetime import datetime, timezone

import anyio
from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, sb_select, sb_update
from app.modules.plans.access import has_paid_access

logger = logging.getLogger(__name__)

BOOST_HOURS = 24

# addon_key → (kind, quantity). Quantity is boosts per billing period for
# featured_boosts, or AI credits granted for rfq_credits (1 credit = 1 RFQ reply).
ADDON_FULFILMENT: dict[str, tuple[str, int]] = {
    "addon_featured_1": ("featured_slot", 1),
    "addon_featured_5": ("featured_boosts", 5),
    "addon_featured_20": ("featured_boosts", 20),
    "addon_rfq_20": ("rfq_credits", 20),
    "addon_rfq_50": ("rfq_credits", 50),
    "addon_rfq_100": ("rfq_credits", 100),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _rpc(fn_name: str, params: dict):
    def _run():
        return get_supabase_client().rpc(fn_name, params).execute().data
    return await anyio.to_thread.run_sync(_run)


# ── Fulfilment (called from Stripe webhook and the eager success-page path) ──

async def fulfil_addon(
    *,
    user_id: str,
    addon_key: str,
    session_id: str,
    subscription_id: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
) -> dict:
    """Record the purchase and deliver it. Idempotent per Checkout session."""
    spec = ADDON_FULFILMENT.get(addon_key)
    if not spec:
        raise ValueError(f"Unknown add-on {addon_key}")
    kind, quantity = spec
    result = await _rpc("fulfil_addon_purchase", {
        "p_user_id": user_id,
        "p_addon_key": addon_key,
        "p_kind": kind,
        "p_quantity": quantity,
        "p_session_id": session_id,
        "p_subscription_id": subscription_id,
        "p_period_start": period_start,
        "p_period_end": period_end,
    })
    return result if isinstance(result, dict) else {"ok": True}


async def renew_addon_subscription(subscription_id: str, period_start: str | None, period_end: str | None) -> bool:
    """A recurring add-on renewed — start a new period (resets the boost allowance)."""
    rows = await sb_update(
        "user_addons",
        filters=[("stripe_subscription_id", "eq", subscription_id)],
        payload={
            "status": "active",
            "current_period_start": period_start or _now_iso(),
            "current_period_end": period_end,
            "updated_at": _now_iso(),
        },
    )
    return bool(rows)


async def cancel_addon_subscription(subscription_id: str) -> bool:
    rows = await sb_update(
        "user_addons",
        filters=[("stripe_subscription_id", "eq", subscription_id)],
        payload={"status": "cancelled", "updated_at": _now_iso()},
    )
    return bool(rows)


async def is_addon_subscription(subscription_id: str | None) -> bool:
    if not subscription_id:
        return False
    row = await sb_select("user_addons", filters=[("stripe_subscription_id", "eq", subscription_id)], columns="id", single=True)
    return bool(row)


# ── Featured listings ─────────────────────────────────────────────────────────

def _active_addon_filters(user_id: str, kind: str) -> list:
    return [("user_id", "eq", user_id), ("kind", "eq", kind), ("status", "eq", "active")]


def _period_open(row: dict) -> bool:
    end = row.get("current_period_end")
    if not end:
        return True
    try:
        return datetime.fromisoformat(str(end).replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except Exception:
        return True


async def featured_workspace_ids(workspaces: list[dict]) -> set[str]:
    """Which of these published workspaces are featured right now: the owner
    has an active featured-slot subscription, or a boost is running."""
    if not workspaces:
        return set()
    ws_ids = [str(w["id"]) for w in workspaces]
    owner_by_ws = {str(w["id"]): str(w.get("user_id") or "") for w in workspaces}
    featured: set[str] = set()
    now = _now_iso()
    try:
        slots = await sb_select(
            "user_addons",
            filters=[
                ("user_id", "in", list({u for u in owner_by_ws.values() if u})),
                ("kind", "eq", "featured_slot"),
                ("status", "eq", "active"),
            ],
            columns="user_id,current_period_end",
        )
        slot_owners = {r["user_id"] for r in (slots or []) if _period_open(r)}
        featured |= {ws for ws, owner in owner_by_ws.items() if owner in slot_owners}

        boosts = await sb_select(
            "listing_boosts",
            filters=[("workspace_id", "in", ws_ids), ("starts_at", "lte", now), ("ends_at", "gt", now)],
            columns="workspace_id",
        )
        featured |= {str(b["workspace_id"]) for b in (boosts or [])}
    except Exception as e:
        # Tables missing (migration not run) — list without featuring.
        logger.warning("featured_workspace_ids failed: %s", e)
    return featured


async def get_featured_status(*, user_id: str, workspace_id: str) -> dict:
    now = datetime.now(timezone.utc)
    slots = await sb_select("user_addons", filters=_active_addon_filters(user_id, "featured_slot"))
    has_slot = any(_period_open(r) for r in (slots or []))

    boost_subs = [r for r in (await sb_select("user_addons", filters=_active_addon_filters(user_id, "featured_boosts")) or []) if _period_open(r)]
    boosts_total = sum(int(r.get("quantity") or 0) for r in boost_subs)
    boosts_used = 0
    for r in boost_subs:
        since = r.get("current_period_start") or r.get("created_at")
        used = await sb_select("listing_boosts", filters=[("addon_id", "eq", r["id"]), ("created_at", "gte", since)], columns="id")
        boosts_used += len(used or [])

    upcoming = await sb_select(
        "listing_boosts",
        filters=[("workspace_id", "eq", workspace_id), ("ends_at", "gt", now.isoformat())],
        columns="starts_at,ends_at",
        order="ends_at",
        desc=True,
    )
    boost_until = upcoming[0]["ends_at"] if upcoming else None
    boost_active = any(
        datetime.fromisoformat(str(b["starts_at"]).replace("Z", "+00:00")) <= now for b in (upcoming or [])
    )
    return {
        "is_featured": has_slot or boost_active,
        "has_featured_slot": has_slot,
        "boost_until": boost_until,
        "boosts_total": boosts_total,
        "boosts_remaining": max(0, boosts_total - boosts_used),
        "boost_hours": BOOST_HOURS,
    }


async def use_boost(*, user_id: str, workspace_id: str) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id), ("user_id", "eq", user_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not ((ws.get("data") or {}).get("marketplace") or {}).get("is_active"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Publish your listing to the marketplace before boosting it.")
    result = await _rpc("use_listing_boost", {"p_user_id": user_id, "p_workspace_id": workspace_id, "p_hours": BOOST_HOURS})
    if not isinstance(result, dict) or not result.get("ok"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="You have no listing boosts left this period. Buy a boost pack on the pricing page.",
        )
    return await get_featured_status(user_id=user_id, workspace_id=workspace_id)


# ── RFQ access (free plan: received but locked) ───────────────────────────────

RFQ_LOCKED_MESSAGE = "Upgrade to a paid plan to view and respond to requests for quotation."


def redact_rfqs(rfqs: list[dict]) -> list[dict]:
    """Hide the buyer's details and request contents, keeping only what's needed
    to show that an RFQ arrived. Marked locked so a save can't persist it."""
    out = []
    for r in rfqs or []:
        out.append({
            "id": r.get("id"),
            "workspace_id": r.get("workspace_id"),
            "customer_name": "Locked request",
            "customer_email": "",
            "items": [{"name": "Upgrade to view", "quantity": 0} for _ in (r.get("items") or [])[:3]],
            "message": None,
            "status": r.get("status"),
            "created_at": r.get("created_at"),
            "quote_id": None,
            "locked": True,
        })
    return out


async def redact_workspace_data_for_owner(data: dict, owner_user_id: str) -> dict:
    """Return workspace data with RFQs redacted when the owner is on the free plan."""
    fin = (data or {}).get("financials") or {}
    if not fin.get("rfq_requests"):
        return data
    if await has_paid_access(owner_user_id):
        return data
    return {**data, "financials": {**fin, "rfq_requests": redact_rfqs(fin["rfq_requests"])}}


def restore_locked_rfqs(patch_rfqs: list, stored_rfqs: list) -> list:
    """If a client sends back redacted RFQs in a save, keep the stored originals."""
    stored_by_id = {r.get("id"): r for r in (stored_rfqs or []) if isinstance(r, dict)}
    restored = []
    for r in patch_rfqs or []:
        if isinstance(r, dict) and r.get("locked"):
            # Placeholder: swap in the stored original, or drop it if that RFQ
            # no longer exists — never persist a placeholder.
            if r.get("id") in stored_by_id:
                restored.append(stored_by_id[r["id"]])
        else:
            restored.append(r)
    return restored


async def require_rfq_access(user_id: str) -> None:
    if not await has_paid_access(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "RFQ_UPGRADE_REQUIRED", "message": RFQ_LOCKED_MESSAGE},
        )
