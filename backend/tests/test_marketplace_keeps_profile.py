"""Synthetic: publishing on the Marketplace never writes its placeholder defaults onto the workspace profile (21 Oct)."""
import asyncio
from types import SimpleNamespace

from app.modules.marketplace import directory, service
from app.modules.plans import access, capabilities


def test_publish_leaves_the_workspace_profile_as_the_owner_left_it(monkeypatch):
    profile = {"company_name": "Test Ltd", "email": "owner@example.com"}      # business type, industry, city, about: not set yet
    ws = SimpleNamespace(id="w1", name="Test Ltd", data={"workspace_profile": dict(profile)})
    written = {}

    async def load(_u, _w):
        return ws

    async def update(_table, filters=None, payload=None):
        written.update(payload["data"])
        return [{"id": "w1"}]

    async def plan(_u):
        return "decision_engine"
    monkeypatch.setattr(service, "_load_workspace", load)
    monkeypatch.setattr(service, "_ws_fields", lambda w: (w.id, w.data))
    monkeypatch.setattr(service, "sb_update", update)
    monkeypatch.setattr(access, "effective_plan_key", plan)
    monkeypatch.setattr(capabilities, "quota", lambda *_a: None)
    monkeypatch.setattr(directory, "activation_of", lambda *_a, **_k: {"ready": True})
    monkeypatch.setattr(directory, "marketplace_settings", lambda d: d)
    asyncio.run(service.publish_workspace(user={"id": "u1", "email": "owner@example.com"}, workspace_id="w1"))
    assert written["workspace_profile"] == profile                       # no "startup", "other", "Online" or stock About
    assert written["marketplace"]["is_active"] is True
