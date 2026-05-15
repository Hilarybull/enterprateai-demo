from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.shared.auth.deps import get_current_user, get_optional_user
from app.modules.marketplace.schemas import (
    MarketplaceListResponse,
    MarketplaceListingItem,
    MarketplacePublishRequest,
    MarketplaceStatusResponse,
    MarketplaceUnpublishRequest,
    RatingSubmitRequest,
    RatingResponse,
)
from app.modules.marketplace.service import (
    delete_rating,
    get_listing,
    get_listing_status,
    get_ratings,
    list_marketplace,
    publish_workspace,
    submit_rating,
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
    user=Depends(get_current_user),
):
    return await submit_rating(
        workspace_id=workspace_id,
        user_id=user["id"],
        rating=payload.rating,
        review=payload.review,
    )


@router.delete("/ratings/{workspace_id}", response_model=RatingResponse)
async def remove_rating(
    workspace_id: str,
    user=Depends(get_current_user),
):
    return await delete_rating(workspace_id=workspace_id, user_id=user["id"])
