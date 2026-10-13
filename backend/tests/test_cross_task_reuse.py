"""QA PF5 and PF6: answers given in one quick check prefill the next and the launch plan, only for the same offering;
"Add these answers to your launch plan" really updates the plan (a date, and the demand evidence on it); and a paid
pilot counts as demand evidence, in the owner's own words."""
from datetime import date

from app.modules.agent import answer_memory, first_value
from test_agent import OWNER, run
from test_goal_onboarding import world  # noqa: F401  (the fixture)

LAUNCH = {"kind": "service", "sell": "Home cleaning", "stage": "testing", "customer": "Busy households in Leeds", "where": "Leeds",
          "target_date": "In 1 to 3 months", "evidence": "5 neighbours booked a paid trial clean"}


def _fresh(env):
    data = env.businesses["A"]["data"]
    data["catalogue"]["products"] = []
    data.setdefault("workspace_profile", {}).pop("services", None)
    for k in ("target_customer", "target_market", "city", "country", "about_company"):
        data["workspace_profile"].pop(k, None)
    return data


def test_a_launch_check_s_answers_prefill_the_pricing_and_customer_checks(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OWNER
    _fresh(env)
    client.post("/businesses/A/quick-check/launch", json={"answers": LAUNCH})
    pricing = {q["key"]: q for q in client.get("/businesses/A/quick-check/price_offer").json()["questions"]}
    assert pricing["sell"]["default"] == "Home cleaning" and pricing["customer"]["default"] == "Busy households in Leeds"
    assert pricing["customer"]["source"] == "From your launch check"
    growth = {q["key"]: q for q in client.get("/businesses/A/quick-check/more_customers").json()["questions"]}
    assert growth["where"]["default"] == "Leeds" and growth["customer"]["default"] == "Busy households in Leeds"
    funding = {q["key"]: q for q in client.get("/businesses/A/quick-check/need_funding").json()["questions"]}
    assert funding["traction"]["default"] == "5 neighbours booked a paid trial clean"      # the same evidence, carried


def test_never_a_value_from_a_different_offering(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OWNER
    data = _fresh(env)
    client.post("/businesses/A/quick-check/test_idea", json={"answers": {"description": "Mobile dog grooming", "customer": "Busy pet owners in Manchester"}})
    data["catalogue"]["products"] = [{"id": "p9", "name": "Home cleaning", "base_price": 60}]      # the business sells cleaning
    pricing = {q["key"]: q for q in client.get("/businesses/A/quick-check/price_offer").json()["questions"]}
    assert pricing["sell"]["default"] == "Home cleaning"
    assert pricing["customer"].get("default") in (None, "")                                       # the pet owners are not offered


def test_add_these_answers_to_your_launch_plan_sets_a_date_and_adds_the_evidence(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "strategic_business_os"
    made = client.post("/businesses/A/quick-check/launch/attach", json={"answers": LAUNCH}).json()
    assert made["created"] is True and made["evidence_id"]
    plan = client.get(f"/businesses/A/launch-initiatives/{made['initiative_id']}").json()
    subject = plan.get("data") or plan
    assert subject.get("target_date"), plan                                    # "In 1 to 3 months": a date, not "no date set"
    assert subject.get("audience") == "Busy households in Leeds" and subject.get("geography") == "Leeds"
    evidence = client.get("/businesses/A/evidence").json()
    listed = evidence if isinstance(evidence, list) else evidence.get("items") or []
    mine = next(e for e in listed if e["id"] == made["evidence_id"])
    assert mine["type"] == "pilot" and mine["claim"] == "5 neighbours booked a paid trial clean"
    assert {"subject_id": made["initiative_id"], "check": "C1.A"} in mine["links"]      # on the plan's demand check
    assert (subject.get("customers") or {}).get("target_segment") == "Busy households in Leeds"      # what the demand check reads
    assert made["still_needed"] == ["The problem it solves for your customers (on the plan's Customers and offer section)"]


def test_relative_launch_timing_becomes_a_date():
    today = date(2026, 10, 12)
    assert answer_memory.target_date_from("In 1 to 3 months", today) == "2027-01-10"
    assert answer_memory.target_date_from("Within a month", today) == "2026-11-11"
    assert answer_memory.target_date_from("March", today) == "2027-03-01"
    assert answer_memory.target_date_from("we may launch soon", today) is None
    assert answer_memory.target_date_from("2026-12-01", today) == "2026-12-01"


def test_a_paid_pilot_counts_as_demand_evidence_in_the_owner_s_words():
    r = first_value.assess("launch", LAUNCH)
    assert "Paid pilot: 5 neighbours booked a paid trial clean" in r["strengths"]          # under "What looks ready"
    no_customer = first_value.assess("launch", {**LAUNCH, "customer": ""})
    demand = next(c for c in no_customer["criteria"] if c["key"] == "demand")
    assert demand["state"] == "partially_met"                                               # counted, never dropped
    assert "Paid pilot: 5 neighbours booked a paid trial clean" in no_customer["strengths"]
    interest = first_value.assess("launch", {**LAUNCH, "evidence": "3 mates who said they'd pay"})
    assert "Early interest: 3 mates who said they'd pay" in interest["strengths"]
    assert first_value.demand_level("Five paid trial cleans") == ("paid_pilot", "Paid pilot")


def test_the_last_result_is_shown_on_return(world):  # noqa: F811
    """QA R8-8: leaving /launch and coming back shows the latest result, not the seven questions again."""
    env, _store, client, who = world
    who["user"] = OWNER
    assert client.get("/businesses/A/quick-check/launch").json()["last"] is None
    done = client.post("/businesses/A/quick-check/launch", json={"answers": LAUNCH}).json()["result"]
    last = client.get("/businesses/A/quick-check/launch").json()["last"]
    assert last["result"]["score"] == done["score"] and last["answers"]["evidence"] == LAUNCH["evidence"]
