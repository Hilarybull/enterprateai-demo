import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.modules.tenders import service
from app.modules.agent import router as agent_router, procurement
from app.modules.proposals import sourcing


def official_release():
    return json.loads((Path(__file__).parent / "fixtures" / "fts_107312_2026.json").read_text(encoding="utf-8"))


def test_official_notice_nested_criteria_participation_and_all_cpvs():
    details = service.parse_release(official_release())["listings"][0]["details"]
    assert "price (80%) and quality (20%)" in details["award_criteria"]
    assert "HCPC" in details["award_criteria"]
    assert "SME" in details["eligibility"] and "VCSE" in details["eligibility"]
    assert [c["id"] for c in details["cpv_classifications"]] == ["75122000", "85000000"]
    assert details["industry"] == "Administrative healthcare services"
    assert "IA4017" in details["submission_instructions"]
    assert details["contract_extension_end"].startswith("2032-03-31")


def test_existing_notice_reprojects_even_with_submission_instructions(monkeypatch):
    raw = official_release()
    listing = service.parse_release(raw)["listings"][0]
    row = {**listing, "ocid": raw["ocid"], "notice_id": raw["id"]}
    row["details"] = {"title": "Old title", "submission_instructions": "Previously mapped", "award_criteria": None}
    select = AsyncMock(side_effect=[row, [{"payload": raw}]])
    monkeypatch.setattr(service, "sb_select", select)
    monkeypatch.setattr(service, "sync_health", AsyncMock(return_value={"last_sync": None, "stale": True}))
    result = asyncio.run(service.get_listing(listing["id"]))
    assert "quality (20%)" in result["award_criteria"]
    assert result["cpv"] == "75122000"


@pytest.mark.parametrize("allowed", [True, False])
def test_http_ui_action_routes_to_procurement_after_workspace_authorisation(monkeypatch, allowed):
    app = FastAPI()
    app.include_router(agent_router.router)
    app.dependency_overrides[agent_router.get_current_user] = lambda: {"id": "owner"}
    owned = AsyncMock(return_value={"data": {}})
    if not allowed:
        owned.side_effect = HTTPException(404, "Workspace not found")
    monkeypatch.setattr(sourcing, "_owned_workspace", owned)
    run = AsyncMock(return_value={"kind": "answer", "message": "Tender explained", "procurement": {"status": "tender_evaluation"}})
    monkeypatch.setattr(procurement, "run", run)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: object())
    response = TestClient(app).post("/agent/requests", json={"business_id": "A", "page": "procurement", "source_channel": "ui_action", "text": "Explain this tender", "params": {"action": "tender_evaluation", "tender_id": "notice-1"}})
    assert response.status_code == (200 if allowed else 404)
    if allowed:
        run.assert_awaited_once()
        assert run.call_args.args[2].params["tender_id"] == "notice-1"
        assert response.json()["procurement"]["status"] == "tender_evaluation"
    else:
        run.assert_not_awaited()
