import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app.modules.tenders import evaluation
from app.modules.proposals import sourcing

NOTICE = {"id":"tender-1","title":"IT support","description":"Provide managed IT support", "eligibility":"Insurance evidence required"}
PROFILE = {"workspace_profile":{"company_name":"Example IT","services":[{"service_name":"Managed IT support"}],"email":"private@example.test","logo_data_url":"secret"},"financials":{"customers":[{"email":"customer-private@example.test"}]}}
RAW = {"findings":[{"requirement":"Managed IT support","alignment":"aligned","explanation":"The saved service matches the stated scope.",
    "tender_evidence":[{"source":"description","quote":"managed IT support"}],
    "business_evidence":[{"source":"workspace_profile.services.1.service_name","quote":"Managed IT support"}],
    "next_step":"Prepare a delivery approach and check your available capacity."}]}


def test_evidence_is_resolved_to_notice_and_workspace_and_missing_is_unknown():
    raw=deepcopy(RAW)
    tender=evaluation.tender_sources(NOTICE)
    business=evaluation.business_sources(PROFILE)
    item=evaluation.validated_findings(evaluation.Assessment.model_validate(raw),tender,business,"tender-1","A")[0]
    assert item["alignment"] == "aligned"
    assert item["tender_evidence"][0]["notice_id"] == "tender-1"
    assert item["business_evidence"][0]["workspace_id"] == "A"
    raw["findings"][0]["business_evidence"]=[]
    assert evaluation.validated_findings(evaluation.Assessment.model_validate(raw),tender,business,"tender-1","A")[0]["alignment"] == "unknown"
    raw["findings"][0]["tender_evidence"][0]["source"]="fabricated"
    assert evaluation.validated_findings(evaluation.Assessment.model_validate(raw),tender,business,"tender-1","A")[0]["alignment"] == "unsupported"
    assert "private@example.test" not in json.dumps(business)
    assert "customer-private" not in json.dumps(business)
    assert evaluation.business_sources({"financials":{"products":[{"name":"Network support","customer_email":"private"}]}})["financials.products.1.name"] == "Network support"


def setup(monkeypatch, response=RAW):
    from contextlib import asynccontextmanager
    credit_calls = []
    @asynccontextmanager
    async def credits(user, feature, **kwargs):
        assert feature == "tender_evaluation"
        credit_calls.append(feature)
        yield {}
    monkeypatch.setattr("app.modules.credits.service.credit_guard", credits)
    row={"id":"A","user_id":"owner","data":deepcopy(PROFILE)}
    async def owned(user,workspace):
        if (user,workspace)!=("owner","A"):raise HTTPException(404)
        return deepcopy(row)
    async def write(_,data):row["data"]=data;return True
    llm=SimpleNamespace(generate_text=AsyncMock(return_value=SimpleNamespace(text=json.dumps(response),model="fixture")))
    llm.credit_calls = credit_calls
    monkeypatch.setattr(sourcing,"_owned_workspace",owned)
    monkeypatch.setattr(sourcing,"_write",write)
    monkeypatch.setattr(evaluation.service,"get_listing",AsyncMock(return_value=NOTICE))
    monkeypatch.setattr("app.shared.llm.openai_client.pick_llm_for_user",AsyncMock(return_value=llm))
    return row,llm


def test_evaluation_has_steps_is_private_audited_and_retry_cached(monkeypatch):
    row,llm=setup(monkeypatch)
    async def scenario():
        first=await evaluation.evaluate("owner","A","tender-1")
        assert first["findings"][0]["next_step"].startswith("Prepare")
        assert first["business_name"] == "Example IT"
        assert await evaluation.evaluate("owner","A","tender-1") == first
        llm.generate_text.assert_awaited_once()
        assert llm.credit_calls == ["tender_evaluation"]
        assert row["data"]["sourcing_history"]["tender:tender-1"][0]["event_type"] == "tender_evaluated"
        with pytest.raises(HTTPException) as error:await evaluation.evaluate("other","A","tender-1")
        assert error.value.status_code == 404
        assert "proposal_requests" not in row["data"]
    asyncio.run(scenario())


def test_invalid_ai_output_preserves_business_and_manual_notice(monkeypatch):
    row,llm=setup(monkeypatch,{"findings":[]})
    async def scenario():
        with pytest.raises(HTTPException) as error:await evaluation.evaluate("owner","A","tender-1")
        assert error.value.status_code == 503
        assert row["data"] == PROFILE
    asyncio.run(scenario())


def test_changed_business_prevents_stale_assessment_save(monkeypatch):
    row,llm=setup(monkeypatch)
    async def generate(**kwargs):
        row["data"]["workspace_profile"]["company_name"]="Changed"
        return SimpleNamespace(text=json.dumps(RAW),model="fixture")
    llm.generate_text.side_effect=generate
    async def scenario():
        with pytest.raises(HTTPException) as error:await evaluation.evaluate("owner","A","tender-1")
        assert error.value.status_code == 409
        assert "tender_evaluations" not in row["data"]
    asyncio.run(scenario())


def test_procurement_routes_tender_evaluation_to_shared_service(monkeypatch):
    from app.modules.agent import procurement,conductor
    from app.modules.agent.router import AgentRequestIn
    monkeypatch.setattr(sourcing,"_owned_workspace",AsyncMock(return_value={}))
    monkeypatch.setattr(conductor,"_keep",AsyncMock())
    analyse=AsyncMock(return_value={"verdict":"More information needed","findings":[{"next_step":"Upload insurance evidence to your business records."}]})
    monkeypatch.setattr(evaluation,"evaluate",analyse)
    body=AgentRequestIn(business_id="A",text="Evaluate this tender for me",page="procurement",params={"action":"tender_evaluation","tender_id":"tender-1"})
    result=asyncio.run(procurement.run(None,{"id":"owner"},body,{}))
    analyse.assert_awaited_once_with("owner","A","tender-1")
    assert result["procurement"]["status"] == "tender_evaluation"
    assert "What to do next" in result["message"]


def test_tender_explanation_works_without_business_profile_and_filters_false_citations(monkeypatch):
    raw = deepcopy(RAW)
    raw["findings"][0]["business_evidence"] = []
    raw["overview"] = [
        {"heading": "What the buyer needs", "explanation": "A managed IT support service.", "evidence": [{"source": "description", "quote": "managed IT support"}]},
        {"heading": "Invented", "explanation": "Unfounded claim", "evidence": [{"source": "description", "quote": "not in notice"}]},
    ]
    row, llm = setup(monkeypatch, raw)
    row["data"] = {}
    result = asyncio.run(evaluation.evaluate("owner", "A", "tender-1"))
    assert result["findings"][0]["alignment"] == "unknown"
    assert len(result["overview"]) == 1
    assert result["overview"][0]["evidence"][0]["notice_id"] == "tender-1"
    assert "imported" not in " ".join(result["limitations"])


def test_summary_only_response_is_valid_and_saved_review_reopens_without_generation(monkeypatch):
    raw = {"overview": [{"heading": "What the buyer needs", "explanation": "Managed IT support.", "evidence": [{"source": "description", "quote": "managed IT support"}]}]}
    row, llm = setup(monkeypatch, raw)
    async def scenario():
        result = await evaluation.evaluate("owner", "A", "tender-1")
        assert result["overview"] and result["findings"] == []
        saved = await evaluation.saved_evaluation("owner", "A", "tender-1")
        assert saved == {"evaluation": result, "stale": False}
        llm.generate_text.assert_awaited_once()
        row["data"]["workspace_profile"]["company_name"] = "Updated"
        assert (await evaluation.saved_evaluation("owner", "A", "tender-1"))["stale"]
        with pytest.raises(HTTPException) as denied:
            await evaluation.saved_evaluation("outsider", "A", "tender-1")
        assert denied.value.status_code == 404
    asyncio.run(scenario())
