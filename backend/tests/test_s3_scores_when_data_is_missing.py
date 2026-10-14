"""§3 (P5, R3): never a final-looking score when data is missing. The quick check may show a score, labelled
provisional, with its coverage; the full assessment returns no score and "insufficient evidence" while any criterion or
gate is unknown, applies blockers whatever the score, uses the unrounded value at 60 and 80, and words "ready" exactly
as LR §8 / FR §8. (LT01 to LT16, AT01 to AT16 and the PRD boundary cases are in test_readiness.py.)"""
from app.modules.agent import assessment_summary
from app.modules.readiness import engine, rules
from test_agent import OWNER, Env, run
from test_readiness import L, assess, launch


def test_the_ready_wording_is_exactly_the_prds():
    assert rules.LAUNCH_COMMERCIAL_V1["wording"]["ready"] == "Prepared for the defined launch scope against this checklist."      # LR §8
    assert rules.FUNDING_EQUITY_V1["wording"]["ready"] == "Prepared for initial equity discussions against this checklist."     # FR §8
    assert rules.FUNDING_EQUITY_V1["wording"]["conditionally_ready"] == "Preparation gaps remain."


def test_with_a_criterion_unknown_the_full_assessment_has_no_score_and_the_agent_never_shows_one():
    env = Env()
    svc, lid = launch(env, forecast=False)                                  # the cash projection is missing: C3 unknown
    result = assess(svc, lid, kind=L)
    res = result.get("result") or (result.get("data") or {}).get("result") or result
    s = run(assessment_summary.current(env.orch, OWNER, "A", "launch"))
    assert s["score"] is None and s["classification"] == "insufficient_evidence" and s["evidence_coverage"] is not None
    agent = env.submit(capability="launch_evidence_gaps", channel="ui_action")["run"]
    assert "score" not in agent["summary"].lower() or "no score" in agent["summary"].lower(), agent["summary"]


def test_scores_are_judged_unrounded_at_the_thresholds_and_a_failed_gate_wins_over_any_score():
    for profile in (rules.LAUNCH_COMMERCIAL_V1, rules.FUNDING_EQUITY_V1):
        assert engine.classify(profile, [{"weight": 100, "score": 59.99}], [{"state": "passed"}])["classification"] == "not_ready"
        assert engine.classify(profile, [{"weight": 100, "score": 60}], [{"state": "passed"}])["classification"] == "conditionally_ready"
        assert engine.classify(profile, [{"weight": 100, "score": 80}], [{"state": "passed"}])["classification"] == "ready"
        exact = engine.classify(profile, [{"weight": 100, "score": 79.99}], [{"state": "passed"}])
        assert exact["classification"] == "conditionally_ready"                # 79.99 is not 80, however it is displayed
        blocked = engine.classify(profile, [{"weight": 100, "score": 100}], [{"state": "failed"}])
        assert blocked["classification"] == "not_ready" and blocked["score"] == 100      # blockers apply regardless of score
