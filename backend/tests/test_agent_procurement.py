import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.modules.agent import chat_agent, conductor, procurement
from app.modules.proposals import sourcing


def body(text, reference=None, action="draft", page="procurement"):
    return SimpleNamespace(text=text, page=page, capability=None, source_reference=reference, business_id="buyer",
                           params={"action": action} if page else {})


def test_procurement_tool_keeps_follow_up_and_request_id(monkeypatch):
    reference = str(uuid4())
    known = {"agent_thread": {"owner": {"turns": []}}}
    user = {"id": "owner"}

    async def keep(_, workspace, actor, turns):
        assert (workspace, actor) == ("buyer", "owner")
        known["agent_thread"][actor]["turns"] = turns

    async def generate(actor, workspace, request, brief):
        assert (actor, workspace, request) == ("owner", "buyer", reference)
        assert brief.brief == "Catering services\nfood\nWe need packaged lunch suppliers for 40 staff in Leeds"
        assert brief.previous_question == second_question
        return sourcing.SourcingDraft(title="Staff lunches", category="Catering", outcome="Staff lunches", location="Leeds",
                                      timeline="", constraints=[], questions=[], recommendation="RFQ", rationale="Fixed scope",
                                      description="Supply packaged lunches for 40 staff.")

    monkeypatch.setattr(conductor, "_keep", keep)
    monkeypatch.setattr(sourcing, "_owned_workspace", AsyncMock(return_value={}))
    first_question = "What kind of catering do you need, and for how many people?"
    second_question = "Is this for staff lunches, an event buffet, or another type of meal?"
    model = AsyncMock(side_effect=[
        SimpleNamespace(questions=[first_question]),
        SimpleNamespace(questions=[second_question]),
    ])
    monkeypatch.setattr(sourcing, "generate_for_request", model)

    async def scenario():
        first = await procurement.run(None, user, body("Catering services", reference), known)
        assert first["procurement"]["status"] == "clarification"
        assert first["message"] == first_question
        second = await procurement.run(None, user, body("food", reference), known)
        assert second["message"] == second_question
        updated_brief = model.await_args.args[-1]
        assert updated_brief.brief == "Catering services\nfood"
        assert updated_brief.previous_question == first_question
        model.side_effect = generate
        followup = body("We need packaged lunch suppliers for 40 staff in Leeds", reference)
        second = await chat_agent._use(None, user, "buyer", known, followup, "work_on_procurement", {})
        assert second["thread_kept"]
        assert second["final"]["procurement"]["request_id"] == reference
        assert second["final"]["procurement"]["draft"]["recommendation"] == "RFQ"
        assert second["final"]["actions"][0]["to"].endswith(reference)
        assert any(tool["name"] == "work_on_procurement" for tool in chat_agent.TOOLS)

    asyncio.run(scenario())


def test_procurement_intent_permissions_and_approval_boundary(monkeypatch):
    assert procurement.should_route(body("Find suppliers for catering", page=None), [])
    assert not procurement.should_route(body("Show the dashboard", page=None), [])
    workspace = AsyncMock(side_effect=HTTPException(404))
    match = AsyncMock()
    monkeypatch.setattr(sourcing, "_owned_workspace", workspace)
    monkeypatch.setattr(sourcing, "match_suppliers", match)

    async def scenario():
        with pytest.raises(HTTPException):
            await procurement.run(None, {"id": "other"}, body("Find suppliers for catering"), {})
        match.assert_not_called()
        workspace.side_effect = None
        monkeypatch.setattr(conductor, "_keep", AsyncMock())
        reply = await procurement.run(None, {"id": "owner"}, body("Send the RFQ", page=None), {})
        assert reply["procurement"]["status"] == "approval_required"
        match.assert_not_called()

    asyncio.run(scenario())


@pytest.mark.parametrize("intent,text", [("question", "breakfast meeting?"), ("aside", "How are you?")])
def test_questions_and_asides_preserve_pending_requirement(monkeypatch, intent, text):
    reference = str(uuid4())
    question = "What type of catering do you need?"
    known = {"agent_thread": {"owner": {"turns": [
        {"role": "agent", "procurement": {"id": reference, "action": "draft",
          "brief": "Catering services", "pending": True, "question": question, "reply": question}},
    ]}}}
    async def keep(_, workspace, actor, turns):
        known["agent_thread"][actor]["turns"] = turns
    monkeypatch.setattr(conductor, "_keep", keep)
    monkeypatch.setattr(sourcing, "_owned_workspace", AsyncMock(return_value={}))
    generate = AsyncMock(return_value=sourcing.SourcingDraft(turn_intent=intent,
        message="A breakfast meeting includes food served during a morning meeting. Is that what you need?"))
    monkeypatch.setattr(sourcing, "generate_for_request", generate)

    async def scenario():
        result = await procurement.run(None, {"id": "owner"}, body(text, reference), known)
        assert result["procurement"]["status"] == "answer"
        assert "draft" not in result["procurement"]
        state = known["agent_thread"]["owner"]["turns"][-1]["procurement"]
        assert state["brief"] == "Catering services"
        assert state["question"] == question
        assert state["pending"]
        assert generate.await_args.args[-1].latest_message == text
        generate.return_value = sourcing.SourcingDraft(questions=["How many attendees?"])
        await procurement.run(None, {"id": "owner"}, body("Yes, breakfast for 20", reference), known)
        brief = generate.await_args.args[-1]
        assert brief.brief == "Catering services\nYes, breakfast for 20"
        assert "morning meeting" in brief.previous_response
    asyncio.run(scenario())
