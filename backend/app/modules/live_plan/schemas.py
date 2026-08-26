from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


LivePlanStatus = Literal["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"]
LivePlanSourceType = Literal[
    "INITIAL_ADOPTION",
    "MANUAL_UPDATE",
    "SCENARIO_ADOPTION",
    "ANNUAL_REVIEW",
    "IMPORTED_PLAN",
    "GENERATED_PLAN",
    "ADMIN_CORRECTION",
]
LivePlanDomain = Literal[
    "COMMERCIAL",
    "FINANCIAL",
    "CUSTOMER",
    "OPERATIONAL",
    "GROWTH",
    "MARKET",
    "STRATEGIC",
]
PlannedChangeOperation = Literal["CREATE", "UPDATE", "REMOVE"]
PlannedChangeStatus = Literal["PLANNED", "DUE", "COMPLETED", "MISSED", "CANCELLED", "SUPERSEDED"]
AlertStatus = Literal["OPEN", "ACKNOWLEDGED", "DISMISSED", "RESOLVED"]
KpiDirection = Literal["up", "down", "match"]


class LivePlanCreateRequest(BaseModel):
    idempotency_key: str | None = None
    source_document_id: str | None = None
    note: str | None = None


class LivePlanAdoptRequest(BaseModel):
    idempotency_key: str | None = None


class LivePlanScenarioAdoptRequest(BaseModel):
    idempotency_key: str | None = None
    note: str | None = None


class LivePlanKPICreateRequest(BaseModel):
    idempotency_key: str | None = None
    code: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=120)
    domain: LivePlanDomain
    metric_path: str | None = None
    target_value: Any | None = None
    tolerance: Any | None = None
    actual_value: Any | None = None
    unit: str | None = None
    direction: KpiDirection = "up"
    source_type: str | None = None
    source_reference_id: str | None = None
    observed_at: datetime | None = None
    confidence_score: float | None = None
    notes: str | None = None


class LivePlanKPIUpdateRequest(BaseModel):
    idempotency_key: str | None = None
    code: str | None = None
    name: str | None = None
    domain: LivePlanDomain | None = None
    metric_path: str | None = None
    target_value: Any | None = None
    tolerance: Any | None = None
    actual_value: Any | None = None
    unit: str | None = None
    direction: KpiDirection | None = None
    source_type: str | None = None
    source_reference_id: str | None = None
    observed_at: datetime | None = None
    confidence_score: float | None = None
    notes: str | None = None


class LivePlanNarrativeRefreshRequest(BaseModel):
    idempotency_key: str | None = None
    section: str | None = None


class LivePlanImportExtractRequest(BaseModel):
    idempotency_key: str | None = None
    document_id: str | None = None   # existing blueprint document ID
    raw_content: str | None = None   # pasted/uploaded text content


class LivePlanResponse(BaseModel):
    business_id: str
    plan: dict[str, Any]


class LivePlanCompareResponse(BaseModel):
    business_id: str
    version_a: str
    version_b: str
    comparison: dict[str, Any]


class LivePlanPerformanceResponse(BaseModel):
    business_id: str
    performance: dict[str, Any]


class LivePlanKPIListResponse(BaseModel):
    business_id: str
    kpis: list[dict[str, Any]]


class LivePlanVarianceResponse(BaseModel):
    business_id: str
    variances: list[dict[str, Any]]


class LivePlanAlertResponse(BaseModel):
    business_id: str
    alerts: list[dict[str, Any]]

