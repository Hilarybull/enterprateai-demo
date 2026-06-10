"""Survival Engine calculations (Blueprint v3)."""

import statistics
from typing import List, Optional

from .schemas import (
    ConfidenceLevel,
    ConfidenceInfo,
    Recommendation,
    RiskFlag,
    RiskSeverity,
    SurvivalEngineInput,
    SurvivalEngineMetrics,
    SurvivalEngineOutput,
    SurvivalEngineScores,
    SurvivalInterpretation,
    SurvivalScenario,
)


def calculate_net_cashflow(inputs: SurvivalEngineInput) -> float:
    """Calculate net monthly cashflow."""
    if inputs.net_cashflow_monthly is not None:
        return inputs.net_cashflow_monthly
    return inputs.monthly_revenue - inputs.monthly_expenses


def calculate_burn_rate(net_cashflow: float) -> float:
    """Calculate monthly burn rate (absolute value of negative cashflow)."""
    return abs(net_cashflow) if net_cashflow < 0 else 0.0


def calculate_runway_months(cash: float, burn_rate: float) -> Optional[float]:
    """Calculate cash runway in months."""
    if burn_rate == 0:
        return None  # infinite or N/A
    return max(0.0, cash / burn_rate)


def calculate_volatility_ratio(cashflows: Optional[List[float]]) -> Optional[float]:
    """Calculate volatility ratio from historical cashflows."""
    if not cashflows or len(cashflows) < 2:
        return None
    try:
        mean_cf = statistics.mean(cashflows)
        if mean_cf == 0:
            return None
        std_dev = statistics.stdev(cashflows)
        return std_dev / abs(mean_cf)
    except Exception:
        return None


def calculate_liquidity_buffer(
    cash: float,
    credit_available: float = 0.0,
    overdraft_limit: float = 0.0,
    committed_future_revenue: float = 0.0,
) -> float:
    """Calculate total available liquidity."""
    return max(0.0, cash + credit_available + overdraft_limit + committed_future_revenue)


def score_runway(runway_months: Optional[float]) -> int:
    """Score runway dimension (0–100)."""
    if runway_months is None:
        return 100  # infinite runway
    if runway_months > 12:
        return 100
    if runway_months >= 6:
        return 70
    if runway_months >= 3:
        return 40
    return 10


def score_burn(burn_rate: float, monthly_revenue: float) -> int:
    """Score burn rate dimension (0–100)."""
    if burn_rate == 0:
        return 100
    if monthly_revenue <= 0:
        return 10
    burn_ratio = burn_rate / monthly_revenue
    if burn_ratio < 0.2:
        return 70
    if burn_ratio <= 0.5:
        return 40
    return 10


def score_volatility(volatility_ratio: Optional[float]) -> int:
    """Score cashflow volatility dimension (0–100)."""
    if volatility_ratio is None:
        return 50  # neutral; indicates unknown/missing data
    if volatility_ratio < 0.5:
        return 100
    if volatility_ratio <= 1.0:
        return 70
    if volatility_ratio <= 2.0:
        return 40
    return 10


def calculate_survival_score(
    runway_score: int, burn_score: int, volatility_score: int
) -> int:
    """
    Calculate final survival score (0–100).
    Formula: 0.40 × runway + 0.30 × burn + 0.30 × volatility
    """
    score = int(0.40 * runway_score + 0.30 * burn_score + 0.30 * volatility_score)
    return max(0, min(100, score))


def classify_survival(
    runway_score: int,
    burn_score: int,
    survival_score: int,
) -> tuple[SurvivalScenario, str]:
    """Classify survival scenario and label."""
    # Priority order matters
    if runway_score <= 10 or survival_score < 40:
        return SurvivalScenario.CRITICAL_SURVIVAL_RISK, "Critical Survival Risk"
    if burn_score <= 40 and runway_score <= 70:
        return SurvivalScenario.HIGH_BURN_RISK, "High Burn Risk"
    if runway_score <= 50 and burn_score <= 50:
        return SurvivalScenario.CASH_PRESSURED, "Cash Pressured"
    if runway_score >= 85 and burn_score >= 70 and survival_score >= 80:
        return SurvivalScenario.STRONG_SURVIVAL, "Strong Survival"
    return SurvivalScenario.STABLE_BUT_WATCH, "Stable but Watch"


def detect_risk_flags(
    runway_months: Optional[float],
    burn_rate: float,
    net_cashflow: float,
    monthly_revenue: float,
    volatility_score: int,
    has_cashflow_history: bool,
) -> List[RiskFlag]:
    """Detect all applicable risk flags."""
    flags: List[RiskFlag] = []

    # CRITICAL_RUNWAY_RISK
    if runway_months is not None and runway_months < 3:
        flags.append(
            RiskFlag(
                code="CRITICAL_RUNWAY_RISK",
                severity=RiskSeverity.VERY_HIGH,
                explanation=f"Cash runway is {runway_months:.1f} months — business will run out of cash soon.",
                recommended_action="Reduce costs immediately, increase short-term cash inflows, or secure liquidity.",
                priority_score=100,
            )
        )

    # LOW_RUNWAY_RISK
    if runway_months is not None and 3 <= runway_months < 6:
        flags.append(
            RiskFlag(
                code="LOW_RUNWAY_RISK",
                severity=RiskSeverity.HIGH,
                explanation=f"Cash runway is {runway_months:.1f} months — approaching critical threshold.",
                recommended_action="Improve cash reserves, reduce burn, or accelerate revenue collection.",
                priority_score=90,
            )
        )

    # HIGH_BURN_RATE
    if monthly_revenue > 0 and burn_rate > 0.5 * monthly_revenue:
        flags.append(
            RiskFlag(
                code="HIGH_BURN_RATE",
                severity=RiskSeverity.HIGH,
                explanation=f"Monthly burn rate ({burn_rate:.0f}) exceeds 50% of revenue.",
                recommended_action="Reduce recurring expenses or improve monthly revenue before adding fixed commitments.",
                priority_score=80,
            )
        )

    # NEGATIVE_CASHFLOW
    if net_cashflow < 0:
        flags.append(
            RiskFlag(
                code="NEGATIVE_CASHFLOW",
                severity=RiskSeverity.MEDIUM,
                explanation="Monthly cashflow is negative — business is spending more than it earns.",
                recommended_action="Review spending, improve collections, and increase near-term inflows.",
                priority_score=70,
            )
        )

    # VOLATILE_CASHFLOW
    if volatility_score <= 40:
        flags.append(
            RiskFlag(
                code="VOLATILE_CASHFLOW",
                severity=RiskSeverity.HIGH,
                explanation="Cashflow is highly volatile — business is unpredictable.",
                recommended_action="Stabilise revenue, reduce unpredictable expenses, and improve recurring income.",
                priority_score=75,
            )
        )

    # NO_CASH_VISIBILITY
    if not has_cashflow_history:
        flags.append(
            RiskFlag(
                code="NO_CASH_VISIBILITY",
                severity=RiskSeverity.MEDIUM,
                explanation="Insufficient historical cashflow data.",
                recommended_action="Add at least 3–6 months of revenue, expense, and cashflow history.",
                priority_score=50,
            )
        )

    return sorted(flags, key=lambda f: f.priority_score, reverse=True)


def generate_recommendations(risk_flags: List[RiskFlag]) -> List[Recommendation]:
    """Generate top 3 recommendations based on risk flags."""
    recs: List[Recommendation] = []
    seen_codes = set()

    priority_map = {
        "CRITICAL_RUNWAY_RISK": ("CRITICAL", High),
        "LOW_RUNWAY_RISK": ("HIGH", Medium),
        "HIGH_BURN_RATE": ("HIGH", High),
        "NEGATIVE_CASHFLOW": ("MEDIUM", Medium),
        "VOLATILE_CASHFLOW": ("HIGH", High),
        "NO_CASH_VISIBILITY": ("MEDIUM", Low),
    }

    for flag in risk_flags:
        if len(recs) >= 3 or flag.code in seen_codes:
            continue
        seen_codes.add(flag.code)
        priority, _ = priority_map.get(flag.code, ("LOW", None))
        recs.append(
            Recommendation(
                type=flag.code,
                priority=priority,
                text=flag.recommended_action,
                expected_impact=f"Addresses {flag.code} risk.",
            )
        )

    return recs


class High:
    """Sentinel."""

    pass


class Medium:
    """Sentinel."""

    pass


class Low:
    """Sentinel."""

    pass


def run_survival_engine(inputs: SurvivalEngineInput) -> SurvivalEngineOutput:
    """Execute Survival Engine and return results."""
    output = SurvivalEngineOutput(business_id=inputs.business_id)

    # Compute core metrics
    net_cashflow = calculate_net_cashflow(inputs)
    burn_rate = calculate_burn_rate(net_cashflow)
    runway = calculate_runway_months(inputs.cash_balance, burn_rate)
    volatility = calculate_volatility_ratio(inputs.net_cashflow_last_6_months)
    liquidity = calculate_liquidity_buffer(
        inputs.cash_balance,
        inputs.credit_available,
        inputs.overdraft_limit,
        inputs.committed_future_revenue,
    )

    output.metrics = SurvivalEngineMetrics(
        cash_balance=inputs.cash_balance,
        monthly_revenue=inputs.monthly_revenue,
        monthly_expenses=inputs.monthly_expenses,
        net_cashflow_monthly=net_cashflow,
        burn_rate=burn_rate,
        runway_months=runway,
        volatility_ratio=volatility,
        liquidity_buffer=liquidity,
    )

    # Dimension scores
    runway_score = score_runway(runway)
    burn_score = score_burn(burn_rate, inputs.monthly_revenue)
    volatility_score = score_volatility(volatility)
    survival_score = calculate_survival_score(runway_score, burn_score, volatility_score)

    output.scores = SurvivalEngineScores(
        runway_score=runway_score,
        burn_score=burn_score,
        volatility_score=volatility_score,
        survival_score=survival_score,
    )

    # Classification
    scenario, label = classify_survival(runway_score, burn_score, survival_score)
    output.classification = {"scenario": scenario.value, "label": label}

    # Risk flags
    has_history = (
        inputs.net_cashflow_last_6_months
        and len(inputs.net_cashflow_last_6_months) >= 2
    )
    output.risk_flags = detect_risk_flags(
        runway,
        burn_rate,
        net_cashflow,
        inputs.monthly_revenue,
        volatility_score,
        has_history,
    )

    # Recommendations
    output.recommendations = generate_recommendations(output.risk_flags)

    # Confidence
    confidence_penalty = not has_history
    output.confidence = ConfidenceInfo(
        level=inputs.confidence_level,
        note="Based on historical data" if has_history else "Based on current snapshot only.",
        penalty_applied=confidence_penalty,
    )

    # Interpretation
    output.interpretation = SurvivalInterpretation(
        headline=f"Business survival state: {label}",
        driver_summary=f"Runway: {runway_score}/100, Burn: {burn_score}/100, Volatility: {volatility_score}/100",
        business_interpretation=(
            f"This business has a survival score of {survival_score}/100. "
            f"It can operate for approximately {runway:.1f} months without additional revenue or cost reduction."
            if runway is not None
            else ""
        ),
        risk_outlook=f"Primary risks: {', '.join(f.code for f in output.risk_flags[:3])}",
        recommended_actions=[r.text for r in output.recommendations],
    )

    return output
