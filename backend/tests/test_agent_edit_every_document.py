"""Every document waiting for approval can be edited: quotations (with a discount and free lines),
invoices, contracts, payment reminders and receipts. An edit cancels the approval that was waiting
and asks again on a new version. A background task left mid-step by a restart is picked up."""
from datetime import timedelta

import pytest

from app.modules.agent import router as agent_router
from app.modules.agent.orchestrator import Conflict
from test_agent import OWNER, Env, quoted, run
from test_dashboard import invoice, operating


def _one(env, r):
    waiting = env.pending(r)
    assert len(waiting) == 1
    return waiting[0]


def _last_edit(env, r):
    return agent_router._public_run(run(env.store.get_run(r["id"])))["last_edit"]


def _frank(env):
    cat = env.businesses["A"]["data"]["catalogue"]
    cat["customers"].append({"id": "c2", "name": "Frank", "email": "frank@frank.test"})
    cat["products"].append({"id": "p4", "name": "Bookkeeping", "base_price": 200})
    return env


def test_a_quotation_takes_a_discount_and_a_free_line_and_the_customer_sees_the_discount():
    env = _frank(Env())
    r = env.submit(text="quote Frank for 2 months bookkeeping")["run"]
    r = run(env.orch.edit_draft(r["id"], OWNER, {
        "discount": {"type": "percent", "value": 10},
        "items": [{"product_id": "p4", "name": "Bookkeeping", "quantity": 2, "unit_price": 200}, {"name": "Onboarding call", "quantity": 1, "unit_price": 0}]}))
    a = _one(env, r)
    p = a["payload"]
    assert (p["subtotal"], p["discount_amount"], p["discount_label"], p["vat_amount"], p["total"]) == (400, 40, "Discount (10%)", 72, 432)
    assert [(i["description"], i["unit_price"]) for i in p["items"]] == [("Bookkeeping", 200), ("Onboarding call", 0)]      # a free line is allowed
    assert "Discount £0.00 → £40.00" in _last_edit(env, r)["changes"]
    with pytest.raises(Conflict):                                         # but the quotation must come to more than 0
        run(env.orch.edit_draft(r["id"], OWNER, {"items": [{"name": "Onboarding call", "quantity": 1, "unit_price": 0}]}))
    with pytest.raises(Conflict):
        run(env.orch.edit_draft(r["id"], OWNER, {"discount": {"type": "percent", "value": 140}}))
    sent = env.approve(r)
    assert sent["status"] == "succeeded"
    mail = env.comms.sent[-1]
    assert "Discount (10%): -£40.00" in mail["text"] and "Total: £432.00" in mail["text"]      # the customer sees the discount line
    # Taking the discount off again is an edit like any other.
    r2 = env.submit(text="quote Frank for 1 month bookkeeping")["run"]
    r2 = run(env.orch.edit_draft(r2["id"], OWNER, {"discount": {"type": "amount", "value": 50}}))
    assert _one(env, r2)["payload"]["total"] == 180                       # (200 - 50) + 20%
    r2 = run(env.orch.edit_draft(r2["id"], OWNER, {"discount": {"type": "amount", "value": 0}}))
    assert "discount_amount" not in _one(env, r2)["payload"] and _one(env, r2)["payload"]["total"] == 240


def _to_invoice(env):
    """An accepted quotation taken as far as the invoice waiting for approval."""
    quoted(env)
    q = env.fin["quotes"][0]
    q["status"] = "accepted"
    r = env.submit(capability="quote_to_cash", params={"quote_id": q["id"]}, channel="ui_action")["run"]
    assert r["status"] == "awaiting_approval" and _one(env, r)["tool_id"] == "send_invoice"
    return r


def test_an_invoice_waiting_for_approval_can_be_edited_and_must_be_approved_again():
    env = Env()
    r = _to_invoice(env)
    first = _one(env, r)
    assert first["payload"]["total"] == 3600                              # 2 × 1,500 + 20%
    r = run(env.orch.edit_draft(r["id"], OWNER, {
        "items": [{"name": "Strategy Workshop", "quantity": 3, "unit_price": 1500}], "discount": {"type": "amount", "value": 500},
        "due_date": "2026-11-20", "payment_terms_days": 30, "customer_email": "accounts@brighttech.test"}))
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    assert a["id"] != first["id"] and a["payload_version"] == first["payload_version"] + 1
    assert run(env.store.get_approval(first["id"]))["status"] == "superseded"
    p = a["payload"]
    assert (p["total"], p["discount_amount"], p["due_date"], p["payment_terms"], p["to_email"]) == (4800, 500, "2026-11-20", "Net 30 days", "accounts@brighttech.test")
    inv = env.fin["invoices"][0]
    assert (inv["total_amount"], inv["due_date"]) == (4800, "2026-11-20")       # the invoice itself, not only what is shown
    changes = _last_edit(env, r)["changes"]
    assert "Qty 2 → 3 on Strategy Workshop" in changes and "Due date" in changes and changes.endswith("total £3,600.00 → £4,800.00")
    for bad in ({"items": []}, {"due_date": "2020-01-01"}, {"vat_rate": 140}, {"customer_email": "nope"}):
        with pytest.raises(Conflict):
            run(env.orch.edit_draft(r["id"], OWNER, bad))
    assert _one(env, r)["id"] == a["id"]                                  # a refused edit changes nothing
    done = env.approve(r)
    assert "4,800.00" in env.comms.sent[-1]["text"] and done["status"] != "failed"
    from app.modules.agent import documents
    assert "Discount" in documents.invoice_email(p)["html"] and "-£500.00" in documents.invoice_email(p)["html"]      # shown in the invoice's totals


def test_a_contract_waiting_for_approval_can_have_its_scope_value_and_terms_changed():
    env = Env()
    env.store.policies["A"] = {"default_vat_rate": 20, "contract_route": "contract_first"}
    quoted(env)
    q = env.fin["quotes"][0]
    q["status"] = "accepted"
    r = env.submit(capability="quote_to_cash", params={"quote_id": q["id"]}, channel="ui_action")["run"]
    first = _one(env, r)
    assert first["tool_id"] == "send_contract"
    r = run(env.orch.edit_draft(r["id"], OWNER, {"description": "Two strategy workshops, delivered on site in November.", "total": 3900, "payment_terms_days": 7}))
    a = _one(env, r)
    p = a["payload"]
    assert a["payload_version"] == first["payload_version"] + 1
    assert (p["description"], p["total"], p["payment_terms"]) == ("Two strategy workshops, delivered on site in November.", 3900, "Net 7 days")
    assert "Scope changed" in _last_edit(env, r)["changes"] and "total £3,600.00 → £3,900.00" in _last_edit(env, r)["changes"]
    with pytest.raises(Conflict):
        run(env.orch.edit_draft(r["id"], OWNER, {"total": 0}))


def test_a_payment_reminder_takes_the_owners_wording_and_the_amount_asked_for():
    env = Env()
    operating(env)
    inv = invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8)
    r = env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    first = _one(env, r)
    assert first["tool_id"] == "send_payment_reminder" and "message" not in first["payload"]
    r = run(env.orch.edit_draft(r["id"], OWNER, {"message": "We know things are busy. Could you pay half this week?", "amount_requested": 74.5,
                                               "customer_email": "pay@aftred.test"}))
    a = _one(env, r)
    p = a["payload"]
    assert a["payload_version"] == first["payload_version"] + 1 and run(env.store.get_approval(first["id"]))["status"] == "superseded"
    assert (p["message"], p["amount_requested"], p["outstanding"], p["to_email"]) == ("We know things are busy. Could you pay half this week?", 74.5, 149, "pay@aftred.test")
    changes = _last_edit(env, r)["changes"]
    assert "Wording changed" in changes and "Amount asked for £149.00 → £74.50" in changes
    with pytest.raises(Conflict):                                         # never more than is owed
        run(env.orch.edit_draft(r["id"], OWNER, {"amount_requested": 500}))
    env.approve(r)
    mail = env.comms.sent[-1]
    assert mail["to"] == "pay@aftred.test" and "Could you pay half this week?" in mail["text"] and "Amount requested now: £74.50" in mail["text"]
    from app.modules.agent import documents
    assert "Could you pay half this week?" in documents.reminder_email(p)["html"]
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    assert stored.get("customer_email") != "pay@aftred.test"              # another address for this message only


def test_a_receipt_takes_a_note_and_another_address_but_never_a_different_amount():
    env = Env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    r = env.submit(capability="receipt_send", params={"invoice_id": "i2"}, channel="ui_action")["run"]
    first = _one(env, r)
    r = run(env.orch.edit_draft(r["id"], OWNER, {"message": "Thank you for paying so promptly.", "amount_requested": 1, "total": 1}))
    a = _one(env, r)
    assert a["payload_version"] == first["payload_version"] + 1 and a["payload"]["message"] == "Thank you for paying so promptly."
    assert a["payload"]["amount"] == 300 and "amount_requested" not in a["payload"]      # what was received is a fact
    env.approve(r)
    assert "Thank you for paying so promptly." in env.comms.sent[-1]["text"]


def test_every_approval_says_whether_it_can_be_edited_and_as_what(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = Env()
    r = _to_invoice(env)
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            shown = client.get(f"/workflow-runs/{r['id']}").json()
            assert shown["can"]["edit_draft"] is True and shown["draft_options"]["document"] == "invoice"
            assert {"id": "p1", "name": "Strategy Workshop", "unit_price": 1500} in shown["draft_options"]["catalogue"]
            saved = client.post(f"/workflow-runs/{r['id']}/draft", json={"due_date": "2026-12-01"})
            assert saved.status_code == 200 and saved.json()["run"]["status"] == "awaiting_approval"
            again = client.get(f"/workflow-runs/{r['id']}").json()
            assert again["run"]["last_edit"]["changes"].startswith("Due date") and again["draft_options"]["edited_by_you"] is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_a_background_task_left_mid_step_by_a_restart_is_picked_up_when_it_is_next_looked_at(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = _frank(Env())
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    real = env.orch.advance_later
    try:
        with TestClient(app) as client:
            monkeypatch.setattr(env.orch, "advance_later", lambda *a, **k: None)      # the server stops before it gets going
            started = client.post("/agent/requests", json={"business_id": "A", "text": "need a quotation", "background": True}).json()["run"]
            run_id = started["id"]
            assert client.get(f"/workflow-runs/{run_id}").json()["run"]["pending_question"] is None      # nothing is carrying it on
            monkeypatch.setattr(env.orch, "advance_later", real)
            assert client.get(f"/workflow-runs/{run_id}").json()["run"]["pending_question"] is None      # too soon: it may just be busy
            from datetime import datetime, timezone
            env.now = datetime.now(timezone.utc) + timedelta(minutes=2)                                 # a minute and a half with no change
            client.get(f"/workflow-runs/{run_id}")                                                      # seen to be abandoned: picked up
            shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
            assert shown["pending_question"]["question"] == "Who is this quotation for, and what should it include?"
            assert "picked_up" in env.audit_types({"id": run_id})
            env.now = env.now + timedelta(minutes=5)                                                    # waiting for an answer is not abandoned
            client.get(f"/workflow-runs/{run_id}")
            assert env.audit_types({"id": run_id}).count("picked_up") == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
