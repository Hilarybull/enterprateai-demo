from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ScenarioType = Literal[
    "hire_staff",
    "contractor_addition",
    "price_change",
    "client_loss",
    "revenue_drop",
    "payment_delay",
    "cost_increase",
    "service_launch",
    "do_nothing_projection",
]

ScenarioMode = Literal["adaptive", "manual", "adaptive_or_manual"]


class BusinessStateSnapshot(BaseModel):
    revenue_monthly: float = Field(default=0, ge=0)
    costs_monthly: float = Field(default=0, ge=0)
    starting_cash: float = Field(default=0, ge=0)
    top_client_share_pct: float | None = Field(default=None, ge=0, le=100)
    capacity_utilisation_pct: float | None = Field(default=None, ge=0, le=200)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    sales_cycle_days: int | None = Field(default=None, ge=0, le=365)
    clients_count: int | None = Field(default=None, ge=0)


class RiskDetectionRequest(BaseModel):
    tenant_id: str
    business_id: str
    state_version: str
    state: BusinessStateSnapshot


class RiskSignal(BaseModel):
    risk_signal_id: str
    risk_type: str
    severity: Literal["low", "medium", "high"]
    metric_name: str
    metric_value: float | int | None
    threshold_value: float | int | None
    reason_code: str


class RiskDetectionResponse(BaseModel):
    business_id: str
    engine_version: str
    risk_signals: List[RiskSignal]


class RecommendationGenerateRequest(BaseModel):
    tenant_id: str
    business_id: str
    state_version: str
    risk_signal_ids: List[str] = Field(default_factory=list)
    state: BusinessStateSnapshot


class ScenarioRecommendation(BaseModel):
    scenario_template_id: str
    scenario_type: ScenarioType
    title: str
    trigger_reason: str
    priority: int


class RecommendationGenerateResponse(BaseModel):
    business_id: str
    recommended_scenarios: List[ScenarioRecommendation]


class ScenarioTemplate(BaseModel):
    scenario_template_id: str
    scenario_type: ScenarioType
    title: str
    mode: ScenarioMode
    required_inputs: List[str]
    description: Optional[str] = None


class ScenarioTemplateListResponse(BaseModel):
    templates: List[ScenarioTemplate]


class ScenarioRunRequest(BaseModel):
    tenant_id: str
    business_id: str
    state_version: str
    scenario_template_id: str
    scenario_mode: Literal["adaptive", "manual"]
    scenario_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    state: BusinessStateSnapshot


class ScenarioRunResponse(BaseModel):
    scenario_run_id: str
    status: Literal["pending", "completed", "failed"]
    engine_version: str
    baseline_snapshot_id: str
    timeline_months: int


class ScenarioRunResult(BaseModel):
    scenario_run_id: str
    scenario_name: str
    scenario_type: ScenarioType
    baseline_metrics: Dict[str, Any]
    scenario_metrics: Dict[str, Any]
    deltas: Dict[str, Any]
    state_result: Literal["improved", "neutral", "worse"]
    timeline_summary: Dict[str, str]
    recommendations: List[Dict[str, Any]]


class ScenarioTimelineEntry(BaseModel):
    month_index: int
    revenue: float
    costs: float
    profit: float
    cash_balance: float
    stability_score: float
    state_label: Literal["stable", "tight", "risk"]


class ScenarioTimelineResponse(BaseModel):
    scenario_run_id: str
    timeline: List[ScenarioTimelineEntry]


class DoNothingRequest(BaseModel):
    tenant_id: str
    business_id: str
    state_version: str
    timeline_months: int = Field(default=3, ge=1, le=12)
    state: BusinessStateSnapshot


class DoNothingResponse(BaseModel):
    projection_id: str
    timeline_months: int
    forecast: List[Dict[str, Any]]


class ScenarioDecisionRequest(BaseModel):
    decision_status: Literal["accepted", "rejected", "deferred"]
    selected_recommendation_id: Optional[str] = None
    notes: Optional[str] = None


class ScenarioDecisionResponse(BaseModel):
    scenario_run_id: str
    decision_status: str
    decision_memory_id: str


class ScenarioHistoryItem(BaseModel):
    scenario_run_id: str
    scenario_name: str
    scenario_type: ScenarioType
    executed_at: str
    decision_status: Optional[str]
    state_result: Optional[str]


class ScenarioHistoryResponse(BaseModel):
    history: List[ScenarioHistoryItem]
