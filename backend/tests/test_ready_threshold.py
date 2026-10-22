"""The ready threshold is 75 (22 Oct 2026, a product decision), set once in the versioned checklist (0.2). Funding and
launch use the same rule; results made under 0.1 keep 0.1 and its classification."""
from decimal import Decimal

import pytest

from app.modules.readiness import engine, rules


def _crit(score):
    return [{"code": "C1", "score": Decimal(str(score)), "weight": 100}]


GATE_OK = [{"code": "G1", "state": "passed"}]


@pytest.mark.parametrize("profile", [rules.PROFILES[rules.CURRENT[rules.FUNDING]], rules.PROFILES[rules.CURRENT[rules.LAUNCH]]])
def test_the_boundaries(profile):
    assert profile["thresholds"] == {"conditionally_ready": 60, "ready": 75} and profile["version"] == "0.2"
    assert engine.classify(profile, _crit("74.99"), GATE_OK)["classification"] == "conditionally_ready"
    assert engine.classify(profile, _crit(75), GATE_OK)["classification"] == "ready"
    assert engine.classify(profile, _crit(75), [{"code": "G1", "state": "failed"}])["classification"] == "not_ready"
    unknown = engine.classify(profile, [*_crit(75), {"code": "C2", "score": None, "weight": 10}], GATE_OK)
    assert unknown["classification"] == "insufficient_evidence" and unknown["score"] is None
    assert engine.classify(profile, _crit("59.99"), GATE_OK)["classification"] == "not_ready"


def test_a_result_under_the_old_checklist_keeps_its_classification():
    old = rules.get_profile("funding.equity.uk_service_software@0.1")
    assert old["thresholds"]["ready"] == 80
    assert engine.classify(old, _crit(78), GATE_OK)["classification"] == "conditionally_ready"      # as it was, in history


def test_one_threshold_everywhere():
    from app.modules.agent import first_value
    assert rules.ready_at(rules.FUNDING) == rules.ready_at(rules.LAUNCH) == 75
    crit = [{"key": "a", "label": "A", "state": first_value.MET, "weight": 1, "gap": ""}]
    assert first_value._result("funding_readiness_initial", criteria=crit, score=80, score_label="")["ready_at"] == 75
