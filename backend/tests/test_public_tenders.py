import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.modules.agent import conductor, procurement
from app.modules.agent.router import AgentRequestIn
from app.modules.tenders import service
from app.modules.tenders.router import router

NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)


def release(notice="000101-2026", date="2026-11-17T12:00:00Z", tags=None, status="active"):
    return {"id": notice, "ocid": "ocds-h6vhtk-001abc", "date": date, "tag": tags or ["tender"],
            "buyer": {"name": "Example Council"}, "tender": {"title": "School catering", "status": status,
                "tenderPeriod": {"endDate": "2026-12-01T12:00:00Z"}, "value": {"amount": 0, "currency": "GBP"}}}


def test_source_classification_and_missing_fields_are_distinct(monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    cases = [(release(), "open"), (release(tags=["planning"], status="planned"), "planning"),
             (release(tags=["award"], status="complete"), "award"),
             (release(tags=["tenderCancellation"]), "closed"), (release(status="planned"), "other")]
    for item, expected in cases:
        assert service.parse_release(item)["listings"][0]["stage"] == expected
    item = release()
    del item["buyer"]
    del item["tender"]["tenderPeriod"]
    listing = service.parse_release(item)["listings"][0]
    assert listing["details"]["amount"] == 0
    assert listing["details"]["buyer"] is listing["deadline"] is None
    assert service.parse_release({"id": "not-a-notice"})["rejection"]
    assert service.parse_release(None)["rejection"]
    row = {**listing, "notice_id": item["id"], "ocid": item["ocid"], "deadline": "2026-11-01T00:00:00Z"}
    public = service.public_listing(row)
    assert public["status"] == "closed"
    assert public["url"] == "https://www.find-tender.service.gov.uk/Notice/000101-2026"


def test_lot_awards_keep_identity_and_do_not_close_other_lots():
    original = release()
    original["tender"]["lots"] = [{"id": "1", "title": "One"}, {"id": "2", "title": "Two"}]
    before = service.parse_release(original)["listings"]
    award = deepcopy(original)
    award.update(id="000102-2026", tag=["award"], date="2026-11-18T12:00:00Z",
                 awards=[{"relatedLots": ["1"]}])
    after = service.parse_release(award)["listings"]
    assert [item["id"] for item in after] == [before[0]["id"]]
    assert after[0]["stage"] == "award"
    assert before[1]["stage"] == "open"
    cancelled = service.parse_release(release(tags=["tenderCancellation"], status="cancelled"))["listings"][0]
    assert cancelled["whole_process_closed"]


def test_import_window_pagination_replay_amendment_and_feed_recovery():
    versions = set()
    current = {}
    requests = []
    closing = release(notice="000102-2026", date="2026-11-18T11:00:00Z", tags=["tenderCancellation"], status="cancelled")
    attempt = 0

    async def persist(rows):
        added = 0
        for row in rows:
            if row["version_id"] in versions:
                continue
            versions.add(row["version_id"])
            if row.get("rejection"):
                continue
            added += 1
            for listing in row["listings"]:
                if listing["published_at"] >= current.get(listing["id"], {}).get("published_at", ""):
                    current[listing["id"]] = listing
        return added

    def respond(request):
        requests.append(dict(request.url.params))
        if "cursor" not in request.url.params:
            return httpx.Response(200, json={"releases": [release(), {"id": "bad"}],
                "links": {"next": service.ENDPOINT + "?cursor=follow"}})
        if attempt == 0:
            return httpx.Response(429, headers={"Retry-After": "17"})
        return httpx.Response(200, json={"releases": [closing]})

    async def run():
        nonlocal attempt
        start = NOW - timedelta(hours=12)
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with pytest.raises(service.FeedError) as throttled:
                await service.ingest_window(client, start, NOW, persist, pause=AsyncMock())
            assert throttled.value.retry_after == 17
            attempt += 1
            summary = await service.ingest_window(client, start, NOW, persist, pause=AsyncMock())
            replay = await service.ingest_window(client, start, NOW, persist, pause=AsyncMock())
            assert summary == {"pages": 2, "seen": 3, "imported": 1, "quarantined": 1}
            assert replay["imported"] == 0 and len(versions) == 3
            assert next(iter(current.values()))["stage"] == "closed"
            assert requests[0] == requests[2] and requests[1] == requests[3]

    asyncio.run(run())


def test_sync_failure_retains_checkpoint_and_success_advances(monkeypatch):
    checkpoint = NOW - timedelta(hours=4)
    acquire = AsyncMock(return_value=[{"checkpoint": checkpoint.isoformat()}])
    update = AsyncMock(return_value=[{}])
    window = AsyncMock(side_effect=[service.FeedError("feed unavailable", 42),
                                    {"pages": 1, "seen": 0, "imported": 0, "quarantined": 0}])
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    monkeypatch.setattr(service, "sb_rpc", acquire)
    monkeypatch.setattr(service, "sb_update", update)
    monkeypatch.setattr(service, "ingest_window", window)
    assert asyncio.run(service.sync_once())["status"] == "failed"
    failed = update.call_args.kwargs["payload"]
    assert "checkpoint" not in failed
    assert failed["retry_at"] == (NOW + timedelta(seconds=42)).isoformat()
    assert asyncio.run(service.sync_once())["status"] == "synced"
    assert update.call_args.kwargs["payload"]["checkpoint"] == NOW.isoformat()


def test_public_routes_and_watchlist_auth(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    search = AsyncMock(return_value={"items": [], "last_sync": None, "stale": True})
    monkeypatch.setattr(service, "search", search)
    monkeypatch.setattr(service, "get_listing", AsyncMock(return_value={"id": "test", "title": "Catering"}))
    client = TestClient(app)
    assert client.get("/public-tenders").status_code == 200
    search.assert_awaited_once_with("", "open", 1)
    assert client.get("/public-tenders/test").json()["title"] == "Catering"
    assert client.get("/public-tenders?stage=bad").status_code == 422
    assert client.get("/public-tenders/watchlist?workspace_id=private").status_code in (401, 403)
    assert client.post("/public-tenders/admin/sync").status_code in (401, 403)
    assert client.get("/public-tenders/admin/history").status_code in (401, 403)
    assert client.post("/public-tenders/admin/dismiss-error", json={"attempt": "2026-11-18T13:00:00Z"}).status_code in (401, 403)


def test_watchlist_checks_membership_and_scopes_every_change(monkeypatch):
    check = AsyncMock(side_effect=HTTPException(404))
    select = AsyncMock(return_value=[])
    put = AsyncMock()
    delete = AsyncMock()
    monkeypatch.setattr(service.sourcing, "require_workspace", check)
    monkeypatch.setattr(service, "sb_select", select)
    monkeypatch.setattr(service, "sb_upsert", put)
    monkeypatch.setattr(service, "sb_delete", delete)
    monkeypatch.setattr(service, "get_listing", AsyncMock())

    async def run():
        with pytest.raises(HTTPException):
            await service.watchlist("other", "private")
        with pytest.raises(HTTPException):
            await service.set_saved("other", "private", "test", True)
        select.assert_not_called()
        put.assert_not_called()
        check.side_effect = None
        await service.watchlist("buyer", "private")
        assert select.call_args.kwargs["filters"] == [("workspace_id", "eq", "private"), ("user_id", "eq", "buyer")]
        await service.set_saved("buyer", "private", "test", True)
        assert put.call_args.kwargs["payload"] == {"workspace_id": "private", "user_id": "buyer", "listing_id": "test"}
        await service.set_saved("buyer", "private", "test", False)
        assert ("user_id", "eq", "buyer") in delete.call_args.kwargs["filters"]

    asyncio.run(run())


def test_procurement_conversation_uses_shared_search(monkeypatch):
    url = "https://www.find-tender.service.gov.uk/Notice/000101-2026"
    result = {"items": [{"title": "Catering", "buyer": "Council", "status": "open", "url": url,
                        "amount": None, "deadline": None}], "last_sync": None, "stale": False}
    search = AsyncMock(return_value=result)
    monkeypatch.setattr(service, "search", search)
    monkeypatch.setattr(procurement.sourcing, "_owned_workspace", AsyncMock(return_value={}))
    monkeypatch.setattr(conductor, "_keep", AsyncMock())
    request = AgentRequestIn(text="Find open UK public tenders for catering", business_id="buyer")
    assert procurement.should_route(request, [])
    response = asyncio.run(procurement.run(None, {"id": "buyer"}, request, {}))
    search.assert_awaited_once_with("catering", "open", limit=5)
    assert response["procurement"]["tenders"][0]["url"] == url
    assert url in response["message"]


def test_automatic_sync_preference_overrides_startup_default(monkeypatch):
    monkeypatch.setenv("FTS_SYNC_ENABLED", "1")
    assert service.automatic_enabled({})
    assert service.automatic_enabled({"automatic_sync": None})
    assert not service.automatic_enabled({"automatic_sync": False})
    monkeypatch.setenv("FTS_SYNC_ENABLED", "0")
    assert service.automatic_enabled({"automatic_sync": True})


def test_automatic_sync_is_admin_only_and_persists(monkeypatch):
    from app.modules.admin.router import require_admin

    app = FastAPI()
    app.include_router(router)
    update = AsyncMock(return_value=[{"automatic_sync": True}])
    monkeypatch.setattr(service, "sb_update", update)
    client = TestClient(app)
    assert client.put("/public-tenders/admin/schedule", json={"enabled": True}).status_code in (401, 403)
    update.assert_not_called()
    app.dependency_overrides[require_admin] = lambda: {"id": "admin"}
    assert client.put("/public-tenders/admin/schedule", json={"enabled": "true"}).status_code == 422
    assert client.put("/public-tenders/admin/schedule", json={"enabled": True}).json() == {"scheduled": True}
    assert update.call_args.kwargs["payload"] == {"automatic_sync": True}


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), "a\x00b", "\ud800"])
def test_malformed_release_is_quarantined_as_storable_json(invalid):
    import json

    notice = release()
    notice["tender"]["description"] = invalid
    result = service.parse_release(notice)
    assert result["rejection"]
    assert not result["listings"]
    json.dumps(result, allow_nan=False, ensure_ascii=False).encode("utf-8")


def test_malformed_next_link_is_reported_as_a_feed_error():
    with pytest.raises(service.FeedError, match="malformed pagination link"):
        service.next_cursor("https://[broken")
