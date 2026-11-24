"""Phase 1 evidence probe for the simulation audit (17 Nov 2026).

Shows, on fixed sample businesses, what Phase 1 changed: the baseline (F8), customers' response to price (F6), hiring and
launch costs (F10), tax / VAT / loans, the rest of the current month, the balance check and the 13-week view.
Fixed date (17 Nov 2026) so the output is reproducible.

Usage (from the repo root):
    python -I docs/simulation-audit/evidence/phase1_probe.py backend

The database and LLM modules are replaced with empty stand-ins. No data is read or written.
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
from app.modules.scenario_intelligence.projection import project  # noqa: E402

TODAY = date(2026, 11, 17)
BIZ = dict(revenue_monthly=20000, expenses_monthly=8000, cost_of_sales_monthly=4000, costs_monthly=12000,
           starting_cash=30000, payment_terms_days=30)


def verdict(m):
    v = m["verdict"]
    return f'{v["outcome"]} (profit {v["cumulative_profit_change"]:+,.2f}, cash {v["closing_cash_change"]:+,.2f}, net cash {v["net_cash_change"]:+,.2f})'


print("=== F8: the baseline. Monthly history with November still in progress (17 Nov) ===")
hist = {"2026-05": 15200, "2026-06": 16100, "2026-07": 17300, "2026-08": 17900, "2026-09": 19200, "2026-10": 20100, "2026-11": 6400}
state = S(**{**BIZ, "revenue_monthly": 6400}, revenue_by_month=hist)
print("Before (Phase 0 and earlier): latest month on record =", 6400, "a month (November so far)")
_r, s = project(state, "do_nothing_projection", {}, 6, as_of=TODAY)
b = s["baseline"]["revenue"]
print(f"After: level {b['level']:,.2f} from the {b['source']} {b['months_used']}; trend {b['trend_note']} "
      f"({b['trend_per_month']:+,.2f} a month, t = {b['trend_t_stat']}); seasonality {b['seasonality_note']}")
print("Projected revenue, months 1-6:", [r["revenue"] for r in _r])

print("\n=== F6: +10% price (Phase 0: no customer response) ===")
for label, params in [("no response (Phase 0 behaviour)", {"price_change_pct": 10, "price_elasticity": 0}),
                      ("standard response (sensitivity 1)", {"price_change_pct": 10}),
                      ("sensitive customers (sensitivity 2)", {"price_change_pct": 10, "price_sensitivity": 2})]:
    rows, m = _timeline(S(**BIZ), "price_change", params, 6, as_of=TODAY)
    print(f"  {label:38} month-6 revenue {rows[-1]['revenue']:>10,.2f}  profit {rows[-1]['profit']:>9,.2f}  -> {verdict(m)}")

print("\n=== F10: hiring one person at 3,000 a month (Phase 0: pay only) ===")
for label, params in [("pay only (Phase 0 behaviour)", {"employee_count": 1, "employee_monthly_cost": 3000, "employer_oncost_pct": 0}),
                      ("+15% on-costs, 2,500 recruitment", {"employee_count": 1, "employee_monthly_cost": 3000, "recruitment_cost_per_hire": 2500}),
                      ("... and 5,000 a month of new sales", {"employee_count": 1, "employee_monthly_cost": 3000, "recruitment_cost_per_hire": 2500,
                                                              "revenue_per_hire_monthly": 5000})]:
    rows, m = _timeline(S(**BIZ), "hire_staff", params, 12, as_of=TODAY)
    print(f"  {label:38} profit over 12 months {rows[-1]['cumulative_profit']:>11,.2f} -> {verdict(m)}")

print("\n=== Financing: a 50,000 loan at 9% over 24 months, for a business that never runs short ===")
rows, m = _timeline(S(**BIZ), "take_loan", {"loan_amount": 50000, "loan_annual_rate_pct": 9, "loan_term_months": 24}, 12, as_of=TODAY)
print("  Judged on cash alone this would look better; judged on net cash (after the debt):", verdict(m))
weak = S(revenue_monthly=10000, expenses_monthly=12000, costs_monthly=12000, starting_cash=3000, payment_terms_days=0)
rows, m = _timeline(weak, "take_loan", {"loan_amount": 30000, "loan_annual_rate_pct": 9, "loan_term_months": 24}, 12, as_of=TODAY)
print("  A 30,000 loan for a business losing 2,000 a month from 3,000 cash:", verdict(m), "-", m["verdict"]["reason"])

print("\n=== Tax, VAT and an existing loan (12 months) ===")
taxed = S(**BIZ, profit_tax_rate_pct=19, tax_payment_month=10, sales_tax_rate_pct=20, sales_tax_on_costs_pct=50,
          existing_loan_balance=20000, existing_loan_annual_rate_pct=7, existing_loan_monthly_repayment=900)
_r, plain = project(S(**BIZ), "do_nothing_projection", {}, 12, as_of=TODAY)
_r, full = project(taxed, "do_nothing_projection", {}, 12, as_of=TODAY)
for k in ("cumulative_profit", "closing_cash", "closing_tax_owed", "closing_sales_tax_owed", "closing_loans", "total_interest"):
    print(f"  {k:24} without settings {plain[k]:>12,.2f}   with settings {full[k]:>12,.2f}")
print("  checks:", full["checks"])

print("\n=== The rest of this month and the 13-week view (17 Nov) ===")
print("  stub:", full["stub"])
w = full["thirteen_week"]
print(f"  13 weeks: lowest cash {w['lowest_cash']:,.2f} in week {w['lowest_week']}; reconciles: {w['reconciles']}")
for r in w["weeks"][:4]:
    print("   ", r)
