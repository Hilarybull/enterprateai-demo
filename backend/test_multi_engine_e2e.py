"""
End-to-end test for multi-engine orchestration system.
Tests all 5 engines (viability, survival, stability, growth, fragility) with sample business data.
"""
import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot
from app.modules.scenario_intelligence.orchestration_service import (
    run_full_engine_suite,
    run_scenario_with_all_engines,
)


def print_header(text: str):
    """Print a formatted header."""
    print(f"\n{'='*60}")
    print(f"  {text}")
    print(f"{'='*60}\n")


def print_engine_output(engine_name: str, output: dict):
    """Pretty-print engine output."""
    print(f"\n{engine_name}:")
    print(f"  Type: {output.get('engine', 'N/A')}")
    print(f"  Version: {output.get('version', 'N/A')}")
    if "metrics" in output:
        print(f"  Metrics: {output['metrics']}")
    if "scores" in output:
        print(f"  Scores: {output['scores']}")
    if "classification" in output:
        print(f"  Classification: {output['classification']}")
    if "risk_flags" in output:
        print(f"  Risk Flags: {output['risk_flags']}")
    if "recommendations" in output and output["recommendations"]:
        print(f"  Recommendations: {output['recommendations'][:2]}")  # Show first 2


async def test_full_engine_suite():
    """Test all engines running on a single business state."""
    print_header("TEST 1: Full Engine Suite (Baseline)")
    
    # Create a sample business state - moderate risk scenario
    state = BusinessStateSnapshot(
        revenue_monthly=50000.0,
        expenses_monthly=30000.0,
        cost_of_sales_monthly=15000.0,
        costs_monthly=45000.0,
        starting_cash=80000.0,
        top_client_share_pct=45.0,  # High client concentration
        capacity_utilisation_pct=72.0,
        payment_terms_days=30,
        sales_cycle_days=45,
        clients_count=8,
        approaching_receivables_count=2,
        overdue_receivables_count=0,
        approaching_payables_count=1,
        overdue_payables_count=0,
    )
    
    print("Input Business State:")
    print(f"  Monthly Revenue: ${state.revenue_monthly:,.0f}")
    print(f"  Monthly Costs: ${state.costs_monthly:,.0f}")
    print(f"  Cash Balance: ${state.starting_cash:,.0f}")
    print(f"  Top Client Concentration: {state.top_client_share_pct}%")
    print(f"  Capacity Utilization: {state.capacity_utilisation_pct}%")
    
    # Run all engines
    try:
        outputs = await run_full_engine_suite(state, None)
        
        print("\n✅ Multi-Engine Suite Result:")
        
        # Viability
        if outputs.get("viability"):
            print_engine_output("Viability Engine", outputs["viability"])
        else:
            print("  Viability: (no financial inputs provided)")
        
        # Survival
        if outputs.get("survival"):
            print_engine_output("Survival Engine", outputs["survival"])
        
        # Growth
        if outputs.get("growth"):
            print_engine_output("Growth Engine", outputs["growth"])
        
        # Fragility
        if outputs.get("fragility"):
            print_engine_output("Fragility Engine", outputs["fragility"])
        
        # Stability
        if outputs.get("stability"):
            stability_score = outputs["stability"].get("score")
            print(f"\nStability Engine:")
            print(f"  Stability Score: {stability_score}")
        
        return True, outputs
    
    except Exception as e:
        print(f"\n❌ Error running engine suite: {e}")
        import traceback
        traceback.print_exc()
        return False, None


async def test_scenario_orchestration():
    """Test full scenario orchestration with all engines."""
    print_header("TEST 2: Multi-Engine Scenario Orchestration")
    
    # Baseline state
    baseline_state = BusinessStateSnapshot(
        revenue_monthly=50000.0,
        expenses_monthly=30000.0,
        cost_of_sales_monthly=15000.0,
        costs_monthly=45000.0,
        starting_cash=80000.0,
        top_client_share_pct=45.0,
        capacity_utilisation_pct=72.0,
        payment_terms_days=30,
        sales_cycle_days=45,
        clients_count=8,
        approaching_receivables_count=2,
        overdue_receivables_count=0,
        approaching_payables_count=1,
        overdue_payables_count=0,
    )
    
    # Scenario: Price increase of 15%
    scenario_params = {
        "price_change_pct": 15,
        "effective_month": 1,
        "timeline_months": 6,
    }
    
    print("Scenario: 15% Price Increase (effective immediately)")
    print(f"  Baseline Revenue: ${baseline_state.revenue_monthly:,.0f}")
    print(f"  Expected Revenue Impact: ${baseline_state.revenue_monthly * 0.15:,.0f}")
    
    try:
        result = await run_scenario_with_all_engines(
            scenario_id="test_scenario_001",
            business_id="test_business",
            tenant_id="test_tenant",
            business_state=baseline_state,
            scenario_type="price_change",
            parameters=scenario_params,
            timeline_months=6,
        )
        
        print("\n✅ Scenario Orchestration Result:")
        
        if result.get("baseline"):
            print("\n📊 Baseline State (All Engines):")
            baseline = result["baseline"]
            for engine_name in ["viability", "survival", "growth", "fragility", "stability"]:
                if engine_name in baseline:
                    output = baseline[engine_name]
                    if isinstance(output, dict):
                        if engine_name == "stability":
                            score = output.get("score", "N/A")
                            print(f"  {engine_name.title()}: score={score}")
                        else:
                            classification = output.get("classification", {}).get("classification", "N/A") if isinstance(output.get("classification"), dict) else output.get("classification", "N/A")
                            print(f"  {engine_name.title()}: {classification}")
        
        if result.get("scenario"):
            print("\n📊 Scenario State (All Engines):")
            scenario = result["scenario"]
            if isinstance(scenario, dict):
                # Show summary of scenario output
                print(f"  Scenario Output Keys: {list(scenario.keys())[:5]}")
        
        return True, result
    
    except Exception as e:
        print(f"\n❌ Error in scenario orchestration: {e}")
        import traceback
        traceback.print_exc()
        return False, None


async def main():
    """Run all end-to-end tests."""
    print_header("MULTI-ENGINE E2E TEST SUITE")
    print("Testing: Viability, Survival, Stability, Growth, Fragility Engines")
    
    test1_passed, test1_output = await test_full_engine_suite()
    test2_passed, test2_output = await test_scenario_orchestration()
    
    # Summary
    print_header("TEST SUMMARY")
    print(f"✅ Full Engine Suite: {'PASSED' if test1_passed else 'FAILED'}")
    print(f"✅ Scenario Orchestration: {'PASSED' if test2_passed else 'FAILED'}")
    
    if test1_passed and test2_passed:
        print("\n🎉 All tests passed! Multi-engine system is operational.")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. See errors above.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
