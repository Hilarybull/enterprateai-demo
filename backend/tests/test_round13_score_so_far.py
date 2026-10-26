"""The owner, 26 Oct: "why 0", "i told you score based on the user answers": the score so far counts every check that
passed, even in a criterion with one still open; once everything is known it is the full score."""
from app.modules.readiness import engine

P, U, F = engine.PASSED, engine.UNKNOWN, engine.FAILED
PROFILE = {"score_needs_gates": False, "thresholds": {"conditionally_ready": 60, "ready": 75},
           "wording": {k: k for k in ("not_ready", "insufficient_evidence", "conditionally_ready", "ready")}}


def _c(weight, *states):
    checks = [{"state": s} for s in states]
    state, score = engine.score_criterion(checks)
    return {"weight": weight, "score": score, "state": state, "checks": checks}


def test_answers_that_pass_count_before_everything_is_known():
    out = engine.classify(PROFILE, [_c(40, P, U), _c(60, P, P)], [])
    assert out["score"] is None and out["known_points"] == 80.0      # 60 for the met one, 20 for half of the other


def test_nothing_passed_is_zero_and_all_known_is_the_full_score():
    assert engine.classify(PROFILE, [_c(50, U, U), _c(50, F, U)], [])["known_points"] == 0.0
    full = engine.classify(PROFILE, [_c(40, P, F), _c(60, P, P)], [])
    assert full["score"] == 80.0 and full["known_points"] == 80.0
