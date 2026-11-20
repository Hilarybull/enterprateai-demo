import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app.modules.integrations import router as integration
from app.modules.agent import router as agent_router


@pytest.mark.parametrize("can_prepare", [True, False])
def test_import_uses_the_selected_business_and_checks_role(monkeypatch, can_prepare):
    user = {"id": "owner", "email": "owner@example.test"}
    workspace = SimpleNamespace(id="selected", data={"currency": "GBP", "catalogue": {}, "financials": {}})
    selected = AsyncMock(return_value=workspace)
    latest = AsyncMock(side_effect=AssertionError("Must not resolve the latest business"))
    saved = AsyncMock()
    actor = SimpleNamespace(can_prepare=can_prepare, is_owner=False)
    monkeypatch.setattr(integration, "_require_integration_plan", AsyncMock())
    monkeypatch.setattr(integration, "_load_token_row", AsyncMock(return_value={"access_token": "test"}))
    monkeypatch.setattr(integration, "_get_credentials", lambda *_: ("", ""))
    monkeypatch.setattr(integration, "get_workspace", selected)
    monkeypatch.setattr(integration, "get_user_workspace", latest)
    monkeypatch.setattr(integration, "update_workspace", saved)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: SimpleNamespace(actor_for=AsyncMock(return_value=(actor, {}))))
    monkeypatch.setattr(integration.stripe_mod, "import_from_stripe", AsyncMock(return_value=({"products": [], "customers": [], "invoices": []}, [])))
    monkeypatch.setattr(integration, "sb_update", AsyncMock())
    work = integration.sync("stripe", integration.SyncRequest(business_id="selected"), user)
    if not can_prepare:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(work)
        assert exc.value.status_code == 403
        saved.assert_not_awaited()
    else:
        asyncio.run(work)
        assert saved.await_count >= 1
        assert all(call.kwargs["workspace_id"] == "selected" for call in saved.await_args_list)
    selected.assert_awaited_once_with(user_id="owner", workspace_id="selected")
    latest.assert_not_awaited()
