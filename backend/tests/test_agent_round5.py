"""QA round 5 (Phase 2 on the live DB): P-1, P-3, P-6, P-7, P-8."""
import asyncio
import copy

import pytest

from app.modules.agent.orchestrator import Conflict
from app.shared.workspace_merge import preserve_server_fields
from test_agent import ENQUIRY, OWNER, Env, invoiced, run


def stale_save(env, stale_copy: dict, change) -> None:
    """What Business Operations does: edit its own (stale) copy and save the whole document.
    The server-side merge (core.supabase.sb_update) applies preserve_server_fields."""
    incoming = copy.deepcopy(stale_copy)
    change(incoming)
    current = env.businesses["A"]["data"]
    merged = preserve_server_fields(incoming, current)
    current["financials"] = merged["financials"]


def test_second_payment_after_a_stale_save_gets_its_own_receipt_and_closes_the_sale():
    """QA repro: £100 paid and receipted, then £188 recorded from a copy loaded before the receipt."""
    env = Env()
    r, inv = invoiced(env)
    total = inv["total_amount"]
    inv["payments"] = [{"id": "pay1", "amount": 1000, "paid_at": env.now.isoformat()}]
    inv.update({"status": "paid", "payment_type": "partial"})
    stale = copy.deepcopy(env.businesses["A"]["data"])               # the page's copy: no receipt yet
    r = env.approve(run(env.orch.advance(r["id"])))                   # REC for pay1 issued and sent
    first = env.fin["invoices"][0]["payments"][0]["receipt"]
    assert first["sent_at"]

    def add_second_payment(data):
        i = data["financials"]["invoices"][0]
        i["payments"].append({"id": "pay2", "amount": total - 1000, "paid_at": env.now.isoformat()})
        i["payment_type"] = "full"
    stale_save(env, stale, add_second_payment)

    inv = env.fin["invoices"][0]
    assert inv["payments"][0]["receipt"] == first                     # the stale save didn't erase it
    r = run(env.orch.advance(r["id"]))
    pending = env.pending(r)[0]
    assert pending["tool_id"] == "send_receipt" and pending["payload"]["payment_id"] == "pay2"
    r = env.approve(r)
    assert r["status"] == "succeeded"
    numbers = [p["receipt"]["number"] for p in inv["payments"]]
    assert len(set(numbers)) == 2 and all(p["receipt"]["sent_at"] for p in inv["payments"])
    types = env.audit_types(r)
    assert "duplicate_prevented" not in types and "guardrail_stop" not in types and "workflow_failed" not in types


def test_stale_saves_keep_customer_acceptance_and_questions():
    stored = {"financials": {"quotes": [{"id": "q1", "status": "accepted", "responded_at": "2026-10-03T10:00:00",
                                         "customer_questions": [{"message": "When can you start?"}]}]}}
    incoming = {"financials": {"quotes": [{"id": "q1", "status": "sent", "notes": "edited"}]}}
    q = preserve_server_fields(incoming, stored)["financials"]["quotes"][0]
    assert q["status"] == "accepted" and q["notes"] == "edited" and len(q["customer_questions"]) == 1


def test_simultaneous_approvals_only_one_wins():
    env = Env()
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action")["run"]
    approval = env.pending(r)[0]

    async def both():
        return await asyncio.gather(
            env.orch.decide_approval(r["id"], approval["id"], OWNER, True),
            env.orch.decide_approval(r["id"], approval["id"], OWNER, True),
            return_exceptions=True,
        )
    results = asyncio.run(both())
    conflicts = [x for x in results if isinstance(x, Conflict)]
    assert len(conflicts) == 1 and conflicts[0].code == "approval_not_pending"
    assert env.audit_types(r).count("approval_granted") == 1
    assert len(env.comms.sent) == 1
    assert "guardrail_stop" not in env.audit_types(r) and "workflow_failed" not in env.audit_types(r)


def test_corrected_email_updates_the_customer_record_and_is_remembered():
    env = Env()
    env.comms.refuse_domains.add("example.com")
    env.businesses["A"]["data"]["catalogue"]["customers"].append({"id": "c9", "name": "Inject Test Ltd", "email": "inject@example.com"})
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={**ENQUIRY, "sender_name": "Inject Test Ltd", "sender_email": "inject@example.com"})["run"]
    r = env.approve(r)
    assert r["pending_question"]["fields"][0]["key"] == "customer_email"
    run(env.orch.provide_input(r["id"], OWNER, {"customer_email": "accounts@inject-test.co.uk"}))
    c = next(c for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["id"] == "c9")
    assert c["email"] == "accounts@inject-test.co.uk" and "inject@example.com" in c["refused_emails"]
    assert "customer_email_updated" in env.audit_types(r)


def test_refused_address_on_record_is_caught_before_any_approval():
    env = Env()
    env.businesses["A"]["data"]["catalogue"]["customers"].append(
        {"id": "c9", "name": "Inject Test Ltd", "email": "inject@example.com", "refused_emails": ["inject@example.com"]})
    r = env.submit(capability="enquiry_to_quote", channel="ui_action",
                   params={**ENQUIRY, "sender_name": "Inject Test Ltd", "sender_email": "inject@example.com"})["run"]
    assert r["substatus"] == "waiting_for_information" and not env.pending(r)
    assert r["pending_question"]["fields"][0]["key"] == "customer_email"


@pytest.mark.parametrize("how,expected", [("reject", "rejected"), ("cancel", "cancelled")])
def test_unsent_quote_follows_its_run(how, expected):
    env = Env()
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY), channel="ui_action")["run"]
    if how == "reject":
        env.approve(r, ok=False)
    else:
        run(env.orch.cancel(r["id"], OWNER))
    assert env.fin["quotes"][0]["status"] == expected


def test_partial_payment_says_what_is_outstanding():
    env = Env()
    r, inv = invoiced(env)
    total = inv["total_amount"]
    inv["payments"] = [{"id": "pay1", "amount": 1000, "paid_at": env.now.isoformat()}]
    inv.update({"status": "paid", "payment_type": "partial"})
    r = env.approve(run(env.orch.advance(r["id"])))
    r = run(env.orch.advance(r["id"]))
    assert r["next_action"].startswith(f"£{total - 1000:,.2f} outstanding. Waiting for the remaining payment.")
