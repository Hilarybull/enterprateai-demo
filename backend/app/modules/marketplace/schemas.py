from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


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
    email: str = ""                     # only a public address the owner chose to show; never the account email
    phone_number: str | None = None
    contact_method: str | None = None
    service_area: str | None = None
    directory_profile_id: str | None = None
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
    is_featured: bool = False


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
    service_name: str = ""


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
    customer_company: str | None = Field(default=None, max_length=200)
    needed_by: str | None = Field(default=None, max_length=40)       # a date, as the buyer gave it
    listing: str | None = Field(default=None, max_length=200)        # the listing the request was made from


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
    locked: bool = False
    customer_company: str | None = None
    needed_by: str | None = None
    listing: str | None = None
    draft_quote_id: str | None = None
    responded_by: str | None = None
    # Where the Agent has got to with this request: {run_id, status, label, to}. None when it has no task.
    agent: dict | None = None
    can_ask_agent: bool = False


class RFQListResponse(BaseModel):
    items: list[RFQOut]
    total: int
    locked: bool = False


class RFQApproveRequest(BaseModel):
    validity_days: int = 30
    notes: str | None = None
    item_prices: list[dict] | None = None


class ProfileViewRequest(BaseModel):
    viewer_workspace_id: str | None = None
    viewer_email: str | None = None
