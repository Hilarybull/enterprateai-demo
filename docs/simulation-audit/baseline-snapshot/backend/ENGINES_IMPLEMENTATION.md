# EnterprateAI Multi-Engine System Implementation

## Overview
This document describes the complete implementation of the EnterprateAI Blueprint v3 multi-engine system for comprehensive business analysis and adaptive scenario intelligence (ASI).

## Architecture

### Engines (Under `/backend/app/engines/`)

#### 1. **Survival Engine** (`survival/`)
Determines if a business can continue operating without running out of cash.

**Input:**
- Cash balance, monthly revenue/expenses
- 6-month historical cashflow (optional)
- Available liquidity (credit, overdraft, committed revenue)

**Output:**
- Metrics: runway_months, burn_rate, volatility_ratio, liquidity_buffer
- Scores (0–100): runway_score, burn_score, volatility_score, survival_score
- Classification: STRONG_SURVIVAL → CRITICAL_SURVIVAL_RISK
- Risk flags with severity levels (LOW–VERY_HIGH)
- Recommendations based on risk priority

**Key Calculations:**
- Runway = cash_balance / burn_rate
- Burn Rate = abs(negative cashflow)
- Survival Score = 0.40 × runway + 0.30 × burn + 0.30 × volatility

---

#### 2. **Viability Engine** (`/backend/app/modules/idea_validation/`)
Evaluates financial viability across 8 dimensions.

**Dimensions (with weights):**
- 25% Unit Economics (margin)
- 15% Break-even Analysis
- 15% Runway
- 15% Capacity
- 12% Market Proof
- 8% Cash Timing
- 5% Sales Cycle
- 5% Client Concentration

**Output:**
- Metrics: revenue, costs, margin, break_even_months, runway_months
- Score: 0–100 (STRONG → WEAK)
- Reason codes for root cause analysis
- Actionable recommendations
- Optional market fit integration (10% weight)

---

#### 3. **Stability Engine** (to be enhanced from `scenario_intelligence/`)
Measures business stability and resilience.

**Key Metrics:**
- Stability score based on revenue-cost dynamics
- Risk factor analysis: customer concentration, capacity utilization, cash runway
- Classification: stable → risk
- Recommendations for stabilization

---

#### 4. **Growth Engine** (`growth/`)
Evaluates business growth trajectory and market expansion capacity.

**Key Metrics:**
- Monthly/quarterly/annual growth rates
- Growth consistency score (volatility analysis)
- Market penetration percentage
- Production capacity utilization
- Expansion headroom

**Output:**
- Classification: EXPONENTIAL_GROWTH → DECLINING
- Risk flags: declining with volatility, capacity constraints, limited market runway
- Recommendations: team expansion, marketing investment, revenue stabilization

---

#### 5. **Fragility Engine** (`fragility/`)
Identifies structural vulnerabilities and single points of failure.

**Risk Dimensions:**
- Client concentration (top-client dependency)
- Key person risk (founder dependency)
- Revenue concentration (product/service concentration)
- Operational fragility (supplier, technology, redundancy)
- Financial fragility (debt, fixed costs, working capital)

**Output:**
- Classification: ROBUST → CRITICAL_FRAGILITY
- Critical vulnerabilities (single points of failure)
- Recommendations for resilience building

---

#### 6. **Scenario Engine Orchestrator** (`scenario/`)
Orchestrates all engines in response to scenario changes.

**Process:**
1. Store baseline states from all engines
2. Apply scenario changes deterministically
3. Recompute all engines with modified state
4. Calculate deltas per engine
5. Compute ranking score using weighted formula
6. Generate timeline and recommendations
7. Detect ASI triggers (high fragility, survival risks)

**Scenario Ranking Formula:**
```
score = 0.25×viability_delta + 0.20×survival_delta + 0.20×stability_delta
        + 0.20×growth_delta + 0.15×fragility_delta (inverted)
```

---

### Integration Points

#### Orchestration Service
File: `/backend/app/modules/scenario_intelligence/orchestration_service.py`

Provides:
- `run_full_engine_suite()`: Execute all engines on a business state
- `run_scenario_with_all_engines()`: Full multi-engine scenario simulation

---

## API Routes

### Existing (to be enhanced):

1. **POST `/v1/scenario-intelligence/risk-detection/run`**
   - Now returns risk signals from all engines

2. **POST `/v1/scenario-intelligence/recommendations/generate`**
   - Now generates recommendations from all engine outputs

3. **POST `/v1/scenario-intelligence/scenario-runs`**
   - Now orchestrates all engines for scenario simulation

---

## Data Model

All engines follow a consistent contract pattern:

```python
class EngineInput:
    business_id: str
    # Engine-specific inputs

class EngineMetrics:
    # Computed analytical metrics

class EngineScores:
    # Dimension scores (typically 0–100)
    aggregate_score: int

class EngineOutput:
    engine: str  # "survival", "growth", etc.
    version: str
    metrics: EngineMetrics
    scores: EngineScores
    classification: Dict[str, Any]  # Classification label and details
    risk_flags: List[RiskFlag]
    recommendations: List[str]
    trace: Dict[str, Any]  # Debug/transparency info
```

---

## Deployment Checklist

- [x] Survival Engine implemented and tested
- [x] Growth Engine implemented and tested
- [x] Fragility Engine implemented and tested  
- [x] Scenario Engine Orchestrator implemented
- [x] Orchestration Service integration layer
- [x] Update scenario intelligence router to use multi-engine
- [x] Update frontend schemas to include all engine outputs
- [x] Comprehensive testing across all engines ✅ E2E tests PASSED
- [ ] Performance optimization for large datasets
- [ ] Documentation and API reference

---

## Integration Status

### ✅ Completed Integrations

1. **Service Layer** (`orchestration_service.py`)
   - `run_full_engine_suite()` — executes all 5 engines on a business state
   - `run_scenario_with_all_engines()` — full multi-engine scenario simulation
   - All engines properly initialized and wired together

2. **Scenario Service** (`service.py`)
   - `create_scenario_run()` now calls multi-engine orchestration
   - Stores `multi_engine` output with scenario run document (non-breaking)
   - Gracefully handles orchestration failures (fallback to legacy behavior)

3. **API Schemas** (`schemas.py`) 
   - `ScenarioRunResult` now exposes:
     - `multi_engine: Dict[str, Any]` — full orchestration output
     - `survival_delta`, `growth_delta`, `fragility_delta` — engine-specific deltas
   - All fields optional to maintain backward compatibility

4. **End-to-End Testing**
   - ✅ Survival Engine: $80K cash, 85/100 score, STRONG_SURVIVAL classification
   - ✅ Growth Engine: 38/100 score, STAGNANT classification
   - ✅ Fragility Engine: 50/100 score, BRITTLE classification
   - ✅ Stability Engine: 62/100 score
   - ✅ Scenario Orchestrator: Multi-engine scenario execution working
   - All 5 engines validated with sample business data

---

## Test Coverage

### Test Suite: `test_multi_engine_e2e.py`

**Test 1: Full Engine Suite (Baseline)**
- Input: Sample business state (moderate risk)
  - $50K monthly revenue, $45K costs, $80K cash
  - 45% client concentration, 72% capacity utilization
  - 8 clients, 2 approaching receivables
- Output: Complete multi-engine analysis with metrics, scores, classifications, risk flags
- Result: ✅ PASSED

**Test 2: Multi-Engine Scenario Orchestration**
- Scenario: 15% price increase (effective month 1, 6-month horizon)
- Process: Compute baseline for all engines → apply scenario → recompute all engines → rank
- Result: ✅ PASSED — scenario outputs generated correctly across all engines

---

## System Readiness
