"""Phase 2 evidence probe for the simulation audit (17 Nov 2026): ranges, robustness, sensitivity, input sources,
confidence, KPIs, and missing data in Idea Validation (F5). Fixed date, so the output is reproducible.

Usage (from the repo root):
    python -I docs/simulation-audit/evidence/phase2_probe.py backend
"""
import sys
import types

sys.stdout.reconfigure(encoding="utf-8")      # the same bytes on every system
from datetime import date

sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else "backend")
_sb = types.ModuleType("app.core.supabase")
_sb.sb_delete = _sb.sb_insert = _sb.sb_select = None
sys.modules["app.core.supabase"] = _sb
_llm = types.ModuleType("app.shared.llm.openai_client")
_llm.AutoLLMClient = object
sys.modules["app.shared.llm.openai_client"] = _llm

from app.modules.scenario_intelligence.service import _timeline  # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot as S  # noqa: E402
from app.modules.idea_validation.calculations import FinancialInputs, evaluate_viability_v3  # noqa: E402
from app.modules.idea_validation.idea_validation_engine import IdeaValidationInputs, evaluate_idea_validation_v3  # noqa: E402

TODAY = date(2026, 11, 17)
HIST = {"2026-05": 18200, "2026-06": 21900, "2026-07": 19400, "2026-08": 22300, "2026-09": 18800, "2026-10": 21100}
BIZ = S(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000, starting_cash=30000,
        payment_terms_days=30, revenue_by_month=HIST)


def show(title, scenario_type, params, months=12):
    _rows, m = _timeline(BIZ, scenario_type, params, months, as_of=TODAY)
    u = m["uncertainty"]
    print(f"\n=== {title} ===")
    print("Verdict (base):", m["verdict"]["outcome"], "-", m["verdict"]["reason"])
    r = u["ranges"]
    print("Swings used:", r["drivers"]["revenue_swing_basis"], "| costs:", r["drivers"]["cost_swing_basis"])
    for case in ("low", "base", "high"):
        v = r["verdicts"][case]
        print(f"  {case:4}: scenario net cash {r['cases'][case]['scenario']['net_cash']:>11,.2f}   verdict {v['outcome']:<18}"
              f" net cash change {v['net_cash_change']:>+11,.2f}")
    print("Robustness:", r["robustness"])
    print("Sensitivity (largest first):")
    for d in u["sensitivity"]:
        print(f"  {d['driver']:<40} swing {d['swing']:>11,.2f}   low {d['low']['outcome']:<18} high {d['high']['outcome']}")
    print("Confidence:", u["confidence"]["level"], "-", "; ".join(u["confidence"]["reasons"]))
    return u


u = show("+10% price, standard customer sensitivity", "price_change", {"price_change_pct": 10, "price_sensitivity": 1})
print("Inputs and where they came from:")
for i in u["inputs"]:
    print(f"  {i['input']:<34} {str(i['value']):>12}  {i['label']:<18} {i['source'] or ''}")
k = u["kpis"]
print("KPIs at the end (scenario / now):")
for key in ("gross_margin_pct", "operating_margin_pct", "days_sales_outstanding", "break_even_revenue_monthly", "margin_of_safety_pct", "net_cash"):
    print(f"  {key:<28} {k['scenario'][key]!s:>12} / {k['baseline'][key]!s:>12}")

show("Costs up 20%", "cost_increase", {"cost_increase_pct": 20})

print("\n=== F5: Idea Validation with only the money figures given ===")
fi = FinancialInputs(price_per_unit=100, units_per_month=50, fixed_costs_monthly=2000, variable_cost_per_unit=40, starting_cash=5000)
r = evaluate_viability_v3(fi)
print("Before (rubric v0.4): capacity 60, cash timing 85 (14 days assumed), sales cycle 85 (30 days assumed), "
      "concentration 75 were filled in and counted.")
print(f"After (rubric {r['rubric_version']}): score {r['score']}, coverage {r['data_coverage_pct']}%, confidence {r['confidence']}")
print("  not assessed:", r["not_assessed"])
iv = evaluate_idea_validation_v3(IdeaValidationInputs("a", "b", "small bakeries in leeds", "p", "severe", "x", "short", "uk"))
print(f"Idea validation without research (rubric {iv['metrics']['rubric_v']}): score {iv['score']}, coverage {iv['data_coverage_pct']}%, "
      f"confidence {iv['confidence']}; not assessed: {sorted(iv['not_assessed'])} (were an assumed 40 and 60)")
