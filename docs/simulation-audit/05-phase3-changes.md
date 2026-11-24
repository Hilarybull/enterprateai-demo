# Simulation Engine: Phase 3 Changes ("Validation and Governance")

| | |
|---|---|
| **Date** | 17–18 November 2026 |
| **Builds on** | [01](01-baseline-findings.md) (unchanged), [02](02-phase0-changes.md), [03](03-phase1-changes.md), [04](04-phase2-changes.md) |
| **Goal of Phase 3** | Prove the model keeps working (invariants, backtests, accuracy against real results), document it so the documentation matches the code, and make every part of the product show the same figures |
| **Model specification** | [MODEL.md](MODEL.md): versioned, with change control and change log |
| **Tests** | [backend/tests/test_simulation_phase3.py](../../backend/tests/test_simulation_phase3.py) (553), `frontend/src/lib/SimulationReport.test.js` (3), `frontend/src/lib/financialIntelligence.runrate.test.js` (2), 2 in `SimulationImpact.test.js` |

---

## 1. Summary

| Area | Before Phase 3 | After Phase 3 |
|---|---|---|
| **Accuracy against actual results** | Never measured | Every run stores what it forecast for each month (`forecast_by_month`). Once those months complete, forecasts are compared with recorded revenue (WAPE and bias) and shown on the page |
| **Backtest** | Function only | The baseline method tested on each business's own last 3 complete months, against the naive "next month = last month" benchmark |
| **Invariant testing** | Fixed cases only | **300 randomly generated businesses and scenarios** (fixed seed), plus property tests. 553 tests |
| **Report = page** (single source of truth) | The downloadable report's scenario headline came from the **stability score** ("Scenario improves stability"), the rule Phase 0 removed from the page. Its engine scores were read from fields the server never writes | The report uses the **server's verdict, confidence, robustness and range**, and engine scores where the server stores them |
| **Page = server** (single source of truth) | With no shared figure, the page showed the **latest month alone** as "monthly revenue" while the server projected from 3 complete months | Both use the same rule |
| **Model documentation** | `ENGINES_IMPLEMENTATION.md` described a ranking formula and recomputed engines that the code never had | [MODEL.md](MODEL.md): full specification, defaults and their basis, validation, monitoring thresholds, change control, change log. `ENGINES_IMPLEMENTATION.md` corrected and pointed to it |
| **Model version on every run** | Engine version only | `model_version` (`projection-1.2`) stored with every projection |

---

## 2. What changed

### 2.1 Forecast accuracy against actual results

New module: [accuracy.py](../../backend/app/modules/scenario_intelligence/accuracy.py). New free endpoint: `POST /v1/scenario-intelligence/accuracy`.

- **Tracked accuracy.** Each projection stores `forecast_by_month` (revenue and costs by calendar month). For every saved run, the months that have since completed are compared with the business's recorded revenue.
  - When the owner **accepted** the scenario, its own forecast is judged; otherwise the no-change forecast is.
  - It reports per-run and pooled WAPE and bias, the months compared, and the model version that made each forecast.
- **Backtest.** The baseline method is fitted on the months before each of the last 3 complete months and compared with what happened. It is reported against the naive method, the benchmark any method should beat. This is available immediately from history, before tracked forecasts mature.
- **On the page.** A "How accurate have forecasts been?" box under the run history. When there isn't enough data yet, it says so.

**Monitoring thresholds** (MODEL.md, Section 9): review the model if tracked WAPE is above 25%, or bias is outside ±10%, over 6+ completed months, or if the backtest is worse than the naive method for most businesses.

### 2.2 Invariant and property tests

`test_simulation_phase3.py` generates 300 businesses and scenarios from a fixed seed, so any failure can be replayed. The random inputs cover:
- every scenario type
- revenue, costs and cash (including overdrawn)
- payment terms, money owed and bills
- monthly history (1–26 months)
- tax, VAT, loans and inflation settings
- horizons of 3–24 months, with and without a date

| Check | Cases |
|---|---|
| All three accounting checks hold in every period; cash and balance-sheet bridges over the whole period | 300 |
| Rows match the summary; no negative revenue, cost of sales, receivables or loans; same inputs give the same output | 300 |
| The 13-week view reconciles; the model version and forecast are stored | every dated case |
| £10,000 more cash today = exactly £10,000 more at the end, profit unchanged | 120 |
| More revenue never lowers pre-tax profit; more costs never raise profit | 120 |
| A change of 0% (price, costs, revenue, delay, launch, client loss) is exactly no change, and the verdict is "no material change" | 7 × 25 |
| Accuracy and backtest, worked out by hand; a saved run tracked end to end | 6 |

### 2.3 One source of truth

| Where | Fix |
|---|---|
| Report scenario block (`lib/contracts/index.js`) | Engine scores come from `multi_engine.scenario.engine_deltas`, where the server stores them. Engines the server didn't assess stay empty instead of falling back to the rule-based stability indicator. The block now carries the verdict, confidence, robustness, net cash range and assumptions. The ranking score is null (removed in Phase 0) |
| Report narrative (`lib/narratives/index.js`) | The headline is the verdict ("Better than doing nothing", etc.). The text includes the reason, the profit and net cash change, the range, robustness and confidence. Runs saved before verdicts existed keep the old wording |
| Page monthly figure (`lib/financialIntelligence.js`) | The fallback (used when there is no shared figure) now averages the last 3 complete months, as the server does. It used to take the latest calendar month, often in progress |

Already the same before Phase 3: the Simulation table shows server figures (Phase 0), the shared figures set the baseline level (Phase 1), and the Agent and saved runs use one date (Phase 1).

### 2.4 Documentation and change control

- [MODEL.md](MODEL.md) specifies every input and its precedence, the timing conventions, each formula and scenario rule, every default with its basis and tested range, the verdict rules, the uncertainty method, KPIs, validation layers, monitoring thresholds and known limits.
- **Change control:** a model change must increase `MODEL_VERSION`, add a change-log entry and a hand-calculated test, pass all suites, rerun the evidence probes if their figures change, and update MODEL.md.
- `backend/ENGINES_IMPLEMENTATION.md` has a banner pointing to MODEL.md. Its scenario section, which claimed recomputed engines and a ranking formula, is corrected to describe the code.

---

## 3. Coordination with other modules

| Module | What was checked / changed |
|---|---|
| Reports (downloadable report) | Scenario section now matches the Simulation page (Section 2.3) |
| Simulation, Reports pages (`financialIntelligence.js`) | Same monthly rule as the server |
| Live Plan, Agent, business assistant | Unchanged in Phase 3; their Phase 1–2 fixes are covered by the full suite |
| Database | No new columns: `forecast_by_month` sits inside the existing `baseline_metrics` / `scenario_metrics` JSON |
| Access control | The new accuracy endpoint follows the same pattern as the existing `/history` endpoint: tenant and business come from the request, as elsewhere in this router. **For the team:** the router as a whole doesn't check that the signed-in user may view the business named in the request. That is pre-existing and wider than the simulation, so it is listed here rather than changed |

---

## 4. Verification

| Check | Result |
|---|---|
| Phase 3 tests | **553 passed** |
| All simulation tests (Phases 0–3) | **747 passed** (69 + 104 + 21 + 553) |
| Full backend suite | **3,029 passed**, 9 failed, 4 skipped. 3,029 = 2,476 (Phase 2) + 553. The 9 failures are the same pre-existing ones (02, Section 3.1, and 03, Section 4.1) |
| Frontend tests (Vitest) | **843 passed**, 6 failed: the same 6 as before Phase 0. 7 new tests in Phase 3 (3 report, 2 accuracy, 2 run rate) |
| Frontend production build | Builds successfully |

---

## 5. Final scorecard

| # | Criterion | Baseline | Phase 0 | Phase 1 | Phase 2 | **Phase 3** |
|---|---|---|---|---|---|---|
| 1 | Cash projection follows correct accounting | ❌ | ✅ | ✅ | ✅ | ✅ (invariant-tested on 300 random cases) |
| 2 | Scenario effects from the business's own figures | ❌ / ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 3 | All assumptions disclosed | ❌ | ⚠️ | ⚠️ | ✅ | ✅ |
| 4 | Missing data lowers confidence | ❌ | ⚠️ | ⚠️ | ✅ | ✅ |
| 5 | Baseline from a reliable period | ❌ | ❌ | ✅ | ✅ | ✅ (page and server now agree) |
| 6 | Real-world factors covered | ❌ | ❌ | ✅ | ✅ | ✅ |
| 7 | Uncertainty shown | ❌ | ❌ | ❌ | ✅ | ✅ |
| 8 | Metrics correctly defined and labelled | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 9 | Verdicts consistent and sensitive to material changes | ❌ | ✅ | ✅ | ✅ | ✅ (report now uses the same verdict) |
| 10 | Every output traceable to its source data | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ (plus model version on every run) |
| 11 | Automated tests against hand-calculated cases | ❌ | ✅ | ✅ | ✅ | ✅ (747 simulation tests) |
| 12 | Model documentation matches the code | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ (MODEL.md, change control, engines document corrected) |
| 13 | One source of truth for figures | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ (report, page and server agree; shared figures are the level) |
| 14 | Forecast accuracy measured against actuals | ❌ | ❌ | ❌ | ❌ | ✅ (tracked accuracy and backtest, shown on the page, with review thresholds) |

**Baseline: 0 of 14 met (4 partial) → after Phase 3: 14 of 14 met.**

"Met" means the capability is built, tested and documented. Two of them become stronger with use:
- **Criterion 14:** tracked accuracy needs months to pass before forecasts can be checked. The backtest gives an immediate measure.
- **Confidence calibration:** the confidence rule should be reviewed once tracked accuracy exists across businesses.

---

## 6. Still open, for the team (carried forward and new)

| Item | Owner | Source |
|---|---|---|
| Live database columns: `risk_signals` and the timeline `*_state` fields are written by the code but not in the migrations | Backend / data | 02, Section 4 |
| `clear_history` clears the in-memory runs of **all** businesses | Simulation / backend | 02, Section 4 |
| Service-idea validation break-even scoring | Service ideas module | 02, Section 4 |
| Shared revenue figure is cash received over 92 days including the current month | Owner of `agent/figures.py` | 03, Section 5 |
| Business settings (tax, VAT, loans, inflation) live on the device; storing them on the business profile needs a field | Product / backend | 03, Section 5 |
| Scenario router: no check that the user may view the business named in the request | Backend / security | This document, Section 3 |
| `test_multi_engine_e2e.py` can't run under pytest (async without a marker; adding one breaks later tests) | Backend | 03, Section 4.1 |
| 7 backend and 6 frontend tests were already failing before this work | Their module owners | 02, Section 3.1 |
| This folder has no `.git`; the changes must be moved into the team repository for review | You / team | 01 |

---

## Appendix: Files changed in Phase 3

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/accuracy.py` | **New.** Tracked accuracy and accuracy report |
| `backend/app/modules/scenario_intelligence/projection.py` | `forecast_by_month`; model version 1.2 |
| `backend/app/modules/scenario_intelligence/service.py` | `forecast_accuracy()` |
| `backend/app/modules/scenario_intelligence/router.py` | `POST /accuracy` |
| `backend/ENGINES_IMPLEMENTATION.md` | Banner and corrected scenario section |
| `backend/tests/test_simulation_phase3.py` | **New.** 553 tests |
| `frontend/src/lib/contracts/index.js` | Report scenario block from the server's results |
| `frontend/src/lib/narratives/index.js` | Report headline from the verdict |
| `frontend/src/lib/financialIntelligence.js` | Monthly figure: last 3 complete months |
| `frontend/src/pages/SimulationPage.jsx` | Accuracy box |
| `frontend/src/lib/SimulationReport.test.js`, `frontend/src/lib/financialIntelligence.runrate.test.js` | **New** tests |
| `frontend/src/pages/SimulationImpact.test.js` | 2 new tests |
| `docs/simulation-audit/MODEL.md` | **New.** Model specification |
