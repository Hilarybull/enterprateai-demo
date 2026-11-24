# Simulation Engine: Phase 1 Changes ("Sound Model")

| | |
|---|---|
| **Date** | 17 November 2026 |
| **Builds on** | [01-baseline-findings.md](01-baseline-findings.md) (the "before" state, unchanged) and [02-phase0-changes.md](02-phase0-changes.md) |
| **Goal of Phase 1** | An integrated model that balances; a baseline from reliable data; the real-world factors a business decision depends on |
| **Evidence** | [evidence/phase1_probe.py](evidence/phase1_probe.py), output: [evidence/phase1_probe_output.txt](evidence/phase1_probe_output.txt) |
| **Tests** | [backend/tests/test_simulation_phase1.py](../../backend/tests/test_simulation_phase1.py): 104 hand-calculated cases and balance checks |
| **Model version** | `projection-1.1` (Phase 0 was 1.0); engine version `scenario_intel_v2.1` |

---

## 1. Summary

| Area | Before Phase 1 | After Phase 1 |
|---|---|---|
| **F8** Baseline | Latest calendar month on record, often still in progress (sample: November so far, **£6,400**) | Shared figure, else the average of the last **3 complete months** (sample: **£19,066.67**), plus trend and seasonality when the data supports them |
| **F6** Price response | +10% price = +10% revenue, no sales lost | Sales volume responds (standard sensitivity 1, owner can change it); cost of sales follows volume. Sample: **+£12,000** profit becomes **+£2,182**, or **−£6,744** with sensitive customers |
| **F10** Hiring | Pay only | Pay + employer on-costs (15% standard) + recruitment cost + start month + optional revenue from the hire with a ramp-up |
| **F10** New service | Raised **all** existing costs by a percentage; no launch cost | New sales carry their own cost of sales; extra overheads; one-off launch cost |
| Tax, VAT, loans, inflation | Not modelled ("Not included yet") | Optional business settings, applied to both sides of every comparison; each run says what was included |
| Financing decisions | Not available | New **"Take a Loan"** scenario. Judged on **net cash** (after debt), so borrowing alone never looks like an improvement |
| Rest of the current month | Skipped | Included at the normal rate; changes start from month 1 |
| Integrated statements | Cash and receivables checked | Also a **balance-sheet check** every month: change in assets − change in liabilities = profit |
| Horizon | 3–12 months | 3–**24** months, plus a **13-week weekly cash view** |
| Verdict when cash runs out either way | Not distinguished | Running out **later** counts as better (or a trade-off if it costs money); running out **sooner** is worse |

---

## 2. What changed

### 2.1 Baseline from reliable data (F8)

New module [baseline.py](../../backend/app/modules/scenario_intelligence/baseline.py). The page already built monthly history (`revenue_by_month`, `cost_of_sales_by_month`, `expenses_by_month`), but the server ignored it. It is now used:

- **Complete months only.** The month containing today, and any later month, is left out. Months with nothing recorded between the first month on record and the last complete month count as zero.
- **Level** for each of revenue, cost of sales and operating expenses:
  1. The **shared figure** when there is one. This is what the dashboard, risk check and Agent show (`agent/figures.py`, product rule R-4: one set of figures). See Section 3.
  2. Otherwise, the average of the last **3 complete months**.
  3. Otherwise, the monthly figure sent with the request, labelled as such.
- **Trend.** Least-squares slope over the last 12 complete months. It needs at least 6 months and is used only when **statistically significant** (|t| ≥ 2, about 95% confidence). It is **damped** (each month carries 0.9× the previous month's growth), the standard damped-trend form, so a short run of growth isn't projected forever.
- **Seasonality.** Classical ratio-to-moving-average indices by calendar month, only with **24+ complete months** (two full years).
- Every run reports the source, the months used, the trend and its t-statistic, and whether seasonality was applied (`summary.baseline`). It also says so in words in the assumptions.
- **Foreign-currency items with no exchange rate** used to be counted as zero silently. They are still left out, but now counted and disclosed (`excluded_fx_items`).

### 2.2 The rest of the current month

The projection opens on today's cash. Before, month 1 was next month and the 13 or so days left in this month didn't exist. Now that remainder is "period 0": sales and costs at the normal rate for the days left. Money due this month is collected or paid in it. Scenario changes start from month 1, so both sides share the same period 0. Month 1's cash and running profit include it, and the run says so.

### 2.3 Customers respond to price (F6)

Constant-elasticity demand, the standard form: volume × (1 + price change)^elasticity.
- The page asks for a positive **price sensitivity**: "sales fall X% for each 1% price rise". 1 is the standard moderate figure; published studies range from about 0.5 to 2.6.
- Cost of sales follows the volume sold.
- When the standard figure is used, the run says it was assumed.
- Phase 2 shows the result across a range of sensitivities.

### 2.4 Hiring and new services (F10)

- **Hire staff:** pay + employer on-costs (15% standard; typical range 10–25%), a one-off recruitment cost, a start month, and optional revenue per hire reaching full output over 3 months, with cost of sales at the current ratio. **Delay a hire** saves pay plus on-costs.
- **Launch new service:** extra revenue ramps over 3 months, with cost of sales at the current ratio. The cost uplift now applies to **operating expenses** (extra overheads), not to all existing delivery costs. An optional one-off launch cost falls in month 1.

### 2.5 Tax, VAT, loans, inflation, and a new loan scenario

These are **business settings**, set once on the Simulation page ("Tax, VAT, loans and inflation (optional)"). They are sent with every run and projection and stored with the run's snapshot. They apply to both sides of every comparison, so only the scenario differs between them.

| Setting | How it is modelled |
|---|---|
| Tax on profit | Set aside monthly on the running profit (losses reduce it, never below zero); paid in the month given, else shown as still owed |
| VAT / sales tax | Cash basis. Added to customer receipts, reclaimed on the stated share of costs, paid over a month after each period (quarterly unless set). Figures are taken as excluding VAT |
| Existing loan | Interest is a cost in profit. The principal repaid reduces cash only. Interest-only if no repayment is set |
| Cost inflation | Annual rate applied to costs that show no trend of their own (so it isn't counted twice) |

**Take a Loan** (new scenario): amount, rate, term and month received. Repaid in equal monthly instalments (standard annuity) from the next month.

**Judged on net cash.** The verdict now compares cash **less loans, tax and VAT still owed**. Borrowing raises cash, so judged on cash alone any loan would look "better". Now:
- A loan counts as better only when it keeps cash above zero, or keeps it there for longer.
- Otherwise, its cost (the interest) shows.

Sample from the evidence probe: a £50,000 loan for a healthy business shows cash **+£24,873** but net cash **−£3,319**, so the verdict is **worse**. Rules 1–2, whether cash runs out, still use actual cash, because a loan does prevent a shortfall.

### 2.6 Integrated model and checks

Every period now passes three checks, returned with each run (`checks`) and shown on the page:

```
cash(m)        = cash(m−1) + cash in(m) − cash out(m)
receivables(m) = receivables(m−1) + revenue(m) − collected(m)
Δ(cash + receivables) − Δ(bills owed + tax owed + VAT owed + loans) = profit(m)
```

The tests check all three for **72 combinations**: 2 businesses × 2 settings × 9 scenarios × with and without a date, each over 24 months.

### 2.7 Horizon and the 13-week view

- Horizons from 3 to **24** months.
- **13-week cash view:** weekly money in, money out and closing cash, with the lowest week highlighted. Money already owed is placed in the week it is due: the page now sends weekly due-date buckets. Regular receipts and costs are spread through each month; one-off amounts fall at the start of their month. The view checks itself (opening + in − out = closing).

### 2.8 Verdict refinement

A new rule (2a) applies when cash goes below zero both with and without the change:
- **Sooner** with the change → worse.
- **Later** with it → better, or "mixed" if it costs a material amount.

Sample: a £30,000 loan moves running out from month 2 to month 10, at a cost of £1,992 → **"mixed: time bought at a cost"**.

---

## 3. Coordination with other modules

The audit covered every module that reads or calls the simulation:
- **Backend:** Agent chat actions, Live Plan, business assistant, activation rules, the auth purge.
- **Frontend:** Simulation, Reports and Results pages, the shared figures and the report contracts.

| Module | What was checked / changed |
|---|---|
| **Shared figures (R-4)**, `agent/figures.py`, `sharedFigures.js` | Kept as the **one source** of the monthly level. The server now records where each shared figure came from (`figure_sources`), and the projection says so. History adds trend and seasonality only. `figures.py` itself is unchanged |
| **Live Plan**, `live_plan/service.py` `adopt_scenario` | **Pre-existing break, fixed.** Live Plan reads `revenue_monthly`, `gross_margin_pct`, `cash_runway_months` and `clients_count`, but the simulation never wrote them, so adopting a scenario **blanked** those plan targets. The simulation now writes them. Live Plan keeps an existing target when a scenario doesn't set one (a 4-line fix). Tested |
| **Agent**, `agent/chat_actions.py` | The chat answer and the run it saves to Simulation history now use **one date**, so both show the same figures |
| **Plans and credits** | "Take a Loan" needs Decision Engine or above on both the server (`scenario_minimum_plan`) and the page (`planAllowsScenario`). It is deterministic, so it is free, like other runs |
| **Business assistant, Reports, activation, purge** | They read run fields that are unchanged; the new detail lives in existing JSON columns. No change needed |
| **Database** | **No new columns.** Timeline rows keep exactly the same fields; the new detail (baseline, monthly breakdown, 13-week view) sits in `scenario_metrics.projection` / `baseline_metrics.projection` |

---

## 4. Verification

| Check | Result |
|---|---|
| Phase 1 hand-calculated tests (`tests/test_simulation_phase1.py`) | **104 passed** |
| Phase 0 tests (`tests/test_simulation_phase0.py`) | **69 passed**. 4 tests updated for the intended changes: a third check exists; price examples set "no response" explicitly to keep their Phase 0 arithmetic |
| Full backend suite (`tests/` and `test_multi_engine_e2e.py`) | **2,454 passed**, 9 failed, 4 skipped (see 4.1) |
| Frontend tests (Vitest) | **834 passed**, 6 failed. The same 6 as before Phase 0 (02-phase0-changes.md, Section 3.1). 2 new tests for the settings and checks helpers |
| Frontend production build | Builds successfully |
| Evidence probe | Matches the hand calculations; output saved |

### 4.1 Backend suite

Run from `backend/`, it collects `tests/` **and** the root-level `test_multi_engine_e2e.py`. Phase 0 ran `tests/` only, which is why that script didn't appear then.

- 2,454 passed = Phase 0's 2,351 + 103 Phase 1 tests at that point.
- **9 failures, none caused by Phase 1:**
  - **7** are the pre-existing failures listed in 02-phase0-changes.md, Section 3.1.
  - **2** are in `test_multi_engine_e2e.py`. They are `async` tests with no asyncio marker, so pytest can't run them. They fail the same way on the reverted original copy.
- One Phase 1 test and the shortfall-timing rule (Section 2.8) were added after this run. They are covered by the simulation tests (173 passed) and by the full run at the end of Phase 2 (04-phase2-changes.md).

**Something tried and reverted:** marking the e2e script for asyncio made it pass. But pytest-asyncio then closed the event loop, and 47 later activation tests failed with "There is no current event loop". Those tests pass on their own (53/53). The marker was removed and the script left as it was.

---

## 5. Known limits after Phase 1

- **Bad debts:** every invoice is assumed paid in full. This is stated with every run.
- **Exchange-rate movements** and **capacity limits** are not modelled, and every run says so.
- **Business settings** are kept on the device per business and stored with each run. Storing them on the business profile would let them follow the owner across devices; this is a team decision (it needs a field on the business record).
- **Shared revenue figure:** `agent/figures.py` averages **money received** over the last 92 days, including the current month. It is the product's single source, so the projection uses it as the level, but it is cash-basis and spans part-months. Moving it to complete months of earned revenue would make every module more accurate. That module's owner should decide, because the dashboard, risk check and Agent all read it.
- **Uncertainty** (ranges and sensitivity) comes in Phase 2; **accuracy against actual results** in Phase 3.

## 6. Behaviour changes users will notice

- Projections start from **today**: month 1's cash includes the rest of this month.
- The baseline may differ from the latest month's figures. The run says where it came from.
- A price rise now loses some sales; price-rise results are lower than before.
- Hiring costs more than pay alone. New-service launches no longer inflate all existing costs.
- New optional settings panel; new "Take a Loan" scenario; horizon up to 24 months; a 13-week cash table.
- "Checks passed" line under each result.
- Adopting a scenario into the Live Plan now sets revenue and margin targets, and no longer blanks the others.

## 7. Scorecard after Phase 1

| # | Criterion | Baseline | Phase 0 | Phase 1 |
|---|---|---|---|---|
| 1 | Cash projection follows correct accounting | ❌ | ✅ | ✅ (plus balance-sheet check) |
| 2 | Scenario effects from the business's own figures | ❌ / ⚠️ | ✅ | ✅ |
| 3 | All assumptions disclosed | ❌ | ⚠️ | ⚠️ (projection fully; validation defaults in Phase 2) |
| 4 | Missing data lowers confidence | ❌ | ⚠️ | ⚠️ (Phase 2) |
| 5 | Baseline from a reliable period (trend, seasonality) | ❌ | ❌ | ✅ |
| 6 | Real-world factors: tax, financing, working capital, price response, hiring costs | ❌ | ❌ | ✅ |
| 7 | Uncertainty shown | ❌ | ❌ | ❌ (Phase 2) |
| 8 | Metrics correctly defined and labelled | ⚠️ | ✅ | ✅ |
| 9 | Verdicts consistent and sensitive to material changes | ❌ | ✅ | ✅ (net cash; shortfall timing) |
| 10 | Every output traceable to its source data | ⚠️ | ⚠️ | ⚠️ (baseline sources shown; input labels in Phase 2) |
| 11 | Automated tests against hand-calculated cases | ❌ | ✅ | ✅ |
| 12 | Model documentation matches the code | ❌ | ⚠️ | ⚠️ (Phase 3) |
| 13 | One source of truth for figures | ⚠️ | ⚠️ | ⚠️ (shared figures kept as the level; report block in Phase 3) |
| 14 | Forecast accuracy measured against actuals | ❌ | ❌ | ❌ (backtest function ready; Phase 3) |

**Baseline 0 met / 4 partial → Phase 0: 5 met / 5 partial → Phase 1: 7 met, 5 partial, 2 not met.**

---

## Appendix: Files changed in Phase 1

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/baseline.py` | **New.** Complete-month baseline, significant damped trend, seasonality, backtest |
| `backend/app/modules/scenario_intelligence/projection.py` | Integrated model: period 0, price response, hiring/launch costs, tax, VAT, loans, inflation, balance check, 24 months, 13-week view, net-cash verdict, shortfall timing |
| `backend/app/modules/scenario_intelligence/schemas.py` | History, sources, weekly schedules, business settings; `take_loan`; do-nothing horizon to 24 |
| `backend/app/modules/scenario_intelligence/service.py` | Runs from today; new inputs and template; Live Plan fields |
| `backend/app/modules/scenario_intelligence/router.py` | Records where shared figures came from |
| `backend/app/modules/agent/chat_actions.py` | One date for the answer and the saved run |
| `backend/app/modules/live_plan/service.py` | Keeps targets a scenario doesn't set |
| `backend/tests/test_simulation_phase0.py` | 4 tests updated for intended changes |
| `backend/tests/test_simulation_phase1.py` | **New.** 104 tests |
| `frontend/src/lib/financialIntelligence.js` | Weekly due-date buckets; count of items with no exchange rate |
| `frontend/src/pages/SimulationPage.jsx` | Settings panel; new inputs and labels; net cash, checks and 13-week view; explanations corrected |
| `frontend/src/pages/SimulationImpact.test.js` | 2 new tests |
