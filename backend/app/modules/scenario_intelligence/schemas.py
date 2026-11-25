from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict


ScenarioType = Literal[
    "hire_staff",
    "contractor_addition",
    "price_change",
    "client_loss",
    "revenue_drop",
    "payment_delay",
    "cost_increase",
    "service_launch",
    "reduce_fixed_cost",
    "delay_hiring",
    "take_loan",
    "raise_investment",
    "buy_equipment",
    "combined",
    "do_nothing_projection",
]

ScenarioMode = Literal["adaptive", "manual", "adaptive_or_manual"]


class BusinessStateSnapshot(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    revenue_monthly: float = Field(default=0, ge=0)
    expenses_monthly: float = Field(default=0, ge=0)
    cost_of_sales_monthly: float = Field(default=0, ge=0)
    costs_monthly: float = Field(default=0, ge=0)
    accrued_revenue_total: float | None = Field(default=0, ge=0)
    accrued_expenses_total: float | None = Field(default=0, ge=0)
    accrued_cost_of_sales_total: float | None = Field(default=0, ge=0)
    starting_cash: float = Field(default=0)
    top_client_share_pct: float | None = Field(default=None, ge=0, le=100)
    # Some upstream modules may temporarily report extreme utilisation values (e.g. > 200%).
    # Accept them here to avoid hard failures in simulation flows; UI can clamp for display.
    capacity_utilisation_pct: float | None = Field(default=None, ge=0, le=10000)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    sales_cycle_days: int | None = Field(default=None, ge=0, le=365)
    clients_count: int | None = Field(default=None, ge=0)
    approaching_receivables_count: int | None = Field(default=0, ge=0)
    overdue_receivables_count: int | None = Field(default=0, ge=0)
    approaching_payables_count: int | None = Field(default=0, ge=0)
    overdue_payables_count: int | None = Field(default=0, ge=0)
    pending_receivables_schedule: List[float] = Field(default_factory=list)
    pending_payables_schedule: List[float] = Field(default_factory=list)
    opening_accrual_balance: float | None = Field(default=0, ge=0)

    # ── Simulation audit, Phase 1 (17 Nov 2026) ────────────────────────────────────────────────────────────────────
    # Monthly history {"YYYY-MM": amount}, already built by the page (financialIntelligence.js). The baseline uses
    # complete months only, with trend and seasonality when the data supports them (projection baseline, audit F8).
    revenue_by_month: Dict[str, float] = Field(default_factory=dict)
    cost_of_sales_by_month: Dict[str, float] = Field(default_factory=dict)
    expenses_by_month: Dict[str, float] = Field(default_factory=dict)
    # Where each monthly figure came from, in words, when it is the shared figure (set by the server from
    # agent/figures.py, the figures the dashboard, risk check and Agent use). Keys: revenue_monthly, expenses_monthly...
    figure_sources: Dict[str, str] = Field(default_factory=dict)
    # Items left out of the figures because their currency had no exchange rate (audit F8: used to be silent)
    excluded_fx_items: int | None = Field(default=0, ge=0)
    # Money owed by week for the 13-week cash view: index 0 = due in the next 7 days or already overdue
    pending_receivables_weekly: List[float] = Field(default_factory=list)
    pending_payables_weekly: List[float] = Field(default_factory=list)
    # Business settings for projections. Each is optional; when not given it is left out and the run says so.
    profit_tax_rate_pct: float | None = Field(default=None, ge=0, le=100)
    tax_payment_month: int | None = Field(default=None, ge=1, le=24)
    sales_tax_rate_pct: float | None = Field(default=None, ge=0, le=100)      # VAT/GST, when registered
    sales_tax_period_months: int | None = Field(default=None, ge=1, le=12)
    sales_tax_on_costs_pct: float | None = Field(default=None, ge=0, le=100)  # share of costs that carry reclaimable tax
    existing_loan_balance: float | None = Field(default=None, ge=0)
    existing_loan_annual_rate_pct: float | None = Field(default=None, ge=0, le=100)
    existing_loan_monthly_repayment: float | None = Field(default=None, ge=0)
    cost_inflation_pct: float | None = Field(default=None, ge=0, le=100)  # a year, applied to costs with no trend
    # Simulation audit, Phase 5 (model 1.4): the further factors of a standard forecast. All optional; blank = not modelled.
    tax_country: str | None = Field(default=None, max_length=60)            # GB / NG / US (or a country name): payroll rules
    profit_tax_regime: Literal["flat", "uk_corporation_tax"] | None = None   # UK bands and marginal relief, or the flat rate
    tax_losses_brought_forward: float | None = Field(default=None, ge=0)    # earlier losses that reduce taxable profit
    funding_events: List[Dict[str, Any]] = Field(default_factory=list)     # [{type: equity|owner_capital|grant, amount, month}]
    owner_drawings_monthly: float | None = Field(default=None, ge=0)        # cash the owners take out each month (not a cost)
    dividends: List[Dict[str, Any]] = Field(default_factory=list)          # [{amount, month}] (cash out, not a cost)
    capital_purchases: List[Dict[str, Any]] = Field(default_factory=list)  # [{amount, month, life_months}] equipment
    bad_debt_pct: float | None = Field(default=None, ge=0, le=100)          # share of sales never collected
    payroll_staff_count: int | None = Field(default=None, ge=0, le=10000)
    payroll_gross_monthly_per_person: float | None = Field(default=None, ge=0)
    payroll_in_recorded_expenses: bool | None = None                        # True: salaries are already in the expenses
    employer_pension_pct: float | None = Field(default=None, ge=0, le=100)   # overrides the country's minimum
    # Phase 6 (model 1.5): from the business's records (records.py), set by the server
    current_month_recorded: Dict[str, Any] | None = None     # this month so far: {month, revenue, cost_of_sales, expenses, ...}
    figure_notes: List[str] = Field(default_factory=list)    # why a figure differs from the dashboard's, in words
    record_checks: Dict[str, Any] | None = None              # Phase 6 (1.6): duplicates, uncategorised, undated records


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


    @field_validator("parameters")
    @classmethod
    def checked_parameters(cls, value):
        from app.modules.scenario_intelligence.validation import validate_parameters
        return validate_parameters(value)

    @model_validator(mode="after")
    def required_inputs(self):
        if self.scenario_mode == "manual":
            from app.modules.scenario_intelligence.service import resolve_template
            template = resolve_template(self.scenario_template_id)
            for key in (template.required_inputs if template else []):
                if key in ("employer_oncost_pct", "cost_classification"):  # optional country-rule override, disclosed by the engine
                    continue
                if self.parameters.get(key) in (None, ""):
                    raise ValueError(f"{key.replace('_', ' ').capitalize()} is required before running this scenario.")
        from app.modules.scenario_intelligence.validation import validate_settings
        validate_settings(self.state, self.parameters.get("timeline_months", 6))
        return self


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
    baseline_snapshot: Dict[str, Any] | None = None
    scenario_snapshot: Dict[str, Any] | None = None
    baseline_metrics: Dict[str, Any]
    scenario_metrics: Dict[str, Any]
    deltas: Dict[str, Any]
    state_result: Literal["improved", "neutral", "worse"]
    timeline_summary: Dict[str, str]
    risk_signals: List[RiskSignal] = Field(default_factory=list)
    recommendations: List[Dict[str, Any]]
    # What the run was asked with: {"basis": "estimate", "estimate_basis": "£70 × 25 a month, ..."} when it ran from an estimate (QA PF4).
    parameters: Dict[str, Any] = Field(default_factory=dict)
    # Multi-engine outputs (baseline + scenario + deltas for all 5 engines)
    multi_engine: Dict[str, Any] | None = Field(default=None, description="Multi-engine orchestration output (viability, survival, growth, fragility, stability)")
    survival_delta: Dict[str, Any] | None = Field(default=None, description="Survival engine delta (baseline -> scenario)")
    growth_delta: Dict[str, Any] | None = Field(default=None, description="Growth engine delta (baseline -> scenario)")
    fragility_delta: Dict[str, Any] | None = Field(default=None, description="Fragility engine delta (baseline -> scenario)")


class ScenarioTimelineEntry(BaseModel):
    month_index: int
    revenue: float
    accruals: float = 0
    expenses: float
    cost_of_sales: float
    gross_profit: float = 0
    gross_margin_pct: float = 0
    costs: float
    profit: float
    cumulative_profit: float = 0
    cash_balance: float
    cash_runway_months: Optional[float] = None
    stability_score: float
    state_label: Literal["stable", "tight", "at_risk", "stress", "critical"]
    
    # Risk Enhancement Ratios. None with a state saying why (QA PF4): "unavailable" (nothing to compare with) or
    # "unbounded" (money owed and no cash against it), never a figure made from zeros.
    cash_conversion_ratio: Optional[float] = None
    cash_conversion_state: Literal["ok", "unavailable", "unbounded"] = "ok"
    receivable_exposure_ratio: Optional[float] = 0.0
    receivable_exposure_state: Literal["ok", "unavailable", "unbounded"] = "ok"
    delayed_revenue_pct: Optional[float] = 0.0
    delayed_revenue_state: Literal["ok", "unavailable", "unbounded"] = "ok"


class ScenarioTimelineResponse(BaseModel):
    scenario_run_id: str
    timeline: List[ScenarioTimelineEntry]


class DoNothingRequest(BaseModel):
    tenant_id: str
    business_id: str
    state_version: str
    timeline_months: int = Field(default=3, ge=3, le=24)
    state: BusinessStateSnapshot
    parameters: Dict[str, Any] = Field(default_factory=dict)      # {"use_estimate": True}: from the owner's own pricing answers (QA PF4)

    @model_validator(mode="after")
    def checked_settings(self):
        from app.modules.scenario_intelligence.validation import validate_settings
        validate_settings(self.state, self.timeline_months)
        return self


class DoNothingResponse(BaseModel):
    projection_id: str
    timeline_months: int
    forecast: List[Dict[str, Any]]
    starting_cash: Optional[float] = None      # the cash the projection starts from, so the table opens on it
    # Horizon totals, closing cash, reconciliation checks and the assumptions used (simulation audit, Phase 0)
    summary: Optional[Dict[str, Any]] = None


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
    model_version: Optional[str] = None      # Phase 6: the model that made it
    outcome: Optional[str] = None


class ScenarioHistoryResponse(BaseModel):
    history: List[ScenarioHistoryItem]
