# Simulation Engine: Phase 0 Changes ("Stop Misleading Output")

| | |
|---|---|
| **Date** | 16 November 2026 |
| **Builds on** | [01-baseline-findings.md](01-baseline-findings.md), the "before" state (unchanged) |
| **Goal of Phase 0** | Remove every output that could actually mislead a decision, and add tests that check the numbers |
| **Evidence (after)** | [evidence/phase0_probe.py](evidence/phase0_probe.py), output: [evidence/phase0_probe_output.txt](evidence/phase0_probe_output.txt) |
| **Evidence (before)** | [evidence/baseline_probe_output.txt](evidence/baseline_probe_output.txt). The baseline probe script runs only against the original code (it calls `calculate_break_even_months`, which Phase 0 removed), so its saved output is the record of the "before" state. |
| **Tests** | [backend/tests/test_simulation_phase0.py](../../backend/tests/test_simulation_phase0.py): hand-calculated cases and accounting checks |

---

## 1. Summary

| Finding | Before | After Phase 0 |
|---|---|---|
| **F1** Money owed never collected | Profitable business shown reaching **−£42,000, "critical"** | Same business: **+£83,000**, every month reconciles |
| **F2** Delay repeated monthly | One late invoice treated as late every month | A selected invoice moves once; "all customers pay later" is a separate, explicit option |
| **F3** Engine scores from a fixed table | Strong and weak business: **identical** changes | Recomputed from each business: strong **0**, weak **+21** survival |
| **F4** Invented assumptions | Every business assumed key-person-dependent, no processes, no backup staff | Engines without real data are reported **"not assessed", with the reason** |
| **F7** Verdict missed large changes | Profit more than doubled → **"neutral"** | → **"Better than doing nothing"**, with the reason, figures and threshold shown |
| **F9** "Break-even months" | "0.67 months"; needing 3× sales scored **85/100** | Margin of safety **33.3%**; needing 3× sales scores **15/100** |
| **F13** (new) Two cash calculations | Page rebuilt cash in the browser; Status came from the server | Page shows the server's projection, unchanged |

Scorecard movement (criteria from Section 5 of the baseline report) is in Section 5 below.

---

## 2. What changed, finding by finding

### F1: Cash follows standard roll-forward accounting

New module: [projection.py](../../backend/app/modules/scenario_intelligence/projection.py). One engine now serves every scenario and the "do nothing" projection.

```
cash(m)        = cash(m−1)        + cash in(m) − cash out(m)
receivables(m) = receivables(m−1) + revenue(m) − collected(m)
```

- Money already owed to the business is collected on its due date. Overdue amounts are assumed collected in month 1.
- New sales are collected after the customer's payment terms. If no terms are recorded, 30 days is assumed, and the run says so.
- Costs are paid in the month they are incurred. Bills already owed are paid when due.
- Both identities are checked on every run and returned as `checks`. The tests also check the indirect method (change in cash = profit − increase in receivables − opening bills paid) across 48 scenario/business combinations.
- Removed: logic that pushed part of every month's revenue beyond the projection window, the rule that excluded money already owed from cash, and code comments tuned to one user's figures.

**Evidence (E1, same business as the baseline):**

| Month | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Cash **before** | 18,000 | 6,000 | −6,000 | −18,000 | −30,000 | **−42,000** |
| Cash **after** | 43,000 | 51,000 | 59,000 | 67,000 | 75,000 | **83,000** |

Hand check: £30,000 + 6 × £8,000 profit + £5,000 fall in receivables = £83,000.

### F2: A delay is applied once

- **Selected invoices:** their amount is paid N months later than due, once.
- **No selection:** every customer payment (already owed or new) arrives N months later. The run's assumptions state which one was used.
- The AI agent's "customers paid 60 days late" card used to pass a month's revenue as a "selected invoice" to rely on the old repeat. It now uses the explicit option. It also compares like with like: both "as things are" and "after" come from the same projection. Before, "as things are" was profit added to cash, which isn't comparable with a cash projection.

### F3/F4: Engine scores

- [orchestrator.py](../../backend/app/engines/scenario/orchestrator.py): the fixed points table, the arbitrary "ranking score" and the straight-line score "timeline" are removed. The engines are run twice on real figures (the business at the end of the period, with and without the change), and the changes are the differences.
- [orchestration_service.py](../../backend/app/modules/scenario_intelligence/orchestration_service.py): an engine runs only on data the business has. Stability, growth, fragility and viability (from a snapshot) need data the simulation doesn't collect, so they are returned as `assessed: false` with the reason. Survival runs, with LOW confidence because there is no history.
- Fixed: survival was given operating expenses only, which left cost of sales out of the cash burn.
- Engine failures are now logged instead of silently ignored.
- Report layer ([contracts/index.js](../../frontend/src/lib/contracts/index.js)): engine output counts only when its scores can actually be read. Before, any engine object set report confidence to "MEDIUM" and listed every engine as having run.

### F7: One verdict rule for every scenario

[`compare_projections`](../../backend/app/modules/scenario_intelligence/projection.py) compares the scenario with the same business doing nothing, over the same months:

1. The change takes cash below zero when doing nothing wouldn't → **worse**.
2. The change keeps cash above zero when doing nothing wouldn't → **improved**.
3. Profit or closing cash is materially lower, and neither is materially higher → **worse**.
4. Profit or closing cash is materially higher, and neither is materially lower → **improved**.
5. One is materially higher and the other materially lower → **mixed** (a trade-off to weigh).
6. Otherwise → **no material change**.

"Material" means more than **1% of the baseline's revenue over the period**, a common audit-style materiality level. The page shows the reason, both closing cash figures, both profit figures and the threshold.

Every scenario's "after" monthly figures now come from the last month of the period. Before, losses were judged at month 12 and everything else at month 1. The stability score is still shown, but it no longer decides the verdict.

### F9: Break-even

[calculations.py](../../backend/app/modules/idea_validation/calculations.py) now reports `break_even_units`, `break_even_sales_ratio` and `margin_of_safety_pct`, and no longer produces `break_even_months`.

The break-even score is now based on margin of safety, so a plan below break-even can't score above 30. Before, the old bands read the ratio as months.

Display updated in Results, Insights and Blueprints. The scoring rubric version moved from v0.3 to v0.4, so old and new scores can be told apart. **Idea Validation scores change for plans where break-even was previously mis-scored.**

### F13 (new finding): One source of figures on the Simulation page

[SimulationPage.jsx](../../frontend/src/pages/SimulationPage.jsx) used to rebuild Cash and Cumulative Profit in the browser:
- It mixed this month's recorded actuals with projected months.
- It subtracted a receivables figure the server never sent.

The Status column came from the server's calculation. The cash a user saw and the status beside it could therefore contradict each other.

Both timeline tables now show the server's figures unchanged. Month 1 is labelled as the month after the run. That matches the projection and the page's own narrative ("Starting next month…").

The page now also shows the verdict in words, its basis, and an "Assumptions used" list.

---

## 3. Verification

| Check | Result |
|---|---|
| New hand-calculated tests (`tests/test_simulation_phase0.py`) | **69 passed** |
| Full backend test suite | **2,351 passed**, 7 failed, 4 skipped. All 7 failures predate Phase 0 (Section 3.1). |
| Frontend tests (Vitest) | **832 passed**, 6 failed. All 6 predate Phase 0. The 7 simulation tests pass (Section 3.1). |
| Frontend production build | Builds successfully |
| Evidence probe re-run on new code | Matches every hand calculation (Section 2) |

### 3.1 Test suite results

Checking whether a failure was caused by Phase 0: every failing test was run again on a copy of the code with **all** Phase 0 changes reverted (originals from `baseline-snapshot/`, plus the exact edits undone in the other files). The same tests failed there, so they predate Phase 0. None of them is in the simulation area.

| Pre-existing failure | Area |
|---|---|
| `test_b6_shared_figures.py`: 3 tests | Agent: adopted/planned figures (`agent/workflows.py`, `agent/planned.py`) |
| `test_marketplace_outreach.py`: 2 tests | Marketplace e-mail outreach |
| `test_marketplace_team.py`: 1 test | Marketplace team changes |
| `test_s1_accepted_values.py`: 1 test | Accepted values (`KeyError: 'monthly_sales'`) |
| `AllDatesUk.test.jsx` | Three admin screens use `<input type="date">` |
| `GoalOnboarding.test.jsx`, `QaRound3.test.jsx` (2), `turnstile.test.js`, `ClaimFlow.test.jsx` | Onboarding, premium research, person check, claim flow |

Run on 16 Nov 2026 in a local virtual environment (`backend/.venv`, Python 3.13) and a local `npm ci` install (Node 24).

---

## 4. Known limits and items for the team

**Still open (planned for later phases):**
- **Price response (F6):** a price rise still loses no sales. Phase 1 adds price elasticity. Until then, price-rise results are an upper bound.
- **Missing data scored as neutral (F5):** still the case inside the Idea Validation dimensions. Phase 2 adds data-confidence ratings.
- **Taxes, loans, seasonality, inflation, hiring on-costs (F10, F11):** Phase 1. Every run lists these as "Not included yet".
- **Part-month:** the projection opens on today's cash and starts with the next full month. Activity still to come in the current month isn't modelled. Phase 1 adds part-month handling.
- **Single-month baseline (F8):** the baseline still comes from the latest calendar month of records. Phase 1 adds a trailing average with trend.

**Found during Phase 0, outside the simulation (for the owners of those areas):**
- **Service-idea validation** (`backend/app/modules/service_ideas/service.py`) has the same break-even defect: a plan needing up to 6× its expected sales scores 100.
- **Database columns:** the code writes `risk_signals` (scenario runs) and the `*_state` ratio fields (timeline rows), but the repo's migrations don't define them. If the live database matches the migrations, those saves fail and the code falls back to server memory without saying so. Phase 0 added no new columns: the verdict and assumptions are stored inside the existing JSON columns `scenario_metrics` / `baseline_metrics`. The live schema needs checking.
- **Clearing history** (`clear_history`) empties the in-memory store for **all** businesses, not just the one being cleared.
- **Report scenario block:** `buildScenarioBlock` in `contracts/index.js` reads engine states from a level where they aren't stored, so report scenario scores fall back to frontend estimates. This is for Phase 3 (single source of truth).

**Behaviour changes users will notice:**
- Projection months are labelled one month later (month 1 = next month).
- The Simulation table no longer mixes this month's actual figures into the projection.
- The verdict reads "Better than / Worse than doing nothing", "Mixed" or "No material change" instead of "Improves / Reduces stability" or "Neutral impact".
- The do-nothing projection no longer shows a verdict badge (it is the baseline itself).
- Idea Validation shows "Margin of safety" instead of "Break-even … months".

---

## 5. Scorecard after Phase 0

| # | Criterion | Baseline | After Phase 0 |
|---|---|---|---|
| 1 | Cash projection follows correct accounting | ❌ | ✅ Met (roll-forward, reconciled every run, tested) |
| 2 | Scenario effects calculated from the business's own figures | ❌ / ⚠️ | ✅ Met (projection and engine changes) |
| 3 | All assumptions disclosed to the user | ❌ | ⚠️ Partial (projection assumptions shown; engine and validation defaults not yet) |
| 4 | Missing data lowers confidence instead of favourable defaults | ❌ | ⚠️ Partial (engines "not assessed"; validation dimensions still default) |
| 5 | Baseline built from a reliable period of data | ❌ | ❌ Not met (Phase 1) |
| 6 | Real-world factors covered | ❌ | ❌ Not met (Phase 1) |
| 7 | Uncertainty shown | ❌ | ❌ Not met (Phase 2) |
| 8 | Metrics correctly defined and labelled | ⚠️ | ✅ Met for simulation (break-even, receivables, month labels) |
| 9 | Verdicts consistent and sensitive to material changes | ❌ | ✅ Met |
| 10 | Every output traceable to its source data | ⚠️ | ⚠️ Partial (verdict basis and assumptions shown; input provenance in Phase 2) |
| 11 | Automated tests against hand-calculated cases | ❌ | ✅ Met for the projection, verdict, engines and break-even |
| 12 | Model documentation matches the code | ❌ | ⚠️ Partial (module docs updated; ENGINES_IMPLEMENTATION.md needs a rewrite) |
| 13 | One source of truth for figures | ⚠️ | ⚠️ Partial (Simulation table fixed; report scenario block still separate) |
| 14 | Forecast accuracy measured against actuals | ❌ | ❌ Not met (Phase 3) |

**Baseline: 0 met, 4 partial → after Phase 0: 5 met, 5 partial, 4 not met.**

---

## Appendix: Files changed

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/projection.py` | **New.** Projection engine, verdict, assumptions |
| `backend/app/modules/scenario_intelligence/service.py` | Uses the projection; verdict stored with runs; dead code removed; AI explanation given the verdict and assumptions |
| `backend/app/modules/scenario_intelligence/orchestration_service.py` | Rewritten: engines only on real data; survival cost fix |
| `backend/app/engines/scenario/orchestrator.py` | Rewritten: real recomputed changes; fixed table removed |
| `backend/app/modules/scenario_intelligence/schemas.py` | Do-nothing response carries its summary |
| `backend/app/modules/agent/chat_actions.py` | Late-payment card uses the explicit delay and like-for-like cash |
| `backend/app/modules/idea_validation/calculations.py` | Break-even as margin of safety; rubric v0.4 |
| `backend/app/modules/blueprint/service.py` | Shows margin of safety |
| `backend/test_multi_engine_e2e.py` | Updated to the new orchestration call |
| `backend/tests/test_simulation_phase0.py` | **New.** 69 tests |
| `frontend/src/pages/SimulationPage.jsx` | Server figures only; month labels; verdict, basis and assumptions shown |
| `frontend/src/lib/contracts/index.js` | Engine output counted only when readable |
| `frontend/src/pages/ResultsPage.jsx`, `frontend/src/lib/insights.js` | Margin of safety in place of break-even months |
| `frontend/src/pages/SimulationImpact.test.js` | New tests for the display helpers |
