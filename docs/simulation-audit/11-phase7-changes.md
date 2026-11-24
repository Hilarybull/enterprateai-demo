# Simulation Engine: Phase 7 ("Proving It Over Time") and Final Scorecard

| | |
|---|---|
| **Date** | 21 November 2026 |
| **Model version** | `projection-1.6` (Phase 7 adds monitoring and governance; it changes no figures) |
| **Builds on** | [10-phase6-part2-changes.md](10-phase6-part2-changes.md) |
| **Goal** | Keep the simulation reliable after release: measure it against what really happens for every company, check that confidence means what it says, stop any change that makes it worse, and keep every rate and default sourced and reviewed |
| **Tests** | [backend/tests/test_simulation_phase7.py](../../backend/tests/test_simulation_phase7.py) (37); frontend `SimulationAccuracyAdmin.test.jsx` |

---

## 1. What was added

### 1.1 Accuracy across all companies (Admin → Simulation accuracy)

`monitoring.py`, `GET /v1/scenario-intelligence/admin/accuracy` (platform admin only), screen `SimulationAccuracyAdmin.jsx`.

For every saved run whose forecast months have since completed, the forecast revenue is compared with what the business's records show for those months.

| Shown | Meaning |
|---|---|
| **Status** | "not enough data yet" (under 6 months compared), "within thresholds", or "review needed" |
| **Forecast error (WAPE), bias** | Pooled across companies; also by model version |
| **By confidence level** | Calibration: "high" confidence should have the smallest error. If not, an alert says the confidence rule needs review |
| **Inside the 90% range** | The share of runs whose actual revenue fell inside their own revenue range. About 90% is expected; under 80% raises an alert |
| **Alerts** | Against MODEL.md section 9: WAPE above 25%, bias outside ±10% (6+ months), coverage under 80%, confidence not ordered |

When real outcomes arrive, this is where `RANGE_CALIBRATION` and the confidence limits get recalibrated. Both were set on mock data.

### 1.2 Standards register (`standards.py`)

There are 32 entries: every rate, threshold and default, each with its code constant, source, **evidence level** and the review date.

| Evidence level | Entries |
|---|---|
| Published | 19: HMRC, The Pensions Regulator, PenCom, NSITF, ITF, IRS; Gardner & McKenzie; X-11 / X-13; Iglewicz & Hoaglin; t and normal distributions |
| Calibrated | 1: the range factor |
| Practice | 2 |
| Own choice | 10, to calibrate from tracked accuracy |

- A test checks **every value equals the constant in the code**, so the documentation can't drift from the model.
- **Reviews:** every 12 months. The release gate fails once a review is overdue.

### 1.3 Release gate (`scripts/simulation_release_gate.py`) and CI

One command runs every check. In CI, `.github/workflows/simulation-release-gate.yml` runs it on every pull request or push that touches the simulation.

| # | Check | Requirement |
|---|---|---|
| 1 | Simulation test suites (1,114 tests) | All pass |
| 2a | Independent replication: projections, verdicts, baselines | 400/400, 350/350, 300/300 |
| 2b | Independent replication: Phase 5 factors | 300/300 |
| 3a | Mock production, **holdout set** | Every pre-registered mark (P1–P7, S1–S3) |
| 3b | Mock production, original set | Every mark except P4 (the recorded, explained growth-bias miss, 07 §3) |
| 4 | Standards register | No review overdue |

**It has already earned its place.** Its first run caught a regression in the Phase 6 data check (10, Section 2), which was fixed before release.

**Current result:** passed (6 of 6).

---

## 2. Final scorecard (all phases)

The 14 criteria from the baseline audit (01, Section 6), extended by what Phases 4–7 add.

| # | Criterion | Before | Now | How it is met |
|---|---|---|---|---|
| 1 | Cash projection follows correct accounting | ❌ | ✅ | Three checks every month; replicated independently; random invariants (300 + 200 + 60 cases) |
| 2 | Scenario effects from the business's own figures | ❌/⚠️ | ✅ | Inputs built from the records (09); combined scenarios (10) |
| 3 | All assumptions disclosed | ❌ | ✅ | Assumptions per run and per step; "how this was calculated" with the numbers |
| 4 | Missing data lowers confidence | ❌ | ✅ | Coverage, confidence and the data check (serious issues lower confidence) |
| 5 | Baseline from a reliable period | ❌ | ✅ | Complete months by invoice date; the dashboard figure checked against them; seasonality and trend only when significant |
| 6 | Real-world factors covered | ❌ | ✅ | Tax, VAT, loans, inflation, payroll by country, funding, owners' money, equipment, bad debts, corporation tax |
| 7 | Uncertainty shown | ❌ | ✅ | Calibrated 90% range (holdout 94%), robustness, sensitivity, confidence |
| 8 | Metrics correctly defined and labelled | ⚠️ | ✅ | KPI definitions; methods and standards on the page |
| 9 | Verdicts consistent and material | ❌ | ✅ | Net-cash verdict; overdrawn-today rule; same verdict in page, report and Agent |
| 10 | Every output traceable to its source data | ⚠️ | ✅ | Every input labelled with its source; snapshots; "reproduce"; figures confirmed by the owner |
| 11 | Automated tests against hand-calculated cases | ❌ | ✅ | 1,114 simulation tests, run by the release gate in CI |
| 12 | Model documentation matches the code | ❌ | ✅ | MODEL.md; spec-only replication matches; the register matches the code (tested) |
| 13 | One source of truth for figures | ⚠️ | ✅ | Server builds inputs from the records for the page, the Agent and reports |
| 14 | Forecast accuracy measured against actuals | ❌ | ✅ | Per business (page), across companies (admin), backtest, mock production with holdout |
| 15 | Independent validation (SR 11-7) | — | ⚠️ | Spec-only replication done; **a human reviewer outside this work should sign off** |
| 16 | Ongoing monitoring with thresholds and alerts | — | ✅ | Admin accuracy dashboard; alerts; calibration check |
| 17 | Change control enforced | — | ✅ | Release gate in CI; version stamp; change log; model-update notices |

**Before: 0 of 14 met (4 partial). Now: 16 of 17 met. The one partial is criterion 15, which needs a human sign-off outside this work.**

---

## 3. What only time and people can complete

These can't be done in code. They're the honest remainder, for the team.

1. **Human independent review** (criterion 15): someone outside this work reviews MODEL.md, the evidence and the gate output, and signs off.
2. **Recalibration on real outcomes:** after 3–6 months of production use, read the Admin → Simulation accuracy screen. Then reset `RANGE_CALIBRATION`, the confidence limits and the "own choice" defaults, under change control.
3. **Annual rate review:** check the 2025/26 country rates against HMRC, The Pensions Regulator, PenCom/NSITF/ITF and the IRS. Update `factors.py` and `standards.REVIEWED`. The gate enforces the yearly review.
4. **Open items in other modules:** listed in [SIMULATION_README.md](../../SIMULATION_README.md), Section 8.

## Appendix: files

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/monitoring.py` | **New.** Accuracy across businesses, calibration, alerts |
| `backend/app/modules/scenario_intelligence/standards.py` | **New.** Standards register, review rule |
| `backend/app/modules/scenario_intelligence/router.py` | `GET /admin/accuracy` (platform admin) |
| `frontend/src/components/admin/SimulationAccuracyAdmin.jsx` (+ test), `AdminUI.jsx`, `pages/AdminPage.jsx` | Admin screen |
| `scripts/simulation_release_gate.py` | **New.** Release gate |
| `.github/workflows/simulation-release-gate.yml` | **New.** Runs the gate in CI |
| `backend/requirements-dev.txt` | **New.** Test tools pinned (pytest 9.2.0, pytest-asyncio 1.5.0) |
| `backend/tests/test_simulation_phase7.py` | **New** (37) |
