import asyncio
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.modules.tenders import access


def test_two_unique_tenders_shared_across_entry_points_and_revisits_are_free(monkeypatch):
    monkeypatch.setattr(access, "plan_meets", AsyncMock(return_value=False))
    seen = set()
    async def claim(user, tender):
        key = (user, tender)
        if key in seen: return True
        if len([entry for entry in seen if entry[0] == key[0]]) == 2: return False
        seen.add(key)
        return True
    monkeypatch.setattr(access, "claim_free_view", claim)
    for notice in ["one", "two", "one"]:
        asyncio.run(access.require_detail_access("user", {"id": notice, "ocid": notice}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(access.require_detail_access("user", {"id": "three"}))
    assert error.value.detail["code"] == "TENDER_PREVIEW_LIMIT"
    asyncio.run(access.require_detail_access("another", {"id": "three"}))


def test_paid_users_do_not_consume_the_free_allowance(monkeypatch):
    monkeypatch.setattr(access, "plan_meets", AsyncMock(return_value=True))
    rpc = AsyncMock()
    monkeypatch.setattr(access, "claim_free_view", rpc)
    asyncio.run(access.require_detail_access("user", {"id": "anything"}))
    rpc.assert_not_awaited()


def test_allowance_record_updates_are_atomic_and_revisits_do_not_write(monkeypatch):
    from copy import deepcopy
    row = {"id": "counter", "revision": 1, "data": {"views": ["one"]}}
    monkeypatch.setattr(access, "sb_select", AsyncMock(side_effect=lambda *a, **k: deepcopy(row)))
    async def update(table, *, payload, filters):
        assert ("revision", "eq", row["revision"]) in filters
        row.update(payload)
        return [deepcopy(row)]
    write = AsyncMock(side_effect=update)
    monkeypatch.setattr(access, "sb_update", write)
    assert asyncio.run(access.claim_free_view("user", "two"))
    assert row["revision"] == 2 and row["data"]["views"] == ["one", "two"]
    assert asyncio.run(access.claim_free_view("user", "one"))
    assert not asyncio.run(access.claim_free_view("user", "three"))
    write.assert_awaited_once()
