"""Fragility Engine schemas (Blueprint v3).

The 6 fragility dimensions are derived from engine scores:
  cash       — survival engine runway/cash health (inverted)
  revenue    — stability engine predictability (inverted)
  customer   — stability engine customer concentration (inverted)
  operational — stability engine operational dependency (inverted)
  capacity   — stability engine capacity health (inverted)
  market     — viability engine market risk (inverted)

Each dimension score is 0–100 (higher = MORE fragile).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional


class FragilityLevel(str, Enum):
    RESILIENT = "RESILIENT"
    STABLE_WITH_EXPOSURE = "STABLE_WITH_EXPOSURE"
    FRAGILE = "FRAGILE"
    HIGHLY_FRAGILE = "HIGHLY_FRAGILE"
    CRITICAL_FRAGILITY = "CRITICAL_FRAGILITY"


@dataclass
class FragilityEngineInput:
    """Input contract for Fragility Engine (Blueprint v3)."""
    business_id: str

    # --- Primary path: engine-score derived dimensions ---
    # Each is a HEALTH score (0–100, higher = healthier).
    # The engine inverts them: fragility_dim = 100 - health_score.
    survival_cash_health: Optional[int] = None        # from Survival Engine
    stability_predictability: Optional[int] = None    # from Stability Engine
    stability_customer: Optional[int] = None          # from Stability Engine
    stability_operational: Optional[int] = None       # from Stability Engine
    stability_capacity: Optional[int] = None          # from Stability Engine
    viability_market_health: Optional[int] = None     # from Viability Engine

    # --- Fallback / structural inputs (used when engine scores absent) ---
    top_client_share_pct: Optional[float] = None      # 0–100
    top_3_clients_share_pct: Optional[float] = None
    client_count: int = 1
    founder_dependency: bool = True
    management_team_size: int = 1
    key_person_roles_covered: int = 0
    single_supplier_dependency: bool = False
    supply_chain_concentration: int = 1               # 1=singular, 5=diversified
    technology_dependency: bool = False
    key_systems_redundancy: int = 0
    regulatory_exposure: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"
    debt_to_equity_ratio: Optional[float] = None
    fixed_cost_ratio: Optional[float] = None
    working_capital_days: Optional[int] = None

    source: Literal["manual", "imported", "integration"] = "manual"


@dataclass
class FragilityDimensions:
    """6-dimension fragility scores (0–100, higher = MORE fragile)."""
    cash: int           # cash/runway fragility
    revenue: int        # revenue predictability fragility
    customer: int       # customer concentration fragility
    operational: int    # operational dependency fragility
    capacity: int       # capacity health fragility
    market: int         # market exposure fragility


@dataclass
class FragilityEngineScores:
    """Scores used by Master Aggregator."""
    fragility_index: int    # weighted aggregate (0–100)
    dimensions: Optional[FragilityDimensions] = None


@dataclass
class FragilityEngineOutput:
    """Output contract for Fragility Engine."""
    engine: str = "fragility"
    version: str = "v2"
    business_id: str = ""

    scores: Optional[FragilityEngineScores] = None
    classification: Optional[Dict[str, Any]] = None

    risk_flags: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)

    trace: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        dims = self.scores.dimensions.__dict__ if (self.scores and self.scores.dimensions) else None
        return {
            "engine": self.engine,
            "version": self.version,
            "business_id": self.business_id,
            "scores": {
                "fragility_index": self.scores.fragility_index if self.scores else 0,
                "dimensions": dims,
            } if self.scores else None,
            "classification": self.classification,
            "risk_flags": self.risk_flags,
            "recommendations": self.recommendations,
            "trace": self.trace,
        }
