from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.modules.idea_validation.service import get_user_workspace, get_workspace
from app.core.supabase import sb_select, sb_update, sb_upsert


async def _load_workspace(user_id: str, workspace_id: str | None):
    if workspace_id:
        return await get_workspace(user_id=user_id, workspace_id=workspace_id)
    return await get_user_workspace(user_id=user_id)


def _build_listing_item(ws: dict) -> dict | None:
    data = ws.get("data") or {}
    marketplace = data.get("marketplace") or {}
    if not marketplace.get("is_active"):
        return None
    profile = data.get("workspace_profile")
    if not profile:
        return None
    published_at = marketplace.get("published_at") or ws.get("updated_at") or datetime.now(timezone.utc).isoformat()
    updated_at = ws.get("updated_at") or published_at
    return {
        "workspace_id": str(ws["id"]),
        "company_name": profile.get("company_name", ""),
        "tagline": profile.get("tagline"),
        "about_company": profile.get("about_company", ""),
        "primary_industry": profile.get("primary_industry", ""),
        "secondary_industries": profile.get("secondary_industries") or [],
        "business_type": profile.get("business_type", ""),
        "operating_stage": profile.get("operating_stage", ""),
        "delivery_model": profile.get("delivery_model"),
        "target_customer_type": profile.get("target_customer_type"),
        "primary_revenue_model": profile.get("primary_revenue_model"),
        "country": profile.get("country", ""),
        "city": profile.get("city", ""),
        "state_or_region": profile.get("state_or_region"),
        "services": profile.get("services") or [],
        "catalogue_products": [
            {"id": p.get("id", ""), "name": p.get("name", "")}
            for p in ((data.get("catalogue") or {}).get("products") or [])
            if p.get("name") and not p.get("archived")
        ],
        "logo_data_url": profile.get("logo_data_url"),
        "website": profile.get("website"),
        "email": profile.get("email", ""),
        "phone_number": profile.get("phone_number"),
        "linkedin_url": profile.get("linkedin_url"),
        "twitter_url": profile.get("twitter_url"),
        "instagram_url": profile.get("instagram_url"),
        "facebook_url": profile.get("facebook_url"),
        "company_size": profile.get("company_size"),
        "year_established": profile.get("year_established"),
        "published_at": published_at,
        "updated_at": updated_at,
        "avg_rating": None,
        "rating_count": 0,
    }


def _ws_fields(ws) -> tuple[str, dict]:
    if isinstance(ws, dict):
        return str(ws.get("id", "")), ws.get("data") or {}
    return str(ws.id), ws.data or {}


async def _attach_ratings(items: list[dict]) -> None:
    """Fetch rating aggregates for a list of items and mutate them in place."""
    if not items:
        return
    try:
        workspace_ids = [item["workspace_id"] for item in items]
        ratings = await sb_select(
            "marketplace_ratings",
            filters=[("workspace_id", "in", workspace_ids)],
            columns="workspace_id,rating",
        )
        agg: dict[str, list[int]] = defaultdict(list)
        for r in (ratings or []):
            agg[r["workspace_id"]].append(r["rating"])
        for item in items:
            ws_ratings = agg.get(item["workspace_id"], [])
            item["avg_rating"] = round(sum(ws_ratings) / len(ws_ratings), 1) if ws_ratings else None
            item["rating_count"] = len(ws_ratings)
    except Exception:
        pass  # ratings table may not exist yet; listings still return without ratings


async def get_listing_status(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    marketplace = data.get("marketplace") or {}
    return {
        "workspace_id": ws_id,
        "is_published": bool(marketplace.get("is_active", False)),
        "published_at": marketplace.get("published_at"),
        "has_profile": bool(data.get("workspace_profile")),
    }


async def publish_workspace(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    if not data.get("workspace_profile"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete your workspace profile before publishing to the marketplace",
        )
    now = datetime.now(timezone.utc).isoformat()
    existing_marketplace = data.get("marketplace") or {}
    marketplace_data = {
        **existing_marketplace,
        "is_active": True,
        "published_at": existing_marketplace.get("published_at") or now,
        "updated_at": now,
    }
    merged = dict(data)
    merged["marketplace"] = marketplace_data
    await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id), ("user_id", "eq", user_id)],
        payload={"data": merged, "updated_at": now},
    )
    return {"workspace_id": ws_id, "is_published": True, "published_at": marketplace_data["published_at"], "has_profile": True}


async def unpublish_workspace(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    now = datetime.now(timezone.utc).isoformat()
    existing_marketplace = data.get("marketplace") or {}
    marketplace_data = {**existing_marketplace, "is_active": False, "updated_at": now}
    merged = dict(data)
    merged["marketplace"] = marketplace_data
    await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id), ("user_id", "eq", user_id)],
        payload={"data": merged, "updated_at": now},
    )
    return {"workspace_id": ws_id, "is_published": False, "published_at": None, "has_profile": bool(data.get("workspace_profile"))}


async def list_marketplace(
    *,
    search: str | None = None,
    industry: str | None = None,
    business_type: str | None = None,
    operating_stage: str | None = None,
    country: str | None = None,
    page: int = 1,
    page_size: int = 24,
) -> dict:
    all_workspaces = await sb_select(
        "workspaces",
        filters=[("data", "cs", {"marketplace": {"is_active": True}})],
        order="updated_at",
        desc=True,
        limit=500,
    )
    items = []
    for ws in (all_workspaces or []):
        item = _build_listing_item(ws)
        if not item:
            continue
        if industry and item["primary_industry"] != industry:
            continue
        if business_type and item["business_type"] != business_type:
            continue
        if operating_stage and item["operating_stage"] != operating_stage:
            continue
        if country and item["country"].lower() != country.lower():
            continue
        if search:
            q = search.strip().lower()
            searchable = " ".join([
                item["company_name"],
                item["about_company"],
                item.get("tagline") or "",
                item["city"],
                item["country"],
                " ".join(s.get("service_name", "") for s in item["services"]),
            ]).lower()
            if q not in searchable:
                continue
        items.append(item)

    await _attach_ratings(items)

    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[start: start + page_size], "total": total}


async def get_listing(*, workspace_id: str) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    item = _build_listing_item(ws)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    await _attach_ratings([item])
    return item


async def get_ratings(*, workspace_id: str, user_id: str | None = None) -> dict:
    try:
        ratings = await sb_select(
            "marketplace_ratings",
            filters=[("workspace_id", "eq", workspace_id)],
            columns="rating,review,user_id",
        )
    except Exception:
        return {"workspace_id": workspace_id, "avg_rating": None, "rating_count": 0, "user_rating": None, "user_review": None}
    values = [r["rating"] for r in (ratings or [])]
    avg = round(sum(values) / len(values), 1) if values else None
    user_rating = None
    user_review = None
    if user_id:
        own = next((r for r in (ratings or []) if r["user_id"] == user_id), None)
        if own:
            user_rating = own["rating"]
            user_review = own.get("review")
    return {
        "workspace_id": workspace_id,
        "avg_rating": avg,
        "rating_count": len(values),
        "user_rating": user_rating,
        "user_review": user_review,
    }


async def submit_rating(*, workspace_id: str, user_id: str, rating: int, review: str | None) -> dict:
    if not 1 <= rating <= 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rating must be between 1 and 5")

    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    if ws.get("user_id") == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot rate your own business")

    now = datetime.now(timezone.utc).isoformat()
    try:
        await sb_upsert(
            "marketplace_ratings",
            payload={
                "workspace_id": workspace_id,
                "user_id": user_id,
                "rating": rating,
                "review": review,
                "updated_at": now,
            },
            on_conflict="workspace_id,user_id",
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Ratings table not available. Run the migration first.") from e
    return await get_ratings(workspace_id=workspace_id, user_id=user_id)


async def delete_rating(*, workspace_id: str, user_id: str) -> dict:
    from app.core.supabase import sb_delete
    await sb_delete(
        "marketplace_ratings",
        filters=[("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id)],
    )
    return await get_ratings(workspace_id=workspace_id, user_id=user_id)


# ─── RFQ (Request for Quotation) ─────────────────────────────────────────────

async def submit_rfq(
    *,
    workspace_id: str,
    customer_name: str,
    customer_email: str,
    items: list[dict],
    message: str | None,
) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    data = ws.get("data") or {}
    marketplace = data.get("marketplace") or {}
    if not marketplace.get("is_active"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not listed in marketplace")

    financials = data.get("financials") or {}
    rfq_requests = list(financials.get("rfq_requests") or [])
    now = datetime.now(timezone.utc).isoformat()
    rfq_id = str(uuid4())
    rfq = {
        "id": rfq_id,
        "workspace_id": workspace_id,
        "customer_name": customer_name,
        "customer_email": customer_email,
        "items": items,
        "message": message,
        "status": "pending",
        "created_at": now,
        "quote_id": None,
    }
    rfq_requests.append(rfq)
    merged = {**data, "financials": {**financials, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", workspace_id)], payload={"data": merged, "updated_at": now})
    return rfq


async def list_rfqs(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    _, data = _ws_fields(ws)
    financials = data.get("financials") or {}
    items = list(financials.get("rfq_requests") or [])
    return {"items": items, "total": len(items)}


async def approve_rfq(
    *,
    user_id: str,
    workspace_id: str | None = None,
    rfq_id: str,
    validity_days: int = 30,
) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    financials = data.get("financials") or {}
    rfq_requests = list(financials.get("rfq_requests") or [])

    rfq = next((r for r in rfq_requests if r.get("id") == rfq_id), None)
    if not rfq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RFQ not found")
    if rfq.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RFQ is not pending")

    now = datetime.now(timezone.utc).isoformat()
    quote_id = str(uuid4())
    items = rfq.get("items") or []

    # Try to match catalogue products by name for pricing
    catalogue = data.get("catalogue") or {}
    products = catalogue.get("products") or []

    def _find_product(name: str):
        n = str(name or "").strip().lower()
        return next((p for p in products if str(p.get("name") or "").strip().lower() == n), None)

    def _product_price(p):
        if not p:
            return 0.0
        base = float(p.get("base_price") or 0)
        disc = float(p.get("discount") or 0)
        freight = float(p.get("freight_cost") or 0)
        return max(0.0, base - disc + freight)

    def _product_cos(p):
        if not p:
            return 0.0
        return float(p.get("cost_of_sales") or p.get("unit_cost") or 0)

    quote_items = []
    for item in items:
        name = str(item.get("name") or "").strip()
        qty = max(1, int(item.get("quantity") or 1))
        product = _find_product(name)
        quote_items.append({
            "product_id": product["id"] if product else f"rfq-item-{uuid4().hex[:8]}",
            "product_name": name or "Item",
            "quantity": qty,
            "unit_price": _product_price(product),
            "unit_cost_of_sales": _product_cos(product),
        })

    subtotal = round(sum(i["unit_price"] * i["quantity"] for i in quote_items), 2)
    cos_total = round(sum(i["unit_cost_of_sales"] * i["quantity"] for i in quote_items), 2)

    profile = data.get("workspace_profile") or {}
    company_name = profile.get("company_name") or "Business"

    quote = {
        "id": quote_id,
        "quotation_id": f"Q-{quote_id[:8].upper()}",
        "customer_id": rfq["customer_email"],
        "customer_name": rfq["customer_name"],
        "customer_email": rfq["customer_email"],
        "product_ids": [i["product_id"] for i in quote_items],
        "product_names": [i["product_name"] for i in quote_items],
        "items": quote_items,
        "quantity": sum(i["quantity"] for i in quote_items),
        "subtotal_amount": subtotal,
        "cost_of_sales": cos_total,
        "total_amount": round(subtotal + cos_total, 2),
        "validity_days": validity_days,
        "status": "draft",
        "rfq_id": rfq_id,
        "issued_at": now[:10],
        "created_at": now,
        "updated_at": now,
    }

    quotes = list(financials.get("quotes") or [])
    quotes.insert(0, quote)

    rfq["status"] = "approved"
    rfq["quote_id"] = quote_id
    rfq["approved_at"] = now

    merged = {**data, "financials": {**financials, "quotes": quotes, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})

    return {
        "rfq": rfq,
        "quote": quote,
        "workspace_id": ws_id,
        "company_name": company_name,
    }


async def reject_rfq(*, user_id: str, workspace_id: str | None = None, rfq_id: str) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    financials = data.get("financials") or {}
    rfq_requests = list(financials.get("rfq_requests") or [])

    rfq = next((r for r in rfq_requests if r.get("id") == rfq_id), None)
    if not rfq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RFQ not found")
    if rfq.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RFQ is not pending")

    now = datetime.now(timezone.utc).isoformat()
    rfq["status"] = "rejected"
    rfq["rejected_at"] = now

    merged = {**data, "financials": {**financials, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})
    return rfq


async def respond_to_quote(*, token: str, viewer_email: str, action: str) -> dict:
    """Called when a customer accepts or rejects a shared quotation."""
    from app.modules.blueprint.share_repository import get_shared_document_by_token
    from app.core.supabase import sb_select as _sel

    try:
        doc = await get_shared_document_by_token(token=token, viewer_email=viewer_email)
    except PermissionError as exc:
        code = str(exc)
        if code == "EMAIL_REQUIRED":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address required.")
        if code == "EMAIL_MISMATCH":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email address does not match the quotation recipient.")
        raise
    except RuntimeError as exc:
        if str(exc) == "EXPIRED":
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This quotation link has expired.")
        raise

    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation link not found.")

    doc_type = str(doc.type or "")
    if not doc_type.startswith("quotation_acceptance::"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This link is not a quotation acceptance link.")

    parts = doc_type.split("::")
    if len(parts) < 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quotation link format.")

    ws_id, rfq_id, quote_id = parts[1], parts[2], parts[3]

    ws = await _sel("workspaces", filters=[("id", "eq", ws_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")

    data = ws.get("data") or {}
    financials = data.get("financials") or {}
    now = datetime.now(timezone.utc).isoformat()

    quotes = list(financials.get("quotes") or [])
    rfq_requests = list(financials.get("rfq_requests") or [])

    new_status = "accepted" if action == "accept" else "rejected"
    quote = next((q for q in quotes if q.get("id") == quote_id), None)
    rfq = next((r for r in rfq_requests if r.get("id") == rfq_id), None)

    if not quote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found.")

    quote["status"] = new_status
    quote["responded_at"] = now
    if rfq:
        rfq["customer_response"] = new_status
        rfq["responded_at"] = now

    merged = {**data, "financials": {**financials, "quotes": quotes, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})
    return {"action": new_status, "quote_id": quote_id}
