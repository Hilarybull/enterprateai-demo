# Simulation: Standards, Institutions and Sources Used

| | |
|---|---|
| **Purpose** | Research and development record: every external standard, institution and method the simulation work relied on, how each was used, and where it is applied |
| **Covers** | Baseline audit (16 Nov 2026), Phases 0–3 (17–18 Nov), independent review and mock production run (19 Nov) |
| **Status of each entry** | **Cited**: named in our documents during the work. **Used, now referenced**: an established method used in the code; the standard source is added here for the record and should be checked by the person who signs this off. **Own choice**: our decision, with no external source |

---

## 1. Standards and guidance we measured against

These defined the target in the baseline audit ([01, Section 6](01-baseline-findings.md)) and the scorecard used in every phase.

| # | Standard / guidance | Issuing institution | Status | How we used it | Where it shows |
|---|---|---|---|---|---|
| 1.1 | **FAST Standard** (Flexible, Appropriate, Structured, Transparent) for financial models | The FAST Standard Organisation | Cited | Target for model structure: inputs, calculations and outputs kept apart; one consistent time line; built-in checks. Drove: separate baseline, projection and uncertainty modules; every input labelled with its source; monthly periods with a defined month 0; three accounting checks on every run | 01 §6; scorecard criteria 1, 3, 8, 10; MODEL.md §2–5; 06 §4 |
| 1.2 | **ICAEW Financial Modelling Code** | ICAEW (Institute of Chartered Accountants in England and Wales) | Cited | Same role as 1.1, as the UK professional body's code of practice: transparency, documented assumptions, checks. Drove: assumptions listed with every result; documented defaults with their basis; MODEL.md | 01 §6; MODEL.md §6; 04 |
| 1.3 | **SR 11-7, Supervisory Guidance on Model Risk Management** (April 2011; also issued as OCC Bulletin 2011-12) | Board of Governors of the US Federal Reserve System, and the US Office of the Comptroller of the Currency (OCC) | Cited | Framework for governing the model: documentation, change control, ongoing monitoring, outcomes analysis and independent validation. Drove: MODEL.md with versioning and change control (`MODEL_VERSION`); monitoring thresholds; accuracy tracking and backtest; the independent replication and mock production run (06) | 01 §6; 05; MODEL.md §9–10; 06 §2, §4 |

**How far we applied SR 11-7.** It is supervisory guidance for US banks, not a requirement for this product. We used it as a recognised framework for good model governance. One element is not yet met: validation by a person independent of the model's development (06, §2.1).

---

## 2. Accounting and financial-planning practice

| # | Practice | Reference institution / source | Status | How we used it | Where it shows |
|---|---|---|---|---|---|
| 2.1 | **Integrated three-statement modelling**: profit and loss, cash flow and balance sheet that reconcile | Recognised financial-modelling practice (no single issuing body); consistent with 1.1–1.2 | Cited (as practice) | Three identities checked every month: the cash bridge, the receivables bridge, and assets − liabilities change = profit. Tested on 300 random businesses and replicated 400/400 | 01 §6; MODEL.md §5.1; 03; 05; 06 |
| 2.2 | **Direct-method cash flow**: cash receipts and payments shown gross | IAS 7 *Statement of Cash Flows*, International Accounting Standards Board (IASB), which describes the direct method | Practice cited; IAS 7 used, now referenced | Cash projected from receipts and payments (collections after payment terms, bills when due), not derived from profit. The indirect method is used as a cross-check in tests | 01 §6; 02; MODEL.md §5.2 |
| 2.3 | **13-week cash flow forecast** | Recognised treasury and turnaround practice (no single issuing body) | Cited (as practice) | Weekly cash view for the next 13 weeks, reconciled to the monthly projection | 03; MODEL.md §3, §5 |
| 2.4 | **Accrual vs cash timing of revenue**: profit recognised when earned, cash when collected | General accounting principle (IFRS conceptual basis; IAS 7 for cash) | Used, now referenced | Revenue counts in profit when invoiced; cash arrives after payment terms; money already owed is collected by due date. This fixed finding F1 (a profitable business shown running out of cash) | 01 F1; 02; MODEL.md §5.2 |
| 2.5 | **VAT on a cash basis** | HM Revenue & Customs (HMRC), VAT Cash Accounting Scheme (UK); the model's rule is generic and not specific to one country | Used, now referenced | Output VAT on money collected, input VAT on costs paid, paid one month after each period (quarterly by default) | 03; MODEL.md §5.4 |
| 2.6 | **Loan repayment (annuity) formula**: A = L·i / (1 − (1+i)^−n) | Standard financial mathematics | Used | "Take a loan" scenario and existing loans: interest is a cost, principal is cash only | 03; MODEL.md §5.5; `projection.annuity_payment` |
| 2.7 | **Standard KPIs**: gross, operating and net margin, burn, runway, days sales outstanding, break-even revenue, margin of safety, interest cover | Common management-accounting definitions | Used | Shown with their definitions on every run | 04; MODEL.md §8.5 |

---

## 3. Forecasting and statistical methods

| # | Method | Standard source (for the record) | Status | How we used it | Where it shows |
|---|---|---|---|---|---|
| 3.1 | **Least-squares trend with a t-test** (applied only if \|t\| ≥ 2, about 95% confidence) | Ordinary least squares and Student's t-distribution (standard statistics) | Used | A trend is projected only when it is statistically significant, so short runs of noise aren't extrapolated | 03; MODEL.md §4; `baseline.trend` |
| 3.2 | **Damped trend** (φ = 0.9) | Gardner, E. S. & McKenzie, E. (1985). "Forecasting trends in time series." *Management Science*, 31(10) | Used, now referenced | Each month carries 0.9× the previous month's growth, so growth isn't extended for ever | 03; MODEL.md §4; `baseline.damped_steps` |
| 3.3 | **Classical seasonal decomposition**: ratio to the centred 2×12 moving average | Macaulay, F. R. (1931). *The Smoothing of Time Series*. National Bureau of Economic Research (NBER). Textbook treatment: Hyndman, R. J. & Athanasopoulos, G., *Forecasting: Principles and Practice* (OTexts), chapter on time-series decomposition | Used, now referenced | Seasonal indices by calendar month, with 24+ complete months. The 06 review found it is applied without a significance test, which is the main cause of 3 failed accuracy checks | 03; MODEL.md §4; 06 §3.4 |
| 3.4 | **Naive benchmark** ("next month = last month"), the baseline any forecasting method should beat | Forecasting practice established through the M-competitions: e.g. Makridakis, S., Spiliotis, E. & Assimakopoulos, V. (2020). "The M4 Competition: 100,000 time series and 61 forecasting methods." *International Journal of Forecasting*, 36(1). Also Hyndman & Athanasopoulos (above) | Used, now referenced | The backtest and the mock production run report the model's error against the naive method | 05; MODEL.md §9; 06 P5 |
| 3.5 | **WAPE** (total absolute error ÷ total actual) and **bias** (total error ÷ total actual) | Common in business forecasting because percentage errors on single months blow up when values are small. Discussed in Kolassa, S. & Schütz, W. (2007). "Advantages of the MAD/MEAN ratio over the MAPE." *Foresight* | Used, now referenced | Accuracy measures for tracked accuracy, the backtest and the mock production run | 05; MODEL.md §9; `accuracy.py`; 06 |
| 3.6 | **Rolling-origin backtest** (fit on the months before each test month, then compare) | Time-series cross-validation, described in Hyndman & Athanasopoulos (above) | Used, now referenced | Backtest on each business's last 3 complete months | 05; `baseline.backtest` |
| 3.7 | **Constant-elasticity demand**: volume factor = price factor^elasticity | Standard microeconomics | Used | Customers' response to a price change | 03; MODEL.md §5.5 |
| 3.8 | **Stress (scenario) ranges and one-at-a-time sensitivity** | Standard practice in financial modelling and model risk management (1.3: sensitivity analysis) | Used | Low/base/high cases, robustness of the verdict, ranking of the inputs that move the result most | 04; MODEL.md §8.1–8.2 |

---

## 4. Default figures and their sources

| Default | Value | Basis stated in our documents | Source status | Action |
|---|---|---|---|---|
| Customer price sensitivity | 1.0 (sales fall 1% per 1% price rise); range tested 0.5–2.0 | "Moderate response; published studies about 0.5–2.6" | **Not cited by name.** The upper figure matches the meta-analysis by Bijmolt, T. H. A., van Heerde, H. J. & Pieters, R. G. M. (2005), "New empirical generalizations on the determinants of price elasticity," *Journal of Marketing Research*, 42(2) (mean about −2.6). An earlier meta-analysis: Tellis, G. J. (1988), *Journal of Marketing Research*, 25(4) (mean about −1.8). No source was recorded for the 0.5 lower figure | Verify and cite in MODEL.md §6, or restate the range from the sources |
| Employer on-costs | 15%; range tested 10–25% | "Typical employer tax, pension and benefits, 10–25% across the UK, Nigeria and the US" | **Not cited.** Relevant authorities: UK, HMRC (employer National Insurance) and The Pensions Regulator (auto-enrolment); Nigeria, Pension Reform Act 2014 (PenCom), NSITF and ITF contributions; US, IRS (FICA, FUTA) and state unemployment insurance | Verify current rates per country and cite, or let the owner set it |
| Customer payment terms | 30 days when not recorded | "Common invoice terms" | **Not cited.** Related: UK Late Payment of Commercial Debts (Interest) Act 1998 (a default period where none is agreed) | Optional citation; the assumption is labelled to the owner as "assumed" |
| New-hire ramp-up | 3 months | "Standard onboarding assumption" | **Not cited** | Own choice unless a source is added |
| VAT period | 3 months | Quarterly returns | Practice (e.g. HMRC quarterly VAT returns) | None needed |
| Revenue / cost swing with no history | 15% / 10% | "Conservative for small businesses" / "costs steadier than sales" | **Own choice** | Calibrate from tracked accuracy (06 §5) |

---

## 5. Our own choices (no external standard)

These are recorded as decisions, so they are not mistaken for standards. Each is documented in MODEL.md and can be changed under its change control.

| Choice | Value | Where |
|---|---|---|
| Materiality for verdicts | 1% of the baseline's revenue over the period | MODEL.md §7 |
| Verdict rules (order, net cash basis, running out of cash) | Rules 1–7 | MODEL.md §7 |
| Confidence points and levels | Points table; 2+ = high, 0–1 = medium | MODEL.md §8.4 |
| Monitoring thresholds | WAPE above 25%, bias outside ±10%, over 6+ months | MODEL.md §9 |
| Swing bounds | 3%–50% | MODEL.md §8.1 |
| Minimum history for trend / seasonality | 6 / 24 complete months | MODEL.md §4 |
| Idea Validation: missing answers "not assessed" with weights re-scaled; coverage bands 85% / 60% | Rubric v0.5, engine 3.1 | MODEL.md §8.6 |
| Mock production pass marks (P1–P7, S1–S3) | Written before the run | 06 §3; `expected.json` |

---

## 6. Research-method and evidence-integrity standards

| # | Standard / practice | Institution / source | How we used it | Where |
|---|---|---|---|---|
| 6.1 | **SHA-256 hashing** | US National Institute of Standards and Technology (NIST), FIPS 180-4 *Secure Hash Standard* | Fingerprints prove the original code ("before" state) and the pre-registered expected results were not changed afterwards | `baseline-snapshot/MANIFEST.txt`; `evidence/mock_production/PREREGISTRATION.txt` |
| 6.2 | **Pre-registration**: expected results and pass marks written before running the test | Research practice, e.g. Nosek, B. A. et al. (2018). "The preregistration revolution." *PNAS*, 115(11) | The mock production run's expected results were fixed and fingerprinted before the simulation was run, so results could not be fitted after the fact | 06 §3.1 |
| 6.3 | **Replication / benchmarking** as validation | SR 11-7 (1.3): "benchmarking" and independent review | The model was rebuilt from MODEL.md alone (shadow model) and compared on 400 projections and 300 forecasts | 06 §2 |
| 6.4 | **Reproducibility**: fixed random seeds, rerunnable scripts, saved outputs | General scientific practice | Every probe, comparison and mock run uses a fixed seed and saves its output | `evidence/` |
| 6.5 | **Synthetic data with a known ground truth** | Standard approach for testing forecasting methods | 200 mock businesses generated from known rules, with their true future, to measure accuracy before production | 06 §3 |

---

## 6a. Phase 5 (model 1.4): payroll, tax and accounting sources

Rates are coded in `backend/app/modules/scenario_intelligence/factors.py`, labelled "2025/26 tax year". **Check them every year**, and against the authority's current guidance before external use.

| # | Rule used | Institution / source | How we used it |
|---|---|---|---|
| 6a.1 | Employer Class 1 National Insurance 15% above a secondary threshold of £5,000 a year (from 6 April 2025) | HM Revenue & Customs (HMRC) | UK employer cost per person, for payroll settings and hires |
| 6a.2 | Automatic enrolment: minimum employer pension contribution 3% of qualifying earnings, band £6,240–£50,270 a year (2025/26) | The Pensions Regulator (UK) | UK employer pension unless the owner enters a %, capped at the band |
| 6a.3 | Employer pension contribution at least 10% of monthly emoluments | Pension Reform Act 2014 (Nigeria); National Pension Commission (PenCom) | Nigeria employer pension (applied to gross pay; the Act's base is basic, housing and transport allowances) |
| 6a.4 | Employer contribution 1% of payroll | Employees' Compensation Act 2010 (Nigeria); Nigeria Social Insurance Trust Fund (NSITF) | Nigeria employer cost |
| 6a.5 | Employer contribution 1% of payroll (employers with 5+ staff or turnover of N50m+) | Industrial Training Fund Act (Nigeria); Industrial Training Fund (ITF) | Nigeria employer cost (applied to all; threshold not checked) |
| 6a.6 | Employer FICA: Social Security 6.2% + Medicare 1.45%; FUTA 6.0% less the standard 5.4% credit = 0.6% on the first $7,000 a year | US Internal Revenue Service (IRS) | US employer cost (Social Security wage base and state unemployment insurance not applied) |
| 6a.7 | Corporation tax from 1 April 2023: 19% small profits rate up to £50,000; 25% main rate above £250,000; marginal relief fraction 3/200 between | HM Revenue & Customs (HMRC) | Optional "UK corporation tax bands" (no associated companies) |
| 6a.8 | Property, plant and equipment: cost spread over useful life (straight line) | IAS 16 *Property, Plant and Equipment* (IASB) | Equipment purchases and the "Buy Equipment" scenario |
| 6a.9 | Government grants recognised as income | IAS 20 *Accounting for Government Grants* (IASB) | Grants are income in the month received (simplified: IAS 20 matches grants to the costs they fund) |
| 6a.10 | Allowance for amounts not collected | IFRS 9 *Financial Instruments* (IASB), expected credit losses | Bad debts as a share of sales, an expense when the sale is made (a simple allowance, not the full IFRS 9 model) |
| 6a.11 | Owner contributions and distributions are equity, not income or expense | IFRS Conceptual Framework (IASB) | Equity, owner capital, drawings and dividends move cash and equity, not profit; the balance check includes them |
| 6a.12 | F-test for stable seasonality (Phase 4) | US Census Bureau, X-11 / X-13ARIMA-SEATS seasonal adjustment | Seasonality applied only when significant at 1% |

## 7. Gaps to close for the R&D record

1. **Default sources.** Cite named sources for price sensitivity (Section 4). Employer on-costs now use the country rules in 6a for the UK, Nigeria and the US; the 15% standard figure remains for other countries and still needs a source.
2. **Verification.** The "used, now referenced" sources in Sections 2–3 and 6 were added after the work, for the record. Whoever signs off should check each citation (author, year, title) before it is relied on externally.
3. **Independent validation.** SR 11-7's independent-validation element needs a reviewer outside the development work (06 §2.1).
4. **Calibration.** Replace the own-choice thresholds and swings in Section 5 with values from tracked accuracy once real data exists.
