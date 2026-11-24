"""Independent review: the application's projection against the shadow model built from MODEL.md only.

Run from backend/:  .venv/Scripts/python.exe -I ../docs/simulation-audit/evidence/independent_review/compare.py
Fixed seed, so the result can be replayed. Tolerance: 1p per figure (rounding to 2 decimals in the application).
"""
from __future__ import annotations

import os
import random
import sys
from collections import Counter
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "backend")))
sys.path.insert(0, HERE)

import shadow_model as shadow                                                  # noqa: E402
from app.modules.scenario_intelligence import baseline as B                    # noqa: E402
from app.modules.scenario_intelligence import projection as P                  # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot    # noqa: E402

TOL = 0.011
rng = random.Random(20261119)
KINDS = ["none", "price_change", "cost_increase", "client_loss", "revenue_drop", "hire_staff", "take_loan"]


def random_state() -> dict:
    R = rng.choice([0, rng.uniform(500, 80000)])
    s = dict(revenue_monthly=round(R, 2), cost_of_sales_monthly=round(R * rng.uniform(0, 0.7), 2),
             expenses_monthly=round(rng.uniform(0, 60000), 2), starting_cash=round(rng.uniform(-20000, 150000), 2),
             payment_terms_days=rng.choice([None, 0, 7, 14, 30, 45, 60, 75, 90]),
             sales_cycle_days=rng.choice([None, 15, 30, 45, 60, 120]),
             pending_receivables_schedule=[round(rng.uniform(0, 20000), 2) for _ in range(rng.randint(0, 4))],
             pending_payables_schedule=[round(rng.uniform(0, 15000), 2) for _ in range(rng.randint(0, 3))])
    if rng.random() < 0.4:
        s.update(profit_tax_rate_pct=rng.choice([19, 20, 25, 30]), tax_payment_month=rng.choice([None, 3, 9]))
    if rng.random() < 0.3:
        bal = round(rng.uniform(5000, 100000), 2)
        s.update(existing_loan_balance=bal, existing_loan_annual_rate_pct=rng.choice([0, 6, 9.5, 14]),
                 existing_loan_monthly_repayment=rng.choice([None, round(bal / rng.randint(12, 60), 2)]))
    return s


def random_params(kind: str) -> dict:
    return {
        "price_change": lambda: {"price_change_pct": rng.choice([-20, -5, 5, 10, 25, 50]),
                                 **({"price_elasticity": -rng.choice([0.3, 1.0, 1.8, 2.5])} if rng.random() < 0.6 else {})},
        "cost_increase": lambda: {"cost_increase_pct": rng.choice([3, 8, 15, 40])},
        "client_loss": lambda: {"client_loss_pct": rng.choice([10, 25, 50])},
        "revenue_drop": lambda: {"revenue_drop_pct": rng.choice([5, 20, 35])},
        "hire_staff": lambda: {"employee_count": rng.randint(1, 4), "employee_monthly_cost": rng.choice([2500, 3800, 6000]),
                               "employer_oncost_pct": rng.choice([10, 15, 25]), "recruitment_cost_per_hire": rng.choice([0, 1500]),
                               "start_month": rng.randint(1, 3), "revenue_per_hire_monthly": rng.choice([0, 4000, 9000]),
                               "ramp_months": 3},
        "take_loan": lambda: {"loan_amount": rng.choice([10000, 50000]), "loan_annual_rate_pct": rng.choice([7, 12]),
                              "loan_term_months": rng.choice([12, 36]), "loan_start_month": rng.randint(1, 2)},
    }.get(kind, lambda: {})()


def app_run(s: dict, kind: str, p: dict, months: int) -> dict:
    rows, summ = P.project(BusinessStateSnapshot(**s), kind, p, months)
    return dict(rows=rows, **{k: summ.get(k) for k in ("closing_cash", "cumulative_profit", "total_revenue", "total_costs",
                                                       "closing_receivables", "closing_tax_owed", "closing_loans",
                                                       "first_negative_cash_month", "min_cash")},
                closing_sales_tax_owed=summ.get("closing_sales_tax_owed") or 0.0, summary=summ)


def diff_projection(a: dict, b: dict) -> list:
    out = []
    for ra, rb in zip(a["rows"], b["rows"]):
        for k in ("revenue", "cost_of_sales", "expenses", "profit", "cash_balance"):
            if abs(float(ra[k]) - rb[k]) > TOL * max(1, len(a["rows"])):
                out.append(f"m{ra['month_index']} {k}: app {ra[k]:.2f} vs spec {rb[k]:.2f}")
    for k in ("closing_cash", "cumulative_profit", "closing_receivables", "closing_tax_owed", "closing_loans"):
        if abs(float(a[k] or 0) - float(b[k] or 0)) > 0.05:
            out.append(f"{k}: app {float(a[k] or 0):.2f} vs spec {float(b[k] or 0):.2f}")
    return out


def main() -> None:
    cases, by_kind, agree_v, problems = 0, Counter(), 0, []
    verdict_pairs = Counter()
    for _ in range(400):
        s = random_state()
        kind = rng.choice(KINDS)
        p = random_params(kind)
        months = rng.choice([3, 6, 12, 18, 24])
        a_base, b_base = app_run(s, "none", {}, months), shadow.project(s, "none", {}, months)
        a, b = app_run(s, kind, p, months), shadow.project(s, kind, p, months)
        cases += 1
        d = diff_projection(a_base, b_base) + diff_projection(a, b)
        by_kind[(kind, "match" if not d else "differs")] += 1
        if d:
            problems.append((kind, p, s, d[:4]))
        if kind != "none":
            va = P.compare_projections(a_base["summary"], a["summary"])
            va = va.get("outcome") if isinstance(va, dict) else va
            vb = shadow.verdict(b_base, b)
            verdict_pairs[(str(va), vb)] += 1
            if str(va) != vb and os.environ.get("SHOW_VERDICTS"):
                full = P.compare_projections(a_base["summary"], a["summary"])
                net = lambda x: x["closing_cash"] - x["closing_loans"] - x["closing_tax_owed"]
                mat = 0.01 * (b_base["total_revenue"] if b_base["total_revenue"] > 0 else b_base["total_costs"])
                print(f"VERDICT [{kind}] {p} app={va} spec={vb} spec: dprofit={b['cumulative_profit']-b_base['cumulative_profit']:.2f} dnet={net(b)-net(b_base):.2f} mat={mat:.2f} neg={b_base['first_negative_cash_month']}/{b['first_negative_cash_month']}")
                print("   app:", {k: v for k, v in full.items() if not isinstance(v, (dict, list))})
            agree_v += str(va) == vb
    print(f"Projection cases: {cases} (each = no-change + scenario, every month and closing figure compared)")
    for kind in KINDS:
        print(f"  {kind:14s} match {by_kind[(kind, 'match')]:3d}   differ {by_kind[(kind, 'differs')]:3d}")
    n_v = sum(verdict_pairs.values())
    print(f"Verdicts agreeing: {agree_v} of {n_v}")
    for (va, vb), n in sorted(verdict_pairs.items(), key=lambda x: -x[1]):
        if va != vb:
            print(f"  app {va!r} vs spec {vb!r}: {n}")
    for kind, p, s, d in problems[:12]:
        print(f"\n[{kind}] params={p}\n  state terms={s.get('payment_terms_days')} cycle={s.get('sales_cycle_days')} tax={s.get('profit_tax_rate_pct')}/{s.get('tax_payment_month')} loan={s.get('existing_loan_balance')}/{s.get('existing_loan_monthly_repayment')} recv={s.get('pending_receivables_schedule')} pay={s.get('pending_payables_schedule')}")
        for line in d:
            print("   ", line)

    # Section 4: the baseline method with a date, on random histories
    mism, n_b = 0, 0
    for _ in range(300):
        n = rng.randint(1, 40)
        base, slope, amp, noise = rng.uniform(2000, 50000), rng.choice([0, rng.uniform(-300, 600)]), rng.choice([0, 0.25]), rng.uniform(0, 0.3)
        hist = {}
        y, m = 2026 - (n // 12) - 1, 1
        for t in range(n):
            v = max(0.0, (base + slope * t) * (1 + amp * __import__("math").sin(2 * 3.14159 * m / 12)) * (1 + rng.gauss(0, noise)))
            hist[f"{y:04d}-{m:02d}"] = round(v, 2)
            y, m = (y, m + 1) if m < 12 else (y + 1, 1)
        as_of = date(y, m, 15)
        st = BusinessStateSnapshot(revenue_by_month=hist)
        bl = B.build_baseline(st, as_of)["revenue"]
        app_f = [B.value_in_month(bl, as_of, k) for k in range(1, 7)]
        spec_f = shadow.baseline_forecast(hist, y, m, 6)
        n_b += 1
        if any(abs(x - z) > 0.05 + 2e-4 * abs(z) for x, z in zip(app_f, spec_f)):      # indices are stored to 4 decimals
            mism += 1
            if mism <= 3:
                print(f"\nbaseline differs (months={n}): app {[round(x) for x in app_f]} vs spec {[round(x) for x in spec_f]}")
    print(f"\nBaseline method (dated, random histories 1-40 months): {n_b - mism} of {n_b} match")


if __name__ == "__main__":
    main()
