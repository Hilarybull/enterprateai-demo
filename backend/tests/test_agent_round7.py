"""QA round 7: reminders, pauses and recovery (F-1 to F-5, F-8) and provider timeouts."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.modules.agent.orchestrator import Conflict
from app.modules.agent.tools import REGISTRY
from app.shared import invoice_numbers
from app.shared.workspace_merge import preserve_server_fields
from test_agent import ENQUIRY, OWNER, T0, Env, accepted_quote, invoiced, run

NOW = datetime(2026, 10, 4, 9, 0, tzinfo=timezone.utc)


def overdue_invoice(env, iid="inv1", days_overdue=5, **over):
    inv = {"id": iid, "reference": f"INV-{iid}", "customer_name": "BrightTech Ltd", "customer_id": "c1",
           "customer_email": "buyer@brighttech.test", "status": "sent", "total_amount": 500,
           "due_date": (env.now - timedelta(days=days_overdue)).date().isoformat(), "payments": [], **over}
    env.fin["invoices"].append(inv)
    return inv


def followup(env, inv, **kw):
    return env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]}, **kw)


def steps(env, r):
    return {s["step_key"]: s for s in run(env.store.list_steps(r["id"]))}


# ── F-1: invoice numbers unique per business ─────────────────────────────────
@pytest.fixture
def no_ledger(monkeypatch):
    monkeypatch.setattr(invoice_numbers, "_ledger_available", False)      # as before migration 030


def _save(incoming_invoices, stored_invoices, now=NOW):
    incoming = {"invoices": copy.deepcopy(incoming_invoices)}
    run(invoice_numbers.prepare_invoices_for_save("A", incoming, {"invoices": stored_invoices}, now))
    return incoming["invoices"]


def test_a_new_invoice_gets_the_next_number_not_a_duplicate(no_ledger):
    stored = [{"id": "a", "invoice_number": "INV-1041026", "reference": "INV-1041026"}]
    # The form used to pre-fill INV-1041026 again; unedited (number_auto) it is replaced by the server.
    saved = _save([*stored, {"id": "local:x1", "invoice_number": "INV-1041026", "reference": "INV-1041026", "number_auto": True}], stored)
    assert saved[1]["invoice_number"] == saved[1]["reference"] == "INV-2041026" and "number_auto" not in saved[1]
    blank = _save([*stored, {"id": "local:x2"}], stored)
    assert blank[1]["invoice_number"] == "INV-2041026"


def test_a_typed_duplicate_is_rejected_with_a_clear_message(no_ledger):
    stored = [{"id": "a", "invoice_number": "INV-1041026"}, {"id": "b", "invoice_number": "INV-2041026"}]
    with pytest.raises(HTTPException) as e:
        _save([*stored, {"id": "c", "invoice_number": "inv-1041026 "}], stored)          # case and spaces don't make it different
    assert e.value.status_code == 409 and e.value.detail["code"] == "duplicate_invoice_number"
    assert "INV-1041026".lower() in e.value.detail["message"].lower() and "already used" in e.value.detail["message"]
    with pytest.raises(HTTPException):                                                    # renumbering onto another invoice's number
        _save([stored[0], {"id": "b", "invoice_number": "INV-1041026"}], stored)
    with pytest.raises(HTTPException):                                                    # two new invoices, same typed number
        _save([*stored, {"id": "c", "invoice_number": "X-1"}, {"id": "d", "invoice_number": "X-1"}], stored)
    ok = _save([*stored, {"id": "c", "invoice_number": "ACME-77"}], stored)               # a free typed number is kept
    assert ok[2]["invoice_number"] == ok[2]["reference"] == "ACME-77"


def test_old_duplicates_do_not_block_unrelated_saves(no_ledger):
    stored = [{"id": "a", "invoice_number": "INV-1041026"}, {"id": "b", "invoice_number": "INV-1041026"}]
    saved = _save([{**stored[0], "notes": "edited"}, stored[1]], stored)
    assert [i["invoice_number"] for i in saved] == ["INV-1041026", "INV-1041026"]
    assert [d["issue"] for d in invoice_numbers.duplicate_numbers(saved)] == ["duplicate_invoice_number"]


def test_the_ledger_constraint_refuses_a_number_another_invoice_holds(monkeypatch):
    """With migration 030: the database's unique (business_id, invoice_number) is the authority,
    even for a number the workspace copy no longer shows (e.g. a deleted invoice)."""
    from app.core import supabase as sb
    ledger: dict[tuple, str] = {("A", "INV-1041026"): "gone"}
    counter = {"n": 0}

    async def insert(table, row):
        key = (row["business_id"], row["invoice_number"])
        if key in ledger:
            raise RuntimeError("duplicate key value violates unique constraint uq_business_invoice_number")
        ledger[key] = row["invoice_id"]
        return [row]

    async def select(table, filters=None, single=False, **_):
        f = {c: v for c, _o, v in filters}
        held = ledger.get((f["business_id"], f["invoice_number"]))
        return {"invoice_id": held} if held else None

    async def rpc(fn, params):
        counter["n"] += 1
        return counter["n"]

    monkeypatch.setattr(invoice_numbers, "_ledger_available", None)
    monkeypatch.setattr(sb, "sb_insert", insert)
    monkeypatch.setattr(sb, "sb_select", select)
    monkeypatch.setattr(sb, "sb_rpc", rpc)
    with pytest.raises(HTTPException):
        _save([{"id": "c", "invoice_number": "INV-1041026"}], [])
    auto = _save([{"id": "d"}], [])
    assert auto[0]["invoice_number"] == "INV-2041026"                       # 1 is held, so the sequence moves on
    assert ledger[("A", "INV-2041026")] == "d"
    again = _save([{"id": "d", "invoice_number": "INV-2041026", "notes": "x"}], auto)      # its own number is fine
    assert again[0]["invoice_number"] == "INV-2041026"


def test_agent_invoices_take_numbers_from_the_same_sequence():
    env = Env()
    env.fin["invoices"].append({"id": "manual", "invoice_number": "INV-1011026", "reference": "INV-1011026", "status": "sent"})
    invoiced(env)
    inv = env.fin["invoices"][-1]
    assert inv["reference"] == inv["invoice_number"] == "INV-2011026"      # T0 is 1 Oct 2026; INV-1 is taken


# ── F-8: server ids ───────────────────────────────────────────────────────────
def test_invoices_get_a_server_id_on_save_and_old_references_still_resolve(no_ledger):
    from app.modules.agent import business as bz
    saved = _save([{"id": "local:abc123", "invoice_number": "ACME-1"}, {"invoice_number": "ACME-2"}], [])
    assert all(not str(i["id"]).startswith("local:") and len(i["id"]) == 36 for i in saved)
    assert saved[0]["legacy_id"] == "local:abc123" and "legacy_id" not in saved[1]
    assert bz.find(saved, "local:abc123") is saved[0]                       # a run that stored the old id still finds it
    # A stale page copy still carrying the local id updates the same invoice instead of adding a second.
    stale = _save([{"id": "local:abc123", "invoice_number": "ACME-1", "notes": "edited"}], saved)
    assert stale[0]["id"] == saved[0]["id"] and len(stale) == 1


# ── F-2: disputed / voided / cancelled / credited ────────────────────────────
@pytest.mark.parametrize("state", ["disputed", "voided", "cancelled", "credited"])
def test_followup_pauses_blocked_with_the_reason_and_sends_nothing(state):
    env = Env()
    inv = overdue_invoice(env)
    res = run(env.orch.set_invoice_state("A", inv["id"], OWNER, state, "Customer says the hours are wrong", "2026-09-30"))
    assert res["status"] == state and inv["status_reason"] == "Customer says the hours are wrong" and inv["status_date"] == "2026-09-30"
    r = followup(env, inv)["run"]
    assert r["status"] == "failed" and r["substatus"] == "blocked" and r["reason_code"] == f"invoice_{state}"
    assert r["summary"] == f"Invoice {state}: Customer says the hours are wrong"
    assert env.comms.sent == [] and env.pending(r) == []


def test_quote_to_cash_pauses_on_a_dispute_and_resumes_when_reopened():
    env = Env()
    r, inv = invoiced(env)
    sent = len(env.comms.sent)
    env.now = T0 + timedelta(days=40)
    run(env.orch.set_invoice_state("A", inv["id"], OWNER, "disputed", "Wrong quantity billed"))
    r = run(env.store.get_run(r["id"]))                                    # the state change woke the waiting run
    assert r["status"] == "failed" and r["substatus"] == "blocked" and r["summary"] == "Invoice disputed: Wrong quantity billed"
    assert len(env.comms.sent) == sent and env.pending(r) == []
    run(env.orch.set_invoice_state("A", inv["id"], OWNER, "reopen"))
    assert inv["status"] == "sent" and not inv.get("status_reason")
    r = run(env.orch.retry(r["id"], OWNER))
    assert env.pending(r)[0]["tool_id"] == "send_payment_reminder"


def test_a_dispute_raised_after_approval_was_requested_stops_the_send():
    env = Env()
    inv = overdue_invoice(env)
    r = followup(env, inv)["run"]
    assert env.pending(r)[0]["tool_id"] == "send_payment_reminder"
    run(env.orch.set_invoice_state("A", inv["id"], OWNER, "disputed", "Goods not received"))
    r = env.approve(r)                                                      # revalidated at approval time, as for paid
    assert env.comms.sent == [] and r["status"] == "failed" and r["reason_code"] == "invoice_disputed"
    assert r["summary"] == "Invoice disputed: Goods not received"


def test_state_changes_need_a_reason_a_valid_state_and_an_existing_invoice():
    env = Env()
    inv = overdue_invoice(env)
    for args in [("disputed", ""), ("paid", "because"), ("voided", "ok")]:
        if args[0] == "voided":
            with pytest.raises(Conflict):
                run(env.orch.set_invoice_state("A", "nope", OWNER, *args))
        else:
            with pytest.raises(Conflict):
                run(env.orch.set_invoice_state("A", inv["id"], OWNER, *args))
    with pytest.raises(Conflict):
        run(env.orch.set_invoice_state("A", inv["id"], OWNER, "reopen"))   # nothing to reopen


def test_a_stale_page_save_cannot_undo_a_dispute():
    stored = {"financials": {"invoices": [{"id": "i1", "status": "disputed", "status_reason": "Wrong hours",
                                           "status_changed_at": "2026-10-04T10:00:00+00:00", "status_before": "sent"}]}}
    incoming = {"financials": {"invoices": [{"id": "i1", "status": "sent", "notes": "edited on an old copy"}]}}
    inv = preserve_server_fields(incoming, stored)["financials"]["invoices"][0]
    assert inv["status"] == "disputed" and inv["status_reason"] == "Wrong hours" and inv["notes"] == "edited on an old copy"


# ── F-3: minimum interval between reminders ──────────────────────────────────
def test_no_second_reminder_inside_the_interval_however_overdue():
    """25 days overdue passes all three thresholds (3, 10, 21) at once: still one reminder,
    then nothing until the interval has passed."""
    env = Env()
    inv = overdue_invoice(env, days_overdue=25)
    r = env.approve(followup(env, inv)["run"])
    assert r["status"] == "succeeded" and len(env.comms.sent) == 1 and len(inv["reminders"]) == 1
    assert inv["reminders"][0]["stage"] == 1
    assert inv["last_reminder_at"] and inv["next_reminder_not_before"] == (env.now + timedelta(days=7)).isoformat()

    env.now += timedelta(days=3)                                            # asked again three days later
    r2 = followup(env, inv)["run"]
    assert r2["status"] == "succeeded" and r2["state"]["outcome"] == {"skipped": True, "reason": "reminder_too_soon", "invoice_id": inv["id"]}
    assert len(env.comms.sent) == 1 and env.pending(r2) == []
    assert "next can't go before" in r2["summary"]

    env.now += timedelta(days=5)                                            # eight days after the first
    r3 = followup(env, inv)["run"]
    pending = env.pending(r3)[0]
    assert pending["tool_id"] == "send_payment_reminder" and pending["payload"]["stage"] == 2      # the next stage, in order


def test_quote_to_cash_sends_one_stage_then_waits_out_the_interval():
    env = Env()
    r, inv = invoiced(env)
    env.now = T0 + timedelta(days=60)                                       # far past every threshold
    r = env.approve(run(env.orch.advance(r["id"])))
    assert len(inv["reminders"]) == 1 and r["substatus"] == "waiting_for_external_event" and env.pending(r) == []
    assert "next reminder can go from" in r["next_action"]
    for _ in range(3):                                                      # woken repeatedly: still nothing
        r = run(env.orch.advance(r["id"]))
    assert len(inv["reminders"]) == 1 and env.pending(r) == []
    env.now += timedelta(days=8)
    r = run(env.orch.advance(r["id"]))
    assert env.pending(r)[0]["payload"]["stage"] == 2


def test_the_interval_is_at_least_the_gap_between_cadence_stages():
    from app.modules.agent import business as bz
    policy = {"reminders": {"cadence_days_overdue": [3, 10, 21], "min_interval_days": 7}}
    assert [bz.reminder_gap_days(policy, sent) for sent in (1, 2, 3)] == [7, 11, 7]
    assert bz.reminder_gap_days({"reminders": {"cadence_days_overdue": [1, 2, 3]}}, 1) == 7       # never under the minimum


def test_an_approved_reminder_is_not_sent_if_another_went_in_the_meantime():
    env = Env()
    inv = overdue_invoice(env, days_overdue=25)
    r = followup(env, inv)["run"]
    inv["reminders"] = [{"stage": 1, "sent_at": env.now.isoformat(), "sent_to": "buyer@brighttech.test"}]      # another run sent it
    r = env.approve(r)
    assert env.comms.sent == [] and r["status"] == "succeeded" and r["state"]["outcome"]["reason"] == "reminder_too_soon"


# ── F-4: skipped means skipped ───────────────────────────────────────────────
def test_a_skipped_reminder_is_recorded_as_skipped_not_as_a_send():
    env = Env()
    inv = overdue_invoice(env, payments=[{"id": "p1", "amount": 500, "paid_at": "2026-09-30"}], status="paid")
    r = followup(env, inv)["run"]
    assert r["status"] == "succeeded" and r["state"]["outcome"]["skipped"] is True and r["state"]["outcome"]["reason"] == "invoice_paid"
    assert r["summary"] == "No reminder sent: invoice INV-inv1 is already paid."
    s = steps(env, r)
    assert s["check"]["state"] == "succeeded"
    assert s["send"]["state"] == "skipped" and s["send"]["reason_code"] == "invoice_paid" and not s["send"].get("external_ref")
    assert "action_skipped" in env.audit_types(r) and env.comms.sent == []


def test_a_reminder_skipped_at_approval_marks_the_send_step_skipped():
    env = Env()
    inv = overdue_invoice(env)
    r = followup(env, inv)["run"]
    inv["payments"] = [{"id": "p1", "amount": 500, "paid_at": env.now.isoformat()}]
    inv["status"] = "paid"
    r = env.approve(r)
    assert r["status"] == "succeeded" and r["state"]["outcome"] == {"skipped": True, "reason": "invoice_paid", "invoice_id": "inv1"}
    assert [s for s in run(env.store.list_steps(r["id"])) if s["step_key"] == "send"][-1]["state"] == "skipped"
    assert env.comms.sent == []


def test_no_customer_email_goes_to_needs_attention_and_can_be_fixed_in_place():
    from app.modules.agent.summary import bucket_of
    env = Env()
    env.businesses["A"]["data"]["catalogue"]["customers"][0]["email"] = ""
    inv = overdue_invoice(env, customer_email="")
    r = followup(env, inv)["run"]
    assert r["status"] == "failed" and r["substatus"] == "blocked" and r["reason_code"] == "invalid_customer_destination"
    assert bucket_of(r) == "needs_attention" and r["summary"] == "BrightTech Ltd has no email on record for INV-inv1. Add it and I'll prepare the reminder."
    with pytest.raises(Conflict):
        run(env.orch.fix_customer_email(r["id"], OWNER, "not-an-email"))
    r = run(env.orch.fix_customer_email(r["id"], OWNER, "accounts@brighttech.test"))
    assert env.pending(r)[0]["payload"]["to_email"] == "accounts@brighttech.test"
    assert env.businesses["A"]["data"]["catalogue"]["customers"][0]["email"] == "accounts@brighttech.test"
    assert inv["customer_email"] == "accounts@brighttech.test" and "customer_email_updated" in env.audit_types(r)


# ── F-5: a skip is surfaced once ─────────────────────────────────────────────
def test_a_repeat_followup_for_the_same_reason_reuses_the_skipped_run_and_costs_nothing():
    env = Env()
    inv = overdue_invoice(env, days_overdue=-5)                             # not overdue yet
    first = followup(env, inv)
    assert first["run"]["state"]["outcome"]["reason"] == "invoice_not_overdue"
    used = run(env.orch._usage("A"))["monthly_runs"]
    for _ in range(4):
        again = followup(env, inv)
        assert again["run"]["id"] == first["run"]["id"] and again["duplicate"] and again["repeat"]
        assert "haven't started another task" in again["message"]
    assert run(env.orch._usage("A"))["monthly_runs"] == used                # repeats used no quota
    assert len(run(env.store.list_runs("A"))) == 1
    assert env.audit_types(first["run"]).count("repeat_suppressed") == 4


def test_a_new_reason_or_an_old_skip_starts_a_fresh_run():
    env = Env()
    inv = overdue_invoice(env, days_overdue=-1)
    first = followup(env, inv)["run"]
    assert first["state"]["outcome"]["reason"] == "invoice_not_overdue"
    env.now += timedelta(days=3)                                            # now overdue: the situation changed
    r = followup(env, inv)["run"]
    assert r["id"] != first["id"] and env.pending(r)[0]["tool_id"] == "send_payment_reminder"

    env2 = Env()
    inv2 = overdue_invoice(env2, days_overdue=-60)
    a = followup(env2, inv2)["run"]
    env2.now += timedelta(days=8)                                           # same reason, but a week on: checked again
    b = followup(env2, inv2)["run"]
    assert b["id"] != a["id"] and b["state"]["outcome"]["reason"] == "invoice_not_overdue"


def test_a_general_followup_request_ignores_invoices_inside_their_interval():
    env = Env()
    inv = overdue_invoice(env, days_overdue=25)
    env.approve(followup(env, inv)["run"])
    res = env.submit(capability="payment_followup", channel="ui_action")
    assert res["kind"] == "answer" and "No overdue invoices are eligible" in res["message"]
    assert len(run(env.store.list_runs("A"))) == 1


# ── provider timeouts: reconcile first, never send twice ─────────────────────
def _to_approval(env, tool):
    """A run waiting for approval of `tool`, and the tool's own timeout shortened."""
    if tool == "send_quotation":
        r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]
    elif tool == "send_invoice":
        q = accepted_quote(env)
        r = env.submit(capability="quote_to_cash", params={"quote_id": q["id"]})["run"]
    elif tool == "send_payment_reminder":
        r = followup(env, overdue_invoice(env))["run"]
    else:
        inv = overdue_invoice(env, status="paid", payments=[{"id": "p1", "amount": 500, "paid_at": env.now.isoformat()}])
        r = env.submit(capability="receipt_send", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    assert env.pending(r)[0]["tool_id"] == tool
    return r


SENDS = ["send_quotation", "send_invoice", "send_payment_reminder", "send_receipt"]


@pytest.fixture
def short_timeouts(monkeypatch):
    for tool in SENDS:
        monkeypatch.setattr(REGISTRY[tool], "timeout_s", 0.05)


@pytest.mark.parametrize("tool", SENDS)
def test_timeout_after_the_provider_accepted_is_reconciled_and_not_resent(tool, short_timeouts):
    env = Env()
    r = _to_approval(env, tool)
    before = len(env.comms.sent)
    credits = env.meter.balances[OWNER]
    env.comms.mode = "timeout_after_accept"            # the email went out; the answer never came back
    r = env.approve(r)
    assert r["status"] == "failed" and r["substatus"] == "delivery_status_uncertain"
    assert len(env.comms.sent) == before + 1 and env.comms.lookups == []
    message_id = env.comms.sent[-1]["message_id"]
    attempts = env.comms.attempts

    r = run(env.orch.retry(r["id"], OWNER))
    assert len(set(env.comms.lookups)) == 1                                      # reconciled by idempotency key first
    assert env.comms.attempts == attempts                                   # and the provider was not asked to send again
    assert len(env.comms.sent) == before + 1                                # one email, ever
    audits = [a for a in run(env.store.list_audit(r["id"])) if a["event_type"] == "delivery_reconciled"]
    assert len(audits) == 1 and audits[0]["detail"]["outcome"] == "delivered" and audits[0]["detail"]["message_id"] == message_id
    sent_step = [s for s in run(env.store.list_steps(r["id"])) if s.get("tool_id") == tool and s["state"] == "succeeded"][-1]
    assert sent_step["external_ref"] == message_id                          # the original delivery is what's recorded
    assert r["status"] != "failed" and env.meter.balances[OWNER] <= credits
    types = env.audit_types(r)
    assert types.index("delivery_reconciled") < len(types) - 1 - types[::-1].index("tool_executed")      # before the action completed


@pytest.mark.parametrize("tool", SENDS)
def test_timeout_before_the_provider_accepted_sends_exactly_once_on_retry(tool, short_timeouts):
    env = Env()
    r = _to_approval(env, tool)
    before = len(env.comms.sent)
    env.comms.mode = "timeout_before_accept"           # the request never reached the provider
    r = env.approve(r)
    assert r["substatus"] == "delivery_status_uncertain" and len(env.comms.sent) == before
    r = run(env.orch.retry(r["id"], OWNER))
    audits = [a for a in run(env.store.list_audit(r["id"])) if a["event_type"] == "delivery_reconciled"]
    assert len(set(env.comms.lookups)) == 1 and audits[0]["detail"]["outcome"] == "not_found"
    assert len(env.comms.sent) == before + 1 and r["status"] != "failed"
    # A second retry or a duplicate wake-up can't send again.
    run(env.orch.advance(r["id"]))
    assert len(env.comms.sent) == before + 1


@pytest.mark.parametrize("tool", SENDS)
def test_nothing_is_sent_while_delivery_is_uncertain(tool, short_timeouts):
    env = Env()
    r = _to_approval(env, tool)
    env.comms.mode = "timeout_after_accept"
    r = env.approve(r)
    sent = len(env.comms.sent)
    for _ in range(3):                                  # wake-ups don't retry on their own
        run(env.orch.advance(r["id"]))
    assert len(env.comms.sent) == sent and run(env.store.get_run(r["id"]))["substatus"] == "delivery_status_uncertain"


# ── Round 7 follow-ups ────────────────────────────────────────────────────────
def _no_email_invoice(env):
    env.businesses["A"]["data"]["catalogue"]["customers"][0]["email"] = ""
    return overdue_invoice(env, customer_email="")


def test_a_blocked_followup_is_reused_not_recreated_and_costs_no_quota():
    """Aftred's INV-1160926: no valid email. Every request made another blocked run."""
    env = Env()
    inv = _no_email_invoice(env)
    first = followup(env, inv)["run"]
    assert first["status"] == "failed" and first["reason_code"] == "invalid_customer_destination"
    used = run(env.orch._usage("A"))["monthly_runs"]
    for _ in range(3):
        again = followup(env, inv)
        assert again["run"]["id"] == first["id"] and again["duplicate"] and "already a task open" in again["message"]
    general = env.submit(capability="payment_followup", channel="ui_action")      # "follow up on overdue invoices"
    assert general["run"]["id"] == first["id"] and general["duplicate"]
    runs = run(env.store.list_runs("A"))
    assert len(runs) == 1 and run(env.orch._usage("A"))["monthly_runs"] == used
    from app.modules.agent.summary import bucket_of
    assert sum(1 for r in runs if bucket_of(r) == "needs_attention") == 1


def test_fixing_the_email_closes_older_duplicates_and_returns_their_quota():
    env = Env()
    inv = _no_email_invoice(env)
    first = followup(env, inv)["run"]
    # Two duplicates from before this fix existed.
    dupes = []
    for _ in range(2):
        d = dict(run(env.store.get_run(first["id"])))
        d.update({"id": f"dupe-{len(dupes)}", "created_at": env.now.isoformat()})
        run(env.store.create_run(d))
        dupes.append(d["id"])
    assert run(env.orch._usage("A"))["monthly_runs"] == 3
    r = run(env.orch.fix_customer_email(first["id"], OWNER, "accounts@brighttech.test"))
    assert env.pending(r)[0]["tool_id"] == "send_payment_reminder"
    for d in dupes:
        closed = run(env.store.get_run(d))
        assert closed["status"] == "cancelled" and closed["reason_code"] == "duplicate_closed" and closed["state"]["duplicate_of"] == first["id"]
    assert run(env.orch._usage("A"))["monthly_runs"] == 1                   # the duplicates no longer count
    assert "duplicates_closed" in env.audit_types(r)


def test_a_request_while_one_is_awaiting_approval_reuses_it():
    env = Env()
    inv = overdue_invoice(env)
    first = followup(env, inv)["run"]
    assert first["status"] == "awaiting_approval"
    again = followup(env, inv)
    assert again["run"]["id"] == first["id"] and again["duplicate"] and len(run(env.store.list_runs("A"))) == 1
    assert len(env.pending(first)) == 1


def test_a_blocked_followup_resumes_when_its_cause_has_gone():
    env = Env()
    inv = _no_email_invoice(env)
    first = followup(env, inv)["run"]
    inv["customer_email"] = "accounts@brighttech.test"                       # fixed in Business Operations instead
    res = followup(env, inv)
    assert res["run"]["id"] == first["id"] and not res.get("duplicate")
    assert env.pending(res["run"])[0]["payload"]["to_email"] == "accounts@brighttech.test"
    assert len(run(env.store.list_runs("A"))) == 1


# ── never retry a send after the provider's de-duplication window ────────────
@pytest.mark.parametrize("tool", SENDS)
def test_after_24h_an_unconfirmed_send_is_never_retried_automatically(tool, short_timeouts):
    env = Env()
    r = _to_approval(env, tool)
    env.comms.mode = "timeout_after_accept"
    r = env.approve(r)
    sent, attempts = len(env.comms.sent), env.comms.attempts
    env.now += timedelta(hours=25)
    env.comms.by_key.clear()                                                # the provider no longer recognises the key
    for _ in range(2):
        r = run(env.orch.retry(r["id"], OWNER))
        assert r["status"] == "failed" and r["substatus"] == "delivery_status_uncertain" and r["reason_code"] == "delivery_unconfirmed"
        assert env.pending(r) == []                                         # and no fresh approval is offered either
    assert len(env.comms.sent) == sent and env.comms.attempts == attempts   # nothing sent, provider not even asked to send
    assert "could arrive twice" in r["summary"] and r["state"]["delivery_question"]["tool"] == tool
    with pytest.raises(Conflict):
        run(env.orch.resolve_delivery(r["id"], OWNER, "maybe"))

    r = run(env.orch.resolve_delivery(r["id"], OWNER, "delivered"))         # the user checked: it arrived
    assert len(env.comms.sent) == sent and r["status"] != "failed"
    outcomes = [a["detail"]["outcome"] for a in run(env.store.list_audit(r["id"])) if a["event_type"] == "delivery_reconciled"]
    assert set(outcomes[:2]) <= {"unconfirmed_after_window", "unconfirmed_details_changed"} and outcomes[-1] == "confirmed_by_user"
    assert "delivery_decided_by_user" in env.audit_types(r)


def test_after_24h_the_user_can_choose_to_send_again_exactly_once(short_timeouts):
    env = Env()
    r = _to_approval(env, "send_invoice")
    env.comms.mode = "timeout_before_accept"                                # it never went
    r = env.approve(r)
    env.now += timedelta(hours=30)
    r = run(env.orch.retry(r["id"], OWNER))
    assert r["reason_code"] == "delivery_unconfirmed" and env.comms.sent[-1]["subject"].lower().find("invoice") == -1
    before = len(env.comms.sent)
    r = run(env.orch.resolve_delivery(r["id"], OWNER, "resend"))
    assert len(env.comms.sent) == before + 1 and r["status"] != "failed"
    run(env.orch.advance(r["id"]))
    assert len(env.comms.sent) == before + 1


def test_inside_the_window_a_retry_still_reconciles_on_its_own(short_timeouts):
    env = Env()
    r = _to_approval(env, "send_receipt")
    env.comms.mode = "timeout_after_accept"
    r = env.approve(r)
    env.now += timedelta(hours=20)
    r = run(env.orch.retry(r["id"], OWNER))
    assert r["status"] == "succeeded" and len(set(env.comms.lookups)) == 1


# ── the business's time zone ─────────────────────────────────────────────────
def test_agent_invoices_use_the_business_time_zone_for_dates_and_numbers():
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"]["timezone"] = "Pacific/Auckland"
    env.now = datetime(2026, 10, 3, 22, 30, tzinfo=timezone.utc)           # already 4 October, 11:30, in Auckland
    invoiced(env)
    inv = env.fin["invoices"][-1]
    assert inv["issued_at"] == "2026-10-04" and inv["reference"] == "INV-1041026"
    assert inv["due_date"] == "2026-10-18"                                  # 14 days from the local date

    env2 = Env()                                                            # no zone set: UTC, as before
    env2.now = datetime(2026, 10, 3, 22, 30, tzinfo=timezone.utc)
    invoiced(env2)
    assert env2.fin["invoices"][-1]["issued_at"] == "2026-10-03" and env2.fin["invoices"][-1]["reference"] == "INV-1031026"


def test_an_unknown_time_zone_falls_back_to_utc():
    from app.modules.agent import business as bz
    assert bz.local_now({"workspace_profile": {"timezone": "Mars/Olympus"}}, NOW).utcoffset() == timedelta(0)
    assert bz.valid_timezone("Europe/London") and not bz.valid_timezone("Mars/Olympus")
    assert bz.local_now({"workspace_profile": {"timezone": "Africa/Lagos"}}, NOW).hour == 10


def test_a_reminder_whose_details_changed_after_a_timeout_is_not_sent_as_a_new_message(short_timeouts):
    """The reminder went out but the answer was lost. An hour later it is one day more overdue,
    so the message would differ: it must not be approved and sent as if it were new."""
    env = Env()
    env.now = datetime(2026, 10, 1, 23, 30, tzinfo=timezone.utc)
    inv = overdue_invoice(env)
    r = followup(env, inv)["run"]
    env.comms.mode = "timeout_after_accept"
    r = env.approve(r)
    assert r["substatus"] == "delivery_status_uncertain" and len(env.comms.sent) == 1
    env.now += timedelta(hours=1)                                           # past midnight: days overdue changed
    r = run(env.orch.retry(r["id"], OWNER))
    assert r["status"] == "succeeded" and len(env.comms.sent) == 1          # found at the provider: recorded, not re-sent
    assert env.pending(r) == [] and len(inv["reminders"]) == 1 and inv["reminders"][0]["message_id"] == "msg-1"

    env2 = Env()                                                            # same, but the email never reached the provider
    env2.now = datetime(2026, 10, 1, 23, 30, tzinfo=timezone.utc)
    inv2 = overdue_invoice(env2)
    r2 = followup(env2, inv2)["run"]
    env2.comms.mode = "timeout_before_accept"
    r2 = env2.approve(r2)
    env2.now += timedelta(hours=1)
    r2 = run(env2.orch.retry(r2["id"], OWNER))
    # Not delivered, and the wording has changed: the current message needs approving, then goes once
    # (same reminder key, so the provider would still de-duplicate it against the first attempt).
    assert env2.pending(r2)[0]["tool_id"] == "send_payment_reminder" and env2.comms.sent == []
    r2 = env2.approve(r2)
    assert r2["status"] == "succeeded" and len(env2.comms.sent) == 1 and len(inv2["reminders"]) == 1
