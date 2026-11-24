# EnterprateAI Simulation: Team Guide

**Read this first.** It covers what the simulation does now, what changed, how every calculation and workflow works, and how to set up, run and test it. Deeper detail is in [docs/simulation-audit/](docs/simulation-audit/README.md); the exact specification is in [MODEL.md](docs/simulation-audit/MODEL.md).

**Current integration, 24 November 2026:** this upgrade is integrated into the current development app. See [integration verification](docs/simulation-integration.md) for the checks, preserved app features and database compatibility. Historical test totals below describe the original demo delivery, rather than the current app's full suite.

| | |
|---|---|
| **Model version** | `projection-1.6` (stamped on every run) |
| **Code** | `backend/app/modules/scenario_intelligence/`; page `frontend/src/pages/SimulationPage.jsx` |
| **Status** | Integrated locally; not deployed by this change. The release gate must pass before release. Independent human model review remains outstanding. |
| **Local setup** | [scripts/local_supabase/README.md](scripts/local_supabase/README.md): a safe local copy with its own database, no real email or payments |

---

## 1. What the simulation is for

An owner asks: *"What happens to my profit and cash over the next months if I make this change, compared with doing nothing, and how sure is that?"* The simulation answers with:
- a month-by-month projection that reconciles every month
- a verdict against doing nothing
- a 90% range, a sensitivity ranking and a confidence rating
- a data check
- every figure explained, with its source and the standard behind it

## 2. What changed (summary)

The original simulation was audited on 16 Nov 2026 and scored **0 of 14** on recognised modelling criteria. It now meets **16 of 17**. The one partial needs a human sign-off; see Section 8.

| Phase | Doc | Main changes |
|---|---|---|
| Baseline | [01](docs/simulation-audit/01-baseline-findings.md) | Findings F1–F12. The original code is kept in `docs/simulation-audit/baseline-snapshot/` with SHA-256 fingerprints |
| 0 | [02](docs/simulation-audit/02-phase0-changes.md) | Cash that collects what is owed (a profitable business was shown "critical"); one verdict rule; engine scores from real data only |
| 1 | [03](docs/simulation-audit/03-phase1-changes.md) | Complete-month baseline, trend and seasonality; customers react to price; hiring costs; tax, VAT, loans; balance check; 24 months; 13-week cash |
| 2 | [04](docs/simulation-audit/04-phase2-changes.md) | Low/base/high range, robustness, sensitivity, input sources, confidence; Idea Validation no longer scores missing data as good |
| 3 | [05](docs/simulation-audit/05-phase3-changes.md) | Accuracy tracking against actual months; 300-case invariant tests; MODEL.md; report, page and server agree |
| Review | [06](docs/simulation-audit/06-independent-review-and-mock-production.md) | Model rebuilt from the specification alone (matches the code); mock production test with known futures |
| 4 | [07](docs/simulation-audit/07-phase4-changes.md) | Seasonality only when significant; calibrated 90% range (holdout 94%); overdrawn-today verdict; **access check on every endpoint** |
| 5 | [08](docs/simulation-audit/08-phase5-changes.md) | Funding and grants, payroll with UK / Nigeria / US employer costs, drawings and dividends, equipment and depreciation, bad debts, direct costs, UK corporation tax |
| 6 | [09](docs/simulation-audit/09-phase6-changes.md), [10](docs/simulation-audit/10-phase6-part2-changes.md) | **Inputs built from the business's records** (no re-entry); this month shown; every figure explained; data check; combined scenarios; reproduce, compare, model notices; settings card with "confirm these figures" |
| 7 | [11](docs/simulation-audit/11-phase7-changes.md) | Accuracy across all companies (admin); standards register; **release gate in CI** |

**What owners will see change** (intended; runs are version-stamped, so old and new can be told apart):
- Forecasts start from complete months by invoice date.
- Price rises include customers' reaction, and hires include employer costs.
- Margins include direct costs, and payment timing reflects how fast customers really pay.
- Some verdicts change (borrowing is no longer "better" just because cash went up), and missing Idea Validation answers are no longer scored.

## 3. How it works

### 3.1 Data flow

```
Workspace records (invoices, expenses, customers, profile)   Business settings (Simulation dashboard card)
                  │                                                          │
                  ▼                                                          ▼
 router.shared_state ── agent/figures.py (dashboard's shared figures, checked against complete months)
                  │      records.py (histories, payment speed, VAT, country, salaries, this month so far)
                  ▼
 projection.project ── baseline.py (level, trend, seasonality) · factors.py (country payroll, UK tax)
                  │     scenario rules (incl. combined) · tax, VAT, loans, funding, equipment, bad debts
                  ▼
 explain.py (how each figure was calculated) · quality.py (data check) · uncertainty.py (range, sensitivity, confidence)
                  │
                  ▼
 service.create_scenario_run → saved with its full input snapshot and model version
                  │
     ┌────────────┼──────────────┬──────────────────────┬──────────────────────────┐
 Simulation page   Agent card     Downloadable report     Business assistant        Admin → Simulation accuracy
                                                                                    (monitoring.py)
```

**Owner-entered settings always win.** The records fill only what isn't set, and nothing has to be entered twice.

### 3.2 The calculations, in plain words

Each comes with its standard. The full formulas are in MODEL.md, and the page shows them with real numbers under **"How this was calculated"**.

| Step | How | Standard |
|---|---|---|
| **Normal month** (starting level) | Average of the last 3 complete months. The dashboard's figure is used if it lies within the business's usual variation | FAST Standard / ICAEW Financial Modelling Code |
| **Sales history** | By invoice date, excluding VAT; drafts and cancelled invoices are not sales | Accrual basis |
| **Cost of sales** | The larger of the invoices' product costs and the direct-cost expenses (subcontractors, materials, stock…) | No double counting |
| **Trend** | Least squares over the last 12 months, applied only if t ≥ 2 (about 95%), then damped at 0.9 a month | Gardner & McKenzie (1985) |
| **Seasonality** | Only with 24+ months **and** an F-test significant at 1%; ratio-to-moving-average indices | US Census Bureau X-11 / X-13ARIMA-SEATS |
| **This month** | Recorded so far + the days left at the normal rate | — |
| **Payment timing** | Sales collected after the actual days sales outstanding; money owed collected when due | Direct-method cash flow (IAS 7) |
| **Accounting checks** | Cash, receivables and the balance sheet reconcile every month, including equipment and owners' money | Three-statement integrity |
| **Tax, VAT, loans** | Tax set aside as profit is made (UK bands optional); VAT on a cash basis; loans as annuities | HMRC rules |
| **Payroll** | Staff × (pay + employer costs). UK: NI 15% above £5,000, pension 3%. Nigeria: pension 10% + NSITF 1% + ITF 1%. US: FICA 7.65% + FUTA. Rates for 2025/26 | HMRC, The Pensions Regulator, PenCom, IRS |
| **Funding, equipment, bad debts** | Equity is cash, not income; grants are income; equipment depreciated straight line; unpaid sales are a cost | IFRS Framework, IAS 20, IAS 16, IFRS 9 (simplified) |
| **Verdict** | Against doing nothing; a change counts if it exceeds 1% of revenue; cash compared after debts owed; running out of cash judged over the months ahead | Scenario analysis (SR 11-7) |
| **Range** | 90% forecast range: monthly variation plus the uncertainty in the level, trend and seasonality, calibrated (×1.4) and confirmed on separate data | Forecast intervals |
| **Confidence** | Points for history; deductions for estimates, assumptions, standard figures, unpredictable sales and serious data problems | Transparent rule; checked on mock data |
| **Data check** | Gaps, unusual months (modified z > 3.5), duplicates, uncategorised, undated or foreign-currency records, missing costs or cash | Iglewicz & Hoaglin (1993) |
| **Accuracy** | Each run's forecast against the months that have since completed: WAPE and bias, per business and across companies | Forecast evaluation |

### 3.3 Workflows

- **Owner, Simulation page:**
  - The baseline projection loads automatically. It shows this month, the timeline, how each figure was calculated, the data check, the range and confidence.
  - **Business settings** (dashboard card): set tax, VAT, loans, payroll, funding and equipment once, then **"These figures look right"** to confirm.
  - **Run a scenario:** pick one of 13 scenarios (or **Combine changes**), enter its inputs, then run. The result shows the verdict, the reason, the range, robustness and sensitivity.
  - **Run history:** compare runs side by side, check that a run reproduces, and see when a run was made with an earlier model.
- **Agent:** its scenario card uses the same server inputs, so it shows the same figures and verdict as the page.
- **Downloadable report and business assistant:** read the run's verdict, confidence, robustness and range.
- **Admin:** Admin → **Simulation accuracy** shows the accuracy status, alerts, calibration by confidence level, and results by model version.
- **Team, changing the model:** follow MODEL.md section 10:
  1. Bump `MODEL_VERSION`.
  2. Add a change-log entry and a hand-calculated test.
  3. Update MODEL.md, `standards.py` if a value changes, and `model_info.CHANGES`.
  4. **The release gate must pass.** CI runs it on every pull request that touches the simulation.

### 3.4 API (all under `/v1/scenario-intelligence`, signed in; every business and run is access-checked)

| Endpoint | Purpose |
|---|---|
| `POST /do-nothing/run` | Baseline projection (free) |
| `POST /scenario-runs`, `GET /scenario-runs/{id}`, `GET …/{id}/timeline` | Run a scenario, then read it |
| `POST /scenario-runs/{id}/reproduce` | Rerun from the saved snapshot and compare |
| `POST /compare` | 2–6 runs side by side |
| `GET /history`, `DELETE /history` | Run history (with model version); clear one business's history |
| `POST /accuracy` | Forecast accuracy for one business |
| `GET /model` | Model version and what changed |
| `GET /scenario-templates` | The 13 scenarios plus "Combine changes" |
| `GET /admin/accuracy` | Accuracy across all businesses (platform admin only) |

## 4. Running it locally

Follow [scripts/local_supabase/README.md](scripts/local_supabase/README.md). It covers Docker Supabase, building the database from the repository, safe settings (no real email or payments), a test account and sample records.

## 5. Tests and the release gate

```bash
# simulation release gate: tests, independent replication, mock production + holdout, standards review
backend/.venv/Scripts/python scripts/simulation_release_gate.py        # must end: RELEASE GATE: PASSED

# full suites
cd backend && .venv/Scripts/python -m pytest -p no:cacheprovider -q
cd frontend && npx vitest run && npx vite build
```

Results at this push (21 Nov 2026):
- **Release gate:** PASSED (6 of 6).
- **Simulation tests:** 1,114.
- **Full backend:** 3,382 passed.
- **Frontend:** 854 passed; the build succeeds.

Pre-existing failures, unrelated to the simulation and present before this work:
- backend: `test_b6_shared_figures` ×3, `test_marketplace_outreach` ×2, `test_marketplace_team`, `test_s1_accepted_values`, `test_multi_engine_e2e` ×2
- frontend: `AllDatesUk`, `GoalOnboarding`, `QaRound3` ×2, `turnstile`, `ClaimFlow`

With the team's `backend/.env` present, 3 more marketplace tests fail because of that file's marketplace settings; see the local README.

CI: `.github/workflows/simulation-release-gate.yml` installs `backend/requirements-dev.txt` and runs the gate.

## 6. Configuration the team needs

- **No new environment variables, database columns or migrations are required by the simulation.** New data lives in the existing JSON fields.
- **Test tools:** `backend/requirements-dev.txt` pins the pytest version used for the integrated release gate. The gate's tests use explicit event loops and do not require pytest-asyncio.
- **Admin screen:** uses the existing platform admin account (`require_admin`).
- **Local testing only:** a local Supabase. See Section 4.

## 7. Before releasing to production

1. Review this push: code review of `scenario_intelligence/`, `SimulationPage.jsx` and the admin screen.
2. Run the release gate and the full suites on your machine.
3. Click through with a test account (local README, step 5).
4. Check the **2025/26 country rates** in `factors.py` against HMRC, The Pensions Regulator, PenCom/NSITF/ITF and the IRS.
5. Plan the rollout message for owners: results change, and runs are version-stamped.
6. After release, watch **Admin → Simulation accuracy**, and recalibrate after 3–6 months of real data.

## 8. Open items (decisions and owners)

| Item | Owner |
|---|---|
| **Independent human review** of MODEL.md and the evidence (the one partial criterion) | Someone outside this work |
| **Legacy database schemas:** new simulations save their timeline, risk signals and engine results in the existing `scenario_metrics` JSON column. Older timeline-table records remain readable. Unrelated `user_subscriptions` / `idea_validation_results` prerequisites still need review for local setup. | Backend / data |
| **Access checks in other routers:** the simulation now checks access on every endpoint, but other modules' routers should be reviewed for the same gap (`docs/agent-and-security/01-current-state-and-plan.md`) | Backend / security |
| **Dashboard shared figure** (`agent/figures.py`): counts cash over 92 days including the month in progress. The simulation checks it, but the dashboard should consider complete months too | `figures.py` owner |
| **Business settings** are stored per device; saving them on the business profile needs a profile field | Product / backend |
| **Not yet fed automatically:** loans, payroll by person, funding actually received (no records exist in the workspace for them yet) | Modules that would record them |
| **Page's own history** (`financialIntelligence.js`) sales by payment date: the server no longer relies on it, but the Reports page still uses it | Frontend |
| **Agent:** one task per request; the coordinator design and its security fixes are in `docs/agent-and-security/` | Agent owner |
| `test_multi_engine_e2e.py` can't run under pytest; the pre-existing failing tests above | Their module owners |
| **Sources to cite:** price sensitivity, 15% on-costs for other countries (`docs/simulation-audit/REFERENCES.md`) | Simulation owner |
