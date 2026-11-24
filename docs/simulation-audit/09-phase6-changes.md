# Simulation Engine: Phase 6 Changes ("Fed by the Records, Explained in Full")

| | |
|---|---|
| **Date** | 21 November 2026 |
| **Model version** | `projection-1.4` → **`projection-1.5`** ([MODEL.md](MODEL.md): sections 2a, 3, 8.7, 12) |
| **Builds on** | [08-phase5-changes.md](08-phase5-changes.md) |
| **Asked for** | (1) Investigate the figures in the owner's screenshot. (2) Show the current month (November) from the business's own operations. (3) Use every value the business already has, such as VAT, dynamically, so nothing is entered twice. (4) Base every calculation on standards and explain each one clearly |
| **Tests** | [backend/tests/test_simulation_phase6.py](../../backend/tests/test_simulation_phase6.py) (70) |

---

## 1. Investigation: what the screenshot showed, and why

The Simulation page's request was captured on the local app (test account) and traced.

| What the owner saw | Cause | Severity |
|---|---|---|
| **Cost of sales a flat £100** | One invoice carried a product cost (£300 in October). The 1.4 rule "if invoices carry product costs, don't use direct expenses" switched off the split, so cost of sales = (0 + 0 + 300) ÷ 3 = £100, while about £850 a month of subcontractor costs stayed in running costs | Wrong margins |
| **(Found while tracing)** The page's expense history was almost empty: one entry from 45 expenses | The page read expense dates only from `paid_at / issued_at / incurred_at / created_at`; expenses store theirs in **`date`**. Likely to affect production businesses too | Missing history |
| **Money owed rising to £12,941** | The page sent **50-day** payment terms: a plain average of the terms typed on three customer records (90, 14, 45). The receivables were consistent with 50 days; the 50 days were wrong. Customers actually paid after **21 days** (weighted DSO) | Cash timing overstated |
| **(Found while tracing)** The revenue history understated sales | The page grouped sales by **payment** date. A profit forecast needs sales by **invoice** date (accrual basis). Aug–Oct: £4,895 a month by payment date against **£6,566** by invoice date | Wrong level and trend |

**Root cause shared by all four:** the page built its own partial copy of the business's data, with its own date rules and averages, instead of the simulation reading the records directly.

---

## 2. What changed

### 2.1 Inputs from the records (`records.py`, wired in `router._phase5_from_records`)

The server now builds the simulation's inputs from the workspace records: invoices, expenses, customers, the business profile and settings. That's the same data the rest of EnterprateAI uses, so the Simulation page, the Agent's scenario card and any other caller get identical inputs, and the owner enters nothing twice.

| Input | Standard / rule | Test business: before → after |
|---|---|---|
| Sales history | By invoice date, excluding VAT, without drafts or cancelled invoices (accrual basis) | Aug–Oct £4,895 → **£6,566** a month |
| Cost of sales | The larger of the invoices' product costs and the direct-cost expenses, each month (no double counting, no under-counting) | £100 → **£1,021** |
| Running costs | The other expenses, by their own date, excluding recorded VAT | £2,061 (subcontractors included) → **£1,040** |
| Payment time | **Days sales outstanding**: amount-weighted time from invoice to payment, last 12 months, at least 3 paid invoices | 50 days → **21 days** (money owed about £5,300–5,900 instead of £12,941) |
| VAT | The rate charged on the last 12 months' invoices, and the share of costs carrying VAT, unless the owner has set VAT | Filled automatically when invoices carry VAT |
| Country, salaries in expenses | From the profile and the expenses, unless the owner has set them | Country UK from the profile |
| Monthly revenue level | The dashboard's shared figure, **checked** against the complete months. Outside the business's 90% forecast range, the complete months are used and the page says why | Test business: within range, so kept (£6,710 against £6,566) |

**Owner-entered settings always win.** Records only fill blanks. The one exception is payment time, which is never typed in the settings, so the records replace the page's average.

### 2.2 The current month (`projection.current_month_view`)

Each run now carries `current_month`, shown on the page as a **"This month (Nov 2026)"** panel and as the first row of the timeline:

| | Test business, 21 Nov 2026 |
|---|---|
| Recorded so far (4 invoices, 5 expenses dated 1–21 Nov) | Revenue £6,554.15; costs £3,100.00 |
| Rest of the month (9 days at the normal monthly rate) | Revenue £2,180.52; costs £618.33 |
| Month total | Revenue £8,734.67; profit £5,016.34 |
| Cash | £34,885.28 today → £38,616.52 at the end of the month |

### 2.3 How every figure was calculated (`explain.py`)

Each run carries `how_calculated`, shown on the page under the timeline:

- **Starting point.** Each level with its source and months, the trend with its t-statistic (applied or not, and why), the seasonality test (F, p), the payment time and its source, and any note about the figures.
- **Month by month**, with the real numbers. From the test business:
  - *Revenue:* normal month 6,709.87 + trend 326.63 × 3.10 damped months = 7,720.82
  - *Costs:* cost of sales 1,021.10 + running costs 1,040.00 = total costs 2,061.10; profit = revenue 7,720.82 − costs = 5,659.72
  - *Cash:* 41,533.74 + collected from customers 7,570.81 − costs paid 2,061.10 = cash 47,043.45

  Payroll, depreciation, unpaid sales, interest, tax, VAT, loans, funding, equipment and drawings appear on these lines whenever they apply. **Every cash line adds up exactly** to the closing cash (tested on 60 random businesses with every factor).
- **Methods and standards.** Eight methods in plain English, each with its standard:
  - the starting level (FAST / ICAEW)
  - the trend (least squares and t-test; damped trend, Gardner & McKenzie 1985)
  - seasonality (F-test and ratio to moving average, US Census Bureau X-11 / X-13ARIMA-SEATS)
  - payment timing (direct-method cash flow, IAS 7; DSO)
  - the accounting checks (three-statement integrity)
  - tax, VAT, loans, payroll and equipment (HMRC and country rules 2025/26; IAS 16; IAS 20)
  - the 90% range
  - the verdict (a do-nothing baseline, SR 11-7)

### 2.4 The page's own history

The date rule in `financialIntelligence.js` now also reads `date`, `expense_date` and `issue_date`. That history is still the fallback and is used elsewhere, for example the Reports page.

---

## 3. Verification

| Check | Result |
|---|---|
| Phase 6 tests | **70 passed**: records by hand (dates, VAT excluded, drafts out, larger of the two costs), DSO by hand, invoice-terms fallback, VAT rate and cost share, this month so far, owner settings winning, the revenue-level check, the current month by hand, 60 random businesses whose every cash line adds up, the starting-point text |
| Updated Phase 5 tests | Mixed product and direct costs now use the larger (the cause of the £100); version check "1.4 or later" |
| All simulation tests (Phases 0–6) | **1,053 passed** |
| Independent replication (projections, verdicts, baselines, Phase 5 factors) | 400/400, 350/350, 300/300, 300/300: **unchanged** |
| Mock production and holdout | **Unchanged**: 9 of 10 on the original set (the known growth-bias miss), all checks on the holdout set |
| Full backend | **3,332 passed** (3,262 + 70). The same 12 failures as before: 9 pre-existing and 3 caused by the team's `.env` file |
| Frontend / build | **850 passed**, with the same 6 pre-existing failures; the build succeeds |
| Live local app | The November panel and row, the corrected costs and payment time, and "How this was calculated" with "Methods and standards" all shown for the test account |

---

## 4. Coordination with the rest of EnterprateAI

| Part | Effect |
|---|---|
| **Financials** (invoices, expenses), **catalogue** (customers, product costs), **workspace profile** (country, VAT number) | Read directly by the simulation, so no re-entry |
| **Agent scenario card** | Uses the same `shared_state`, so it now projects from the records' history, payment time and current month (before, it started from an empty snapshot with flat figures) |
| **Dashboard shared figures** | Still the revenue and costs level, now **checked**: when the dashboard's figure is far from the complete months (it counts cash over 92 days including the month in progress), the simulation says so and uses the complete months. The `figures.py` owner should consider complete months for the dashboard too (an open item since Phase 1) |
| **Reports** | Benefits from the page's date fix. The report's scenario section reads the same server results |
| **Database** | No new columns |

**Not yet fed automatically** (no records exist for them in the workspace): loans (no loan records, so they stay in the settings), payroll by person (no payroll module), and funding actually agreed. The funding-readiness case holds a *target*, which isn't money received. These are candidates if those modules start recording them.

---

## 5. Still to do in Phase 6 (from the agreed list)

- Data quality check before a run, beyond the records reading above: outliers, duplicates, uncategorised expenses.
- Owner "confirm these figures" step, together with moving business settings to their own grouped card on the Simulation dashboard (recommended earlier).
- Run snapshots for exact reruns, a side-by-side scenario comparison, refusal rules when data is too thin, and model-update notices.

## Appendix: files changed

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/records.py` | **New.** Inputs from the records |
| `backend/app/modules/scenario_intelligence/explain.py` | **New.** How each figure was calculated; methods and standards |
| `backend/app/modules/scenario_intelligence/router.py` | Records wiring, owner-first fill, DSO, direct costs (larger of the two), revenue-level check |
| `backend/app/modules/scenario_intelligence/projection.py` | `current_month_view`, `how_calculated`; `MODEL_VERSION` 1.5 |
| `backend/app/modules/scenario_intelligence/schemas.py` | `current_month_recorded`, `figure_notes` |
| `frontend/src/pages/SimulationPage.jsx` | "This month" panel and row; "How this was calculated"; "Methods and standards" |
| `frontend/src/lib/financialIntelligence.js` | Date rule includes `date`, `expense_date`, `issue_date` |
| `backend/tests/test_simulation_phase6.py` | **New** (70) |
| `backend/tests/test_simulation_phase5.py` | Larger-of-the-two rule; version check |
| `docs/simulation-audit/MODEL.md` | 1.5 specification |
