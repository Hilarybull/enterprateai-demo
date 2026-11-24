"""A struggling database gets room to recover, instead of each query waiting out its timeouts and retries (2 Nov outage)."""
import asyncio

import httpx
import pytest

from app.core import supabase as sb
from app.modules.agent.orchestrator import Orchestrator
from app.shared.utils.errors import describe

REAL_WITH_CLIENT = sb._with_client      # conftest stands in for it during each test


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    sb._down.update(fails=0, until=0.0)
    monkeypatch.setattr(sb, "_take", lambda: (object(), False))
    monkeypatch.setattr(sb, "_give_back", lambda _c: None)
    monkeypatch.setattr(sb, "_close", lambda _c: None)
    monkeypatch.setattr(sb.time, "sleep", lambda _s: None)
    yield
    sb._down.update(fails=0, until=0.0)


def _timing_out(_client):
    raise httpx.ReadTimeout("timed out")


def _overloaded(_client):
    raise RuntimeError("{'code': 'PGRST002', 'message': 'Could not query the database for the schema cache.'}")


def test_after_repeated_failures_queries_fail_at_once_then_recover():
    calls = {"n": 0}

    def counted(client):
        calls["n"] += 1
        _timing_out(client)
    for _ in range(sb._BREAK_AFTER):
        with pytest.raises(httpx.ReadTimeout):
            REAL_WITH_CLIENT(counted, max_attempts=1)
    made = calls["n"]
    with pytest.raises(httpx.ConnectTimeout):
        REAL_WITH_CLIENT(counted, max_attempts=1)
    assert calls["n"] == made      # the database wasn't asked
    sb._down["until"] = 0.0      # the pause is over
    assert REAL_WITH_CLIENT(lambda _c: "fine") == "fine"
    assert sb._down["fails"] == 0


def test_an_overloaded_answer_counts_and_is_said_as_unavailable():
    with pytest.raises(RuntimeError) as e:
        REAL_WITH_CLIENT(_overloaded)
    assert sb._down["fails"] == 1
    assert describe(e.value)[0] == 503


def test_a_rejected_query_is_not_the_database_being_down():
    def bad(_c):
        raise ValueError("no such column")
    with pytest.raises(ValueError):
        REAL_WITH_CLIENT(bad)
    assert sb._down["fails"] == 0
    assert describe(ValueError("no such column"))[0] == 500


def test_the_watchdog_reads_the_runs_once_when_nothing_moved():
    reads = []

    class Store:
        async def stalled_candidates(self):
            reads.append(1)
            return []

        async def due_runs(self, _now):
            return []

    class Rt:
        store = Store()

        @staticmethod
        def clock():
            return None
    orch = Orchestrator.__new__(Orchestrator)
    orch.rt = Rt()

    async def nothing(_runs):
        return 0
    orch.release_stalled = nothing
    orch.auto_retry = nothing
    assert asyncio.run(orch.tick()) == 0
    assert len(reads) == 1


def test_stale_pool_failures_count_toward_retry_limit_and_force_a_fresh_connection(monkeypatch):
    calls = []
    pooled, fresh = object(), object()
    take = []

    def borrow():
        take.append(True)
        return pooled, True

    monkeypatch.setattr(sb, "_take", borrow)
    monkeypatch.setattr(sb, "_make_pool_client", lambda: fresh)

    def fail(client):
        calls.append(client)
        raise httpx.ReadTimeout("timeout")

    with pytest.raises(httpx.ReadTimeout):
        REAL_WITH_CLIENT(fail, max_attempts=3)
    assert calls == [pooled, fresh, fresh]
    assert len(take) == 1


def test_stale_connection_retry_can_recover_on_a_fresh_connection(monkeypatch):
    pooled, fresh = object(), object()
    monkeypatch.setattr(sb, "_take", lambda: (pooled, True))
    monkeypatch.setattr(sb, "_make_pool_client", lambda: fresh)

    def query(client):
        if client is pooled:
            raise httpx.ReadTimeout("stale")
        return "saved"

    assert REAL_WITH_CLIENT(query, max_attempts=2) == "saved"


def test_saturated_pool_refuses_extra_connections_instead_of_causing_a_connection_storm(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock
    monkeypatch.setattr(sb, "_slots", SimpleNamespace(acquire=lambda **kwargs: False))
    make = Mock()
    monkeypatch.setattr(sb, "_make_pool_client", make)
    with pytest.raises(httpx.PoolTimeout):
        REAL_WITH_CLIENT(lambda client: "unexpected")
    make.assert_not_called()
