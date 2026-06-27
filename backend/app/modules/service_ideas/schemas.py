from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

ServiceCategory = Literal["consulting", "training", "agency", "freelance", "technical_service", "other"]
TargetCustomerType = str  # accepts any audience: SME, Enterprise, Consumers (B2C), etc.
TargetMarketScope = Literal["local", "regional", "national", "global"]
DemandEvidenceType = Literal[
    "assumption_only",
    "market_research",
    "enquiries",
    "LOIs",
    "paid_pilot",
    "paying_customers",
    "repeat_paying_customers",
]
DifferentiationLevel = Literal["low", "medium", "high"]


class ServiceIdeaValidateRequest(BaseModel):
    service_name: str = Field(min_length=3, max_length=120)
    service_category: ServiceCategory
    service_description: str = Field(min_length=10, max_length=1200)
    target_customer_type: TargetCustomerType
    target_market_scope: TargetMarketScope

    price_per_sale: float = Field(ge=0)
    expected_sales_per_month: float = Field(ge=0)

    direct_labour_cost_per_sale: float = Field(ge=0)
    contractor_cost_per_sale: float = Field(ge=0, default=0)
    materials_cost_per_sale: float = Field(ge=0, default=0)
    travel_cost_per_sale: float = Field(ge=0, default=0)
    other_direct_cost_per_sale: float = Field(ge=0, default=0)

    monthly_software_cost: float = Field(ge=0)
    monthly_marketing_cost: float = Field(ge=0)
    monthly_admin_cost: float = Field(ge=0)
    monthly_rent_cost: float = Field(ge=0, default=0)
    monthly_other_fixed_cost: float = Field(ge=0, default=0)

    hours_required_per_sale: float = Field(ge=0, default=0)
    available_delivery_hours_per_month: float = Field(ge=0, default=0)

    demand_evidence_type: DemandEvidenceType
    number_of_interested_leads: int = Field(ge=0, default=0)
    number_of_paying_customers: int = Field(ge=0, default=0)

    competitor_price_low: float = Field(ge=0, default=0)
    competitor_price_high: float = Field(ge=0, default=0)
    differentiation_level: DifferentiationLevel = "medium"
    country: Optional[str] = None

    # Simplified cost / capacity fields (optional; used when detailed breakdown is not filled)
    assumed_cost_per_unit: float = Field(ge=0, default=0)
    required_capacity: float = Field(ge=0, default=0)

    @model_validator(mode="after")
    def validate_competitor_prices(self):
        if self.competitor_price_high and self.competitor_price_low and self.competitor_price_high < self.competitor_price_low:
            raise ValueError("competitor_price_high must be >= competitor_price_low")
        return self


class ServiceIdeaValidateResponse(BaseModel):
    service_name: str
    metrics: dict
    scores: dict
    outcome: str
    risk_flags: list[str]
    interpretation: dict