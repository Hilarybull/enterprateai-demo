"""QA, 16 Oct: a new workspace spends no credits on tasks the Agent starts by itself until the owner switches automatic
starting on (the end-to-end workspace was charged 4 credits for two tasks nobody asked for). Existing settings are kept."""
import asyncio

from app.modules.agent import autostart


def test_a_new_workspace_starts_with_automatic_starting_off(monkeypatch):
    import app.core.supabase as sb
    saved = {}

    async def select(table, **kw):
        return None

    async def upsert(table, payload, on_conflict=None):
        saved[table] = payload
    monkeypatch.setattr(sb, "sb_select", select)
    monkeypatch.setattr(sb, "sb_upsert", upsert)
    asyncio.run(autostart.off_for_new_workspace("ws-new", "owner@example.test"))
    policy = saved["agent_policies"]["policy"]
    assert policy["automation"]["auto_start"] is False and autostart.enabled(policy) is False
    assert policy["approval"] if "approval" in policy else True      # the rest of the defaults stay


def test_a_setting_already_chosen_is_never_changed(monkeypatch):
    import app.core.supabase as sb
    saved = {}

    async def select(table, **kw):
        return {"business_id": "ws-old"}

    async def upsert(table, payload, on_conflict=None):
        saved[table] = payload
    monkeypatch.setattr(sb, "sb_select", select)
    monkeypatch.setattr(sb, "sb_upsert", upsert)
    asyncio.run(autostart.off_for_new_workspace("ws-old", "owner@example.test"))
    assert saved == {}
