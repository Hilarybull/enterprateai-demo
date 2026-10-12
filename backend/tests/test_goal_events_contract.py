"""QA PF7: POST /goal-events took every goal action with a 422, so the funnel (goal, first value, premium, upgrade)
recorded nothing. The contract: every event name the page sends is one the server takes, with the fields it sends."""
import pathlib
import re

import pytest

from app.modules.agent import goals
from test_goal_onboarding import world  # noqa: F401  (the fixture)

FRONTEND = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"


def sent_by_the_page():
    found = {}
    for f in FRONTEND.rglob("*.jsx"):
        if ".test." in f.name:
            continue
        for name, extra in re.findall(r'trackGoal\("([a-z_]+)"(?:,\s*(\{[^)]*\}))?\)', f.read_text(encoding="utf-8")):
            found.setdefault(name, set()).update(re.findall(r"\b([a-z_]+):", extra or ""))
    return found


def test_every_event_the_page_sends_is_one_the_server_takes():
    sent = sent_by_the_page()
    assert {"first_value_premium_clicked", "premium_upgrade_clicked", "first_value_shown", "entry_mode_selected"} <= set(sent)
    assert set(sent) - set(goals.CLIENT_EVENTS) == set()
    from app.modules.agent.goal_router import EventIn
    fields = set(EventIn.model_fields)
    for name, keys in sent.items():
        assert keys <= fields, (name, keys - fields)


@pytest.mark.parametrize("body", [
    {"name": "first_value_shown", "key": "launch", "where": "app"},
    {"name": "first_value_premium_clicked", "where": "app"},
    {"name": "premium_upgrade_clicked", "where": "app"},
    {"name": "onboarding_match_choice", "key": "need_funding"},
    {"name": "entry_mode_selected", "entry_mode": "business_goal", "key": "launch"},
])
def test_each_goal_action_is_recorded_not_refused(world, body):  # noqa: F811
    _env, store, client, _who = world
    r = client.post("/goal-events", json=body)
    assert r.status_code == 202, r.text
    assert any(e["name"] == body["name"] for e in store.events)


def test_an_unknown_event_is_still_refused(world):  # noqa: F811
    _env, _store, client, _who = world
    assert client.post("/goal-events", json={"name": "anything_at_all"}).status_code == 422
