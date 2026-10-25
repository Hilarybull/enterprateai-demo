"""Launch readiness, the owner's brief 25 Oct: a correction typed at the recap updates it; a customer the Agent put on the
profile from another offering's chat is never proposed."""
from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import first_value


def test_a_correction_typed_at_the_recap_updates_who_it_is_for(world):
    env, store, client, who = world
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "launch", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"kind": "service", "sell": "Carpet cleaning", "stage": "testing",
                                                                           "customer": "Homeowners", "where": "York", "target_date": "In 1 to 3 months", "evidence": "3 bookings"}}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "it's for landlords and letting agents in Leeds", "asked": None}).json()
    assert s["inputs"]["customer"] == "landlords and letting agents" and s["inputs"]["where"] == "Leeds", s["inputs"]
    shown = {r["key"]: r["value"] for r in s.get("summary") or []}
    assert "landlords" in str(shown.get("customer", "")).lower()


def test_an_agent_filled_profile_customer_from_another_offering_is_never_proposed():
    data = {"workspace_profile": {"target_customer": "Dog owners aged 30 to 60 in Leeds suburbs", "city": "Leeds"},
            "profile_provenance": {"target_customer": {"source": "From your launch chat", "value": "Dog owners aged 30 to 60 in Leeds suburbs"}}}
    assert "customer" not in first_value.known_answers("launch", data)
    data["profile_provenance"]["target_customer"]["by"] = "owner"      # set by the owner on the form: theirs, proposed
    assert first_value.known_answers("launch", data)["customer"].startswith("Dog owners")
    assert first_value.known_answers("launch", {"workspace_profile": {"target_customer": "Landlords in Leeds"}})["customer"] == "Landlords in Leeds"
