import pytest

from app.core.config import get_settings


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
