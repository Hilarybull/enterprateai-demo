"""A receipt the owner emails themselves (Share Receipt) is issued from the receipt ledger and marked sent (the owner, 13 Nov)."""
import pytest

from app.modules.agent.orchestrator import AccessDenied, Conflict
from test_agent import OUTSIDER, OWNER, Env, run


def _invoice(env, payments):
    env.fin["invoices"].append({"id": "inv1", "reference": "INV-1", "customer_name": "BrightTech Ltd", "currency": "GBP", "total_amount": 300,
                                "status": "paid", "payments": payments})


def test_a_receipt_sent_by_hand_is_issued_and_marked_sent():
    env = Env()
    _invoice(env, [{"id": "p1", "amount": 100, "paid_at": "2026-11-01"}, {"id": "p2", "amount": 200, "paid_at": "2026-11-02"}])
    done = run(env.orch.record_manual_receipt("A", "inv1", OWNER, ["buyer@brighttech.test"], "msg-1", OWNER))
    assert [d["payment_id"] for d in done] == ["p1", "p2"]
    numbers = [d["receipt_number"] for d in done]
    assert len(set(numbers)) == 2 and all(n.startswith("REC-") for n in numbers)
    for p in env.fin["invoices"][0]["payments"]:
        r = p["receipt"]
        assert r["sent_to"] == "buyer@brighttech.test" and r["sent_at"] and r["message_id"] == "msg-1" and r["manual"] is True
    ledger = {r["number"]: r for r in env.store.receipts if r["business_id"] == "A"}
    assert set(ledger) == set(numbers) and all(ledger[n]["sent_to"] == "buyer@brighttech.test" for n in numbers)
    # Sent again: nothing changes, no new numbers.
    assert run(env.orch.record_manual_receipt("A", "inv1", OWNER, ["other@x.test"], None, OWNER)) == []
    assert [p["receipt"]["number"] for p in env.fin["invoices"][0]["payments"]] == numbers


def test_an_issued_receipt_keeps_its_number_and_an_already_sent_one_is_left_alone():
    env = Env()
    _invoice(env, [{"id": "p1", "amount": 100, "receipt": {"number": "REC-1010126", "created_at": "2026-11-01T10:00:00+00:00"}},
                   {"id": "p2", "amount": 200, "receipt": {"number": "REC-2010126", "sent_at": "2026-11-01T11:00:00+00:00", "sent_to": "a@b.test"}}])
    done = run(env.orch.record_manual_receipt("A", "inv1", OWNER, ["buyer@brighttech.test"], None, OWNER))
    assert done == [{"payment_id": "p1", "receipt_number": "REC-1010126"}]
    p1, p2 = env.fin["invoices"][0]["payments"]
    assert p1["receipt"]["sent_to"] == "buyer@brighttech.test" and p2["receipt"]["sent_to"] == "a@b.test"


def test_only_someone_with_access_and_a_real_address():
    env = Env()
    _invoice(env, [{"id": "p1", "amount": 100}])
    with pytest.raises(AccessDenied):
        run(env.orch.record_manual_receipt("A", "inv1", OUTSIDER, ["x@y.test"], None, OUTSIDER))
    with pytest.raises(Conflict):
        run(env.orch.record_manual_receipt("A", "inv1", OWNER, ["not-an-email"], None, OWNER))
    with pytest.raises(Conflict):
        run(env.orch.record_manual_receipt("A", "missing", OWNER, ["x@y.test"], None, OWNER))
    assert "receipt" not in env.fin["invoices"][0]["payments"][0]
