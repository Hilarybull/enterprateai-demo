# Simulation Audit: Before and After

> Team guide (setup, how it works, testing): [SIMULATION_README.md](../../SIMULATION_README.md).

The scenario simulation was audited on 16 November 2026 and brought to a recognised standard for financial modelling in four phases, completed on 18 November 2026.

## Reading order

| Document | What it covers |
|---|---|
| [01-baseline-findings.md](01-baseline-findings.md) | **Before.** How the simulation worked, findings F1–F12, the 14-criterion scorecard (0 met). Frozen: never edited |
| [02-phase0-changes.md](02-phase0-changes.md) | Phase 0, stop misleading output: cash that collects what is owed, one verdict rule, engines on real data only |
| [03-phase1-changes.md](03-phase1-changes.md) | Phase 1, sound model: reliable baseline, price response, hiring and launch costs, tax, VAT and loans, balance check, 24 months, 13-week view |
| [04-phase2-changes.md](04-phase2-changes.md) | Phase 2, trust and transparency: ranges, robustness, sensitivity, input sources, confidence, KPIs; missing data no longer scored as good news |
| [05-phase3-changes.md](05-phase3-changes.md) | Phase 3, validation and governance: accuracy against actual results, 300-case invariant testing, one source of truth, final scorecard, open items for the team |
| [06-independent-review-and-mock-production.md](06-independent-review-and-mock-production.md) | Review and pre-production test (19 Nov): the model rebuilt from MODEL.md matches the code (400/400); accuracy against a known truth on 200 mock businesses (WAPE 10.9%, bias −1.3%; 3 of 7 checks failed, cause found); scenario engine exact; next model changes |
| [07-phase4-changes.md](07-phase4-changes.md) | Phase 4, fix before production (model 1.3): seasonality only when significant, overdrawn-today verdict, calibrated 90% range, confidence that reflects predictability, page load order, access checks on every endpoint. Holdout test: 7 of 7 + 3 of 3 |
| [08-phase5-changes.md](08-phase5-changes.md) | Phase 5 (model 1.4): funding and grants, payroll with UK / Nigeria / US employer costs, owner drawings and dividends, equipment and depreciation, bad debts, direct costs, UK corporation tax; two new scenarios; replicated 300/300 |
| [09-phase6-changes.md](09-phase6-changes.md) | Phase 6, part 1 (model 1.5): the screenshot investigated (cost of sales £100, 50-day terms, missing expense dates, payment-date sales); inputs now built from the business's records; the current month shown; every figure explained with its standard |
| [10-phase6-part2-changes.md](10-phase6-part2-changes.md) | Phase 6 part 2 (model 1.6): data check, combined scenarios, reproduce / compare / model notices, settings card with confirmed figures |
| [11-phase7-changes.md](11-phase7-changes.md) | Phase 7: accuracy across all companies (admin), standards register, release gate in CI, **final scorecard: 16 of 17 met** |
| [MODEL.md](MODEL.md) | **The model as it now is.** Versioned specification, defaults, validation, change control |
| [REFERENCES.md](REFERENCES.md) | R&D record: every standard, institution and method used, how it was used, and which sources still need citing |

## Proof

- [baseline-snapshot/](baseline-snapshot/) holds the original code, with SHA-256 fingerprints in `MANIFEST.txt`.
- [evidence/](evidence/) holds probes that run fixed sample businesses through the code: `baseline_probe` (original code) and `phase0/1/2_probe` (after each phase), each with its saved output.

## Headline results

| | Before | After |
|---|---|---|
| A profitable business owed £25,000 | Shown running out of cash: **−£42,000, "critical"** | **+£83,000**; cash, receivables and balance sheet reconcile every month |
| +50% price | Profit more than doubles, verdict **"neutral"** | Verdict follows profit and cash; customers' response included; shown as **not robust** when it depends on how customers react |
| Engine scores | Same changes for a strong and a weak business (fixed table) | Recomputed from each business; engines without data say **"not assessed"** |
| Missing data | Scored as acceptable (75, 85, 60…) | Left out, with coverage and confidence shown |
| Uncertainty | One precise figure | Low / base / high, sensitivity, confidence, every input's source |
| Accuracy | Never measured | Forecasts stored and checked against actual months; backtest against the naive method |
| Tests | None for the simulation's figures | **747** simulation tests (hand-calculated, invariants on 300 random cases) |
| Scorecard (14 criteria) | **0 met**, 4 partial | **14 met** |

## Test results at completion (18 Nov 2026)

- **Backend:** 3,029 passed; 9 failures, all pre-existing and outside the simulation (each verified on a copy with every change reverted).
- **Frontend:** 843 passed; 6 failures, all pre-existing.
- **Build:** the production build succeeds.
