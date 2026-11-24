"""QA P1-7: in the app, Launch Readiness (and Funding, Pricing, Customer Growth) give the free first
value from a short conversation: what the Company holds is filled in, and the result is a provisional,
deterministic score with evidence coverage, strengths and blockers, one premium next action and free
ones. The premium step checks the plan before credits."""
from test_agent import OUTSIDER, OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)


def _profile(env, **over):
    env.businesses["A"]["data"]["workspace_profile"] = {"company_name": "Apex", "city": "Leeds", "country": "United Kingdom", "operating_stage": "early_revenue",
                                                       "target_customer": "Busy households", "services": [{"service_name": "Home cleaning"}], **over}


def test_launch_questions_come_filled_in_from_the_company(world):  # noqa: F811
    env, _store, client, who = world
    _profile(env)
    who["user"] = OWNER
    body = client.get("/businesses/A/quick-check/launch").json()
    qs = {q["key"]: q for q in body["questions"]}
    assert body["headline"] == "Initial Launch Readiness" and 5 <= len(qs) <= 7
    assert (qs["where"]["default"], qs["where"]["prefilled"], qs["where"]["source"]) == ("Leeds, United Kingdom", True, "From your business profile")
    assert qs["customer"]["default"] == "Busy households" and "target_date" in qs      # where and when are both asked
    assert "default" not in qs["evidence"] or qs["evidence"].get("prefilled") is not True  # nothing guessed


def test_launch_result_is_a_provisional_score_with_blockers_and_a_premium_next_step(world):  # noqa: F811
    env, _store, client, who = world
    _profile(env)
    who["user"] = OWNER
    r = client.post("/businesses/A/quick-check/launch", json={"answers": {"kind": "service", "stage": "testing", "target_date": "2026-12-01", "evidence": "Five paid trial cleans"}}).json()["result"]
    assert r["provisional"] is True and isinstance(r["score"], int) and 0 < r["score"] < 100 and 0 < r["evidence_coverage"] < 100
    assert r["strengths"] and r["blockers"]
    n = len(r["blockers"])
    assert r["premium_next_action"]["label"] == f"Resolve my {n} launch blocker{'s' if n != 1 else ''}"
    assert any(a.get("save") for a in r["free_next_actions"]) and "premium_gate" in r


def test_the_other_three_have_their_own_check(world):  # noqa: F811
    env, _store, client, who = world
    _profile(env)
    who["user"] = OWNER
    for goal, headline in (("need_funding", "Funding readiness"), ("price_offer", "Pricing Health"), ("more_customers", "Customer Growth Foundation")):
        assert client.get(f"/businesses/A/quick-check/{goal}").json()["headline"] == headline
        assert client.post(f"/businesses/A/quick-check/{goal}", json={"answers": {}}).json()["result"]["headline"] == headline
    stage = {q["key"]: q for q in client.get("/businesses/A/quick-check/need_funding").json()["questions"]}["stage"]
    assert stage["default"] == "trading"      # "Early revenue" from sign-up


def test_someone_else_s_business_is_not_found(world):  # noqa: F811
    _env, _store, client, who = world
    who["user"] = OUTSIDER
    assert client.get("/businesses/A/quick-check/launch").status_code == 404
    who["user"] = OWNER
    assert client.get("/businesses/A/quick-check/create_invoice").status_code == 404
