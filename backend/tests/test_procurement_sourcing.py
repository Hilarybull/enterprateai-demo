from app.modules.proposals.sourcing import MatchInput, rank_suppliers


def test_supplier_matches_require_listed_service_and_location():
    matching = {"slug": "studio", "name": "Studio", "location": "Leeds, UK",
                "service_tags": ["Brand design"], "trust": {"state": "verified"}}
    other = {**matching, "slug": "other", "location": "York, UK"}
    unrelated = {**matching, "slug": "unrelated", "service_tags": ["Copywriting"]}
    result = rank_suppliers([other, unrelated, matching], MatchInput(service="brand design", location="Leeds"))
    assert [item["slug"] for item in result] == ["studio"]
    assert result[0]["service_evidence"] == ["Brand design"]
    assert result[0]["owner_verified"]
    assert not result[0]["qualifications_verified"]


def test_supplier_matching_never_counts_ownership_as_a_credential():
    supplier = {"slug": "studio", "name": "Studio", "service_tags": ["Brand design"], "trust": {"state": "verified"}}
    assert not rank_suppliers([supplier], MatchInput(service="brand design", required_evidence=["ISO 9001"]))
    assert not rank_suppliers([supplier], MatchInput(service="brand design", excluded_slugs=["studio"]))


def test_saved_sourcing_draft_reopens_with_same_id_and_records_revisions(monkeypatch):
    import asyncio
    import copy
    from fastapi import HTTPException
    import pytest
    from app.modules.proposals import sourcing

    row = {"id": "buyer", "user_id": "owner", "data": {}}

    async def load(user, workspace):
        if (user, workspace) != ("owner", "buyer"):
            raise HTTPException(404)
        return copy.deepcopy(row)

    async def write(_, data):
        row["data"] = data
        return True

    monkeypatch.setattr(sourcing, "_owned_workspace", load)
    monkeypatch.setattr(sourcing, "_write", write)

    async def scenario():
        fields = sourcing.SaveDraft(kind="RFQ", title="Design work")
        first = await sourcing.save_draft("owner", "buyer", "same", fields)
        assert first["status"] == "DRAFT"
        assert await sourcing.save_draft("owner", "buyer", "same", fields) == first
        second = await sourcing.save_draft("owner", "buyer", "same", fields.model_copy(update={"kind": "RFP"}))
        assert second["id"] == first["id"]
        assert len(row["data"]["proposal_requests"]) == 1
        assert "financials" not in row["data"]
        assert (await sourcing.load_draft("owner", "buyer", "same"))["record"] == second
        assert [e["event_type"] for e in row["data"]["sourcing_history"]["same"]] == ["saved", "revised"]
        with pytest.raises(HTTPException) as error:
            await sourcing.load_draft("other", "buyer", "same")
        assert error.value.status_code == 404

    asyncio.run(scenario())


def test_rfqs_send_only_after_approval_and_keep_the_draft_id(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.modules.marketplace import directory_router, service as marketplace
    from app.modules.proposals import sourcing

    row = {"id": "buyer", "user_id": "owner", "data": {}}

    async def write(_, data):
        row["data"] = data
        return True

    monkeypatch.setattr(sourcing, "_owned_workspace", AsyncMock(return_value=row))
    monkeypatch.setattr(sourcing, "_write", write)
    monkeypatch.setattr(directory_router, "get_service", lambda: SimpleNamespace(search=AsyncMock(return_value={
        "items": [{"slug": "studio", "name": "Studio", "listing_id": "vendor", "opportunities": {"rfqs": True}}],
    })))
    deliver = AsyncMock()
    monkeypatch.setattr(marketplace, "submit_rfq", deliver)

    async def scenario():
        await sourcing.save_draft("owner", "buyer", "rfq-id", sourcing.SaveDraft(kind="RFQ", title="Design"))
        deliver.assert_not_awaited()
        user = {"id": "owner", "email": "buyer@example.test"}
        body = sourcing.SendDraft(supplier_slug="studio")
        result = await sourcing.send_rfq_draft(user, "buyer", "rfq-id", body)
        assert result["status"] == "SENT"
        assert (await sourcing.send_rfq_draft(user, "buyer", "rfq-id", body)) == result
        deliver.assert_awaited_once()
        assert deliver.call_args.kwargs["sourced_request_id"] == "rfq-id"
        assert row["data"]["financials"]["sent_rfqs"][0]["id"] == "rfq-id"
        assert row["data"]["sourcing_history"]["rfq-id"][-1]["event_type"] == "rfq_send_approved"

    asyncio.run(scenario())

def test_supplier_matches_directory_category_with_location():
    supplier = {"slug": "it-leeds", "name": "Digital Studio", "location": "Leeds, UK",
                "category": "Technology", "service_tags": ["Automation"]}
    result = rank_suppliers([supplier], MatchInput(service="technology", location="leeds"))
    assert result[0]["service_evidence"] == ["Directory category: Technology"]
    assert not rank_suppliers([supplier], MatchInput(service="technology", location="London"))


def test_model_draft_accepts_fenced_json_with_optional_fields_missing(monkeypatch):
    import asyncio
    import json
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.modules.proposals import sourcing
    from app.shared.llm import openai_client

    answer = {"title": "Local catering", "description": "Provide local dishes for 10–50 guests.",
              "recommendation": "RFP", "rationale": "Requested by buyer"}
    fence = chr(96) * 3
    generate = AsyncMock(return_value=SimpleNamespace(text=fence + "json\n" + json.dumps(answer) + "\n" + fence))
    monkeypatch.setattr(openai_client, "pick_llm_for_user", AsyncMock(return_value=SimpleNamespace(generate_text=generate)))
    result = asyncio.run(sourcing.draft("buyer", sourcing.SourcingBrief(brief="Draft an RFP for catering")))
    assert result.recommendation == "RFP"
    assert result.description == answer["description"]
    assert result.location == ""


def test_sourcing_draft_save_is_registered_and_reopens_through_http(monkeypatch):
    from copy import deepcopy
    from uuid import uuid4

    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    from app.modules.proposals import sourcing
    from app.modules.proposals.router import router
    from app.shared.auth.deps import get_current_user

    row = {"id": "buyer", "data": {}}

    async def load(user_id, workspace_id):
        if (user_id, workspace_id) != ("owner", "buyer"):
            raise HTTPException(404)
        return deepcopy(row)

    async def write(_, data):
        row["data"] = data
        return True

    monkeypatch.setattr(sourcing, "_owned_workspace", load)
    monkeypatch.setattr(sourcing, "_write", write)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "owner"}
    client = TestClient(app)
    for kind in ("RFP", "RFQ"):
        request_id = str(uuid4())
        url = f"/proposals/sourcing/drafts/{request_id}?workspace_id=buyer"
        payload = {"kind": kind, "title": "Blocked Drain Clearance", "description": "Clear the blocked drain."}
        response = client.put(url, json=payload)
        assert response.status_code == 200, response.text
        record = response.json()
        assert (record["id"], record["sourcing_kind"], record["status"]) == (request_id, kind, "DRAFT")
        assert client.put(url, json=payload).json() == record
        assert client.get(url).json()["record"] == record
    assert len(row["data"]["proposal_requests"]) == 2
    assert client.put(url.replace("buyer", "other"), json=payload).status_code == 404

def test_full_sourcing_form_options_survive_legacy_resave(monkeypatch):
    import asyncio
    import copy
    from app.modules.proposals import sourcing

    row = {"id": "buyer", "data": {}}

    async def load(*_):
        return copy.deepcopy(row)

    async def write(_, data):
        row["data"] = data
        return True

    monkeypatch.setattr(sourcing, "_owned_workspace", load)
    monkeypatch.setattr(sourcing, "_write", write)

    async def scenario():
        fields = sourcing.SaveDraft(kind="RFP", title="Tent rental", budget_range="100–200",
            budget_currency="GBP", budget_visible=True, deadline="2026-12-01", submission_cap=5,
            accepted_modes=["invite_only"], accepted_categories=["Equipment"],
            specific_criteria={"country": "United Kingdom"}, visibility="marketplace",
            invited_workspace_ids=["vendor"], invite_emails=["supplier@example.test"],
            requirements=[{"text": "Insurance", "mandatory": True, "weight": 4, "format": "document"}])
        record = await sourcing.save_draft("owner", "buyer", "request", fields)
        assert record["visibility"] == "private"
        assert record["status"] == "DRAFT"
        assert record["requirements"][0]["format"] == "document"
        assert record["requirements"][0]["weight"] == 4
        assert (await sourcing.load_draft("owner", "buyer", "request"))["record"] == record
        revised = await sourcing.save_draft("owner", "buyer", "request",
            sourcing.SaveDraft(kind="RFP", title="Updated title",
                requirements=record["requirements"]))
        for key in ("budget_range", "budget_currency", "deadline", "submission_cap",
                    "accepted_modes", "accepted_categories", "specific_criteria", "invited_workspace_ids", "invite_emails"):
            assert revised[key] == record[key]
        assert len(row["data"]["proposal_requests"]) == 1

    asyncio.run(scenario())
