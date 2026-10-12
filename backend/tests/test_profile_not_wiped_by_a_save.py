"""QA D1: a whole-document save (the Registration wizard's autosave sent {company_name, about_company})
merges into the company profile; it never wipes the answers confirmed at onboarding. And the suite never
reaches a real database."""
import asyncio
from datetime import datetime, timezone

import pytest

from app.core import supabase as sb
from app.modules.idea_validation import service as iv
from app.shared.schemas.common import WorkspaceDocument

ONBOARDED = {"company_name": "QA Sparkle Cleaning Ltd", "about_company": "QA Sparkle Cleaning Ltd is building its business with EnterprateAI.",
             "city": "Leeds", "country": "United Kingdom", "website": "https://sparkle.example", "registration_number": "QA000001",
             "operating_stage": "early_revenue", "company_size": "2-5", "email": "owner@sparkle.example",
             "services": [{"service_name": "Home cleaning"}, {"service_name": "End of tenancy cleaning"}]}


def _save(monkeypatch, patch: dict) -> dict:
    now = datetime.now(timezone.utc)
    ws = WorkspaceDocument(id="ws1", user_id="u1", name="QA Sparkle Cleaning Ltd", created_at=now, updated_at=now,
                           data={"workspace_profile": dict(ONBOARDED), "workspace_profile_updated_at": "2026-10-11T15:45:43Z"})
    written = {}

    async def accessible(**_k):
        return ws, True

    async def update(table, filters, payload):
        written.update(payload)
        return [payload]

    async def nothing(*_a, **_k):
        return None

    async def reread(**_k):
        return ws
    monkeypatch.setattr(iv, "_get_accessible_workspace", accessible)
    monkeypatch.setattr(iv, "sb_update", update)
    monkeypatch.setattr(iv, "_save_snapshot_to_mongo", nothing)
    monkeypatch.setattr(iv, "get_workspace", reread)
    asyncio.run(iv.update_workspace(user_id="u1", workspace_id="ws1", data_patch=patch))
    return written["data"]["workspace_profile"]


def test_the_registration_autosave_shape_no_longer_wipes_the_profile(monkeypatch):
    profile = _save(monkeypatch, {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "about_company": ""},
                                  "registration": {"company_name": "QA Sparkle Cleaning Ltd"}})
    for key in ("city", "website", "registration_number", "operating_stage", "company_size", "email", "services"):
        assert profile[key] == ONBOARDED[key], key
    assert profile["about_company"] == ONBOARDED["about_company"]      # a blank never wipes what is there


def test_a_real_change_to_one_field_still_saves(monkeypatch):
    profile = _save(monkeypatch, {"workspace_profile": {"city": "York"}})
    assert profile["city"] == "York" and profile["registration_number"] == "QA000001"


def test_the_suite_cannot_open_a_real_database():
    with pytest.raises(RuntimeError):
        sb._make_pool_client()
    with pytest.raises(RuntimeError):
        sb.get_supabase_client()
