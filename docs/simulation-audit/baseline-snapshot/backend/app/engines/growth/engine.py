"""Growth Engine (Blueprint v3).

4-dimension scoring:
  delivery_scalability  — how well the product/service can scale (30%)
  market_expansion      — available market headroom (25%)
  pricing_leverage      — pricing power and value-based capture (25%)
  competitive_moat      — defensibility vs competitors (20%)

Weighted aggregate: 0.30D + 0.25M + 0.25P + 0.20C
"""

import statistics
from typing import List, Optional

from .schemas import (
    CompetitiveInput,
    GrowthClassification,
    GrowthEngineInput,
    GrowthEngineMetrics,
    GrowthEngineOutput,
    GrowthEngineScores,
    MarketExpansionInput,
    PricingInput,
    ProductDeliveryInput,
)


# ---------------------------------------------------------------------------
# Dimension scoring helpers
# ---------------------------------------------------------------------------

def _score_delivery_scalability(d: Optional[ProductDeliveryInput]) -> int:
    if d is None:
        return 40  # unknown — assume some scalability challenges

    score = 30  # baseline
    if d.is_digital_or_scalable:
        score += 35
    if d.has_recurring_revenue:
        score += 15
    if not d.delivery_requires_owner_presence:
        score += 10
    if d.can_delegate_delivery:
        score += 5
    if d.has_repeatable_process:
        score += 5

    return min(100, int(score))


def _score_market_expansion(m: Optional[MarketExpansionInput]) -> int:
    if m is None:
        return 45

    score = 20
    penetration = m.current_market_share_pct or 0.0

    # Low penetration = high headroom
    if penetration < 5:
        score += 30
    elif penetration < 15:
        score += 22
    elif penetration < 30:
        score += 14
    elif penetration < 50:
        score += 8
    else:
        score += 2

    if m.new_segment_potential:
        score += 15
    if m.geographic_expansion_possible:
        score += 15
    if m.online_channel_available:
        score += 10

    return min(100, int(score))


def _score_pricing_leverage(p: Optional[PricingInput]) -> int:
    if p is None:
        return 40

    score = 20
    if p.is_value_based_pricing:
        score += 25
    if p.has_premium_tier:
        score += 15

    feasibility_map = {"low": 0, "medium": 15, "high": 30}
    score += feasibility_map.get(p.price_increase_feasibility, 0)

    # Deal size hint: higher deal value = more pricing power signal
    if p.average_deal_value is not None:
        if p.average_deal_value >= 5000:
            score += 10
        elif p.average_deal_value >= 1000:
            score += 5

    return min(100, int(score))


def _score_competitive_moat(c: Optional[CompetitiveInput]) -> int:
    if c is None:
        return 40

    score = 20
    if c.has_unique_differentiator:
        score += 30

    switching_map = {"low": 0, "medium": 15, "high": 25}
    score += switching_map.get(c.switching_cost_for_customers, 0)

    # Fewer competitors = less pressure
    if c.number_of_direct_competitors <= 2:
        score += 15
    elif c.number_of_direct_competitors <= 5:
        score += 10
    elif c.number_of_direct_competitors <= 10:
        score += 5

    # Pricing pressure: low pressure = better moat
    pressure_map = {"low": 10, "medium": 5, "high": 0}
    score += pressure_map.get(c.competitor_pricing_pressure, 0)

    return min(100, int(score))


# ---------------------------------------------------------------------------
# Revenue trend context (optional)
# ---------------------------------------------------------------------------

def _revenue_trend(series: Optional[List[float]]) -> Optional[float]:
    if not series or len(series) < 3:
        return None
    s = [max(0.0, r) for r in series]
    half = len(s) // 2
    first = statistics.mean(s[:half]) if half else 0
    second = statistics.mean(s[half:]) if len(s) - half > 0 else 0
    if first == 0:
        return None
    return round(((second - first) / first) * 100, 1)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def _build_metrics(inp: GrowthEngineInput, scores: GrowthEngineScores) -> GrowthEngineMetrics:
    penetration = (inp.market_expansion.current_market_share_pct or 0.0) if inp.market_expansion else 0.0
    headroom = max(0.0, 100.0 - penetration)

    if inp.product_delivery and inp.product_delivery.is_digital_or_scalable:
        scalability_multiplier = "exponential"
    elif scores.delivery_scalability_score >= 60:
        scalability_multiplier = "sub-linear"
    else:
        scalability_multiplier = "linear"

    return GrowthEngineMetrics(
        market_penetration_pct=round(penetration, 1),
        expansion_headroom_pct=round(headroom, 1),
        revenue_trend_pct=_revenue_trend(inp.revenue_last_6_months),
        scalability_multiplier=scalability_multiplier,
    )


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _classify(scores: GrowthEngineScores) -> dict:
    s = scores.growth_score
    delivery = scores.delivery_scalability_score
    pricing = scores.pricing_leverage_score
    market = scores.market_expansion_score

    if s >= 78 and delivery >= 70:
        label = GrowthClassification.HIGH_GROWTH_POTENTIAL
        desc = "The business has strong scalability, clear market headroom, and solid pricing leverage. Conditions are aligned for rapid growth."
    elif s >= 65:
        label = GrowthClassification.GROWTH_READY
        desc = "Core growth conditions are in place. Execution and targeted investment will unlock the next stage of expansion."
    elif delivery < 45:
        label = GrowthClassification.LOW_SCALABILITY
        desc = "Delivery model requires owner presence or does not scale well. Growth will be limited without a structural redesign."
    elif pricing < 45:
        label = GrowthClassification.COMMODITY_TRAP
        desc = "Pricing is cost-driven with low differentiation. Margins under pressure — hard to capture value from growth."
    elif market < 45:
        label = GrowthClassification.LIMITED_GROWTH
        desc = "Market headroom is limited — high penetration or a small served market constrains further growth."
    elif s >= 45:
        label = GrowthClassification.SCALING_CONSTRAINT
        desc = "Growth potential is present but operational or competitive constraints are slowing expansion."
    else:
        label = GrowthClassification.LIMITED_GROWTH
        desc = "Multiple growth dimensions are weak. Significant structural changes are needed to unlock a growth trajectory."

    return {"label": label.value, "description": desc, "score_used": s}


# ---------------------------------------------------------------------------
# Risk flags and recommendations
# ---------------------------------------------------------------------------

def _risk_flags(scores: GrowthEngineScores, inp: GrowthEngineInput) -> list:
    flags = []
    if inp.product_delivery and inp.product_delivery.delivery_requires_owner_presence and not inp.product_delivery.can_delegate_delivery:
        flags.append("Owner-dependent delivery model — growth is capped by personal capacity.")
    if scores.pricing_leverage_score < 45:
        flags.append("Low pricing leverage — revenue growth may not convert to margin growth.")
    if scores.competitive_moat_score < 45:
        flags.append("Weak competitive moat — growth gains may be quickly eroded by competitors.")
    if scores.market_expansion_score < 40:
        flags.append("Limited addressable market expansion headroom identified.")
    return flags


def _recommendations(scores: GrowthEngineScores) -> list:
    recs = []
    if scores.delivery_scalability_score < 55:
        recs.append("Productise or systematise delivery so it can be delegated or run without founder involvement.")
    if scores.pricing_leverage_score < 55:
        recs.append("Introduce a premium tier or value-based pricing to improve margin leverage.")
    if scores.market_expansion_score < 55:
        recs.append("Explore adjacent markets or geographic expansion to extend the total addressable market.")
    if scores.competitive_moat_score < 55:
        recs.append("Build switching costs through integrations, contracts, or proprietary tooling to protect customers.")
    return recs


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_growth_engine(inp: GrowthEngineInput) -> GrowthEngineOutput:
    delivery_score = _score_delivery_scalability(inp.product_delivery)
    market_score = _score_market_expansion(inp.market_expansion)
    pricing_score = _score_pricing_leverage(inp.pricing)
    competitive_score = _score_competitive_moat(inp.competitive)

    # Weighted aggregate: D(0.30) + M(0.25) + P(0.25) + C(0.20)
    growth_score = int(
        0.30 * delivery_score +
        0.25 * market_score +
        0.25 * pricing_score +
        0.20 * competitive_score
    )

    scores = GrowthEngineScores(
        delivery_scalability_score=delivery_score,
        market_expansion_score=market_score,
        pricing_leverage_score=pricing_score,
        competitive_moat_score=competitive_score,
        growth_score=growth_score,
    )

    metrics = _build_metrics(inp, scores)
    classification = _classify(scores)
    risk_flags = _risk_flags(scores, inp)
    recommendations = _recommendations(scores)

    return GrowthEngineOutput(
        business_id=inp.business_id,
        metrics=metrics,
        scores=scores,
        classification=classification,
        risk_flags=risk_flags,
        recommendations=recommendations,
        trace={
            "dimension_weights": {
                "delivery_scalability": 0.30,
                "market_expansion": 0.25,
                "pricing_leverage": 0.25,
                "competitive_moat": 0.20,
            },
            "source": inp.source,
        },
    )
