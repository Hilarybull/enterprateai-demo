import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.modules.tenders import recommendations as rec
from app.modules.tenders.router import router
from app.shared.auth.deps import get_current_user


def test_generic_frameworks_are_not_technology_matches():
    labels = ["AI Adoption Framework", "Software development"]
    for title in ["Sludge Belt Dryers Framework Agreement", "Reablement Framework", "Construction Development Framework"]:
        assert rec.match({"title": title}, labels)[0] == 0
    assert rec.match({"title": "AI Implementation Platform"}, labels)[0] > 0
    assert rec.match({"title": "Software development services"}, labels)[0] > 0


def test_capabilities_ignore_contacts_and_generic_profile():
    assert rec.capabilities({"workspace_profile": {"primary_industry": "Other", "about_company": "medical records", "email": "catering@example.com"}}) == []
    labels = rec.capabilities({"workspace_profile": {"primary_industry": "Healthcare", "secondary_industries": "Medical", "services": [{"service_name": "Mobility assessments"}]}})
    assert "Medical" in labels
    score, reasons = rec.match({"title": "Independent mobility assessment", "industry": "Healthcare"}, labels)
    assert score and reasons
    assert rec.match({"title": "School roofing", "description": "Healthcare"}, ["Healthcare"])[0] == 0


def test_counts_cover_pages_deduplicate_and_keep_lifecycle_separate(monkeypatch):
    monkeypatch.setattr(rec.sourcing, "_owned_workspace", AsyncMock(return_value={"data": {"workspace_profile": {"primary_industry": "Healthcare"}}}))
    async def search(**kwargs):
        stage, page = kwargs["stage"], kwargs["page"]
        item = {"id": f"{stage}-{page}", "title": "Healthcare assessments", "status": stage}
        return {"items": [item, item, {"id": "expired", "status": "closed", "title": "Healthcare"}], "more": page == 1, "stale": True}
    monkeypatch.setattr(rec.service, "search", search)
    result = asyncio.run(rec.recommend("user", "workspace"))
    assert result["open_count"] == result["award_count"] == 2
    assert result["stale"]
    assert all(item["id"].startswith("open-") for item in result["open"])
    assert all(item["reasons"] for item in result["awards"])
    assert "workspace_profile" not in result


def test_authorization_before_search_and_http_route(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "owner"}
    lookup = AsyncMock(side_effect=HTTPException(404, "Workspace not found."))
    search = AsyncMock()
    monkeypatch.setattr(rec.sourcing, "_owned_workspace", lookup)
    monkeypatch.setattr(rec.service, "search", search)
    with TestClient(app) as client:
        assert client.get("/public-tenders/recommendations?workspace_id=foreign").status_code == 404
    search.assert_not_awaited()
    lookup.assert_awaited_once_with("owner", "foreign")


def test_missing_profile_does_not_search_and_errors_are_not_zero(monkeypatch):
    monkeypatch.setattr(rec.sourcing, "_owned_workspace", AsyncMock(return_value={"data": {}}))
    search = AsyncMock()
    monkeypatch.setattr(rec.service, "search", search)
    assert asyncio.run(rec.recommend("user", "workspace"))["profile_needed"]
    search.assert_not_awaited()
    monkeypatch.setattr(rec.sourcing, "_owned_workspace", AsyncMock(return_value={"data": {"workspace_profile": {"primary_industry": "Healthcare"}}}))
    search.side_effect = HTTPException(503, "Unavailable")
    with pytest.raises(HTTPException):
        asyncio.run(rec.recommend("user", "workspace"))


def test_preview_is_two_but_popup_can_page_through_every_match(monkeypatch):
    monkeypatch.setattr(rec.sourcing, "_owned_workspace", AsyncMock(return_value={"data": {"workspace_profile": {"primary_industry": "Healthcare"}}}))
    async def search(**kwargs):
        start, end = (0, 50) if kwargs["page"] == 1 else (50, 63)
        return {"items": [{"id": f"{kwargs['stage']}-{index:03}", "title": "Healthcare", "status": kwargs["stage"], "published_at": f"2026-{index:03}"} for index in range(start, end)], "more": end == 50}
    monkeypatch.setattr(rec.service, "search", search)
    async def scenario():
        preview = await rec.recommend("owner", "A")
        assert preview["open_count"] == 63 and len(preview["open"]) == 2
        first = await rec.recommend("owner", "A", stage="open", page=1, page_size=10)
        last = await rec.recommend("owner", "A", stage="open", page=7, page_size=10)
        assert first["total"] == last["total"] == 63
        assert len(first["items"]) == 10 and first["more"]
        assert len(last["items"]) == 3 and not last["more"]
        assert not {item["id"] for item in first["items"]} & {item["id"] for item in last["items"]}
        assert last["page"] == 7 and last["page_size"] == 10
    asyncio.run(scenario())
