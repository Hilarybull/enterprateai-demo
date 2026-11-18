import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.proposals import evaluation, sourcing
from app.shared.llm import openai_client


def make_state():
    return {
        "proposal_requests": [{"id": "request", "workspace_id": "buyer", "requirements": [
            {"text": "Training", "weight": 3}, {"text": "Support", "weight": 1}]}],
        "proposal_inbox": [
            {"id": "a", "request_id": "request", "recipient_workspace_id": "buyer", "summary": "Two training sessions"},
            {"id": "b", "request_id": "request", "recipient_workspace_id": "buyer", "summary": "Support included"},
            {"id": "c", "request_id": "request", "recipient_workspace_id": "other", "summary": "Private"},
        ],
    }


def test_references_resolve_only_to_linked_proposal_and_missing_stays_unknown():
    data = make_state()
    criteria, proposals, _ = evaluation.context(data, "buyer", "request")
    assert [p["id"] for p in proposals] == ["a", "b"]
    result = evaluation.Assessment.model_validate({"findings": [
        {"criterion": 0, "state": "supported", "score": 80, "explanation": "Training included",
         "evidence": [{"source": "summary", "quote": "Two training sessions"}]},
        {"criterion": 1, "state": "supported", "score": 99, "explanation": "Support",
         "evidence": [{"source": "summary", "quote": "Support included"}]},
    ], "terms": {"price": [{"source": "attachments.1", "quote": "0 GBP"}]}})
    verified = evaluation.validate_assessment(result, proposals[0], criteria)
    assert verified["findings"][0]["evidence"][0]["proposal_id"] == "a"
    assert verified["findings"][0]["score"] == 80
    assert verified["findings"][1]["state"] == "unsupported"
    assert verified["findings"][1]["score"] is None
    assert verified["terms"]["price"] == []
    assert evaluation.validate_assessment(evaluation.Assessment(findings=[]), proposals[0], criteria)["findings"][0]["state"] == "missing"


def test_non_comparable_currency_and_unknown_vat_are_flagged():
    proposals = [{"suggestion": {"terms": {"currency": [{"quote": currency}]}}} for currency in ("GBP", "EUR")]
    flags = evaluation.commercial_alignment(proposals)
    assert "differ" in flags["currency"]
    assert "Unknown" in flags["vat"]
    assert evaluation.weighted_score([{"weight": 3}, {"weight": 1}], {"0": {"score": 80}, "1": {"score": 0}}) == 60


def test_review_override_and_stale_inputs_and_failed_model(monkeypatch):
    row = {"data": make_state()}
    async def owned(user_id, workspace_id):
        if (user_id, workspace_id) != ("owner", "buyer"):
            raise HTTPException(404)
        return deepcopy(row)
    async def write(_, data):
        row["data"] = data
        return True
    monkeypatch.setattr(sourcing, "_owned_workspace", owned)
    monkeypatch.setattr(sourcing, "_write", write)
    model = AsyncMock(return_value=SimpleNamespace(text='{"findings":[{"criterion":0,"state":"supported","score":80,'
        '"explanation":"Training","evidence":[{"source":"summary","quote":"Two training sessions"}]}]}'))
    monkeypatch.setattr(openai_client, "pick_llm_for_user", AsyncMock(return_value=SimpleNamespace(generate_text=model)))

    async def scenario():
        with pytest.raises(HTTPException) as denied:
            await evaluation.generate("other", "buyer", "request", "a")
        assert denied.value.status_code == 404
        model.assert_not_called()
        generated = await evaluation.generate("owner", "buyer", "request", "a")
        assert not generated["proposals"][0]["confirmed"]
        review = evaluation.Review(proposal_id="a", criterion=0, snapshot=generated["snapshot"],
                                   suggestion_id=generated["suggestion_id"], score=70, reason="Only two sessions")
        saved = await evaluation.confirm("owner", "buyer", "request", review)
        event = saved["proposals"][0]["confirmed"]["0"]
        assert event["score"] == 70 and event["event_type"] == "overrode_suggestion"
        assert event["actor"] == "owner" and event["reason"] == "Only two sessions"
        row["data"]["proposal_requests"][0]["requirements"][0]["weight"] = 4
        with pytest.raises(HTTPException) as stale:
            await evaluation.confirm("owner", "buyer", "request", review)
        assert stale.value.status_code == 409
        model.side_effect = RuntimeError("unavailable")
        with pytest.raises(HTTPException) as failure:
            await evaluation.generate("owner", "buyer", "request", "a")
        assert failure.value.status_code == 503
        view = await evaluation.read("owner", "buyer", "request")
        manual = review.model_copy(update={"snapshot": view["snapshot"], "suggestion_id": None})
        saved = await evaluation.confirm("owner", "buyer", "request", manual)
        assert saved["proposals"][0]["confirmed"]["0"]["event_type"] == "manual_score"
        assert row["data"]["proposal_inbox"] == make_state()["proposal_inbox"]

    asyncio.run(scenario())


def test_inline_attachment_source_and_buyer_requirement_are_distinct():
    proposal = {"id": "a", "attachments": [{"data_url": "data:text/plain;base64,SGVscGRlc2sgMjQvNw=="}],
                "requirement_responses": [{"text": "Buyer requires 24/7 helpdesk", "response": "Weekdays"}]}
    sources = evaluation.source_fields(proposal)
    assert sources["attachments.1.line.1"] == "Helpdesk 24/7"
    assert "requirement_responses.1.text" not in sources
    assert sources["requirement_responses.1.response"] == "Weekdays"


def test_normalised_price_requires_explicit_same_basis_and_preserves_zero():
    vendor = lambda id_, price: {"id": id_, "suggestion": {"terms": {
        "currency": [{"quote": "GBP"}], "price": [{"quote": price}],
    }}}
    proposals = [vendor("a", "GBP 0"), vendor("b", "GBP 12.5")]
    assert evaluation.comparable_prices(proposals, {"vat": "Unknown"}) == {}
    prices = evaluation.comparable_prices(proposals, {})
    assert prices["a"]["formatted"] == "GBP 0.00"
    assert prices["b"]["formatted"] == "GBP 12.50"
    assert evaluation.comparable_prices([proposals[0], vendor("b", "up to GBP 12")], {}) == {}
