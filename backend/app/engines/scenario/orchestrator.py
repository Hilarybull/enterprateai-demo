"""Multi-engine scenario comparison.

Simulation audit, Phase 0 (16 Nov 2026), finding F3. The previous version did not recompute anything: it added fixed
points from a lookup table (for example, a 10% price rise always added +6 viability and +8 survival), so a strong and a
weak business got identical changes. It also produced a "ranking score" from arbitrary weights and a month-by-month
score "timeline" that was a straight line drawn between two numbers.

Now:
* The caller runs the engines twice on real figures (the business at the end of the period with and without the
  change) and passes both results in. Changes are simple differences between them.
* Only engines that were actually assessed are compared. Others are listed as not assessed, with the reason.
* There is no ranking score and no interpolated score timeline: neither had a basis. Better or worse comes from the cash
  and profit projection's verdict (app.modules.scenario_intelligence.projection.compare_projections).
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Where each engine keeps its headline score, and whether a higher value is better.
_ENGINE_SCORES: Dict[str, tuple] = {
    "viability": (("score",), True),
    "survival": (("scores", "survival_score"), True),
    "stability": (("scores", "stability_score"), True),
    "growth": (("scores", "growth_score"), True),
    "fragility": (("scores", "fragility_index"), False),
}


@dataclass
class MultiEngineScenarioInput:
    scenario_id: str
    business_id: str
    tenant_id: str
    baseline_outputs: Dict[str, Any] = field(default_factory=dict)
    scenario_outputs: Dict[str, Any] = field(default_factory=dict)
    scenario_type: str = ""
    timeline_months: int = 6
    verdict: Dict[str, Any] = field(default_factory=dict)
    mode: str = "deterministic"


@dataclass
class MultiEngineScenarioOutput:
    scenario_id: str
    business_id: str
    engine_version: str = "orchestrator_v3"

    baseline_states: Dict[str, Any] = field(default_factory=dict)
    scenario_states: Dict[str, Any] = field(default_factory=dict)
    engine_deltas: Dict[str, Any] = field(default_factory=dict)
    not_assessed: Dict[str, str] = field(default_factory=dict)

    state_result: str = "neutral"
    recommendation_delta: List[Dict[str, Any]] = field(default_factory=list)
    asi_triggers: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "business_id": self.business_id,
            "engine_version": self.engine_version,
            "baseline_states": self.baseline_states,
            "scenario_states": self.scenario_states,
            "engine_deltas": self.engine_deltas,
            "not_assessed": self.not_assessed,
            # Kept for older readers. No basis existed for these, so they are no longer produced.
            "scenario_ranking_score": None,
            "timeline": [],
            "state_result": self.state_result,
            "recommendation_delta": self.recommendation_delta,
            "asi_triggers": self.asi_triggers,
        }


def _score(outputs: Dict[str, Any], engine: str) -> Optional[float]:
    out = outputs.get(engine)
    if not isinstance(out, dict) or not out.get("assessed"):
        return None
    path, _higher_better = _ENGINE_SCORES[engine]
    value: Any = out
    for key in path:
        value = value.get(key) if isinstance(value, dict) else None
    return float(value) if isinstance(value, (int, float)) else None


def compute_delta(base_value: Any, scenario_value: Any) -> Any:
    if isinstance(base_value, (int, float)) and isinstance(scenario_value, (int, float)):
        return round(scenario_value - base_value, 2)
    return {"from": base_value, "to": scenario_value}


def run_multi_engine_scenario(inp: MultiEngineScenarioInput) -> MultiEngineScenarioOutput:
    output = MultiEngineScenarioOutput(scenario_id=inp.scenario_id, business_id=inp.business_id)

    for engine, (_path, higher_better) in _ENGINE_SCORES.items():
        base = _score(inp.baseline_outputs, engine)
        scen = _score(inp.scenario_outputs, engine)
        if base is None or scen is None:
            reason = (inp.scenario_outputs.get(engine) or inp.baseline_outputs.get(engine) or {}).get("reason")
            output.not_assessed[engine] = reason or "Not assessed."
            continue
        key = "fragility_index" if engine == "fragility" else ("score" if engine == "viability" else f"{engine}_score")
        output.baseline_states[engine] = {"scores": {key: base}}
        output.scenario_states[engine] = {"scores": {key: scen}}
        output.engine_deltas[engine] = {
            "baseline": base,
            "scenario": scen,
            "change": compute_delta(base, scen),
            "direction": "better" if (scen > base) == higher_better and scen != base else ("unchanged" if scen == base else "worse"),
        }

    output.state_result = inp.verdict.get("state_result", "neutral")
    if inp.verdict:
        output.recommendation_delta = [{
            "action_type": {"improved": "proceed_with_monitoring", "worse": "caution"}.get(output.state_result, "review"),
            "title": inp.verdict.get("reason", ""),
            "priority": 1,
        }]

    survival = output.scenario_states.get("survival", {}).get("scores", {}).get("survival_score")
    if isinstance(survival, (int, float)) and survival <= 25:
        output.asi_triggers.append("SURVIVAL_CRITICAL")
    if inp.verdict.get("cash_shortfall_introduced"):
        output.asi_triggers.append("CASH_SHORTFALL_INTRODUCED")
    return output
