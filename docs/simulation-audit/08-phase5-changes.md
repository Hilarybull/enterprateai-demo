# Simulation Engine: Phase 5 Changes ("The Factors a Standard Forecast Includes")

| | |
|---|---|
| **Date** | 20 November 2026 |
| **Model version** | `projection-1.3` → **`projection-1.4`** ([MODEL.md](MODEL.md): sections 2, 5.1, 5.3, 5.4a, 5.5, 6, 11, 12) |
| **Builds on** | [07-phase4-changes.md](07-phase4-changes.md) |
| **Goal** | Include the financial factors a standard business forecast has and the simulation lacked: funding, payroll with employer costs by country, owners' money, equipment, bad debts, direct costs and corporation tax |
| **Tests** | [backend/tests/test_simulation_phase5.py](../../backend/tests/test_simulation_phase5.py) (17 hand-calculated + 200 random-invariant cases), `frontend/src/pages/SimulationPhase5.test.js` (6) |

---

## 1. Summary

| Factor | Before (1.3) | After (1.4) |
|---|---|---|
| **Funding** (equity, investors, owner capital, grants) | Not possible. The only funding was a loan | Business settings and a new **"Raise Investment"** scenario. Equity and owner capital are cash in; grants are cash in and income (IAS 20). The verdict says when cash is higher **because of the funding, not earnings** |
| **Payroll** (salaries, employer NI, pension) | Only as ordinary expenses, or a flat 15% on a new hire | Staff count and pay, with **employer costs by country**: UK NI and pension, Nigeria pension, NSITF and ITF, US FICA and FUTA. Hires use the same rules. **Not added twice** when salaries are already in the expenses (detected automatically) |
| **Owner drawings and dividends** | Not modelled | Cash out, not a cost |
| **Equipment purchases** | Only the one-off launch cost | Cash when bought, **depreciated** over its life (IAS 16). A new **"Buy Equipment"** scenario, with the extra sales or cost savings it brings |
| **Bad debts** | Every invoice assumed paid | A share of sales never collected, counted as a cost |
| **Direct costs** | All recorded expenses counted as running costs | Expenses in direct-cost categories (subcontractors, materials, stock…) counted as **cost of sales** when invoices carry no product costs, so margins are right |
| **Corporation tax** | One flat rate | Optional **UK bands** (19% / 25% with marginal relief) and **tax losses brought forward** (also with the flat rate) |
| **Balance check** | Cash, receivables and liabilities | Also equipment and owners' money: assets less liabilities move by profit, plus money owners put in, less what they take out |

**Nothing changes for a business that sets none of this**, with two deliberate exceptions:
- **Hires:** a hire in a known country uses that country's employer costs instead of a flat 15%.
- **Direct costs:** a business whose expenses include direct-cost categories, and whose invoices carry no product costs, now has those costs as cost of sales.

---

## 2. How each factor works

The full rules are in MODEL.md, section 5.4a. In brief:

- **Funding events** `{type, amount, month}`: equity and owner capital are cash in that month, not income and not a loan. Grants are cash in and income that month.
- **Owner drawings** (monthly) and **dividends** `{amount, month}`: cash out, not a cost.
- **Equipment** `{amount, month, life_months}` (life 36 months when blank): paid in its month, then amount ÷ life a month as depreciation. Its remaining value is an asset in the balance check.
- **Bad debts:** that share of each month's sales is a cost in the month of sale. Only the rest is collected or remains owed.
- **Payroll:** staff × (gross pay + employer costs per person), added to running costs, unless salaries are already recorded as expenses.

| Country | Employer costs per person, on monthly gross pay (2025/26) |
|---|---|
| United Kingdom | NI 15% above £5,000 a year; pension 3% of qualifying earnings (£6,240–£50,270 a year) |
| Nigeria | Pension 10% (Pension Reform Act 2014), NSITF 1%, ITF 1% |
| United States | FICA 7.65%; FUTA 0.6% on the first $7,000 a year (state unemployment insurance not included) |
| Other | 15% (the standard figure, labelled as such) |

An entered employer pension % replaces the minimum. Each person's employer costs are rounded to the penny.

- **UK corporation tax:** 19% up to £50,000; 25% from £250,000; marginal relief of 3/200 × (£250,000 − profit) between. The rate is set from the profit to date scaled to a year. Losses brought forward reduce the taxable profit under both the UK and flat options.
- **From the business's own records** (server side, in the same place as the product's shared figures):
  - **Country:** taken from the workspace profile, unless the owner sets one.
  - **Salaries:** detected in the recorded expenses over the last 92 days.
  - **Direct costs:** split out of the shared monthly costs rather than added to them, so nothing is counted twice.
- **The page:** the settings panel ("Business settings: tax, VAT, loans, payroll, funding and more") has choice lists for country, tax rules and "salaries already in my expenses?". It also has one row each for planned funding, equipment and a dividend; the server accepts several. The hire form leaves employer on-costs blank, so the country's rules apply unless the owner types a figure.

### Worked examples (from the tests)

| Case | Result, worked out by hand |
|---|---|
| £20,000 equity in month 2; £1,000 a month drawings; £6,000 of equipment over 12 months; 5% bad debts, on £10,000 sales | Profit £4,000 a month. Cash £2,500 → £26,000 → £29,500; equipment worth £4,500 at the end. All three checks hold |
| UK employee on £3,000 a month | NI £387.50 + pension £74.40 = **£461.90** (15.4%) |
| Nigeria employee on ₦200,000 | ₦24,000 (12%) |
| US employee on $5,000 | $386.00 |
| UK profit of £120,000 | Tax **£28,050**. With £20,000 of losses brought forward: **£22,750** |
| £24,000 of equipment saving £1,500 a month (48-month life), 12 months | Profit **+£12,000**, cash **−£6,000** → "mixed" (a trade-off) |

---

## 3. Verification

| Check | Result |
|---|---|
| Phase 5 hand-calculated tests | **17 passed** |
| Random businesses with **every new factor switched on together** (fixed seed): all three checks in every month, rows match the summary, same answer twice | **200 / 200** |
| Independent replication: the factors rebuilt **from MODEL.md alone** ([shadow_phase5.py](evidence/independent_review/shadow_phase5.py)) and compared on 300 random businesses | **300 / 300** match (allowing for each person's employer costs being rounded to the penny, which MODEL.md now states) |
| Earlier replication (projections, verdicts, baselines) | 400/400, 350/350, 300/300, unchanged |
| Mock production test and holdout (these businesses use none of the new factors) | **Identical to 1.3**: 6 of 7 and 7 of 7 forecast checks, all scenario checks |
| All simulation tests (Phases 0–5) | **983 passed** (766 + 217) |
| Full backend | **3,262 passed** (3,045 + 217). The same 12 failures as after Phase 4: 9 pre-existing, plus 3 marketplace tests caused by the team's `backend/.env` file (07, Section 4.3) |
| Frontend | **850 passed** (844 + 6); the same 6 pre-existing failures |
| Production build | Succeeds |
| Live local app (test account) | "Raise Investment" ran on 1.4. The country was set to the UK from the business profile, UK payroll rules applied, all checks passed, and the verdict carried the funding note |

---

## 4. Coordination with the rest of EnterprateAI

| Module | Effect |
|---|---|
| **Shared figures** (`agent/figures.py`: dashboard, risk check, Agent) | Still the level for revenue and costs. Direct costs are **split out of** the shared costs figure, never added, so the dashboard's total costs and the simulation's total agree |
| **Workspace profile** | Its country now sets the payroll rules, unless the owner chooses another in the settings |
| **Report, business assistant, Agent card** | Same fields as before. The verdict reason may now carry the funding note; new totals (payroll, depreciation, bad debts, funding, owner payments) and the monthly detail are added, not changed |
| **Plans** | The two new scenarios follow the existing rule: not on Starter's list of four, so Decision Engine and above. The page and the server use the same rule |
| **Database** | No new columns. The new state and summary fields are stored in the existing JSON |
| **Accuracy tracking** | Unaffected: grants are kept out of "revenue" (shown as other income), so forecasts are still compared with sales |

---

## 5. Limits, stated

- **Payroll:** one average pay per person. The employment allowance, apprenticeship levy, US state unemployment insurance and the Social Security wage cap are not applied. Employer NI and pension are paid in the month rather than the month after. Nigeria's pension base (basic, housing and transport) is approximated by gross pay, and the ITF size threshold is not checked.
- **Grants:** income when received. IAS 20 matches grants to the costs they fund.
- **Bad debts:** a simple allowance, not the full IFRS 9 expected-credit-loss model.
- **Equity:** the share of the business given up is not costed, and the verdict says so.
- **Equipment:** VAT on it is not modelled.
- **UK corporation tax:** no associated companies; other countries use the flat rate.
- **Rates:** for 2025/26. They must be **reviewed every year** (REFERENCES.md, 6a) and checked against the authorities' current guidance before external use.

---

## 6. Next

- **Phase 6, defensibility:** a data quality check before running, an owner "confirm these figures" step, saved run snapshots for exact reruns, a "why this verdict" breakdown in pounds, side-by-side and combined scenarios, refusal rules when data is too thin, and a model-update notice.
- **Phase 7, proving it over time:** an accuracy dashboard across companies, confidence calibrated on real outcomes, the release gate in CI, and the annual rate review.

## Appendix: files changed in Phase 5

| File | Change |
|---|---|
| `backend/app/modules/scenario_intelligence/factors.py` | **New.** Country employer costs, UK corporation tax, expense kinds |
| `backend/app/modules/scenario_intelligence/projection.py` | Funding, owners' money, equipment and depreciation, bad debts, payroll, tax rules, extended balance check, the two scenarios, funding note; `MODEL_VERSION` 1.4 |
| `backend/app/modules/scenario_intelligence/schemas.py` | New optional state fields; two scenario types |
| `backend/app/modules/scenario_intelligence/service.py` | Two scenario templates |
| `backend/app/modules/scenario_intelligence/router.py` | `_phase5_from_records`: country, salaries in expenses, direct-cost split |
| `backend/app/modules/scenario_intelligence/uncertainty.py` | Labels for the new inputs ("country rules"); low and high cases for equipment benefits |
| `frontend/src/pages/SimulationPage.jsx` | Settings panel (new fields, choice lists, planned items), scenario inputs, blank on-costs, blank values left out |
| `frontend/src/lib/financialIntelligence.js` | Direct costs moved to the cost of sales history (`splitDirectCosts`, `expenseKind`) |
| `backend/tests/test_simulation_phase5.py`, `test_simulation_phase4.py` | **New** (217); version test now checks "1.3 or later" |
| `frontend/src/pages/SimulationPhase5.test.js` | **New** (6) |
| `docs/simulation-audit/MODEL.md`, `REFERENCES.md` | 1.4 specification; Phase 5 sources (6a) |
| `docs/simulation-audit/evidence/independent_review/shadow_phase5.py`, `compare_phase5.py` | **New** independent replication of the factors |
