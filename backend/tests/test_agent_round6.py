"""QA round 6: receipt numbers unique forever (R-1), lost receipt records restored and
flagged (R-2)."""
import asyncio
from datetime import datetime, timezone

import pytest

from app.modules.agent import integrity
from app.modules.agent.store import SupabaseStore
from test_agent import Env, invoiced, run

DAY = datetime(2026, 10, 3, 2, 16, tzinfo=timezone.utc)


def _pay(inv, pid, amount, env):
    inv.setdefault("payments", []).append({"id": pid, "amount": amount, "paid_at": env.now.isoformat()})
    inv["status"] = "paid"


# ── R-1 ───────────────────────────────────────────────────────────────────────
def test_a_number_is_never_reused_after_the_receipt_record_is_lost():
    """The live fault: REC-1031026 was sent, its record was erased, and the next receipt
    that day was given the same number."""
    env = Env()
    r, inv = invoiced(env)
    _pay(inv, "pay1", 1000, env)
    r = env.approve(run(env.orch.advance(r["id"])))
    first = inv["payments"][0]["receipt"]["number"]
    assert inv["payments"][0]["receipt"]["sent_at"]

    # Every receipt on every invoice disappears (a save from a stale copy, a bad import...).
    for i in env.fin["invoices"]:
        for p in i.get("payments") or []:
            p.pop("receipt", None)
    # A different invoice takes a payment the same day.
    other = {"id": "inv-other", "reference": "INV-OTHER", "customer_name": "Someone Else Ltd", "customer_email": "pay@else.test",
             "status": "paid", "total_amount": 500, "payments": [{"id": "payX", "amount": 500, "paid_at": env.now.isoformat()}]}
    env.fin["invoices"].append(other)
    r2 = env.submit(capability="receipt_send", channel="ui_action", params={"invoice_id": "inv-other"})["run"]
    second = env.pending(r2)[0]["payload"]["receipt_number"]
    assert second != first
    numbers = [h["number"] for h in run(env.store.receipt_history("A"))]
    assert len(numbers) == len(set(numbers)) == 2


def test_numbers_are_unique_per_business_and_independent_between_businesses():
    env = Env()
    a = [run(env.store.issue_receipt("A", "inv1", f"p{i}", DAY))["number"] for i in range(5)]
    b = run(env.store.issue_receipt("B", "inv1", "p0", DAY))["number"]
    assert a == [f"REC-{n}031026" for n in range(1, 6)] and b == "REC-1031026"
    again = run(env.store.issue_receipt("A", "inv1", "p2", DAY))
    assert again["number"] == "REC-3031026" and again["created"] is False      # one receipt per payment


def test_simultaneous_receipts_get_different_numbers():
    env = Env()

    async def both():
        return await asyncio.gather(*[env.store.issue_receipt("A", "inv1", f"p{i}", DAY) for i in range(20)])
    numbers = [r["number"] for r in asyncio.run(both())]
    assert len(set(numbers)) == 20


# ── R-2 ───────────────────────────────────────────────────────────────────────
def test_a_lost_receipt_record_is_restored_not_resent_and_the_sale_still_closes():
    """INV-1031026: £100 receipted and sent, the record erased, then £188 paid. The run
    used to stop with "no confirmed payment with a receipt to send"."""
    env = Env()
    r, inv = invoiced(env)
    total = inv["total_amount"]
    _pay(inv, "pay1", 1000, env)
    r = env.approve(run(env.orch.advance(r["id"])))
    sent = dict(inv["payments"][0]["receipt"])
    emails = len(env.comms.sent)

    inv["payments"][0].pop("receipt")                                   # the record is lost
    _pay(inv, "pay2", total - 1000, env)
    inv["payment_type"] = "full"

    r = run(env.orch.advance(r["id"]))
    restored = inv["payments"][0]["receipt"]
    assert restored["number"] == sent["number"] and restored["sent_at"] == sent["sent_at"] and restored["sent_to"] == sent["sent_to"]
    assert restored["message_id"] == sent["message_id"] and restored["restored_at"]
    assert len(env.comms.sent) == emails                                # the first receipt was not sent again
    pending = env.pending(r)[0]
    assert pending["tool_id"] == "send_receipt" and pending["payload"]["payment_id"] == "pay2"
    assert pending["payload"]["receipt_number"] != sent["number"]
    r = env.approve(r)
    assert r["status"] == "succeeded" and len(env.comms.sent) == emails + 1
    assert "workflow_failed" not in env.audit_types(r) and "guardrail_stop" not in env.audit_types(r)


def test_the_check_flags_a_sent_receipt_missing_from_the_books():
    env = Env()
    r, inv = invoiced(env)
    _pay(inv, "pay1", 1000, env)
    r = env.approve(run(env.orch.advance(r["id"])))
    assert run(integrity.check_business(env.orch.rt, "A")) == []       # healthy
    number = inv["payments"][0].pop("receipt")["number"]
    issues = run(integrity.check_business(env.orch.rt, "A"))
    assert [i["issue"] for i in issues] == ["receipt_record_missing"]
    assert issues[0]["receipt_number"] == number and issues[0]["payment_id"] == "pay1" and issues[0]["run_id"] == r["id"]
    inv["payments"].clear()
    assert [i["issue"] for i in run(integrity.check_business(env.orch.rt, "A"))] == ["payment_missing"]
    assert run(integrity.check_all_at_startup(env.orch.rt)).keys() == {"A"}


def test_the_check_flags_a_number_that_reached_two_payments():
    history = [{"number": "REC-1031026", "invoice_id": "i1", "payment_id": "p1", "sent_to": "a@x.test", "sent_at": "t1"},
               {"number": "REC-1031026", "invoice_id": "i2", "payment_id": "p9", "sent_to": "b@y.test", "sent_at": "t2"},
               {"number": "REC-2031026", "invoice_id": "i2", "payment_id": "p10", "sent_to": "b@y.test", "sent_at": "t3"}]
    issues = integrity.receipt_issues({}, [], history)
    assert len(issues) == 1 and issues[0]["issue"] == "duplicate_receipt_number" and len(issues[0]["payments"]) == 2


# ── the production store, against a stand-in database ────────────────────────
class FakeDb:
    """Just enough PostgREST: the idempotency history, and optionally the ledger."""

    def __init__(self, ledger: bool):
        self.ledger = ledger
        self.receipts: list[dict] = []
        self.counter: dict[tuple, int] = {}
        self.approvals: list[dict] = []
        self.idem = [
            {"key": "receipt:i1:p1", "status": "completed", "result": {"receipt_number": "REC-1031026"}, "created_at": "1", "completed_at": "1", "run_id": "r1"},
            {"key": "send_receipt:i1:p1:a@x.test", "status": "completed", "completed_at": "2", "created_at": "2",
             "result": {"receipt_number": "REC-1031026", "sent_to": "a@x.test", "message_id": "m1"}},
            {"key": "receipt:i2:p9", "status": "completed", "result": {"receipt_number": "REC-1031026"}, "created_at": "3", "completed_at": "3", "run_id": "r2"},
            {"key": "receipt:i2:p10", "status": "completed", "result": {"receipt_number": "REC-2031026"}, "created_at": "4", "completed_at": "4", "run_id": "r2"},
            {"key": "send_invoice:i1:a@x.test", "status": "completed", "result": {"reference": "INV-1"}, "created_at": "0"},
        ]

    async def sb_select(self, table, filters=None, single=False, **_):
        f = {(c, o): v for c, o, v in filters or []}
        if table == "agent_idempotency":
            pattern = f[("key", "like")]
            assert pattern.endswith(":%")
            return [r for r in self.idem if r["key"].startswith(pattern[:-1])]
        if table == "agent_approvals":
            return self.approvals
        if table == "agent_receipts":
            if not self.ledger:
                raise RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.agent_receipts'\"}")
            rows = [r for r in self.receipts if all(r.get(c) == v for (c, o), v in f.items() if o == "eq" and c != "business_id")]
            return (rows[0] if rows else None) if single else rows
        raise AssertionError(table)

    async def sb_rpc(self, function, params):
        if not self.ledger:
            raise RuntimeError("{'code': 'PGRST202', 'message': 'Could not find the function public.agent_next_receipt_seq'}")
        key = (params["p_business"], params["p_day"])
        self.counter[key] = self.counter.get(key, 0) + 1
        return self.counter[key]

    async def sb_insert(self, table, payload):
        assert table == "agent_receipts"
        if any(r["receipt_number"] == payload["receipt_number"] for r in self.receipts):
            raise RuntimeError("duplicate key value violates unique constraint uq_agent_receipts_number")
        self.receipts.append(dict(payload))
        return [payload]


def _store(ledger: bool) -> tuple[SupabaseStore, FakeDb]:
    store = SupabaseStore()
    store.sb = FakeDb(ledger)
    return store, store.sb


@pytest.mark.parametrize("ledger", [False, True])
def test_numbers_already_sent_are_skipped_with_or_without_the_ledger(ledger):
    """REC-1 and REC-2 of 03/10/26 were sent before the ledger existed (and its counter starts
    at zero here): the next number that day must still be REC-3."""
    store, db = _store(ledger)
    new = run(store.issue_receipt("A", "i1", "p2", DAY, {"amount": 188}))
    assert new["number"] == "REC-3031026" and new["created"] is True
    if ledger:
        assert db.receipts[0]["receipt_number"] == "REC-3031026" and db.receipts[0]["amount"] == 188
        assert run(store.issue_receipt("A", "i1", "p3", DAY))["number"] == "REC-4031026"
        assert run(store.issue_receipt("A", "i1", "p2", DAY))["created"] is False      # same payment, same receipt


@pytest.mark.parametrize("ledger", [False, True])
def test_a_receipt_sent_before_is_returned_from_history_with_its_delivery_details(ledger):
    store, _ = _store(ledger)
    old = run(store.issue_receipt("A", "i1", "p1", DAY))
    assert old["created"] is False and old["number"] == "REC-1031026"
    assert old["sent_to"] == "a@x.test" and old["message_id"] == "m1" and old["sent_at"] == "2"
    history = run(store.receipt_history("A"))
    assert [(h["number"], h["payment_id"]) for h in history] == [("REC-1031026", "p1"), ("REC-1031026", "p9"), ("REC-2031026", "p10")]
    assert [i["issue"] for i in integrity.receipt_issues({}, [], history)] == ["duplicate_receipt_number"]


@pytest.mark.parametrize("ledger", [False, True])
def test_a_number_known_only_from_an_approval_or_a_sent_email_is_also_taken(ledger):
    """Receipts issued before the ledger existed may appear only in an approval (REC-3) or
    in the record of a sent email (REC-4)."""
    store, db = _store(ledger)
    db.approvals.append({"tool_id": "send_receipt", "status": "pending", "created_at": "5", "run_id": "r1",
                         "payload": {"receipt_number": "REC-3031026", "invoice_id": "i1", "payment_id": "p2"}})
    db.idem.append({"key": "send_receipt:i7:p7:c@z.test", "status": "completed", "created_at": "6", "completed_at": "6",
                    "result": {"receipt_number": "REC-4031026", "sent_to": "c@z.test", "message_id": "m7"}})
    assert run(store.issue_receipt("A", "i1", "p5", DAY))["number"] == "REC-5031026"
    same = run(store.issue_receipt("A", "i1", "p2", DAY))
    assert same["number"] == "REC-3031026" and same["created"] is False
    sent = run(store.issue_receipt("A", "i7", "p7", DAY))
    assert sent["number"] == "REC-4031026" and sent["sent_to"] == "c@z.test" and sent["created"] is False
