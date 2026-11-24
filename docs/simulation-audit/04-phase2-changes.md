# Simulation Engine: Phase 2 Changes ("Trust and Transparency")

| | |
|---|---|
| **Date** | 17 November 2026 |
| **Builds on** | [01-baseline-findings.md](01-baseline-findings.md) (unchanged), [02-phase0-changes.md](02-phase0-changes.md), [03-phase1-changes.md](03-phase1-changes.md) |
| **Goal of Phase 2** | Every result says how sure it is, how wide it could be, what drives it, and where each figure came from; missing data never counts as good news |
| **Evidence** | [evidence/phase2_probe.py](evidence/phase2_probe.py), output: [evidence/phase2_probe_output.txt](evidence/phase2_probe_output.txt) |
| **Tests** | [backend/tests/test_simulation_phase2.py](../../backend/tests/test_simulation_phase2.py): 21 hand-calculated cases |

---

## 1. Summary

| Area | Before Phase 2 | After Phase 2 |
|---|---|---|
| **F11** Uncertainty | One precise figure per month | **Low / base / high** range on every run, driven by the business's own month-to-month variation where it can be measured |
| Verdict reliability | Shown as if certain | Re-checked in the low and high cases: **"robust"**, or "depends on the assumptions", naming the case that changes it |
| What drives the result | Not shown | **Sensitivity** list: each input moved on its own, ranked by how much it moves the decision |
| **Input provenance** | Projection assumptions only | Every input labelled: **recorded, shared figure, from your history, estimate, entered by you, standard figure, assumed, not set** |
| Data confidence | None | **High / medium / low**, with the reasons |
| Standard KPIs | Stability score only | Gross, operating and net margin; cash flow; burn and runway; days to get paid; break-even revenue; margin of safety; interest cover; net cash. Each with its definition |
| **F5** Missing data (Idea Validation) | Filled with favourable scores (capacity 60, client concentration 75, assumed 14-day terms 85, assumed 30-day sales cycle 85; no research: market 40, trend 60) | **Not assessed**, left out of the score, with the rest re-weighted. Coverage and confidence reported |

Sample (evidence probe, +10% price, 6 months of history):
- Verdict: **better than doing nothing**.
- **Not robust:** in the low case (customers twice as sensitive) it is **worse**.
- The sensitivity list ranks customer price sensitivity first (a £25,768 swing). Everything else is under £900.
- **Medium confidence:** 6 months of history, and the standard sensitivity figure was used.

---

## 2. What changed

New module: [uncertainty.py](../../backend/app/modules/scenario_intelligence/uncertainty.py). Every scenario run stores the result in `scenario_metrics.uncertainty`; the do-nothing projection returns it in `summary.uncertainty`.

### 2.1 Low / base / high (F11)

The uncertain inputs move together: adversely in the low case, favourably in the high case.

| Input | How far it moves |
|---|---|
| Revenue | One typical monthly swing: the standard deviation of the business's complete months around their trend, as a share of the mean, over up to 12 months (3–50%). **15%** when there are under 3 months to measure, and the run says so. Cost of sales follows revenue |
| Operating expenses | Their own typical swing (**10%** when not measurable) |
| Customer payments | 15 days later in the low case |
| The scenario's own estimates | Price sensitivity (×2 or +0.5 / ÷2), employer on-costs (25% / 10%), a new hire's revenue (×0.5), a new service's revenue (×0.5 / ×1.25) and launch cost (×1.25) |

Both sides of the comparison are adjusted alike, and the verdict is worked out again in each case. The page labels the range: **"plausible range, not probabilities"**. A probability interval would need far more history than small businesses usually have, so claiming one would overstate precision.

### 2.2 Sensitivity

Each driver is moved on its own: revenue ±10%, operating expenses ±10%, cost of sales ±10%, payment 15 days later or sooner, and the scenario's own estimate. The result is the swing in the scenario's **net cash change against doing nothing**, ranked largest first. It also shows whether that driver alone flips the verdict.

A driver that affects both sides equally shows a swing of about 0 (for example, operating expenses in a price decision). That is correct: it doesn't change the decision.

### 2.3 Where each figure came from

Each run lists every input with its value, a label and its source:

| Label | Meaning |
|---|---|
| recorded | From the business's records (invoices, expenses, terms) |
| shared figure | The figure the dashboard, risk check and Agent use (`agent/figures.py`), with its own source in words |
| from your history | Average of complete months on record |
| estimate | From the owner's pricing answers, when there are no records |
| entered by you | Set by the owner for this run or in business settings |
| standard figure | A documented default (price sensitivity 1, on-costs 15%) left unchanged |
| assumed | Not on record; an assumption was needed (for example, 30-day payment terms) |
| not set / none recorded | Not used |

To support this, the server now also records where the shared **cash** figure came from (`figure_sources.starting_cash`).

### 2.4 Confidence

A transparent points rule, shown with the reasons:

| Factor | Points |
|---|---|
| Months of sales history | 12+ months: +2 · 6–11: +1 · 3–5: 0 · under 3: −1 |
| Revenue from an estimate | −2 |
| No revenue on record | −2 |
| No costs on record | −2 |
| Payment terms assumed | −1 |
| Items left out for want of an exchange rate | −1 |
| Standard figures used | −1 |

Result: 2 or more points = **high**, 0–1 = **medium**, below 0 = **low**.

### 2.5 Standard KPIs

Computed for both sides at the end of the period, each with its definition in the output:
- gross margin, operating margin, and net margin over the period
- average monthly cash flow, monthly burn and runway
- days sales outstanding
- break-even revenue and margin of safety
- interest cover
- net cash

### 2.6 F5: missing data in Idea Validation

| Engine | Change |
|---|---|
| `calculations.py` (feasibility, rubric **v0.4 → v0.5**; also used by the simulation's viability engine and `simulation/service.py`) | Capacity, payment terms, sales cycle and client concentration are **not assessed** when not given. Their score is `None`, the explanation says why, and the remaining weights are re-scaled to sum to 1. New fields: `not_assessed`, `data_coverage_pct`, `confidence` |
| `idea_validation_engine.py` (standard engine, **3.0 → 3.1**) | Without market research, market evidence and trend are not assessed (they were an assumed 40 and 60) |
| `idea_validation/service.py` (legacy flow) | No longer invents inputs: one person × 100 units of capacity, 30-day sales cycle, 14-day terms |
| `engine_v4.py` | **Checked, no change needed.** It already separates a confidence score from the potential score and treats unknown answers as low, not favourable |
| Results page | Not-assessed dimensions read "Not assessed" with the reason. They are left out of the charts (they used to draw as 0). One line gives the confidence and coverage |

Sample: an idea with only money figures now scores **67 with medium confidence on 67% coverage**. Before, four dimensions were filled with favourable defaults.

### 2.7 On the Simulation page

Under each result, a **"How sure is this?"** panel shows:
- the confidence and its reasons
- net cash in the low, base and high cases
- the robustness statement (highlighted when the verdict depends on the assumptions)
- the three inputs that move the result most
- an expandable "Where each figure came from" table
- an expandable "Key measures" list (scenario against now)

The AI explanation is now given the confidence and robustness, and is told to state them.

---

## 3. Coordination with other modules

| Module | What was checked / changed |
|---|---|
| **Business assistant** (`business_assistant/service.py`) | **Fixed before it broke.** It passes the last 8 runs to its AI model inside a 12,000-character limit. Whole runs now carry monthly detail, ranges and a 13-week view, so they would be cut off and the verdicts lost. It now uses `run_digest()` from the simulation module: the verdict, reason, figures, confidence, robustness and basis (estimate or records), under 1,500 characters a run. It also selects `parameters`, which the migrations define, so the basis is known |
| **Idea Validation → Results page** | Not-assessed dimensions shown as such, never as 0 |
| **Scenario orchestration** (viability engine) | Uses the rubric v0.5 feasibility engine; still only runs when real financial inputs are supplied (Phase 0 rule) |
| **Live Plan, Agent, Reports** | Unaffected: the new data is additive, inside existing JSON fields |
| **Database** | No new columns |

---

## 4. Verification

| Check | Result |
|---|---|
| Phase 2 tests (`tests/test_simulation_phase2.py`) | **21 passed** |
| Phase 0 and Phase 1 tests | **69** and **104 passed** |
| Full backend suite | **2,476 passed**, 9 failed, 4 skipped. 2,476 = 2,454 (Phase 1 run) + 1 Phase 1 test added later + 21 Phase 2 tests. The 9 failures are the 7 pre-existing ones (02, Section 3.1) and the 2 pre-existing `test_multi_engine_e2e.py` failures (03, Section 4.1) |
| Frontend tests (Vitest) | **836 passed**, 6 failed: the same 6 as before Phase 0. 4 new tests across Phases 1–2 |
| Frontend production build | Builds successfully |
| Evidence probe | Matches the hand calculations; output saved |

---

## 5. Known limits after Phase 2

- **Range, not probability:** the low and high cases are a stress range. A probability interval would need several years of monthly data per business, which most users won't have. The page says so.
- **Confidence points** are a transparent rule, not a calibrated model. Phase 3's backtesting is how calibration would be measured over time.
- **Idea Validation scores change** for ideas with missing inputs, because they are no longer filled with favourable values. The rubric versions (v0.5 / 3.1) let old and new results be told apart.

## 6. Scorecard after Phase 2

| # | Criterion | Baseline | Phase 0 | Phase 1 | Phase 2 |
|---|---|---|---|---|---|
| 1 | Cash projection follows correct accounting | ❌ | ✅ | ✅ | ✅ |
| 2 | Scenario effects from the business's own figures | ❌ / ⚠️ | ✅ | ✅ | ✅ |
| 3 | All assumptions disclosed | ❌ | ⚠️ | ⚠️ | ✅ (assumptions, input labels, standard figures, not-assessed dimensions) |
| 4 | Missing data lowers confidence | ❌ | ⚠️ | ⚠️ | ✅ (confidence rating; validation dimensions not assessed) |
| 5 | Baseline from a reliable period | ❌ | ❌ | ✅ | ✅ |
| 6 | Real-world factors covered | ❌ | ❌ | ✅ | ✅ |
| 7 | Uncertainty shown | ❌ | ❌ | ❌ | ✅ (range, robustness, sensitivity, confidence) |
| 8 | Metrics correctly defined and labelled | ⚠️ | ✅ | ✅ | ✅ (KPI definitions in the output) |
| 9 | Verdicts consistent and sensitive to material changes | ❌ | ✅ | ✅ | ✅ |
| 10 | Every output traceable to its source data | ⚠️ | ⚠️ | ⚠️ | ✅ (every input labelled with its source) |
| 11 | Automated tests against hand-calculated cases | ❌ | ✅ | ✅ | ✅ |
| 12 | Model documentation matches the code | ❌ | ⚠️ | ⚠️ | ⚠️ (Phase 3) |
| 13 | One source of truth for figures | ⚠️ | ⚠️ | ⚠️ | ⚠️ (Phase 3) |
| 14 | Forecast accuracy measured against actuals | ❌ | ❌ | ❌ | ❌ (Phase 3) |

**Baseline 0 met → Phase 0: 5 → Phase 1: 7 → Phase 2: 11 met, 2 partial, 1 not met.**

---

## Appendix: Files changed in Phase 2

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/uncertainty.py` | **New.** Ranges, robustness, sensitivity, inputs, confidence, KPIs |
| `backend/app/modules/scenario_intelligence/projection.py` | `adjust` option for the cases |
| `backend/app/modules/scenario_intelligence/service.py` | Uncertainty with every run and projection; `run_digest()`; AI explanation given confidence and robustness |
| `backend/app/modules/scenario_intelligence/router.py` | Cash source recorded; do-nothing projection knows when it is an estimate |
| `backend/app/modules/business_assistant/service.py` | Uses `run_digest()`; selects `parameters` |
| `backend/app/modules/idea_validation/calculations.py` | F5: not assessed instead of favourable defaults; coverage and confidence; rubric v0.5 |
| `backend/app/modules/idea_validation/idea_validation_engine.py` | F5: no research → not assessed; rubric 3.1 |
| `backend/app/modules/idea_validation/service.py` | Legacy flow passes only what was given |
| `backend/tests/test_simulation_phase2.py` | **New.** 21 tests |
| `frontend/src/pages/SimulationPage.jsx` | "How sure is this?" panel |
| `frontend/src/pages/ResultsPage.jsx` | Not-assessed dimensions; confidence line |
| `frontend/src/pages/SimulationImpact.test.js` | 2 new tests |
