from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


BusinessType = Literal["sole_trader", "partnership", "limited_company", "llp", "non_profit", "startup"]
PrimaryIndustry = Literal[
    "consulting",
    "technology",
    "finance",
    "healthcare",
    "education",
    "retail",
    "ecommerce",
    "logistics",
    "manufacturing",
    "real_estate",
    "marketing",
    "other",
]
CompanySize = Literal["solo", "2-5", "6-10", "11-50", "51-200", "200+"]
MonthlyRevenueRange = Literal["0-1k", "1k-5k", "5k-10k", "10k-50k", "50k-100k", "100k+"]
OperatingStage = Literal["idea", "pre_revenue", "early_revenue", "growing", "established"]
DeliveryModel = Literal["manual", "hybrid", "automated"]
TargetCustomerType = Literal["individual", "startup", "SME", "corporate"]
PrimaryRevenueModel = Literal["one_off", "subscription", "retainer", "project_based", "mixed"]


class ServiceEntry(BaseModel):
    service_name: str = Field(min_length=2, max_length=120)
    service_category: PrimaryIndustry
    service_description: str | None = Field(default=None, max_length=600)


class WorkspaceProfile(BaseModel):
    # A. Company Identity
    company_name: str = Field(min_length=2, max_length=120)
    legal_name: str | None = Field(default=None, max_length=160)
    registration_number: str | None = Field(default=None, max_length=64)
    business_type: BusinessType
    primary_industry: PrimaryIndustry
    secondary_industries: list[str] = Field(default_factory=list, max_length=12)

    # B. Company Description
    about_company: str = Field(min_length=10, max_length=2000)
    tagline: str | None = Field(default=None, max_length=140)
    year_established: int | None = Field(default=None, ge=1500, le=2100)
    company_size: CompanySize | None = None

    # C. Services
    services: list[ServiceEntry]

    # D. Vision / Mission / Values
    vision: str | None = Field(default=None, max_length=600)
    mission: str | None = Field(default=None, max_length=600)
    core_values: list[str] = Field(default_factory=list, max_length=12)

    # E. Location & Address
    country: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=80)
    state_or_region: str | None = Field(default=None, max_length=80)
    postcode: str | None = Field(default=None, max_length=32)
    address_line_1: str | None = Field(default=None, max_length=140)
    address_line_2: str | None = Field(default=None, max_length=140)

    # F. Contact Information
    email: str = Field(min_length=3, max_length=140)
    phone_number: str | None = Field(default=None, max_length=40)
    website: str | None = Field(default=None, max_length=200)

    # G. Digital Presence
    linkedin_url: str | None = Field(default=None, max_length=200)
    twitter_url: str | None = Field(default=None, max_length=200)
    instagram_url: str | None = Field(default=None, max_length=200)
    facebook_url: str | None = Field(default=None, max_length=200)

    # H. Operational Snapshot
    monthly_revenue_range: MonthlyRevenueRange | None = None
    employee_count: int | None = Field(default=None, ge=0, le=100000)
    operating_stage: OperatingStage
    delivery_model: DeliveryModel

    # I. Optional Strategic Fields
    target_customer_type: TargetCustomerType | None = None
    primary_revenue_model: PrimaryRevenueModel | None = None
    key_offering_focus: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_required_lists(self):
        if not self.services or len(self.services) == 0:
            raise ValueError("services must contain at least one entry")
        return self


class WorkspaceProfileUpsertRequest(BaseModel):
    workspace_id: str | None = None
    profile: WorkspaceProfile


class WorkspaceProfilePatchRequest(BaseModel):
    workspace_id: str | None = None
    profile: dict


class WorkspaceProfileResponse(BaseModel):
    workspace_id: str
    profile: WorkspaceProfile
    updated_at: datetime
