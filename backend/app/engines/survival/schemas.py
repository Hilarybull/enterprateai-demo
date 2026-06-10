"""Survival Engine schemas (Blueprint v3)."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Literal


class SurvivalScenario(str, Enum):
    """Classification of business survival state."""
    STRONG_SURVIVAL = "STRONG_SURVIVAL"
    STABLE_BUT_WATCH = "STABLE_BUT_WATCH"
    CASH_PRESSURED = "CASH_PRESSURED"
    HIGH_BURN_RISK = "HIGH_BURN_RISK"
    CRITICAL_SURVIVAL_RISK = "CRITICAL_SURVIVAL_RISK"


class RiskSeverity(str, Enum):
    """Risk severity levels."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"
    VERY_HIGH = "VERY_HIGH"


class ConfidenceLevel(str, Enum):
    """Confidence in the survival assessment."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass
class SurvivalEngineInput:
    """Input contract for Survival Engine."""
    business_id: str

    # Core financials
    cash_balance: float  # current cash on hand
    monthly_revenue: float
    monthly_expenses: float
    variable_costs_monthly: float
    fixed_costs_monthly: float
    net_cashflow_monthly: Optional[float] = None

    # Historical data
    revenue_last_6_months: Optional[List[float]] = None
    expenses_last_6_months: Optional[List[float]] = None
    net_cashflow_last_6_months: Optional[List[float]] = None

    # Liquidity options
    credit_available: float = 0.0
    overdraft_limit: float = 0.0
    committed_future_revenue: float = 0.0

    # Metadata
    source: Literal["manual", "imported", "integration"] = "manual"
    confidence_level: ConfidenceLevel = ConfidenceLevel.MEDIUM
    ruleset_version: str = "v1"


@dataclass
class SurvivalEngineMetrics:
    """Computed metrics from Survival Engine."""
    cash_balance: float
    monthly_revenue: float
    monthly_expenses: float
    net_cashflow_monthly: float
    burn_rate: float  # abs value of negative cashflow
    runway_months: Optional[float]  # None = infinite or not applicable
    volatility_ratio: Optional[float]  # std dev of cashflow
    liquidity_buffer: float  # total available liquidity


@dataclass
class SurvivalEngineScores:
    """Dimension scores (0–100)."""
    runway_score: int
    burn_score: int
    volatility_score: int
    survival_score: int


@dataclass
class RiskFlag:
    """Individual risk flag."""
    code: str
    severity: RiskSeverity
    explanation: str
    recommended_action: str
    priority_score: int


@dataclass
class Recommendation:
    """Recommendation for improvement."""
    type: str
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    text: str
    expected_impact: Optional[str] = None


@dataclass
class SurvivalInterpretation:
    """Human-readable interpretation."""
    headline: str
    driver_summary: str
    business_interpretation: str
    risk_outlook: str
    recommended_actions: List[str] = field(default_factory=list)


@dataclass
class ConfidenceInfo:
    """Confidence assessment."""
    level: ConfidenceLevel
    note: str
    penalty_applied: bool


@dataclass
class SurvivalEngineOutput:
    """Output contract for Survival Engine."""
    engine: str = "survival"
    version: str = "v1"
    business_id: str = ""

    metrics: Optional[SurvivalEngineMetrics] = None
    scores: Optional[SurvivalEngineScores] = None
    classification: Optional[Dict[str, Any]] = None

    risk_flags: List[RiskFlag] = field(default_factory=list)
    recommendations: List[Recommendation] = field(default_factory=list)

    interpretation: Optional[SurvivalInterpretation] = None
    confidence: Optional[ConfidenceInfo] = None

    trace: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for API response."""
        return {
            "engine": self.engine,
            "version": self.version,
            "business_id": self.business_id,
            "metrics": self.metrics.__dict__ if self.metrics else None,
            "scores": self.scores.__dict__ if self.scores else None,
            "classification": self.classification,
            "risk_flags": [rf.__dict__ for rf in self.risk_flags],
            "recommendations": [r.__dict__ for r in self.recommendations],
            "interpretation": self.interpretation.__dict__ if self.interpretation else None,
            "confidence": self.confidence.__dict__ if self.confidence else None,
            "trace": self.trace,
        }
