# Simulation Model Specification

| | |
|---|---|
| **Model** | EnterprateAI scenario simulation: cash and profit projection, verdict, uncertainty, accuracy tracking |
| **Version** | `projection-1.9` (stamped on every run as `summary.model_version`); engine `scenario_intel_v2.1` |
| **Code** | `backend/app/modules/scenario_intelligence/`: `records.py` (inputs from the records), `baseline.py`, `projection.py`, `factors.py` (country rules), `explain.py` (how each figure was calculated), `quality.py` (data check), `uncertainty.py`, `accuracy.py`, `monitoring.py` (accuracy across businesses), `standards.py` (register of standards), `model_info.py`, `service.py`, `router.py` |
| **Tests** | `backend/tests/test_simulation_phase0.py` … `test_simulation_phase7.py` (1,114 tests, run by the release gate); frontend `SimulationFirstRun`, `SimulationPhase5`, `SimulationPhase6`, `SimulationAccuracyAdmin` tests |
| **Status** | Specification of the code as of 21 November 2026 (Phase 7). A change to the model must change this document and pass the release gate (Section 10) |

---

## 1. Purpose and scope

The model answers: *"What happens to my profit and cash over the next N months if I make this change, compared with
making no change, and how sure is that?"*

It is a **monthly, deterministic, driver-based model** of one business. It produces:
- a month-by-month profit and cash projection that reconciles every month
- a verdict against doing nothing
- a range, sensitivity and confidence
- standard KPIs
- a 13-week cash view
- a record of what it forecast, so its accuracy can be measured later

It is **not** a valuation or a tax calculation. Its revenue and cost ranges are 90% forecast ranges (Section 8.1); the
verdict itself is deterministic.

## 2. Inputs and their precedence

| Input | Source, in order of precedence |
|---|---|
| Monthly revenue, operating expenses | 1. The shared figure (`agent/figures.py`, the one the dashboard, risk check and Agent show), labelled with its source · 2. average of the last 3 **complete** months of history · 3. the figure sent with the request · 4. the owner's pricing answers, labelled **estimate**, only when nothing is on record |
| Monthly cost of sales | History (complete months), else the figure sent |
| Trend, seasonality | Monthly history (complete months only) |
| Cash today | The shared figure, else the figure sent |
| Money owed to / by the business | Unpaid invoices, contracts and expenses by due month, and by due week for the 13-week view |
| Customer payment terms | The customers' recorded terms (average), else **30 days, assumed** |
| Tax, VAT, loans, cost inflation | Business settings entered by the owner; not modelled when blank |
| Country (payroll rules) | Business settings, else the workspace profile's country (1.4) |
| Funding, drawings, dividends, equipment, bad debts, payroll, tax losses | Business settings entered by the owner; not modelled when blank (1.4) |
| Salaries already in recorded expenses | Business settings; else **yes** when any paid expense in the last 92 days is in a payroll category (1.4) |
| Direct costs | When invoices carry no product costs: expenses in direct-cost categories over the last 92 days, as a share of the shared monthly costs, are cost of sales; the shared figure is split, not added to (1.4) |
| Scenario inputs | Entered by the owner; documented standard figures where noted (Section 6) |

Every input is returned with its label and source (`uncertainty.inputs`, Section 8.3).

### 2a. Inputs from the business's records (1.5, `records.py`, applied in `router._phase5_from_records`)

The owner enters invoices, expenses, customers and settings elsewhere in EnterprateAI; the simulation reads them so nothing
is entered twice, and the Simulation page, the Agent's scenario card and every other caller get the same inputs.

| Input | Rule |
|---|---|
| Monthly histories | **Revenue** by invoice date, excluding VAT (`subtotal_amount`); drafts, cancelled and void invoices are not sales (accrual basis). **Cost of sales** each month = the larger of the invoices' product costs and the expenses in direct-cost categories. **Running costs** = the other expenses, by expense date (`date`, `expense_date`, …), excluding any recorded VAT amount. These replace the histories the page sends |
| Payment time | **Days sales outstanding**: amount-weighted average of (payment date − invoice date) for invoices paid in the last 12 months, at least 3 of them; else the amount-weighted terms on the invoices; else none (30 days assumed and said). Replaces the page's figure |
| VAT | Amount-weighted VAT rate on the last 12 months' invoices; share of costs with VAT from the expenses. Only when the owner has not set VAT |
| Country, salaries in expenses | From the workspace profile and the expenses, only when the owner has not set them |
| Monthly revenue level | The shared figure, unless it differs from the last 3 complete months' average by more than the business's 90% forecast range (Section 8.1); then the complete months are used and the reason is shown (`figure_notes`) |
| Running costs level | The shared costs figure less its direct-cost share (Section 5.4a); cost of sales level = the larger of that share and the product costs |
| This month so far | Revenue and costs dated this month in the records (`current_month_recorded`) |

Owner-entered settings always take precedence over anything worked out from the records.

## 3. Time

- **Period 0** is the rest of the current month (days after today, at the normal monthly rate). Months 1…N are full calendar months after today. N is 3 to 24.
- **The current month** (1.5, `summary.current_month`): recorded so far (from the records) + the rest of the month (period 0) = the month's total; cash from today's balance to the month's end. Shown as the first row of the timeline.
- Scenario changes start in month 1; period 0 is the same with and without the change.
- Money due this month or overdue is collected or paid in period 0 (month 1 when no date is given).
- Without a date (direct calls, tests), there is no period 0 and the monthly figures are used flat.

## 4. Baseline (`baseline.py`)

For each series (revenue, cost of sales, operating expenses):

- **Complete months only**: the month containing today and later months are excluded. Gaps between the first month on record and the last complete month count as 0.
- **Seasonality** (24+ complete months, **and only if significant**): first the F-test for stable seasonality (as in the US Census Bureau's X-11 / X-13ARIMA-SEATS): every complete month divided by a straight-line trend through the whole series (by the mean if that line is not positive throughout), then a one-way analysis of variance by calendar month; applied only if p < 0.01 (`SEASONAL_ALPHA`). Then classical ratio to the centred 2×12 moving average, by calendar month, normalised to mean 1. The series is deseasonalised before the level and trend are measured. The test and its result are reported (`seasonality_test`). (1.3)
- **Level**: the source in Section 2. A shared figure is deseasonalised by the average index of the last 3 months.
- **Trend**: least-squares slope over the last ≤12 complete months (6 or more needed). Applied only if |t| ≥ 2. Damped with φ = 0.9.
- **Value in projection month m**: `(level + slope × Σ_{k=1..m+2} φ^k) × seasonal index(calendar month)`, never below 0. The `m+2` is the distance from the centre of the 3-month average.
- **Cost inflation** (setting, % a year): costs × (1+i)^(m/12), only for cost series with no trend applied.

## 5. Projection (`projection.py`)

### 5.1 Identities checked in every period

```
cash(p)        = cash(p−1) + cash_in(p) − cash_out(p)
receivables(p) = receivables(p−1) + revenue(p) × (1 − bad debt share) − collected(p)
Δ(cash + receivables + equipment) − Δ(bills owed + tax owed + VAT owed + loans) = profit(p) + owner money in(p) − owner money out(p)
```
Owner money in = equity investment + owner capital; owner money out = drawings + dividends (1.4).

Returned as `checks.cash_reconciles`, `checks.receivables_reconcile` and `checks.balance_sheet_balances`, and shown on the page.

### 5.2 Timing

- **Collections:** a month's sales are collected after the payment terms. The fraction of a month is split: lag = terms / 30; ⌊lag⌋ months later gets 1 − frac, the month after gets frac.
- **Costs** are paid in the month incurred. **Bills already owed** are paid when due. Amounts beyond the horizon stay owed.

### 5.3 Profit

```
profit before tax = revenue + grants − cost of sales − operating expenses (incl. payroll) − interest − depreciation − bad debts
taxable to p      = cumulative profit before tax to p − tax losses brought forward
tax set aside(p)  = flat rate × max(0, taxable to p) − set aside to p−1
  UK bands (1.4): rate = UK tax(A) / A, with A = taxable to p × 12 / months elapsed, applied to max(0, taxable to p)
profit            = profit before tax − tax set aside
```

Timeline rows show `expenses` = operating expenses + interest + tax set aside, so that `costs` = expenses + cost of sales and profit = revenue − costs. The breakdown is in `summary.monthly_detail`.

### 5.4 Business settings

| Setting | Treatment |
|---|---|
| Tax on profit | As 5.3. Paid in `tax_payment_month`, else owed at the end |
| VAT / sales tax | Cash basis. Output VAT = rate × collections. Input VAT = rate × share × (cost of sales + operating expenses + bills paid). Net paid one month after each period of `sales_tax_period_months` (default 3). Figures are taken as excluding VAT |
| Existing loan | Interest = balance × rate / 12 (a cost). Principal = repayment − interest (cash only). Interest-only if no repayment is set |

### 5.4a Further factors (1.4, `factors.py` and `project`)

| Factor | Treatment |
|---|---|
| Funding events | `{type, amount, month}`. Equity and owner capital: cash in that month, not income or a loan. Grants: cash in and income that month (IAS 20) |
| Owner drawings | Cash out every month from month 1. Not a cost |
| Dividends | `{amount, month}`: cash out. Not a cost |
| Equipment | `{amount, month, life_months}` (life 36 when blank): cash out in its month; depreciation amount ÷ life a month from that month for `life` months (IAS 16, straight line); its net value is an asset |
| Bad debts | A share of each month's sales is never collected: a cost that month; collections and money owed are on the rest |
| Payroll | Staff × (gross pay + employer costs per person), added to operating expenses, unless salaries are already in the recorded expenses |
| Employer costs per person | UK: 15% NI above £5,000 a year; pension 3% of qualifying earnings £6,240–£50,270 a year. Nigeria: pension 10%, NSITF 1%, ITF 1% of pay. US: FICA 7.65%, FUTA 0.6% on the first $7,000 a year (state unemployment not included). Other countries: 15% (standard figure). An entered pension % replaces the minimum. Rates for the 2025/26 tax year. Each person's monthly employer costs are rounded to the penny |
| UK corporation tax | 19% up to £50,000; 25% from £250,000; between, 25% less 3/200 × (£250,000 − profit). No associated companies |
| Hiring | Employer on-costs: as entered; else, with a known country, that country's employer costs on the hire's pay; else 15% |

### 5.5 Scenario rules (applied from month 1)

| Scenario | Rule |
|---|---|
| Client loss / revenue drop | Revenue and cost of sales × (1 − loss% × progress). Ramp: the sales cycle in months (1–3; at least 2 for client loss) |
| Price change | Price factor P = 1 + change × progress (ramp 1–2 months). Volume factor q = P^elasticity. Selected share s of revenue: revenue = R(1−s) + R·s·P·q; cost of sales = C(1−s) + C·s·q |
| Cost increase | Operating expenses and cost of sales × (1 + inc × progress), 2-month ramp |
| Reduce fixed costs | Operating expenses × (1 − red × progress), 2-month ramp |
| Hire staff | From the start month: + n × pay × (1 + on-costs). Recruitment n × cost in the start month. Optional revenue n × r × min(1, (m − start + 1)/ramp), with cost of sales at the current ratio |
| Delay a hire | Operating expenses − n × pay × (1 + on-costs), from month 1 |
| Add a contractor | Cost of sales + n × cost |
| Launch a service | Extra revenue = R × uplift × min(1, m/3), with cost of sales at the current ratio. Operating expenses × (1 + overheads uplift × progress). Launch cost in month 1 |
| Payment delay | Selected invoices: that amount, earliest due first, moves N months later, once. No selection: every collection from now on moves N months later |
| Take a loan | Amount received in the start month. Annuity A = L·i / (1 − (1+i)^−n) from the next month; interest is a cost, principal is cash only |
| Raise investment (1.4) | A funding event `{funding_type, funding_amount, funding_month}` (as 5.4a). The verdict says when cash is higher because of new investment or owner capital rather than earnings |
| Buy equipment (1.4) | An equipment purchase `{equipment_cost, purchase_month, useful_life_months}` (as 5.4a), plus from that month extra sales (cost of sales at the current ratio) and running costs saved, as entered. Low / high cases: those benefits × 0.5 / × 1.25 |

## 6. Standard figures (documented defaults)

Each is disclosed when used. Phase 2 tests the result across the range shown.

| Figure | Value | Basis | Range tested |
|---|---|---|---|
| Customer payment terms | 30 days | Common invoice terms | +15 days |
| Price sensitivity (−elasticity) | 1.0 | Moderate response; published studies about 0.5–2.6 | ×2 or +0.5 / ÷2 |
| Employer on-costs | 15% when the country is not covered; otherwise the country's rules (5.4a) | Typical employer tax, pension and benefits, 10–25% across the UK, Nigeria and the US; country rates from HMRC, The Pensions Regulator, PenCom/NSITF/ITF and the IRS (REFERENCES.md) | 10% / 25% |
| Equipment life | 36 months when blank | Common useful life for small-business equipment | — |
| New hire ramp-up | 3 months | Standard onboarding assumption | Hire revenue ×0.5 |
| VAT period | 3 months | Quarterly returns | — |
| Revenue swing (no history) | 15% | Conservative for small businesses | ± |
| Cost swing (no history) | 10% | Costs are steadier than sales | ± |

## 7. Verdict (`compare_projections`)

The scenario against the same business with no change, same months, same settings. **Material** means more than 1% of the baseline's revenue over the period (of its costs when there is no revenue). **Net cash** means closing cash less loans, tax and VAT still owed.

"Below zero" is judged over the months ahead (month 1 onwards), where a scenario can make a difference; cash already below zero today is reported separately (`cash_below_zero_today`) and named in the reason. (1.3)

1. The scenario takes cash below zero where the baseline doesn't → **worse**.
2. The scenario keeps cash above zero where the baseline doesn't → **improved**.
3. Both run short:
   - the scenario sooner → **worse**;
   - the scenario later → **improved**, or **mixed** if profit or net cash is materially lower.
4. Profit or net cash materially lower, neither materially higher → **worse**.
5. Profit or net cash materially higher, neither materially lower → **improved**.
6. One higher, one lower → **mixed** (a trade-off).
7. Otherwise → **no material change**.

## 8. Uncertainty and transparency (`uncertainty.py`)

### 8.1 Range

- **Low case**, all adverse together: revenue × (1 − revenue range), with cost of sales following; operating expenses × (1 + cost range); payment terms +15 days; the scenario's own estimates at their adverse value.
- **High case**: the favourable equivalent, with payment terms unchanged.
- **Revenue and cost range** (1.3, `forecast_swing`): a 90% forecast range for the series over the projection, as a share of its level: `1.645 × 1.4 × √(σ²/3 + σ²/H + (se_b·s̄/L)² + (|b|·(ū − s̄)/L)² [+ σ²/years if seasonal])`, where σ is the relative standard deviation of the last ≤12 complete months around their trend (around the mean with under 6), after removing a significant seasonal pattern; 3 = months in the level; H = projection months; b and se_b = the trend slope and its standard error; s̄ and ū = the mean damped and undamped slope-months carried over the horizon; L = the mean. Within 3–50%. 15% (revenue) and 10% (costs) with under 3 months. The factor 1.4 (`RANGE_CALIBRATION`) was set on one mock set (90.6% coverage) and confirmed on a separate holdout set (94%): 07-phase4-changes.md.
- The verdict is recomputed in each case. It is **robust** if all three agree.
- Revenue and costs move by 90% ranges; payment timing and the scenario's estimates move with them, so the whole range is described as cautious rather than as an exact probability.

### 8.2 Sensitivity

Each driver is moved on its own: revenue, operating expenses and cost of sales by ±10%, payment ±15 days, and the scenario's own estimate. Reported as the swing in the net cash change against doing nothing, largest first.

### 8.3 Input labels

recorded · shared figure · from your history · estimate · entered by you · standard figure · country rules (1.4) · assumed · not set / none recorded.

### 8.4 Confidence

| Factor | Points |
|---|---|
| Sales history | 12+ months: +2 · 6–11: +1 · 3–5: 0 · under 3: −1 |
| Revenue from an estimate | −2 |
| No revenue on record | −2 |
| No costs on record | −2 |
| Payment terms assumed | −1 |
| Items left out (no exchange rate) | −1 |
| Standard figures used | −1 |
| Revenue forecast range wider than ±20% / ±35% (1.3) | −1 / −2 |

2 or more points = **high**, 0–1 = **medium**, below 0 = **low**.

### 8.5 KPIs

Gross margin, operating margin, net margin over the period, average monthly cash flow, burn, runway, days sales outstanding, break-even revenue, margin of safety, interest cover and net cash. The definitions are returned with the values.

### 8.7 How each figure was calculated (1.5, `explain.py`)

Every run carries `summary.how_calculated`:
- **Starting point**: each series' level with its source and months, the trend with its t-statistic (applied or not, and why), the seasonality test (F, p), the payment time and its source, and any note on figures.
- **Month by month**: revenue = level + trend × damped months (× seasonal index) (then the scenario's change); costs = cost of sales + running costs + payroll + depreciation + sales not collected + interest + tax set aside = total, profit = revenue (+ other income) − costs; cash = opening + collected + loans / investment / grants − costs paid − bills, repayments, tax, VAT, equipment, drawings = closing. "Costs paid" is the balancing amount, so every line adds up exactly to the closing cash (tested on random businesses).
- **Methods and standards**: each method in plain words with its standard (FAST / ICAEW, least squares and t-test, Gardner & McKenzie damped trend, X-11/X-13 seasonality test, IAS 7, IAS 16, IAS 20, HMRC and country rules, SR 11-7).

### 8.8 Data check (1.6, `quality.py`)

Every run carries `summary.data_quality`: issues with a severity (serious / warning / info), what was found,
why it matters and how to fix it. Checks: under 3 complete months (serious), under 12 (info); months with no sales between
the first and the last (warning); **unusual months** by the modified z-score 0.6745 × (value − median) / MAD above 3.5
(Iglewicz & Hoaglin, 1993); sales but no costs, in levels or history (serious); no cash on record; possible duplicate
invoices (same customer, amount, date) and expenses; uncategorised, undated and future-dated records; items in another
currency left out; a horizon over twice the history. Each serious issue lowers confidence by one point, up to two.

### 8.9 Combined scenarios (1.6)

`scenario_type = "combined"` with `params.steps = [{scenario_type, params}, …]` (up to 5; price change, cost increase,
reduce fixed costs, hire, delay a hire, contractor, launch, client loss, revenue drop, payment delay, loan, investment,
equipment). Monthly figures: each step is applied in turn to the figures the previous step left. Payment delay, loan,
funding and equipment are taken from their steps. The range moves each step's own estimates; assumptions are listed per step.

### 8.10 Saved runs: reproduce, compare, model notices (1.6)

A saved run keeps its full input snapshot (`baseline_snapshot`: the state with the records' figures and the settings), the
scenario and its inputs, the date (`as_of`) and the model version. `POST …/scenario-runs/{id}/reproduce` runs it again from
those and reports whether closing cash, profit and the verdict are identical (they must be with the same version), or what
changed in the model since (`model_info.CHANGES`). `POST …/compare` puts 2–6 runs side by side. `GET …/model` gives the
version and the changes, so the page marks runs made with an earlier model.

### 8.6 Idea Validation (feasibility rubric v0.5, standard engine 3.1)

A dimension whose inputs were not given is **not assessed**: `None`, with the reason. The weights of the assessed dimensions are re-scaled to sum to 1. Coverage is the assessed weight as a share of the total (high ≥ 85%, medium ≥ 60%, else low).

## 9. Validation

| Layer | What | Where |
|---|---|---|
| Hand-calculated cases | Every rule above, with the arithmetic in the test's comment | `test_simulation_phase0.py` (69), `phase1` (104), `phase2` (21), `phase4` (19) |
| Accounting identities | All three checks, every period, 72 fixed combinations | `phase1` |
| Invariants on random inputs | 300 random businesses and scenarios (fixed seed): identities, determinism, 13-week reconciliation | `phase3` |
| Properties | +cash today = exactly +cash later; more revenue never lowers pre-tax profit; more costs never raise profit; a 0% change is no change | `phase3` |
| Backtest | The baseline method re-run on the business's own last 3 complete months, with WAPE and bias against the naive method | `baseline.backtest`, shown on the page |
| Tracked accuracy | Each run stores `forecast_by_month`. Completed months are compared with recorded revenue (the scenario's forecast if accepted, else the no-change one) | `accuracy.py`, `POST /v1/scenario-intelligence/accuracy` |
| Evidence probes | The same sample businesses before and after each phase | `evidence/` |
| Independent replication | The model rebuilt from this document alone (shadow model) and compared on 400 projections and 300 baselines | `evidence/independent_review/compare.py` |
| Mock production (release check) | 200 businesses with a known future, expected results fingerprinted before the run; plus a separate 200-business holdout set | `evidence/mock_production/evaluate.py`, `holdout/evaluate_holdout.py` |

### Accuracy across businesses (Phase 7, `monitoring.py`, admin: `GET …/admin/accuracy`, Admin → Simulation accuracy)

Every saved run whose forecast months have completed is compared with the business's recorded revenue (records.py):
pooled WAPE and bias, by model version, by confidence level (high must be the most accurate: "confidence ordered"), and
range coverage (share of runs whose actual revenue fell inside their 90% revenue range). Alerts when the thresholds
below are crossed, coverage is under 80% (10+ runs), or confidence is not ordered.

### Standards register and release gate (Phase 7)

`standards.py` lists every rate, threshold and default with its code constant, source, evidence level (published,
calibrated, practice, own choice) and review date; a test checks each value equals the code. `scripts/simulation_release_gate.py`
runs the simulation tests, the independent replication, the mock production and holdout runs against their pre-set marks,
and the annual review of the register; `.github/workflows/simulation-release-gate.yml` runs it on every change to the simulation.

### Monitoring thresholds (for the model owner)

Review the model when either of these holds over at least 6 completed months across businesses:
- tracked revenue **WAPE above 25%**, or
- **bias outside ±10%**.

Review it also if the backtest is worse than the naive method for most businesses. These are starting thresholds; adjust them once real tracked data exists.

## 10. Change control

Any change to a formula, default or rule must (the release gate checks 4 and 5):
1. Increase `MODEL_VERSION` in `projection.py`. Runs store it, so old and new results can be told apart.
2. Add a change-log entry below.
3. Add or update a hand-calculated test.
4. Pass the full simulation suites (Section 9) and the backend and frontend suites.
5. Rerun the evidence probes if their figures change.
6. Update this document.

## 11. Known limits

- Bad debts are modelled only when the owner enters a share (1.4); otherwise every invoice is assumed paid in full.
- Payroll: one average pay per person; employment allowance, apprenticeship levy, US state unemployment insurance and wage caps are not applied. Employer NI and pension are paid in the month (not the month after). VAT on equipment is not modelled. Dilution from equity is not costed.
- Exchange-rate movements and capacity limits are not modelled.
- Revenue and cost ranges are calibrated on mock data (07-phase4-changes.md); they should be recalibrated from tracked accuracy once real data exists. The confidence points are a transparent rule, checked on mock data but not yet on real outcomes.
- The trend uses the last 12 months: it reacts to sudden changes but misses some slow growth (growing businesses under-forecast by 3–6% in the mock runs). The range covers this. A longer window was tested and rejected (07, Section 3).
- Business settings are kept per device and stored with each run, not yet on the business profile.
- The shared revenue figure (`agent/figures.py`) is money received over 92 days, including the current month. It is the product's single source; changing it is for that module's owner (see 03-phase1-changes.md, Section 5).

## 12. Change log

| Version | Date | Change |
|---|---|---|
| (baseline) | before 16 Nov 2026 | Original engine: see 01-baseline-findings.md (findings F1–F12) |
| `projection-1.0` | 16 Nov 2026 | Phase 0: roll-forward cash with collections; one-off delays; verdict against doing nothing with 1% materiality; engines on real data only; break-even as margin of safety |
| `projection-1.1` | 17 Nov 2026 | Phase 1: complete-month baseline with significant damped trend and seasonality; period 0; price elasticity; hiring on-costs, recruitment, ramp; launch costs; tax, VAT, loans, inflation; take-a-loan scenario; balance check; 24 months; 13-week view; net-cash verdict; shortfall timing |
| `projection-1.2` | 17 Nov 2026 | Phases 2–3: range, robustness, sensitivity, input labels, confidence, KPIs (`adjust` option); `forecast_by_month` stored for accuracy tracking. No change to projected figures from 1.1 |
| `projection-1.6` | 21 Nov 2026 | Phase 6 part 2: data check (`data_quality`; serious issues lower confidence); combined scenarios; reproduce, compare and model-update information for saved runs; history items carry their model version. Phase 7 (no change to the figures): accuracy across businesses, standards register, release gate. Figures change only through the confidence of runs with serious data issues (10-phase6-part2-changes.md, 11-phase7-changes.md) |
| `projection-1.5` | 21 Nov 2026 | Phase 6: inputs built from the business's records (histories by invoice and expense date, excluding VAT; cost of sales as the larger of product and direct costs; payment time from days sales outstanding; VAT, country and salaries from the records when not set); the shared revenue level checked against complete months; the current month (recorded so far + rest); `how_calculated` explanations and methods. Figures change for businesses whose records differ from what the page sent (09-phase6-changes.md) |
| `projection-1.4` | 20 Nov 2026 | Phase 5: funding events (equity, owner capital, grants), owner drawings, dividends, equipment with straight-line depreciation, bad debts, payroll with country employer costs (UK, Nigeria, US), UK corporation tax bands and losses brought forward, direct costs as cost of sales, salaries detected in expenses; raise-investment and buy-equipment scenarios; balance check includes equipment and owner money. Results unchanged for a business that sets none of these, except hires in a known country (country employer costs instead of 15%) and businesses whose expenses include direct-cost categories with no product costs on invoices (08-phase5-changes.md) |
| `projection-1.3` | 20 Nov 2026 | Phase 4: seasonality only when the F-test for stable seasonality is significant (1%); "below zero" judged over the months ahead, with cash below zero today reported; revenue and cost ranges as calibrated 90% forecast ranges; confidence lowered for unpredictable sales. Projected figures change only for businesses with 24+ months whose seasonal pattern is not significant (07-phase4-changes.md) |


### projection-1.7 — 25 November 2026

See [the accuracy brief behaviour note](2026-11-24-accuracy-changes.md) and the corresponding synthetic before/after evidence. Revenue and both cost components use a common invoice-date period. Observed payment delays need five paid invoices; otherwise invoice-weighted terms are used. Percentage scenarios apply in full, contractors default to operating expenses with a direct-cost choice, and current-month existing-loan interest is included. Cash definitions, input checks and backtest disclosures are explicit. Registered earlier audit evidence is unchanged.


### projection-1.9 — 27 November 2026

For businesses with Operations actuals, each future month uses the mean of its immediately preceding three calendar months. Recorded actuals take priority, including current-month actual-to-date. A prior baseline forecast fills a future month without actuals. Explicit zero actuals are retained; months with no records contribute zero recorded activity and are identified. December uses September–November; January uses October–December; the window advances every month. The current-month row remains actuals only.

Revenue, cost of sales and operating-expense drivers roll independently. Known payroll, employer costs, tax, funding, financing and scenario changes are applied separately once per month; those overlays are not recursively added again through the operating baseline. Each month reports its three source months, amounts and actual/forecast labels. A new run uses the latest actuals; saved forecasts remain unchanged. Legacy snapshots without Operations actuals retain their historical baseline method.
