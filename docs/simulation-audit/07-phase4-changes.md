# Simulation Engine: Phase 4 Changes ("Fix Before Production")

| | |
|---|---|
| **Date** | 20 November 2026 |
| **Model version** | `projection-1.2` → **`projection-1.3`** ([MODEL.md](MODEL.md), change log) |
| **Builds on** | [06-independent-review-and-mock-production.md](06-independent-review-and-mock-production.md): the problems found there |
| **Goal** | Remove every known way the simulation could mislead the companies using it, before production |
| **Tests** | [backend/tests/test_simulation_phase4.py](../../backend/tests/test_simulation_phase4.py) (19), `frontend/src/pages/SimulationFirstRun.test.jsx` (1) |

---

## 1. Summary

| Problem found (06) | Fix in 1.3 | Result |
|---|---|---|
| Seasonality applied to every business with 24 months, even with no seasonal pattern | Applied only when the **F-test for stable seasonality** is significant at 1% (the test used in US Census Bureau X-11 / X-13ARIMA-SEATS seasonal adjustment) | Steady businesses: error **15.2% → 9.5%** (the best possible); false seasonal patterns **30/30 → 0/30**; seasonal businesses keep it (59/60) |
| A business already overdrawn today: a change that clears the overdraft read as "no material change" | "Below zero" judged over the months ahead; cash below zero today is reported and named in the reason | Verdicts agree with the specification **350/350** (348/350 in 1.2) |
| Real results fell outside the low–high range 32% of the time | Revenue and costs move by a **90% forecast range** that includes the uncertainty in the level, the trend and the seasonal pattern; calibrated on one mock set, confirmed on a separate one | Coverage **68% → 91%** (calibration set), **94%** (holdout set) |
| "High confidence" runs had *higher* error than the others | Confidence also counts how predictable sales are (a forecast range wider than ±20% / ±35%: −1 / −2) | High **7.5%** error against medium/low **11.8%** (holdout) |
| The page briefly showed a wrong confidence and range while loading | The first projection waits for the business's records | Shown by a page test that fails without the fix |
| A signed-in user could read or write another company's simulations | Every simulation endpoint checks the caller may see the business (404 otherwise) | 13 endpoints covered; tested with an outsider, the owner and a member |
| Clearing history cleared every business's in-memory runs | Clears only that business's runs | Tested |

---

## 2. What changed

### 2.1 Seasonality only when it is real (`baseline.py`)

- **New:** `seasonality_test()`, the F-test for stable seasonality, reported with every baseline as `seasonality_test` (F, degrees of freedom, p-value). It works like this:
  - each complete month is divided by a straight-line trend through the whole series
  - the results are grouped by calendar month
  - a one-way analysis of variance compares the differences between calendar months with the noise within them
- **Rule:** seasonal indices are applied only if p < 0.01. Otherwise the note says "not applied (no statistically significant seasonal pattern)".
- **Implementation:** the p-value comes from the regularised incomplete beta function, so no new library is needed. It matches published F-tables to 4 decimal places (5 test cases).

### 2.2 Running short of cash, and cash below zero today (`projection.py`)

- **New summary fields:** `min_cash_ahead`, `first_negative_month_ahead` and `overdrawn_today`.
- **Verdict:** rules 1–2a now compare the months ahead (month 1 onwards). Scenarios start in month 1, so today can't differ between the two projections.
- **Reporting:** a new `cash_below_zero_today` field, and the reason text says so: "Cash is below zero today; with this change it is back above zero from month 1…".
- **Older runs:** runs saved without the new fields are judged as before.

### 2.3 The low–high range (`uncertainty.forecast_swing`)

The revenue range (and, the same way, the cost range) is:

`1.645 × 1.4 × √( σ²/3 + σ²/H + (se_b · s̄ / L)² + (|b| · (ū − s̄) / L)² [+ σ²/years if seasonal] )`

| Term | What it covers |
|---|---|
| σ²/3 | The level is an average of only 3 months, and its error doesn't average out |
| σ²/H | Month-to-month variation, which does average out over the H months |
| (se_b · s̄ / L)² | Uncertainty in the trend's slope, carried forward as the projection carries it (damped) |
| (\|b\| · (ū − s̄) / L)² | What the trend's damping holds back. Damping is a modelling choice, so it's treated as uncertainty |
| σ²/years | Seasonal indices estimated from only a few years |

**Calibration.** 1.645 gives a 90% normal range. The factor **1.4** (`RANGE_CALIBRATION`) was set on the 19 November mock set:

| Factor | Coverage |
|---|---|
| 1.0 | 79.4% |
| 1.2 | 86.7% |
| **1.4** | **90.6%** |
| 1.6 | 94.4% |

It was then **checked on a holdout set** of 200 new businesses from a different seed, never used to set anything, with the pass marks written down first: **94% coverage** (mark ≥ 86%).

The page's note now says that revenue and costs move by a 90% range, and that the whole range, with payment timing and the scenario's own estimates also moving, is a cautious one.

### 2.4 Confidence (`uncertainty.confidence`)

| Revenue forecast range | Points |
|---|---|
| Wider than ±20% | −1 ("sales vary noticeably from month to month") |
| Wider than ±35% | −2 ("sales vary a lot") |

The limits were fixed before testing. A long but erratic history no longer earns "high".

### 2.5 The Simulation page (`SimulationPage.jsx`)

The automatic projection and the business-intelligence panel wait until the business's records have loaded, whether the load succeeds or fails. The new page test fails on the old code and passes on the new.

### 2.6 Access and history (`router.py`, `service.py`)

**Access.** `_require_business` and `_require_run` follow the Agent's existing rule (`goal_router._business_for`):
- No access answers **404 "Not found"**, so nothing about another business is revealed.
- If access can't be checked (for example, a database error), the request is refused with 503 rather than answered.

The check covers 13 endpoints: risk detection, recommendations, creating a run, execute, explain, get, timeline, the no-change projection, accuracy, decision, history (view and clear) and the business-intelligence run.

**History.** `clear_history` removes only that tenant's runs for that business, both in memory and in the database.

---

## 3. A choice recorded: the trend window stays at 12 months

Growing businesses are still under-forecast by about 3–6%: in some, the trend isn't detected, and the damping holds the rest back. A 24-month window was tested (diagnostic only):

| Window | Growing (B) | Sudden drop (G) |
|---|---|---|
| 12 months (kept) | 9.7% error, trend found in 14/30 | **10.1%** |
| 24 months | **8.4%**, trend found in 27/30 | 13.6%, bias +13.5% |

A longer window finds more slow growth, but reacts too slowly when a business loses a big client, which is common for small businesses. **12 months is kept.** The 1.3 range now covers the growth case: 80% of growing businesses fall inside it, up from 60%. This is recorded in MODEL.md, Section 11.

---

## 4. Verification

### 4.1 Independent replication

The shadow model was updated to the 1.3 specification. Its seasonality test computes the p-value **a different way**, by numerical integration of the F density rather than the code's continued fraction, so each implementation checks the other.

| Check | Result |
|---|---|
| Projections | **400 / 400** match |
| Verdicts | **350 / 350** agree |
| Baselines, including the seasonality decision | **300 / 300** match |

### 4.2 Mock production test (pass marks fixed before any run)

| Check | 1.2 (06) | 1.3, original set | 1.3, **holdout set** |
|---|---|---|---|
| P1: error (WAPE) ≤ 25% | ✅ 10.9% | ✅ 9.7% | ✅ 8.5% |
| P2: bias within ±10% | ✅ −1.3% | ✅ −1.1% | ✅ −0.9% |
| P3: error near the best possible, per type | ✅ | ✅ | ✅ |
| P4: bias as predicted, per type | ❌ | ❌ (growing, Section 3) | ✅ |
| P5: beats the naive forecast for ≥ 60% | ✅ 68% | ✅ 76% | ✅ 79% |
| P6: actual results inside the range ≥ 90% | ❌ 68% | ✅ 91% | ✅ 94% |
| P7: high confidence → lower error | ❌ | ✅ 8.7% vs 12.0% | ✅ 7.5% vs 11.8% |
| S1–S3: scenarios | ✅ | ✅ | ✅ |
| **Total** | **4 of 7 + 3/3** | **6 of 7 + 3/3** | **7 of 7 + 3/3** |
| Holdout marks H1–H3 (coverage ≥ 86%, accuracy limits, no type below 70%) | n/a | n/a | ✅ 94%, ✅, ✅ lowest 87% |

The evidence is in [evidence/mock_production/](evidence/mock_production/) and `holdout/` (truth, expected results, fingerprints and results).

### 4.3 Test suites

| Suite | Result |
|---|---|
| Simulation tests (Phases 0–4) | **766 passed** (747 + 19). One Phase 2 test was updated for the new range wording; its figures are unchanged |
| Router tests (`test_simulation_insufficient_data.py`) | 11 passed. One test's fake run was given its business, as real runs always have one |
| Full backend | **3,045 passed**, 12 failed. 9 are the pre-existing failures. The other 3 (marketplace) come from the team's `backend/.env` file now in the folder, which switches marketplace reminders off and invites on: with those settings at their code defaults, marketplace shows only its 2 pre-existing failures. **Not related to the simulation** |
| Frontend | **844 passed** (843 + the new page test); the same 6 pre-existing failures as before Phase 0 |
| Production build | Succeeds |

---

## 5. Coordination with the rest of EnterprateAI

| Module | Effect |
|---|---|
| Downloadable report, business assistant | They read the verdict, confidence, robustness and range with the same fields and structure; only the explanatory wording is new |
| Agent (chat scenario card) | Uses the same timeline and verdict functions, so it gets the 1.3 verdicts and reasons automatically |
| Live Plan, accuracy tracking | Unchanged. Runs are stamped `projection-1.3`, so old and new can be told apart |
| Access | The simulation now follows the same business-access rule as the Agent |
| Database | No new columns. The new summary fields are stored in the existing JSON |

---

## 6. Still open (for later phases)

- **Phase 5, missing factors:** funding events (equity, investors, grants, owner capital), payroll with country NI and pension, owner drawings and dividends, equipment purchases, bad debts, the expense split, corporation tax.
- **Phase 6, defensibility:** a data quality check, figure confirmation, run snapshots, a "why this verdict" breakdown in pounds, scenario comparison, refusal rules and model-update notices.
- **Phase 7, proving it over time:** an accuracy dashboard across companies, confidence calibrated on real outcomes, the release gate in CI, sourced defaults.
- **Recalibration:** `RANGE_CALIBRATION` and the confidence limits were set on mock data. Recalibrate them from tracked accuracy once real data exists.

## Appendix: files changed in Phase 4

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/baseline.py` | Seasonality F-test (`seasonality_test`, `f_test_p_value`) and its use |
| `backend/app/modules/scenario_intelligence/projection.py` | Months-ahead shortfall fields, verdict rule, `cash_below_zero_today`; `MODEL_VERSION` 1.3 |
| `backend/app/modules/scenario_intelligence/uncertainty.py` | `forecast_swing` (90% range, calibration 1.4), confidence predictability factor, range note |
| `backend/app/modules/scenario_intelligence/router.py` | `_require_business`, `_require_run` on 13 endpoints |
| `backend/app/modules/scenario_intelligence/service.py` | `clear_history` limited to the business |
| `frontend/src/pages/SimulationPage.jsx` | First projection waits for the records |
| `backend/tests/test_simulation_phase4.py` | **New**, 19 tests |
| `frontend/src/pages/SimulationFirstRun.test.jsx` | **New** |
| `backend/tests/test_simulation_phase2.py`, `test_simulation_insufficient_data.py` | Range wording; a run's business |
| `docs/simulation-audit/MODEL.md` | 1.3 specification and change log |
| `docs/simulation-audit/evidence/independent_review/shadow_model.py` | 1.3 seasonality test, written independently |
| `docs/simulation-audit/evidence/mock_production/holdout/` | **New** holdout set, pre-registration and results |
