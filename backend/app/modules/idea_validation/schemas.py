from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict

from app.shared.schemas.common import WorkspaceDocument


class CreateValidationWorkspaceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    data: Dict[str, Any] = Field(default_factory=dict)


class CreateWorkspaceResponse(BaseModel):
    id: str
    name: str
    created_at: datetime


class WorkspaceResponse(BaseModel):
    id: str
    user_id: str
    name: str
    data: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_doc(cls, doc: WorkspaceDocument) -> "WorkspaceResponse":
        return cls(
            id=str(doc.id),
            user_id=doc.user_id,
            name=doc.name,
            data=doc.data,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )


class FinancialInputsPayload(BaseModel):
    price_per_unit: float = Field(ge=0)
    units_per_month: float = Field(ge=0)
    fixed_costs_monthly: float = Field(ge=0)
    variable_cost_per_unit: float = Field(ge=0)
    starting_cash: float = Field(ge=0)


Pathway = Literal["business_idea", "product_service_idea"]
PricingModel = Literal["hourly", "fixed_job", "retainer"]


class BusinessContext(BaseModel):
    model_config = ConfigDict(extra="ignore")
    business_name: str = Field(default="", max_length=80)
    business_type: str = Field(default="service_micro_business", max_length=80)
    primary_industry: str = Field(default="", max_length=80)
    location: str = Field(default="", max_length=80)
    uk_region: str = Field(default="GB-ENG", max_length=16)
    currency: str = Field(default="GBP", max_length=8)
    founder_hours_per_week: float = Field(default=40, ge=0, le=168)
    business_offering: Optional[str] = Field(default=None, max_length=1000)
    description: Optional[str] = Field(default=None, max_length=1000)
    stage: str = Field(default="idea", max_length=32)


class ProblemCustomer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_segment: str = Field(default="", max_length=120)
    problem_type: str = Field(default="", max_length=160)
    severity: str = Field(default="moderate", max_length=32)
    frequency: str = Field(default="", max_length=80)
    description: Optional[str] = Field(default=None, max_length=1000)
    alternatives: Optional[str] = Field(default=None, max_length=1000)


class OfferDefinition(BaseModel):
    service_type: str = Field(default="", max_length=80)
    pricing_model: PricingModel = "fixed_job"
    price_per_unit: float = Field(ge=0, default=0)
    deliverable_unit: str = Field(default="unit", max_length=32)


class DemandAssumptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    expected_units_per_month: float = Field(ge=0, default=0)
    expected_customers: int = Field(ge=0, default=0)
    sales_cycle_days: int = Field(ge=0, default=0)
    payment_terms_days: int = Field(ge=0, default=14)


class CostInputs(BaseModel):
    variable_cost_per_unit: float = Field(ge=0, default=0)
    fixed_costs_monthly: float = Field(ge=0, default=0)
    founder_draw_monthly: float = Field(ge=0, default=0)
    contractor_costs_monthly: float = Field(ge=0, default=0)


class CapacityInputs(BaseModel):
    team_size: int = Field(ge=1, le=50, default=1, description="Include founder as 1")
    capacity_units_per_person_per_month: float = Field(ge=0, default=0)


class CashBuffer(BaseModel):
    starting_cash: float = Field(ge=0, default=0)
    upfront_costs: float = Field(ge=0, default=0)


class ValidationAssumptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    spoken_count: str = Field(default="0")
    demand_proof: list[str] = Field(default_factory=list)


class ExistingBusinessSnapshot(BaseModel):
    existing_revenue_monthly: float = Field(ge=0, default=0)
    existing_costs_monthly: float = Field(ge=0, default=0)
    existing_capacity_units_per_month: float = Field(ge=0, default=0)


class IdeaValidationPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pathway: Pathway = "business_idea"
    context: BusinessContext
    problem: Optional[ProblemCustomer] = None
    offer: OfferDefinition
    demand: DemandAssumptions
    costs: CostInputs
    validation: Optional[ValidationAssumptions] = None
    capacity: Optional[CapacityInputs] = None
    cash: Optional[CashBuffer] = None
    existing_business: Optional[ExistingBusinessSnapshot] = None


class EvaluateRequest(BaseModel):
    workspace_id: Optional[str] = None
    inputs: Optional[FinancialInputsPayload] = None
    idea_validation: Optional[IdeaValidationPayload] = None


class ValidationResult(BaseModel):
    score: int
    classification: str
    reasons: list[str]
    recommendations: list[str]
    metrics: Dict[str, Any]
    pathway: Optional[Pathway] = None
    flags: list[str] = []
    dimension_scores: Dict[str, int] = {}
    dimension_explanations: Dict[str, str] = {}
    validation_explanation: str = ""
    score_pre_context: Optional[int] = None
    reason_codes: list[str] = []
    advisory_flags: list[str] = []
    rubric_version: str = ""


class UpdateWorkspaceRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=64)
    data: Dict[str, Any] = Field(default_factory=dict)


class MarketResearchRequest(BaseModel):
    workspace_id: Optional[str] = None
    idea_validation: Optional[Dict[str, Any]] = None
