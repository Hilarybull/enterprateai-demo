"""QA R1: a goal's answers (a dog-grooming idea) never land silently on the company's profile. They are
kept as proposals with their source; a prefill says where a value came from; and only the owner's
confirm puts one on the profile, with provenance (First-Value PRD 6.1)."""
from app.modules.agent import first_value
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

IDEA = {"description": "Mobile dog grooming van", "customer": "Busy pet owners in Manchester", "price": 45, "monthly_sales": 60,
        "cost": 12, "fixed_costs": 400, "capacity": 80, "demand": "enquiries"}


def _test_idea(client, who):
    s = client.post("/task-sessions", json={"key": "test_idea", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": IDEA})
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    return s


def test_the_idea_s_customer_is_a_proposal_not_the_profile(world):  # noqa: F811
    env, _store, client, who = world
    profile = env.businesses["A"]["data"].setdefault("workspace_profile", {})
    profile.pop("target_customer", None)
    _test_idea(client, who)
    data = env.businesses["A"]["data"]
    assert data["workspace_profile"].get("target_customer") != "Busy pet owners in Manchester"
    proposed = [p for p in data.get("profile_proposals") or [] if p["field"] == "target_customer"]
    assert proposed and proposed[0]["value"] == "Busy pet owners in Manchester" and proposed[0]["status"] == "proposed"
    assert proposed[0]["source"]["kind"] in ("goal", "agent_task")


def test_an_idea_s_customer_is_never_proposed_for_a_different_offering(world):  # noqa: F811
    """QA PF5: the business prices its own offering (on record); the dog-grooming idea's customer is not offered for it."""
    env, _store, client, who = world
    env.businesses["A"]["data"].setdefault("workspace_profile", {}).pop("target_customer", None)
    _test_idea(client, who)
    qs = {q["key"]: q for q in client.get("/businesses/A/quick-check/price_offer").json()["questions"]}
    assert qs["sell"]["default"] != "Mobile dog grooming van"
    assert qs["customer"].get("default") in (None, "") and not qs["customer"].get("proposal_id")


def test_a_prefill_says_it_is_an_earlier_answer_and_saving_it_needs_a_confirm(world):  # noqa: F811
    env, _store, client, who = world
    data = env.businesses["A"]["data"]
    data.setdefault("workspace_profile", {}).pop("target_customer", None)
    data["workspace_profile"].pop("services", None)
    data["catalogue"]["products"] = []      # no offering on record yet: the idea is the only one there is
    _test_idea(client, who)
    customer = {q["key"]: q for q in client.get("/businesses/A/quick-check/price_offer").json()["questions"]}["customer"]
    assert customer["default"] == "Busy pet owners in Manchester"
    assert customer["source"] == first_value.FROM_PROPOSAL and customer["source"] != first_value.FROM_RECORDS
    saved = client.post(f"/businesses/A/profile-proposals/{customer['proposal_id']}", json={"confirm": True}).json()["proposal"]
    assert saved["status"] == "confirmed"
    profile = env.businesses["A"]["data"]["workspace_profile"]
    assert profile["target_customer"] == "Busy pet owners in Manchester" and profile["provenance"]["target_customer"]["confirmed_by"] == OWNER
    customer = {q["key"]: q for q in client.get("/businesses/A/quick-check/price_offer").json()["questions"]}["customer"]
    assert customer["source"] == first_value.FROM_RECORDS      # now it really is on the profile
