"""Stability Engine (Blueprint v3).

4-dimension scoring:
  predictability     — revenue consistency / predictability (30%)
  customer_stability — customer concentration risk (25%)
  operational_dep    — key-person / process dependency (25%)
  capacity_health    — utilisation vs backlog health (20%)

Weighted aggregate: 0.30P + 0.25C + 0.25O + 0.20K
"""

import statistics
from typing import List, Optional

from .schemas import (
    StabilityClassification,
    StabilityEngineInput,
    StabilityEngineMetrics,
    StabilityEngineOutput,
    StabilityEngineScores,
)


# ---------------------------------------------------------------------------
# Dimension scoring helpers
# ---------------------------------------------------------------------------

def _score_predictability(revenue_series: Optional[List[float]]) -> tuple[int, Optional[float], Optional[float]]:
    """
    Returns (score, volatility_pct, trend_pct).
    score 100 = perfectly predictable, 0 = wildly volatile / no data.
    """
    if not revenue_series or len(revenue_series) < 2:
        return 40, None, None

    series = [max(0.0, r) for r in revenue_series]
    mean = statistics.mean(series) if series else 0
    if mean == 0:
        return 20, None, None

    stdev = statistics.stdev(series) if len(series) > 1 else 0
    cv = (stdev / mean) * 100  # coefficient of variation (%)

    # Trend: first half vs second half average
    half = len(series) // 2
    first_half_avg = statistics.mean(series[:half]) if half else mean
    second_half_avg = statistics.mean(series[half:]) if len(series) - half > 0 else mean
    trend_pct = ((second_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg else 0

    # Low CV = high predictability
    if cv <= 5:
        base = 95
    elif cv <= 10:
        base = 85
    elif cv <= 20:
        base = 70
    elif cv <= 35:
        base = 50
    elif cv <= 55:
        base = 35
    else:
        base = 20

    # Positive trend bonus (+5), sharp decline penalty (-10)
    if trend_pct > 10:
        base = min(100, base + 5)
    elif trend_pct < -20:
        base = max(0, base - 10)

    return int(base), round(cv, 1), round(trend_pct, 1)


def _score_customer_stability(
    top1_pct: Optional[float],
    top3_pct: Optional[float],
    customer_count: int,
) -> int:
    """High concentration = low score."""
    # Defaults when no data: assume moderate risk
    t1 = top1_pct if top1_pct is not None else 30.0
    t3 = top3_pct if top3_pct is not None else 60.0

    score = 100

    # Top-1 concentration penalty
    if t1 >= 80:
        score -= 55
    elif t1 >= 60:
        score -= 40
    elif t1 >= 40:
        score -= 25
    elif t1 >= 25:
        score -= 15
    elif t1 >= 15:
        score -= 8

    # Top-3 concentration penalty (incremental)
    if t3 >= 90:
        score -= 20
    elif t3 >= 75:
        score -= 12
    elif t3 >= 60:
        score -= 6

    # Customer count bonus
    if customer_count >= 50:
        score = min(100, score + 10)
    elif customer_count >= 20:
        score = min(100, score + 5)
    elif customer_count <= 3:
        score = max(0, score - 10)

    return max(0, int(score))


def _score_operational_dependency(
    key_person_dependency: bool,
    has_documented_processes: bool,
    has_backup_personnel: bool,
    automation_level_pct: Optional[float],
) -> int:
    score = 100

    if key_person_dependency:
        score -= 35  # single point of failure
    if not has_documented_processes:
        score -= 20
    if not has_backup_personnel:
        score -= 15

    auto = automation_level_pct if automation_level_pct is not None else 0.0
    if auto >= 60:
        score = min(100, score + 10)
    elif auto >= 30:
        score = min(100, score + 5)

    return max(0, int(score))


def _score_capacity_health(
    utilisation_pct: Optional[float],
    backlog_months: Optional[float],
) -> int:
    util = utilisation_pct if utilisation_pct is not None else 60.0
    backlog = backlog_months if backlog_months is not None else 0.0

    # Optimal utilisation 60-80%; too low or too high is problematic
    if 60 <= util <= 80:
        util_score = 90
    elif 50 <= util < 60 or 80 < util <= 90:
        util_score = 75
    elif 40 <= util < 50 or 90 < util <= 95:
        util_score = 55
    elif util > 95:
        util_score = 35  # overloaded
    else:
        util_score = 45  # underutilised

    # Backlog bonus
    if backlog >= 3:
        util_score = min(100, util_score + 10)
    elif backlog >= 1.5:
        util_score = min(100, util_score + 5)

    return int(util_score)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _classify(scores: StabilityEngineScores) -> dict:
    s = scores.stability_score
    cs = scores.customer_stability_score
    od = scores.operational_dependency_score

    if s >= 80:
        label = StabilityClassification.HIGHLY_STABLE
        description = "The business shows strong revenue consistency, diversified customers, documented processes, and healthy capacity utilisation."
    elif s >= 65:
        label = StabilityClassification.STABLE
        description = "The business operates with reasonable stability. Minor concentration or operational risks are present but manageable."
    elif s >= 50:
        label = StabilityClassification.MODERATELY_STABLE
        description = "There are notable stability gaps. Revenue predictability or customer diversification need attention."
    elif cs < 40:
        label = StabilityClassification.CUSTOMER_DEPENDENT
        description = "Customer concentration is high. Loss of a single customer could significantly disrupt revenue."
    elif od < 40:
        label = StabilityClassification.OPERATIONALLY_FRAGILE
        description = "Operational dependency on key persons or undocumented processes creates continuity risk."
    elif s >= 35:
        label = StabilityClassification.UNSTABLE
        description = "Multiple stability dimensions are weak. Structural risks require immediate attention."
    else:
        label = StabilityClassification.HIGHLY_UNSTABLE
        description = "The business is in a precarious stability position across most dimensions. Urgent intervention needed."

    return {
        "label": label.value,
        "description": description,
        "score_used": s,
    }


# ---------------------------------------------------------------------------
# Risk flags and recommendations
# ---------------------------------------------------------------------------

def _build_risk_flags(inp: StabilityEngineInput, scores: StabilityEngineScores) -> list:
    flags = []
    if scores.predictability_score < 45:
        flags.append("Revenue volatility is high — income is not predictable month-to-month.")
    if scores.customer_stability_score < 45:
        t1 = inp.top1_customer_revenue_pct or 0
        flags.append(f"Top customer accounts for ~{t1:.0f}% of revenue — severe concentration risk.")
    if inp.key_person_dependency and not inp.has_documented_processes:
        flags.append("Key-person dependency with no documented processes — operations stop if that person leaves.")
    if not inp.has_backup_personnel:
        flags.append("No backup personnel identified — single points of failure in staffing.")
    util = inp.capacity_utilisation_pct or 0
    if util > 92:
        flags.append(f"Capacity utilisation at {util:.0f}% — risk of quality degradation and inability to capture new demand.")
    if util < 35:
        flags.append(f"Low capacity utilisation ({util:.0f}%) — overhead cost efficiency may be poor.")
    return flags


def _build_recommendations(scores: StabilityEngineScores) -> list:
    recs = []
    if scores.predictability_score < 60:
        recs.append("Introduce retainer or subscription pricing to stabilise revenue month-to-month.")
    if scores.customer_stability_score < 60:
        recs.append("Launch a customer acquisition campaign targeting 5+ new clients to reduce concentration.")
    if scores.operational_dependency_score < 60:
        recs.append("Document all critical processes in a standard operating procedure (SOP) library.")
        recs.append("Cross-train at least one backup person for each key role.")
    if scores.capacity_health_score < 55:
        recs.append("Review capacity planning — consider hiring, automation, or demand smoothing strategies.")
    return recs


# ---------------------------------------------------------------------------
# Public engine entry point
# ---------------------------------------------------------------------------

def run_stability_engine(inp: StabilityEngineInput) -> StabilityEngineOutput:
    pred_score, volatility, trend = _score_predictability(inp.revenue_last_6_months)
    cust_score = _score_customer_stability(inp.top1_customer_revenue_pct, inp.top3_customer_revenue_pct, inp.customer_count)
    ops_score = _score_operational_dependency(inp.key_person_dependency, inp.has_documented_processes, inp.has_backup_personnel, inp.automation_level_pct)
    cap_score = _score_capacity_health(inp.capacity_utilisation_pct, inp.order_backlog_months)

    # Weighted aggregate: P(0.30) + C(0.25) + O(0.25) + K(0.20)
    stability_score = int(
        0.30 * pred_score +
        0.25 * cust_score +
        0.25 * ops_score +
        0.20 * cap_score
    )

    scores = StabilityEngineScores(
        predictability_score=pred_score,
        customer_stability_score=cust_score,
        operational_dependency_score=ops_score,
        capacity_health_score=cap_score,
        stability_score=stability_score,
    )

    metrics = StabilityEngineMetrics(
        revenue_volatility_pct=volatility,
        revenue_trend_pct=trend,
        top1_customer_revenue_pct=inp.top1_customer_revenue_pct or 0.0,
        top3_customer_revenue_pct=inp.top3_customer_revenue_pct or 0.0,
        capacity_utilisation_pct=inp.capacity_utilisation_pct or 0.0,
        order_backlog_months=inp.order_backlog_months or 0.0,
    )

    classification = _classify(scores)
    risk_flags = _build_risk_flags(inp, scores)
    recommendations = _build_recommendations(scores)

    return StabilityEngineOutput(
        business_id=inp.business_id,
        metrics=metrics,
        scores=scores,
        classification=classification,
        risk_flags=risk_flags,
        recommendations=recommendations,
        trace={
            "dimension_weights": {"predictability": 0.30, "customer_stability": 0.25, "operational_dependency": 0.25, "capacity_health": 0.20},
            "source": inp.source,
        },
    )
