from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class MarketplacePublishRequest(BaseModel):
    workspace_id: str | None = None


class MarketplaceUnpublishRequest(BaseModel):
    workspace_id: str | None = None


class ServiceEntryOut(BaseModel):
    service_name: str
    service_category: str
    service_description: str | None = None


class MarketplaceListingItem(BaseModel):
    workspace_id: str
    company_name: str
    tagline: str | None = None
    about_company: str
    primary_industry: str
    secondary_industries: list[str] = []
    business_type: str
    operating_stage: str
    delivery_model: str | None = None
    target_customer_type: str | None = None
    primary_revenue_model: str | None = None
    country: str
    city: str
    state_or_region: str | None = None
    services: list[ServiceEntryOut] = []
    catalogue_products: list[dict] = []
    logo_data_url: str | None = None
    website: str | None = None
    email: str
    phone_number: str | None = None
    linkedin_url: str | None = None
    twitter_url: str | None = None
    instagram_url: str | None = None
    facebook_url: str | None = None
    company_size: str | None = None
    year_established: int | None = None
    published_at: str
    updated_at: str
    avg_rating: float | None = None
    rating_count: int = 0


class MarketplaceListResponse(BaseModel):
    items: list[MarketplaceListingItem]
    total: int


class MarketplaceStatusResponse(BaseModel):
    workspace_id: str
    is_published: bool
    published_at: str | None = None
    has_profile: bool = False


class RatingSubmitRequest(BaseModel):
    rating: int
    review: str | None = None
    rater_email: str


class RatingResponse(BaseModel):
    workspace_id: str
    avg_rating: float | None = None
    rating_count: int = 0
    user_rating: int | None = None
    user_review: str | None = None


class RFQItemRequest(BaseModel):
    name: str
    quantity: int = 1
    notes: str | None = None


class RFQSubmitRequest(BaseModel):
    customer_name: str
    customer_email: str
    items: list[RFQItemRequest]
    message: str | None = None


class RFQOut(BaseModel):
    id: str
    workspace_id: str
    customer_name: str
    customer_email: str
    items: list[dict]
    message: str | None = None
    status: str
    created_at: str
    quote_id: str | None = None


class RFQListResponse(BaseModel):
    items: list[RFQOut]
    total: int


class RFQApproveRequest(BaseModel):
    validity_days: int = 30
    notes: str | None = None
    item_prices: list[dict] | None = None
