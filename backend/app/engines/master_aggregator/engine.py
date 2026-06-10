"""Master Aggregator Engine (Blueprint v3).

BI Score formula: 0.30×Viability + 0.25×Survival + 0.20×Stability + 0.25×Growth

8 structural classifications based on BI Score + fragility override.
Consolidates risk flags from all engines; deduplicates and prioritises recommendations.
"""

from .schemas import (
    BIScoreBreakdown,
    MasterAggregatorInput,
    MasterAggregatorOutput,
    StructuralClassification,
)


# ---------------------------------------------------------------------------
# BI Score
# ---------------------------------------------------------------------------

def _compute_bi_score(inp: MasterAggregatorInput) -> BIScoreBreakdown:
    v = inp.viability_score * 0.30
    s = inp.survival_score * 0.25
    st = inp.stability_score * 0.20
    g = inp.growth_score * 0.25
    bi = int(v + s + st + g)
    return BIScoreBreakdown(
        viability_contribution=round(v, 1),
        survival_contribution=round(s, 1),
        stability_contribution=round(st, 1),
        growth_contribution=round(g, 1),
        bi_score=bi,
    )


# ---------------------------------------------------------------------------
# Structural classification
# ---------------------------------------------------------------------------

def _classify_structural(bi: int, fragility: int, inp: MasterAggregatorInput) -> dict:
    """
    PDF spec classification matrix:
      BALANCED_BUSINESS          — BI ≥ 75, fragility ≤ 35
      VIABLE_BUT_CASH_CRITICAL   — viability strong but survival score < 40
      GROWTH_READY_BUT_UNSTABLE  — growth strong but stability < 50
      STABLE_BUT_STAGNANT        — stability strong but growth < 40
      PROFITABLE_BUT_FRAGILE     — BI ≥ 60 but fragility ≥ 60
      SCALING_WITH_FRAGILITY     — growth strong but fragility ≥ 50
      WEAK_FOUNDATION            — BI 30–59, moderate fragility
      CRITICAL_BUSINESS_STATE    — BI < 30 or fragility ≥ 80
    """
    label: StructuralClassification

    if fragility >= 80 or bi < 30:
        label = StructuralClassification.CRITICAL_BUSINESS_STATE
        desc = "The business is in a critical state. Core structural indicators show extreme fragility or very low business intelligence."
    elif bi >= 75 and fragility <= 35:
        label = StructuralClassification.BALANCED_BUSINESS
        desc = "Strong fundamentals across all pillars. Viability, survival, stability, and growth are well-balanced with low fragility."
    elif inp.viability_score >= 65 and inp.survival_score < 40:
        label = StructuralClassification.VIABLE_BUT_CASH_CRITICAL
        desc = "The business model is viable but cash runway is critically short. Survival must be prioritised before scaling."
    elif inp.growth_score >= 65 and inp.stability_score < 50:
        label = StructuralClassification.GROWTH_READY_BUT_UNSTABLE
        desc = "Growth potential is strong but operational stability lags. Rapid growth without stabilisation creates compounding risk."
    elif inp.stability_score >= 65 and inp.growth_score < 40:
        label = StructuralClassification.STABLE_BUT_STAGNANT
        desc = "Operations are stable but growth has stalled. The business is sustainable but not expanding."
    elif bi >= 60 and fragility >= 60:
        label = StructuralClassification.PROFITABLE_BUT_FRAGILE
        desc = "The business generates good returns but is structurally fragile. External shocks could cause rapid deterioration."
    elif inp.growth_score >= 55 and fragility >= 50:
        label = StructuralClassification.SCALING_WITH_FRAGILITY
        desc = "Growth trajectory is positive but the business is scaling with unresolved structural fragility."
    else:
        label = StructuralClassification.WEAK_FOUNDATION
        desc = "Multiple structural pillars are underperforming. The business needs foundational improvements before scaling."

    return {"label": label.value, "description": desc, "bi_score": bi, "fragility_index": fragility}


# ---------------------------------------------------------------------------
# Risk consolidation
# ---------------------------------------------------------------------------

def _consolidate_risks(inp: MasterAggregatorInput) -> list:
    seen = set()
    result = []
    for flag in (
        inp.viability_risks +
        inp.survival_risks +
        inp.stability_risks +
        inp.growth_risks +
        inp.fragility_risks
    ):
        key = flag.lower().strip()[:60]
        if key not in seen:
            seen.add(key)
            result.append(flag)
    return result[:12]  # cap at 12 consolidated risks


# ---------------------------------------------------------------------------
# Recommendation deduplication and priority ordering
# ---------------------------------------------------------------------------

def _priority_recommendations(inp: MasterAggregatorInput, bi: int) -> list:
    """
    Merge all engine recommendations; put highest-impact first.
    Priority order: fragility → survival → viability → stability → growth.
    """
    seen = set()
    ordered = []

    all_recs = (
        inp.survival_recommendations +  # survival first — existential
        inp.viability_recommendations +
        inp.stability_recommendations +
        inp.growth_recommendations
    )

    # Critical overrides when BI < 50
    if bi < 50:
        ordered.append("Prioritise cash flow stabilisation before any growth initiatives.")

    for rec in all_recs:
        key = rec.lower().strip()[:60]
        if key not in seen:
            seen.add(key)
            ordered.append(rec)

    return ordered[:10]  # top 10 recommendations


# ---------------------------------------------------------------------------
# Engine summary
# ---------------------------------------------------------------------------

def _engine_summary(inp: MasterAggregatorInput) -> dict:
    def _band(score: int) -> str:
        if score >= 80: return "strong"
        if score >= 65: return "good"
        if score >= 50: return "moderate"
        if score >= 35: return "weak"
        return "critical"

    return {
        "viability":  {"score": inp.viability_score,  "band": _band(inp.viability_score)},
        "survival":   {"score": inp.survival_score,   "band": _band(inp.survival_score)},
        "stability":  {"score": inp.stability_score,  "band": _band(inp.stability_score)},
        "growth":     {"score": inp.growth_score,     "band": _band(inp.growth_score)},
        "fragility":  {"index": inp.fragility_index,  "band": _band(100 - inp.fragility_index)},
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_master_aggregator(inp: MasterAggregatorInput) -> MasterAggregatorOutput:
    breakdown = _compute_bi_score(inp)
    bi = breakdown.bi_score
    structural = _classify_structural(bi, inp.fragility_index, inp)
    risks = _consolidate_risks(inp)
    recs = _priority_recommendations(inp, bi)
    summary = _engine_summary(inp)

    return MasterAggregatorOutput(
        business_id=inp.business_id,
        bi_score=bi,
        bi_score_breakdown=breakdown,
        structural_classification=structural,
        fragility_index=inp.fragility_index,
        consolidated_risks=risks,
        priority_recommendations=recs,
        engine_summary=summary,
        trace={
            "formula": "BI = 0.30×V + 0.25×S + 0.20×St + 0.25×G",
            "input_scores": {
                "viability": inp.viability_score,
                "survival": inp.survival_score,
                "stability": inp.stability_score,
                "growth": inp.growth_score,
                "fragility_index": inp.fragility_index,
            },
            "source": inp.source,
        },
    )
