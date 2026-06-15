from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response

from app.shared.auth.deps import get_current_user, get_optional_user
from app.modules.marketplace.schemas import (
    MarketplaceListResponse,
    MarketplaceListingItem,
    MarketplacePublishRequest,
    MarketplaceStatusResponse,
    MarketplaceUnpublishRequest,
    ProfileViewRequest,
    RatingSubmitRequest,
    RatingResponse,
    RFQApproveRequest,
    RFQListResponse,
    RFQOut,
    RFQSubmitRequest,
)
from app.modules.marketplace.service import (
    approve_rfq,
    delete_rfq,
    delete_rating,
    get_listing,
    get_listing_status,
    get_profile_views,
    get_ratings,
    list_marketplace,
    list_rfqs,
    publish_workspace,
    record_profile_view,
    reject_rfq,
    submit_rating,
    submit_rfq,
    unpublish_workspace,
)

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


@router.get("/listings", response_model=MarketplaceListResponse)
async def browse_marketplace(
    search: str | None = Query(default=None),
    industry: str | None = Query(default=None),
    business_type: str | None = Query(default=None),
    operating_stage: str | None = Query(default=None),
    country: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
):
    return await list_marketplace(
        search=search,
        industry=industry,
        business_type=business_type,
        operating_stage=operating_stage,
        country=country,
        page=page,
        page_size=page_size,
    )


@router.get("/listings/{workspace_id}", response_model=MarketplaceListingItem)
async def get_marketplace_listing(workspace_id: str):
    return await get_listing(workspace_id=workspace_id)


@router.get("/status", response_model=MarketplaceStatusResponse)
async def marketplace_status(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    return await get_listing_status(user_id=user["id"], workspace_id=workspace_id)


@router.post("/publish", response_model=MarketplaceStatusResponse)
async def publish_to_marketplace(
    payload: MarketplacePublishRequest,
    user=Depends(get_current_user),
):
    return await publish_workspace(user_id=user["id"], workspace_id=payload.workspace_id)


@router.post("/unpublish", response_model=MarketplaceStatusResponse)
async def unpublish_from_marketplace(
    payload: MarketplaceUnpublishRequest,
    user=Depends(get_current_user),
):
    return await unpublish_workspace(user_id=user["id"], workspace_id=payload.workspace_id)


@router.get("/ratings/{workspace_id}", response_model=RatingResponse)
async def get_listing_ratings(
    workspace_id: str,
    user=Depends(get_optional_user),
):
    return await get_ratings(workspace_id=workspace_id, user_id=user["id"] if user else None)


@router.post("/ratings/{workspace_id}", response_model=RatingResponse)
async def rate_listing(
    workspace_id: str,
    payload: RatingSubmitRequest,
    user=Depends(get_optional_user),
):
    return await submit_rating(
        workspace_id=workspace_id,
        user_id=user["id"] if user else None,
        rating=payload.rating,
        review=payload.review,
        rater_email=payload.rater_email,
    )


@router.delete("/ratings/{workspace_id}", response_model=RatingResponse)
async def remove_rating(
    workspace_id: str,
    user=Depends(get_current_user),
):
    return await delete_rating(workspace_id=workspace_id, user_id=user["id"])


# ─── RFQ endpoints ────────────────────────────────────────────────────────────

@router.post("/rfq/{workspace_id}", response_model=RFQOut)
async def submit_rfq_endpoint(workspace_id: str, payload: RFQSubmitRequest):
    """Public: any visitor can submit a request for quotation to a listed business."""
    return await submit_rfq(
        workspace_id=workspace_id,
        customer_name=payload.customer_name,
        customer_email=payload.customer_email,
        items=[i.model_dump() for i in payload.items],
        message=payload.message,
    )


@router.get("/rfq", response_model=RFQListResponse)
async def list_rfq_endpoint(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    """Owner: view incoming RFQs for their workspace."""
    return await list_rfqs(user_id=user["id"], workspace_id=workspace_id)


@router.post("/rfq/{rfq_id}/approve")
async def approve_rfq_endpoint(
    rfq_id: str,
    payload: RFQApproveRequest,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    """Owner: approve an RFQ — creates a draft quote and returns data for the frontend to share."""
    return await approve_rfq(
        user_id=user["id"],
        workspace_id=workspace_id,
        rfq_id=rfq_id,
        validity_days=payload.validity_days,
        item_prices=payload.item_prices,
    )


@router.post("/rfq/{rfq_id}/reject", response_model=RFQOut)
async def reject_rfq_endpoint(
    rfq_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
):
    """Owner: reject an incoming RFQ."""
    return await reject_rfq(user_id=user["id"], workspace_id=workspace_id, rfq_id=rfq_id)


@router.delete("/rfq/{rfq_id}", status_code=204, response_class=Response)
async def delete_rfq_endpoint(
    rfq_id: str,
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
) -> Response:
    """Owner: permanently delete an RFQ request."""
    await delete_rfq(user_id=user["id"], workspace_id=workspace_id, rfq_id=rfq_id)
    return Response(status_code=204)


@router.post("/listings/{workspace_id}/view")
async def record_listing_view(
    workspace_id: str,
    payload: ProfileViewRequest,
    _user=Depends(get_optional_user),
) -> dict:
    return await record_profile_view(
        workspace_id=workspace_id,
        viewer_workspace_id=payload.viewer_workspace_id,
        viewer_email=payload.viewer_email,
    )


@router.get("/my/views")
async def my_profile_views(
    workspace_id: str | None = Query(default=None),
    user=Depends(get_current_user),
) -> dict:
    return await get_profile_views(user_id=user["id"], workspace_id=workspace_id)
