"""QA R7-5: the proposal generator streams sections as they are written, stops on a time-out with a retry and no
charge, charges once only when the whole document was written, and never writes a proposal on a guessed pricing
model ("Subscription") or industry ("other"): it asks."""
import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.blueprint import router as bp
from app.modules.blueprint import service as svc
from app.shared.auth.deps import get_current_user

BODY = {"type": "client_proposal", "company_name": "Sparkle Cleaning", "client_name": "Brightway Ltd", "pricing_model": "One-time",
        "industry": "Cleaning services", "sections": ["executive_summary", "scope", "pricing"]}


@pytest.fixture
def client(monkeypatch):
    ledger = {"committed": [], "released": []}

    @asynccontextmanager
    async def guard(user_id, feature, generation_id=None):
        try:
            yield "g1"
        except BaseException:
            ledger["released"].append(feature)
            raise
        ledger["committed"].append(feature)

    async def entitled(user_id, feature):
        return {"allowed": True, "entitled": True, "available_credits": 50, "required_credits": 25}
    monkeypatch.setattr(bp, "credit_guard", guard)
    import app.modules.credits.service as credits
    monkeypatch.setattr(credits, "check_credits", entitled)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "owner@a.test"}
    with TestClient(app) as c:
        yield c, ledger
    app.dependency_overrides.pop(get_current_user, None)


def events_of(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_sections_arrive_one_by_one_then_the_document_and_it_is_charged_once(client, monkeypatch):
    c, ledger = client

    async def writes(payload, user_id):
        stream = svc.SECTION_STREAM.get()
        for heading in ("## Executive Summary", "## Scope", "## Pricing"):
            await stream(heading, f"{heading[3:]} text")
        return SimpleNamespace(model_dump=lambda mode=None: {"document_markdown": "whole", "document_id": "d1"})
    monkeypatch.setattr(bp, "generate_blueprint", writes)
    r = c.post("/blueprint/generate/stream", json=BODY)
    assert r.headers["content-type"].startswith("text/event-stream")
    ev = events_of(r)
    assert [e["type"] for e in ev] == ["section", "section", "section", "done"]
    assert [e["heading"] for e in ev[:3]] == ["Executive Summary", "Scope", "Pricing"]
    assert ev[-1]["result"]["document_id"] == "d1"
    assert ledger == {"committed": ["proposal_full"], "released": []}


def test_a_time_out_stops_with_a_retry_and_charges_nothing(client, monkeypatch):
    c, ledger = client
    monkeypatch.setattr(bp, "STREAM_TIMEOUT_SECONDS", 0.2)

    async def slow(payload, user_id):
        await svc.SECTION_STREAM.get()("## Executive Summary", "first")
        await asyncio.sleep(5)
    monkeypatch.setattr(bp, "generate_blueprint", slow)
    ev = events_of(c.post("/blueprint/generate/stream", json=BODY))
    assert [e["type"] for e in ev] == ["section", "error"]
    assert ev[-1]["retry"] is True and "Nothing was charged" in ev[-1]["message"]
    assert ledger == {"committed": [], "released": ["proposal_full"]}


def test_a_failed_section_fails_the_document_and_charges_nothing(client, monkeypatch):
    c, ledger = client

    async def breaks(payload, user_id):
        raise RuntimeError("model down")
    monkeypatch.setattr(bp, "generate_blueprint", breaks)
    ev = events_of(c.post("/blueprint/generate/stream", json=BODY))
    assert ev[-1]["type"] == "error" and ev[-1]["retry"] is True and ledger["committed"] == []


@pytest.mark.parametrize("pricing, industry, missing", [("", "Cleaning services", ["pricing_model"]), ("One-time", "other", ["industry"]),
                                                         ("", "Other", ["pricing_model", "industry"])])
def test_no_guessed_pricing_model_or_industry_it_asks(client, monkeypatch, pricing, industry, missing):
    c, ledger = client
    called = []
    monkeypatch.setattr(bp, "generate_blueprint", lambda *a, **k: called.append(1))
    for path in ("/blueprint/generate", "/blueprint/generate/stream"):
        r = c.post(path, json={**BODY, "pricing_model": pricing, "industry": industry})
        assert r.status_code == 422
        d = r.json()["detail"]
        assert d["error"] == "MISSING_INPUTS" and [m["key"] for m in d["missing"]] == missing and "Nothing was generated or charged" in d["message"]
    assert called == [] and ledger == {"committed": [], "released": []}


def test_in_streaming_mode_each_section_is_written_on_its_own_and_sent_when_ready():
    class LLM:
        async def generate_text(self, *, system, prompt, feature, max_tokens=None):
            await asyncio.sleep(0.05 if "Scope" in prompt else 0)
            return SimpleNamespace(text="Body " + ("x " * 200), provider="p", model="m", total_tokens=1, input_tokens=1, output_tokens=1)
    sent = []

    async def go():
        async def on(heading, text):
            sent.append(heading)
        token = svc.SECTION_STREAM.set(on)
        try:
            return await svc._ensure_section_bodies(LLM(), doc_type="Client Proposal", wanted_headings=["## Scope", "## Pricing"],
                                                    raw_inputs={"company_name": "Sparkle"}, doc="", warnings=[], target_words=200)
        finally:
            svc.SECTION_STREAM.reset(token)
    doc = asyncio.run(go())
    assert sent == ["## Pricing", "## Scope"]            # the quicker one first: as each is ready
    assert "## Scope" in doc and "## Pricing" in doc
