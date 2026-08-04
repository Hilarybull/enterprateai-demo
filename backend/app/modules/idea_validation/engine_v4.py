"""
Idea Validation Engine v4.0 — Deterministic Scoring Engine

Produces two independent scores:
  1. Validation Potential Score (VPS)  — 0-100, 12 dimensions
  2. Evidence Confidence Score  (ECS)  — 0-100, 5 dimensions

LLM does NOT select the final score. It only provides narrative interpretation.

Scoring weights are configurable (see VPS_WEIGHTS / ECS_WEIGHTS below).
Verdict thresholds are configurable (see VERDICT_THRESHOLDS below).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# CONFIGURABLE WEIGHTS (store in DB for live configurability)
# ---------------------------------------------------------------------------

VPS_WEIGHTS: dict[str, int] = {
    "problem_strength": 10,
    "customer_clarity": 8,
    "evidence_traction": 15,
    "solution_relevance": 8,
    "differentiation": 7,
    "demand_market": 12,
    "competition_positioning": 7,
    "revenue_pricing": 8,
    "unit_economics": 8,
    "operational_feasibility": 6,
    "founder_readiness": 6,
    "regulatory_risk": 5,
}

ECS_WEIGHTS: dict[str, int] = {
    "input_completeness": 20,
    "primary_customer_evidence": 25,
    "behavioural_transaction_evidence": 25,
    "external_market_evidence": 20,
    "source_quality_recency": 10,
}

VERDICT_THRESHOLDS: dict[str, Any] = {
    "weak_hypothesis_max_potential": 40,
    "developing_fit_max_potential": 59,
    "promising_max_potential": 74,
    "promising_min_confidence": 50,
    "ready_pilot_min_confidence": 50,
    "ready_pilot_max_confidence": 69,
    "scale_min_confidence": 70,
    "high_potential_min": 75,
}

# ---------------------------------------------------------------------------
# EVIDENCE STATE CONSTANTS
# ---------------------------------------------------------------------------

EVIDENCE_STATES = {
    "VERIFIED_PRIMARY",
    "VERIFIED_SECONDARY",
    "SOURCE_BACKED_SINGLE",
    "USER_PROVIDED_UNVERIFIED",
    "LLM_INFERENCE_UNVERIFIED",
    "CALCULATED_FROM_VERIFIED_INPUTS",
    "CALCULATED_FROM_UNVERIFIED_INPUTS",
    "NOT_AVAILABLE",
    "EXTERNAL_VERIFICATION_REQUIRED",
}

# Traction evidence hierarchy — score 0-100
EVIDENCE_HIERARCHY: dict[str, int] = {
    "no_evidence": 0,
    "founder_assumption": 3,
    "personal_experience": 5,
    "personal_anecdote": 5,
    "informal_conversations": 10,
    "social_media_engagement": 15,
    "search_demand": 18,
    "survey_responses": 22,
    "landing_page_visits": 25,
    "email_sign_ups": 28,
    "customer_interviews": 32,
    "waiting_list": 45,
    "letters_of_intent": 55,
    "requests_for_quotation": 60,
    "pre_orders": 72,
    "deposits": 78,
    "paid_pilots": 85,
    "existing_customers": 90,
    "revenue": 90,
    "contracts": 88,
    "partnerships": 62,
    "referrals": 80,
    "usage_data": 75,
    "retention_data": 92,
    "repeat_customers": 95,
    "churn_data": 80,
}

# Financial/behavioural evidence subset (for ECS dimension 3)
FINANCIAL_BEHAVIOURAL_EVIDENCE: set[str] = {
    "pre_orders", "deposits", "paid_pilots", "existing_customers",
    "revenue", "contracts", "usage_data", "retention_data",
    "repeat_customers", "churn_data",
}

INTENT_EVIDENCE: set[str] = {
    "waiting_list", "letters_of_intent", "requests_for_quotation", "email_sign_ups",
}


# ---------------------------------------------------------------------------
# V4 INPUT DATACLASS
# ---------------------------------------------------------------------------

@dataclass
class V4Input:
    """Flattened scoring inputs derived from the V4 wizard form."""

    # Step 1 — Idea Identity
    idea_name: str = ""
    idea_description: str = ""
    idea_tagline: str = ""             # one-sentence description
    idea_type: str = ""                # e.g. "SaaS", "Local service"
    idea_sector: str = ""              # e.g. "FinTech", "HealthTech"
    business_stage: str = ""           # e.g. "idea", "early_revenue"
    customer_model: str = ""           # B2B, B2C, etc.
    operating_country: str = ""
    launch_geography: str = ""
    future_geography: str = ""

    # Step 2 — Problem
    problem_description: str = ""
    who_affected: str = ""
    problem_trigger: str = ""          # what event triggers the problem
    problem_frequency: str = ""        # daily, weekly, monthly, rarely, unknown
    pain_severity: str = ""            # mild, moderate, severe, critical
    financial_impact_known: bool = False
    financial_impact_description: str = ""
    urgency: str = ""                  # urgent, moderate, deferrable, unknown
    problem_trend: str = ""            # growing, stable, declining, unknown
    if_nothing: str = ""               # consequence of inaction
    problem_affects: str = ""          # buyer only / user only / both
    evidence_problem_exists: str = ""

    # Step 3 — Customer
    primary_segment: str = ""
    secondary_segment: str = ""
    beachhead_segment: str = ""
    economic_buyer: str = ""
    end_user: str = ""
    decision_maker: str = ""
    influencer: str = ""
    channels: list[str] = field(default_factory=list)
    purchase_frequency: str = ""
    buying_triggers: str = ""
    main_objections: str = ""
    customer_specificity: str = ""     # broad, moderate, narrow, niche

    # Step 4 — Current Alternatives
    how_solve_currently: str = ""
    direct_competitors: list[str] = field(default_factory=list)
    indirect_competitors: list[str] = field(default_factory=list)
    substitutes: list[str] = field(default_factory=list)
    diy_alternatives: str = ""         # manual/DIY workarounds
    alternative_frustrations: str = "" # what frustrates customers about current alternatives
    existing_spending: str = ""
    switching_barriers: str = ""

    # Step 5 — Proposed Solution
    solution_description: str = ""
    core_outcome: str = ""
    main_features: list[str] = field(default_factory=list)
    main_benefits: list[str] = field(default_factory=list)
    delivery_method: str = ""
    why_better: str = ""
    why_switch: str = ""
    behaviour_change: str = ""         # required customer behaviour change
    time_to_value: str = ""
    defensibility: str = ""
    ip_or_moat: str = ""               # IP, network_effects, data, process, none

    # Step 6 — Market
    market_category: str = ""
    estimated_customers: str = ""
    market_growing: str = ""           # yes, no, unknown
    market_sources: list[str] = field(default_factory=list)
    market_scope: str = ""             # local, national, regional, global

    # Step 7 — Revenue Model & Pricing (Comprehensive)
    revenue_model: str = ""
    proposed_price: str = ""
    payment_frequency: str = ""
    willingness_to_pay_evidence: bool = False
    recurring_model: bool = False

    # Step 8 — Costs (Comprehensive)
    variable_cost_known: bool = False
    variable_cost_per_unit: str = ""
    fixed_costs_monthly: str = ""
    gross_margin_estimate: str = ""

    # Step 9 — Capacity (Comprehensive)
    delivery_unit: str = ""
    capacity_per_month: str = ""
    key_bottleneck: str = ""
    delivery_model_defined: bool = False

    # Step 10 — Traction & Evidence
    evidence_types: list[str] = field(default_factory=list)  # keys from EVIDENCE_HIERARCHY
    evidence_count: int = 0
    has_paying_customers: bool = False
    has_repeat_customers: bool = False
    has_financial_commitment: bool = False

    # Step 11 — Founder (Comprehensive)
    founder_industry_experience: str = ""   # none, some, relevant, deep
    founder_capital_available: bool = False
    founder_time_available: bool = False
    team_size: int = 1

    # Step 12 — Regulatory (Comprehensive)
    regulatory_risk_level: str = ""         # none, low, medium, high, unknown
    regulatory_requirements_known: bool = False
    regulatory_mitigation_planned: bool = False

    # Meta
    validation_mode: str = "basic"          # basic | comprehensive
    is_paid_plan: bool = False
    currency: str = "GBP"

    # Completeness tracking
    steps_completed: list[int] = field(default_factory=list)


# ---------------------------------------------------------------------------
# SCORING RUBRICS
# ---------------------------------------------------------------------------

def _score_problem_strength(inp: V4Input) -> tuple[float, str]:
    """Max 10 — weighted by severity × frequency, bonuses for financial impact & urgency."""
    severity_map = {"critical": 10.0, "severe": 7.0, "moderate": 4.5, "mild": 2.0, "": 1.0}
    freq_map = {"daily": 1.0, "weekly": 0.8, "monthly": 0.55, "quarterly": 0.35, "rarely": 0.2, "unknown": 0.3, "": 0.3}
    trend_bonus = {"growing": 1.5, "stable": 0.0, "declining": -2.0, "unknown": 0.0, "": 0.0}
    urgency_bonus = {"urgent": 1.0, "moderate": 0.0, "deferrable": -0.5, "unknown": 0.0, "": 0.0}

    base = severity_map.get(inp.pain_severity.lower(), 2.0) * freq_map.get(inp.problem_frequency.lower(), 0.3)
    bonus = (1.0 if inp.financial_impact_known else 0.0)
    bonus += trend_bonus.get(inp.problem_trend.lower(), 0.0)
    bonus += urgency_bonus.get(inp.urgency.lower(), 0.0)
    # Small bonus for documented evidence
    if len(inp.evidence_problem_exists.strip()) > 30:
        bonus += 0.5

    # Bonus for trigger and consequence of inaction being documented
    if inp.problem_trigger.strip():
        bonus += 0.5
    if inp.if_nothing.strip():
        bonus += 0.5
    raw = min(10.0, base + bonus)
    # At minimum give 1 pt if problem is described at all
    if inp.problem_description.strip():
        raw = max(1.0, raw)
    note = f"severity={inp.pain_severity or 'unknown'}, freq={inp.problem_frequency or 'unknown'}"
    return raw, note


def _score_customer_clarity(inp: V4Input) -> tuple[float, str]:
    """Max 8 — beachhead defined, segment specificity, channels, buyer/user distinction."""
    specificity_map = {"niche": 3.0, "narrow": 2.5, "moderate": 1.5, "broad": 0.5, "": 0.0}
    score = 0.0
    notes = []

    # Beachhead defined (3 pts)
    if inp.beachhead_segment.strip():
        score += 3.0
        notes.append("beachhead defined")
    elif inp.primary_segment.strip():
        score += 1.0
        notes.append("segment only")

    # Specificity (3 pts max)
    score += specificity_map.get(inp.customer_specificity.lower(), 0.0)
    if inp.customer_specificity:
        notes.append(f"specificity={inp.customer_specificity}")

    # Channels (1 pt)
    if inp.channels:
        score += 1.0
        notes.append("channels listed")

    # Buyer/user distinction (1 pt)
    if inp.economic_buyer.strip() or inp.end_user.strip():
        score += 1.0
        notes.append("buyer/user defined")

    # Secondary segment and buying triggers (0.5 pts each)
    if inp.secondary_segment.strip():
        score += 0.5
        notes.append("secondary segment defined")
    if inp.buying_triggers.strip():
        score += 0.5
        notes.append("buying triggers identified")

    return min(8.0, score), ", ".join(notes) or "no customer definition"


def _score_evidence_traction(inp: V4Input) -> tuple[float, str]:
    """Max 15 — based on best evidence type in EVIDENCE_HIERARCHY."""
    if not inp.evidence_types:
        return 0.0, "no evidence provided"

    best_raw = max((EVIDENCE_HIERARCHY.get(e, 0) for e in inp.evidence_types), default=0)
    # bonus for multiple types
    count_bonus = min(5, len(inp.evidence_types) - 1) * 2.0  # up to 10 more raw pts
    combined_raw = min(100.0, best_raw + count_bonus)
    score = round(combined_raw / 100.0 * 15.0, 2)
    best_type = max(inp.evidence_types, key=lambda e: EVIDENCE_HIERARCHY.get(e, 0))
    return score, f"best={best_type} ({best_raw}), types={len(inp.evidence_types)}"


def _score_solution_relevance(inp: V4Input) -> tuple[float, str]:
    """Max 8 — outcome defined, why better, why switch, time to value."""
    score = 0.0
    notes = []

    if len(inp.solution_description.strip()) > 40:
        score += 2.0
        notes.append("solution described")
    if inp.core_outcome.strip():
        score += 2.0
        notes.append("outcome defined")
    if inp.why_better.strip():
        score += 1.5
        notes.append("why-better stated")
    if inp.why_switch.strip():
        score += 1.0
        notes.append("switch reason stated")
    if inp.time_to_value.strip():
        score += 0.5
        notes.append("time-to-value stated")
    if inp.main_features:
        score += 1.0
        notes.append("features defined")

    return min(8.0, score), ", ".join(notes) or "no solution detail"


def _score_differentiation(inp: V4Input) -> tuple[float, str]:
    """Max 7 — competitor comparison, moat/IP, feature differentiation."""
    score = 0.0
    notes = []

    # Count all competitor categories: direct, indirect, substitutes, DIY alternatives
    diy_count = 1 if inp.diy_alternatives.strip() else 0
    total_competitors = (len(inp.direct_competitors) + len(inp.indirect_competitors) + len(inp.substitutes) + diy_count)
    if total_competitors >= 3:
        score += 3.0
        notes.append("competitors analyzed")
    elif total_competitors >= 1:
        score += 1.5
        notes.append("some competitors listed")

    moat_map = {"ip": 3.0, "network_effects": 3.0, "data": 2.5, "process": 2.0, "expertise": 2.0, "none": 0.0, "": 0.0}
    moat_score = moat_map.get(inp.ip_or_moat.lower(), 0.0)
    if moat_score > 0:
        score += moat_score
        notes.append(f"moat={inp.ip_or_moat}")

    if inp.defensibility.strip() and total_competitors > 0:
        score += 1.0
        notes.append("defensibility stated")

    return min(7.0, score), ", ".join(notes) or "no differentiation data"


def _score_demand_market(inp: V4Input) -> tuple[float, str]:
    """Max 12 — market size, growth, spending evidence, sources."""
    score = 0.0
    notes = []

    if inp.estimated_customers.strip():
        score += 3.0
        notes.append("customer estimate provided")
    if inp.market_growing.lower() == "yes":
        score += 3.0
        notes.append("market growing")
    elif inp.market_growing.lower() == "unknown":
        score += 0.5
    if inp.existing_spending.strip():
        score += 3.0
        notes.append("spending data")
    if inp.market_sources:
        score += min(3.0, len(inp.market_sources) * 1.5)
        notes.append(f"{len(inp.market_sources)} sources")
    # Demand evidence from traction
    demand_signals = {"search_demand", "landing_page_visits", "email_sign_ups", "social_media_engagement"}
    if any(e in demand_signals for e in inp.evidence_types):
        score += 1.0
        notes.append("demand signals")

    return min(12.0, score), ", ".join(notes) or "no market data"


def _score_competition_positioning(inp: V4Input) -> tuple[float, str]:
    """Max 7 — competitors listed, positioning clarity, competitive advantage."""
    score = 0.0
    notes = []

    if inp.direct_competitors:
        score += 2.0
        notes.append(f"{len(inp.direct_competitors)} direct competitors")
    if inp.indirect_competitors or inp.substitutes or inp.diy_alternatives.strip():
        score += 1.0
        notes.append("indirect/substitute/DIY listed")
    if inp.switching_barriers.strip():
        score += 1.0
        notes.append("switching barriers identified")
    # Positioning reflected in why_better + differentiation
    if inp.why_better.strip() and inp.direct_competitors:
        score += 2.0
        notes.append("competitive positioning stated")
    if inp.market_category.strip():
        score += 1.0
        notes.append("market category defined")

    return min(7.0, score), ", ".join(notes) or "no competition data"


def _score_revenue_pricing(inp: V4Input) -> tuple[float, str]:
    """Max 8 — model defined, price, WTP evidence, recurring."""
    score = 0.0
    notes = []

    if inp.revenue_model.strip():
        score += 2.0
        notes.append(f"model={inp.revenue_model}")
    if inp.proposed_price.strip():
        score += 2.0
        notes.append("price defined")
    if inp.willingness_to_pay_evidence:
        score += 2.0
        notes.append("WTP evidence")
    if inp.recurring_model:
        score += 1.0
        notes.append("recurring")
    if inp.payment_frequency.strip():
        score += 1.0
        notes.append(f"freq={inp.payment_frequency}")

    return min(8.0, score), ", ".join(notes) or "no revenue model"


def _score_unit_economics(inp: V4Input) -> tuple[float, str]:
    """Max 8 — costs known, margin calculable, break-even known."""
    if inp.validation_mode == "basic":
        # Basic mode doesn't collect cost data — score based on what's available
        if inp.proposed_price.strip() and inp.variable_cost_known:
            return 4.0, "price+cost (basic mode)"
        if inp.proposed_price.strip():
            return 2.0, "price only (basic mode)"
        return 0.0, "no economics data (basic mode)"

    score = 0.0
    notes = []

    if inp.variable_cost_known:
        score += 2.0
        notes.append("variable cost known")
    if inp.fixed_costs_monthly.strip():
        score += 2.0
        notes.append("fixed costs provided")
    if inp.gross_margin_estimate.strip():
        score += 2.0
        notes.append("margin estimate")
    if inp.has_paying_customers and inp.proposed_price.strip():
        score += 2.0
        notes.append("revenue validated")

    return min(8.0, score), ", ".join(notes) or "no cost data"


def _score_operational_feasibility(inp: V4Input) -> tuple[float, str]:
    """Max 6 — delivery model, capacity, bottlenecks."""
    if inp.validation_mode == "basic":
        return 3.0, "not assessed (basic mode)"

    score = 0.0
    notes = []

    if inp.delivery_model_defined:
        score += 2.0
        notes.append("delivery model defined")
    if inp.capacity_per_month.strip():
        score += 2.0
        notes.append("capacity defined")
    if inp.key_bottleneck.strip():
        score += 2.0
        notes.append("bottleneck identified")

    return min(6.0, score), ", ".join(notes) or "no operational data"


def _score_founder_readiness(inp: V4Input) -> tuple[float, str]:
    """Max 6 — experience, capital, time."""
    if inp.validation_mode == "basic":
        return 3.0, "not assessed (basic mode)"

    experience_map = {"deep": 2.0, "relevant": 2.0, "some": 1.0, "none": 0.0, "": 0.0}
    score = experience_map.get(inp.founder_industry_experience.lower(), 0.0)
    notes = [f"exp={inp.founder_industry_experience or 'unknown'}"]

    if inp.founder_capital_available:
        score += 2.0
        notes.append("capital available")
    if inp.founder_time_available:
        score += 2.0
        notes.append("time available")

    return min(6.0, score), ", ".join(notes)


def _score_regulatory_risk(inp: V4Input) -> tuple[float, str]:
    """Max 5 — inverse risk scoring (lower risk → higher score)."""
    if inp.validation_mode == "basic":
        return 3.0, "not assessed (basic mode)"

    risk_base = {
        "none": 5.0, "low": 4.0, "medium": 2.5, "high": 0.5, "unknown": 1.5, "": 1.5
    }
    score = risk_base.get(inp.regulatory_risk_level.lower(), 1.5)
    notes = [f"risk={inp.regulatory_risk_level or 'unknown'}"]

    if inp.regulatory_requirements_known and inp.regulatory_risk_level not in ("", "unknown"):
        score = min(5.0, score + 1.0)
        notes.append("requirements known")
    if inp.regulatory_mitigation_planned:
        score = min(5.0, score + 0.5)
        notes.append("mitigation planned")

    return min(5.0, score), ", ".join(notes)


# ---------------------------------------------------------------------------
# ECS DIMENSION SCORERS
# ---------------------------------------------------------------------------

def _ecs_input_completeness(inp: V4Input) -> tuple[float, str]:
    """Max 20 — proportion of applicable wizard steps completed."""
    basic_steps = {1, 2, 3, 4, 5, 6, 10}
    comp_steps = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}

    applicable = basic_steps if inp.validation_mode == "basic" else comp_steps
    completed = set(inp.steps_completed) & applicable
    ratio = len(completed) / len(applicable) if applicable else 0.0
    score = round(ratio * 20.0, 2)
    return score, f"{len(completed)}/{len(applicable)} steps completed"


def _ecs_primary_customer_evidence(inp: V4Input) -> tuple[float, str]:
    """Max 25 — based on best direct customer evidence."""
    direct_evidence = {
        "customer_interviews": 50,
        "survey_responses": 35,
        "informal_conversations": 20,
        "personal_experience": 15,
        "personal_anecdote": 15,
        "founder_assumption": 5,
    }
    best = max((direct_evidence.get(e, 0) for e in inp.evidence_types), default=0)
    # Bonus for paying customers
    if inp.has_paying_customers:
        best = max(best, 90)
    if inp.has_repeat_customers:
        best = max(best, 95)
    score = round(best / 100.0 * 25.0, 2)
    return score, f"primary_evidence_raw={best}"


def _ecs_behavioural_transaction_evidence(inp: V4Input) -> tuple[float, str]:
    """Max 25 — based on financial/behavioural evidence."""
    financial_scores = {
        "retention_data": 100, "repeat_customers": 98,
        "existing_customers": 95, "revenue": 92,
        "contracts": 90, "paid_pilots": 85,
        "usage_data": 78, "deposits": 75, "pre_orders": 70,
        "referrals": 80, "churn_data": 80,
    }
    intent_scores = {
        "waiting_list": 45, "letters_of_intent": 55,
        "requests_for_quotation": 60, "email_sign_ups": 28,
        "landing_page_visits": 25, "social_media_engagement": 15,
    }

    best = 0
    for e in inp.evidence_types:
        best = max(best, financial_scores.get(e, 0), intent_scores.get(e, 0))

    if inp.has_financial_commitment:
        best = max(best, 75)

    score = round(best / 100.0 * 25.0, 2)
    return score, f"behavioural_raw={best}"


def _ecs_external_market_evidence(inp: V4Input) -> tuple[float, str]:
    """Max 20 — market sources and verified claims."""
    if not inp.market_sources:
        if inp.estimated_customers.strip() or inp.market_growing.strip():
            return 5.0, "user estimates only"
        return 0.0, "no market evidence"

    n = len(inp.market_sources)
    raw = min(100, n * 25)  # 1 source = 25, 2 = 50, 3 = 75, 4+ = 100
    if inp.is_paid_plan:
        raw = min(100, raw + 20)  # paid plan can get verified sources
    score = round(raw / 100.0 * 20.0, 2)
    return score, f"{n} market sources"


def _ecs_source_quality(inp: V4Input) -> tuple[float, str]:
    """Max 10 — quality and recency of evidence sources."""
    if inp.is_paid_plan and inp.market_sources:
        # Paid plan has live-retrieved, recent sources
        return 8.0, "paid-plan verified sources"
    if inp.market_sources:
        return 5.0, "user-provided sources (unverified)"
    if inp.evidence_types:
        return 3.0, "traction evidence only"
    return 0.0, "no sources"


# ---------------------------------------------------------------------------
# VPS CALCULATOR
# ---------------------------------------------------------------------------

def _calculate_vps(inp: V4Input) -> dict:
    """Run all 12 VPS dimension scorers and return weighted total + detail."""
    scorers = {
        "problem_strength": _score_problem_strength,
        "customer_clarity": _score_customer_clarity,
        "evidence_traction": _score_evidence_traction,
        "solution_relevance": _score_solution_relevance,
        "differentiation": _score_differentiation,
        "demand_market": _score_demand_market,
        "competition_positioning": _score_competition_positioning,
        "revenue_pricing": _score_revenue_pricing,
        "unit_economics": _score_unit_economics,
        "operational_feasibility": _score_operational_feasibility,
        "founder_readiness": _score_founder_readiness,
        "regulatory_risk": _score_regulatory_risk,
    }

    dimensions = []
    total = 0.0

    for dim, fn in scorers.items():
        max_pts = VPS_WEIGHTS[dim]
        raw_score, note = fn(inp)
        # Normalise to 0-max_pts
        clamped = min(float(max_pts), max(0.0, raw_score))
        total += clamped
        dimensions.append({
            "dimension": dim,
            "score": round(clamped, 2),
            "max": max_pts,
            "pct": round(clamped / max_pts * 100, 1) if max_pts else 0,
            "note": note,
        })

    return {
        "total": round(total, 1),
        "dimensions": dimensions,
    }


# ---------------------------------------------------------------------------
# ECS CALCULATOR
# ---------------------------------------------------------------------------

def _calculate_ecs(inp: V4Input) -> dict:
    """Run all 5 ECS dimension scorers and return weighted total + detail."""
    scorers = {
        "input_completeness": _ecs_input_completeness,
        "primary_customer_evidence": _ecs_primary_customer_evidence,
        "behavioural_transaction_evidence": _ecs_behavioural_transaction_evidence,
        "external_market_evidence": _ecs_external_market_evidence,
        "source_quality_recency": _ecs_source_quality,
    }

    dimensions = []
    total = 0.0

    for dim, fn in scorers.items():
        max_pts = ECS_WEIGHTS[dim]
        raw_score, note = fn(inp)
        clamped = min(float(max_pts), max(0.0, raw_score))
        total += clamped
        dimensions.append({
            "dimension": dim,
            "score": round(clamped, 2),
            "max": max_pts,
            "pct": round(clamped / max_pts * 100, 1) if max_pts else 0,
            "note": note,
        })

    return {
        "total": round(total, 1),
        "dimensions": dimensions,
    }


# ---------------------------------------------------------------------------
# VERDICT ENGINE
# ---------------------------------------------------------------------------

VERDICT_DESCRIPTIONS = {
    "Weak Hypothesis": "Low potential and insufficient supporting evidence. The core assumptions need significant rethinking.",
    "Needs Reframing": "The problem, customer or solution is unclear. Clarify the core value proposition before proceeding.",
    "Developing Fit": "Some commercial logic exists, but important weaknesses remain in the problem-solution fit.",
    "Promising but Unvalidated": "The idea appears commercially plausible, but evidence is insufficient to support confidence.",
    "Evidence-Supported Opportunity": "Strong potential with credible supporting evidence. Continue structured validation.",
    "Early Market Validation": "Meaningful behavioural or financial evidence exists. Focus on unit economics and scale planning.",
    "Ready for Controlled Pilot": "The idea has sufficient evidence and commercial logic for a limited pilot.",
    "Ready for Scale Assessment": "Repeatable demand exists. Assess scaling economics and operational resilience.",
    "Strong Hypothesis, Insufficient Evidence": "The commercial logic is compelling, but evidence is insufficient. Prioritise customer validation.",
}


def _determine_verdict(potential: float, confidence: float, inp: V4Input) -> dict:
    """Map potential + confidence scores to a verdict category."""
    t = VERDICT_THRESHOLDS

    if potential < t["weak_hypothesis_max_potential"]:
        # Distinguish Weak Hypothesis from Needs Reframing
        if not inp.problem_description.strip() or not inp.primary_segment.strip():
            category = "Needs Reframing"
        else:
            category = "Weak Hypothesis"
    elif potential <= t["developing_fit_max_potential"]:
        category = "Developing Fit"
    elif potential <= t["promising_max_potential"]:
        if confidence < t["promising_min_confidence"]:
            category = "Promising but Unvalidated"
        else:
            category = "Evidence-Supported Opportunity"
    else:  # >= high_potential_min (75)
        if confidence < t["ready_pilot_min_confidence"]:
            category = "Strong Hypothesis, Insufficient Evidence"
        elif confidence <= t["ready_pilot_max_confidence"]:
            category = "Ready for Controlled Pilot"
        else:
            if inp.has_repeat_customers or "retention_data" in inp.evidence_types:
                category = "Ready for Scale Assessment"
            else:
                category = "Early Market Validation"

    return {
        "category": category,
        "description": VERDICT_DESCRIPTIONS.get(category, ""),
        "potential_score": round(potential, 1),
        "confidence_score": round(confidence, 1),
    }


# ---------------------------------------------------------------------------
# TAM / SAM / SOM ENGINE
# ---------------------------------------------------------------------------

def calculate_tam_sam_som(
    total_eligible_customers: Optional[int],
    avg_annual_revenue_per_customer: Optional[float],
    serviceable_pct: Optional[float],   # 0-100
    reachable_pct: Optional[float],     # 0-100
    initial_customers_acquirable: Optional[int],
    currency: str = "GBP",
) -> dict:
    """
    Bottom-up TAM/SAM/SOM calculator.

    TAM = total_eligible_customers × avg_annual_revenue_per_customer
    SAM = TAM × (serviceable_pct/100) × (reachable_pct/100)
    SOM = initial_customers_acquirable × avg_annual_revenue_per_customer
    """
    results: dict[str, Any] = {
        "currency": currency,
        "method": "bottom-up",
        "integrity_status": "ok",
        "integrity_notes": [],
    }

    if total_eligible_customers and avg_annual_revenue_per_customer:
        tam = total_eligible_customers * avg_annual_revenue_per_customer
        results["tam"] = {
            "value": tam,
            "formula": f"{total_eligible_customers:,} eligible customers × {currency}{avg_annual_revenue_per_customer:,.2f} avg annual revenue",
            "evidence_status": "CALCULATED_FROM_UNVERIFIED_INPUTS",
            "confidence": 30,
            "low_case": round(tam * 0.6, 2),
            "base_case": round(tam, 2),
            "high_case": round(tam * 1.5, 2),
        }
    else:
        results["tam"] = {"value": None, "note": "Not calculated — customer population or revenue data missing."}

    if "tam" in results and results["tam"].get("value") and serviceable_pct and reachable_pct:
        sam = results["tam"]["value"] * (serviceable_pct / 100.0) * (reachable_pct / 100.0)
        results["sam"] = {
            "value": sam,
            "formula": f"TAM × {serviceable_pct}% serviceable × {reachable_pct}% reachable",
            "evidence_status": "CALCULATED_FROM_UNVERIFIED_INPUTS",
            "confidence": 25,
            "low_case": round(sam * 0.5, 2),
            "base_case": round(sam, 2),
            "high_case": round(sam * 1.8, 2),
        }
    else:
        results["sam"] = {"value": None, "note": "Not calculated — serviceable/reachable percentage missing."}

    if initial_customers_acquirable and avg_annual_revenue_per_customer:
        som = initial_customers_acquirable * avg_annual_revenue_per_customer
        results["som"] = {
            "value": som,
            "formula": f"{initial_customers_acquirable:,} acquirable customers × {currency}{avg_annual_revenue_per_customer:,.2f}",
            "evidence_status": "CALCULATED_FROM_UNVERIFIED_INPUTS",
            "confidence": 20,
            "low_case": round(som * 0.4, 2),
            "base_case": round(som, 2),
            "high_case": round(som * 2.0, 2),
        }
    else:
        results["som"] = {"value": None, "note": "Not calculated — initial acquisition estimate missing."}

    # Integrity checks
    tam_val = (results.get("tam") or {}).get("value")
    sam_val = (results.get("sam") or {}).get("value")
    som_val = (results.get("som") or {}).get("value")

    if tam_val and sam_val and sam_val > tam_val:
        results["integrity_status"] = "fail"
        results["integrity_notes"].append("SAM exceeds TAM — check assumptions.")
    if sam_val and som_val and som_val > sam_val:
        results["integrity_status"] = "fail"
        results["integrity_notes"].append("SOM exceeds SAM — check assumptions.")

    return results


# ---------------------------------------------------------------------------
# CONTRADICTION ENGINE
# ---------------------------------------------------------------------------

def run_contradiction_checks(inp: V4Input, vps_dims: list[dict]) -> list[dict]:
    """
    Run automated contradiction checks.
    Returns a list of flagged contradiction objects.
    """
    flags = []

    def _flag(code: str, message: str, severity: str = "warning"):
        flags.append({"code": code, "message": message, "severity": severity})

    # 1. "No competitors" but competitors are listed
    all_competitors = inp.direct_competitors + inp.indirect_competitors + inp.substitutes
    if "no competitors" in inp.how_solve_currently.lower() and all_competitors:
        _flag("CONTRADICTORY_COMPETITOR_CLAIM", "States no competitors exist but lists specific competitors.", "error")

    # 2. High confidence with no customer evidence
    ecs_primary = next((d for d in vps_dims if d["dimension"] == "evidence_traction"), {})
    if ecs_primary.get("pct", 0) < 10 and inp.customer_specificity in ("narrow", "niche"):
        _flag("HIGH_SPECIFICITY_NO_EVIDENCE", "Narrow customer segment defined but no customer evidence collected.", "warning")

    # 3. Global launch for hyperlocal idea
    hyperlocal_types = {"local service", "local_service", "marketplace", "platform business"}
    if inp.idea_type.lower() in hyperlocal_types and inp.market_scope == "global":
        _flag("HYPERLOCAL_GLOBAL_LAUNCH", "A local or marketplace idea marked for global launch without density evidence.", "warning")

    # 4. Positive market claim with no sources
    if inp.market_growing == "yes" and not inp.market_sources:
        _flag("MARKET_CLAIM_NO_SOURCE", "Market described as growing but no sources provided.", "warning")

    # 5. High differentiation claim without competitor comparison
    diff_dim = next((d for d in vps_dims if d["dimension"] == "differentiation"), {})
    if diff_dim.get("pct", 0) >= 70 and not all_competitors:
        _flag("DIFFERENTIATION_NO_COMPETITORS", "High differentiation score but no competitors listed for comparison.", "warning")

    # 6. Revenue model defined but no pricing
    if inp.revenue_model.strip() and not inp.proposed_price.strip():
        _flag("REVENUE_MODEL_NO_PRICE", "Revenue model selected but no price or price range provided.", "info")

    # 7. High operational feasibility claim without delivery model
    if inp.validation_mode == "comprehensive" and not inp.delivery_model_defined and not inp.capacity_per_month.strip():
        _flag("NO_DELIVERY_MODEL", "Comprehensive validation completed without a delivery model or capacity estimate.", "info")

    # 8. Market validation based only on founder opinion
    opinion_only = all(e in {"founder_assumption", "personal_experience", "personal_anecdote"} for e in inp.evidence_types) if inp.evidence_types else False
    if opinion_only and inp.market_growing == "yes":
        _flag("MARKET_CLAIM_OPINION_ONLY", "Market validation based solely on founder opinion without external evidence.", "warning")

    # 9. Paid customers claimed but basic mode with no traction step
    if inp.has_paying_customers and 10 not in inp.steps_completed:
        _flag("PAYING_CUSTOMERS_NOT_DOCUMENTED", "Paying customers indicated but evidence step not completed.", "info")

    # 10. Broad customer definition
    if inp.customer_specificity == "broad" and not inp.beachhead_segment.strip():
        _flag("BROAD_CUSTOMER_NO_BEACHHEAD", "Customer segment is broad and no beachhead/niche is defined.", "warning")

    return flags


# ---------------------------------------------------------------------------
# VALIDATION EXPERIMENT GENERATOR
# ---------------------------------------------------------------------------

EXPERIMENT_LIBRARY: list[dict] = [
    {
        "id": "customer_interviews",
        "name": "Problem Discovery Interviews",
        "method": "Customer interviews",
        "applicable_stages": ["idea", "customer_discovery"],
        "applicable_evidence_gap": "primary_customer_evidence",
        "hypothesis": "The problem is real, frequent and painful enough for the target customer to pay to solve it.",
        "why_it_matters": "Customer interviews provide direct behavioural insight that cannot be inferred from market data.",
        "template": {
            "target_customer": "{primary_segment}",
            "method": "Semi-structured problem discovery interviews",
            "sample_size": "15–20 interviews",
            "duration": "14 days",
            "budget": "Low (£50–£200 in incentives)",
            "metric": "Proportion describing problem as frequent and painful",
            "pass_threshold": "At least 12 of 20 describe the problem as frequent AND painful",
            "partial_pass_threshold": "8–11 describe it as painful — continue with narrower segment",
            "fail_threshold": "Fewer than 8 confirm the problem — reframe or pivot",
            "evidence_to_collect": "Pain description, frequency, current spend, willingness to pay",
            "if_passed": "Proceed to solution validation and pricing test",
            "if_failed": "Revisit problem definition and customer segment",
        },
    },
    {
        "id": "willingness_to_pay",
        "name": "Pricing Validation Test",
        "method": "Pre-order or deposit test",
        "applicable_stages": ["customer_discovery", "prototype", "mvp"],
        "applicable_evidence_gap": "revenue_pricing",
        "hypothesis": "Target customers will commit financially to the proposed solution at the proposed price.",
        "why_it_matters": "Financial commitment is the strongest indicator of genuine demand beyond stated interest.",
        "template": {
            "target_customer": "{primary_segment}",
            "method": "Direct sales outreach with price proposal",
            "sample_size": "30–50 qualified leads",
            "duration": "21 days",
            "budget": "Low–medium (time + small ad spend)",
            "metric": "Conversion to pre-order or deposit",
            "pass_threshold": "5%+ conversion to financial commitment",
            "partial_pass_threshold": "2–4% conversion — adjust price or offer",
            "fail_threshold": "Below 2% — test lower price point or refine offer",
            "evidence_to_collect": "Objections raised, price sensitivity, deposit amounts",
            "if_passed": "Proceed to delivery and capacity planning",
            "if_failed": "Test alternative price points or value propositions",
        },
    },
    {
        "id": "landing_page_test",
        "name": "Demand Signal Test",
        "method": "Landing page with email capture",
        "applicable_stages": ["idea", "customer_discovery"],
        "applicable_evidence_gap": "demand_market",
        "hypothesis": "Sufficient demand exists to justify building the solution.",
        "why_it_matters": "Landing page conversion provides a scalable, cost-effective early signal without building a product.",
        "template": {
            "target_customer": "{primary_segment}",
            "method": "Targeted ads to a landing page with clear value proposition",
            "sample_size": "500–1,000 ad impressions",
            "duration": "7–14 days",
            "budget": "£50–£500 in paid traffic",
            "metric": "Email sign-up conversion rate",
            "pass_threshold": "3%+ email sign-up rate",
            "partial_pass_threshold": "1–2% — refine messaging or targeting",
            "fail_threshold": "Below 1% — test different value proposition",
            "evidence_to_collect": "Source channels, sign-up demographics, drop-off points",
            "if_passed": "Proceed to waiting list and customer interviews",
            "if_failed": "A/B test headlines, reframe benefit statement",
        },
    },
    {
        "id": "concierge_mvp",
        "name": "Concierge MVP Pilot",
        "method": "Manual service delivery",
        "applicable_stages": ["prototype", "mvp", "pilot"],
        "applicable_evidence_gap": "operational_feasibility",
        "hypothesis": "The service can be delivered manually at acceptable quality before automating.",
        "why_it_matters": "Validates delivery economics and customer satisfaction before technology investment.",
        "template": {
            "target_customer": "{primary_segment}",
            "method": "Manual, white-glove delivery to first 5–10 customers",
            "sample_size": "5–10 customers",
            "duration": "30 days",
            "budget": "Variable (cost of manual delivery)",
            "metric": "Customer satisfaction score and repeat usage",
            "pass_threshold": "80%+ satisfied AND at least 60% willing to pay full price",
            "partial_pass_threshold": "Satisfied but price sensitivity — test pricing",
            "fail_threshold": "Below 60% satisfied — revisit solution design",
            "evidence_to_collect": "Satisfaction scores, delivery time, customer feedback, churn",
            "if_passed": "Invest in automation and scale plan",
            "if_failed": "Diagnose delivery failure before scaling",
        },
    },
    {
        "id": "letter_of_intent",
        "name": "Letter of Intent Campaign",
        "method": "B2B intent collection",
        "applicable_stages": ["idea", "customer_discovery", "prototype"],
        "applicable_evidence_gap": "primary_customer_evidence",
        "hypothesis": "Target B2B buyers will formally document interest in the proposed solution.",
        "why_it_matters": "An LOI is stronger evidence than verbal interest but weaker than a signed contract.",
        "template": {
            "target_customer": "{primary_segment}",
            "method": "Outreach to {primary_segment} decision-makers requesting LOI",
            "sample_size": "20–40 outreach targets",
            "duration": "21 days",
            "budget": "Low (time and outreach tools)",
            "metric": "Number of signed LOIs",
            "pass_threshold": "3+ signed LOIs",
            "partial_pass_threshold": "1–2 LOIs — identify and address objections",
            "fail_threshold": "Zero LOIs — revisit value proposition or segment",
            "evidence_to_collect": "LOIs, objections, required conditions, procurement process",
            "if_passed": "Proceed to paid pilot or prototype demonstration",
            "if_failed": "Interview non-signatories to identify blockers",
        },
    },
]


def generate_experiments(inp: V4Input, vps_dims: list[dict], max_experiments: int = 5) -> list[dict]:
    """
    Select up to max_experiments experiments ranked by relevance to the idea's weakest dimensions.
    Fill in template variables with actual inputs.
    """
    # Identify weakest VPS dimensions by percentage
    weak_dims = sorted(
        [(d["dimension"], d.get("pct", 0)) for d in vps_dims],
        key=lambda x: x[1]
    )
    weak_dim_names = {d[0] for d in weak_dims[:4]}

    selected = []
    used_ids = set()

    for exp in EXPERIMENT_LIBRARY:
        if len(selected) >= max_experiments:
            break
        if exp["id"] in used_ids:
            continue
        # Check if experiment targets a weak dimension
        if exp.get("applicable_evidence_gap") in weak_dim_names or True:
            # Fill template variables
            template = dict(exp["template"])
            for k, v in template.items():
                if isinstance(v, str):
                    template[k] = v.replace("{primary_segment}", inp.primary_segment or "target customers")
            selected.append({
                "id": exp["id"],
                "name": exp["name"],
                "method": exp["method"],
                "hypothesis": exp["hypothesis"],
                "why_it_matters": exp["why_it_matters"],
                **template,
            })
            used_ids.add(exp["id"])

    return selected[:max_experiments]


# ---------------------------------------------------------------------------
# MAIN EVALUATOR
# ---------------------------------------------------------------------------

def evaluate_v4(inp: V4Input) -> dict:
    """
    Run the full V4 deterministic evaluation pipeline.

    Returns a structured result dict matching the V4 output contract.
    """
    # 1. Calculate VPS
    vps_result = _calculate_vps(inp)
    vps_total = vps_result["total"]
    vps_dims = vps_result["dimensions"]

    # 2. Calculate ECS
    ecs_result = _calculate_ecs(inp)
    ecs_total = ecs_result["total"]

    # 3. Determine verdict
    verdict = _determine_verdict(vps_total, ecs_total, inp)

    # 4. Contradiction checks
    contradictions = run_contradiction_checks(inp, vps_dims)

    # 5. Generate experiments
    experiments = generate_experiments(inp, vps_dims)

    # 6. Strongest and weakest dimensions
    sorted_dims = sorted(vps_dims, key=lambda d: d.get("pct", 0), reverse=True)
    strongest = sorted_dims[0] if sorted_dims else None
    weakest = sorted_dims[-1] if sorted_dims else None

    # 7. Risk flags derived from weakest dimensions
    _DIM_RISK_NOTES = {
        "problem_strength": (
            "The problem being solved lacks clarity or urgency. A weak problem definition means you may be building a solution nobody needs. "
            "Go back to your target customers, conduct discovery interviews, and quantify how often they experience this pain and what they currently do about it."
        ),
        "customer_clarity": (
            "Your target customer is too broadly defined. Without a precise customer segment, you cannot validate demand, price effectively, or build the right solution. "
            "Narrow down to a specific group with a shared characteristic, then confirm they actually experience the problem."
        ),
        "evidence_traction": (
            "There is no evidence of real customer interest or traction. Assertions about demand are not a substitute for proof. "
            "Run a landing page test, conduct at least 10 problem discovery interviews, or secure letters of intent before proceeding."
        ),
        "solution_relevance": (
            "Your solution does not clearly address the stated problem. Customers may not connect what you are offering to the pain you claim to solve. "
            "Map each product feature directly to a specific customer pain point and validate the connection with real users."
        ),
        "differentiation": (
            "No meaningful differentiation from existing alternatives has been defined. If customers can get the same outcome elsewhere, they have no reason to switch. "
            "Identify one specific angle where you are meaningfully better for a specific customer segment and build around that."
        ),
        "demand_market": (
            "Market demand is unproven and may be too small or too fragmented to sustain the business. "
            "Identify the total addressable market with credible data, then define your realistic serviceable segment and the revenue that represents."
        ),
        "competition_positioning": (
            "Your competitive position is weak or undefined. Without a clear reason to choose you over existing options, customer acquisition will be expensive and difficult. "
            "Map your top three competitors on two dimensions that matter most to customers and find the gap where you win."
        ),
        "revenue_pricing": (
            "No revenue model or pricing strategy has been defined. Without a clear monetisation path, the business has no route to sustainability. "
            "Decide on a pricing model, set a price, and test whether target customers will actually pay it."
        ),
        "unit_economics": (
            "Unit economics have not been modelled. Without knowing your customer acquisition cost, lifetime value, and gross margin, you cannot assess whether this business is viable at scale. "
            "Build a simple unit economics model: cost to acquire one customer, revenue from that customer over their lifetime, and the cost to serve them."
        ),
        "operational_feasibility": (
            "The operational plan has not been defined. Key questions about delivery infrastructure, supply chain, staffing, and tooling are unanswered. "
            "Map the end-to-end process for delivering your product or service to one customer, then identify every cost and dependency in that process."
        ),
        "founder_readiness": (
            "No founder or team information has been provided. Investors, partners, and early customers need confidence in who is building this and why they are the right people. "
            "Document the relevant experience and skills on your team and identify any critical capability gaps you need to fill."
        ),
        "regulatory_risk": (
            "The regulatory environment has not been assessed. Depending on your sector, licensing, compliance, data protection, or sector-specific regulations could add significant cost and delay. "
            "Research the key regulatory requirements for your industry and geography before committing further resources."
        ),
    }

    risk_flags = []
    for dim in sorted_dims[-4:]:
        if dim.get("pct", 100) < 40:
            key = dim["dimension"]
            pct = dim.get("pct", 0)
            severity = "high" if pct < 20 else "medium"
            note = _DIM_RISK_NOTES.get(
                key,
                f"{key.replace('_', ' ').title()} scored {pct}%. Review and strengthen this area before proceeding.",
            )
            risk_flags.append({"dimension": key, "severity": severity, "note": note})

    return {
        "engine_version": "4.0",
        "validation_mode": inp.validation_mode,
        "scores": {
            "potential_score": vps_total,
            "evidence_confidence_score": ecs_total,
            "vps_dimensions": vps_dims,
            "ecs_dimensions": ecs_result["dimensions"],
        },
        "verdict": verdict,
        "contradictions": contradictions,
        "risk_flags": risk_flags,
        "experiments": experiments,
        "summary": {
            "strongest_dimension": strongest,
            "weakest_dimension": weakest,
            "step_count": len(inp.steps_completed),
        },
        "trace": {
            "scoring_version": "v4.0",
            "vps_weights": VPS_WEIGHTS,
            "ecs_weights": ECS_WEIGHTS,
            "verdict_thresholds": VERDICT_THRESHOLDS,
            "evidence_types_provided": inp.evidence_types,
        },
    }


# ---------------------------------------------------------------------------
# PAYLOAD → V4INPUT CONVERTER
# ---------------------------------------------------------------------------

def _normalize_list(val) -> list[str]:
    """Accept both list[str] and newline/comma-separated strings so textarea input is handled correctly."""
    if isinstance(val, list):
        return [s.strip() for s in val if str(s).strip()]
    import re as _re
    return [s.strip() for s in _re.split(r"[\n\r,]+", str(val or "")) if s.strip()]


def v4_payload_to_input(payload: dict) -> V4Input:
    """
    Convert the raw wizard form payload (sent from frontend) to a V4Input object.
    """
    step1 = payload.get("step1") or {}
    step2 = payload.get("step2") or {}
    step3 = payload.get("step3") or {}
    step4 = payload.get("step4") or {}
    step5 = payload.get("step5") or {}
    step6 = payload.get("step6") or {}
    step7 = payload.get("step7") or {}
    step8 = payload.get("step8") or {}
    step9 = payload.get("step9") or {}
    step10 = payload.get("step10") or {}
    step11 = payload.get("step11") or {}
    step12 = payload.get("step12") or {}

    evidence_types = step10.get("evidence_types") or []
    fin_evidence = FINANCIAL_BEHAVIOURAL_EVIDENCE & set(evidence_types)
    intent_ev = INTENT_EVIDENCE & set(evidence_types)

    return V4Input(
        # Step 1
        idea_name=step1.get("idea_name", ""),
        idea_description=step1.get("idea_description", ""),
        idea_tagline=step1.get("idea_tagline", ""),
        idea_type=step1.get("idea_type", ""),
        idea_sector=step1.get("idea_sector", ""),
        business_stage=step1.get("business_stage", ""),
        customer_model=step1.get("customer_model", ""),
        operating_country=step1.get("operating_country", ""),
        launch_geography=step1.get("launch_geography", ""),
        future_geography=step1.get("future_geography", ""),
        # Step 2
        problem_description=step2.get("problem_description", ""),
        who_affected=step2.get("who_affected", ""),
        problem_trigger=step2.get("problem_trigger", ""),
        problem_frequency=step2.get("problem_frequency", ""),
        pain_severity=step2.get("pain_severity", ""),
        financial_impact_known=bool(step2.get("financial_impact_known", False)),
        financial_impact_description=step2.get("financial_impact_description", ""),
        urgency=step2.get("urgency", ""),
        problem_trend=step2.get("problem_trend", ""),
        if_nothing=step2.get("if_nothing", ""),
        problem_affects=step2.get("problem_affects", ""),
        evidence_problem_exists=step2.get("evidence_problem_exists", ""),
        # Step 3
        primary_segment=step3.get("primary_segment", ""),
        secondary_segment=step3.get("secondary_segment", ""),
        beachhead_segment=step3.get("beachhead_segment", ""),
        economic_buyer=step3.get("economic_buyer", ""),
        end_user=step3.get("end_user", ""),
        decision_maker=step3.get("decision_maker", ""),
        influencer=step3.get("influencer", ""),
        channels=step3.get("channels") or [],
        purchase_frequency=step3.get("purchase_frequency", ""),
        buying_triggers=step3.get("buying_triggers", ""),
        main_objections=step3.get("main_objections", ""),
        customer_specificity=step3.get("customer_specificity", ""),
        # Step 4
        how_solve_currently=step4.get("how_solve_currently", ""),
        direct_competitors=_normalize_list(step4.get("direct_competitors")),
        indirect_competitors=_normalize_list(step4.get("indirect_competitors")),
        substitutes=_normalize_list(step4.get("substitutes")),
        diy_alternatives=step4.get("diy_alternatives", ""),
        alternative_frustrations=step4.get("alternative_frustrations", ""),
        existing_spending=step4.get("existing_spending", ""),
        switching_barriers=step4.get("switching_barriers", ""),
        # Step 5
        solution_description=step5.get("solution_description", ""),
        core_outcome=step5.get("core_outcome", ""),
        main_features=_normalize_list(step5.get("main_features")),
        main_benefits=_normalize_list(step5.get("main_benefits")),
        delivery_method=step5.get("delivery_method", ""),
        why_better=step5.get("why_better", ""),
        why_switch=step5.get("why_switch", ""),
        behaviour_change=step5.get("behaviour_change", ""),
        time_to_value=step5.get("time_to_value", ""),
        defensibility=step5.get("defensibility", ""),
        ip_or_moat=step5.get("ip_or_moat", ""),
        # Step 6
        market_category=step6.get("market_category", ""),
        estimated_customers=step6.get("estimated_customers", ""),
        market_growing=step6.get("market_growing", ""),
        market_sources=step6.get("market_sources") or [],
        market_scope=step6.get("market_scope", ""),
        # Step 7
        revenue_model=step7.get("revenue_model", ""),
        proposed_price=step7.get("proposed_price", ""),
        payment_frequency=step7.get("payment_frequency", ""),
        willingness_to_pay_evidence=bool(step7.get("willingness_to_pay_evidence", False)),
        recurring_model=bool(step7.get("recurring_model", False)),
        # Step 8
        variable_cost_known=bool(step8.get("variable_cost_known", False)),
        variable_cost_per_unit=step8.get("variable_cost_per_unit", ""),
        fixed_costs_monthly=step8.get("fixed_costs_monthly", ""),
        gross_margin_estimate=step8.get("gross_margin_estimate", ""),
        # Step 9
        delivery_unit=step9.get("delivery_unit", ""),
        capacity_per_month=step9.get("capacity_per_month", ""),
        key_bottleneck=step9.get("key_bottleneck", ""),
        delivery_model_defined=bool(step9.get("delivery_model_defined", False)),
        # Step 10
        evidence_types=evidence_types,
        evidence_count=int(step10.get("evidence_count", len(evidence_types))),
        has_paying_customers=bool(step10.get("has_paying_customers", False)
                                  or any(e in {"existing_customers", "revenue", "paid_pilots"} for e in evidence_types)),
        has_repeat_customers=bool(step10.get("has_repeat_customers", False)
                                  or any(e in {"repeat_customers", "retention_data"} for e in evidence_types)),
        has_financial_commitment=bool(fin_evidence or intent_ev),
        # Step 11
        founder_industry_experience=step11.get("founder_industry_experience", ""),
        founder_capital_available=bool(step11.get("founder_capital_available", False)),
        founder_time_available=bool(step11.get("founder_time_available", False)),
        team_size=int(step11.get("team_size", 1) or 1),
        # Step 12
        regulatory_risk_level=step12.get("regulatory_risk_level", ""),
        regulatory_requirements_known=bool(step12.get("regulatory_requirements_known", False)),
        regulatory_mitigation_planned=bool(step12.get("regulatory_mitigation_planned", False)),
        # Meta
        validation_mode=payload.get("validation_mode", "basic"),
        is_paid_plan=bool(payload.get("is_paid_plan", False)),
        currency=payload.get("currency", "GBP"),
        steps_completed=payload.get("steps_completed") or [],
    )
