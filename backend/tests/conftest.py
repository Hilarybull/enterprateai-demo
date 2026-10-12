import os

import pytest

# QA D1: the suite never talks to a real database. backend/.env points at the dev Supabase; these
# are cleared before the app is imported, and every test runs with no way to open a connection.
for _name in ("SUPABASE_URL", "PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "SUPABASE_ANON_KEY"):
    os.environ[_name] = ""

from app.core.config import get_settings  # noqa: E402


_ATTEMPTS: list[str] = []      # every test that reached for a real database, even where app code swallowed the error


class RealDatabaseUsed(RuntimeError):
    """A test reached for a real database. Tests use the in-memory stores (test_agent.Env) instead."""


@pytest.fixture(autouse=True)
def _isolated_database(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", None, raising=False)
    monkeypatch.setattr(settings, "supabase_service_role_key", None, raising=False)
    # ... and no real model provider either: tests never call out (QA H). A test gives the understanding layer its own model.
    for key in ("openai_api_key", "claude_api_key", "gemini_api_key"):
        monkeypatch.setattr(settings, key, None, raising=False)
    from app.core import supabase as sb

    def _refuse(*_a, **_k):
        _ATTEMPTS.append(f"{os.environ.get('PYTEST_CURRENT_TEST', '?').split(' ')[0]} connect")
        raise RealDatabaseUsed("a test tried to open a real Supabase connection")
    for name in ("_make_client", "_make_pool_client", "get_supabase_client"):
        if hasattr(sb, name):
            monkeypatch.setattr(sb, name, _refuse)


@pytest.fixture(autouse=True)
def _no_local_qa_overrides(monkeypatch):
    """Tests check the real plan limits, whatever a developer's local .env sets for QA."""
    settings = get_settings()
    monkeypatch.setattr(settings, "agent_monthly_runs_override", None)
    monkeypatch.setattr(settings, "agent_max_active_runs_override", None)
    # No extra Marketplace moderators unless a test names them (a local .env may list QA accounts).
    monkeypatch.setattr(settings, "marketplace_moderators", "")
    # The suite describes the directory with unclaimed profiles open to everyone; the tests for
    # the other visibility levels set theirs explicitly.
    monkeypatch.setattr(settings, "marketplace_unclaimed_visibility", "public")
    # ... and without the pilot review of newly published self-made profiles, which has its own tests.
    monkeypatch.setattr(settings, "marketplace_self_created_review", "off")


@pytest.fixture(autouse=True)
def _monthly_task_allowance(request, monkeypatch):
    """A plan-included task is limited by AI Credits, not by a monthly count (config.MONTHLY_TASK_ALLOWANCE_APPLIES).
    The count is still in the code, and the tests written for it keep checking it: they run with it
    applied. A test marked `as_shipped` runs with the shipped setting."""
    from app.modules.agent import config as agent_config
    monkeypatch.setattr(agent_config, "MONTHLY_TASK_ALLOWANCE_APPLIES", not request.node.get_closest_marker("as_shipped"))


def pytest_configure(config):
    config.addinivalue_line("markers", "as_shipped: run with the shipped setting for the monthly task count (not applied)")


def pytest_terminal_summary(terminalreporter):
    tests = sorted({t.split(" ")[0] for t in _ATTEMPTS})
    # Blocked, not failed: app code that reads optional data (a plan, a grant) carries on without it, as it would offline.
    terminalreporter.write_line(f"real-database attempts blocked: {len(_ATTEMPTS)} in {len(tests)} tests (no connection was made)")
