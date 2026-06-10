"""Stability Engine schemas (Blueprint v3)."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional


class StabilityClassification(str, Enum):
    HIGHLY_STABLE = "HIGHLY_STABLE"
    STABLE = "STABLE"
    MODERATELY_STABLE = "MODERATELY_STABLE"
    UNSTABLE = "UNSTABLE"
    HIGHLY_UNSTABLE = "HIGHLY_UNSTABLE"
    CUSTOMER_DEPENDENT = "CUSTOMER_DEPENDENT"
    OPERATIONALLY_FRAGILE = "OPERATIONALLY_FRAGILE"


@dataclass
class StabilityEngineInput:
    """Input contract for Stability Engine (Blueprint v3)."""
    business_id: str

    # Revenue history (last 6 months, oldest first)
    revenue_last_6_months: Optional[List[float]] = None

    # Customer concentration
    top1_customer_revenue_pct: Optional[float] = None   # 0–100
    top3_customer_revenue_pct: Optional[float] = None   # 0–100
    customer_count: int = 0

    # Operational dependency
    key_person_dependency: bool = True
    has_documented_processes: bool = False
    has_backup_personnel: bool = False
    automation_level_pct: Optional[float] = None        # 0–100

    # Capacity
    capacity_utilisation_pct: Optional[float] = None    # 0–100
    order_backlog_months: Optional[float] = None        # months of confirmed pipeline

    # Source
    source: Literal["manual", "imported", "integration"] = "manual"


@dataclass
class StabilityEngineScores:
    """Dimension scores (0–100, higher = more stable)."""
    predictability_score: int       # Revenue predictability
    customer_stability_score: int   # Customer concentration risk
    operational_dependency_score: int  # Key-person / process risk
    capacity_health_score: int      # Utilisation vs backlog
    stability_score: int            # Weighted aggregate


@dataclass
class StabilityEngineMetrics:
    """Computed metrics."""
    revenue_volatility_pct: Optional[float]    # Coefficient of variation
    revenue_trend_pct: Optional[float]         # 6-month growth trend
    top1_customer_revenue_pct: float
    top3_customer_revenue_pct: float
    capacity_utilisation_pct: float
    order_backlog_months: float


@dataclass
class StabilityEngineOutput:
    """Output contract for Stability Engine."""
    engine: str = "stability"
    version: str = "v1"
    business_id: str = ""

    metrics: Optional[StabilityEngineMetrics] = None
    scores: Optional[StabilityEngineScores] = None
    classification: Optional[Dict[str, Any]] = None

    risk_flags: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)

    trace: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "engine": self.engine,
            "version": self.version,
            "business_id": self.business_id,
            "metrics": self.metrics.__dict__ if self.metrics else None,
            "scores": self.scores.__dict__ if self.scores else None,
            "classification": self.classification,
            "risk_flags": self.risk_flags,
            "recommendations": self.recommendations,
            "trace": self.trace,
        }
