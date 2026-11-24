# Simulation Engine: Phase 6, Part 2 ("Defensible Results")

| | |
|---|---|
| **Date** | 21 November 2026 |
| **Model version** | `projection-1.5` → **`projection-1.6`** ([MODEL.md](MODEL.md): sections 8.8–8.10, 12) |
| **Builds on** | [09-phase6-changes.md](09-phase6-changes.md) |
| **Goal** | Make every result checkable and defensible: check the data first, let the owner confirm the figures, keep exact snapshots, compare and combine scenarios, and tell owners when the model has changed |
| **Tests** | [backend/tests/test_simulation_phase6b.py](../../backend/tests/test_simulation_phase6b.py) (14); frontend `SimulationPhase6.test.jsx` (3) |

## 1. What was added

| Feature | What the owner sees | How it works |
|---|---|---|
| **Data check** | "Data check: 0 serious, 1 to check…" under each result, with each issue's cause and fix | `quality.py` (MODEL.md 8.8). Serious issues lower confidence by one point each, at most two |
| **Business settings card, and "figures used"** | Its own card on the Simulation dashboard, grouped: Tax and VAT, Loans, Payroll, Owners and funding, Equipment and other. Above it, every figure the projection used, with its source, and **"These figures look right"** | Settings as before, now grouped and full width. The confirmation is kept per business and sent with each run (`figures_confirmed_at`, stored in the run's parameters). If the figures later change, the card says so |
| **Combine changes** | In the manual scenario panel: "Add this change", then another, then "Run these changes together" | `combined` scenario (MODEL.md 8.9): each change applied in turn, with loans, funding, equipment and payment delays handled together |
| **Check it reproduces** | In the run history: "Check it reproduces", and the answer | `POST …/scenario-runs/{id}/reproduce`: reruns from the saved snapshot. Identical with the same model version |
| **Model-update notice** | "Made with an earlier model (projection-1.4). See what has changed" on older runs | `GET …/model` (version and changes in plain words); history items carry their model version |
| **Compare** | Tick runs in the history, then "Compare selected": verdict, profit change, net cash change (low · base · high), robustness, confidence | `POST …/compare` (2–6 runs, access-checked) |

**Refusal rules.** These were already in place and are kept:
- Nothing is run or charged when nothing is on record (422).
- An estimate is labelled as such.

They're now reinforced: serious data problems are shown first and lower the confidence, so a weak basis can't produce a confident-looking result.

## 2. A regression the release gate caught

On its first run, the Phase 7 release gate (11-phase7-changes.md) failed check P7 ("high confidence means lower error") on both mock sets. The new data check judged "no costs" only from the monthly cost **levels**. Businesses whose costs arrive only as **history** got a false "serious" issue, and with it a confidence penalty. Fixed: the history counts too. A regression test was added, and the gate passed afterwards. This is exactly what the gate is for.

## 3. Verification

| Check | Result |
|---|---|
| Phase 6 part 2 tests | 14 passed. Includes the modified z-score by hand (160 among 100s gives z = 40.5), each kind of issue, clean data reporting nothing, the confidence penalty, price + hire combined by hand (−34,997.35), loan + equipment combined, a saved run reproducing exactly, an earlier-model run explaining the change, and access on the new endpoints |
| Frontend | Settings groups cover every setting exactly once; the confirmation signature notices changes; the dashboard shows the settings card, the figures used and the model notice |
| Release gate | Passed (11-phase7-changes.md) |

## 4. Coordination

- **Access:** the new endpoints use the same access check as the rest (`_require_run`).
- **History:** history items gain `model_version` and `outcome`.
- **Business settings:** still stored per device. Saving them on the business profile is a team decision (a profile field), unchanged from Phase 1.
- **Database:** no new columns.
