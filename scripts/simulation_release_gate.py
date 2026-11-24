"""Simulation release gate (Phase 7). Every change to the simulation must pass this before release.

Run from the project root:   backend/.venv/Scripts/python.exe scripts/simulation_release_gate.py
(in CI: python scripts/simulation_release_gate.py). Exit code 0 = pass, 1 = fail.

Checks, in order (docs/simulation-audit/MODEL.md section 10 and 11-phase7-changes.md):
 1. The simulation test suites (hand-calculated cases, invariants, replication-style checks) all pass.
 2. Independent replication: the application against the model rebuilt from MODEL.md, every case must match.
 3. Mock production: the holdout set must pass every pre-registered mark (P1-P7, S1-S3); the original set every mark
    except P4, the one recorded, explained miss (07-phase4-changes.md, section 3).
 4. Standards register: no review overdue (standards.py, every 12 months).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND = os.path.join(ROOT, "backend")
EVIDENCE = os.path.join(ROOT, "docs", "simulation-audit", "evidence")
PY = sys.executable
SIM_TESTS = ["tests/test_simulation_phase0.py", "tests/test_simulation_phase1.py", "tests/test_simulation_phase2.py",
             "tests/test_simulation_phase3.py", "tests/test_simulation_phase4.py", "tests/test_simulation_phase5.py",
             "tests/test_simulation_phase6.py", "tests/test_simulation_phase6b.py", "tests/test_simulation_phase7.py",
             "tests/test_simulation_insufficient_data.py"]
ALLOWED_ORIGINAL_SET_MISSES = {"P4"}

results: list[tuple[str, bool, str]] = []


def run(cmd: list[str], cwd: str) -> tuple[int, str]:
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def check(name: str, ok: bool, detail: str) -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}", flush=True)


def main() -> int:
    code, out = run([PY, "-m", "pytest", "-p", "no:cacheprovider", "-q", *SIM_TESTS], BACKEND)
    tail = [line for line in out.splitlines() if re.search(r"\d+ (passed|failed)", line)]
    check("1. Simulation tests", code == 0, tail[-1] if tail else "no result")

    code, out = run([PY, "-I", os.path.join(EVIDENCE, "independent_review", "compare.py")], BACKEND)
    differ = re.findall(r"differ\s+(\d+)", out)
    verdicts = re.search(r"Verdicts agreeing: (\d+) of (\d+)", out)
    base = re.search(r"Baseline method .*?: (\d+) of (\d+) match", out)
    ok = (code == 0 and differ and all(d == "0" for d in differ) and verdicts and verdicts.group(1) == verdicts.group(2)
          and base and base.group(1) == base.group(2))
    check("2a. Replication: projections, verdicts, baselines", bool(ok),
          f"projection differences {sum(int(d) for d in differ) if differ else '?'}; verdicts {verdicts.group(0) if verdicts else '?'}; "
          f"baselines {base.group(1) + '/' + base.group(2) if base else '?'}")
    code, out = run([PY, "-I", os.path.join(EVIDENCE, "independent_review", "compare_phase5.py")], BACKEND)
    m = re.search(r"(\d+) of (\d+) random businesses match", out)
    check("2b. Replication: further factors", bool(code == 0 and m and m.group(1) == m.group(2)), m.group(0) if m else out[-200:])

    for label, script, allowed in (("3a. Mock production, holdout set", os.path.join(EVIDENCE, "mock_production", "holdout", "evaluate_holdout.py"), set()),
                                   ("3b. Mock production, original set", os.path.join(EVIDENCE, "mock_production", "evaluate.py"), ALLOWED_ORIGINAL_SET_MISSES)):
        code, out = run([PY, "-I", script], ROOT)
        fails = set(re.findall(r"FAIL\s+([PS]\d)", out))
        passes = set(re.findall(r"PASS\s+([PS]\d)", out))
        ok = code == 0 and len(passes | fails) >= 10 and fails <= allowed
        check(label, ok, f"{len(passes)} passed; failed: {', '.join(sorted(fails)) or 'none'}"
                         + (f" (allowed: {', '.join(sorted(allowed))})" if allowed else ""))

    sys.path.insert(0, BACKEND)
    from app.modules.scenario_intelligence import standards
    due = standards.overdue()
    check("4. Standards register reviewed", not due, f"last reviewed {standards.REVIEWED.isoformat()}"
          + (f"; overdue: {len(due)} standards (review the rates in factors.py, update standards.REVIEWED)" if due else ""))

    failed = [r for r in results if not r[1]]
    print("\nRELEASE GATE: " + ("PASSED" if not failed else f"FAILED ({len(failed)} of {len(results)} checks)"))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
