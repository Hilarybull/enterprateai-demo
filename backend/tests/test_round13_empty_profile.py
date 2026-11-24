"""The owner, 26 Oct: "HTTP 404: Workspace profile not found" on Account > Workspace when the sign-up form was skipped: an
empty profile to fill in comes back instead, with the workspace, so the app opens on it."""
import asyncio
from types import SimpleNamespace

from app.modules.workspace_profile import service


def test_a_workspace_with_no_profile_yet_reads_as_an_empty_one(monkeypatch):
    async def get_workspace(*, user_id, workspace_id):
        return SimpleNamespace(id="ws-1", data={"onboarding": {"completed": True}}, updated_at="2026-10-26T18:00:00Z")
    monkeypatch.setattr(service, "get_workspace", get_workspace)
    out = asyncio.run(service.get_profile(user_id="u1", workspace_id="ws-1"))
    assert out == {"workspace_id": "ws-1", "profile": {}, "updated_at": "2026-10-26T18:00:00Z"}
