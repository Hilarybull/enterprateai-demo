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


def evaluate_idea_v1(
    inputs: IdeaValidationInputs,
    research: Optional[ResearchSignals] = None
) -> Dict[str, Any]:
    """
    Deterministic scoring engine for early-stage idea validation.
    
    Weights:
    - Problem Severity: 20%
    - Market Demand (User + Research): 25%
    - Competition Validation: 15%
    - Differentiation: 15%
    - Evidence Strength: 15%
    - Market Trend: 10%
    """
    scores = {}
    
    # 1. Problem Severity (20%)
    severity_map = {"mild": 40, "moderate": 70, "severe": 100}
    scores["problem_severity"] = severity_map.get(inputs.pain_level.lower(), 50)
    
    # 2. Market Demand (25%)
    # Combine user perceived demand (if any) with research signals
    research_demand = research.demand_score if research else 50.0
    # Higher price can sometimes imply lower demand volume but higher quality
    scores["market_demand"] = research_demand
    
    # 3. Competition Validation (15%)
    # Competition is GOOD in validation because it proves a market exists.
    comp_map = {"low": 60, "medium": 100, "high": 80}
    scores["competition_validation"] = comp_map.get(research.competition_level if research else "medium", 70)
    
    # 4. Differentiation (15%)
    # Simple heuristic: longer description usually implies more thought/detail
    diff_len = len(inputs.differentiation.strip())
    diff_score = 50
    if diff_len > 100: diff_score = 100
    elif diff_len > 50: diff_score = 80
    elif diff_len > 20: diff_score = 60
    scores["differentiation"] = diff_score
    
    # 5. Evidence Strength (15%)
    spoken_map = {"0": 0, "1-5": 30, "5-10": 60, "10-20": 80, "20+": 100}
    evidence_score = spoken_map.get(inputs.spoken_to_count, 0)
    # Add bonus for specific proof types
    if inputs.evidence_signals:
        evidence_score = min(100, evidence_score + (len(inputs.evidence_signals) * 10))
    scores["evidence_strength"] = evidence_score
    
    # 6. Market Trend (10%)
    scores["market_trend"] = research.trend_score if research else 60.0
    
    # Calculate Total Weighted Score
    total_score = (
        (scores["problem_severity"] * 0.20) +
        (scores["market_demand"] * 0.25) +
        (scores["competition_validation"] * 0.15) +
        (scores["differentiation"] * 0.15) +
        (scores["evidence_strength"] * 0.15) +
        (scores["market_trend"] * 0.10)
    )
    
    # Classification
    classification = "Emerging"
    reasons = []
    recommendations = []
    
    if total_score >= 85:
        classification = "Strong Fit"
        reasons.append("High alignment across market demand, problem severity, and evidence.")
        recommendations.append("Begin detailed financial planning and MVP development.")
    elif total_score >= 70:
        classification = "Promising"
        reasons.append("Solid concept with clear demand signals, though some aspects need refinement.")
        recommendations.append("Focus on deepening differentiation and securing more specific market proof.")
    elif total_score >= 50:
        classification = "Developing"
        reasons.append("Concept is in early stages; market signals are mixed or incomplete.")
        recommendations.append("Conduct more customer interviews to validate the specific pain point.")
    else:
        classification = "High Risk"
        reasons.append("Significant gaps in market evidence or problem severity detected.")
        recommendations.append("Pivot the concept or conduct fundamental research into the problem space.")

    # Dimension-specific reasons
    if scores["problem_severity"] < 60:
        reasons.append("The identified problem is perceived as 'mild' or common, making it harder to monetize.")
        recommendations.append("Try to find a more 'urgent' or 'expensive' aspect of the problem to solve.")
    
    if scores["evidence_strength"] < 40:
        reasons.append("Limited direct evidence from potential customers at this stage.")
        recommendations.append("Speak to at least 10 more potential customers to gather direct feedback.")

    # Calculate Deterministic Metrics
    price = inputs.estimated_price or 0.0
    units = inputs.expected_units_per_month or 0.0
    var_cost = inputs.variable_cost_per_unit or 0.0
    fix_cost = inputs.fixed_costs_monthly or 0.0
    
    revenue_monthly = price * units
    costs_monthly = fix_cost + (var_cost * units)
    net_monthly = revenue_monthly - costs_monthly
    margin = (price - var_cost) / price if price > 0 else 0.0
    
    # Simple break-even calc (very basic for early stage)
    # If starting cash is ignored for now, how many months to cover FIXED costs?
    # This is more of a 'time to profitability' proxy if revenue > costs
    be_months = 0
    if revenue_monthly > costs_monthly:
        be_months = 1 # Immediate if monthly positive
    elif (price - var_cost) > 0:
        # If unit is profitable but fixed costs aren't covered yet
        be_months = fix_cost / (price - var_cost) if (price - var_cost) > 0 else 99
    else:
        be_months = 99 # Never
        
    return {
        "score": round(total_score),
        "classification": classification,
        "reasons": reasons,
        "recommendations": recommendations,
        "dimension_scores": {k: round(v) for k, v in scores.items()},
        "metrics": {
            "research_demand": research.demand_score if research else None,
            "competitor_count": research.competitor_count if research else 0,
            "trend": research.trend_score if research else None,
            "revenue_monthly": round(revenue_monthly, 2),
            "costs_monthly": round(costs_monthly, 2),
            "net_monthly": round(net_monthly, 2),
            "margin": round(margin, 4),
            "break_even_months": round(be_months, 1)
        }
    }
