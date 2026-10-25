"""The owner, 25 Oct: changes typed in the funding chat are all applied, not just the first."""
from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import intake_turn


def test_every_change_in_a_correction_is_applied(world):
    env, store, client, who = world
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 50000, "use": "a second van", "stage": "trading", "route": "loan",
                                                                           "timing": "Within 6 months", "traction": "Paying customers"}}).json()
    assert s["inputs"]["timing"] == "Within 6 months"
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "make it 45000 and within 3 months", "asked": None}).json()
    assert float(s["inputs"]["amount"]) == 45000 and s["inputs"]["timing"] == "Within 3 months", s["inputs"]


def test_the_rules_take_the_second_change_when_the_model_took_only_the_first():
    by_key = {"amount": {"key": "amount", "type": "number", "prefix": "£"}, "timing": {"key": "timing", "type": "choice"}}
    more = intake_turn._every_change("make it 45000 and within 3 months", "need_funding", by_key, {"amount"})
    assert [(i["slot"], i["value"]) for i in more] == [("timing", "Within 3 months")]
