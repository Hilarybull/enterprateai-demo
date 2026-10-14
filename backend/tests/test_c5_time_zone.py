"""C5: a business with no time zone of its own works on its country's clock, never the browser's or a fixed default."""
from datetime import datetime, timezone

from app.modules.agent import business as bz


def test_the_country_gives_the_zone_when_none_is_set_and_an_own_zone_always_wins():
    uk = {"workspace_profile": {"country": "United Kingdom"}}
    assert bz.zone_name(uk) == "Europe/London" and str(bz.business_timezone(uk)) == "Europe/London"
    assert bz.zone_name({"workspace_profile": {"country": "Nigeria"}}) == "Africa/Lagos"
    assert bz.zone_name({"workspace_profile": {"country": "UK", "timezone": "America/New_York"}}) == "America/New_York"
    assert bz.zone_name({"workspace_profile": {"country": "Atlantis"}}) == "UTC" and bz.zone_name({}) == "UTC"
    # 23:30 UTC on 14 Oct is already 15 Oct in London (BST): "today" on the business's own clock.
    assert bz.local_now(uk, datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc)).date().isoformat() == "2026-10-15"


def test_agent_settings_offer_the_country_zone_not_the_browsers(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    from test_agent import OWNER, Env
    env = Env()
    env.businesses["A"]["data"].setdefault("workspace_profile", {}).update({"country": "United Kingdom"})
    env.businesses["A"]["data"]["workspace_profile"].pop("timezone", None)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        res = TestClient(app).get("/businesses/A/agent/policy").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert res["timezone"] == "Europe/London" and res["timezone_set"] is False
