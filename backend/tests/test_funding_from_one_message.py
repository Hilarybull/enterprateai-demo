"""The owner, 2 Nov: "I need funding: ₦10m for stock, a loan, in 3 to 6 months..." asked for the date again and said £10,000,000."""
import pytest

from app.modules.agent import goals
from test_goal_onboarding import world  # noqa: F401 - the fixture

SAID = "I need funding: ₦10m for stock, a loan, in 3 to 6 months. The business is not trading yet, no traction yet."


@pytest.mark.parametrize("when,day", [("in 3 to 6 months", "May 2027"), ("3 to 6 months", None), ("within 3 months", "Feb 2027"), ("in 6-12 months", "Nov 2027")])
def test_when_they_need_it_is_read_from_the_message(when, day):
    got = goals.extract(f"I need funding: £5k for stock, a loan, {when}.", "need_funding")
    if day:
        assert got.get("timing"), got


def test_a_pounds_workspace_keeps_the_naira_they_typed_and_asks_nothing_they_said(world):  # noqa: F811
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": SAID, "entry_mode": "free_text", "currency": "GBP"}).json()
    assert s["currency"] == "NGN"
    assert "timing" not in s["missing"], s["missing"]
    assert "₦" in str(s["summary"]) and "£" not in str(s["summary"])


def test_nothing_changes_when_no_currency_was_typed(world):  # noqa: F811
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "I need funding: 50000 for stock, a loan, in 3 to 6 months.", "entry_mode": "free_text", "currency": "GBP"}).json()
    assert s["currency"] == "GBP"
