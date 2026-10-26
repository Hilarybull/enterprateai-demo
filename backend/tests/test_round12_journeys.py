"""The 8 journeys of the 23 Oct brief: Business Plan, Idea Validation, Funding and Launch, each from the landing chat
(signed in) and from the dashboard Agent. Model and usage logging are stubbed (the test world); nothing is charged."""
import pytest

from test_goal_onboarding import world, _funding, _launch, OWNER  # noqa: F401
from app.modules.agent import goal_router


@pytest.fixture()
def owner(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER

    async def signed_in(request):
        return {"id": OWNER, "email": OWNER}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    _funding(client)
    _launch(client)
    return env, client


def land(client, text):
    return client.post("/task-sessions", json={"text": text, "entry_mode": "free_text", "business_id": "A"}).json()


def ask(client, text, **params):
    body = {"business_id": "A", "text": text, "source_channel": "text", **({"params": params} if params else {})}
    return client.post("/agent/requests", json=body).json()


def test_1_landing_business_plan_reuses_the_business_record(owner):
    env, client = owner
    s = land(client, "I need a business plan")
    rows = {r["key"]: r for r in s["summary"]}
    assert s["goal_key"] == "create_business_plan" and rows["description"]["from_records"] and s["missing"] == []
    assert env.meter.charges == []


def test_2_landing_idea_reads_the_idea_and_keeps_sales_apart_from_capacity(owner):
    env, client = owner
    s = land(client, "Validate my idea: a mobile drone window cleaning service in Leeds")
    rows = {r["key"]: r["value"] for r in s["summary"]}
    assert rows["description"] == "mobile drone window cleaning service" and rows["where"] == "Leeds" and "description" not in s["missing"]
    sid = s["id"]
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {}, "message": "about 80 a month", "asked": "monthly_sales"})
    after = client.post(f"/task-sessions/{sid}/inputs", json={"answers": {}, "message": "I could deliver about 120 a month", "asked": "capacity"}).json()
    got = {**(after.get("proposed") or {}), **(after.get("inputs") or {})}
    assert got.get("monthly_sales") == 80 and got.get("capacity") == 120
    assert env.meter.charges == []


def test_3_landing_funding_does_not_ask_again_what_is_on_record(owner):
    env, client = owner
    s = land(client, "I need funding")
    assert not {"stage", "traction", "use"} & set(s["missing"])
    assert all(r["from_records"] for r in s["summary"] if r["key"] in ("stage", "traction"))
    assert env.meter.charges == []


def test_4_landing_launch_reads_what_is_launched(owner):
    env, client = owner
    s = land(client, "I want to launch a drone cleaning service")
    rows = {r["key"]: r["value"] for r in s["summary"]}
    assert s["goal_key"] == "launch" and rows["sell"] == "drone cleaning service" and "sell" not in s["missing"]
    assert env.meter.charges == []


def test_5_dashboard_business_plan_asks_what_it_is_for_before_any_price(owner):
    env, client = owner
    out = ask(client, "write a business plan")
    assert out["kind"] == "needs_input" and [f["key"] for f in out["fields"]][:1] == ["plan_for"]
    assert "new" in [o["value"] for o in out["fields"][0]["options"]] and env.meter.charges == []


def test_6_dashboard_idea_check_is_free_first_and_paid_only_on_request(owner):
    env, client = owner
    # A paid plan's validation is Comprehensive, its price first (the owner, 26 Oct: "basic is for free plan"); Basic when asked
    full = ask(client, "validate my idea: a mobile drone window cleaning service in Leeds")
    assert full["kind"] == "needs_confirmation" and "credits" in full["message"]
    free = ask(client, "validate my idea, just a quick check: a mobile drone window cleaning service in Leeds")
    assert free["kind"] == "workflow" and free["run"]["substatus"] == "waiting_for_information"      # asks what is missing, free
    paid = ask(client, "validate my idea fully: a mobile drone window cleaning service in Leeds")
    assert paid["kind"] == "needs_confirmation" and "credits" in paid["message"]      # its price first
    assert env.meter.charges == []


def test_7_dashboard_a_funding_need_runs_its_flow_and_a_question_asks_replace_or_update(owner):
    env, client = owner
    # Asked to start: the flow runs and collects the details (the owner, 23 Oct), never a status answer in its place
    for text in ("I want to raise a £20k grant", "i need new funding readiness", "i need new launch readiness"):
        started = ask(client, text)
        assert started["kind"] == "check" and started["capability"] in ("funding_readiness", "launch"), text
    out = ask(client, "How ready am I for a £20k grant?")
    assert "Replace it with this need, or update its details?" in out["message"]
    assert [o["label"] for o in out["offers"]][0] == "Replace with this need" and env.meter.charges == []


def test_8_dashboard_launch_question_matches_the_named_plan(owner):
    env, client = owner
    car = ask(client, "How ready is my car wash launch?")
    assert car["message"].startswith("“Monthly car wash subscription") and car["offers"]
    drone = ask(client, "How ready is my drone cleaning launch?")
    assert drone["offers"][0] == {"label": "Start a new launch plan", "to": "/launch?new=1"}
    assert env.meter.charges == []
