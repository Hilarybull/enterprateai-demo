"""Fragility Engine (Blueprint v3).

MVP formula: 0.25×cash + 0.15×revenue + 0.20×customer + 0.20×operational + 0.10×capacity + 0.10×market

Dimensions are fragility scores (0–100, higher = MORE fragile).
Primary path: derived by inverting health scores from Survival/Stability/Viability engines.
Fallback path: derived from structural inputs when engine scores are absent.
"""

from .schemas import (
    FragilityDimensions,
    FragilityEngineInput,
    FragilityEngineOutput,
    FragilityEngineScores,
    FragilityLevel,
)

# ---------------------------------------------------------------------------
# Fallback dimension derivation from structural inputs
# ---------------------------------------------------------------------------

def _fallback_cash(inp: FragilityEngineInput) -> int:
    """Derive cash fragility from financial structural inputs."""
    score = 50  # default unknown
    if inp.debt_to_equity_ratio is not None:
        if inp.debt_to_equity_ratio > 3.0:
            score = 90
        elif inp.debt_to_equity_ratio > 1.5:
            score = 70
        elif inp.debt_to_equity_ratio > 0.5:
            score = 45
        else:
            score = 25
    if inp.working_capital_days is not None:
        if inp.working_capital_days > 90:
            score = min(100, score + 20)
        elif inp.working_capital_days > 45:
            score = min(100, score + 10)
    return score


def _fallback_revenue(inp: FragilityEngineInput) -> int:
    """Derive revenue fragility from fixed cost ratio."""
    if inp.fixed_cost_ratio is not None:
        if inp.fixed_cost_ratio > 0.75:
            return 80
        if inp.fixed_cost_ratio > 0.55:
            return 60
        if inp.fixed_cost_ratio > 0.35:
            return 40
        return 25
    return 50


def _fallback_customer(inp: FragilityEngineInput) -> int:
    """Derive customer concentration fragility."""
    t1 = inp.top_client_share_pct or 0.0
    if t1 >= 70:
        return 90
    if t1 >= 50:
        return 75
    if t1 >= 30:
        return 55
    if t1 >= 15:
        return 35
    return 20


def _fallback_operational(inp: FragilityEngineInput) -> int:
    """Derive operational dependency fragility."""
    score = 30
    if inp.founder_dependency:
        score += 30
    if inp.management_team_size <= 1:
        score += 20
    if inp.single_supplier_dependency:
        score += 15
    if inp.technology_dependency and inp.key_systems_redundancy == 0:
        score += 15
    return min(100, score)


def _fallback_capacity(inp: FragilityEngineInput) -> int:
    """Derive capacity fragility — no direct structural input; return neutral."""
    return 50


def _fallback_market(inp: FragilityEngineInput) -> int:
    """Derive market fragility from regulatory exposure."""
    if inp.regulatory_exposure == "HIGH":
        return 75
    if inp.regulatory_exposure == "MEDIUM":
        return 50
    return 30


# ---------------------------------------------------------------------------
# Dimension resolution
# ---------------------------------------------------------------------------

def _resolve_dimensions(inp: FragilityEngineInput) -> FragilityDimensions:
    """
    Primary: invert engine health scores to fragility scores.
    Fallback: derive from structural inputs per dimension.
    """
    def _inv(health: int | None, fallback_fn) -> int:
        if health is not None:
            return max(0, min(100, 100 - int(health)))
        return fallback_fn(inp)

    return FragilityDimensions(
        cash=_inv(inp.survival_cash_health, _fallback_cash),
        revenue=_inv(inp.stability_predictability, _fallback_revenue),
        customer=_inv(inp.stability_customer, _fallback_customer),
        operational=_inv(inp.stability_operational, _fallback_operational),
        capacity=_inv(inp.stability_capacity, _fallback_capacity),
        market=_inv(inp.viability_market_health, _fallback_market),
    )


# ---------------------------------------------------------------------------
# MVP formula
# ---------------------------------------------------------------------------

def _compute_fragility_index(d: FragilityDimensions) -> int:
    """Blueprint v3 MVP: 0.25C + 0.15R + 0.20Cu + 0.20O + 0.10Ca + 0.10M"""
    idx = (
        0.25 * d.cash +
        0.15 * d.revenue +
        0.20 * d.customer +
        0.20 * d.operational +
        0.10 * d.capacity +
        0.10 * d.market
    )
    return max(0, min(100, int(idx)))


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _classify(index: int) -> dict:
    if index <= 22:
        label = FragilityLevel.RESILIENT
        desc = "The business has strong structural resilience. Exposure is low across all fragility dimensions."
    elif index <= 40:
        label = FragilityLevel.STABLE_WITH_EXPOSURE
        desc = "The business is generally stable but carries moderate exposure in one or more dimensions."
    elif index <= 58:
        label = FragilityLevel.FRAGILE
        desc = "The business shows notable fragility. Structural vulnerabilities could amplify a single adverse event."
    elif index <= 75:
        label = FragilityLevel.HIGHLY_FRAGILE
        desc = "Multiple fragility dimensions are elevated. The business is at risk from compounding disruptions."
    else:
        label = FragilityLevel.CRITICAL_FRAGILITY
        desc = "Critical fragility detected. The business structure creates severe single-point-of-failure risk."

    return {"label": label.value, "description": desc, "fragility_index": index}


# ---------------------------------------------------------------------------
# Risk flags and recommendations
# ---------------------------------------------------------------------------

def _risk_flags(d: FragilityDimensions) -> list:
    flags = []
    if d.cash >= 70:
        flags.append("Cash/runway fragility is high — the business has limited financial buffer.")
    if d.customer >= 70:
        flags.append("Customer concentration creates a critical dependency — loss of top client would be severe.")
    if d.operational >= 70:
        flags.append("Operational structure is heavily dependent on key individuals or single processes.")
    if d.revenue >= 65:
        flags.append("Revenue predictability is low — income is irregular or cost structure is inflexible.")
    if d.market >= 65:
        flags.append("Market exposure is elevated — regulatory, competitive, or demand risks are significant.")
    return flags


def _recommendations(d: FragilityDimensions) -> list:
    recs = []
    if d.cash >= 60:
        recs.append("Build 3–6 months cash runway buffer and reduce high-interest debt obligations.")
    if d.customer >= 60:
        recs.append("Actively acquire new customers to reduce reliance on any single revenue source.")
    if d.operational >= 60:
        recs.append("Document processes and cross-train staff to remove single points of operational failure.")
    if d.revenue >= 55:
        recs.append("Introduce recurring revenue streams or reduce fixed cost exposure to improve revenue resilience.")
    if d.capacity >= 60:
        recs.append("Address capacity bottlenecks — over or under utilisation both signal structural fragility.")
    if d.market >= 55:
        recs.append("Diversify market exposure and monitor regulatory changes that could disrupt operations.")
    return recs


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_fragility_engine(inp: FragilityEngineInput) -> FragilityEngineOutput:
    dims = _resolve_dimensions(inp)
    index = _compute_fragility_index(dims)

    scores = FragilityEngineScores(fragility_index=index, dimensions=dims)
    classification = _classify(index)
    risk_flags = _risk_flags(dims)
    recommendations = _recommendations(dims)

    engine_path = (
        "engine-scores" if any([
            inp.survival_cash_health, inp.stability_predictability,
            inp.stability_customer, inp.stability_operational,
        ]) else "structural-fallback"
    )

    return FragilityEngineOutput(
        business_id=inp.business_id,
        scores=scores,
        classification=classification,
        risk_flags=risk_flags,
        recommendations=recommendations,
        trace={
            "formula": "FI = 0.25×cash + 0.15×revenue + 0.20×customer + 0.20×operational + 0.10×capacity + 0.10×market",
            "dimension_weights": {"cash": 0.25, "revenue": 0.15, "customer": 0.20, "operational": 0.20, "capacity": 0.10, "market": 0.10},
            "derivation_path": engine_path,
            "source": inp.source,
        },
    )
