# Simulation accuracy brief — behaviour changes

The changes address the independent 24 November 2026 report. They preserve money rounding, trend and collection formulas, loan repayment, tax and VAT accounting. Explicit changes to first-month scenario application and existing-loan interest during the rest of the current month are listed below.

## Priority 1: overdue counts and input validation

Overdue means a positive outstanding balance with a due date before today. Approaching means a positive balance due today or in the next seven days. An open invoice without a due date is neither. Archived, cancelled, draft and settled invoices do not contribute. Payment-reminder eligibility remains a separate decision: a financial debt may exist even when sending a reminder is blocked.

The API and form reject out-of-range values. Bad-debt assumptions honour the full 0–100% range, including values above 50%. The form preserves typed signs and blank required inputs. Timeline is 3–24 months; percentages are 0–100 except price changes, which allow -50–200; hires are whole counts 1–100; money is nonnegative; loan terms are 1–360 months. Start/payment months must fit the horizon. Invalid combined steps are rejected. Optional employer on-cost overrides remain optional and their actual default is disclosed.

## Priority 2: consistent figures and cash definitions

Simulation levels use the same invoice-date basis, excluding VAT, and the same most recent three complete months for revenue, direct costs and running expenses. The figures endpoint supplies these canonical simulation inputs to the browser. They are distinct from the dashboard's explicitly labelled cash-received measure over the last 92 days.

Payment terms are amount-weighted invoice terms from the last 12 months. With at least five paid invoices carrying observed payment dates, the amount-weighted observed delay is used instead. Without usable evidence, 30 days is an explicitly labelled assumption. The state, form's figures panel, assumptions and engine use that result.

Cash at the end is bank cash. Cash after VAT owed deducts unpaid VAT. Both definitions appear in the headline and low/central/high range. The separate net-cash measure deducts remaining loans and tax as well; it is labelled accordingly. Table values remain the API's values, including the current-month row.

## Priority 3: scenario behaviour and explanations

Client loss, revenue drop, price change, cost increase and fixed-cost reduction apply in full from their start month. They no longer have an undisclosed first-month phase-in. Hire output and service launches retain their disclosed phase-in. A zero client-loss input remains zero rather than reverting to the largest client's share.

“Delay a Hire” is renamed “Cancel a planned hire”: the existing behaviour removes the planned payroll cost throughout the forecast. Contractor fees default to operating expenses, with a direct-delivery/cost-of-sales option. Country-derived employer on-costs are disclosed; the browser no longer substitutes a separate 15% explanation for the server's country calculation.

Existing-loan interest now accrues during the rest of the current month, pro rata on the existing 30-day model convention. Backtesting uses up to 12 complete test months and labels fewer than six as low reliability. Customer concentration uses the last 12 months. Explanations compare scenario and baseline for the same final month and use saved response figures rather than browser-side projection formulas.

## Evidence and limits

`test_simulation_accuracy_brief.py` contains fixed-date API, timing, validation and all-template accounting/determinism checks. `simulationAccuracy.test.js` checks form validation, shared figures and unchanged API table values. The evidence script generates before/after outputs for all 13 templates using a synthetic GBP fixture. It does not modify earlier registered audit evidence or claim to reproduce the report's private QA2 account.

Verification also exposed a timestamp collision in intake retry controls. A replaced failed attempt is now marked as superseded in its audit record, so a successful same-timestamp retry clears the old retry control; the regression freezes the clock to reproduce it.

Live demo acceptance and independent QA2 reruns are separate from local automated verification. No production or demo data are deleted by this work.


## Verification — 25 November 2026

- Full backend coverage: all 323 files/classes from the complete suite, in three balanced groups. 3,699 passed, four existing skips and seven passing subtests; zero failures.
- Full frontend coverage: all 158 test files and 990 passing tests. A Windows process-worker crash was avoided by using isolated single-thread groups; every file is accounted for once in the final coverage manifest.
- Production build passed. Existing bundle-size advisory remains.
- A real-browser preview of the saved API result rendered at widths 390, 768 and 1440 with no page overflow or browser errors. The table includes the current month; bank cash and cash after VAT reconcile with their central ranges.
- Independent live QA2 account rerun was not performed. Before/after evidence is the explicitly labelled synthetic fixture.
