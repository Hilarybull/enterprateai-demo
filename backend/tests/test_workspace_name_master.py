"""QA, 16 Oct: the workspace name is master data. A form save (the Idea Validation wizard sends the name the browser
remembered) never renames a workspace; it only names one that has none yet."""
import asyncio
from types import SimpleNamespace

from app.modules.idea_validation import service


def _patched(monkeypatch, current_name):
    written = {}
    ws = SimpleNamespace(id="w1", user_id="u", name=current_name, data={"workspace_profile": {"company_name": "Alchemy Test"}}, updated_at="now", created_at="now")

    async def accessible(**kw):
        return ws, True

    async def update(table, payload, filters):
        written.update(payload)

    async def get(**kw):
        return ws
    monkeypatch.setattr(service, "_get_accessible_workspace", accessible)
    monkeypatch.setattr(service, "sb_update", update)
    monkeypatch.setattr(service, "get_workspace", get)
    monkeypatch.setattr(service, "_save_snapshot_to_mongo", lambda *a, **k: asyncio.sleep(0))
    return written


def test_a_save_never_renames_a_named_workspace(monkeypatch):
    written = _patched(monkeypatch, "Alchemy Test")
    asyncio.run(service.update_workspace(user_id="u", workspace_id="w1", data_patch={"catalogue": {}}, name="Apex Consulting Ltd"))
    assert "name" not in written


def test_a_save_names_a_workspace_that_has_no_name_yet(monkeypatch):
    written = _patched(monkeypatch, "My workspace")
    asyncio.run(service.update_workspace(user_id="u", workspace_id="w1", data_patch={}, name="Alchemy Test"))
    assert written["name"] == "Alchemy Test"
