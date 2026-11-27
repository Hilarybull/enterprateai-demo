# Operations actuals, forecast history and the 14-day trial

## Simulation and monthly actuals

- The current calendar month shows recorded activity only. It does not add remaining-day sales, costs or estimated month-end cash.
- Revenue, running expenses and cost of sales use that month's invoice/expense dates. Operations' `incurred_at` expense date is recognised. Current-month receivables are the outstanding amounts on that month's invoices, including partial payments; older debt remains in the cash collection schedules.
- Recorded cash includes partial receipts and paid expenses. Linking an invoice cost to a supplier bill prevents treating that cost as already paid as well as deducting the bill payment.
- Business Operations records supply both monthly and weekly receivable/payable schedules. Future forecasts retain the existing three-completed-month baseline window (`LEVEL_MONTHS = 3`), including the existing trend/seasonality logic when supported by history.
- New record-based runs start forecasting next month; they do not project a remaining-days period for the current month. Model version: `projection-1.8`.
- Foreign-currency records use stored/pinned conversion rates. Missing conversions are excluded with a note, rather than adding different currencies together.
- The page refreshes records on entry, focus/visibility, Operations changes and every 30 seconds while visible. Changes to the financial records trigger a new projection even when a high-level monthly average happens to stay unchanged.

Cash is derived from recorded payments or the existing supplied cash snapshot; it is not a live bank reconciliation. Missing/backdated records can change recorded actuals. The current month remains explicitly incomplete.

## Saved forecasts

“Save this baseline forecast” stores a separate, unchanged snapshot of the monthly forecast, model, currency and input assumptions. “View saved forecasts” retrieves up to the latest 50 snapshots and compares forecast revenue/costs with the latest recorded actuals for each month. Current-month comparisons are marked “Actual to date”; future actuals stay blank.

The archive is independent of clearing scenario history. Business access is checked on both archive endpoints. A save is not acknowledged without a confirmed database insert; there is no process-memory fallback for these snapshots.

## Vendors, supplier bills and employee pay

Vendor and supplier refer to the same Master records directory. An invoice cost line can optionally choose a vendor. The supplier due date defaults from that vendor's payment terms and can be overridden. The link creates one supplier expense per invoice line, in the same workspace write. Repeated saves update that bill instead of duplicating it.

Server checks reject vendors from another workspace, invalid amounts and conflicting/paid bill changes. Editing an unpaid linked bill's amount/due date also updates the linked invoice cost. Marking a bill paid retains its paid status. A failed Operations save restores the previous lists and reopens the user's entered record.

Employee records now include optional gross salary, monthly/weekly/annual pay frequency, monthly benefits and benefit details. Amounts use the business currency. Selecting an employee for a staff payment prefills monthly pay plus benefits; the user can change it. Active employee compensation supplies payroll projection defaults, and recorded staff expenses prevent adding the same payroll again. Saving an employee alone does not record a payment. Salary/benefit amounts are validated on the server as well as in the form.

## Trial policy

- One 200-credit welcome allocation. Trial access ends 14 days after signup, not 14 days after opening a wallet.
- All feature tiers are available during the trial. At zero AI credits, AI requests prompt an upgrade; deterministic/manual tools remain available until trial expiry.
- After expiry, product endpoints and screens require an upgrade. Authentication, account management and billing remain reachable; records are retained.
- Paid subscriptions, covered team members, grandfathered accounts and explicit admin access grants retain their existing coverage.
- Upgrading removes unused trial credits before issuing the paid allocation. Delayed refunds from pre-upgrade/pre-expiry work cannot return expired trial credits into the paid wallet. Payment receipts, expiry and allocations are idempotent and transactional.
- Eligible existing trial accounts still within their first 14 days are topped up to a total welcome allocation of 200 once. Existing paid allocations are not reset.

## Deployment order

These changes are local and have not been pushed/deployed.

1. Apply `backend/migrations/059_fourteen_day_trial.sql` after the existing credit RPC migrations, including 056. This updates Explorer's credit configuration, handles eligible trial top-ups and installs the atomic upgrade/expiry/refund policy.
2. Apply `backend/migrations/060_forecast_snapshots.sql` for the durable archive.
3. Deploy backend and frontend together. Verify the demo signup/upgrade and archive against its actual migrated database before promoting to production.

The database checks below used an isolated PostgreSQL engine. They did not migrate a live Supabase project, send emails, charge a card or modify live business records.

## Verification

- **1,237 targeted backend checks passed**, covering the simulation accuracy suites, current-month actuals, monthly currency handling, supplier bill synchronization, employee validation, trial boundaries, subscription/payment reliability and credit behavior.
- **52 frontend checks passed**, including supplier due-date defaults, salary/benefit storage, trial gates, forecast comparisons and the real Operations page.
- **Nine Chromium scenarios passed**: simulation/archive, employee records and invoice/vendor forms at 390, 768 and 1440 pixels. No page overflow or browser errors. Screenshots were inspected.
- Production build passed. The existing large-bundle warning remains.
- Isolated PostgreSQL checks passed for migration execution/replay, welcome allocation idempotency, eligible account top-ups, no free-credit rollover, late refunds, paid-credit preservation, database-role execution and forecast storage.

Repeat the database checks from the repository root with an isolated PGlite install:

```powershell
npm install --prefix .tmp/verification-db --no-save --package-lock=false @electric-sql/pglite
node backend/scripts/verify_trial_credit_sql.mjs .tmp/verification-db/node_modules/@electric-sql/pglite/dist/index.js
```

The targeted suites do not substitute for a deployed payment-provider and database integration check.
