import asyncio
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.admin.router import require_admin
from app.modules.tenders import service
from app.modules.tenders.router import router


def test_schedule_preferences_require_admin_and_validate_before_saving(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    update = AsyncMock(return_value=[{"id": service.SOURCE}])
    monkeypatch.setattr(service, "sb_update", update)
    client = TestClient(app)
    settings = {"enabled": True, "interval_minutes": 60, "import_scope": "suitable"}
    assert client.put("/public-tenders/admin/schedule", json=settings).status_code in (401, 403)
    update.assert_not_called()
    app.dependency_overrides[require_admin] = lambda: {"id": "admin"}
    for value in (0, 4, 1441, True, "60", 5.5):
        assert client.put("/public-tenders/admin/schedule", json={**settings, "interval_minutes": value}).status_code == 422
    assert client.put("/public-tenders/admin/schedule", json={**settings, "import_scope": "guess"}).status_code == 422
    update.assert_not_called()
    assert client.put("/public-tenders/admin/schedule", json=settings).json() == {
        "scheduled": True, "interval_minutes": 60, "import_scope": "suitable"}
    assert update.call_args.kwargs["payload"] == {
        "automatic_sync": True, "interval_minutes": 60, "import_scope": "suitable"}


def test_health_reports_saved_preferences_and_legacy_capability(monkeypatch):
    select = AsyncMock(return_value={"automatic_sync": True, "interval_minutes": 45, "import_scope": "suitable"})
    monkeypatch.setattr(service, "sb_select", select)
    health = asyncio.run(service.sync_health())
    assert health["preferences_configurable"]
    assert health["interval_minutes"] == 45
    assert health["import_scope"] == "suitable"
    select.return_value = {"automatic_sync": False}
    health = asyncio.run(service.sync_health())
    assert not health["preferences_configurable"]
    assert health["interval_minutes"] == 180
    assert health["import_scope"] == "all"


def test_history_paginates_at_database_before_newest_first(monkeypatch):
    from datetime import datetime, timezone
    rows = [{"attempted_at": f"2026-11-{day:02}T12:00:00Z"} for day in (20, 19, 18)]
    select = AsyncMock(return_value=rows)
    monkeypatch.setattr(service, "sb_select", select)
    result = asyncio.run(service.sync_history(page_size=2))
    assert result == {"items": rows[:2], "more": True, "next_before": rows[1]["attempted_at"]}
    assert select.call_args.kwargs == {"filters": [], "order": "attempted_at", "desc": True, "limit": 3}
    before = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
    select.return_value = [rows[-1]]
    result = asyncio.run(service.sync_history(before=before, page_size=2))
    assert result == {"items": [rows[-1]], "more": False, "next_before": None}
    assert select.call_args.kwargs["filters"] == [("attempted_at", "lt", before.isoformat())]


def test_history_routes_validate_and_require_admin(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    history = AsyncMock(return_value={"items": [], "more": False, "next_before": None})
    monkeypatch.setattr(service, "sync_history", history)
    client = TestClient(app)
    assert client.get("/public-tenders/admin/history?page_size=10").status_code in (401, 403)
    history.assert_not_called()
    app.dependency_overrides[require_admin] = lambda: {"id": "admin"}
    assert client.get("/public-tenders/admin/history?page_size=51").status_code == 422
    assert client.get("/public-tenders/admin/history?before=wrong").status_code == 422
    assert client.get("/public-tenders/admin/history?page_size=10").json()["more"] is False
