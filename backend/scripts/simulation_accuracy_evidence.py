"""Reproduce the fixed synthetic brief fixture against the pre-fix projection and current projection.

Run from backend: python scripts/simulation_accuracy_evidence.py
Does not read business accounts, connect to a provider, or change registered audit evidence.
"""
import json
from datetime import date
from pathlib import Path
import subprocess
import sys
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.modules.scenario_intelligence import projection as current
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot

repo = Path(__file__).resolve().parents[2]
old = types.ModuleType("accuracy_before")
source = subprocess.check_output(["git", "show", "b1a1093:backend/app/modules/scenario_intelligence/projection.py"], cwd=repo, text=True, encoding="utf-8")
exec(compile(source, "projection_before.py", "exec"), old.__dict__)
state = BusinessStateSnapshot(revenue_monthly=10000, expenses_monthly=3000, cost_of_sales_monthly=1200,
    starting_cash=30000, payment_terms_days=28, profit_tax_rate_pct=19, sales_tax_rate_pct=20,
    sales_tax_on_costs_pct=80, existing_loan_balance=20000, existing_loan_annual_rate_pct=6,
    existing_loan_monthly_repayment=500)
params = dict(revenue_drop_pct=10, client_loss_pct=10, cost_increase_pct=10, cost_reduction_pct=10,
    price_change_pct=10, employee_count=1, employee_monthly_cost=1000, contractor_monthly_cost=500,
    loan_amount=1000, loan_term_months=12, loan_annual_rate_pct=6, revenue_uplift_pct=10,
    cost_uplift_pct=5, equipment_cost=1000, funding_amount=2000)
out = {"fixture": "Synthetic GBP acceptance fixture; not the private QA2 account", "as_of": "2026-11-24",
       "before_commit": "b1a1093", "state": state.model_dump(), "parameters": params, "scenarios": {}}
for kind in current.COMBINABLE:
    sides = {}
    for label, engine in (("before", old), ("after", current)):
        rows, summary = engine.project(state, kind, params, 6, as_of=date(2026, 11, 24))
        sides[label] = {"first_month": rows[0], "summary": summary}
    out["scenarios"][kind] = sides
target = repo / "docs" / "simulation-audit" / "2026-11-24-accuracy-evidence.json"
target.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote before/after evidence for {len(out['scenarios'])} scenarios to {target}")

lines = ["# Synthetic before/after simulation evidence", "", out["fixture"], "", "Fixed date: 24 November 2026. Six full months plus the current-month remainder. All amounts are GBP.", "", "The differences reflect the documented phase-in, contractor classification and current-month loan-interest changes. This is not an independent rerun of the report's private QA2 account.", "", "| Scenario | First-month profit before | First-month profit after | Closing cash before | Closing cash after |", "|---|---:|---:|---:|---:|"]
for kind, sides in out["scenarios"].items():
    b, a = sides["before"], sides["after"]
    lines.append(f"| {kind.replace('_', ' ')} | {b['first_month']['profit']:,.2f} | {a['first_month']['profit']:,.2f} | {b['summary']['closing_cash']:,.2f} | {a['summary']['closing_cash']:,.2f} |")
target.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
