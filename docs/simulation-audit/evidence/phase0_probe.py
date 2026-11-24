"""Phase 0 evidence probe for the simulation audit (16 Nov 2026).

Runs the SAME sample businesses as baseline_probe.py (cases E1-E4) against the code after Phase 0, so the two outputs
can be compared side by side. The baseline output is kept in baseline_probe_output.txt.

Usage (from the repo root):
    python -I docs/simulation-audit/evidence/phase0_probe.py backend

The database and LLM modules are replaced with empty stand-ins so the calculation code runs without credentials or
installed backend services. No data is read or written.
"""
import asyncio
import sys
import types

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else "backend")

_sb = types.ModuleType("app.core.supabase")
_sb.sb_delete = _sb.sb_insert = _sb.sb_select = None
sys.modules["app.core.supabase"] = _sb
_llm = types.ModuleType("app.shared.llm.openai_client")
_llm.AutoLLMClient = object
sys.modules["app.shared.llm.openai_client"] = _llm

from app.modules.scenario_intelligence.service import _timeline  # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S  # noqa: E402
from app.modules.scenario_intelligence.projection import project, compare_projections, run_rate_snapshot  # noqa: E402
from app.modules.scenario_intelligence.orchestration_service import run_scenario_with_all_engines  # noqa: E402
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3  # noqa: E402


def rows(t):
    return [(r["month_index"], r["profit"], r["cash_balance"], r["state_label"]) for r in t]


print("=== E1: money owed TO the business (after Phase 0) ===")
owed = S(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
         starting_cash=30000, pending_receivables_schedule=[25000], payment_terms_days=30)
not_owed = owed.model_copy(update={"pending_receivables_schedule": []})
t, m = _timeline(owed, "cost_increase", {"cost_increase_pct": 0}, 6)
print("With a 25,000 invoice owed to it  (month, profit, cash, label):", rows(t))
print("  checks:", m["scenario_summary"]["checks"])
t, _ = _timeline(not_owed, "cost_increase", {"cost_increase_pct": 0}, 6)
print("Same business, nothing owed       (month, profit, cash, label):", rows(t))
t, m = _timeline(owed, "price_change", {"price_change_pct": 10}, 6)
print("With invoice owed, +10% price     (month, profit, cash, label):", rows(t))
print("  verdict:", m["verdict"]["outcome"], "-", m["verdict"]["reason"])

print("\n=== E2: price rise (volume response still not modelled: Phase 1) ===")
t, m = _timeline(not_owed, "price_change", {"price_change_pct": 50}, 6)
print("Baseline:", {k: m["baseline_metrics"][k] for k in ("monthly_revenue", "net_profit", "stability_score")})
print("+50% price:", {k: m["scenario_metrics"][k] for k in ("monthly_revenue", "net_profit", "stability_score")})
print("Verdict:", m["verdict"]["state_result"], "/", m["verdict"]["outcome"],
      "| profit change over 6 months:", m["verdict"]["cumulative_profit_change"])

print("\n=== E3: multi-engine score changes now computed from each business ===")
for label, state in [
    ("Strong business", S(revenue_monthly=50000, expenses_monthly=20000, costs_monthly=20000, starting_cash=200000, payment_terms_days=0)),
    ("Weak business", S(revenue_monthly=10000, expenses_monthly=11000, costs_monthly=11000, starting_cash=12000, payment_terms_days=0)),
]:
    params = {"price_change_pct": 10}
    _r, base = project(state, "do_nothing_projection", {}, 6)
    _r, scen = project(state, "price_change", params, 6)
    out = asyncio.run(run_scenario_with_all_engines(
        scenario_id="probe", business_id="probe", tenant_id="probe",
        baseline_end_state=run_rate_snapshot(state, "do_nothing_projection", {}, 6, cash=base["closing_cash"]),
        scenario_end_state=run_rate_snapshot(state, "price_change", params, 6, cash=scen["closing_cash"]),
        scenario_type="price_change", timeline_months=6, verdict=compare_projections(base, scen)))
    sc = out["scenario"]
    print(f"{label}: engine changes {sc['engine_deltas']}")
    print(f"  not assessed: {sorted(sc['not_assessed'])} | ranking score: {sc['scenario_ranking_score']}")

print("\n=== E4: break-even reported as margin of safety ===")
res = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000,
                                            variable_cost_per_unit=40, starting_cash=0))
mm = res["metrics"]
print("Price 100, variable cost 40, fixed 2,000/month, selling 50 units/month:")
print("  break_even_months present:", "break_even_months" in mm)
print("  break_even_units =", round(mm["break_even_units"], 2), "| margin_of_safety_pct =", round(mm["margin_of_safety_pct"], 1),
      "| break-even score =", res["dimension_scores"]["break_even"])
res = evaluate_viability_v3(FinancialInputs(price_per_unit=100, units_per_month=10, fixed_costs_monthly=2000,
                                            variable_cost_per_unit=40, starting_cash=0))
print("Same, selling 10 units/month (needs 3.3x the plan): break-even score =", res["dimension_scores"]["break_even"],
      "(was 85 before Phase 0)")
print(" ", res["dimension_explanations"]["break_even"])
