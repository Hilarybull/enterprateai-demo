"""The superadmin can open or close a business for proposals. It is the owner's own setting, and the listing is never published by it."""
from fastapi.testclient import TestClient

from app.main import app
from app.modules.admin import router as admin
from app.modules.agent import router as agent_router
from app.shared.auth.deps import get_current_user
from test_agent import Env


def test_opening_keeps_the_owners_other_choices_and_never_publishes():
    data = {"workspace_profile": {"company_name": "Juniper Lane"}, "marketplace": {"is_active": False},
            "proposal_preferences": {"enabled": False, "accepted_modes": ["general", "rfp"], "proposal_cap": 5}}
    out = admin.open_for_proposals(data, True, "2026-11-09T10:00:00Z")
    assert out == {"enabled": True, "listing_live": False}
    assert data["proposal_preferences"]["enabled"] is True
    assert data["proposal_preferences"]["accepted_modes"] == ["general", "rfp"] and data["proposal_preferences"]["proposal_cap"] == 5
    assert data["marketplace"]["is_active"] is False and data["marketplace"]["open_for_proposals"] is True


def test_closing_switches_it_off():
    data = {"marketplace": {"is_active": True, "open_for_proposals": True}, "proposal_preferences": {"enabled": True}}
    assert admin.open_for_proposals(data, False, "2026-11-09T10:00:00Z") == {"enabled": False, "listing_live": True}
    assert data["marketplace"]["open_for_proposals"] is False


def test_the_route_switches_a_business_and_only_admins_can(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    logged = []

    async def audit(actor, action, detail):
        logged.append((action, detail))
    monkeypatch.setattr(admin, "_audit", audit)
    client = TestClient(app, raise_server_exceptions=False)
    try:
        app.dependency_overrides[admin.require_admin] = lambda: {"id": "a", "email": "tech.support@enterprateai.com"}
        r = client.patch("/admin/workspaces/A/proposals", json={"enabled": True})
        assert r.status_code == 200 and r.json()["enabled"] is True
        assert env.businesses["A"]["data"]["proposal_preferences"]["enabled"] is True
        assert logged == [("workspace_proposals_changed", {"workspace_id": "A", "enabled": True})]
        from app.modules.agent.business import BusinessAccessDenied

        async def gone(_bid, _fn):
            raise BusinessAccessDenied("Business not found.")
        monkeypatch.setattr(env.orch.rt.business, "mutate", gone)
        assert client.patch("/admin/workspaces/missing/proposals", json={"enabled": True}).status_code == 404
        app.dependency_overrides.pop(admin.require_admin)
        app.dependency_overrides[get_current_user] = lambda: {"id": "u", "email": "someone@example.test"}
        assert client.patch("/admin/workspaces/A/proposals", json={"enabled": False}).status_code == 403
    finally:
        app.dependency_overrides.clear()
