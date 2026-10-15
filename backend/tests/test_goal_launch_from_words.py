"""QA P2-2: ask only what is missing. "I want to launch a home cleaning service in Leeds" is not asked
what or where again; the launch conversation asks when, too (PRD Q5: where and when)."""
from app.modules.agent.goals import extract
from test_goal_onboarding import world  # noqa: F401  (the fixture)


def test_what_where_and_when_are_read_from_the_goal():
    assert extract("I want to launch a home cleaning service in Leeds", "launch") == {"sell": "home cleaning service", "kind": "service", "where": "Leeds"}
    assert extract("launching my new candle range in Manchester next month", "launch") == {
        "sell": "candle range", "kind": "product", "where": "Manchester", "target_date": "next month"}
    # Nothing doubtful is taken: a vague "product/service" or a bare date is still asked.
    assert "sell" not in extract("I want to launch a product/service", "launch")
    assert extract("help me launch in March", "launch") == {"target_date": "in March"}


def test_the_session_does_not_ask_them_again_and_asks_when(world):  # noqa: F811
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"text": "I want to launch a home cleaning service in Leeds", "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "launch"
    assert {"sell", "kind", "where"}.isdisjoint(s["missing"])
    # PRD 8.1 Q5 is "where and when": the place was said, so only the date is asked, as its own question.
    asked = [q["key"] for q in s["questions"] if not q.get("hidden") and not q.get("proposed")]
    assert "target_date" in asked and "where" not in asked
    when = {q["key"]: q for q in s["questions"]}["target_date"]
    assert when["label"] == "When do you want to launch?" and when["unsure"] == "Not decided yet"
