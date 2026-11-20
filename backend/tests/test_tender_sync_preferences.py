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
