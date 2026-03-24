from __future__ import annotations

from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3
from app.modules.simulation.schemas import BaseInputs, SimulationRunRequest


def _to_fin(inputs: BaseInputs) -> FinancialInputs:
    return FinancialInputs(
        price_per_unit=float(inputs.price_per_unit),
        units_per_month=float(inputs.units_per_month),
        fixed_costs_monthly=float(inputs.fixed_costs_monthly),
        variable_cost_per_unit=float(inputs.variable_cost_per_unit),
        starting_cash=float(inputs.starting_cash),
    )


def _apply_scenario(req: SimulationRunRequest) -> FinancialInputs:
    base = req.base
    price = float(base.price_per_unit)
    units = float(base.units_per_month)
    fixed = float(base.fixed_costs_monthly)
    variable = float(base.variable_cost_per_unit)
    cash = float(base.starting_cash)

    if req.scenario == "revenue_drop":
        p = float(req.percent or 0.0) / 100.0
        units = max(0.0, units * (1.0 - p))
    elif req.scenario == "cost_increase":
        p = float(req.percent or 0.0) / 100.0
        fixed = max(0.0, fixed * (1.0 + p))
        variable = max(0.0, variable * (1.0 + p))
    elif req.scenario == "price_change":
        if req.new_price_per_unit is None:
            raise ValueError("new_price_per_unit is required for price_change")
        price = float(req.new_price_per_unit)
    elif req.scenario == "hire_employee":
        cost = float(req.employee_monthly_cost or 0.0)
        fixed = max(0.0, fixed + cost)

    return FinancialInputs(
        price_per_unit=price,
        units_per_month=units,
        fixed_costs_monthly=fixed,
        variable_cost_per_unit=variable,
        starting_cash=cash,
    )


def _delta(base_metrics: dict, scenario_metrics: dict) -> dict:
    keys = set(base_metrics.keys()) | set(scenario_metrics.keys())
    out: dict = {}
    for k in keys:
        a = base_metrics.get(k)
        b = scenario_metrics.get(k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            out[k] = b - a
        else:
            out[k] = {"from": a, "to": b}
    return out


def run_simulation(req: SimulationRunRequest) -> dict:
    base_case = evaluate_viability_v3(_to_fin(req.base))
    scenario_case = evaluate_viability_v3(_apply_scenario(req))
    return {
        "base_case": base_case,
        "scenario_result": scenario_case,
        "delta": _delta(base_case["metrics"], scenario_case["metrics"]),
    }
