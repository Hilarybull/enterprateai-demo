"""The Agent's core rule: ask for what is needed, then deliver the thing. Per capability:
(a) a from-scratch request with nothing on record opens the New form (no dead end);
(b) a fully specified request makes the draft with no questions;
(c) a from-source request uses the source;
(d) the draft lands in Needs Approval (or the record is saved, or the answer comes back);
(e) credits are charged once;
(g) a field the records already hold is not asked for.
((f), no route change from the dashboard, is tested in the front end.)"""
import pytest

from app.modules.agent import config, intent
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, quoted, run
from test_dashboard import invoice, operating


def _env(vat=0):
    env = Env()
    cat = env.businesses["A"]["data"]["catalogue"]
    cat["customers"].append({"id": "c6", "name": "QA Round Six Ltd", "email": "qa@six.test", "payment_terms": 30})
    cat["products"].append({"id": "p4", "name": "Bookkeeping", "base_price": 300})
    env.store.policies["A"] = {"default_vat_rate": vat, "contract_route": "direct_invoice"}
    return env


def _empty():
    env = Env()
    env.businesses["A"]["data"]["catalogue"] = {"customers": [], "products": []}
    env.store.policies["A"] = {"contract_route": "direct_invoice"}        # no default VAT either
    return env


def _fields(r):
    return {f["key"]: f for f in r["pending_question"]["fields"]}


def _one(env, r):
    waiting = env.pending(r)
    assert len(waiting) == 1
    return waiting[0]


def _charges(env):
    return [(feature, cost) for _user, feature, cost in env.meter.charges]


# ══ routing ═══════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("said, capability", [
    ("I need a new invoice", "new_invoice"), ("invoice QA Round Six for 2 months bookkeeping", "new_invoice"), ("bill Frank for a workshop", "new_invoice"),
    ("create an invoice", "new_invoice"), ("send an invoice to BrightTech", "new_invoice"),
    ("invoice QUO-2061026", "quote_to_cash"), ("turn the accepted quotation into an invoice", "quote_to_cash"), ("convert my quote to an invoice", "quote_to_cash"),
    ("need a quotation", "enquiry_to_quote"), ("quote Frank for 2 months bookkeeping", "enquiry_to_quote"),
    ("make a contract for BrightTech", "new_contract"), ("I need a service agreement", "new_contract"),
    ("send a receipt", "receipt_send"), ("remind QA Round Six about INV-7", "payment_followup"),
    ("record a payment from QA Round Six", "record_payment"), ("BrightTech has paid INV-3", "record_payment"),
    ("record an expense of £45 for hosting from Fasthosts", "record_expense"), ("add a supplier bill", "supplier_bill"), ("record the bill from Fasthosts", "supplier_bill"),
    ("raise a purchase order for Fasthosts", "new_purchase_order"), ("write a proposal for QA Round Six", "new_proposal"), ("add a supplier called Fasthosts", "add_vendor"),
    ("change the price of Bookkeeping to £350", "update_record"), ("update customer QA Round Six", "update_record"), ("edit the supplier Fasthosts", "update_record"),
    ("update my marketplace profile", "marketplace_profile"), ("unlist Bookkeeping from the marketplace", "marketplace_offering"), ("list Payroll on the marketplace", "marketplace_offering"),
    ("add a customer called Nova Labs", "add_customer"), ("add a new product: Payroll at £120", "add_catalogue_item"),
    ("refund INV-3", "credit_note"), ("I need a credit note for INV-3", "credit_note"),
])
def test_each_request_goes_to_its_own_capability(said, capability):
    assert intent.rule_capability(said, list(WORKFLOWS)) == capability


def test_a_request_about_a_new_customer_in_passing_is_not_taken_as_add_a_customer():
    assert intent.rule_capability("need a quotation for a new customer, Nova Labs", list(WORKFLOWS)) == "enquiry_to_quote"
    assert intent.rule_capability("invoice the new customer for a workshop", list(WORKFLOWS)) == "new_invoice"


def test_several_requests_in_one_message_become_several_tasks():
    env = _env()
    res = env.submit(text="invoice QA Round Six for 2 months bookkeeping and then add a customer called Nova Labs")
    assert res["kind"] == "multi" and [r["run"]["workflow_key"] for r in res["results"]] == ["new_invoice", "add_customer"]


# ══ invoice ═══════════════════════════════════════════════════════════════════

def test_invoice_a_from_scratch_with_nothing_on_record_opens_the_new_form():
    env = _empty()
    res = env.submit(text="I need a new invoice")
    assert res["kind"] == "workflow" and res["run"]["workflow_key"] == "new_invoice" and res["run"]["status"] == "running"      # not "there is nothing to invoice"
    f = _fields(res["run"])
    assert list(f) == ["customer_name", "customer_email", "items", "discount", "due_date", "notes", "vat_rate", "save_vat_default"]      # one form, everything that is missing
    assert f["due_date"]["default"] == "2026-10-15" and not f["discount"].get("required")      # dates and terms come filled in from settings
    r = run(env.orch.provide_input(res["run"]["id"], OWNER, {
        "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "vat_rate": 0, "items": [{"name": "Consulting day", "quantity": 2, "unit_price": 450}]}))
    assert r["status"] == "awaiting_approval"                              # finished without further prompts
    a = _one(env, r)
    assert a["tool_id"] == "send_invoice" and (a["payload"]["customer_name"], a["payload"]["to_email"], a["payload"]["total"]) == ("Nova Labs", "dana@novalabs.test", 900)
    assert [c["name"] for c in env.businesses["A"]["data"]["catalogue"]["customers"]] == ["Nova Labs"]


def test_invoice_b_a_fully_specified_request_needs_no_questions_and_is_charged_once():
    env = _env()
    r = env.submit(text="invoice QA Round Six for 2 months bookkeeping")["run"]
    assert r["status"] == "awaiting_approval" and r["pending_question"] is None
    a = _one(env, r)
    p = a["payload"]
    assert (p["customer_name"], p["to_email"], p["total"]) == ("QA Round Six Ltd", "qa@six.test", 600)      # 2 × £300
    assert [(i["description"], i["qty"], i["unit_price"]) for i in p["items"]] == [("Bookkeeping", 2, 300)]
    assert p["payment_terms"] == "Net 30 days"                             # the customer's own terms, not asked for
    inv = env.fin["invoices"][0]
    assert inv["status"] == "draft" and inv["reference"] == p["reference"] and not env.comms.sent      # nothing is sent until approved
    assert _charges(env) == [("agent_invoice_draft", 2)]
    done = env.approve(r)
    assert done["status"] == "succeeded" and done["summary"] == f"Invoice {p['reference']} was sent to qa@six.test."
    assert _charges(env) == [("agent_invoice_draft", 2), ("agent_send", 2)] and len(env.comms.sent) == 1      # each once
    run(env.orch.advance(r["id"]))
    assert len(env.fin["invoices"]) == 1 and len(env.comms.sent) == 1 and len(_charges(env)) == 2


def test_invoice_c_from_a_quotation_uses_it_and_quote_to_cash_still_works():
    env = _env(vat=20)
    quoted(env)
    q = env.fin["quotes"][0]
    q["status"] = "accepted"
    # Pointed at by its reference: the existing convert path.
    assert intent.rule_capability(f"invoice {q['reference']}", list(WORKFLOWS)) == "quote_to_cash"
    r = env.submit(capability="quote_to_cash", params={"quote_id": q["id"]}, channel="ui_action")["run"]
    assert r["workflow_key"] == "quote_to_cash" and _one(env, r)["payload"]["quote_reference"] == q["reference"]
    # A plain "new invoice" offers that quotation as a starting point, and "New".
    other = _env(vat=20)
    quoted(other)
    oq = other.fin["quotes"][0]
    oq["status"] = "accepted"
    asked = other.submit(text="I need a new invoice")["run"]
    start = _fields(asked)["start_from"]
    assert [o["value"] for o in start["options"]] == ["new", oq["id"]] and start["default"] == "new"
    assert _fields(asked)["customer_id"]["show_if"] == {"start_from": "new"}      # the rest only applies to a new one
    r2 = run(other.orch.provide_input(asked["id"], OWNER, {"start_from": oq["id"]}))
    assert r2["status"] == "awaiting_approval" and _one(other, r2)["payload"]["total"] == 3600 and other.fin["invoices"][0]["quote_id"] == oq["id"]


def test_invoice_g_only_what_the_records_do_not_hold_is_asked_for():
    env = _env()
    asked = env.submit(text="invoice QA Round Six")["run"]                 # the customer is on record; only the items are missing
    assert list(_fields(asked)) == ["items", "discount", "due_date", "notes"]      # the items, with the optional extras beside them
    assert {"id": "p4", "name": "Bookkeeping", "unit_price": 300} in _fields(asked)["items"]["catalogue"]
    asked = env.submit(text="I need an invoice for 3 months bookkeeping")["run"]      # the items are in the catalogue; only the customer is missing
    f = _fields(asked)
    assert list(f) == ["customer_id", "customer_name", "customer_email"] and "vat_rate" not in f
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6"}))
    assert r["status"] == "awaiting_approval" and _one(env, r)["payload"]["total"] == 900


def test_quote_to_invoice_with_no_quotation_starts_a_new_invoice_instead_of_a_dead_end():
    env = _env()
    res = env.submit(capability="quote_to_cash", channel="ui_action")      # the "Quote to Invoice" shortcut, nothing to convert
    assert res["kind"] == "workflow" and res["run"]["workflow_key"] == "new_invoice" and res["run"]["pending_question"]
    assert "no accepted quotations" not in str(res).lower()


# ══ contract ══════════════════════════════════════════════════════════════════

def test_contract_from_scratch_asks_once_then_waits_for_approval():
    env = _env()
    asked = env.submit(text="make a contract for QA Round Six")["run"]
    f = _fields(asked)
    assert list(f) == ["description", "total", "term", "start_date"]      # the customer is on record: not asked for
    assert f["start_date"]["default"] == "2026-10-01"                      # today, filled in
    r = run(env.orch.provide_input(asked["id"], OWNER, {"description": "Monthly bookkeeping and a quarterly review.", "total": 3600, "term": "12 months", "start_date": "2026-11-01"}))
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    p = a["payload"]
    assert a["tool_id"] == "send_contract" and (p["customer_name"], p["to_email"], p["total"], p["term"], p["start_date"]) == ("QA Round Six Ltd", "qa@six.test", 3600, "12 months", "2026-11-01")
    assert _charges(env) == [("agent_contract_draft", 2)]
    done = env.approve(r)
    assert done["status"] == "succeeded" and "Term: 12 months" in env.comms.sent[-1]["text"] and "acceptance of quotation" not in env.comms.sent[-1]["text"]
    assert _charges(env) == [("agent_contract_draft", 2), ("agent_send", 2)]


def test_contract_with_nothing_on_record_opens_the_new_form_and_an_accepted_quotation_is_offered():
    env = _empty()
    f = _fields(env.submit(text="I need a service agreement")["run"])
    assert list(f) == ["customer_name", "customer_email", "description", "total", "term", "start_date"]
    other = _env(vat=20)
    quoted(other)
    q = other.fin["quotes"][0]
    q["status"] = "accepted"
    asked = other.submit(text="I need a contract")["run"]
    assert [o["value"] for o in _fields(asked)["start_from"]["options"]] == ["new", q["id"]]
    r = run(other.orch.provide_input(asked["id"], OWNER, {"start_from": q["id"]}))
    assert r["status"] == "awaiting_approval" and _one(other, r)["payload"]["quote_reference"] == q["reference"]


# ══ receipt ═══════════════════════════════════════════════════════════════════

def test_receipt_with_no_payment_on_record_records_the_payment_in_the_same_form_then_prepares_the_receipt():
    env = _env()
    operating(env)
    inv = invoice(env, "open1", "QA Round Six Ltd", 600, paid=False, due_in=10)
    res = env.submit(text="send a receipt")
    assert res["kind"] == "workflow" and res["run"]["status"] == "running"      # not "no confirmed payments waiting"
    f = _fields(res["run"])
    assert list(f) == ["invoice_id", "amount", "paid_at", "method"] and f["invoice_id"]["default"] == inv["id"] and f["paid_at"]["default"] == "2026-10-01"
    r = run(env.orch.provide_input(res["run"]["id"], OWNER, {"invoice_id": inv["id"], "paid_at": "2026-10-01", "method": "Bank transfer"}))
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    assert a["tool_id"] == "send_receipt" and a["payload"]["amount"] == 600      # blank amount: the full amount outstanding
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    assert len(stored["payments"]) == 1 and stored["status"] == "paid"
    env.approve(r)
    assert len(next(i for i in env.fin["invoices"] if i["id"] == inv["id"])["payments"]) == 1      # the payment is recorded once


def test_receipt_with_a_payment_on_record_asks_nothing_and_with_no_invoices_offers_the_one_step():
    env = _env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "QA Round Six Ltd", "customer_email": "qa@six.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    r = env.submit(text="send a receipt")["run"]
    assert r["status"] == "awaiting_approval" and _one(env, r)["tool_id"] == "send_receipt"
    none = _empty().submit(text="send a receipt")
    assert none["kind"] == "answer" and none["actions"] == [{"label": "Start a new invoice", "capability": "new_invoice"}]


# ══ reminder ══════════════════════════════════════════════════════════════════

def test_reminder_when_nothing_is_overdue_sends_a_due_soon_reminder_for_an_unpaid_invoice():
    env = _env()
    operating(env)
    inv = invoice(env, "soon1", "QA Round Six Ltd", 600, paid=False, due_in=5)
    res = env.submit(text="send a payment reminder")
    assert res["kind"] == "workflow"                                       # not "no overdue invoices are eligible"
    r = res["run"]
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    assert a["tool_id"] == "send_payment_reminder" and a["payload"]["upcoming"] is True and a["payload"]["days_until_due"] == 5
    env.approve(r)
    mail = env.comms.sent[-1]
    assert mail["subject"].startswith("Payment due soon") and "due in 5 days" in mail["text"] and "overdue" not in mail["text"].lower()
    assert _charges(env) == [("agent_reminder", 2)]
    # Several not yet due: the owner picks, and the "due soon" choice travels with the answer.
    two = _env()
    operating(two)
    invoice(two, "s1", "QA Round Six Ltd", 600, paid=False, due_in=5)
    invoice(two, "s2", "BrightTech Ltd", 200, paid=False, due_in=9)
    ask = two.submit(text="send a payment reminder")
    assert ask["kind"] == "needs_input" and ask["params"] == {"upcoming": True} and len(ask["fields"][0]["options"]) == 2
    assert _empty().submit(text="send a payment reminder")["actions"] == [{"label": "Start a new invoice", "capability": "new_invoice"}]
    assert inv


# ══ records: one confirmation, then saved ═════════════════════════════════════

def test_add_a_customer_shows_what_it_understood_for_a_yes_then_saves():
    env = _env()
    asked = env.submit(text="add a customer called Nova Labs, dana@novalabs.test")["run"]
    f = _fields(asked)
    assert asked["pending_question"]["question"] == "Is this right?" and (f["customer_name"]["default"], f["customer_name"]["confirm"], f["customer_email"]["default"]) == ("Nova Labs", True, "dana@novalabs.test")
    done = run(env.orch.provide_input(asked["id"], OWNER, {"customer_name": "Nova Labs", "customer_email": "dana@novalabs.test"}))
    assert done["status"] == "succeeded" and done["summary"] == "Saved: Nova Labs is now a customer." and env.pending(done) == []
    saved = next(c for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["name"] == "Nova Labs")
    assert saved["email"] == "dana@novalabs.test" and _charges(env) == [("agent_task", 2)]      # the task price, once
    again = env.submit(text="add a customer called Nova Labs")["run"]       # the same name again brings the record up to date
    done = run(env.orch.provide_input(again["id"], OWNER, {"customer_name": "Nova Labs", "customer_email": "accounts@novalabs.test"}))
    assert done["summary"] == "Saved: Nova Labs is up to date."
    assert [c["email"] for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["name"] == "Nova Labs"] == ["accounts@novalabs.test"]


def test_add_a_catalogue_item_and_then_invoice_for_it_with_no_questions():
    env = _env()
    asked = env.submit(text="add a new product: Payroll at £120")["run"]
    f = _fields(asked)
    assert (f["name"]["default"], f["price"]["default"]) == ("Payroll", 120)
    done = run(env.orch.provide_input(asked["id"], OWNER, {"name": "Payroll", "price": 120}))
    assert done["status"] == "succeeded" and done["summary"] == "Saved: Payroll is in your catalogue at £120.00."
    r = env.submit(text="invoice QA Round Six for 3 months payroll")["run"]
    assert r["status"] == "awaiting_approval" and _one(env, r)["payload"]["total"] == 360


def test_record_a_payment_prefills_the_invoice_and_amount_and_saves_on_confirm():
    env = _env()
    operating(env)
    inv = invoice(env, "open1", "QA Round Six Ltd", 600, paid=False, due_in=10)
    asked = env.submit(text="record a payment of £250 from QA Round Six")["run"]
    f = _fields(asked)
    assert (f["invoice_id"]["default"], f["amount"]["default"]) == (inv["id"], 250)
    done = run(env.orch.provide_input(asked["id"], OWNER, {"invoice_id": inv["id"], "amount": 250, "paid_at": "2026-10-01", "method": "Card"}))
    assert done["status"] == "succeeded" and done["summary"].startswith("Saved: £250.00 received against") and done["summary"].endswith("£350.00 is still outstanding.")
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    assert [p["amount"] for p in stored["payments"]] == [250]
    nothing = _empty().submit(text="record a payment")["run"]
    assert nothing["status"] == "succeeded" and nothing["next_action"] == "Ask me for a new invoice and I'll prepare it."      # the one step that unblocks it


def test_record_an_expense_reads_the_supplier_amount_and_reason_from_the_request():
    env = _env()
    asked = env.submit(text="record an expense of £45 for hosting from Fasthosts")["run"]
    f = _fields(asked)
    assert (f["vendor_name"]["default"], f["description"]["default"], f["amount"]["default"], f["date"]["default"]) == ("Fasthosts", "hosting", 45, "2026-10-01")
    done = run(env.orch.provide_input(asked["id"], OWNER, {"vendor_name": "Fasthosts", "description": "hosting", "amount": 45, "date": "2026-10-01", "paid": "yes"}))
    assert done["status"] == "succeeded" and done["summary"].startswith("Saved: £45.00 to Fasthosts for hosting (EXP-")
    e = env.fin["expenses"][-1]
    assert (e["vendor_name"], e["total_amount"], e["status"], e["date"]) == ("Fasthosts", 45, "paid", "2026-10-01")


def bz_hold(env, invoice_id):
    from app.modules.agent import business as bz
    return (bz.invoice_hold(next(i for i in env.fin["invoices"] if i["id"] == invoice_id)) or {}).get("state")


# ══ settings ══════════════════════════════════════════════════════════════════

def test_settings_list_every_capability_with_its_plan_cost_and_automatic_switch(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    env = _env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            listed = {c["capability"]: c for c in client.get("/businesses/A/agent/policy").json()["capabilities"]}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert set(listed) == set(WORKFLOWS) == set(config.CAPABILITY_MIN_PLAN)
    assert all(c["minimum_plan_label"] in ("Explorer", "Starter") and c["credits"] and isinstance(c["automatic"], list) for c in listed.values())
    assert listed["new_invoice"]["credits"] == "2 credits to prepare the invoice, 2 when it is sent" and listed["new_invoice"]["needs_approval"] is True
    assert listed["add_customer"]["credits"] == "2 credits" and listed["add_customer"]["automatic"] == [] and listed["add_customer"]["needs_approval"] is False
    assert listed["payment_followup"]["automatic"] and all({"key", "label", "on"} <= set(a) for a in listed["payment_followup"]["automatic"])


def test_an_invoice_started_from_a_quotation_in_the_new_invoice_form_is_followed_until_it_is_paid_and_receipted():
    """Picked under "Start from": after it is sent it gets the payment monitoring the full quote-to-invoice task gives."""
    from datetime import timedelta
    env = _env(vat=20)
    quoted(env)
    q = env.fin["quotes"][0]
    q["status"] = "accepted"
    asked = env.submit(text="I need a new invoice")["run"]
    r = run(env.orch.provide_input(asked["id"], OWNER, {"start_from": q["id"]}))
    sent = env.approve(r)
    # Sent, and still open: waiting for payment, not finished.
    assert sent["workflow_key"] == "new_invoice" and sent["status"] == "running" and sent["substatus"] == "waiting_for_external_event"
    assert sent["current_step"] == "monitor" and "Waiting for payment" in sent["next_action"] and sent["wake_at"]
    inv = env.fin["invoices"][0]
    assert inv["quote_id"] == q["id"] and inv["status"] != "draft"
    # Overdue past the first reminder day: a reminder is prepared for approval, as Quote to Cash does.
    due = __import__("datetime").date.fromisoformat(str(inv["due_date"])[:10])
    env.now = env.now.replace(year=due.year, month=due.month, day=due.day) + timedelta(days=4)
    chased = run(env.orch.advance(r["id"]))
    assert chased["status"] == "awaiting_approval" and _one(env, chased)["tool_id"] == "send_payment_reminder"
    env.approve(chased)
    assert len(env.fin["invoices"][0]["reminders"]) == 1
    # Paid: the receipt is prepared, and once it is sent the sale is closed.
    env.fin["invoices"][0].setdefault("payments", []).append({"id": "pay1", "amount": inv["total_amount"], "paid_at": env.now.isoformat()})
    env.fin["invoices"][0]["status"] = "paid"
    receipted = run(env.orch.advance(r["id"]))
    assert receipted["status"] == "awaiting_approval" and _one(env, receipted)["tool_id"] == "send_receipt"
    closed = env.approve(receipted)
    assert closed["status"] == "succeeded" and "paid in full and receipted" in closed["summary"]
    # A brand-new invoice (no quotation) is unchanged: finished once sent; overdue ones are picked up by automatic follow-up.
    fresh = _env()
    done = fresh.approve(fresh.submit(text="invoice QA Round Six for 2 months bookkeeping")["run"])
    assert done["status"] == "succeeded" and done["next_action"] == "I'll remind them if it becomes overdue."
