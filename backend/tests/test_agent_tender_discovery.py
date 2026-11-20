import asyncio
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest

from app.modules.agent import conductor, procurement
from app.modules.agent.router import AgentRequestIn
from app.modules.tenders import service, recommendations


@pytest.mark.parametrize("text,query,stage", [
    ("what are the available tenders now", "", "open"),
    ("Can you show me all available tenders please?", "", "open"),
    ("What tenders do we have currently?", "", "open"),
    ("What's available in public tenders at the moment?", "", "open"),
    ("Show SME suitable tenders available today", "", "open"),
    ("Find open UK public tenders for catering", "catering", "open"),
    ("show awarded contracts", "", "award"),
    ("List all statuses for healthcare tenders", "healthcare", "all"),
])
def test_conversation_extracts_subject_instead_of_searching_question_words(text, query, stage):
    assert service.conversation_filters(text) == (query, stage)


def test_explicit_agent_query_drops_generic_question_words():
    assert service.conversation_filters("what tenders are available now", "what are available now") == ("", "open")


def setup_agent(monkeypatch):
    monkeypatch.setattr(procurement.sourcing, "_owned_workspace", AsyncMock(return_value={}))
    monkeypatch.setattr(conductor, "_keep", AsyncMock())


def test_available_tenders_use_full_shared_index_count_and_unfiltered_internal_link(monkeypatch):
    setup_agent(monkeypatch)
    item = {"id": "process:lot:1", "title": "Grounds maintenance", "buyer": "Council", "status": "open",
            "deadline": "2026-12-18T12:00:00Z", "amount": 105500, "currency": "GBP",
            "url": "https://www.find-tender.service.gov.uk/Notice/107347-2026"}
    search = AsyncMock(return_value={"items": [item], "total": 65, "stale": True})
    monkeypatch.setattr(service, "search", search)
    request = AgentRequestIn(text="what are the available tenders now", business_id="business")
    result = asyncio.run(procurement.run(None, {"id": "user"}, request, {}))
    search.assert_awaited_once_with("", "open", limit=5)
    assert "65 open tenders" in result["message"]
    assert "Grounds maintenance" in result["message"]
    assert "18 Dec 2026, 12:00 UK time" in result["message"]
    assert "index" not in result["message"] and "out of date" not in result["message"]
    assert "find-tender.service.gov.uk" not in result["message"]
    assert "q" not in parse_qs(urlparse(result["actions"][0]["to"]).query)
    assert result["actions"][1]["to"] == "/marketplace?tab=tenders&tender=process%3Alot%3A1"


def test_business_questions_use_the_dashboard_matching_service(monkeypatch):
    setup_agent(monkeypatch)
    recommend = AsyncMock(return_value={"items": [{"id": "match", "title": "Software services", "buyer": "Council"}],
                                      "total": 4, "profile_needed": False})
    search = AsyncMock()
    monkeypatch.setattr(recommendations, "recommend", recommend)
    monkeypatch.setattr(service, "search", search)
    request = AgentRequestIn(text="Which tenders match my business?", business_id="business")
    result = asyncio.run(procurement.run(None, {"id": "user"}, request, {}))
    recommend.assert_awaited_once_with("user", "business", stage="open", page_size=5)
    search.assert_not_called()
    assert "4 open tenders matching your business" in result["message"]
    assert result["procurement"]["tenders"][0]["id"] == "match"


def test_awarded_contract_questions_route_to_the_same_tender_index(monkeypatch):
    setup_agent(monkeypatch)
    search = AsyncMock(return_value={"items": [], "total": 0})
    monkeypatch.setattr(service, "search", search)
    request = AgentRequestIn(text="Show awarded contracts", business_id="business")
    assert procurement.should_route(request, [])
    asyncio.run(procurement.run(None, {"id": "user"}, request, {}))
    search.assert_awaited_once_with("", "award", limit=5)
