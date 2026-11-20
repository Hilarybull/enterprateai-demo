from unittest.mock import AsyncMock

import pytest

from app.modules.agent import fx, summary
from app.modules.agent.orchestrator import AccessDenied
from test_agent import Env, OWNER, OUTSIDER, run
from test_dashboard import build


def test_dashboard_refreshes_rates_using_authorised_record_once(monkeypatch):
    env = Env()
    monkeypatch.setattr(fx, "currencies_used", lambda data: {"USD"})
    refresh = AsyncMock(return_value=None)
    monkeypatch.setattr(fx, "ensure", refresh)
    record = AsyncMock(wraps=env.orch.rt.business.record)
    monkeypatch.setattr(env.orch.rt.business, "record", record)
    result = build(env)
    assert result["enabled"]
    assert record.await_count == 1
    refresh.assert_awaited_once()
    assert refresh.await_args.args[1] == "A"
    assert isinstance(refresh.await_args.args[2], dict)


def test_rate_refresh_never_runs_before_workspace_authorisation(monkeypatch):
    env = Env()
    monkeypatch.setattr(fx, "currencies_used", lambda data: {"USD"})
    refresh = AsyncMock()
    monkeypatch.setattr(fx, "ensure", refresh)
    with pytest.raises(AccessDenied):
        run(summary.build_summary(env.orch, OUTSIDER, "A", refresh_rates=True))
    refresh.assert_not_awaited()
