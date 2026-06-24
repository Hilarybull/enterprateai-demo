from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class IdeaValidationInputs:
    """Core inputs for deterministic idea validation."""
    idea_name: str
    idea_description: str
    target_customer: str
    problem_description: str
    pain_level: str  # e.g., "mild", "moderate", "severe"
    alternatives: str
    differentiation: str
    market_scope: str
    evidence_signals: List[str] = field(default_factory=list)
    spoken_to_count: str = "0"
    estimated_price: Optional[float] = None
    expected_units_per_month: float = 0.0
    variable_cost_per_unit: float = 0.0
    fixed_costs_monthly: float = 0.0
    currency: str = "GBP"


@dataclass
class ResearchSignals:
    """External signals retrieved via SERPAPI/Research."""
    demand_score: float = 0.0  # 0-100
    competition_level: str = "medium"  # low, medium, high
    trend_score: float = 0.0  # 0-100
    competitor_count: int = 0
    search_volume_index: float = 0.0


def evaluate_idea_validation_v3(
    inputs: IdeaValidationInputs,
    research: Optional[ResearchSignals] = None
) -> Dict[str, Any]:
    """
    Standard Idea Validation scoring engine (v3.0).
    A high-integrity analytical model for early-stage idea verification.
    
    Weights:
    - Problem Severity: 20%
    - Customer Clarity: 15%
    - Demand Validation: 20%
    - Market Evidence (Live Signals): 15%
    - Differentiation: 15%
    - Trend Strength: 15%
    """
    scores = {}
    
    # 1. Problem Severity (20%) - Urgent Pain vs 'Nice to Have'
    severity_map = {"mild": 35, "moderate": 70, "severe": 100}
    scores["problem_severity"] = severity_map.get(inputs.pain_level.lower(), 50)
    
    # 2. Customer Clarity (15%) - Niche Specificity
    cust = inputs.target_customer.lower()
    if any(x in cust for x in ["everyone", "anybody", "all people", "global", "general"]):
        scores["customer_clarity"] = 30
    elif len(cust.split()) >= 4: # Detailed segment description
        scores["customer_clarity"] = 95
    elif len(cust.split()) >= 2:
        scores["customer_clarity"] = 70
    else:
        scores["customer_clarity"] = 45
    
    # 3. Existing Demand (20%) - Ground Truth Validation
    spoken_map = {"0": 15, "1-5": 45, "5-10": 65, "10-20": 85, "20+": 100}
    base_demand = spoken_map.get(inputs.spoken_to_count, 15)
    
    proof_boost = 0
    signals = [s.lower() for s in (inputs.evidence_signals or [])]
    if any(x in signals for x in ["preorder", "payment", "customer", "contract", "revenue"]):
        proof_boost = 35
    elif any(x in signals for x in ["waitlist", "loi", "signup", "email"]):
        proof_boost = 20
        
    scores["demand_validation"] = min(100, base_demand + proof_boost)
    
    # 4. Market Evidence (15%) - External Validation
    res_demand = research.demand_score if research else 50
    comp_bonus = 0
    if research and research.competitor_count > 0:
        # Balanced: too many competitors = crowded, but 3-10 = validation of market existence
        if 3 <= research.competitor_count <= 12:
            comp_bonus = 20
        else:
            comp_bonus = 10
    
    scores["market_evidence"] = min(100, int(res_demand * 0.8 + comp_bonus))
    
    # 5. Differentiation (15%) - Sustainable Competitive Advantage
    diff_text = inputs.differentiation.strip()
    if len(diff_text) > 200:
        scores["differentiation"] = 100
    elif len(diff_text) > 100:
        scores["differentiation"] = 85
    elif len(diff_text) > 40:
        scores["differentiation"] = 65
    else:
        scores["differentiation"] = 40
        
    # 6. Trend Strength (15%) - Market Momentum
    scores["trend_strength"] = research.trend_score if research else 60
    
    # Final Calculation
    weighted_score = (
        (scores["problem_severity"] * 0.20) +
        (scores["customer_clarity"] * 0.15) +
        (scores["demand_validation"] * 0.20) +
        (scores["market_evidence"] * 0.15) +
        (scores["differentiation"] * 0.15) +
        (scores["trend_strength"] * 0.15)
    )
    
    if weighted_score >= 85:
        classification = "High Integrity Concept"
    elif weighted_score >= 70:
        classification = "Strong Potential"
    elif weighted_score >= 50:
        classification = "Developing Fit"
    elif weighted_score >= 30:
        classification = "Early Stage / Risky"
    else:
        classification = "High Failure Risk"
        
    # Insight Generation (Professional Logic)
    reasons = []
    recs = []
    
    if scores["demand_validation"] < 60:
        reasons.append("Evidence of product-market fit is currently anecdotal; missing direct commercial commitment.")
        recs.append("Secure at least 3 Letters of Intent (LOIs) or paid pre-orders to validate financial intent.")
        
    if scores["customer_clarity"] < 50:
        reasons.append("Target segment is overly broad, risking inefficient marketing spend and generic messaging.")
        recs.append("Narrow your launch segment to a single 'beachhead' niche to achieve 10x higher conversion.")
        
    if scores["differentiation"] < 50:
        reasons.append("The unique value proposition (UVP) lacks clear contrast against established incumbents.")
        recs.append("Define a specific 'unfair advantage' or a unique workflow skip that incumbents cannot replicate.")

    if not reasons:
        reasons.append("Solid baseline indicators across all major validation dimensions.")

    return {
        "score": round(weighted_score),
        "classification": classification,
        "reasons": reasons[:4],
        "recommendations": recs[:4],
        "dimension_scores": scores,
        "metrics": {
            "research_demand": research.demand_score if research else 50,
            "competitor_count": research.competitor_count if research else 0,
            "trend": research.trend_score if research else 50,
            "rubric_v": "3.0"
        }
    }
