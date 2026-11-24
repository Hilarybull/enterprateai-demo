# Simulation integration verification — 24 November 2026

The `projection-1.6` simulation from the supplied `enterprateai-demo-main` folder is integrated into the current development app. This change has not been pushed or deployed.

## Included

- Integrated projections, record-derived baselines, uncertainty, sensitivity, data checks, input explanations and model-version notices.
- Combined scenarios, saved-run comparison and reproduction, forecast accuracy and the admin accuracy screen.
- Consistent scenario figures and verdicts in Agent scenario cards, business-assistant context and downloadable reports.
- Correct margin-of-safety labels and missing-data treatment in the shared validation calculations and their consumers.
- Release-gate scripts, model documentation, original evidence and CI checks for the model, screen and reports.

Explorer keeps its free baseline. Paid recommendations remain gated. Current authentication, onboarding, welcome email, tender administration, document upload handling and general Agent conversation behavior were not replaced with the demo's older versions. A pre-integration backup was saved outside the app repository.

## Database compatibility

The live database lacks `scenario_runs.risk_signals` and several of the expanded timeline columns. Sending the demo's complete rows directly would fail and leave saved runs only in process memory.

New runs therefore put their complete timeline, risk signals and supplementary engine output in `scenario_metrics._saved_result`, using the existing JSON column. The public run/timeline readers restore those fields. Runs saved through the older timeline table remain readable. No new database columns are required for this integration.

Verification used a temporary synthetic business identifier and a synthetic scenario. The run was saved to the real database, its memory caches were cleared, and its timeline and engine output were recovered from the database. The temporary run and recommendations were then removed. No customer business or paid scenario allowance was used.

## Verification

| Check | Result |
|---|---|
| Simulation release gate | All 6 checks passed |
| Simulation tests | 1,117 passed |
| Independent replication | Zero projection differences; 350/350 verdicts and 300/300 baselines agree |
| Additional financial-factor replication | 300/300 businesses agree |
| Holdout evaluation | All 10 marks passed |
| Original evaluation | 9 marks passed; the previously documented P4 growth-bias exception remains |
| Standards register | No overdue review; recorded review date 21 November 2026 |
| Simulation/report/admin and current chat screen checks | Passed, including Explorer's free-baseline regression |
| Frontend full run | 974 passed across all 155 test files (24 November regression cleanup) |
| Production frontend build | Passed; existing CSS/minification and bundle-size warnings remain |
| Live model endpoint | HTTP 200, `projection-1.6` |
| Live free baseline | HTTP 200; cash, receivables and balance sheet reconcile; uncertainty included |

The initial full backend run had 3,562 passes, 62 failures and 4 skips. An isolated pre-integration copy reproduced 61 of those failures. The one integration fixture failure was corrected to include the business identifier required by the new access checks. A shared test-loop fix also resolved 15 existing test-order failures. Rechecking the reported cases left 46 failures, all reproduced before integration. The subsequent 24 November cleanup resolved the reported failures. The full backend run completed with 3,629 passed, four skipped and two failures from test versions collected before their final updates; both updated cases then passed separately. Seven subtests also passed. The full frontend suite passed all 974 tests in 155 files, and the production build passed. No test was deleted or skipped as a substitute for fixing a failure.

## Portability fixes

The imported evidence files were registered with CRLF line endings but checked out with LF. The evaluators now accept only that line-ending difference; tests confirm that changing a numeric value still fails the original registration. Expected results and registered hashes were not rewritten.

The development pytest version is pinned to the version used for this integration's release gate. CI also runs the simulation screen/report checks and builds the frontend.

## Remaining review

The model's independent human review, country-rate review and eventual calibration against production outcomes are still required. Business settings remain stored per device, as documented in the supplied upgrade. Payroll, loan and received-funding feeds are not automatically complete. See `SIMULATION_README.md` and the model audit for the original open items.
