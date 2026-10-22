"""Synthetic: reading an unfinished profile logs field names only, quietly, never the profile's values."""
import asyncio
import logging
from types import SimpleNamespace

from app.modules.workspace_profile import service


def test_unfinished_profile_is_not_a_warning_and_never_logs_values(monkeypatch, caplog):
    ws = SimpleNamespace(id="w1", updated_at=None, data={"workspace_profile": {"email": "owner@example.com", "company_name": "Test Ltd"}})

    async def load(_u, _w):
        return ws
    monkeypatch.setattr(service, "_load_workspace", load)
    with caplog.at_level(logging.DEBUG, logger=service.__name__):
        out = asyncio.run(service.get_profile(user_id="u1", workspace_id="w1"))
    assert out["profile"]["company_name"] == "Test Ltd"
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert "owner@example.com" not in caplog.text


def _ws(profile):
    return SimpleNamespace(id="w1", updated_at=None, name="Test Ltd", data={"workspace_profile": profile})


def _run_upsert(monkeypatch, existing, incoming, seen=None):
    from app.modules.workspace_profile.schemas import WorkspaceProfile
    saved = {}
    ws = _ws(existing)

    async def load(_u, _w):
        return ws

    async def update(**kw):
        saved.update(kw["data_patch"])
        ws.data = {**ws.data, **kw["data_patch"]}

    async def get(**_kw):
        return ws

    async def nothing(*_a, **_k):
        return {}
    monkeypatch.setattr(service, "_load_workspace", load)
    monkeypatch.setattr(service, "update_workspace", update)
    monkeypatch.setattr(service, "get_workspace", get)
    monkeypatch.setattr(service, "_sync_catalogue", nothing)
    monkeypatch.setattr(service, "_after_rename", nothing)
    asyncio.run(service.upsert_profile(user_id="u1", workspace_id="w1", profile=WorkspaceProfile.model_validate(incoming), seen=seen))
    return saved["workspace_profile"]


BASE = {"company_name": "Test Ltd", "email": "owner@example.com", "business_type": "limited_company", "primary_industry": "consulting", "country": "United Kingdom",
        "city": "Leeds", "operating_stage": "growing", "delivery_model": "hybrid", "about_company": "We advise small firms.",
        "services": [{"service_name": "Audits", "service_category": "consulting", "service_description": "A yearly audit", "description_suggested": True}],
        "timezone": "Europe/London", "provenance": {"city": {"source": "You"}}}


def test_another_pages_save_fills_blanks_and_never_overwrites(monkeypatch):
    incoming = {**BASE, "business_type": "startup", "operating_stage": "idea", "city": "Online", "tagline": "Clear advice",
                "services": [{"service_name": "Audits", "service_category": "consulting"}]}
    out = _run_upsert(monkeypatch, dict(BASE), incoming)      # no `seen`: Idea Validation's own form
    assert (out["business_type"], out["operating_stage"], out["city"]) == ("limited_company", "growing", "Leeds")
    assert out["tagline"] == "Clear advice"                          # an empty field is filled
    assert out["timezone"] == "Europe/London" and out["provenance"] == {"city": {"source": "You"}}      # never deleted
    assert out["services"][0]["service_description"] == "A yearly audit"


def test_the_owners_own_form_still_changes_values(monkeypatch):
    out = _run_upsert(monkeypatch, dict(BASE), {**BASE, "city": "York"}, seen={**BASE})
    assert out["city"] == "York" and out["timezone"] == "Europe/London"
