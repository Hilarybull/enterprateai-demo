# Simulation Engine: Baseline Audit ("Before" State)

| | |
|---|---|
| **Date recorded** | 16 November 2026 |
| **Scope** | Scenario simulation (Simulation page), the multi-engine scores attached to each run, and the shared financial calculations it relies on |
| **Status** | Recorded **before any changes were made**. This is the reference point for measuring all later improvements. |
| **Evidence** | Reproducible probe: [evidence/baseline_probe.py](evidence/baseline_probe.py), output: [evidence/baseline_probe_output.txt](evidence/baseline_probe_output.txt) |
| **Original code** | Unchanged copies with SHA-256 fingerprints: [baseline-snapshot/](baseline-snapshot/) ([MANIFEST.txt](baseline-snapshot/MANIFEST.txt)) |

---

## 1. Purpose

Business owners use the simulation to decide things like hiring, pricing, cutting costs, or preparing for the loss of a client. For those decisions to be safe, the output must be:

- **Correct**: the arithmetic and accounting are right.
- **Traceable**: every figure can be traced to the business's own data, or is clearly marked as an estimate or assumption.
- **Honest about uncertainty**: ranges and confidence are shown, not just one precise-looking number.
- **Validated**: checked against hand calculations and, over time, against what actually happened.
- **Consistent**: the same figures appear everywhere in the product.

This document records how far the simulation met that bar when the work began.

---

## 2. Executive summary

The simulation **looks** sophisticated: it shows month-by-month cash, health labels, scores and several "engines". Underneath, there are several serious problems:

1. **A profitable business can be shown as heading for collapse.** In a controlled test, a business making £8,000 profit a month was projected to reach **−£42,000 cash** and labelled **"critical"**, only because a customer owed it £25,000. The same business with nothing owed was projected to grow to **+£78,000**.
2. **The engine scores are not calculated from the business.** Scenario score changes come from a fixed lookup table. A strong business and a struggling business get **exactly the same** score changes for the same scenario.
3. **Assumptions are applied without telling the user.** For example, every business is assumed to depend on one key person, have no documented processes and no backup staff.
4. **Important real-world factors are missing.** These include taxes, loans, seasonality, how customers react to price changes, and any range of uncertainty.
5. **The verdict can miss large changes.** A price rise that more than doubled profit was rated "neutral".
6. **There are no tests of the projection maths.**

**Conclusion:** at baseline, the simulation's output is **not dependable enough to base business decisions on**, and in some cases it could actively mislead.

---

## 3. How the simulation worked at baseline

### 3.1 Flow

```
Business records (invoices, expenses, contracts)        Idea-validation answers
              │  latest calendar month only                (fallback, labelled "Estimate")
              ▼                                                     │
   Baseline: revenue, cost of sales, expenses, cash  ◄──────────────┘
              │
              ▼
   Scenario applied (% or fixed amount change, short linear ramp)
              │
              ├──► Month-by-month projection (3–12 months): profit, cash, health label,
              │    stability score, three ratios
              │
              ├──► Verdict: "Improves / Reduces stability" (stability score moves ≥ 3 points)
              │
              └──► Multi-engine scores (survival, stability, growth, fragility, viability)
                   → attached to the run and used in reports
```

### 3.2 Components

| Component | Role | Original code |
|---|---|---|
| Baseline figures | Revenue, cost of sales and expenses from the **most recent calendar month** of records | [financialIntelligence.js L321–335](baseline-snapshot/frontend/src/lib/financialIntelligence.js#L321-L335) |
| Data fallback | Uses the owner's pricing answers when records are empty, labelled "Estimate" | [router.py L127–199](baseline-snapshot/backend/app/modules/scenario_intelligence/router.py#L127-L199) |
| Scenario maths | Applies the 10 scenario types | [service.py L613–688](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L613-L688) |
| Projection | Monthly cash and profit timeline | [service.py L691–873](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L691-L873) |
| "Do nothing" projection | Projection with no change | [service.py L1338–1487](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L1338-L1487) |
| Stability score | 0–100 score from hand-picked plus/minus points | [service.py L112–153](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L112-L153) |
| Health label | stable / tight / stress / at risk / critical, based on months of costs covered by cash | [service.py L175–198](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L175-L198) |
| Verdict | Improved / neutral / worse | [service.py L904–909](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L904-L909) |
| Multi-engine orchestration | Runs the engines and applies the scenario | [orchestration_service.py](baseline-snapshot/backend/app/modules/scenario_intelligence/orchestration_service.py), [orchestrator.py](baseline-snapshot/backend/app/engines/scenario/orchestrator.py) |
| Viability calculations | Margin, break-even, runway, 8-dimension weighted score | [calculations.py](baseline-snapshot/backend/app/modules/idea_validation/calculations.py) |

### 3.3 Scenarios offered

Loss of largest client · Revenue drop · Cost increase · Price increase · Hire employees · Add a contractor · Reduce fixed costs · Delay a hire · Launch a new service · Delayed payments · Do nothing.

### 3.4 Factors considered

| Considered | Not considered |
|---|---|
| Monthly revenue | Taxes: VAT/sales tax timing, corporation tax |
| Cost of sales | Employer payroll costs (national insurance, pension), recruitment costs |
| Operating expenses | Loans, repayments, interest, overdraft |
| Starting cash | Inventory / stock |
| Receivables and payables schedules | Capital spending and depreciation |
| Payment terms, sales cycle (for ramp length only) | Seasonality and underlying trend |
| Largest client's share, number of clients | Inflation |
| Capacity utilisation | Customer response to price (price elasticity) |
| | Customer churn, acquisition cost |
| | New-hire ramp-up to full productivity |
| | Any range or uncertainty (all outputs are single figures) |
| | Data quality / confidence of the inputs |

### 3.5 Metrics produced

Monthly revenue, cost of sales, expenses, gross profit, gross margin %, net profit, cumulative profit, cash balance, cash runway (months), stability score (0–100), health label, cash conversion ratio, receivable exposure ratio, delayed revenue %, and the five engine scores (viability, survival, stability, growth, fragility index) with a scenario ranking score.

---

## 4. Findings

Severity: **Critical** = can produce a materially wrong conclusion · **High** = significant distortion or unsupported figure · **Medium** = weakness that reduces reliability.

### F1. Money owed to the business is never collected, so profitable businesses appear to be failing (Critical)

- **What happens:** Any outstanding customer invoices are turned into a permanent "delayed" slice of **every** month's revenue. That slice is scheduled to arrive at least 6 months later, so within a 6-month projection it never arrives. Separately, invoices already owed to the business are explicitly excluded from cash, while bills the business owes **are** paid.
- **Evidence (E1):** a business with £20,000 revenue, £12,000 costs, £30,000 cash and one £25,000 invoice due to it:

  | Month | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|
  | Profit | 8,000 | 8,000 | 8,000 | 8,000 | 8,000 | 8,000 |
  | Cash, **with** invoice owed | 18,000 | 6,000 | **−6,000** | −18,000 | −30,000 | **−42,000** |
  | Label | stress | at risk | **critical** | critical | critical | critical |
  | Cash, **nothing** owed | 38,000 | 46,000 | 54,000 | 62,000 | 70,000 | **78,000** |

  The gap between the two is £120,000. Being owed money makes the business look worse than being owed nothing.
- **Further sign:** code comments refer to one specific user's figures ("£24,887", "USER RULE", "Surgically Calibrated"). This suggests the logic was tuned to make one case look a certain way, rather than built on general accounting rules.
- **Where:** [service.py L731–800](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L731-L800), [service.py L1353–1411](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L1353-L1411)

### F2. The "Delayed payments" scenario repeats a one-off delay every month (High)

- The selected invoice amount is treated as a **monthly** delayed amount, not a single invoice paid late. This overstates the effect of late payment.
- **Where:** [service.py L757–799](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L757-L799)

### F3. Engine score changes come from a fixed table, not from the business (Critical)

- The orchestrator does not recalculate the engines under the scenario. It adds fixed points from a table (e.g. a 10% price rise always adds +6 viability, +8 survival, +3 stability, +4 growth, −6 fragility).
- **Evidence (E3):** a strong business and a weak business received **identical** score changes for the same scenario.
- The supporting document ([ENGINES_IMPLEMENTATION.md](baseline-snapshot/backend/ENGINES_IMPLEMENTATION.md)) says the system will "recompute all engines with modified state". The code does not do this.
- These scores are passed into reports.
- **Where:** [orchestrator.py L112–255](baseline-snapshot/backend/app/engines/scenario/orchestrator.py#L112-L255)

### F4. Assumptions are applied without disclosure (High)

- **Every** business is assumed to have key-person dependency, no documented processes and no backup personnel. These inputs lower its stability and fragility scores.
- Capacity utilisation defaults to 60% and client count defaults to 1 when unknown.
- Viability is **never calculated** in scenario runs (no inputs are passed), so it always takes the default of 50.
- Growth receives no data and runs on its own defaults.
- Fixed costs are calculated as expenses minus cost of sales, but expenses already exclude cost of sales.
- **Where:** [orchestration_service.py L76–172, L223](baseline-snapshot/backend/app/modules/scenario_intelligence/orchestration_service.py#L76-L172)

### F5. Missing data is scored as acceptable instead of reducing confidence (High)

- Unknown client concentration scores 75/100, unknown capacity 60/100, unknown cashflow volatility 50/100. The default 14-day payment terms score 85/100.
- Because of this, a business with little data can score better than one with honest but imperfect data. Users are not told how much of a score rests on defaults.
- **Where:** [calculations.py L303–456](baseline-snapshot/backend/app/modules/idea_validation/calculations.py#L303-L456), [survival/engine.py L91–101](baseline-snapshot/backend/app/engines/survival/engine.py#L91-L101)

### F6. Price changes ignore customer response (High)

- Raising prices never loses any sales. **Evidence (E2):** +50% price takes revenue from 20,000 to 30,000 and profit from 8,000 to 18,000, with no change in volume.
- This makes price increases look risk-free.
- **Where:** [service.py L644–653](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L644-L653)

### F7. The verdict can miss large changes and judges scenarios inconsistently (High)

- The verdict depends only on the stability score, which is built from coarse plus/minus points. **Evidence (E2):** the +50% price scenario more than doubled profit, yet the stability score stayed at 80 → verdict **"neutral"**.
- Client loss and revenue drop are judged at month 12, all other scenarios at month 1.
- The thresholds and point values have never been calibrated against real business outcomes.
- **Where:** [service.py L112–153](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L112-L153), [service.py L585–588](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L585-L588), [service.py L904–909](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L904-L909)

### F8. The baseline rests on a single, possibly unfinished month (High)

- Monthly revenue and costs are taken from the **latest calendar month only**. If that month is still in progress, the baseline is understated. One unusual month distorts every projection.
- Foreign-currency items with no available exchange rate are counted as **zero**, with no warning.
- **Where:** [financialIntelligence.js L216–223, L321–335](baseline-snapshot/frontend/src/lib/financialIntelligence.js#L321-L335)

### F9. "Break-even months" is not a time (Medium)

- The figure labelled `break_even_months` is break-even units divided by monthly units. **Evidence (E4):** a business that is profitable from its first month shows "0.67 break-even months". The value is a ratio, not a time.
- **Where:** [calculations.py L205–212](baseline-snapshot/backend/app/modules/idea_validation/calculations.py#L205-L212)

### F10. Hiring and new-service scenarios are oversimplified (Medium)

- Hiring adds salary only. There are no employer on-costs, no recruitment cost, no ramp-up period and no extra capacity or revenue from the hire.
- New-service launch raises **all existing** costs by a percentage, with no launch investment.
- **Where:** [service.py L660–686](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L660-L686)

### F11. No uncertainty is shown (Medium)

- Every output is a single precise figure. There is no low/base/high range, no sensitivity analysis and no confidence rating, so users may read forecasts as more certain than they are.

### F12. Engineering quality (Medium)

- **No tests** of the projection maths, the scenario logic or the engines' numerical outputs.
- Errors in the multi-engine run are silently swallowed. A failed run simply has no engine output.
- One function is defined twice, the first copy empty ([service.py L165–175](baseline-snapshot/backend/app/modules/scenario_intelligence/service.py#L165-L175)).
- Some figures are computed separately in the browser and in the server, which risks them disagreeing.
- The working copy has no version-control history (`.git`), so changes cannot be tracked or reviewed.

---

## 5. Baseline scorecard

Each criterion will be re-scored after the work so the two can be compared side by side.

| # | Criterion | Baseline rating |
|---|---|---|
| 1 | Cash projection follows correct accounting (money in/out on actual due dates) | ❌ Not met |
| 2 | Scenario effects calculated from the business's own figures | ❌ Not met (engine scores) / ⚠️ Partial (timeline) |
| 3 | All assumptions disclosed to the user | ❌ Not met |
| 4 | Missing data lowers confidence rather than being filled with favourable defaults | ❌ Not met |
| 5 | Baseline built from a reliable period of data (trend, seasonality) | ❌ Not met |
| 6 | Real-world factors covered: tax, financing, working capital, price response, hiring costs | ❌ Not met |
| 7 | Uncertainty shown (ranges, sensitivity, confidence) | ❌ Not met |
| 8 | Metrics correctly defined and labelled | ⚠️ Partial |
| 9 | Verdicts consistent and sensitive to material changes | ❌ Not met |
| 10 | Every output traceable to its source data | ⚠️ Partial (estimate label only) |
| 11 | Automated tests against hand-calculated cases | ❌ Not met |
| 12 | Model documentation matches what the code does | ❌ Not met |
| 13 | One source of truth for figures across the product | ⚠️ Partial |
| 14 | Forecast accuracy measured against actual results | ❌ Not met |

**Baseline result: 0 of 14 met, 4 partial.**

---

## 6. Target standard

The intended state draws on recognised practice in financial modelling and model governance:

- **Financial modelling standards** (e.g. the FAST Standard, ICAEW Financial Modelling Code): clear separation of inputs, calculations and outputs; consistent time periods; built-in checks.
- **Integrated three-statement modelling**: profit and loss, cash flow and balance sheet that always reconcile.
- **Direct-method cash forecasting**, including a 13-week short-term cash view.
- **Model risk management** (in the style of SR 11-7): documentation, independent validation, testing and ongoing performance monitoring.

## 7. Planned transformation (summary)

| Phase | Focus | Key outcomes |
|---|---|---|
| **0** | Stop misleading output | Fix F1, F2, F3, F4, F7, F9. Hide or remove unsupported scores. Set up the hand-calculated test harness. |
| **1** | Sound model | Integrated monthly model that balances; working capital from real collection/payment timing; tax, payroll on-costs, financing; trend and seasonality baseline; driver-based scenarios; 12–24 month horizon and 13-week cash view. |
| **2** | Trust and transparency | Low/base/high ranges; sensitivity; a label on each input (recorded, estimated or default); data-confidence rating; assumptions shown with every result; standard KPIs. |
| **3** | Validation and governance | Hand-calculated and invariant tests; backtesting forecast accuracy against actual results; versioned model documentation and change log; single source of truth. |

Progress against each phase will be recorded in follow-up documents in this folder, with the scorecard in Section 5 re-assessed at the end.

---

## Appendix A: Reproducing the evidence

From the repository root:

```
python -I docs/simulation-audit/evidence/baseline_probe.py backend
```

The probe runs the original calculation code on fixed sample businesses. Database and AI modules are replaced with empty stand-ins, so no credentials are needed and no data is read or written. Results at baseline are saved in [evidence/baseline_probe_output.txt](evidence/baseline_probe_output.txt).

## Appendix B: Baseline code snapshot

The files examined were copied unchanged into [baseline-snapshot/](baseline-snapshot/) on 16 November 2026. [MANIFEST.txt](baseline-snapshot/MANIFEST.txt) lists each file's SHA-256 fingerprint, which proves the copies match the code as it was found.
