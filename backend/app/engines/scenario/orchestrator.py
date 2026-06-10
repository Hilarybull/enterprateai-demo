"""Master Scenario Engine Orchestrator (Blueprint v3).

Each scenario type is translated into deterministic score adjustments across engines.
Ranking formula: 0.30×viabilityDelta + 0.25×survivalDelta + 0.20×stabilityDelta + 0.25×growthDelta
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MultiEngineScenarioInput:
    """Input contract for multi-engine scenario orchestration."""
    scenario_id: str
    business_id: str
    tenant_id: str

    # Base state outputs — engine score dicts expected under "scores" key
    viability_state: Optional[Dict[str, Any]] = None
    survival_state: Optional[Dict[str, Any]] = None
    stability_state: Optional[Dict[str, Any]] = None
    growth_state: Optional[Dict[str, Any]] = None
    fragility_state: Optional[Dict[str, Any]] = None

    # Scenario definition
    scenario_type: str = ""
    scenario_changes: List[Dict[str, Any]] = field(default_factory=list)
    parameters: Dict[str, Any] = field(default_factory=dict)

    timeline_months: int = 6
    mode: str = "deterministic"


@dataclass
class MultiEngineScenarioOutput:
    """Output contract for multi-engine scenario orchestration."""
    scenario_id: str
    business_id: str
    engine_version: str = "orchestrator_v2"

    baseline_states: Dict[str, Any] = field(default_factory=dict)
    scenario_states: Dict[str, Any] = field(default_factory=dict)

    viability_delta: Optional[Dict[str, Any]] = None
    survival_delta: Optional[Dict[str, Any]] = None
    stability_delta: Optional[Dict[str, Any]] = None
    growth_delta: Optional[Dict[str, Any]] = None
    fragility_delta: Optional[Dict[str, Any]] = None

    scenario_ranking_score: float = 0.0
    risk_delta: List[Dict[str, Any]] = field(default_factory=list)
    recommendation_delta: List[Dict[str, Any]] = field(default_factory=list)

    timeline: List[Dict[str, Any]] = field(default_factory=list)
    state_result: str = "neutral"

    asi_triggers: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "business_id": self.business_id,
            "engine_version": self.engine_version,
            "baseline_states": self.baseline_states,
            "scenario_states": self.scenario_states,
            "viability_delta": self.viability_delta or {},
            "survival_delta": self.survival_delta or {},
            "stability_delta": self.stability_delta or {},
            "growth_delta": self.growth_delta or {},
            "fragility_delta": self.fragility_delta or {},
            "scenario_ranking_score": self.scenario_ranking_score,
            "risk_delta": self.risk_delta,
            "recommendation_delta": self.recommendation_delta,
            "timeline": self.timeline,
            "state_result": self.state_result,
            "asi_triggers": self.asi_triggers,
        }


# ---------------------------------------------------------------------------
# Score extraction helpers
# ---------------------------------------------------------------------------

def _safe_score(state: Optional[Dict], *keys: str, default: int = 50) -> int:
    if not state:
        return default
    scores = state.get("scores") or state
    for key in keys:
        val = scores.get(key)
        if isinstance(val, (int, float)):
            return int(val)
    return default


def _extract_baselines(inp: MultiEngineScenarioInput) -> Dict[str, int]:
    return {
        "viability": _safe_score(inp.viability_state, "score", "viability_score"),
        "survival":  _safe_score(inp.survival_state,  "survival_score", "score"),
        "stability": _safe_score(inp.stability_state, "stability_score", "score"),
        "growth":    _safe_score(inp.growth_state,    "growth_score", "score"),
        "fragility": _safe_score(inp.fragility_state, "fragility_index", "fragility_score"),
    }


# ---------------------------------------------------------------------------
# Scenario impact tables
# ---------------------------------------------------------------------------
# Each entry: (viability_adj, survival_adj, stability_adj, growth_adj, fragility_adj)
# fragility adj is INVERTED (positive = less fragile = lower index)
# All values are in score points; parameterized entries scale from these.

_SCENARIO_BASE_IMPACT: Dict[str, Dict[str, float]] = {
    "hire_staff": {
        "viability": 2,
        "survival": -6,      # higher costs reduce cash runway
        "stability": 8,      # reduced key-person dependency
        "growth": 5,
        "fragility": -8,     # fragility improves (less key-person risk)
    },
    "contractor_addition": {
        "viability": 2,
        "survival": -3,
        "stability": 5,
        "growth": 4,
        "fragility": -5,
    },
    "price_change": {
        "viability": 6,
        "survival": 8,
        "stability": 3,
        "growth": 4,
        "fragility": -6,
    },
    "client_loss": {
        "viability": -8,
        "survival": -12,
        "stability": -10,
        "growth": -5,
        "fragility": 12,     # positive = more fragile
    },
    "revenue_drop": {
        "viability": -7,
        "survival": -10,
        "stability": -6,
        "growth": -4,
        "fragility": 8,
    },
    "payment_delay": {
        "viability": -2,
        "survival": -8,
        "stability": -4,
        "growth": -2,
        "fragility": 6,
    },
    "cost_increase": {
        "viability": -5,
        "survival": -7,
        "stability": -3,
        "growth": -3,
        "fragility": 5,
    },
    "service_launch": {
        "viability": 7,
        "survival": -4,      # launch costs
        "stability": -2,
        "growth": 12,
        "fragility": -3,
    },
    "reduce_fixed_cost": {
        "viability": 4,
        "survival": 8,       # lower expenses extend runway
        "stability": 3,
        "growth": 2,
        "fragility": -7,     # fragility falls as cost pressure eases
    },
    "delay_hiring": {
        "viability": 1,
        "survival": 6,       # payroll saving extends runway
        "stability": -2,     # slight reduction: capacity/growth risk
        "growth": -3,        # delayed headcount may slow growth
        "fragility": -4,
    },
    "do_nothing_projection": {
        "viability": -1,
        "survival": -2,
        "stability": -1,
        "growth": -2,
        "fragility": 2,
    },
}


def _apply_scenario_changes(
    scenario_type: str,
    parameters: Dict[str, Any],
    baselines: Dict[str, int],
) -> Dict[str, int]:
    """
    Translate scenario type + parameters into adjusted engine scores.
    Returns {engine: new_score}.
    """
    impact = dict(_SCENARIO_BASE_IMPACT.get(scenario_type, {}))

    # Parameterize impact where relevant
    if scenario_type == "price_change":
        pct = float(parameters.get("price_change_pct", 10))
        # Scale linearly: 10% base → scale up/down
        scale = pct / 10.0
        for k in impact:
            impact[k] = impact[k] * scale

    elif scenario_type == "hire_staff":
        count = int(parameters.get("staff_count", 1))
        for k in impact:
            impact[k] = impact[k] * min(count, 3)  # cap at 3x for >3 hires

    elif scenario_type == "client_loss":
        share_pct = float(parameters.get("client_revenue_share_pct", 20))
        scale = share_pct / 20.0  # 20% share = 1× baseline impact
        for k in impact:
            impact[k] = impact[k] * scale

    elif scenario_type == "revenue_drop":
        drop_pct = float(parameters.get("revenue_drop_pct", 15))
        scale = drop_pct / 15.0
        for k in impact:
            impact[k] = impact[k] * scale

    elif scenario_type == "cost_increase":
        increase_pct = float(parameters.get("cost_increase_pct", 10))
        scale = increase_pct / 10.0
        for k in impact:
            impact[k] = impact[k] * scale

    elif scenario_type == "reduce_fixed_cost":
        reduction_pct = float(parameters.get("cost_reduction_pct", 10))
        scale = reduction_pct / 10.0  # 10% reduction = 1× baseline
        for k in impact:
            impact[k] = impact[k] * scale

    elif scenario_type == "delay_hiring":
        count = int(parameters.get("employee_count", 1))
        for k in impact:
            impact[k] = impact[k] * min(count, 3)  # cap at 3x for >3 employees

    new_scores: Dict[str, int] = {}
    for engine, base in baselines.items():
        adj = impact.get(engine, 0)
        if engine == "fragility":
            # fragility adj: positive = more fragile (higher index)
            new_scores[engine] = max(0, min(100, int(base + adj)))
        else:
            new_scores[engine] = max(0, min(100, int(base + adj)))

    return new_scores


# ---------------------------------------------------------------------------
# Blueprint v3 ranking formula
# ---------------------------------------------------------------------------

def _compute_ranking_score(
    baselines: Dict[str, int],
    scenario_scores: Dict[str, int],
) -> float:
    """
    Blueprint v3: 0.30×viabilityDelta + 0.25×survivalDelta + 0.20×stabilityDelta + 0.25×growthDelta

    Delta = scenario_score - baseline_score (positive = improvement).
    Score is normalised to 0–100 range starting from 50 (neutral baseline).
    """
    v_delta = scenario_scores["viability"] - baselines["viability"]
    s_delta = scenario_scores["survival"]  - baselines["survival"]
    st_delta = scenario_scores["stability"] - baselines["stability"]
    g_delta = scenario_scores["growth"]    - baselines["growth"]
    # Fragility: improvement = lower index. Invert so improvement is positive.
    f_delta = baselines["fragility"] - scenario_scores["fragility"]

    weighted_delta = (
        0.30 * v_delta +
        0.25 * s_delta +
        0.20 * st_delta +
        0.25 * g_delta
    )

    # Map to 0–100 range; each 10-point delta shifts ranking by ~5 points
    ranking = 50.0 + weighted_delta * 0.5
    # Fragility bonus/penalty (capped)
    ranking += f_delta * 0.15

    return round(min(100.0, max(0.0, ranking)), 2)


# ---------------------------------------------------------------------------
# State result
# ---------------------------------------------------------------------------

def _determine_state_result(ranking: float) -> str:
    if ranking >= 57:
        return "improved"
    if ranking <= 43:
        return "worse"
    return "neutral"


# ---------------------------------------------------------------------------
# Timeline generation
# ---------------------------------------------------------------------------

def _generate_timeline(
    baselines: Dict[str, int],
    scenario_scores: Dict[str, int],
    months: int,
) -> List[Dict[str, Any]]:
    """
    Interpolate scores between baseline and scenario over the given months.
    """
    entries = []
    for m in range(1, months + 1):
        t = m / months  # 0 → 1
        entries.append({
            "month": m,
            "viability": round(baselines["viability"] + t * (scenario_scores["viability"] - baselines["viability"]), 1),
            "survival": round(baselines["survival"] + t * (scenario_scores["survival"] - baselines["survival"]), 1),
            "stability": round(baselines["stability"] + t * (scenario_scores["stability"] - baselines["stability"]), 1),
            "growth": round(baselines["growth"] + t * (scenario_scores["growth"] - baselines["growth"]), 1),
            "fragility_index": round(baselines["fragility"] + t * (scenario_scores["fragility"] - baselines["fragility"]), 1),
        })
    return entries


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------

def _build_recommendation_delta(
    scenario_type: str,
    ranking: float,
    baselines: Dict[str, int],
    scenario_scores: Dict[str, int],
) -> List[Dict[str, Any]]:
    recs = []

    if ranking >= 65:
        recs.append({
            "action_type": "proceed_with_confidence",
            "title": "Scenario outcome is favourable — proceed as planned.",
            "priority": 1,
        })
    elif ranking >= 50:
        recs.append({
            "action_type": "monitor_and_proceed",
            "title": "Scenario is broadly positive but warrants monitoring.",
            "priority": 1,
        })
    else:
        recs.append({
            "action_type": "caution",
            "title": "Scenario carries meaningful downside risk — review assumptions.",
            "priority": 1,
        })

    # Scenario-specific advice
    if scenario_type == "client_loss" and scenario_scores["stability"] < 40:
        recs.append({
            "action_type": "mitigation",
            "title": "Immediately activate customer acquisition pipeline to offset concentration risk.",
            "priority": 2,
        })

    if scenario_type == "price_change" and scenario_scores["viability"] > baselines["viability"]:
        recs.append({
            "action_type": "reinforce",
            "title": "Communicate value clearly to justify price increase and reduce churn risk.",
            "priority": 2,
        })

    if scenario_type == "hire_staff" and scenario_scores["survival"] < 40:
        recs.append({
            "action_type": "constraint",
            "title": "Cash runway may not support new hire — confirm 6-month coverage before proceeding.",
            "priority": 2,
        })

    return recs


# ---------------------------------------------------------------------------
# ASI triggers
# ---------------------------------------------------------------------------

def _detect_asi_triggers(scenario_scores: Dict[str, int]) -> List[str]:
    triggers = []
    if scenario_scores["fragility"] >= 70:
        triggers.append("HIGH_FRAGILITY_DETECTED")
    if scenario_scores["survival"] <= 25:
        triggers.append("SURVIVAL_CRITICAL")
    if scenario_scores["viability"] <= 25:
        triggers.append("VIABILITY_CRITICAL")
    return triggers


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def compute_delta(base_value: Any, scenario_value: Any) -> Any:
    if isinstance(base_value, (int, float)) and isinstance(scenario_value, (int, float)):
        return round(scenario_value - base_value, 2)
    return {"from": base_value, "to": scenario_value}


def run_multi_engine_scenario(inp: MultiEngineScenarioInput) -> MultiEngineScenarioOutput:
    output = MultiEngineScenarioOutput(
        scenario_id=inp.scenario_id,
        business_id=inp.business_id,
    )

    # Store baseline states
    output.baseline_states = {
        "viability": inp.viability_state or {},
        "survival":  inp.survival_state or {},
        "stability": inp.stability_state or {},
        "growth":    inp.growth_state or {},
        "fragility": inp.fragility_state or {},
    }

    baselines = _extract_baselines(inp)

    # Apply scenario changes and recompute all engine scores
    scenario_scores = _apply_scenario_changes(
        inp.scenario_type,
        inp.parameters,
        baselines,
    )

    output.scenario_states = {engine: {"score": score} for engine, score in scenario_scores.items()}

    # Compute per-engine deltas
    output.viability_delta  = {"score": compute_delta(baselines["viability"], scenario_scores["viability"])}
    output.survival_delta   = {"survival_score": compute_delta(baselines["survival"], scenario_scores["survival"])}
    output.stability_delta  = {"stability_score": compute_delta(baselines["stability"], scenario_scores["stability"])}
    output.growth_delta     = {"growth_score": compute_delta(baselines["growth"], scenario_scores["growth"])}
    output.fragility_delta  = {"fragility_index": compute_delta(baselines["fragility"], scenario_scores["fragility"])}

    # Blueprint v3 ranking formula
    ranking = _compute_ranking_score(baselines, scenario_scores)
    output.scenario_ranking_score = ranking
    output.state_result = _determine_state_result(ranking)

    # Timeline
    output.timeline = _generate_timeline(baselines, scenario_scores, inp.timeline_months)

    # Recommendations
    output.recommendation_delta = _build_recommendation_delta(
        inp.scenario_type, ranking, baselines, scenario_scores
    )

    # ASI triggers
    output.asi_triggers = _detect_asi_triggers(scenario_scores)

    return output
