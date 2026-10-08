"""The customer's side of a quotation: status, trusted acceptance, decline, questions."""
import asyncio
import copy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.agent import documents as docs
from app.modules.marketplace import service as mkt

WS = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def store(monkeypatch):
    db = {"ws": {"id": WS, "user_id": "owner@apex.test", "name": "Apex", "data": {
        "workspace_profile": {"company_name": "Alchemy Test", "email": "hello@alchemy.test", "phone_number": "020 7946 0000"},
        "financials": {"quotes": [{"id": "q1", "reference": "QUO-3031026", "status": "sent", "customer_name": "QA Test Ltd",
                                   "customer_email": "qa@buyer.test", "valid_until": "2099-11-02", "version": 2, "vat_rate": 20,
                                   "line_items": [{"description": "Consulting", "qty": "2", "unit_price": "120"}]}]}}},
          "emails": []}

    async def doc_by_token(*, token, viewer_email=None):
        if token != "tok":
            return None
        return SimpleNamespace(type=f"quotation_acceptance::{WS}::::q1")

    async def select(table, filters=None, single=False, **_):
        return copy.deepcopy(db["ws"]) if table == "workspaces" else None

    async def update(table, filters=None, payload=None):
        db["ws"]["data"] = copy.deepcopy(payload["data"])
        return [db["ws"]]

    async def email(**kw):
        db["emails"].append(kw)
        return SimpleNamespace(sent=True)

    import app.modules.blueprint.share_repository as share_repo
    monkeypatch.setattr(share_repo, "get_shared_document_by_token", doc_by_token)
    monkeypatch.setattr(mkt, "sb_select", select)
    monkeypatch.setattr(mkt, "sb_update", update)
    monkeypatch.setattr(mkt, "send_email_via_resend", email)
    return db


def quote(db):
    return db["ws"]["data"]["financials"]["quotes"][0]


def test_status_shows_seller_summary_and_days_left(store):
    s = asyncio.run(mkt.quote_status_for_customer(token="tok"))
    assert s["state"] == "open" and s["total"] == 288.0 and s["currency"] == "GBP" and s["version"] == 2
    assert s["seller"]["name"] == "Alchemy Test" and s["seller"]["email"] == "hello@alchemy.test"
    assert s["days_left"] > 0 and "email" not in s["customer"]


def test_accept_needs_a_name_and_the_terms_box(store):
    with pytest.raises(HTTPException) as e:
        asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="", accepted_terms=True))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="Sam Lee", accepted_terms=False))
    assert e.value.status_code == 400 and quote(store)["status"] == "sent"


def test_acceptance_is_recorded_and_idempotent(store):
    res = asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="Sam Lee",
                                           accepted_terms=True, client_ip="203.0.113.7", user_agent="Mozilla/5.0"))
    assert res["action"] == "accepted"
    acc = quote(store)["acceptance"]
    assert acc["name"] == "Sam Lee" and acc["ip"] == "203.0.113.7" and acc["user_agent"] == "Mozilla/5.0"
    assert acc["version"] == 2 and acc["total"] == 288.0 and acc["accepted_at"]
    first = copy.deepcopy(acc)
    again = asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="accept", signer_name="Someone Else", accepted_terms=True))
    assert again["already"] and quote(store)["acceptance"] == first           # nothing changed the second time
    assert asyncio.run(mkt.quote_status_for_customer(token="tok"))["state"] == "accepted"
    with pytest.raises(HTTPException) as e:                                     # can't decline after accepting
        asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="reject"))
    assert e.value.status_code == 409
    assert any("accepted quotation" in m["subject"] for m in store["emails"])  # the business was told


def test_decline_keeps_the_reason(store):
    asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action="reject", reason="Over budget this quarter"))
    assert quote(store)["status"] == "rejected" and quote(store)["declined_reason"] == "Over budget this quarter"


@pytest.mark.parametrize("change,state", [({"valid_until": "2000-01-01"}, "expired"), ({"status": "cancelled"}, "cancelled"),
                                          ({"superseded_by": "q2"}, "superseded")])
def test_closed_quotes_take_no_responses(store, change, state):
    quote(store).update(change)
    assert asyncio.run(mkt.quote_status_for_customer(token="tok"))["state"] == state
    for action in ("accept", "reject"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(mkt.respond_to_quote(token="tok", viewer_email="", action=action, signer_name="Sam", accepted_terms=True))
        assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        asyncio.run(mkt.ask_about_quote(token="tok", viewer_email="", message="Is this still valid?"))


def test_questions_are_kept_and_returned_as_a_thread(store):
    res = asyncio.run(mkt.ask_about_quote(token="tok", viewer_email="", message="Can we start next month?"))
    assert res["questions"][-1]["message"] == "Can we start next month?" and quote(store)["status"] == "sent"
    assert store["emails"][-1]["reply_to_email"] == "qa@buyer.test"


def test_quotation_email_replies_reach_the_business_and_links_carry_no_email():
    p = {"reference": "QUO-1", "company": "Alchemy Test", "reply_to": "hello@alchemy.test", "customer_name": "QA Test Ltd",
         "contact_name": "Sam Lee", "currency": "GBP", "items": [{"description": "Consulting", "qty": 2.0, "unit_price": 120}],
         "subtotal": 240, "vat_rate": 20, "vat_amount": 48, "total": 288, "valid_until": "2026-11-02", "payment_terms": "Net 14 days",
         "company_details": {"email": "hello@alchemy.test", "phone": "020 7946 0000"}, "pdf_attached": True}
    mail = docs.quotation_email(p, "https://app.example/share/tok")
    assert "Hi Sam," in mail["text"] and "Hi Sam," in mail["html"]
    assert "Review and accept quote" in mail["html"] and "Valid until 2 November 2026" in mail["html"]
    assert "attached as a PDF" in mail["text"] and "hello@alchemy.test" in mail["html"]
    assert "2 x" not in mail["text"] and "x 2 @" in mail["text"]                 # integer quantities


def test_share_links_never_contain_an_email():
    from app.modules.blueprint.router import _shared_document_url
    url = _shared_document_url("tok")
    assert "email" not in url and "@" not in url


def test_quotation_pdf_is_a_real_pdf():
    from app.modules.agent.pdf import quotation_pdf
    data = quotation_pdf({"reference": "QUO-1", "company": "Alchemy Test", "customer_name": "QA Test Ltd", "currency": "GBP",
                          "items": [{"description": "Consulting", "qty": 2.0, "unit_price": 120, "details": "Two sessions"}],
                          "subtotal": 240, "vat_rate": 20, "vat_amount": 48, "total": 288, "valid_until": "2026-11-02",
                          "payment_terms": "Net 14 days", "notes": "Thanks", "company_details": {"email": "hello@alchemy.test"}})
    assert data[:5] == b"%PDF-" and len(data) > 1500
