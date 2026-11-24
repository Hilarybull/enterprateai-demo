import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.modules.agent import readiness_chat, research, converse
from app.modules.readiness import service


@pytest.fixture
def selected(monkeypatch):
    action = {"title": "Resolve this item", "status": "open", "section": "goal", "detail": "The forecast is in GBP and the case is in NGN."}
    subject = {"revision": 5, "actions": [action], "data": {"currency": "NGN", "purpose": "Food"},
               "profile_definition": {"sections": [{"key": "goal", "fields": [{"key": "purpose", "label": "Purpose"}]}]}}
    svc = SimpleNamespace(get_subject=AsyncMock(return_value=subject), update_subject=AsyncMock())
    monkeypatch.setattr(service, "service_for", lambda orch: svc)
    model = SimpleNamespace(generate_text=AsyncMock(return_value=SimpleNamespace(text=json.dumps({"message": "What GBP to NGN rate and date should I use?", "drafts": {}}))))
    monkeypatch.setattr(research, "_default_llm", lambda uid: model)
    async def paid(orch, user, call): return await call()
    monkeypatch.setattr(converse, "paid_reply", paid)
    async def said(orch, user, bid, text, message, actions, now, **kwargs): return {"message": message, **kwargs}
    monkeypatch.setattr(converse, "_said", said)
    monkeypatch.setattr(readiness_chat, "remaining_card", AsyncMock(return_value={"type": "readiness_tasks"}))
    orch = SimpleNamespace(rt=SimpleNamespace(business=SimpleNamespace(load=AsyncMock(return_value={}))))
    item = {"topic": "funding", "case_id": "case", "title": action["title"], "detail": "stale browser detail"}
    return orch, svc, model, item


def test_selected_conflict_uses_live_issue_and_asks_for_missing_conversion_without_general_research(selected):
    orch, svc, model, item = selected
    result = asyncio.run(readiness_chat.work_on_item(orch, {"id": "owner"}, "business", "Help resolve this", item))
    assert "rate and date" in result["message"]
    prompt = json.loads(model.generate_text.call_args.kwargs["prompt"])
    assert prompt["item"]["detail"] == "The forecast is in GBP and the case is in NGN."
    svc.update_subject.assert_not_called()
    svc.get_subject.assert_awaited_once_with("owner", "business", "funding_case", "case", None)


def test_selected_draft_is_saved_for_review_and_unrelated_fields_are_discarded(selected):
    orch, svc, model, item = selected
    model.generate_text.return_value.text = json.dumps({"message": "Prepared", "drafts": {"purpose": "Food stock", "currency": "GBP"}})
    asyncio.run(readiness_chat.work_on_item(orch, {"id": "owner"}, "business", "Draft it", item))
    changes = svc.update_subject.call_args.args[5]
    assert changes == {"agent_drafts": {"purpose": {"value": "Food stock", "source": "Suggested by the agent; awaiting your review"}}}


def test_stale_selected_action_refreshes_without_running_the_agent(selected):
    orch, svc, model, item = selected
    svc.get_subject.return_value["actions"] = []
    result = asyncio.run(readiness_chat.work_on_item(orch, {"id": "owner"}, "business", "Draft it", item))
    assert "changed" in result["message"]
    model.generate_text.assert_not_called()
