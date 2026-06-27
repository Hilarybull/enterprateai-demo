from __future__ import annotations

from math import isnan

from app.modules.service_ideas.schemas import ServiceIdeaValidateRequest


def evaluate_service_idea(payload: ServiceIdeaValidateRequest) -> dict:
    # Revenue
    monthly_revenue = payload.price_per_sale * payload.expected_sales_per_month

    # Variable costs — use assumed_cost_per_unit as fallback when detailed breakdown is all zero
    detailed_variable_cost = (
        payload.direct_labour_cost_per_sale
        + payload.contractor_cost_per_sale
        + payload.materials_cost_per_sale
        + payload.travel_cost_per_sale
        + payload.other_direct_cost_per_sale
    )
    variable_cost_per_sale = detailed_variable_cost if detailed_variable_cost > 0 else payload.assumed_cost_per_unit
    monthly_variable_cost = variable_cost_per_sale * payload.expected_sales_per_month

    # Fixed costs
    monthly_fixed_cost = (
        payload.monthly_software_cost
        + payload.monthly_marketing_cost
        + payload.monthly_admin_cost
        + payload.monthly_rent_cost
        + payload.monthly_other_fixed_cost
    )

    # Contribution
    contribution_per_sale = payload.price_per_sale - variable_cost_per_sale
    if monthly_revenue <= 0:
        contribution_margin = 0
    else:
        contribution_margin = (monthly_revenue - monthly_variable_cost) / monthly_revenue

    # Break-even
    if contribution_per_sale <= 0:
        break_even_sales = None
        break_even_months = None
    else:
        break_even_sales = monthly_fixed_cost / contribution_per_sale
        if payload.expected_sales_per_month <= 0:
            break_even_months = None
        else:
            break_even_months = break_even_sales / payload.expected_sales_per_month

    # Capacity — use required_capacity as fallback when hours-based capacity is unknown
    if payload.hours_required_per_sale > 0:
        capacity_sales_per_month = payload.available_delivery_hours_per_month / payload.hours_required_per_sale
    elif payload.required_capacity > 0:
        capacity_sales_per_month = payload.required_capacity
    else:
        capacity_sales_per_month = 0

    capacity_utilisation = (
        payload.expected_sales_per_month / capacity_sales_per_month if capacity_sales_per_month > 0 else 0
    )
    capacity_feasible = capacity_sales_per_month == 0 or payload.expected_sales_per_month <= capacity_sales_per_month

    # Scores
    if contribution_margin > 0.5:
        margin_score = 100
    elif contribution_margin >= 0.3:
        margin_score = 75
    elif contribution_margin >= 0.15:
        margin_score = 50
    else:
        margin_score = 20

    if break_even_months is None:
        break_even_score = 20
    elif break_even_months <= 6:
        break_even_score = 100
    elif break_even_months <= 12:
        break_even_score = 75
    elif break_even_months <= 24:
        break_even_score = 50
    else:
        break_even_score = 20

    demand_map = {
        "repeat_paying_customers": 100,
        "paying_customers": 85,
        "paid_pilot": 70,
        "LOIs": 55,
        "enquiries": 40,
        "market_research": 30,
        "assumption_only": 15,
    }
    demand_score = demand_map.get(payload.demand_evidence_type, 15)
    if payload.number_of_paying_customers >= 5:
        demand_score += 5
    if payload.number_of_interested_leads >= 20:
        demand_score += 5
    demand_score = min(demand_score, 100)

    if not capacity_feasible:
        capacity_score = 20
    elif 0.5 <= capacity_utilisation <= 0.8:
        capacity_score = 100
    elif capacity_utilisation > 0.8:
        capacity_score = 70
    else:
        capacity_score = 60

    viability_score = (
        0.35 * margin_score
        + 0.25 * break_even_score
        + 0.25 * demand_score
        + 0.15 * capacity_score
    )

    if viability_score >= 85:
        outcome = "Very Strong"
    elif viability_score >= 70:
        outcome = "Strong"
    elif viability_score >= 50:
        outcome = "Fair"
    else:
        outcome = "Weak"

    risk_flags: list[str] = []
    if contribution_margin < 0.30:
        risk_flags.append("LOW_MARGIN_RISK")
    if break_even_sales is None:
        risk_flags.append("NO_BREAK_EVEN_RISK")
    if break_even_months is not None and break_even_months > 12:
        risk_flags.append("SLOW_PAYBACK_RISK")
    if demand_score <= 30:
        risk_flags.append("UNPROVEN_DEMAND_RISK")
    if not capacity_feasible:
        risk_flags.append("CAPACITY_CONSTRAINT_RISK")
    if capacity_utilisation > 0.90:
        risk_flags.append("OVERLOAD_RISK")

    summary = (
        "The service idea shows strong economics, fast break-even, and feasible delivery capacity."
        if outcome in {"Very Strong", "Strong"}
        else "The service idea may work, but there are important weaknesses to address before scaling."
    )
    key_driver = "High contribution margin" if margin_score >= max(break_even_score, demand_score, capacity_score) else "Demand evidence"
    recommendation = (
        "Proceed to pilot launch and validate repeat demand."
        if outcome in {"Very Strong", "Strong"}
        else "Refine pricing, cost structure, or demand validation before scaling."
    )

    metrics = {
        "monthly_revenue": monthly_revenue,
        "monthly_variable_cost": monthly_variable_cost,
        "monthly_fixed_cost": monthly_fixed_cost,
        "contribution_per_sale": contribution_per_sale,
        "contribution_margin": contribution_margin,
        "break_even_sales": break_even_sales,
        "break_even_months": break_even_months,
        "capacity_sales_per_month": capacity_sales_per_month,
        "capacity_utilisation": capacity_utilisation,
        "capacity_feasible": capacity_feasible,
        "effective_cost_per_unit": variable_cost_per_sale,
    }

    scores = {
        "margin_score": margin_score,
        "break_even_score": break_even_score,
        "demand_score": demand_score,
        "capacity_score": capacity_score,
        "viability_score": viability_score,
    }

    market_context = f"Market: {payload.target_market_scope}, {payload.target_customer_type}"
    if payload.country:
        market_context = f"{payload.country} — {payload.target_market_scope} market, targeting {payload.target_customer_type}"

    interpretation = {
        "summary": summary,
        "key_driver": key_driver,
        "recommendation": recommendation,
        "market_context": market_context,
    }

    return {
        "service_name": payload.service_name,
        "metrics": metrics,
        "scores": scores,
        "outcome": outcome,
        "risk_flags": risk_flags,
        "interpretation": interpretation,
    }
