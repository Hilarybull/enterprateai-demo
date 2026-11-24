"""QA R2 to R4 on the free idea result.
R4: the Service Viability Engine on the QA fixture (price £45, cost £12, fixed £400, 60 sales, capacity 80,
demand = enquiries), checked against the spec's weights (35% margin, 25% break-even, 25% demand,
15% capacity) and the demand ladder. Nothing in the engine was changed."""
from types import SimpleNamespace

import pytest

from app.modules.agent import first_value
from app.modules.service_ideas.service import evaluate_service_idea

FIXTURE = {"description": "Mobile dog grooming", "customer": "Busy pet owners", "price": 45, "cost": 12, "fixed_costs": 400,
           "monthly_sales": 60, "capacity": 80, "demand": "enquiries"}
LADDER = {"repeat_paying_customers": 100, "paying_customers": 85, "paid_pilot": 70, "LOIs": 55, "enquiries": 40,
          "market_research": 30, "assumption_only": 15}


def _engine(demand="enquiries"):
    return evaluate_service_idea(SimpleNamespace(
        service_name="Dog grooming", price_per_sale=45, expected_sales_per_month=60, direct_labour_cost_per_sale=0, contractor_cost_per_sale=0,
        materials_cost_per_sale=0, travel_cost_per_sale=0, other_direct_cost_per_sale=0, assumed_cost_per_unit=12, monthly_software_cost=0,
        monthly_marketing_cost=0, monthly_admin_cost=0, monthly_rent_cost=0, monthly_other_fixed_cost=400, hours_required_per_sale=0,
        available_delivery_hours_per_month=0, required_capacity=80, demand_evidence_type=demand, number_of_paying_customers=0,
        number_of_interested_leads=0, target_market_scope="", target_customer_type="", country=""))


def test_r4_sub_scores_and_weights():
    s = _engine()["scores"]
    # Margin 73% (> 50%) → 100; break-even inside 6 months → 100; enquiries → 40 on the ladder; 75% of capacity → 100.
    assert (s["margin_score"], s["break_even_score"], s["demand_score"], s["capacity_score"]) == (100, 100, 40, 100)
    assert s["viability_score"] == pytest.approx(0.35 * 100 + 0.25 * 100 + 0.25 * 40 + 0.15 * 100) == 85.0
    assert _engine()["outcome"] == "Very Strong"      # 85 is the band's lower edge


@pytest.mark.parametrize("demand, score", LADDER.items())
def test_r4_the_demand_ladder(demand, score):
    assert _engine(demand)["scores"]["demand_score"] == score


def test_r2_break_even_is_rounded_up_and_the_raw_value_kept():
    r = first_value.assess("test_idea", FIXTURE)
    be = next(m for m in r["metrics"] if m["label"] == "Break-even")
    assert be["value"] == "13 sales a month" and be["raw"] == pytest.approx(400 / 33)      # 12.12 sales is 13 sales


def test_r3_enquiries_is_early_evidence_not_unknown():
    r = first_value.assess("test_idea", FIXTURE)
    demand = next(b for b in r["blockers"] if b["key"] == "demand")
    assert (demand["kind"], demand["state"], demand["label"]) == ("partial", "partially_met", "Demand evidence is early")
    unknown = next(b for b in r["blockers"] if b["key"] == "competitors")
    assert (unknown["kind"], unknown["state"]) == ("unknown", "unknown")
