"""QA E3/E4: the launch quick check's premium step starts launch-blocker research (nothing else), with the
check's answers and blockers, after the plan and then credits allow it; its answers go onto the launch plan;
and the result tells gaps from early evidence, uses the launch timing given, and counts only sent quotations."""
from app.modules.agent import first_value
from test_agent import OWNER, run
from test_goal_onboarding import world  # noqa: F401  (the fixture)

ANSWERS = {"kind": "service", "sell": "Home cleaning", "stage": "testing", "customer": "Busy households in Leeds", "where": "Leeds",
           "target_date": "In 1 to 3 months", "evidence": "Five paid trial cleans"}


def test_e4_gaps_timing_and_quotes():
    r = first_value.assess("launch", ANSWERS, {"financials": {"quotes": [{"id": "q1", "status": "draft"}]}})
    kinds = {b["key"]: b for b in r["blockers"]}
    assert kinds["route"]["kind"] == "unknown" and kinds["route"]["label"] == "Launch channel not defined"      # a gap, not early evidence
    assert kinds["control"]["kind"] == "unknown" and kinds["control"]["label"] == "No launch owner yet"      # the timing was used
    assert "Launch timing set: In 1 to 3 months" in r["strengths"]
    assert "You already quote or invoice through EnterprateAI" not in r["strengths"]      # a draft never sent doesn't count
    sent = first_value.assess("launch", ANSWERS, {"financials": {"quotes": [{"id": "q1", "status": "sent"}]}})
    assert "You already quote or invoice through EnterprateAI" in sent["strengths"]


def test_e3_explorer_gets_the_gate_and_nothing_starts(world):  # noqa: F811
    env, _store, client, who = world
    env.meter.plans[OWNER], who["user"] = "explorer", OWNER
    before = len(run(env.store.list_runs("A")))
    out = client.post("/businesses/A/quick-check/launch/premium", json={"answers": ANSWERS}).json()
    assert out["started"] is False and out["gate"]["reason"] == "plan"      # the plan is checked before credits
    assert len(run(env.store.list_runs("A"))) == before


def test_e3_e4_the_answers_go_on_a_launch_plan_and_the_premium_step_is_research(world, monkeypatch):  # noqa: F811
    """QA PF3 (replacing E3's "start Launch Evidence Gaps"): the premium step is one research run for the check's own
    missing evidence, with its answers; no other task is started. The answers still go onto a launch plan (E4)."""
    from app.modules.agent import research
    env, _store, client, who = world
    env.meter.plans[OWNER], env.meter.balances[OWNER], who["user"] = "strategic_business_os", 50, OWNER
    made = client.post("/businesses/A/quick-check/launch/attach", json={"answers": ANSWERS}).json()
    assert made["created"] is True and made["to"].startswith("/launch/")

    async def nothing(_q):
        return {}
    monkeypatch.setattr(research, "_search", nothing)
    before = {r["id"] for r in run(env.store.list_runs("A"))}
    out = client.post("/businesses/A/quick-check/launch/premium", json={"answers": ANSWERS}).json()
    assert out["started"] is True and out["capability"] == "launch_evidence_gaps"      # its plan gate, from the registry
    assert out["research"]["answers"]["customer"] == "Busy households in Leeds" and out["research"]["blockers"]
    assert [r for r in run(env.store.list_runs("A")) if r["id"] not in before] == []      # no other task