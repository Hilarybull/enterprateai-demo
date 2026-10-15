"""§2 (P4, R3): one source for readiness numbers. The launch has one current assessment, the readiness module's, and the
Agent's answer, the dashboard card, the first-value card and the review page all show its summary (score, coverage,
classification) and none recalculates. Change a fact, reassess: all of them move together."""
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import assessment_summary
from app.modules.agent import router as agent_router
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run
from test_readiness import L, _dashboard, assess, launch


def _everywhere(env, monkeypatch):
    """The same launch as each surface shows it."""
    s = run(assessment_summary.current(env.orch, OWNER, "A", "launch"))
    agent = env.submit(capability="launch_evidence_gaps", channel="ui_action")["run"]
    kpi = next(k for k in _dashboard(env)["kpis"] if k["key"] == "launch_readiness")
    from app.modules.agent import goal_router
    monkeypatch.setattr(goal_router, "get_orchestrator", lambda: env.orch)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        quick = TestClient(app).post("/businesses/A/quick-check/launch", json={"answers": {"sell": "Bookkeeping", "stage": "testing"}}).json()["result"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    fed = run(assessment_summary.feed(env.orch, {"id": OWNER, "email": OWNER}, "A", "launch", {}, {}, f"review:t:{s['assessment_id']}"))      # the review page
    return s, agent, kpi, quick, fed


def test_every_surface_shows_the_one_assessment_and_moves_with_it(monkeypatch):
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, kind=L)
    s, agent, kpi, quick, fed = _everywhere(env, monkeypatch)
    assert s["classification"] and s["evidence_coverage"] is not None
    assert agent["state"]["outcome"]["assessment_id"] == s["assessment_id"]
    assert f"{s['evidence_coverage']}% of evidence" in kpi["hint"]
    # P0.6b: a launch quick check is about a launch not set up yet: shown as its own provisional result, never with another
    # initiative's full check.
    assert quick.get("assessment") is None and quick["provisional"] is True
    assert {k: fed[k] for k in ("classification", "score", "evidence_coverage")} == {k: s[k] for k in ("classification", "score", "evidence_coverage")}
    # Change a fact and reassess: everything moves together.
    item = run(svc.get_subject(OWNER, "A", L, lid))
    run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"economics": {**item["data"]["economics"], "variable_cost_per_unit": "120"}}))
    assess(svc, lid, kind=L)
    s2, agent2, kpi2, quick2, fed2 = _everywhere(env, monkeypatch)
    assert s2["assessment_id"] != s["assessment_id"] and s2["classification"] == "not_ready"      # a negative contribution blocks (B5)
    assert agent2["state"]["outcome"]["assessment_id"] == s2["assessment_id"] and quick2.get("assessment") is None
    assert {k: fed2[k] for k in ("classification", "score")} == {k: s2[k] for k in ("classification", "score")}


def test_the_summary_is_the_published_contract_and_nothing_else_scores_a_launch():
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, kind=L)
    s = run(assessment_summary.current(env.orch, OWNER, "A", "launch"))
    for key in ("business_id", "initiative_id", "assessment_id", "profile_version", "classification", "score", "evidence_coverage",
                "gate_completeness", "confidence", "freshness", "blocker_count", "next_action_id"):
        assert key in s, key
    from app.modules.agent import planned
    assert not hasattr(planned, "rescored") and not hasattr(planned, "stale_reviews")      # no second engine re-scores a review


def test_an_adopted_review_feeds_the_case_without_overwriting_what_it_holds():
    env = Env()
    svc, lid = launch(env)
    out = run(assessment_summary.feed(env.orch, {"id": OWNER, "email": OWNER}, "A", "launch", {"price": 150, "fixed_costs": 900}, {}, "review:x:1"))
    data = run(svc.get_subject(OWNER, "A", L, lid))["data"]
    assert data["economics"]["price_per_unit"] == "100" and data["economics"]["fixed_costs_monthly"] == "1000"      # the case's own: kept
    assert out["assessment_id"] and env.businesses["A"]["data"]["readiness_fed"]["launch"] == {"price": 150, "fixed_costs": 900}
