"""Baseline evidence probe for the simulation audit (16 Nov 2026).

Runs the live simulation code on fixed sample businesses and prints the results quoted in
docs/simulation-audit/01-baseline-findings.md. Re-run it after changes to compare before and after.

Usage (from the repo root):
    python -I docs/simulation-audit/evidence/baseline_probe.py backend

The database and LLM modules are replaced with empty stand-ins so the pure calculation code can
run without credentials or installed backend dependencies. No data is read or written.
"""
import sys
import types

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else "backend")

# Stand-ins for modules that need credentials/network; the maths under test does not use them.
_sb = types.ModuleType("app.core.supabase")
_sb.sb_delete = _sb.sb_insert = _sb.sb_select = None
sys.modules["app.core.supabase"] = _sb
_llm = types.ModuleType("app.shared.llm.openai_client")
_llm.AutoLLMClient = object
sys.modules["app.shared.llm.openai_client"] = _llm

from app.modules.scenario_intelligence.service import _timeline  # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S  # noqa: E402
from app.engines.scenario.orchestrator import (  # noqa: E402
    MultiEngineScenarioInput,
    run_multi_engine_scenario,
)
from app.modules.idea_validation.calculations import (  # noqa: E402
    FinancialInputs,
    calculate_break_even_months,
)


def rows(t):
    return [(r["month_index"], r["profit"], r["cash_balance"], r["state_label"]) for r in t]


print("=== E1: money owed TO the business turns a profitable business 'critical' ===")
owed = S(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
         starting_cash=30000, pending_receivables_schedule=[25000], payment_terms_days=30)
not_owed = owed.model_copy(update={"pending_receivables_schedule": []})
t, _ = _timeline(owed, "cost_increase", {"cost_increase_pct": 0}, 6)
print("With a 25,000 invoice owed to it  (month, profit, cash, label):", rows(t))
t, _ = _timeline(not_owed, "cost_increase", {"cost_increase_pct": 0}, 6)
print("Same business, nothing owed       (month, profit, cash, label):", rows(t))
t, _ = _timeline(owed, "price_change", {"price_change_pct": 10}, 6)
print("With invoice owed, +10% price     (month, profit, cash, label):", rows(t))

print("\n=== E2: price rise with no effect on sales volume ===")
t, m = _timeline(not_owed, "price_change", {"price_change_pct": 50}, 6)
print("Baseline:", m["baseline_metrics"])
print("+50% price:", m["scenario_metrics"])

print("\n=== E3: multi-engine score changes are fixed table values, identical for very different businesses ===")
for label, scores in [
    ("Strong business", dict(viability=85, survival=90, stability=80, growth=70, fragility=20)),
    ("Weak business", dict(viability=30, survival=25, stability=35, growth=30, fragility=75)),
]:
    out = run_multi_engine_scenario(MultiEngineScenarioInput(
        scenario_id="probe", business_id="probe", tenant_id="probe",
        viability_state={"score": scores["viability"]},
        survival_state={"survival_score": scores["survival"]},
        stability_state={"stability_score": scores["stability"]},
        growth_state={"growth_score": scores["growth"]},
        fragility_state={"fragility_index": scores["fragility"]},
        scenario_type="price_change", parameters={"price_change_pct": 10},
    ))
    d = out.to_dict()
    print(f"{label}: viability {d['viability_delta']}, survival {d['survival_delta']}, "
          f"stability {d['stability_delta']}, growth {d['growth_delta']}, fragility {d['fragility_delta']}")

print("\n=== E4: 'break_even_months' is a units ratio, not a time ===")
fi = FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000,
                     variable_cost_per_unit=40, starting_cash=0)
print("Price 100, variable cost 40, fixed 2,000/month, selling 50 units/month (already profitable from month 1):")
print("  break_even_months =", calculate_break_even_months(fi))
