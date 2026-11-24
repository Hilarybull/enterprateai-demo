from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


ScenarioType = Literal["revenue_drop", "cost_increase", "price_change", "hire_employee"]


class BaseInputs(BaseModel):
    price_per_unit: float = Field(ge=0)
    units_per_month: float = Field(ge=0)
    fixed_costs_monthly: float = Field(ge=0)
    variable_cost_per_unit: float = Field(ge=0)
    starting_cash: float = Field(ge=0)


class SimulationRunRequest(BaseModel):
    base: BaseInputs
    scenario: ScenarioType
    percent: Optional[float] = Field(default=None, ge=0, le=100, description="Used for percent scenarios")
    new_price_per_unit: Optional[float] = Field(default=None, ge=0)
    employee_monthly_cost: Optional[float] = Field(default=None, ge=0)


class SimulationRunResponse(BaseModel):
    base_case: Dict[str, Any]
    scenario_result: Dict[str, Any]
    delta: Dict[str, Any]

