"""Independent review of model 1.4's further factors: the application against shadow_phase5 (built from MODEL.md only).
Run from backend/:  .venv/Scripts/python.exe -I ../docs/simulation-audit/evidence/independent_review/compare_phase5.py"""
import os
import random
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "backend")))
sys.path.insert(0, HERE)

import shadow_phase5 as shadow                                                  # noqa: E402
from app.modules.scenario_intelligence import projection as P                   # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot     # noqa: E402

rng = random.Random(20261122)
n, diffs = 300, []
for i in range(n):
    R = round(rng.uniform(2000, 90000), 2)
    s = dict(revenue_monthly=R, cost_of_sales_monthly=round(R * rng.uniform(0, .6), 2), expenses_monthly=round(rng.uniform(0, 40000), 2),
             starting_cash=round(rng.uniform(-10000, 80000), 2), payment_terms_days=0,
             tax_country=rng.choice([None, "GB", "United Kingdom", "NG", "US", "Kenya"]),
             profit_tax_regime=rng.choice([None, "uk_corporation_tax"]), profit_tax_rate_pct=rng.choice([None, 20, 30]),
             tax_losses_brought_forward=rng.choice([None, 10000, 60000]),
             funding_events=[{"type": rng.choice(["equity", "owner_capital", "grant"]), "amount": rng.choice([3000, 50000]),
                              "month": rng.randint(1, 12)} for _ in range(rng.randint(0, 3))],
             owner_drawings_monthly=rng.choice([None, 800, 2500]),
             dividends=[{"amount": rng.choice([1000, 9000]), "month": rng.randint(1, 12)} for _ in range(rng.randint(0, 2))],
             capital_purchases=[{"amount": rng.choice([1500, 30000]), "month": rng.randint(1, 8), "life_months": rng.choice([1, 6, 36])}
                                for _ in range(rng.randint(0, 2))],
             bad_debt_pct=rng.choice([None, 2, 10]), payroll_staff_count=rng.choice([None, 1, 4]),
             payroll_gross_monthly_per_person=rng.choice([None, 1800, 3000, 6000]),
             payroll_in_recorded_expenses=rng.choice([None, True, False]), employer_pension_pct=rng.choice([None, 5]))
    months = rng.choice([3, 6, 12, 24])
    _rows, a = P.project(BusinessStateSnapshot(**s), "do_nothing_projection", {}, months)
    b = shadow.project(s, months)
    # The application rounds each person's monthly employer costs to the penny (as a payslip does); MODEL.md does not say
    # so, and the shadow does not round: allow a penny per person per month, plus the tax on it.
    pennies = 0.01 * (s.get("payroll_staff_count") or 0) * months * 1.3 + 0.05
    for k in ("closing_cash", "cumulative_profit", "closing_fixed_assets", "closing_tax_owed"):
        if abs(float(a[k]) - b[k]) > pennies:
            diffs.append((i, k, float(a[k]), round(b[k], 2)))
    if abs(float(a["total_funding_in"]) - b["total_owner_in"]) > 0.01 or abs(float(a["total_owner_payments"]) - b["total_owner_out"]) > 0.01:
        diffs.append((i, "owner money", a["total_funding_in"], b["total_owner_in"]))
    if not all(a["checks"].values()):
        diffs.append((i, "checks", a["checks"], None))
cases = len({d[0] for d in diffs})
print(f"Phase 5 factors: {n - cases} of {n} random businesses match the specification exactly")
for d in diffs[:10]:
    print("  differs:", d)
