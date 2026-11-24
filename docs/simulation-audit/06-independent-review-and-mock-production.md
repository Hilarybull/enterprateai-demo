# Simulation: Independent Review and Mock Production Run

| | |
|---|---|
| **Date** | 19 November 2026 |
| **Model reviewed** | `projection-1.2` (unchanged by this work: **no application code was changed**) |
| **Builds on** | [05-phase3-changes.md](05-phase3-changes.md), [MODEL.md](MODEL.md) |
| **Evidence** | [evidence/independent_review/](evidence/independent_review/) and [evidence/mock_production/](evidence/mock_production/), each script rerunnable with a fixed seed |
| **Purpose** | Close the two gaps left after Phase 3: (1) the model had not been checked independently of how it was built; (2) its accuracy had not been measured against a known truth before going to production |

---

## 1. Summary

| Question | Answer |
|---|---|
| Does the code do what MODEL.md says? | **Yes, with one defect and three places where MODEL.md is not precise enough.** A model rebuilt from MODEL.md alone matched the application in **400 of 400** random projections (every month's revenue, costs, profit and cash, and the closing balances) and **300 of 300** baseline forecasts, once three unclear points in MODEL.md were settled. Verdicts matched in **348 of 350**. The 2 differences are a real defect (Section 2.3) |
| Is the forecast accurate enough to go to production? | **Within the monitoring thresholds, yes:** pooled error (WAPE) **10.9%** against a 25% threshold, bias **−1.3%** against ±10%, and it beats the naive forecast for 68% of businesses. **But 3 of the 7 pre-registered checks failed**, with one clear cause: seasonality is applied to businesses that have none (Section 3.4) |
| Are scenario results right? | **Yes, exactly.** Given the true inputs, every verdict and every profit figure was right (160 of 160, 0.0000% error). With standard figures, the verdict matched the truth in 71.9% of cases, exactly as predicted, and **43 of the 45 wrong verdicts were flagged "not robust"** |
| What should change before production? | Test seasonality for significance before applying it (model change `projection-1.3`, Section 5). Fix the overdrawn-today verdict edge case. Make MODEL.md precise on the three points found |

---

## 2. Independent review

### 2.1 Method

This follows the replication approach used in model validation (SR 11-7: "independent review", "benchmarking"):

1. **Shadow model.** [`shadow_model.py`](evidence/independent_review/shadow_model.py) re-implements the projection, the baseline method and the verdict from **MODEL.md only**. It imports nothing from the application. Where MODEL.md did not say exactly what to do, the reading taken is marked `READING (n)`.
2. **Comparison.** [`compare.py`](evidence/independent_review/compare.py) runs the application and the shadow model on the same random inputs (fixed seed 20261119):
   - 400 businesses × 7 scenario types (no change, price change, cost increase, client loss, revenue drop, hiring, a new loan)
   - horizons of 3–24 months
   - payment terms, money owed both ways, tax and existing loans
   - plus 300 random revenue histories of 1–40 months for the dated baseline method

   Every month and every closing figure is compared to the penny.
3. **Regression.** All simulation tests were rerun, and the evidence probes were rerun and compared with their saved output.

**Limit of independence:** the shadow model was written by the same AI assistant that built Phases 0–3, from the specification and not from the code. That makes this a documented replication, not an independent sign-off. **A person outside this work should review this document, MODEL.md and the scripts before production** (about half a day).

### 2.2 Results

| Check | Result |
|---|---|
| Projections, first run | 87 of 400 matched. **Every difference was in cash timing**, traced to how MODEL.md describes the schedule of money already owed (gap 1 below) |
| Projections, after settling gaps 1–2 | **400 of 400 match** in every month and closing figure |
| Baseline method (seasonality, trend, damping, level) | **300 of 300 match**, after settling gap 3. Differences of a few pounds come from seasonal indices being stored to 4 decimals |
| Verdicts | **348 of 350 match.** The 2 differences are the defect in 2.3 |
| Simulation tests (Phases 0–3) | **747 passed** |
| Evidence probes (Phase 1 and Phase 2) | **Identical** to the saved output |

**Where MODEL.md was not precise enough to rebuild the model** (the code is right in each case; MODEL.md should say this):

| # | Point | What the code does |
|---|---|---|
| 1 | Money already owed (`pending_receivables_schedule`, `pending_payables_schedule`) | Index 0 = due this month or overdue; index *i* = *i* calendar months ahead. With no date, index 0 joins index 1 in month 1 |
| 2 | Price change "ramp 1–2 months" | The ramp is the sales cycle in months, capped at 2 (30-day cycle = 1 month, longer = 2) |
| 3 | A calendar month whose seasonal index is 0 | That month is left as it is when deseasonalising |

Two further readings were confirmed exactly as the shadow model took them: "progress" over a ramp is `min(1, m / ramp)`, and the sales cycle in months is `ceil(days / 30)`, kept within 1–3.

### 2.3 Defect found: a business already overdrawn today

**What happens:** when cash is **already below zero today**, the code counts today (period 0) as "running short" in **both** the no-change and the scenario projection. Rules 2 and 2a ("keeps cash above zero" / "runs short later") then never apply.

**Example (one of the 2 cases):**
- The business is overdrawn today and stays overdrawn if nothing changes.
- A £50,000 loan keeps cash positive from month 1.
- The page says **"no material change"**, while the cash line shows +£46,912.

**Effect:** the verdict understates a scenario that clears an existing overdraft. This is rare, but it affects exactly the businesses for which the verdict matters most.

**Fix (needs change control):** measure "runs short" over the projection months (month 1 onwards), and when cash is already below zero today, say so in the reason. Add a hand-calculated test. Bump `MODEL_VERSION`.

---

## 3. Mock production run (accuracy against a known truth)

### 3.1 Method

1. **Generate** ([`generate.py`](evidence/mock_production/generate.py), which doesn't import the application). It creates 200 businesses of 7 types, each from a known rule: level, monthly growth or decline, seasonal pattern and random noise. It generates their history up to the run date (19 November 2026, with November only 19 days in) and their **actual** revenue for December 2026 to May 2027.
2. **Write down the expected results first.** Also in `generate.py`:
   - the **oracle error**: the error of the true expected values, i.e. the noise no method can remove
   - the method's **built-in (systematic) error**: the shadow model run on noise-free history
   - the scenario verdicts predicted from the true inputs
   - the pass marks

   The files are fingerprinted (SHA-256) in [`PREREGISTRATION.txt`](evidence/mock_production/PREREGISTRATION.txt), and `evaluate.py` refuses to run if they have changed.
3. **Run the real simulation** ([`evaluate.py`](evidence/mock_production/evaluate.py)). For each business it:
   - runs the projection, with uncertainty and confidence, using only what a real run would see
   - saves it as the service saves a run
   - then measures accuracy on 1 June 2027 with the application's own **accuracy module**, as if the months had been recorded

| Type | Businesses | History | Rule |
|---|---|---|---|
| A Steady | 30 | 24–36 months | Flat, noise 5–20% |
| B Growing | 30 | 12–30 | +1–3% of the starting level a month, noise 5–10% |
| C Seasonal | 30 | 30–40 | Seasonal swing 15–35%, noise 5–10% |
| D Seasonal and growing | 30 | 30–40 | Both |
| E Young | 30 | 2–8 | Flat, noise 10% |
| F Declining | 30 | 12–24 | −1–3% a month |
| G Sudden drop | 20 | 18–30 | Flat, then −30% two months before the run (a stress case, not a pass mark) |

### 3.2 Forecast accuracy (December 2026 to May 2027)

| Type | Simulation WAPE | Oracle (best possible) | Naive | Bias | Predicted bias | Actual inside low–high range |
|---|---|---|---|---|---|---|
| A Steady | 15.2% | 9.5% | 13.0% | +1.0% | 0.0% | 60% |
| B Growing | 11.0% | 6.9% | 10.7% | −6.2% | −2.0% | 47% |
| C Seasonal | 8.8% | 5.3% | 30.8% | −0.1% | 0.0% | 90% |
| D Seasonal and growing | 9.4% | 5.3% | 23.8% | −3.3% | −1.5% | 83% |
| E Young | 9.4% | 8.5% | 10.7% | +1.0% | 0.0% | 83% |
| F Declining | 11.5% | 6.5% | 16.9% | +4.2% | +4.9% | 47% |
| G Sudden drop | 11.9% | 4.0% | 5.5% | +9.8% | +3.0% | 65% |

WAPE = total absolute error ÷ total actual. Bias: positive = forecasts too high. Naive = "next month = last complete month".

### 3.3 Pass marks (set before the run)

| | Check | Result | |
|---|---|---|---|
| P1 | Pooled WAPE (A–F) ≤ 25% | **10.9%** | ✅ |
| P2 | Pooled bias (A–F) within ±10% | **−1.3%** | ✅ |
| P3 | Each type's WAPE ≤ 1.5 × oracle + built-in error + 1 | All within. Steady (A) only just: 15.2 against 15.2 | ✅ |
| P4 | Each type's bias within 3 points of the predicted bias | Growing (B) −6.2% against −2.0% predicted | ❌ |
| P5 | Beats the naive forecast for ≥ 60% of businesses | **68%** | ✅ |
| P6 | Actual 6-month revenue inside the low–high range for ≥ 90% | **68%** | ❌ |
| P7 | "High" confidence runs have lower error than "medium/low" | High 11.3% (150) vs medium/low 9.4% (30) | ❌ |
| G | Sudden drop: error above A, forecasts too high (expectation, not a pass mark) | Bias +9.8% as expected; error 11.9%, below A's 15.2% | Partly |

### 3.4 Why three checks failed (diagnosis)

[`diagnose.py`](evidence/mock_production/diagnose.py) reruns the same forecasts with one part of the method switched off **in memory** (no model change):

| Type | As built | Seasonality off | Trend off |
|---|---|---|---|
| A Steady | 15.2% | **9.5%** (= oracle) | 14.4% |
| C Seasonal | **8.8%** | 36.5% | 8.4% |
| D Seasonal and growing | **9.4%** | 27.3% | 9.7% |
| F Declining | **11.5%** | 11.5% | 17.5% |

1. **Seasonality is applied when there's none (main cause).** Any business with 24+ months gets a seasonal pattern, even when its month-to-month differences are only noise. All 30 steady businesses had it applied, which raised their error from 9.5% (the best possible) to 15.2%. That's worse than the naive forecast. For genuinely seasonal businesses the same feature is essential (8.8% against 36.5% without it). **Fix:** apply seasonality only when it's statistically significant, as the trend already is (|t| ≥ 2). This also explains P7: "high" confidence goes to businesses with long histories, which are exactly the ones exposed to the spurious pattern.
2. **Growth is under-forecast more than predicted (P4).** The trend was detected in only 13 of 30 growing businesses. With 12–30 months and 5–10% noise, the |t| ≥ 2 test often misses real growth of 1–3% a month, and the forecast then stays at the recent average. The damping (φ = 0.9) also holds the forecast back by design. The pooled bias stays within limits, but growing businesses are told they'll earn about 6% less than they will. **Fix:** consider a lower damping or a test over all available months, and measure the effect with this same mock run.
3. **The low–high range is narrower than real outcomes (P6).** The range moves revenue by the business's typical monthly swing. It doesn't include the uncertainty in the level and trend themselves, which doesn't average out over six months. So real totals fell outside it in 32% of cases. MODEL.md already says the range "is not a probability", but owners will read it as one. **Fix:** widen it by the measured forecast error (from the backtest, or tracked accuracy once available). Or describe it plainly as "if revenue swings as it usually does" and show the backtest error beside it.

### 3.5 Scenarios with a known true answer

160 businesses (100 price changes with a true customer price sensitivity of 0.3–2.5, and 60 hires with true employer on-costs of 8–28%). The truth was computed with the shadow model and the **true** inputs.

| | Check | Result | |
|---|---|---|---|
| S1 | Given the true inputs, verdict right and 12-month profit within 0.1% | **160 of 160 right, 0.0000% error** | ✅ |
| S2 | With standard figures, the verdict is the one MODEL.md predicts | **160 of 160.** It agrees with the true verdict in **71.9%**, exactly the 71.9% predicted | ✅ |
| S3 | Wrong verdicts flagged "not robust" when the true input lies inside the tested range | **26 of 27 (96%)**. Outside the range: 17 of 18 also flagged | ✅ |

**What this means for owners:** the scenario engine calculates exactly. When an owner doesn't know a key input, such as how price-sensitive their customers are, a single verdict is wrong about 1 time in 4. But almost every such verdict carries the "not robust" warning, and the owner is told which input it depends on.

---

## 4. Against the standards (updated)

| Standard | Before this review | Now |
|---|---|---|
| FAST / ICAEW: built-in checks, consistent periods | Meets | Meets (confirmed by replication) |
| Three-statement integrity | Meets | Meets (400/400 replicated) |
| SR 11-7: documentation | Mostly | **Mostly.** Three points in MODEL.md need sharpening (2.2) |
| SR 11-7: independent validation | Missing | **Replication done; human sign-off still needed** (2.1) |
| SR 11-7: outcomes analysis | Built, no evidence | **Evidence against a known truth:** within thresholds overall; three weaknesses identified with causes (3.4) |

---

## 5. Recommended next steps (in order)

| # | Step | Type |
|---|---|---|
| 1 | **Significance test for seasonality** before applying it. Rerun `evaluate.py` and `diagnose.py`: A should fall to about 9.5% and C/D should keep their accuracy. Expected to fix P3's margin and help P6 and P7 | Model change `projection-1.3` (MODEL.md section 10) |
| 2 | **Overdrawn-today verdict** (2.3) | Model change, same version |
| 3 | **Widen or relabel the low–high range** using measured forecast error | Model change |
| 4 | Review trend detection and damping for growing businesses, measured with the same mock run | Model change, after 1–3 |
| 5 | **MODEL.md:** state the three points in 2.2 | Documentation |
| 6 | **Human reviewer** signs off this document, MODEL.md and the scripts | Governance |
| 7 | Keep the mock production run as a **standing release check**: any model change must rerun it and report the table in 3.3 | Process |

Steps 1–3 are small, contained changes. Step 7 turns this exercise into a permanent safeguard.
