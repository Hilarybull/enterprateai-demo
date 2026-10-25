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


def test_any_funding_question_answers_from_the_one_case_and_never_offers_a_second(world):
    """The owner, 25 Oct: "am I ready to apply for a loan?" said "I can't find a funding case for that" beside a £50k loan."""
    env, store, client, who = world
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 50000, "use": "a second van and hiring one cleaner", "stage": "trading",
                                                                       "route": "loan", "timing": "Within 3 months", "traction": "Paying customers"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    for text in ("am I ready to apply for a loan?", "How ready is my funding?", "what's left before I can borrow?"):
        out = ask(client, text)
        assert "can't find" not in out["message"] and "/100" in out["message"] or "not checked yet" in out["message"], (text, out["message"])
        assert not any("new funding case" in o["label"].lower() for o in out["offers"]), out["offers"]
        assert out["offers"][0]["label"].startswith("Open “")


def test_launch_status_questions_are_answered_from_the_plan_for_free_never_a_paid_chat(world):
    """The owner, 25 Oct: the Agent Centre answered launch questions as a paid chat reply; the same free answer as the
    dashboard (score and Open the plan) for every way of asking."""
    env, store, client, who = world
    who["user"] = OWNER
    _launch(client)
    for text in ("how is my launch looking?", "check my launch readiness", "what does my launch plan need?", "how is my launch going"):
        out = ask(client, text)
        assert out["kind"] == "answer" and not out.get("conversational") and out["offers"][0]["label"].startswith("Open “"), (text, out)
    for text in ("I need launch readiness", "I want to launch a carpet cleaning service"):
        assert "Open “" not in str(ask(client, text).get("offers")), text      # a request to start: its chat, never a status
    assert env.meter.charges == []
