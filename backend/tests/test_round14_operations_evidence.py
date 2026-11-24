"""A launch plan's demand evidence, test run and permit fetched from Business Operations and the profile (the owner,
29 Oct: "it can fetch these from the business operations"). Only real records; nothing made up."""
import asyncio
from datetime import date

from app.modules.agent import operations_evidence as ops

PLAN = {"name": "Soap Making", "operations": {"process_version": "1"},
        "prerequisites": [{"id": "p1", "name": "To operate a business in Nigeria", "applicable": "yes", "critical": True, "status": "not_completed"}]}
DATA = {"workspace_profile": {"registration_number": "RC1234567", "registration_date": "2024-03-01"},
        "financials": {"invoices": [
            {"id": "i1", "invoice_number": "INV-1", "status": "paid", "total_amount": 6000, "paid_at": "2026-10-20", "customer_name": "Ada",
             "items": [{"name": "Liquid soap, 5 litres"}]},
            {"id": "i2", "invoice_number": "INV-2", "status": "paid", "total_amount": 9000, "paid_at": "2026-10-21", "items": [{"name": "Full car wash"}]}],
            "quotes": [{"id": "q1", "quote_number": "Q-7", "status": "sent", "sent_at": "2026-10-25", "items": [{"description": "Bar soaps, 50 pieces"}]}]}}


class Svc:
    def __init__(self):
        self.added = []

    async def list_evidence(self, *_a, **_k):
        return [{"source": {"reference": "Quotation Q-7"}}]      # already attached once

    async def add_evidence(self, _uid, _bid, payload, _email, feature=None):
        self.added.append(payload)
        return {"id": f"e{len(self.added)}"}


def test_only_this_offerings_records_are_found():
    got = ops.records_for(DATA, PLAN, date(2026, 10, 29))
    assert [i["invoice_number"] for i, _d in got["sales"]] == ["INV-1"]      # the car wash is another offering's sale
    assert [q["quote_number"] for q, _d in got["quotes"]] == ["Q-7"]
    assert got["registration"]["number"] == "RC1234567"


def test_evidence_attached_and_the_test_run_and_permit_drafted():
    svc = Svc()
    out = asyncio.run(ops.gather(svc, {"id": "u1"}, "b1", "plan1", PLAN, DATA, date(2026, 10, 29)))
    refs = [p["source"]["reference"] for p in svc.added]
    assert refs == ["Invoice INV-1", "Registration RC1234567"]      # the quotation was already on the plan: never twice
    assert svc.added[0]["links"] == [{"subject_id": "plan1", "check": "C1.A"}] and svc.added[0]["effective_date"] == "2026-10-20"
    run = out["drafts"]["operations.dry_run"]["value"]
    assert run == {"date": "2026-10-20", "outcome": "passed", "process_version": "1", "notes": "Invoice INV-1: ordered, delivered and paid on 2026-10-20."}
    pre = out["drafts"]["prerequisites"]["value"][0]
    assert pre["status"] == "completed" and pre["evidence_id"] == "e2"
    assert "From your records I added" in ops.said(out)


def test_nothing_on_record_is_said_never_made_up():
    svc = Svc()
    out = asyncio.run(ops.gather(svc, {"id": "u1"}, "b1", "plan1", PLAN, {"financials": {}}, date(2026, 10, 29)))
    assert svc.added == [] and out["drafts"] == {}
    line = ops.said(out)
    assert "send a quotation or invoice for it from Business Operations" in line and "add your registration number" in line
