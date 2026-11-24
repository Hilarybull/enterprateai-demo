"""Mock production, step 2: run the REAL simulation on the businesses in truth.json and score it against expected.json.

Run from the project root, after generate.py:
    backend/.venv/Scripts/python.exe -I docs/simulation-audit/evidence/mock_production/evaluate.py
The simulation sees only what a real run would: history up to the run date (November in progress). The actual future
months are used only afterwards, through the application's own accuracy module, as if they had been recorded.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import defaultdict
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.modules.scenario_intelligence import accuracy as ACC                  # noqa: E402
from app.modules.scenario_intelligence import uncertainty as U                 # noqa: E402
from app.modules.scenario_intelligence.projection import compare_projections, project   # noqa: E402
from app.modules.scenario_intelligence.schemas import BusinessStateSnapshot    # noqa: E402

BASE = "do_nothing_projection"


def load(name):
    path = os.path.join(HERE, name)
    with open(path, "rb") as file:
        raw = file.read()
    with open(os.path.join(HERE, "PREREGISTRATION.txt"), encoding="utf-8") as file:
        registered = next(line.split()[1] for line in file if line.split()[:1] == [name])
    # The archive was registered on Windows, then checked out with LF endings.
    # Accept only that transport difference; changing any data still fails.
    lf = raw.replace(b"\r\n", b"\n")
    candidates = {hashlib.sha256(data).hexdigest() for data in (raw, lf, lf.replace(b"\n", b"\r\n"))}
    assert registered in candidates, f"{name} changed after pre-registration"
    return json.loads(raw), registered


def wape(f, a):
    s = sum(a)
    return sum(abs(x - y) for x, y in zip(f, a)) / s * 100 if s > 0 else None


def bias(f, a):
    s = sum(a)
    return sum(x - y for x, y in zip(f, a)) / s * 100 if s > 0 else None


def main() -> None:
    truth, h_truth = load("truth.json")
    expected, h_exp = load("expected.json")
    pre = open(os.path.join(HERE, "PREREGISTRATION.txt"), encoding="utf-8").read()
    assert h_truth in pre and h_exp in pre, "truth.json or expected.json changed after pre-registration"

    run_on = date(*truth["run_date"])
    check_on = date(*truth["eval_date"])
    months = truth["forecast_months"]
    per = []
    for b in truth["businesses"]:
        state = BusinessStateSnapshot(revenue_by_month=b["revenue_by_month"], cost_of_sales_by_month=b["cost_of_sales_by_month"],
                                      expenses_by_month=b["expenses_by_month"], starting_cash=b["starting_cash"],
                                      payment_terms_days=b["payment_terms_days"])
        rows, summ = project(state, BASE, {}, len(months), as_of=run_on)
        analysis = U.analyse(state, BASE, {}, len(months), run_on, summ, rows)
        # The saved run, as the service stores it, then checked when the months are complete (real accuracy module)
        run = dict(scenario_run_id=b["id"], scenario_name="No change", created_at=run_on.isoformat(),
                   baseline_metrics=dict(projection=summ), scenario_metrics=dict(projection=summ))
        recorded = {**{k: v for k, v in b["revenue_by_month"].items()}, **b["future_actual"]}     # November now complete
        tracked = ACC.tracked_accuracy([ACC.run_record(run, None)], recorded, check_on)
        pairs = tracked["runs"][0]["pairs"] if tracked["runs"] else []
        f = [p["forecast"] for p in pairs]
        a = [p["actual"] for p in pairs]
        last_complete = b["revenue_by_month"]["2026-10"]
        swing = analysis["ranges"]["drivers"]["revenue_swing_pct"] / 100
        total_f, total_a = sum(f), sum(a)
        per.append(dict(id=b["id"], arch=b["archetype"], months_compared=len(pairs), forecast=f, actual=a,
                        oracle=[b["future_expected"][k] for k in months],
                        naive=[last_complete] * len(a), wape=tracked["runs"][0]["wape_pct"] if pairs else None,
                        bias=tracked["runs"][0]["bias_pct"] if pairs else None, model_version=summ.get("model_version"),
                        confidence=analysis["confidence"]["level"], swing=swing,
                        in_range=(total_f * (1 - swing) <= total_a <= total_f * (1 + swing)),
                        trend_applied=summ["baseline"]["revenue"]["trend_applied"],
                        seasonality_applied=summ["baseline"]["revenue"]["seasonality_applied"]))

    exp_arch = expected["accuracy_by_archetype"]
    a_to_f = expected["archetypes_for_pass_marks"]
    lines, results = [], {}

    def say(s=""):
        lines.append(s)
        print(s)

    say(f"Mock production run: {len(per)} businesses, run on {run_on}, checked on {check_on}, model {per[0]['model_version']}")
    say(f"Pre-registration verified: truth.json {h_truth[:12]}..., expected.json {h_exp[:12]}...")
    say("")
    say(f"{'Archetype':20s} {'n':>3s} {'WAPE':>6s} {'oracle':>7s} {'naive':>6s} {'bias':>6s} {'exp.bias':>8s} {'in range':>9s} {'trend':>6s} {'season':>7s}")
    by = defaultdict(list)
    for r in per:
        by[r["arch"]].append(r)
    arch_stats = {}
    for arch, group in by.items():
        F = sum((r["forecast"] for r in group), [])
        A = sum((r["actual"] for r in group), [])
        O = sum((r["oracle"] for r in group), [])
        N = sum((r["naive"] for r in group), [])
        st = dict(wape=wape(F, A), bias=bias(F, A), oracle=wape(O, A), naive=wape(N, A),
                  in_range=sum(r["in_range"] for r in group) / len(group) * 100,
                  trend=sum(r["trend_applied"] for r in group), season=sum(r["seasonality_applied"] for r in group))
        arch_stats[arch] = st
        say(f"{arch:20s} {len(group):3d} {st['wape']:5.1f}% {st['oracle']:6.1f}% {st['naive']:5.1f}% {st['bias']:+5.1f}% "
            f"{exp_arch[arch]['method_systematic_bias_pct']:+7.1f}% {st['in_range']:8.0f}% {st['trend']:6d} {st['season']:7d}")

    core = [r for r in per if r["arch"] in a_to_f]
    F = sum((r["forecast"] for r in core), [])
    A = sum((r["actual"] for r in core), [])
    pooled_w, pooled_b = wape(F, A), bias(F, A)
    beats = sum(1 for r in core if wape(r["forecast"], r["actual"]) < wape(r["naive"], r["actual"])) / len(core) * 100
    coverage = sum(r["in_range"] for r in core) / len(core) * 100
    conf = defaultdict(list)
    for r in core:
        conf[r["confidence"]].append(wape(r["forecast"], r["actual"]))
    mean = lambda xs: sum(xs) / len(xs) if xs else None   # noqa: E731
    hi, rest = mean(conf.get("high", [])), mean(conf.get("medium", []) + conf.get("low", []))

    def mark(code, ok, detail):
        results[code] = dict(passed=bool(ok), detail=detail)
        say(f"  {'PASS' if ok else 'FAIL'}  {code}: {detail}")

    say("")
    say("Pass marks (written before the run, expected.json):")
    mark("P1", pooled_w <= 25, f"pooled WAPE A-F {pooled_w:.1f}% (mark: <= 25%)")
    mark("P2", abs(pooled_b) <= 10, f"pooled bias A-F {pooled_b:+.1f}% (mark: within +/-10%)")
    p3 = {a: arch_stats[a]["wape"] <= 1.5 * exp_arch[a]["oracle_wape_pct"] + exp_arch[a]["method_systematic_wape_pct"] + 1 for a in a_to_f}
    mark("P3", all(p3.values()), "WAPE within 1.5x oracle + systematic + 1 per archetype: " +
         ", ".join(f"{a.split('_')[0]} {arch_stats[a]['wape']:.1f}<={1.5 * exp_arch[a]['oracle_wape_pct'] + exp_arch[a]['method_systematic_wape_pct'] + 1:.1f}{'' if ok else ' X'}" for a, ok in p3.items()))
    p4 = {a: abs(arch_stats[a]["bias"] - exp_arch[a]["method_systematic_bias_pct"]) <= 3 for a in a_to_f}
    mark("P4", all(p4.values()), "bias within 3 points of the predicted systematic bias: " +
         ", ".join(f"{a.split('_')[0]} {arch_stats[a]['bias']:+.1f} vs {exp_arch[a]['method_systematic_bias_pct']:+.1f}{'' if ok else ' X'}" for a, ok in p4.items()))
    mark("P5", beats >= 60, f"beats the naive forecast for {beats:.0f}% of businesses (mark: >= 60%)")
    mark("P6", coverage >= 90, f"actual 6-month revenue inside the low-high range for {coverage:.0f}% (mark: >= 90%)")
    mark("P7", hi is not None and rest is not None and hi < rest,
         f"mean WAPE high confidence {hi if hi is None else round(hi, 1)}% (n={len(conf.get('high', []))}) vs medium/low "
         f"{rest if rest is None else round(rest, 1)}% (n={len(conf.get('medium', [])) + len(conf.get('low', []))})")
    g = arch_stats.get("G_sudden_drop")
    say(f"  note  G: WAPE {g['wape']:.1f}% (A: {arch_stats['A_steady']['wape']:.1f}%), bias {g['bias']:+.1f}% "
        f"(expected: higher error than A and positive bias)")

    # ── Scenarios ──
    say("")
    say("Scenarios with a known true answer:")
    s_true_ok = s_spec_ok = s_true_agree = 0
    profit_err = []
    wrong_in, wrong_in_flagged, wrong_out, wrong_out_flagged = 0, 0, 0, 0
    for sc in truth["scenarios"]:
        st = BusinessStateSnapshot(**sc["state"])
        _r, base = project(st, BASE, {}, sc["months"])
        _r, with_true = project(st, sc["kind"], sc["true_params"], sc["months"])
        _r, with_std = project(st, sc["kind"], sc["owner_params"], sc["months"])
        v_true = compare_projections(base, with_true)["outcome"]
        v_std = compare_projections(base, with_std)["outcome"]
        robust = U.ranges(st, sc["kind"], sc["owner_params"], sc["months"], None)["robust"]
        s_true_ok += v_true == sc["true_verdict"]
        profit_err.append(abs(with_true["cumulative_profit"] - sc["true_profit"]) / max(1.0, abs(sc["true_profit"])) * 100)
        s_spec_ok += v_std == sc["expected_simulation_verdict_with_standard_figures"]
        s_true_agree += v_std == sc["true_verdict"]
        if v_std != sc["true_verdict"]:
            if sc["true_within_tested_range"]:
                wrong_in += 1
                wrong_in_flagged += not robust
            else:
                wrong_out += 1
                wrong_out_flagged += not robust
    n = len(truth["scenarios"])
    se = expected["scenario_expectations"]
    mark("S1", s_true_ok == n and max(profit_err) <= 0.1,
         f"with the true inputs: verdict right in {s_true_ok}/{n}; largest 12-month profit error {max(profit_err):.4f}% (mark: all right, <= 0.1%)")
    mark("S2", s_spec_ok == n, f"with standard figures: verdict as specified in {s_spec_ok}/{n}; agrees with the TRUE verdict in "
         f"{s_true_agree / n * 100:.1f}% (predicted {se['predicted_agreement_true_vs_standard_figures_pct']}%)")
    flagged_share = wrong_in_flagged / wrong_in * 100 if wrong_in else 100.0
    mark("S3", flagged_share >= 90, f"wrong verdicts flagged 'not robust' when the true input is inside the tested range: "
         f"{wrong_in_flagged}/{wrong_in} ({flagged_share:.0f}%, mark >= 90%); outside the range: {wrong_out_flagged}/{wrong_out} flagged")

    with open(os.path.join(HERE, "results.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(HERE, "results.json"), "w", encoding="utf-8") as f:
        json.dump(dict(by_archetype=arch_stats, pooled_wape=pooled_w, pooled_bias=pooled_b, beats_naive_pct=beats,
                       range_coverage_pct=coverage, confidence_wape={k: mean(v) for k, v in conf.items()},
                       confidence_counts={k: len(v) for k, v in conf.items()}, marks=results), f, indent=1)


if __name__ == "__main__":
    main()
