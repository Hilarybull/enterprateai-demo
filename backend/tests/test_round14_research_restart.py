"""A run the server restart stopped never leaves the card spinning (the owner, 29 Oct)."""
from datetime import timedelta

from app.modules.agent import assistant_context as ac


def test_a_run_marked_before_the_restart_is_said_as_stopped_with_retry():
    before = (ac.STARTED - timedelta(minutes=2)).isoformat()
    data = {"agent_working": {"p1": {"at": before, "topic": "launch"}}}
    assert ac.working(data, "p1", ac.STARTED + timedelta(minutes=1)) is False
    assert ac.failed(data, "p1") == ac.INTERRUPTED


def test_a_run_started_in_this_server_is_still_working():
    after = (ac.STARTED + timedelta(seconds=5)).isoformat()
    data = {"agent_working": {"p1": {"at": after, "topic": "launch"}}}
    assert ac.working(data, "p1", ac.STARTED + timedelta(minutes=1)) is True
    assert ac.failed(data, "p1") is None
