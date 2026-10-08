from __future__ import annotations

import asyncio
import base64
import io
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import uuid4

from fastapi import HTTPException, status

from app.modules.idea_validation.service import get_user_workspace, get_workspace
from app.core.supabase import sb_select, sb_update, sb_upsert
from app.shared.email.resend import send_email_via_resend
from app.modules.addons.service import featured_workspace_ids, redact_rfqs, require_rfq_access
from app.modules.credits.service import credit_guard
from app.modules.plans.access import has_paid_access


def _build_quotation_pdf(quote: dict, company_name: str, currency_symbol: str = "£") -> bytes:
    """Generate a minimal quotation PDF using ReportLab."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        brand = colors.HexColor("#4f46e5")

        header_style = ParagraphStyle("header", parent=styles["Normal"], fontSize=20, textColor=brand, fontName="Helvetica-Bold")
        sub_style = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#475569"))
        label_style = ParagraphStyle("label", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#64748b"))
        body_style = ParagraphStyle("body", parent=styles["Normal"], fontSize=10)

        story = [
            Paragraph("QUOTATION", header_style),
            Spacer(1, 0.2*cm),
            Paragraph(f"From: <b>{escape(company_name)}</b>", body_style),
            Paragraph(f"Reference: <b>{escape(quote.get('quotation_id', ''))}</b>", body_style),
            Paragraph(f"Issued: {quote.get('issued_at', '')[:10]}", label_style),
            Paragraph(f"Valid for: {quote.get('validity_days', 30)} days", label_style),
            Spacer(1, 0.5*cm),
            Paragraph(f"To: <b>{escape(quote.get('customer_name', ''))}</b>", body_style),
            Spacer(1, 0.6*cm),
        ]

        items = quote.get("items") or []
        table_data = [["Description", "Qty", "Unit Price", "Total"]]
        for item in items:
            qty = item.get("quantity", 1)
            unit = float(item.get("unit_price", 0))
            table_data.append([
                item.get("product_name", "Item"),
                str(qty),
                f"{currency_symbol}{unit:,.2f}",
                f"{currency_symbol}{qty * unit:,.2f}",
            ])
        subtotal = float(quote.get("subtotal_amount", 0))
        table_data.append(["", "", "Subtotal", f"{currency_symbol}{subtotal:,.2f}"])
        total = float(quote.get("total_amount", subtotal))
        table_data.append(["", "", "TOTAL", f"{currency_symbol}{total:,.2f}"])

        col_widths = [9*cm, 2*cm, 3.5*cm, 3.5*cm]
        t = Table(table_data, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), brand),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -3), 0.25, colors.HexColor("#e2e8f0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -3), [colors.white, colors.HexColor("#f8fafc")]),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("LINEABOVE", (2, -2), (-1, -2), 0.5, colors.HexColor("#94a3b8")),
            ("LINEABOVE", (2, -1), (-1, -1), 1, brand),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t)

        doc.build(story)
        return buf.getvalue()
    except Exception:
        return b""


async def _load_workspace(user_id: str, workspace_id: str | None):
    if workspace_id:
        return await get_workspace(user_id=user_id, workspace_id=workspace_id)
    return await get_user_workspace(user_id=user_id)


def _build_listing_item(ws: dict) -> dict | None:
    data = ws.get("data") or {}
    marketplace = data.get("marketplace") or {}
    if not marketplace.get("is_active"):
        return None
    from app.modules.marketplace.directory import listing_quality, marketplace_settings
    if listing_quality(marketplace_settings(data)):
        return None      # kept off the Marketplace until its description and offerings are real
    profile = data.get("workspace_profile")
    if not profile:
        return None
    published_at = marketplace.get("published_at") or ws.get("updated_at") or datetime.now(timezone.utc).isoformat()
    updated_at = ws.get("updated_at") or published_at
    services = sorted(
        profile.get("services") or [],
        key=lambda s: (str(s.get("service_name") or "").strip().lower(), str(s.get("service_category") or "").strip().lower()),
    )
    # One public profile: the description, website, services and contact route are the ones the owner
    # saved for the Marketplace. The account and workspace email addresses are never shown (AC-12).
    from app.modules.marketplace.directory import marketplace_settings, public_contact
    saved = marketplace_settings(data)["profile"]
    contact = public_contact(data)
    if saved["service_tags"]:
        known = {str(s.get("service_name") or "").strip().lower(): s for s in services}
        services = [known.get(t.strip().lower()) or {"service_name": t, "service_category": profile.get("primary_industry") or "", "service_description": None}
                    for t in saved["service_tags"]]
    return {
        "workspace_id": str(ws["id"]),
        "company_name": profile.get("company_name", ""),
        "tagline": profile.get("tagline"),
        "about_company": saved["description"],
        "service_area": saved["service_area"],
        "directory_profile_id": marketplace.get("directory_profile_id"),
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
        "services": services,
        "catalogue_products": [
            {"id": p.get("id", ""), "name": p.get("name", ""), "description": p.get("description", ""), "type": p.get("type", "product"), "base_price": p.get("base_price", 0)}
            for p in ((data.get("catalogue") or {}).get("products") or [])
            if p.get("name") and not p.get("archived") and p.get("marketplace_listed", True)
        ],
        "logo_data_url": profile.get("logo_data_url"),
        "website": saved["website"] or None,
        "contact_method": contact["method"],
        "email": contact["email"] or "",
        "phone_number": contact["phone"],
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
        "open_for_proposals": bool(
            marketplace.get("open_for_proposals")
            or (data.get("proposal_preferences") or {}).get("enabled", False)
        ),
    }


def _ws_fields(ws) -> tuple[str, dict]:
    if isinstance(ws, dict):
        return str(ws.get("id", "")), ws.get("data") or {}
    return str(ws.id), ws.data or {}


def _ws_owner(ws) -> str:
    return str(ws.get("user_id", "") if isinstance(ws, dict) else getattr(ws, "user_id", ""))


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
    if not await has_paid_access(user_id):
        published = await sb_select(
            "workspaces",
            filters=[("user_id", "eq", user_id), ("data", "cs", {"marketplace": {"is_active": True}})],
            columns="id",
        )
        if any(str(w["id"]) != ws_id for w in (published or [])):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The Explorer plan includes 1 marketplace listing. Unlist your other business or upgrade for multiple listings.",
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
    updated = await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id), ("user_id", "eq", user_id)],
        payload={"data": merged, "updated_at": now},
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to publish listing. Please try again.",
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
    updated = await sb_update(
        "workspaces",
        filters=[("id", "eq", ws_id), ("user_id", "eq", user_id)],
        payload={"data": merged, "updated_at": now},
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to unpublish listing. Please try again.",
        )
    return {"workspace_id": ws_id, "is_published": False, "published_at": None, "has_profile": bool(data.get("workspace_profile"))}


async def list_marketplace(
    *,
    search: str | None = None,
    industry: str | None = None,
    business_type: str | None = None,
    operating_stage: str | None = None,
    country: str | None = None,
    categories: list[str] | None = None,
    page: int = 1,
    page_size: int = 24,
) -> dict:
    all_workspaces = await sb_select(
        "workspaces",
        filters=[("data", "cs", {"marketplace": {"is_active": True}})],
        order="updated_at",
        desc=True,
        limit=200,
    )
    featured = await featured_workspace_ids(list(all_workspaces or []))
    items = []
    for ws in (all_workspaces or []):
        item = _build_listing_item(ws)
        if not item:
            continue
        item["is_featured"] = item["workspace_id"] in featured
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
        if categories:
            item_cats = {item.get("primary_industry", "")} | {
                s.get("service_category", "") for s in item.get("services", [])
            }
            item_cats.discard("")
            if not item_cats.intersection(set(categories)):
                continue
        items.append(item)

    await _attach_ratings(items)
    # Featured listings first; order within each group is unchanged.
    items.sort(key=lambda i: not i.get("is_featured"))

    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[start: start + page_size], "total": total}


async def list_public_proposal_requests(*, search: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    """Return all PUBLISHED proposal requests across all workspaces."""
    all_workspaces = await sb_select("workspaces", filters=[], order="updated_at", desc=True, limit=500)
    results = []
    for ws in (all_workspaces or []):
        data = ws.get("data") or {}
        profile = (data.get("workspace_profile") or {})
        company_name = profile.get("company_name", "")
        ws_id = str(ws.get("id", ""))
        for req in (data.get("proposal_requests") or []):
            if (req.get("status") or "").upper() != "PUBLISHED":
                continue
            # Skip invite-only and private requests — they must not appear on the public marketplace
            modes = req.get("accepted_modes") or ["general"]
            if "invite_only" in modes:
                continue
            if (req.get("visibility") or "marketplace") == "private":
                continue
            if search:
                q = search.strip().lower()
                searchable = " ".join([
                    req.get("title", ""), req.get("description", ""),
                    req.get("category", ""), company_name,
                ]).lower()
                if q not in searchable:
                    continue
            results.append({
                "id": req.get("id", ""),
                "title": req.get("title", ""),
                "description": req.get("description", ""),
                "category": req.get("category"),
                "budget_range": req.get("budget_range"),
                "deadline": req.get("deadline"),
                "submission_cap": req.get("submission_cap"),
                "requirements": req.get("requirements") or [],
                "accepted_modes": req.get("accepted_modes") or ["general"],
                "accepted_categories": req.get("accepted_categories"),
                "specific_criteria": req.get("specific_criteria"),
                "visibility": req.get("visibility") or "marketplace",
                "published_at": req.get("published_at") or req.get("created_at"),
                "workspace_id": ws_id,
                "company_name": company_name,
                "company_logo": profile.get("logo_data_url"),
                "company_industry": profile.get("primary_industry", ""),
                "company_country": profile.get("country", ""),
            })
    total = len(results)
    start = (page - 1) * page_size
    return {"items": results[start: start + page_size], "total": total}


async def get_public_proposal_request(*, request_id: str) -> dict:
    """Fetch a single published proposal request by its ID."""
    all_workspaces = await sb_select("workspaces", filters=[], order="updated_at", desc=True, limit=500)
    for ws in (all_workspaces or []):
        data = ws.get("data") or {}
        profile = (data.get("workspace_profile") or {})
        for req in (data.get("proposal_requests") or []):
            if req.get("id") != request_id:
                continue
            if (req.get("status") or "").upper() != "PUBLISHED":
                continue
            modes = req.get("accepted_modes") or ["general"]
            if "invite_only" in modes:
                continue
            if (req.get("visibility") or "marketplace") == "private":
                continue
            return {
                "id": req.get("id", ""),
                "title": req.get("title", ""),
                "description": req.get("description", ""),
                "category": req.get("category"),
                "budget_range": req.get("budget_range"),
                "budget_currency": req.get("budget_currency"),
                "deadline": req.get("deadline"),
                "submission_cap": req.get("submission_cap"),
                "requirements": req.get("requirements") or [],
                "accepted_modes": req.get("accepted_modes") or ["general"],
                "accepted_categories": req.get("accepted_categories"),
                "specific_criteria": req.get("specific_criteria"),
                "visibility": req.get("visibility") or "marketplace",
                "published_at": req.get("published_at") or req.get("created_at"),
                "workspace_id": str(ws.get("id", "")),
                "company_name": profile.get("company_name", ""),
                "company_logo": profile.get("logo_data_url"),
                "company_industry": profile.get("primary_industry", ""),
                "company_country": profile.get("country", ""),
            }
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")


async def get_listing(*, workspace_id: str) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    item = _build_listing_item(ws)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    item["is_featured"] = item["workspace_id"] in await featured_workspace_ids([ws])
    await _attach_ratings([item])
    return item


async def get_ratings(*, workspace_id: str, user_id: str | None = None, rater_email: str | None = None, service_name: str = "") -> dict:
    try:
        filters: list = [("workspace_id", "eq", workspace_id), ("service_name", "eq", service_name)]
        ratings = await sb_select(
            "marketplace_ratings",
            filters=filters,
            columns="rating,review,user_id,rater_email,service_name",
        )
    except Exception:
        return {"workspace_id": workspace_id, "avg_rating": None, "rating_count": 0, "user_rating": None, "user_review": None, "service_name": service_name}
    values = [r["rating"] for r in (ratings or [])]
    avg = round(sum(values) / len(values), 1) if values else None
    user_rating = None
    user_review = None
    own = None
    if rater_email:
        own = next((r for r in (ratings or []) if r.get("rater_email", "").lower() == rater_email.lower()), None)
    elif user_id:
        own = next((r for r in (ratings or []) if r.get("user_id") == user_id), None)
    if own:
        user_rating = own["rating"]
        user_review = own.get("review")
    return {
        "workspace_id": workspace_id,
        "avg_rating": avg,
        "rating_count": len(values),
        "user_rating": user_rating,
        "user_review": user_review,
        "service_name": service_name,
    }


async def submit_rating(*, workspace_id: str, user_id: str | None, rating: int, review: str | None, rater_email: str, service_name: str = "") -> dict:
    if not 1 <= rating <= 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rating must be between 1 and 5")
    email = rater_email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email address is required.")

    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    # Prevent owner from rating their own business (by user_id or matching email)
    if user_id and ws.get("user_id") == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot rate your own business")

    now = datetime.now(timezone.utc).isoformat()
    try:
        await sb_upsert(
            "marketplace_ratings",
            payload={
                "workspace_id": workspace_id,
                "user_id": user_id,
                "rater_email": email,
                "rating": rating,
                "review": review,
                "service_name": service_name,
                "updated_at": now,
            },
            on_conflict="workspace_id,rater_email,service_name",
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Ratings table not available. Run the migration first.") from e

    # Save reviewer to mailing list (silently — never block the rating)
    try:
        await sb_upsert(
            "mailing_list",
            payload={
                "id": str(uuid4()),
                "email": email,
                "source": "marketplace_review",
                "subscribed_at": now,
            },
            on_conflict="email",
        )
    except Exception:
        pass

    return await get_ratings(workspace_id=workspace_id, rater_email=email, service_name=service_name)


async def delete_rating(*, workspace_id: str, user_id: str, service_name: str = "") -> dict:
    from app.core.supabase import sb_delete
    await sb_delete(
        "marketplace_ratings",
        filters=[("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id), ("service_name", "eq", service_name)],
    )
    return await get_ratings(workspace_id=workspace_id, user_id=user_id, service_name=service_name)


# ─── RFQ (Request for Quotation) ─────────────────────────────────────────────

async def submit_rfq(
    *,
    workspace_id: str,
    customer_name: str,
    customer_email: str,
    items: list[dict],
    message: str | None,
    sender_user_id: str | None = None,
    sender_workspace_id: str | None = None,
    customer_company: str | None = None,
    needed_by: str | None = None,
    listing: str | None = None,
) -> dict:
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    data = ws.get("data") or {}
    marketplace = data.get("marketplace") or {}
    if not marketplace.get("is_active"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not listed in marketplace")

    recipient_company = (data.get("workspace_profile") or {}).get("company_name") or "Business"

    financials = data.get("financials") or {}
    rfq_requests = list(financials.get("rfq_requests") or [])
    now = datetime.now(timezone.utc).isoformat()
    # The same request sent again within a few minutes (a double click, a retry after a slow
    # reply) is the request already on record, not a second one.
    recent = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    again = next((r for r in rfq_requests if isinstance(r, dict) and r.get("status") == "pending"
                  and str(r.get("created_at") or "") >= recent
                  and str(r.get("customer_email") or "").strip().lower() == str(customer_email or "").strip().lower()
                  and r.get("items") == items and (r.get("message") or "") == (message or "")), None)
    if again:
        await _hand_rfq_to_agent(workspace_id, again["id"])      # safe to repeat: still one task
        return again
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
        "sender_workspace_id": sender_workspace_id,
        "customer_company": (customer_company or "").strip() or None,
        "needed_by": (needed_by or "").strip() or None,
        "listing": (listing or "").strip() or None,
    }
    rfq_requests.append(rfq)
    merged = {**data, "financials": {**financials, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", workspace_id)], payload={"data": merged, "updated_at": now})

    # Record the outbound RFQ in the sender's workspace for tracking
    if sender_user_id and sender_workspace_id and sender_workspace_id != workspace_id:
        try:
            sender_ws = await sb_select("workspaces", filters=[("id", "eq", sender_workspace_id), ("user_id", "eq", sender_user_id)], single=True)
            if sender_ws:
                s_data = sender_ws.get("data") or {}
                s_fin = s_data.get("financials") or {}
                sent_rfqs = list(s_fin.get("sent_rfqs") or [])
                sent_rfqs.insert(0, {
                    "id": rfq_id,
                    "recipient_workspace_id": workspace_id,
                    "recipient_company_name": recipient_company,
                    "items": items,
                    "message": message,
                    "status": "pending",
                    "created_at": now,
                })
                s_merged = {**s_data, "financials": {**s_fin, "sent_rfqs": sent_rfqs}}
                await sb_update("workspaces", filters=[("id", "eq", sender_workspace_id)], payload={"data": s_merged, "updated_at": now})
        except Exception:
            pass  # outbound tracking failure must not break the submission

    await _hand_rfq_to_agent(workspace_id, rfq_id)
    return rfq


async def _hand_rfq_to_agent(workspace_id: str, rfq_id: str) -> None:
    """Let the seller's Agent start drafting a reply, if the business has that switched on.
    The buyer's request is already saved; whatever happens here never fails it."""
    try:
        from app.modules.agent import rfq as agent_rfq
        from app.modules.agent.router import get_orchestrator
        await agent_rfq.received(get_orchestrator(), workspace_id, rfq_id)
    except Exception:      # noqa: BLE001
        logging.getLogger(__name__).warning("could not hand request %s to the Agent", rfq_id, exc_info=True)


async def _stop_rfq_task(workspace_id: str, rfq_id: str, user_id: str, reason: str) -> None:
    """A person has answered, declined or removed the request: the Agent's task for it stops."""
    try:
        from app.modules.agent import rfq as agent_rfq
        from app.modules.agent.router import get_orchestrator
        await agent_rfq.stop(get_orchestrator(), workspace_id, rfq_id, user_id, reason)
    except Exception:      # noqa: BLE001
        logging.getLogger(__name__).warning("could not stop the Agent task for request %s", rfq_id, exc_info=True)


async def _rfqs_unlocked(owner_id: str) -> bool:
    if await has_paid_access(owner_id):
        return True
    from app.modules.plans.access import has_grant
    return await has_grant(owner_id, "marketplace_rfq")


async def list_rfqs(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    _, data = _ws_fields(ws)
    financials = data.get("financials") or {}
    items = list(financials.get("rfq_requests") or [])
    if items and not await _rfqs_unlocked(_ws_owner(ws)):
        # Free plan: RFQs are received but locked until the owner upgrades.
        return {"items": redact_rfqs(items), "total": len(items), "locked": True}
    # Where the Agent has got to with each request, read from its tasks as they are now.
    try:
        from app.modules.agent import rfq as agent_rfq
        from app.modules.agent.router import get_orchestrator
        at = await agent_rfq.states(get_orchestrator(), _ws_fields(ws)[0]) if items else {}
    except Exception:      # noqa: BLE001 - the list is still worth showing without it
        logging.getLogger(__name__).warning("could not read Agent tasks for requests", exc_info=True)
        at = {}
    items = [{**r, "agent": at.get(str(r.get("id"))),
              "can_ask_agent": r.get("status") == "pending" and not at.get(str(r.get("id")))} for r in items]
    return {"items": items, "total": len(items)}


async def approve_rfq(
    *,
    user_id: str,
    workspace_id: str | None = None,
    rfq_id: str,
    validity_days: int = 30,
    item_prices: list[dict] | None = None,
) -> dict:
    """Respond to an RFQ: paid plans only, costs 1 AI credit (refunded on failure)."""
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    await require_rfq_access(_ws_owner(ws))
    _, data = _ws_fields(ws)
    rfq = next((r for r in ((data.get("financials") or {}).get("rfq_requests") or []) if r.get("id") == rfq_id), None)
    if not rfq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RFQ not found")
    if rfq.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RFQ is not pending")
    async with credit_guard(user_id, "rfq_response"):
        return await _approve_rfq(
            user_id=user_id,
            workspace_id=workspace_id,
            rfq_id=rfq_id,
            validity_days=validity_days,
            item_prices=item_prices,
        )


async def _approve_rfq(
    *,
    user_id: str,
    workspace_id: str | None = None,
    rfq_id: str,
    validity_days: int = 30,
    item_prices: list[dict] | None = None,
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

    # Build a lookup from item name -> price override supplied by the owner
    price_overrides: dict[str, dict] = {}
    if item_prices:
        for idx, override in enumerate(item_prices):
            key = str(override.get("product_name") or "").strip().lower()
            if key:
                price_overrides[key] = override
            else:
                price_overrides[f"__idx_{idx}"] = override

    quote_items = []
    for idx, item in enumerate(items):
        name = str(item.get("name") or "").strip()
        qty = max(1, int(item.get("quantity") or 1))
        product = _find_product(name)
        override = price_overrides.get(name.lower()) or price_overrides.get(f"__idx_{idx}")
        if override is not None:
            unit_price = float(override.get("unit_price") or 0)
            unit_cos = float(override.get("unit_cost_of_sales") or 0)
        else:
            unit_price = _product_price(product)
            unit_cos = _product_cos(product)
        quote_items.append({
            "product_id": product["id"] if product else f"rfq-item-{uuid4().hex[:8]}",
            "product_name": name or "Item",
            "quantity": qty,
            "unit_price": unit_price,
            "unit_cost_of_sales": unit_cos,
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
        "status": "sent",
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
    rfq["responded_by"] = "manual"
    rfq.pop("draft_quote_id", None)

    merged = {**data, "financials": {**financials, "quotes": quotes, "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})

    # Notify the requester that their RFQ has been responded to with a quotation
    workspace_email = profile.get("email") or None
    try:
        pdf_bytes = _build_quotation_pdf(quote, company_name)
        attachments = None
        if pdf_bytes:
            attachments = [{
                "filename": f"Quotation-{quote['quotation_id']}.pdf",
                "content": base64.b64encode(pdf_bytes).decode(),
            }]
        await send_email_via_resend(
            to_email=rfq["customer_email"],
            subject=f"Quotation received from {company_name}",
            text_content=(
                f"Hi {rfq.get('customer_name', 'there')},\n\n"
                f"{company_name} has responded to your request for quotation.\n\n"
                f"Quotation Reference: {quote['quotation_id']}\n"
                f"Total: \xa3{quote['total_amount']:,.2f}\n"
                f"Valid for: {validity_days} days\n\n"
                "Please find the quotation PDF attached to this email.\n"
            ),
            html_content=(
                "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
                "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
                f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;\">Quotation from {escape(company_name)}</h2>"
                f"<p style=\"margin:0 0 12px;\">Hi {escape(rfq.get('customer_name', 'there'))},</p>"
                f"<p style=\"margin:0 0 20px;\">{escape(company_name)} has responded to your request for quotation.</p>"
                "<table style=\"width:100%;border-collapse:collapse;margin-bottom:20px;\">"
                f"<tr><td style=\"padding:6px 0;color:#475569;\">Reference</td><td style=\"padding:6px 0;font-weight:600;\">{escape(quote['quotation_id'])}</td></tr>"
                f"<tr><td style=\"padding:6px 0;color:#475569;\">Total</td><td style=\"padding:6px 0;font-weight:600;\">\xa3{quote['total_amount']:,.2f}</td></tr>"
                f"<tr><td style=\"padding:6px 0;color:#475569;\">Valid for</td><td style=\"padding:6px 0;\">{validity_days} days</td></tr>"
                "</table>"
                "<p>Please find the quotation PDF attached to this email. You can also log in to your account to review it.</p>"
                "</div>"
            ),
            sender_name=company_name,
            reply_to_email=workspace_email,
            attachments=attachments,
        )
    except Exception:
        pass

    # Update the sender's workspace sent_rfqs to reflect the approved status
    sender_workspace_id = rfq.get("sender_workspace_id")
    if sender_workspace_id:
        try:
            sender_ws = await sb_select("workspaces", filters=[("id", "eq", sender_workspace_id)], single=True)
            if sender_ws:
                s_data = sender_ws.get("data") or {}
                s_fin = s_data.get("financials") or {}
                sent_rfqs = list(s_fin.get("sent_rfqs") or [])
                updated = False
                for r in sent_rfqs:
                    if r.get("id") == rfq["id"]:
                        r["status"] = "approved"
                        r["quote_id"] = quote_id
                        r["quote_ref"] = quote["quotation_id"]
                        r["quote_total"] = quote["total_amount"]
                        r["approved_at"] = now
                        updated = True
                        break
                if updated:
                    s_merged = {**s_data, "financials": {**s_fin, "sent_rfqs": sent_rfqs}}
                    await sb_update("workspaces", filters=[("id", "eq", sender_workspace_id)], payload={"data": s_merged, "updated_at": now})
        except Exception:
            pass

    # Answered by hand: the Agent's task for this request stops, and its unsent draft is closed.
    await _stop_rfq_task(ws_id, rfq_id, user_id, "rfq_answered_manually")

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
    await require_rfq_access(_ws_owner(ws))
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
    await _stop_rfq_task(ws_id, rfq_id, user_id, "rfq_rejected")
    return rfq


async def delete_rfq(*, user_id: str, workspace_id: str | None = None, rfq_id: str) -> None:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    ws_id, data = _ws_fields(ws)
    financials = data.get("financials") or {}
    rfq_requests = [r for r in (financials.get("rfq_requests") or []) if r.get("id") != rfq_id]
    merged = {**data, "financials": {**financials, "rfq_requests": rfq_requests}}
    now = datetime.now(timezone.utc).isoformat()
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})
    await _stop_rfq_task(ws_id, rfq_id, user_id, "rfq_deleted")


async def record_profile_view(
    *,
    workspace_id: str,
    viewer_workspace_id: str | None,
    viewer_email: str | None,
    viewer_ip: str | None = None,
) -> dict:
    import hashlib
    ws = await sb_select("workspaces", filters=[("id", "eq", workspace_id)], single=True)
    if not ws:
        return {"recorded": False}
    data = ws.get("data") or {}
    marketplace = data.get("marketplace") or {}
    if not marketplace.get("is_active"):
        return {"recorded": False}

    # Block self-views — user_id on the workspace row is the owner's email
    owner_email = (ws.get("user_id") or "").lower()
    if viewer_workspace_id and viewer_workspace_id == workspace_id:
        return {"recorded": False}
    if viewer_email and owner_email and viewer_email.lower() == owner_email:
        return {"recorded": False}

    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=24)).isoformat()

    # Deduplicate: skip if same viewer already recorded a view within the last 24 hours
    views = list(marketplace.get("profile_views") or [])
    ip_hash = hashlib.sha256(viewer_ip.encode()).hexdigest()[:16] if viewer_ip else None
    for v in reversed(views):
        if v.get("viewed_at", "") < cutoff:
            break
        if viewer_workspace_id and v.get("viewer_workspace_id") == viewer_workspace_id:
            return {"recorded": False}
        if viewer_email and v.get("viewer_email") == viewer_email:
            return {"recorded": False}
        if ip_hash and not viewer_workspace_id and not viewer_email and v.get("viewer_ip_hash") == ip_hash:
            return {"recorded": False}

    # Look up viewer's company name — by workspace_id first, then fall back to email lookup
    viewer_company: str | None = None
    resolved_workspace_id = viewer_workspace_id
    if viewer_workspace_id:
        try:
            viewer_ws = await sb_select("workspaces", filters=[("id", "eq", viewer_workspace_id)], single=True)
            if viewer_ws:
                vdata = viewer_ws.get("data") or {}
                vprofile = vdata.get("workspace_profile") or {}
                viewer_company = vprofile.get("company_name") or None
        except Exception:
            pass
    elif viewer_email:
        try:
            viewer_ws_rows = await sb_select("workspaces", filters=[("user_id", "eq", viewer_email.lower())])
            if viewer_ws_rows:
                viewer_ws = viewer_ws_rows[0]
                resolved_workspace_id = str(viewer_ws["id"])
                vdata = viewer_ws.get("data") or {}
                vprofile = vdata.get("workspace_profile") or {}
                viewer_company = vprofile.get("company_name") or None
        except Exception:
            pass

    view = {
        "view_id": str(uuid4()),
        "viewer_workspace_id": resolved_workspace_id,
        "viewer_email": viewer_email,
        "viewer_company": viewer_company,
        "viewer_ip_hash": ip_hash,
        "viewed_at": now.isoformat(),
    }
    views.append(view)
    if len(views) > 500:
        views = views[-500:]

    merged = {**data, "marketplace": {**marketplace, "profile_views": views}}
    await sb_update("workspaces", filters=[("id", "eq", workspace_id)], payload={"data": merged})
    return {"recorded": True}


async def get_profile_views(*, user_id: str, workspace_id: str | None = None) -> dict:
    ws = await _load_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    _, data = _ws_fields(ws)
    marketplace = data.get("marketplace") or {}
    views = list(marketplace.get("profile_views") or [])
    recent = list(reversed(views[-100:]))
    return {"views": recent, "total": len(views)}


_MAX_QUESTIONS_PER_QUOTE = 10

logger = logging.getLogger(__name__)
_background: set[asyncio.Task] = set()


def _in_background(coro) -> None:
    """Send a notification without making the customer wait for it. Their response is
    already saved; a notification that fails is logged."""
    async def _run() -> None:
        try:
            await coro
        except Exception:      # noqa: BLE001
            logger.warning("quotation notification failed", exc_info=True)

    task = asyncio.create_task(_run())
    _background.add(task)
    task.add_done_callback(_background.discard)


async def drain_background() -> None:
    """Wait for notifications still being sent (tests, shutdown)."""
    while _background:
        await asyncio.gather(*list(_background), return_exceptions=True)


async def ask_about_quote(*, token: str, viewer_email: str, message: str) -> dict:
    """The customer has a question before deciding. The quotation stays open; the question is
    kept on the quotation and emailed to the business, with replies going to the customer."""
    from app.core.config import get_settings
    from app.modules.agent.documents import _email

    text = str(message or "").strip()
    if len(text) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please write your question.")
    ws_id, quote_id, ws, data, quote = await _shared_quote(token, viewer_email)
    state = quote_state(quote)
    if state != "open":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_CLOSED_MESSAGE[state])
    questions = list(quote.get("customer_questions") or [])
    if len(questions) >= _MAX_QUESTIONS_PER_QUOTE:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="You've sent several questions already. The business will reply by email.")
    now = datetime.now(timezone.utc).isoformat()
    sender = viewer_email or str(quote.get("customer_email") or "")
    questions.append({"id": uuid4().hex[:12], "message": text[:2000], "from_email": sender, "asked_at": now})
    quote["customer_questions"] = questions
    quote["has_open_question"] = True
    quote["last_question_at"] = now
    financials = data.get("financials") or {}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)],
                    payload={"data": {**data, "financials": {**financials, "quotes": financials["quotes"]}}, "updated_at": now})

    # Tell the business. Replying to this email answers the customer directly.
    profile = data.get("workspace_profile") or {}
    company = str(profile.get("company_name") or ws.get("name") or "your business").strip()
    owner_email = str(profile.get("email") or ws.get("user_id") or "").strip()
    ref = quote.get("reference") or quote.get("quotation_id") or quote_id[:8]
    customer = quote.get("customer_name") or sender or "Your customer"
    link = f"{get_settings().frontend_url.rstrip('/')}/operations?tab=Sales"
    notifying = "@" in owner_email

    async def _tell_business() -> None:
        safe = escape(text).replace("\n", "<br>")
        html = _email(
            company=company, title=f"Question about quotation {ref}",
            preheader=f"{customer} asked a question before deciding",
            intro=f"{escape(customer)} has a question about quotation <strong>{escape(str(ref))}</strong> before deciding:",
            blocks=[f'<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid #4f46e5;background:#f8fafc;'
                    f'border-radius:8px;font-size:15px;line-height:1.6;color:#0f172a;">{safe}</div>'],
            cta=("Open the quotation", link),
            note=f"Reply to this email to answer {escape(customer)} directly. The quotation stays open until they accept or decline it.",
        )
        await send_email_via_resend(
            to_email=owner_email, subject=f"Question about quotation {ref} from {customer}",
            text_content=(f"{customer} has a question about quotation {ref}:\n\n{text}\n\n"
                          f"Reply to this email to answer them directly.\n{link}\n"),
            html_content=html, sender_name="EnterprateAI", reply_to_email=sender if "@" in sender else None,
        )

    if notifying:
        _in_background(_tell_business())
    return {"action": "question", "quote_id": quote_id, "notified": notifying, "company": company,
            "questions": [{"message": q.get("message"), "asked_at": q.get("asked_at")} for q in questions]}


async def _shared_quote(token: str, viewer_email: str, *, with_rfq: bool = False):
    """The quotation behind a customer's share link: (workspace id, quote id, workspace row, data, quote),
    plus the id of the marketplace RFQ it answers (or "") when `with_rfq` is set."""
    from app.modules.blueprint.share_repository import get_shared_document_by_token

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="This quotation link is no longer active. Please use the link in the most recent email, or contact the business.")
    parts = str(doc.type or "").split("::")
    if len(parts) < 4 or parts[0] != "quotation_acceptance":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This link is not a quotation link.")
    ws_id, quote_id = parts[1], parts[3]
    ws = await sb_select("workspaces", filters=[("id", "eq", ws_id)], single=True)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found.")
    data = ws.get("data") or {}
    quotes = list((data.get("financials") or {}).get("quotes") or [])
    quote = next((q for q in quotes if q.get("id") == quote_id), None)
    if not quote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found.")
    data = {**data, "financials": {**(data.get("financials") or {}), "quotes": quotes}}
    if with_rfq:
        return ws_id, quote_id, ws, data, quote, parts[2]
    return ws_id, quote_id, ws, data, quote


def quote_state(quote: dict, today: str | None = None) -> str:
    """Where a quotation stands for its customer: open, accepted, declined, expired,
    cancelled or superseded."""
    st = str(quote.get("status") or "").lower()
    if quote.get("superseded_by"):
        return "superseded"
    if st in ("accepted", "won"):
        return "accepted"
    if st in ("rejected", "declined", "lost"):
        return "declined"
    if st in ("cancelled", "canceled", "void", "withdrawn"):
        return "cancelled"
    if st == "expired":
        return "expired"
    today = today or datetime.now(timezone.utc).date().isoformat()
    valid = str(quote.get("valid_until") or "")[:10]
    if valid and valid < today:
        return "expired"
    return "open"


_CLOSED_MESSAGE = {
    "accepted": "This quotation has already been accepted.",
    "declined": "This quotation has already been declined.",
    "expired": "This quotation has expired. Please contact the business for an updated quote.",
    "cancelled": "This quotation has been withdrawn by the business.",
    "superseded": "This quotation has been replaced by a newer version.",
}


async def quote_status_for_customer(*, token: str, viewer_email: str = "") -> dict:
    """What the customer's quotation page needs to know beyond the document itself."""
    ws_id, quote_id, ws, data, quote = await _shared_quote(token, viewer_email)
    from app.modules.agent.business import company_of
    from app.modules.agent.tools import _amounts, _currency
    seller = company_of(data)
    logo = str((data.get("workspace_profile") or {}).get("logo_data_url") or "")
    amounts = _amounts(quote)
    valid = str(quote.get("valid_until") or "")[:10]
    days_left = None
    if valid:
        try:
            days_left = (datetime.fromisoformat(valid).date() - datetime.now(timezone.utc).date()).days
        except ValueError:
            days_left = None
    acceptance = quote.get("acceptance") or {}
    return {
        "state": quote_state(quote),
        "reference": quote.get("reference") or quote.get("quotation_id"),
        "version": int(quote.get("version") or 1),
        "total": amounts["total"], "currency": _currency(quote, data),
        "valid_until": valid or None, "days_left": days_left,
        "issued_at": str(quote.get("issued_at") or quote.get("created_at") or "")[:10] or None,
        "responded_at": quote.get("responded_at"),
        "acceptance": {"name": acceptance.get("name"), "accepted_at": acceptance.get("accepted_at")} if acceptance else None,
        "declined_reason": quote.get("declined_reason"),
        "superseded_by": quote.get("superseded_by"),
        "seller": {**{k: seller.get(k) for k in ("name", "email", "phone", "website", "address", "vat_number")},
                   "logo": logo if logo.startswith("data:image/") else None},
        "customer": {"name": quote.get("customer_name"), "contact_name": quote.get("contact_name") or None},
        "questions": [{"message": q.get("message"), "asked_at": q.get("asked_at")} for q in quote.get("customer_questions") or []],
    }


async def _notify_seller(ws: dict, data: dict, quote: dict, *, subject: str, title: str, intro: str, body_html: str = "",
                         reply_to: str | None = None) -> bool:
    """Tell the business what its customer did. Replies go to the customer where known."""
    from app.core.config import get_settings
    from app.modules.agent.documents import _email
    profile = data.get("workspace_profile") or {}
    company = str(profile.get("company_name") or ws.get("name") or "your business").strip()
    owner = str(profile.get("email") or ws.get("user_id") or "").strip()
    if "@" not in owner:
        return False
    link = f"{get_settings().frontend_url.rstrip('/')}/operations?tab=Sales"
    html = _email(company=company, title=title, preheader=intro, intro=intro, blocks=[body_html] if body_html else [],
                  cta=("Open in Business Operations", link))
    res = await send_email_via_resend(to_email=owner, subject=subject, text_content=f"{intro}\n\n{link}\n",
                                      html_content=html, sender_name="EnterprateAI",
                                      reply_to_email=reply_to if reply_to and "@" in reply_to else None)
    return bool(res.sent)


async def respond_to_quote(*, token: str, viewer_email: str, action: str, signer_name: str | None = None,
                           accepted_terms: bool = False, reason: str | None = None,
                           client_ip: str | None = None, user_agent: str | None = None) -> dict:
    """The customer accepts or declines a shared quotation.

    Accepting is a trusted acceptance (s16.1): the signer's name, their agreement to the terms,
    the time, IP address, browser and the quotation version are recorded. It is idempotent: a
    second accept returns the first acceptance and changes nothing."""
    ws_id, quote_id, ws, data, quote, rfq_ref = await _shared_quote(token, viewer_email, with_rfq=True)
    state = quote_state(quote)
    now = datetime.now(timezone.utc).isoformat()
    if action == "accept":
        if state == "accepted":
            return {"action": "accepted", "already": True, "quote_id": quote_id,
                    "acceptance": {k: (quote.get("acceptance") or {}).get(k) for k in ("name", "accepted_at")}}
        if state != "open":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_CLOSED_MESSAGE[state])
        name = " ".join(str(signer_name or "").split())
        if len(name) < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter your full name to accept.")
        if not accepted_terms:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please confirm that you accept the quotation and its terms.")
        from app.modules.agent.tools import _amounts
        quote.update({
            "status": "accepted", "responded_at": now, "has_open_question": False,
            "acceptance": {"name": name[:120], "accepted_at": now, "ip": (client_ip or "")[:64], "user_agent": (user_agent or "")[:300],
                           "version": int(quote.get("version") or 1), "total": _amounts(quote)["total"],
                           "email": viewer_email or quote.get("customer_email") or None, "source": "customer_link"},
        })
        new_status = "accepted"
    else:
        if state == "declined":
            return {"action": "rejected", "already": True, "quote_id": quote_id}
        if state != "open":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_CLOSED_MESSAGE[state])
        quote.update({"status": "rejected", "responded_at": now, "has_open_question": False,
                      "declined_reason": (str(reason or "").strip()[:1000] or None)})
        new_status = "rejected"

    financials = data.get("financials") or {}
    rfq_requests = list(financials.get("rfq_requests") or [])
    rfq_id = quote.get("rfq_id") or rfq_ref
    rfq = next((r for r in rfq_requests if rfq_id and r.get("id") == rfq_id), None)
    if rfq:
        rfq["customer_response"] = new_status
        rfq["responded_at"] = now
    merged = {**data, "financials": {**financials, "quotes": financials["quotes"], "rfq_requests": rfq_requests}}
    await sb_update("workspaces", filters=[("id", "eq", ws_id)], payload={"data": merged, "updated_at": now})

    ref = quote.get("reference") or quote.get("quotation_id") or quote_id[:8]
    customer = quote.get("customer_name") or "Your customer"
    # The answer is saved; the business is told in the background.
    if new_status == "accepted":
        try:      # an accepted quotation may be the Agent's cue to prepare the invoice
            from app.modules.agent import autostart
            autostart.later(str(ws_id))
        except Exception:      # noqa: BLE001
            pass
        _in_background(_notify_seller(ws, data, quote, subject=f"{customer} accepted quotation {ref}", title=f"Quotation {ref} accepted",
                                      intro=f"{escape(customer)} accepted quotation {escape(str(ref))}, signed by {escape(quote['acceptance']['name'])}.",
                                      reply_to=quote.get("customer_email")))
    else:
        why = quote.get("declined_reason")
        _in_background(_notify_seller(ws, data, quote, subject=f"{customer} declined quotation {ref}", title=f"Quotation {ref} declined",
                                      intro=f"{escape(customer)} declined quotation {escape(str(ref))}." + (f" Their reason: {escape(why)}" if why else ""),
                                      reply_to=quote.get("customer_email")))
    return {"action": new_status, "quote_id": quote_id}