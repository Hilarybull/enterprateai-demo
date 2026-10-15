"""The price list as the migrations leave it (QA PF1): what every paid action costs, the plan it starts on, and
whether it is charged at all. The database's credit_feature_config rows are the live list and win; this is what is
used when a row is missing, so a feature never fails as "not found" because a seed didn't run on a database (the
dev database, for one, holds only the Agent's rows). A test keeps it equal to migration 016, where most rows come
from, and checks that every feature the code charges for is here.

Credit allocation v2 (migration 042, 15 Oct 2026), the owner's chart: Agent help on a free tool 2 (agent_task), AI plan
section rewrite 5, AI Sales Letter 4, AI Business Proposal 10, AI Business Plan 40, Comprehensive idea validation 25 (Basic
is deterministic and free), Find my best price 40, Find customer opportunities 40, Resolve launch blockers 50, Funding
readiness research 60, Adaptive Scenario Intelligence 15 (scenario_ai_interpretation), Live intelligence manual refresh
20 (live_plan_full_refresh).

Columns: (name, credit_cost, enabled, minimum_plan, refundable_on_failure, credit_controlled).
Deterministic work (scenario runs, recalculations, KPI refreshes) costs 0 and is not credit-controlled: the Credit
System v2 spec, §6, "Do not charge 10 credits merely because the user clicks Run Scenario".
"""
from __future__ import annotations

FEATURES: dict[str, tuple[str, int, bool, str, bool, bool]] = {
    # migration 016 (credit system v2)
    "idea_validation": ("Idea Validation", 0, True, "explorer", True, False),      # Basic: deterministic, free (042)
    "idea_validation_comprehensive": ("Idea Validation (Comprehensive)", 25, True, "starter_insight", True, True),
    "market_data_refresh": ("Market Data Refresh", 4, True, "explorer", True, True),
    "business_plan_full": ("Complete Business Plan", 40, True, "explorer", True, True),
    "business_plan_section": ("Regenerate Business Plan Section", 5, True, "explorer", True, True),
    "proposal_full": ("Complete Business Proposal", 10, True, "starter_insight", True, True),
    "proposal_section": ("Regenerate Proposal Section", 2, True, "starter_insight", True, True),
    "sales_letter_full": ("Complete Sales Letter", 4, True, "starter_insight", True, True),
    "sales_letter_section": ("Regenerate Sales Letter Section", 1, True, "starter_insight", True, True),
    "fragility_ai_interpretation": ("AI Fragility Index Interpretation", 3, True, "starter_insight", True, True),
    "scenario_simulation": ("Scenario Simulation", 0, True, "explorer", True, False),
    "scenario_deterministic": ("Scenario Deterministic Run", 0, True, "explorer", True, False),
    "scenario_multi_compare_deterministic": ("Scenario Multi-Compare", 0, True, "explorer", True, False),
    "sensitivity_deterministic": ("Sensitivity Deterministic Run", 0, True, "explorer", True, False),
    "breakpoint_deterministic": ("Break-even Deterministic Run", 0, True, "explorer", True, False),
    "safe_zone_deterministic": ("Safe Zone Deterministic Run", 0, True, "explorer", True, False),
    "scenario_ai_interpretation": ("Scenario AI Interpretation", 15, True, "starter_insight", True, True),
    "scenario_ai_recommendation": ("Scenario AI Recommendation", 3, True, "starter_insight", True, True),
    "scenario_comparison_ai_summary": ("Scenario Comparison AI Summary", 5, True, "starter_insight", True, True),
    "sensitivity_ai_interpretation": ("Sensitivity AI Interpretation", 3, True, "starter_insight", True, True),
    "live_plan_kpi_refresh": ("Live Plan KPI Refresh", 0, True, "explorer", True, False),
    "live_plan_variance": ("Live Plan Variance", 0, True, "explorer", True, False),
    "live_plan_scenario_adopt": ("Live Plan Scenario Adoption", 0, True, "explorer", True, False),
    "live_plan_import_extract": ("Live Plan Import & Extract", 10, True, "decision_engine", True, True),
    "live_plan_section_refresh": ("Live Plan Section Refresh", 3, True, "decision_engine", True, True),
    "live_plan_variance_interpretation": ("Live Plan Variance Interpretation", 3, True, "decision_engine", True, True),
    "decision_ai_summary": ("Decision AI Summary", 3, True, "decision_engine", True, True),
    "decision_narrative_update": ("Decision Narrative Update", 5, True, "decision_engine", True, True),
    "live_plan_full_refresh": ("Live Plan Full Refresh", 20, True, "decision_engine", True, True),
    "live_plan_monthly_review": ("Live Plan Monthly Review", 10, True, "decision_engine", True, True),
    "integration_sync": ("Integration Sync", 0, True, "decision_engine", True, False),
    "integration_ai_insight": ("Integration AI Insight", 3, True, "decision_engine", True, True),
    "engine_recalculation": ("Engine Recalculation", 0, True, "explorer", True, False),
    "suggest_field": ("AI Field Suggestion", 2, True, "explorer", False, True),
    # later migrations
    "chat_message": ("Business Assistant Chat", 2, True, "explorer", True, True),          # 035
    "email_share": ("Email Share / Send", 1, True, "explorer", False, True),               # 009
    "simulation_run": ("Simulation Scenario Run", 3, True, "explorer", False, True),      # 010 (no longer charged by the page)
    "rfq_response": ("RFQ Response", 1, True, "explorer", True, True),                     # 025
    "agent_task": ("Agent: task", 2, True, "explorer", True, True),                        # 039
    "agent_classify": ("Agent: classify enquiry", 1, True, "explorer", True, True),        # 027
    "agent_quote_draft": ("Agent: prepare quotation", 2, True, "explorer", True, True),
    "agent_contract_draft": ("Agent: prepare contract", 2, True, "explorer", True, True),
    "agent_invoice_draft": ("Agent: prepare invoice", 2, True, "explorer", True, True),
    "agent_send": ("Agent: send document", 1, True, "explorer", True, True),
    "agent_reminder": ("Agent: payment reminder", 1, True, "explorer", True, True),
    "agent_receipt": ("Agent: receipt", 1, True, "explorer", True, True),
    "agent_analyse": ("Agent: risk & scenario analysis", 1, True, "explorer", True, True),
    # 042 (credit allocation v2, 15 Oct 2026): the premium research of each check, one price a run
    "research_launch_blockers": ("Resolve launch blockers", 50, True, "starter_insight", True, True),
    "research_funding_readiness": ("Funding readiness research", 60, True, "starter_insight", True, True),
    "research_best_price": ("Find my best price", 40, True, "starter_insight", True, True),
    "research_customer_opportunities": ("Find customer opportunities", 40, True, "starter_insight", True, True),
}


def default_config(feature_code: str) -> dict | None:
    """The row for this feature as the migrations write it, or None for a feature no migration has."""
    row = FEATURES.get(feature_code)
    if not row:
        return None
    name, cost, enabled, minimum, refundable, controlled = row
    return {"feature_code": feature_code, "feature_name": name, "credit_cost": cost, "enabled": enabled, "minimum_plan": minimum,
            "refundable_on_failure": refundable, "credit_controlled": controlled, "source": "catalogue"}
