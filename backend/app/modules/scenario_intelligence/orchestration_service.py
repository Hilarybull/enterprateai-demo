"""Multi-Engine Orchestration Service (Blueprint v3).

Wires all 5 engines + Master Aggregator:
  Viability → Survival → Stability → Growth → Fragility → Master Aggregator
"""

from typing import Any, Dict, Optional

from app.engines import (
    FragilityEngineInput,
    GrowthEngineInput,
    MasterAggregatorInput,
    MultiEngineScenarioInput,
    StabilityEngineInput,
    SurvivalEngineInput,
    run_fragility_engine,
    run_growth_engine,
    run_master_aggregator,
    run_multi_engine_scenario,
    run_stability_engine,
    run_survival_engine,
)
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot


def _safe_int(val: Any, default: int = 50) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _viability_score_from_output(viability_output: Any) -> int:
    """Extract a 0–100 viability score from evaluate_viability_v3 output."""
    if not viability_output:
        return 50
    if isinstance(viability_output, dict):
        for key in ("score", "viability_score", "overall_score"):
            v = viability_output.get(key)
            if isinstance(v, (int, float)):
                return _safe_int(v)
        # Try nested scores dict
        scores = viability_output.get("scores") or viability_output.get("result") or {}
        if isinstance(scores, dict):
            for key in ("score", "viability_score"):
                v = scores.get(key)
                if isinstance(v, (int, float)):
                    return _safe_int(v)
    return 50


def _viability_market_health(viability_output: Any) -> Optional[int]:
    """Extract market opportunity score from viability output."""
    if not viability_output or not isinstance(viability_output, dict):
        return None
    scores = viability_output.get("scores") or viability_output
    for key in ("market_score", "market_opportunity_score", "market_potential"):
        v = scores.get(key)
        if isinstance(v, (int, float)):
            return _safe_int(v)
    return None


async def run_full_engine_suite(
    business_state: BusinessStateSnapshot,
    financial_inputs: Optional[FinancialInputs] = None,
) -> Dict[str, Any]:
    """
    Run all engines on a given business state.
    Returns complete multi-engine analysis output including Master Aggregator.
    """
    business_id = getattr(business_state, "business_id", "unknown")

    # --- Viability Engine ---
    viability_output: Any = {}
    if financial_inputs:
        try:
            viability_output = evaluate_viability_v3(financial_inputs)
        except Exception:
            viability_output = {}

    viability_score = _viability_score_from_output(viability_output)

    # --- Survival Engine ---
    survival_input = SurvivalEngineInput(
        business_id=business_id,
        cash_balance=business_state.starting_cash,
        monthly_revenue=business_state.revenue_monthly,
        monthly_expenses=business_state.expenses_monthly,
        variable_costs_monthly=business_state.cost_of_sales_monthly,
        fixed_costs_monthly=max(
            0.0,
            business_state.expenses_monthly - business_state.cost_of_sales_monthly,
        ),
        net_cashflow_last_6_months=None,
    )
    survival_output = run_survival_engine(survival_input)
    survival_score = _safe_int(
        survival_output.scores.survival_score if survival_output.scores else 50
    )

    # --- Stability Engine ---
    stability_input = StabilityEngineInput(
        business_id=business_id,
        revenue_last_6_months=None,
        top1_customer_revenue_pct=business_state.top_client_share_pct,
        top3_customer_revenue_pct=None,
        customer_count=business_state.clients_count or 0,
        key_person_dependency=True,
        has_documented_processes=False,
        has_backup_personnel=False,
        capacity_utilisation_pct=min(
            100.0, business_state.capacity_utilisation_pct or 60.0
        ),
        order_backlog_months=None,
    )
    stability_output = run_stability_engine(stability_input)
    stability_score = _safe_int(
        stability_output.scores.stability_score if stability_output.scores else 50
    )

    # Dimension scores for downstream fragility wiring
    stability_scores = stability_output.scores
    predictability_score = _safe_int(stability_scores.predictability_score if stability_scores else 50)
    customer_stability_score = _safe_int(stability_scores.customer_stability_score if stability_scores else 50)
    operational_dep_score = _safe_int(stability_scores.operational_dependency_score if stability_scores else 50)
    capacity_health_score = _safe_int(stability_scores.capacity_health_score if stability_scores else 50)

    # Survival cash health — infer from cash_runway_months if available
    survival_scores = survival_output.scores
    cash_health_score: int
    if survival_scores:
        # Runway-based proxy: use the survival_score as cash health
        cash_health_score = _safe_int(survival_scores.survival_score)
    else:
        cash_health_score = 50

    # --- Growth Engine ---
    growth_input = GrowthEngineInput(
        business_id=business_id,
        revenue_last_6_months=None,
        # Qualitative blocks are not available from BusinessStateSnapshot;
        # pass None to let the engine use its own defaults.
        product_delivery=None,
        market_expansion=None,
        pricing=None,
        competitive=None,
    )
    growth_output = run_growth_engine(growth_input)
    growth_score = _safe_int(
        growth_output.scores.growth_score if growth_output.scores else 50
    )

    # --- Fragility Engine (engine-score derived) ---
    fragility_input = FragilityEngineInput(
        business_id=business_id,
        # Primary path: engine health scores
        survival_cash_health=cash_health_score,
        stability_predictability=predictability_score,
        stability_customer=customer_stability_score,
        stability_operational=operational_dep_score,
        stability_capacity=capacity_health_score,
        viability_market_health=_viability_market_health(viability_output),
        # Structural fallback fields
        top_client_share_pct=business_state.top_client_share_pct,
        client_count=business_state.clients_count or 1,
    )
    fragility_output = run_fragility_engine(fragility_input)
    fragility_index = _safe_int(
        fragility_output.scores.fragility_index if fragility_output.scores else 50
    )

    # --- Master Aggregator ---
    ma_input = MasterAggregatorInput(
        business_id=business_id,
        viability_score=viability_score,
        survival_score=survival_score,
        stability_score=stability_score,
        growth_score=growth_score,
        fragility_index=fragility_index,
        viability_risks=[],
        survival_risks=survival_output.risk_flags,
        stability_risks=stability_output.risk_flags,
        growth_risks=growth_output.risk_flags,
        fragility_risks=fragility_output.risk_flags,
        survival_recommendations=survival_output.recommendations,
        stability_recommendations=stability_output.recommendations,
        growth_recommendations=growth_output.recommendations,
        viability_recommendations=[],
        source="orchestration",
    )
    ma_output = run_master_aggregator(ma_input)

    return {
        "viability": viability_output if isinstance(viability_output, dict) else {},
        "survival": survival_output.to_dict(),
        "stability": stability_output.to_dict(),
        "growth": growth_output.to_dict(),
        "fragility": fragility_output.to_dict(),
        "master": ma_output.to_dict(),
    }


async def run_scenario_with_all_engines(
    scenario_id: str,
    business_id: str,
    tenant_id: str,
    business_state: BusinessStateSnapshot,
    scenario_type: str,
    parameters: Dict[str, Any],
    timeline_months: int = 6,
) -> Dict[str, Any]:
    """
    Run a scenario simulation across all engines.
    """
    baseline_outputs = await run_full_engine_suite(business_state, None)

    scenario_input = MultiEngineScenarioInput(
        scenario_id=scenario_id,
        business_id=business_id,
        tenant_id=tenant_id,
        viability_state=baseline_outputs.get("viability"),
        survival_state=baseline_outputs.get("survival"),
        stability_state=baseline_outputs.get("stability"),
        growth_state=baseline_outputs.get("growth"),
        fragility_state=baseline_outputs.get("fragility"),
        scenario_type=scenario_type,
        parameters=parameters,
        scenario_changes=[{"type": scenario_type, **parameters}],
        timeline_months=timeline_months,
    )

    scenario_output = run_multi_engine_scenario(scenario_input)

    return {
        "baseline": baseline_outputs,
        "scenario": scenario_output.to_dict(),
    }
