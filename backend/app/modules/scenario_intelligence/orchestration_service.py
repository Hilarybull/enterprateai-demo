"""Multi-Engine Orchestration Service.

Simulation audit, Phase 0 (16 Nov 2026), findings F3 and F4:

* An engine runs only on inputs the business actually has. The simulation's business snapshot holds cash, revenue,
  costs, client share and capacity; it has no revenue history, no information about key people, processes or backup
  staff, and no unit-level pricing. Engines that depend on those (stability, growth, fragility, and viability from a
  snapshot) are reported as **not assessed**, with the reason, instead of being run on invented values. Previously every
  business was assumed to depend on one key person with no documented processes and no backup staff.
* Scenario engine changes are recomputed from the business's own figures (see app.engines.scenario.orchestrator), never
  taken from a fixed table.
* Survival is given total costs (operating expenses + cost of sales). It was given operating expenses only, which left
  cost of sales out of the cash burn.
"""

from typing import Any, Dict, Optional

from app.engines import (
    MultiEngineScenarioInput,
    SurvivalEngineInput,
    run_multi_engine_scenario,
    run_survival_engine,
)
from app.engines.survival.schemas import ConfidenceLevel
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot

NOT_ASSESSED_REASONS = {
    "viability": "Needs price per unit, units sold and costs per unit; the simulation works from monthly totals.",
    "stability": "Needs at least 3 months of revenue history and information about key people, documented processes "
                 "and backup staff, which are not on record.",
    "growth": "Needs at least 3 months of revenue history, which is not on record.",
    "fragility": "Built from the stability and viability assessments, which are not available.",
    "master": "The overall score needs viability, survival, stability and growth all assessed.",
}


def _not_assessed(engine: str) -> Dict[str, Any]:
    return {"engine": engine, "assessed": False, "reason": NOT_ASSESSED_REASONS[engine], "scores": None}


def _survival(business_state: BusinessStateSnapshot) -> Dict[str, Any]:
    expenses = float(business_state.expenses_monthly or 0.0)
    cost_of_sales = float(business_state.cost_of_sales_monthly or 0.0)
    total_costs = float(business_state.costs_monthly or 0.0) or (expenses + cost_of_sales)
    output = run_survival_engine(SurvivalEngineInput(
        business_id=str(getattr(business_state, "business_id", "") or "unknown"),
        cash_balance=float(business_state.starting_cash or 0.0),
        monthly_revenue=float(business_state.revenue_monthly or 0.0),
        monthly_expenses=total_costs,
        variable_costs_monthly=cost_of_sales,
        fixed_costs_monthly=expenses,
        net_cashflow_last_6_months=None,
        confidence_level=ConfidenceLevel.LOW,      # a single month's figures, no history
    ))
    out = output.to_dict()
    out["assessed"] = True
    out["data_gaps"] = ["No cashflow history: volatility is scored neutral (50) and confidence is LOW."]
    return out


async def run_full_engine_suite(
    business_state: BusinessStateSnapshot,
    financial_inputs: Optional[FinancialInputs] = None,
) -> Dict[str, Any]:
    """Run each engine that the business's data supports; report the rest as not assessed, with the reason."""
    viability: Dict[str, Any] = _not_assessed("viability")
    if financial_inputs is not None:
        viability = {**evaluate_viability_v3(financial_inputs), "engine": "viability", "assessed": True}

    out = {
        "viability": viability,
        "survival": _survival(business_state),
        "stability": _not_assessed("stability"),
        "growth": _not_assessed("growth"),
        "fragility": _not_assessed("fragility"),
        "master": {**_not_assessed("master"), "bi_score": None},
    }
    out["coverage"] = {
        "assessed": [k for k, v in out.items() if isinstance(v, dict) and v.get("assessed")],
        "not_assessed": {k: v["reason"] for k, v in out.items() if isinstance(v, dict) and v.get("assessed") is False},
    }
    return out


async def run_scenario_with_all_engines(
    scenario_id: str,
    business_id: str,
    tenant_id: str,
    baseline_end_state: BusinessStateSnapshot,
    scenario_end_state: BusinessStateSnapshot,
    scenario_type: str,
    timeline_months: int = 6,
    verdict: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Engine scores at the end of the period for the business with and without the change, and the difference.

    Both states come from the cash projection (monthly figures in the final month and the closing cash), so the
    comparison is like for like: same business, same month, only the scenario differs."""
    baseline_outputs = await run_full_engine_suite(baseline_end_state)
    scenario_outputs = await run_full_engine_suite(scenario_end_state)
    scenario_output = run_multi_engine_scenario(MultiEngineScenarioInput(
        scenario_id=scenario_id,
        business_id=business_id,
        tenant_id=tenant_id,
        baseline_outputs=baseline_outputs,
        scenario_outputs=scenario_outputs,
        scenario_type=scenario_type,
        timeline_months=timeline_months,
        verdict=verdict or {},
    ))
    return {
        "basis": f"Engine scores at the end of month {timeline_months}, with and without the change.",
        "baseline": baseline_outputs,
        "scenario": scenario_output.to_dict(),
    }
