"""Writes the funding case fixture the Playwright screens use (frontend/e2e/fixtures/funding_case.json) from the tests' own
synthetic business: no real workspace is read. Run from backend/:  python -m pytest tests/make_e2e_fixtures.py -q -p no:cacheprovider"""
import json
import pathlib

from test_goal_onboarding import world, _funding, OWNER  # noqa: F401

OUT = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures"


def test_write_the_funding_case_fixture(world):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=25000000, use="buy car wash equipment")
    cid = made["handoff"]["subject_id"]
    case = client.get(f"/businesses/A/funding-cases/{cid}").json()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "funding_case.json").write_text(json.dumps(case, indent=1, default=str), encoding="utf-8")
    assert case.get("sections")


def test_write_the_launch_plan_fixture(world):
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    from test_goal_onboarding import run
    env, store, client, who = world
    who["user"] = OWNER
    made = run(service_for(env.orch).create_subject(OWNER, "A", rules.LAUNCH, {"name": "Mobile car detailing", "scope": "commercial", "audience": "office workers",
                                                                             "geography": "Abuja", "offer": {"price": 15000}, "customers": {"target_segment": "office workers"},
                                                                             "economics": {"price_per_unit": 15000, "variable_cost_per_unit": 6000}}))
    r = client.post(f"/businesses/A/launch-initiatives/{made['id']}/assessments", json={"revision": made.get("revision") or 1, "idempotency_key": "e2e-launch"})
    assert r.status_code < 300, r.text
    plan = client.get(f"/businesses/A/launch-initiatives/{made['id']}").json()
    (OUT / "launch_plan.json").write_text(json.dumps(plan, indent=1, default=str), encoding="utf-8")
    over = client.get(f"/businesses/A/cases/{made['id']}/overview")      # the Checklist's own result, as the page reads it
    if over.status_code == 200:
        (OUT / "launch_overview.json").write_text(json.dumps(over.json(), indent=1, default=str), encoding="utf-8")
    assert plan.get("sections")


def test_write_the_recheck_replies(world, monkeypatch):
    """The funding chat's real replies to the owner's recheck messages (28 Oct), replayed by e2e/screens-recheck.spec.js."""
    from test_round14_converse_funding import _Model
    from app.modules.agent import research
    from test_goal_onboarding import run
    env, store, client, who = world
    who["user"] = OWNER
    _funding(client, amount=25000000, use="buy car wash equipment")
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "page": "funding"}).json()      # noqa: E731
    out = {}
    out["Please change who owns customer acquisition to Hilary"] = ask("Please change who owns customer acquisition to Hilary")
    out["Apply"] = ask("Apply")
    out["any loan or grant that i can apply to at the moment?"] = ask("any loan or grant that i can apply to at the moment?")
    model.replies.append({"say": "I have started the research for relevant loans and grants. It may take a little time."})
    out["ready now?"] = ask("ready now?")
    (OUT / "recheck_replies.json").write_text(json.dumps(out, indent=1, default=str, ensure_ascii=False), encoding="utf-8")
    assert out["Apply"]["message"].startswith("Saved.")
