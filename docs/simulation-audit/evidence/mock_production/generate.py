"""Mock production: businesses whose TRUE future is known, with the expected results written down BEFORE the simulation runs.

Does NOT import the application. It uses the generator's own truth and, for the "how the method should behave" figures,
the shadow model built from MODEL.md (../independent_review/shadow_model.py).

Run from the project root:  backend/.venv/Scripts/python.exe -I docs/simulation-audit/evidence/mock_production/generate.py
Writes: truth.json (businesses, history, the actual future) and expected.json (expected results and pass marks).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "independent_review"))
import shadow_model as shadow  # noqa: E402

SEED = 20261119
rng = random.Random(SEED)
RUN_DATE = (2026, 11, 19)       # the simulation runs today; November is in progress (19 of 30 days recorded)
HORIZON = 6                     # forecast months Dec 2026 .. May 2027
EVAL_DATE = (2027, 6, 1)        # accuracy is checked once those six months are complete


def ym_add(y, m, n):
    t = y * 12 + (m - 1) + n
    return t // 12, t % 12 + 1


def key(y, m):
    return f"{y:04d}-{m:02d}"


ARCHETYPES = {
    "A_steady":           dict(n=30, hist=(24, 36), growth=(0, 0),        season=0.0,         noise=(0.05, 0.10, 0.20)),
    "B_growing":          dict(n=30, hist=(12, 30), growth=(0.01, 0.03), season=0.0,         noise=(0.05, 0.10)),
    "C_seasonal":         dict(n=30, hist=(30, 40), growth=(0, 0),        season=(0.15, 0.35), noise=(0.05, 0.10)),
    "D_seasonal_growing": dict(n=30, hist=(30, 40), growth=(0.01, 0.02),  season=(0.15, 0.30), noise=(0.05, 0.10)),
    "E_young":            dict(n=30, hist=(2, 8),   growth=(0, 0),        season=0.0,         noise=(0.10,)),
    "F_declining":        dict(n=30, hist=(12, 24), growth=(-0.03, -0.01), season=0.0,        noise=(0.05, 0.10)),
    "G_sudden_drop":      dict(n=20, hist=(18, 30), growth=(0, 0),        season=0.0,         noise=(0.05,), drop=0.30),
}


def make_business(i: int, arch: str, spec: dict) -> dict:
    L = round(rng.uniform(3000, 60000), 2)
    n_hist = rng.randint(*spec["hist"])
    g = rng.uniform(*spec["growth"]) if spec["growth"] != (0, 0) else 0.0
    amp = rng.uniform(*spec["season"]) if isinstance(spec["season"], tuple) else 0.0
    peak = rng.randint(1, 12)
    sigma = rng.choice(spec["noise"])
    # first history month so that the last complete month is October 2026
    y0, m0 = ym_add(2026, 10, -(n_hist - 1))
    drop_from = n_hist - 2 if spec.get("drop") else None      # the drop starts two months before the run (September)

    def expected(t, y, m):      # true expected revenue in month t (t = 0 is the first history month)
        level = L * (1 + g * t)
        if drop_from is not None and t >= drop_from:
            level *= 1 - spec["drop"]
        season = 1 + amp * math.cos(2 * math.pi * (m - peak) / 12) if amp else 1.0
        return max(0.0, level * season)

    history, future_expected, future_actual = {}, {}, {}
    for t in range(n_hist + 1 + HORIZON):            # history, November 2026, then Dec .. May
        y, m = ym_add(y0, m0, t)
        e = expected(t, y, m)
        a = max(0.0, e * (1 + rng.gauss(0, sigma)))
        if t < n_hist:
            history[key(y, m)] = round(a, 2)
        elif t == n_hist:                             # November: in progress on the run date
            history[key(y, m)] = round(a * 19 / 30, 2)
            future_actual[key(y, m)] = round(a, 2)
        else:
            future_expected[key(y, m)] = round(e, 2)
            future_actual[key(y, m)] = round(a, 2)
    # Costs: cost of sales a fixed share of revenue; operating expenses steady. Payment terms recorded (not assumed).
    cos_share = round(rng.uniform(0.2, 0.5), 3)
    return dict(id=f"{arch}-{i:03d}", archetype=arch, level=L, growth_per_month=g, season_amplitude=amp, season_peak=peak,
                noise_sd=sigma, history_months=n_hist, revenue_by_month=history,
                cost_of_sales_by_month={k: round(v * cos_share, 2) for k, v in history.items()},
                expenses_by_month={k: round(L * 0.45, 2) for k in history},
                cost_of_sales_share=cos_share, starting_cash=round(L * rng.uniform(0.5, 3), 2), payment_terms_days=30,
                future_expected=future_expected, future_actual=future_actual)


def wape(f, a):
    s = sum(a)
    return None if s <= 0 else sum(abs(x - y) for x, y in zip(f, a)) / s * 100


def bias(f, a):
    s = sum(a)
    return None if s <= 0 else sum(x - y for x, y in zip(f, a)) / s * 100


def main() -> None:
    businesses = []
    for arch, spec in ARCHETYPES.items():
        for i in range(spec["n"]):
            businesses.append(make_business(i, arch, spec))
    months = [key(*ym_add(2026, 11, k)) for k in range(1, HORIZON + 1)]

    # ── Expected results, per archetype ──
    per_arch = {}
    for arch in ARCHETYPES:
        group = [b for b in businesses if b["archetype"] == arch]
        oracle_f, act, noise_free_method, truth_e = [], [], [], []
        for b in group:
            e = [b["future_expected"][k] for k in months]
            a = [b["future_actual"][k] for k in months]
            oracle_f += e
            act += a
            # The method run on the business's NOISE-FREE history (shadow model): its built-in systematic error
            nf_hist = {}
            n = b["history_months"]
            y0, m0 = ym_add(2026, 10, -(n - 1))
            for t in range(n):
                y, m = ym_add(y0, m0, t)
                level = b["level"] * (1 + b["growth_per_month"] * t)
                if arch == "G_sudden_drop" and t >= n - 2:
                    level *= 0.7
                s = 1 + b["season_amplitude"] * math.cos(2 * math.pi * (m - b["season_peak"]) / 12) if b["season_amplitude"] else 1.0
                nf_hist[key(y, m)] = level * s
            noise_free_method += shadow.baseline_forecast(nf_hist, 2026, 11, HORIZON)
            truth_e += e
        per_arch[arch] = dict(
            businesses=len(group),
            oracle_wape_pct=round(wape(oracle_f, act), 1),          # the best any method could do: only the noise is left
            method_systematic_bias_pct=round(bias(noise_free_method, truth_e), 1),   # what the method gets wrong with no noise at all
            method_systematic_wape_pct=round(wape(noise_free_method, truth_e), 1),
        )

    a_to_f = [a for a in ARCHETYPES if a != "G_sudden_drop"]
    criteria = {
        "P1": "Pooled revenue WAPE over archetypes A-F is at or below 25% (MODEL.md monitoring threshold).",
        "P2": "Pooled revenue bias over archetypes A-F is within +/-10% (MODEL.md monitoring threshold).",
        "P3": "For each archetype A-F, the simulation's WAPE is at most 1.5 x the oracle WAPE + the method's systematic WAPE + 1 point "
              "(the noise any method faces, plus the method's known built-in error, plus estimation noise from a 3-month level).",
        "P4": "For each archetype A-F, the simulation's bias is within 3 points of the method's systematic bias (expected below).",
        "P5": "The simulation beats the naive forecast ('next month = last complete month') on WAPE for at least 60% of businesses A-F.",
        "P6": "For at least 90% of businesses A-F, actual 6-month revenue lies within the simulation's low-high revenue range "
              "(6-month forecast x (1 -/+ the revenue swing used for the low and high cases)).",
        "P7": "Confidence is informative: mean WAPE of 'high' confidence runs is lower than mean WAPE of 'medium' and 'low' runs together.",
        "G":  "Sudden drop (G) is a stress case the method cannot know about. Expected: WAPE above archetype A and bias positive "
              "(forecasts too high), because two of the three months in the level are after the drop and one before. Not a pass mark.",
    }

    # ── Scenarios with a known true answer (flat, undated businesses; truth from the shadow model with TRUE inputs) ──
    srng = random.Random(SEED + 1)
    scenarios = []
    for i in range(160):
        R = round(srng.uniform(5000, 80000), 2)
        s = dict(revenue_monthly=R, cost_of_sales_monthly=round(R * srng.uniform(0.2, 0.6), 2),
                 expenses_monthly=round(R * srng.uniform(0.2, 0.5), 2), starting_cash=round(R * srng.uniform(0.3, 3), 2),
                 payment_terms_days=30, sales_cycle_days=30)
        if i < 100:
            kind = "price_change"
            true_e = round(srng.uniform(0.3, 2.5), 2)
            p_owner = {"price_change_pct": srng.choice([5, 10, 20, -10])}
            p_true = {**p_owner, "price_elasticity": -true_e}
            truth_note = dict(true_price_sensitivity=true_e)
            # The range the simulation tests around the standard figure (1.0): sensitivity 0.5 to 2.0 (MODEL.md 6, 8.1)
            covered = 0.5 <= true_e <= 2.0
        else:
            kind = "hire_staff"
            true_on = round(srng.uniform(8, 28), 1)
            p_owner = {"employee_count": srng.randint(1, 3), "employee_monthly_cost": srng.choice([2500, 3500, 5000]),
                       "recruitment_cost_per_hire": 1500, "start_month": 1, "revenue_per_hire_monthly": srng.choice([0, 6000, 9000]),
                       "ramp_months": 3}
            p_true = {**p_owner, "employer_oncost_pct": true_on}
            truth_note = dict(true_oncost_pct=true_on)
            covered = 10 <= true_on <= 25
        months_s = 12
        base = shadow.project(s, "none", {}, months_s)
        true_run = shadow.project(s, kind, p_true, months_s)
        default_run = shadow.project(s, kind, p_owner, months_s)        # what the simulation should show with standard figures
        scenarios.append(dict(id=f"S{i:03d}", kind=kind, state=s, owner_params=p_owner, true_params=p_true, months=months_s,
                              true_verdict=shadow.verdict(base, true_run),
                              expected_simulation_verdict_with_standard_figures=shadow.verdict(base, default_run),
                              true_within_tested_range=covered, **truth_note,
                              true_profit=round(true_run["cumulative_profit"], 2), true_closing_cash=round(true_run["closing_cash"], 2)))

    agree = sum(x["true_verdict"] == x["expected_simulation_verdict_with_standard_figures"] for x in scenarios)
    scen_expect = dict(
        scenarios=len(scenarios),
        S1="Given the TRUE inputs (as an owner who knows them would enter them), the simulation's verdict equals the true verdict "
           "in 100% of cases and its 12-month profit is within 0.1% of the true figure.",
        S2="With standard figures instead, the simulation's verdict equals the expected verdict below in 100% of cases (it behaves as "
           "specified), and it agrees with the TRUE verdict in about the share predicted below.",
        S3="Where the standard-figure verdict is wrong, the simulation flags it as 'not robust' whenever the true input lies inside "
           "the range it tests (sensitivity 0.5-2.0; on-costs 10-25%). Expected: at least 90% of such wrong verdicts are flagged.",
        predicted_agreement_true_vs_standard_figures_pct=round(agree / len(scenarios) * 100, 1),
        wrong_with_true_value_in_tested_range=sum(1 for x in scenarios if x["true_verdict"] != x["expected_simulation_verdict_with_standard_figures"] and x["true_within_tested_range"]),
        wrong_with_true_value_outside_tested_range=sum(1 for x in scenarios if x["true_verdict"] != x["expected_simulation_verdict_with_standard_figures"] and not x["true_within_tested_range"]),
    )

    truth = dict(seed=SEED, run_date=RUN_DATE, eval_date=EVAL_DATE, forecast_months=months, businesses=businesses, scenarios=scenarios)
    expected = dict(written_before_the_run=True, seed=SEED, forecast_months=months, accuracy_by_archetype=per_arch,
                    pass_marks=criteria, scenario_expectations=scen_expect, archetypes_for_pass_marks=a_to_f)
    for name, obj in (("truth.json", truth), ("expected.json", expected)):
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=1)
    digest = {n: hashlib.sha256(open(os.path.join(HERE, n), "rb").read()).hexdigest() for n in ("truth.json", "expected.json")}
    with open(os.path.join(HERE, "PREREGISTRATION.txt"), "w", encoding="utf-8") as f:
        f.write("Written by generate.py before evaluate.py was run. Any later change to these files changes their SHA-256.\n")
        for n, h in digest.items():
            f.write(f"{n}  {h}\n")
    print(json.dumps(expected["accuracy_by_archetype"], indent=1))
    print(json.dumps(scen_expect, indent=1))
    print(digest)


if __name__ == "__main__":
    main()
