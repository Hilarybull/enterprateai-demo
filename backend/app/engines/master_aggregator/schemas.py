"""Master Aggregator schemas (Blueprint v3)."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class StructuralClassification(str, Enum):
    BALANCED_BUSINESS = "BALANCED_BUSINESS"
    VIABLE_BUT_CASH_CRITICAL = "VIABLE_BUT_CASH_CRITICAL"
    GROWTH_READY_BUT_UNSTABLE = "GROWTH_READY_BUT_UNSTABLE"
    STABLE_BUT_STAGNANT = "STABLE_BUT_STAGNANT"
    PROFITABLE_BUT_FRAGILE = "PROFITABLE_BUT_FRAGILE"
    SCALING_WITH_FRAGILITY = "SCALING_WITH_FRAGILITY"
    WEAK_FOUNDATION = "WEAK_FOUNDATION"
    CRITICAL_BUSINESS_STATE = "CRITICAL_BUSINESS_STATE"


@dataclass
class MasterAggregatorInput:
    """Engine scores passed into the Master Aggregator."""
    business_id: str
    viability_score: int        # 0–100 from Viability Engine
    survival_score: int         # 0–100 from Survival Engine
    stability_score: int        # 0–100 from Stability Engine
    growth_score: int           # 0–100 from Growth Engine
    fragility_index: int        # 0–100 from Fragility Engine (higher = more fragile)

    # Optional: per-engine risk flags and recommendations for consolidation
    viability_risks: List[str] = field(default_factory=list)
    survival_risks: List[str] = field(default_factory=list)
    stability_risks: List[str] = field(default_factory=list)
    growth_risks: List[str] = field(default_factory=list)
    fragility_risks: List[str] = field(default_factory=list)

    viability_recommendations: List[str] = field(default_factory=list)
    survival_recommendations: List[str] = field(default_factory=list)
    stability_recommendations: List[str] = field(default_factory=list)
    growth_recommendations: List[str] = field(default_factory=list)

    source: str = "manual"


@dataclass
class BIScoreBreakdown:
    """BI Score formula: 0.30×V + 0.25×S + 0.20×St + 0.25×G"""
    viability_contribution: float
    survival_contribution: float
    stability_contribution: float
    growth_contribution: float
    bi_score: int


@dataclass
class MasterAggregatorOutput:
    """Unified output from Master Aggregator."""
    engine: str = "master_aggregator"
    version: str = "v1"
    business_id: str = ""

    bi_score: int = 0
    bi_score_breakdown: Optional[BIScoreBreakdown] = None
    structural_classification: Optional[Dict[str, Any]] = None
    fragility_index: int = 0

    consolidated_risks: List[str] = field(default_factory=list)
    priority_recommendations: List[str] = field(default_factory=list)

    engine_summary: Dict[str, Any] = field(default_factory=dict)
    trace: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "engine": self.engine,
            "version": self.version,
            "business_id": self.business_id,
            "bi_score": self.bi_score,
            "bi_score_breakdown": self.bi_score_breakdown.__dict__ if self.bi_score_breakdown else None,
            "structural_classification": self.structural_classification,
            "fragility_index": self.fragility_index,
            "consolidated_risks": self.consolidated_risks,
            "priority_recommendations": self.priority_recommendations,
            "engine_summary": self.engine_summary,
            "trace": self.trace,
        }
