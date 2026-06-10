"""Growth Engine schemas (Blueprint v3)."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional


class GrowthClassification(str, Enum):
    HIGH_GROWTH_POTENTIAL = "HIGH_GROWTH_POTENTIAL"
    GROWTH_READY = "GROWTH_READY"
    LIMITED_GROWTH = "LIMITED_GROWTH"
    LOW_SCALABILITY = "LOW_SCALABILITY"
    SCALING_CONSTRAINT = "SCALING_CONSTRAINT"
    COMMODITY_TRAP = "COMMODITY_TRAP"


# Keep legacy alias so existing imports don't break during transition
GrowthTrajector = GrowthClassification


@dataclass
class ProductDeliveryInput:
    """How the product/service is delivered (Blueprint v3)."""
    is_digital_or_scalable: bool = False        # can scale without linear cost
    has_recurring_revenue: bool = False          # subscription / retainer model
    delivery_requires_owner_presence: bool = True
    can_delegate_delivery: bool = False
    has_repeatable_process: bool = False


@dataclass
class MarketExpansionInput:
    """Market expansion potential (Blueprint v3)."""
    served_market_size_estimate: Optional[float] = None   # rough TAM, any currency
    current_market_share_pct: Optional[float] = None      # 0–100
    new_segment_potential: bool = False
    geographic_expansion_possible: bool = False
    online_channel_available: bool = False


@dataclass
class PricingInput:
    """Pricing strategy indicators (Blueprint v3)."""
    is_value_based_pricing: bool = False         # vs cost-plus / market pricing
    has_premium_tier: bool = False
    average_deal_value: Optional[float] = None
    price_increase_feasibility: Literal["low", "medium", "high"] = "low"


@dataclass
class CompetitiveInput:
    """Competitive positioning (Blueprint v3)."""
    has_unique_differentiator: bool = False
    switching_cost_for_customers: Literal["low", "medium", "high"] = "low"
    number_of_direct_competitors: int = 10
    competitor_pricing_pressure: Literal["high", "medium", "low"] = "high"


@dataclass
class GrowthEngineInput:
    """Input contract for Growth Engine (Blueprint v3)."""
    business_id: str

    product_delivery: Optional[ProductDeliveryInput] = None
    market_expansion: Optional[MarketExpansionInput] = None
    pricing: Optional[PricingInput] = None
    competitive: Optional[CompetitiveInput] = None

    # Optional revenue history for trend context
    revenue_last_6_months: Optional[List[float]] = None

    source: Literal["manual", "imported", "integration"] = "manual"


@dataclass
class GrowthEngineScores:
    """Dimension scores (0–100, higher = stronger growth potential)."""
    delivery_scalability_score: int     # product/service delivery scalability
    market_expansion_score: int         # market opportunity & addressability
    pricing_leverage_score: int         # pricing power and value capture
    competitive_moat_score: int         # competitive positioning strength
    growth_score: int                   # weighted aggregate


@dataclass
class GrowthEngineMetrics:
    """Computed growth metrics."""
    market_penetration_pct: float
    expansion_headroom_pct: float
    revenue_trend_pct: Optional[float]      # 6-month trend if available
    scalability_multiplier: str             # "linear" | "sub-linear" | "exponential"


@dataclass
class GrowthEngineOutput:
    """Output contract for Growth Engine."""
    engine: str = "growth"
    version: str = "v2"
    business_id: str = ""

    metrics: Optional[GrowthEngineMetrics] = None
    scores: Optional[GrowthEngineScores] = None
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
