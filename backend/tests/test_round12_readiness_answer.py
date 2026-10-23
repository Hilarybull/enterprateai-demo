"""G6 (23 Oct): readiness questions on the dashboard Agent, answered from the case summary with buttons."""
from test_goal_onboarding import world, _funding, _launch, OWNER  # noqa: F401


def ask(client, text):
    return client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()


def test_readiness_questions_match_the_named_subject_and_always_end_on_buttons(world):
    env, store, client, who = world
    who["user"] = OWNER
    _funding(client)
    _launch(client)
    drone = ask(client, "How ready is my drone cleaning launch?")
    assert "can't find a launch plan" in drone["message"] and drone["offers"][0] == {"label": "Start a new launch plan", "to": "/launch?new=1"}
    car = ask(client, "How ready is my car wash launch?")
    assert car["message"].startswith("“Monthly car wash subscription") and "/100" in car["message"] and car["offers"]
    grant = ask(client, "How ready am I for a £20k grant?")
    assert "Replace it with this need, or update its details?" in grant["message"]
    assert [o["label"] for o in grant["offers"]][:2] == ["Replace with this need", "Update the details"]
    nxt = ask(client, "What should I do next for funding?")
    assert nxt["offers"] and "check" not in nxt["message"].lower().replace("checked", "")
    for out in (drone, car, grant, nxt):
        assert out["offers"] and "—" not in out["message"] and "–" not in out["message"]
    assert env.meter.charges == []
