"""Ask for what is needed, then deliver: proposals, purchase orders, credit notes (in part or in
full, with any refund, sent to the customer), supplier bills, suppliers, changing a record that
is already there, the Marketplace profile and its offerings, and the extra fields on the
from-scratch forms. For each: (a) nothing on record opens the form or names the one step,
(b) fully answered goes straight through, (c) a source on record is used, (d) the result lands in
Needs Approval or is saved, (e) credits once, (g) what the records hold is not asked for."""
import pytest

from app.modules.agent import business as bz
from app.modules.agent import config
from app.modules.agent.orchestrator import Conflict
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run
from test_dashboard import invoice, operating


def _env(vat=0):
    env = Env()
    cat = env.businesses["A"]["data"]["catalogue"]
    cat["customers"].append({"id": "c6", "name": "QA Round Six Ltd", "email": "qa@six.test", "payment_terms": 30})
    cat["products"].append({"id": "p4", "name": "Bookkeeping", "base_price": 300})
    cat["vendors"] = [{"id": "v1", "name": "Fasthosts", "email": "billing@fasthosts.test"}]
    env.store.policies["A"] = {"default_vat_rate": vat, "contract_route": "direct_invoice"}
    return env


def _empty():
    env = Env()
    env.businesses["A"]["data"]["catalogue"] = {"customers": [], "products": [], "vendors": []}
    env.store.policies["A"] = {"contract_route": "direct_invoice"}
    return env


def _fields(r):
    return {f["key"]: f for f in r["pending_question"]["fields"]}


def _one(env, r):
    waiting = env.pending(r)
    assert len(waiting) == 1
    return waiting[0]


def _charges(env):
    return [(feature, cost) for _user, feature, cost in env.meter.charges]


def _answer(env, r, answers):
    return run(env.orch.provide_input(r["id"], OWNER, answers))


# ══ proposal ══════════════════════════════════════════════════════════════════

def test_proposal_from_scratch_asks_once_offers_what_is_known_and_waits_for_approval():
    env = _env()
    env.businesses["A"]["data"]["workspace_profile"]["problem"] = "Owners lose evenings to paperwork"
    asked = env.submit(text="write a proposal for QA Round Six for £4,500")["run"]
    f = _fields(asked)
    assert list(f) == ["problem", "solution", "total", "timeline", "valid_until"]      # (g) the customer is on record: not asked for
    assert f["problem"]["default"] == "Owners lose evenings to paperwork" and f["total"]["default"] == 4500 and f["valid_until"]["default"] == "2026-10-31"
    r = _answer(env, asked, {"problem": "Month-end takes them a week.", "solution": "We take over bookkeeping and month-end.", "total": 4500, "timeline": "Live in 3 weeks"})
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    p = a["payload"]
    assert a["tool_id"] == "send_proposal" and (p["customer_name"], p["to_email"], p["total"], p["timeline"]) == ("QA Round Six Ltd", "qa@six.test", 4500, "Live in 3 weeks")
    assert env.fin["proposals"][0]["status"] == "draft" and not env.comms.sent and _charges(env) == []      # preparing it is free; nothing is sent yet
    done = env.approve(r)
    assert done["status"] == "succeeded" and done["summary"] == f"Proposal {p['reference']} was sent to qa@six.test."
    mail = env.comms.sent[-1]
    assert "We take over bookkeeping and month-end." in mail["text"] and "Price: £4,500.00" in mail["text"]
    assert _charges(env) == [("agent_send", 2)] and env.fin["proposals"][0]["status"] == "sent"
    run(env.orch.advance(r["id"]))
    assert len(env.fin["proposals"]) == 1 and len(env.comms.sent) == 1      # (e) once


def test_proposal_with_nothing_on_record_opens_the_new_form_and_a_request_for_one_is_no_longer_turned_away():
    f = _fields(_empty().submit(text="I need a proposal")["run"])
    assert list(f) == ["customer_name", "customer_email", "problem", "solution", "total", "timeline", "valid_until"]
    env = _env()
    by_name = env.submit(capability="proposal", channel="ui_action")      # the old name for it
    assert by_name["kind"] == "workflow" and by_name["run"]["workflow_key"] == "new_proposal"
    assert "new_proposal" in WORKFLOWS and "Business Blueprints" not in str(by_name)


# ══ purchase order ════════════════════════════════════════════════════════════

def test_purchase_order_for_a_supplier_on_record_asks_only_for_the_items():
    env = _env()
    asked = env.submit(text="raise a purchase order for Fasthosts")["run"]
    assert list(_fields(asked)) == ["items", "delivery_date", "notes"]      # (g) the supplier and their address are on record
    r = _answer(env, asked, {"items": [{"name": "Dedicated server", "quantity": 2, "unit_price": 80}], "delivery_date": "2026-10-20", "notes": "Deliver to the office."})
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    p = a["payload"]
    assert a["tool_id"] == "send_purchase_order" and (p["customer_name"], p["to_email"], p["total"], p["delivery_date"]) == ("Fasthosts", "billing@fasthosts.test", 160, "2026-10-20")
    done = env.approve(r)
    assert done["summary"] == f"Purchase order {p['reference']} was sent to billing@fasthosts.test." and "Dedicated server x 2" in env.comms.sent[-1]["text"]
    assert _charges(env) == [("agent_send", 2)] and env.fin["purchase_orders"][0]["status"] == "sent"


def test_purchase_order_with_no_suppliers_takes_a_new_one_in_the_same_form_and_saves_them():
    env = _empty()
    asked = env.submit(text="I need a purchase order")["run"]
    assert list(_fields(asked)) == ["vendor_name", "vendor_email", "items", "delivery_date", "notes"]
    r = _answer(env, asked, {"vendor_name": "Paper Co", "vendor_email": "sales@paperco.test", "items": [{"name": "A4 paper", "quantity": 10, "unit_price": 4.5}]})
    assert r["status"] == "awaiting_approval" and _one(env, r)["payload"]["total"] == 45
    assert [v["name"] for v in env.businesses["A"]["data"]["catalogue"]["vendors"]] == ["Paper Co"]


# ══ credit note ═══════════════════════════════════════════════════════════════

def _sent_invoice(env, total=600, paid=0):
    operating(env)
    inv = invoice(env, "c1", "QA Round Six Ltd", total, paid=False, due_in=-3)
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    stored["customer_email"] = "qa@six.test"
    if paid:
        stored["payments"] = [{"id": "pay1", "amount": paid, "paid_at": env.now.isoformat(), "receipt": {"number": "REC-1", "sent_at": env.now.isoformat()}}]
    return stored


def test_a_partial_credit_note_is_sent_to_the_customer_and_comes_off_what_is_owed():
    env = _env()
    inv = _sent_invoice(env, 600)
    ref = inv["reference"]
    asked = env.submit(text=f"I need a credit note for {ref} of £150")["run"]
    f = _fields(asked)
    assert list(f) == ["invoice_id", "amount", "reason", "refund_amount"] and (f["invoice_id"]["default"], f["amount"]["default"]) == (inv["id"], 150)
    r = _answer(env, asked, {"invoice_id": inv["id"], "amount": 150, "reason": "Two hours not delivered"})
    assert r["status"] == "awaiting_approval"
    a = _one(env, r)
    p = a["payload"]
    assert a["tool_id"] == "send_credit_note" and (p["total"], p["invoice_reference"], p["reason"], p["full_credit"]) == (150, ref, "Two hours not delivered", False)
    assert bz.invoice_outstanding(inv) == 600                              # nothing changes until it is approved and sent
    done = env.approve(r)
    assert done["status"] == "succeeded" and done["summary"] == f"Credit note {p['reference']} was sent to qa@six.test."
    mail = env.comms.sent[-1]
    assert mail["subject"].startswith("Credit note") and f"£150.00 has been taken off invoice {ref}." in mail["text"] and "Reason: Two hours not delivered" in mail["text"]
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    assert bz.invoice_outstanding(stored) == 450 and bz.invoice_hold(stored) is None      # still owed, less the credit; still chased
    assert _charges(env) == [("agent_send", 2)]
    # A second note can't credit more than is left.
    again = env.submit(text=f"credit note for {ref}")["run"]
    still = _answer(env, again, {"invoice_id": inv["id"], "amount": 500, "reason": "Too much"})
    assert still["status"] == "running" and still["pending_question"]["question"].startswith("The credit must be above 0 and no more than £450.00.")


def test_a_full_credit_note_with_a_refund_closes_the_invoice_and_tells_the_customer_the_refund_is_coming():
    env = _env()
    inv = _sent_invoice(env, 600, paid=200)
    asked = env.submit(text=f"refund {inv['reference']}")["run"]
    bad = _answer(env, asked, {"invoice_id": inv["id"], "reason": "Cancelled", "refund_amount": 300})
    assert "can't be more than the credit or than the £200.00 they have paid" in bad["pending_question"]["question"]
    r = _answer(env, asked, {"invoice_id": inv["id"], "reason": "Cancelled by agreement", "refund_amount": 200})      # blank amount: in full
    p = _one(env, r)["payload"]
    assert (p["total"], p["refund_amount"], p["full_credit"]) == (600, 200, True)
    env.approve(r)
    assert "is credited in full: nothing more is due on it. £200.00 will be refunded to you." in env.comms.sent[-1]["text"]
    stored = next(i for i in env.fin["invoices"] if i["id"] == inv["id"])
    assert bz.invoice_hold(stored)["state"] == "credited"
    chase = env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    assert chase["status"] != "awaiting_approval"                          # never chased again


def test_a_credit_note_with_no_invoice_names_the_one_step():
    r = _empty().submit(text="I need a credit note")["run"]
    assert r["status"] == "succeeded" and r["next_action"] == "Ask me for a new invoice and I'll prepare it." and "can't" not in r["summary"]


# ══ supplier bill and suppliers ═══════════════════════════════════════════════

def test_a_supplier_bill_is_its_own_record_with_its_lines_and_due_date():
    env = _env()
    asked = env.submit(text="record the bill from Fasthosts for £96")["run"]
    f = _fields(asked)
    assert list(f) == ["vendor_name", "reference", "items", "date", "due_date"] and f["vendor_name"]["default"] == "Fasthosts"
    assert f["items"]["suggested"][0]["unit_price"] == 96 and f["due_date"]["default"] == "2026-10-31"
    done = _answer(env, asked, {"vendor_name": "Fasthosts", "reference": "FH-2291", "items": [{"name": "Hosting, October", "quantity": 1, "unit_price": 96}],
                                "date": "2026-10-01", "due_date": "2026-10-31"})
    assert done["status"] == "succeeded" and done["summary"] == "Saved: supplier bill FH-2291 from Fasthosts for £96.00, to pay by 2026-10-31."
    bill = env.fin["expenses"][-1]
    assert (bill["kind"], bill["status"], bill["total_amount"], bill["due_date"], bill["line_items"][0]["description"]) == ("supplier_bill", "pending", 96, "2026-10-31", "Hosting, October")
    assert _charges(env) == [("agent_task", 2)] and env.pending(done) == []


def test_a_supplier_is_added_after_one_confirmation_and_brought_up_to_date_by_name():
    env = _empty()
    asked = env.submit(text="add a supplier called Paper Co, sales@paperco.test")["run"]
    f = _fields(asked)
    assert asked["pending_question"]["question"] == "Is this right?" and (f["vendor_name"]["default"], f["vendor_email"]["default"]) == ("Paper Co", "sales@paperco.test")
    done = _answer(env, asked, {"vendor_name": "Paper Co", "vendor_email": "sales@paperco.test"})
    assert done["summary"] == "Saved: Paper Co is now a supplier."
    assert env.businesses["A"]["data"]["catalogue"]["vendors"][0]["email"] == "sales@paperco.test"


# ══ pick one and edit ═════════════════════════════════════════════════════════

def test_changing_a_record_named_in_the_request_goes_straight_to_its_details_with_the_change_filled_in():
    env = _env()
    asked = env.submit(text="change the price of Bookkeeping to £350")["run"]
    f = _fields(asked)
    assert asked["pending_question"]["question"] == "What should change on Bookkeeping?"
    assert (f["name"]["default"], f["base_price"]["default"]) == ("Bookkeeping", 350)      # as it stands, with the change the request asked for
    done = _answer(env, asked, {"name": "Bookkeeping", "base_price": 350})
    assert done["status"] == "succeeded" and done["summary"] == "Saved: Bookkeeping's price is updated."
    assert next(p for p in env.businesses["A"]["data"]["catalogue"]["products"] if p["id"] == "p4")["base_price"] == 350
    same = env.submit(text="change the price of Bookkeeping to £350")["run"]
    assert _answer(env, same, {"name": "Bookkeeping", "base_price": 350})["summary"] == "Nothing changed on Bookkeeping: it already says that."


def test_changing_a_record_that_is_not_named_offers_a_picker_then_its_details():
    env = _env()
    asked = env.submit(text="update a customer")["run"]
    options = _fields(asked)["record"]["options"]
    assert {o["label"] for o in options} == {"Customer · BrightTech Ltd", "Customer · QA Round Six Ltd"}      # only customers were asked about
    details = _answer(env, asked, {"record": "customer:c6"})
    f = _fields(details)
    assert details["pending_question"]["question"] == "What should change on QA Round Six Ltd?" and (f["email"]["default"], f["payment_terms"]["default"]) == ("qa@six.test", 30)
    done = _answer(env, details, {"name": "QA Round Six Ltd", "email": "accounts@six.test", "payment_terms": 14})
    assert done["summary"] == "Saved: QA Round Six Ltd's email and payment terms are updated."
    c = next(c for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["id"] == "c6")
    assert (c["email"], c["payment_terms"]) == ("accounts@six.test", 14)
    nothing = _empty().submit(text="update a supplier")["run"]
    assert nothing["status"] == "succeeded" and nothing["next_action"].startswith("Ask me to add a customer, a supplier or a catalogue item")


# ══ Marketplace ═══════════════════════════════════════════════════════════════

def test_the_marketplace_profile_is_shown_as_it_stands_to_change_and_saved_on_confirm():
    env = _env()
    env.businesses["A"]["data"]["workspace_profile"]["about_company"] = "Bookkeeping for small UK service firms."
    asked = env.submit(text="update my marketplace profile")["run"]
    f = _fields(asked)
    assert f["description"]["default"] == "Bookkeeping for small UK service firms." and "business profile" in f["description"]["hint"]      # (g) offered, not asked for from nothing
    done = _answer(env, asked, {"description": "Bookkeeping and month-end for small UK service firms.", "service_area": "England"})
    assert done["status"] == "succeeded" and done["summary"] == "Saved: your Marketplace profile is updated."
    profile = env.businesses["A"]["data"]["marketplace"]["profile"]
    assert (profile["description"], profile["service_area"], profile["revision"]) == ("Bookkeeping and month-end for small UK service firms.", "England", 1)


def test_listing_and_unlisting_an_offering_names_it_from_the_request_and_confirms():
    env = _env()
    asked = env.submit(text="unlist Bookkeeping from the marketplace")["run"]
    f = _fields(asked)
    assert asked["pending_question"]["question"] == "Is this right?" and (f["product_id"]["default"], f["listing"]["default"]) == ("p4", "unlist")
    done = _answer(env, asked, {"product_id": "p4", "listing": "unlist"})
    assert done["summary"] == "Saved: Bookkeeping is no longer listed on the Marketplace."
    assert next(p for p in env.businesses["A"]["data"]["catalogue"]["products"] if p["id"] == "p4")["marketplace_listed"] is False
    back = env.submit(text="list Bookkeeping on the marketplace")["run"]
    assert _fields(back)["listing"]["default"] == "list"
    assert _answer(env, back, {"product_id": "p4", "listing": "list"})["summary"] == "Saved: Bookkeeping is now listed on the Marketplace."
    nothing = _empty().submit(text="list my services on the marketplace")["run"]
    assert nothing["status"] == "succeeded" and nothing["next_action"].startswith("Ask me to add a catalogue item")      # the one step that unblocks it


# ══ the from-scratch forms: discount, dates and notes ═════════════════════════

def test_a_new_invoice_takes_a_discount_a_due_date_and_a_note_from_the_form():
    env = _env()
    asked = env.submit(text="invoice QA Round Six")["run"]
    r = _answer(env, asked, {"items": [{"product_id": "p4", "quantity": 2, "unit_price": 300}], "discount": {"type": "percent", "value": 10},
                             "due_date": "2026-12-01", "notes": "Thank you for your business."})
    p = _one(env, r)["payload"]
    assert (p["subtotal"], p["discount_amount"], p["total"], p["due_date"]) == (600, 60, 540, "2026-12-01")
    assert env.fin["invoices"][0]["notes"] == "Thank you for your business."
    # Left as offered, the customer's own payment terms (30 days) still decide the due date.
    other = _env()
    asked = other.submit(text="invoice QA Round Six")["run"]
    assert _fields(asked)["due_date"]["default"] == "2026-10-15"
    r = _answer(other, asked, {"items": [{"product_id": "p4", "quantity": 1, "unit_price": 300}], "due_date": "2026-10-15"})
    assert _one(other, r)["payload"]["due_date"] == "2026-10-31"


def test_a_new_quotation_takes_a_discount_another_valid_until_date_and_a_note_from_the_form():
    env = _env()
    asked = env.submit(text="need a quotation")["run"]
    r = _answer(env, asked, {"customer_id": "c6", "items": [{"product_id": "p4", "quantity": 2, "unit_price": 300}],
                             "discount": {"type": "amount", "value": 100}, "valid_until": "2026-12-31", "notes": "Price held until the end of the year."})
    p = _one(env, r)["payload"]
    assert (p["subtotal"], p["discount_amount"], p["total"], p["valid_until"], p["notes"]) == (600, 100, 500, "2026-12-31", "Price held until the end of the year.")
    assert _charges(env) == [("agent_quote_draft", 2)]                     # still charged once for the draft


# ══ nothing says "I can't" ════════════════════════════════════════════════════

@pytest.mark.parametrize("capability", ["price_test", "capacity_check", "offer_review", "expansion_scenario", "launch_evidence_gaps", "risk_concentration",
                                        "record_payment", "credit_note", "marketplace_offering", "update_record"])
def test_with_nothing_on_record_each_says_what_it_needs_and_the_step_that_provides_it(capability):
    r = _empty().submit(capability=capability, channel="ui_action")["run"]
    said = f"{r.get('summary') or ''} {r.get('next_action') or ''}"
    assert r["status"] == "succeeded" and r["next_action"], said          # there is always a next step
    assert not any(phrase in said for phrase in ("I can't", "I cannot", "There is no ", "There are no ", "not automated", "Business Blueprints")), said


def test_every_capability_is_on_a_plan_states_its_cost_and_is_listed():
    assert set(config.CAPABILITY_MIN_PLAN) == set(WORKFLOWS)
    assert all(config.cost_of(c) for c in WORKFLOWS)
    for key in ("new_proposal", "new_purchase_order", "credit_note"):
        assert config.cost_of(key) == "2 credits when it is sent" and WORKFLOWS[key].autonomy == "A3"
    for key in ("supplier_bill", "add_vendor", "update_record", "marketplace_profile", "marketplace_offering"):
        assert config.cost_of(key) == "2 credits" and WORKFLOWS[key].autonomy == "A1"


def test_proposals_purchase_orders_and_credit_notes_can_be_edited_while_they_wait_and_are_asked_for_again():
    from app.modules.agent import router as agent_router
    env = _env()
    # Proposal: what it says and its price.
    r = _answer(env, env.submit(text="write a proposal for QA Round Six for £4,500")["run"], {"solution": "We take over bookkeeping.", "total": 4500})
    first = _one(env, r)
    r = run(env.orch.edit_draft(r["id"], OWNER, {"solution": "We take over bookkeeping and month-end.", "total": 5000, "timeline": "Live in 3 weeks"}))
    a = _one(env, r)
    assert a["id"] != first["id"] and a["payload_version"] == 2 and run(env.store.get_approval(first["id"]))["status"] == "superseded"
    assert (a["payload"]["solution"], a["payload"]["total"], a["payload"]["timeline"]) == ("We take over bookkeeping and month-end.", 5000, "Live in 3 weeks")
    changes = agent_router._public_run(run(env.store.get_run(r["id"])))["last_edit"]["changes"]
    assert "“What you propose” changed" in changes and changes.endswith("total £4,500.00 → £5,000.00")
    with pytest.raises(Conflict):
        run(env.orch.edit_draft(r["id"], OWNER, {"total": 0}))
    # Purchase order: its lines and delivery date.
    po = _answer(env, env.submit(text="raise a purchase order for Fasthosts")["run"], {"items": [{"name": "Dedicated server", "quantity": 2, "unit_price": 80}]})
    po = run(env.orch.edit_draft(po["id"], OWNER, {"items": [{"name": "Dedicated server", "quantity": 3, "unit_price": 80}], "delivery_date": "2026-10-25"}))
    p = _one(env, po)["payload"]
    assert (p["total"], p["delivery_date"], _one(env, po)["payload_version"]) == (240, "2026-10-25", 2)
    # Credit note: the amount (never more than can be credited), the reason and any refund.
    inv = _sent_invoice(env, 600, paid=200)
    cn = _answer(env, env.submit(text=f"credit note for {inv['reference']}")["run"], {"invoice_id": inv["id"], "amount": 100, "reason": "Late delivery"})
    cn = run(env.orch.edit_draft(cn["id"], OWNER, {"total": 150, "reason": "Late delivery of two items", "refund_amount": 50}))
    c = _one(env, cn)["payload"]
    assert (c["total"], c["reason"], c["refund_amount"], _one(env, cn)["payload_version"]) == (150, "Late delivery of two items", 50, 2)
    with pytest.raises(Conflict):
        run(env.orch.edit_draft(cn["id"], OWNER, {"total": 5000}))


def test_the_agent_centre_lists_every_document_with_its_status_and_whether_its_draft_can_be_edited(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.modules.agent import router as agent_router
    from app.shared.auth.deps import get_current_user
    env = _env()
    quote = env.submit(text="quote QA Round Six for 2 months bookkeeping")["run"]                    # waiting for approval
    sent = env.approve(env.submit(text="invoice QA Round Six for 1 month bookkeeping")["run"])       # sent
    proposal = _answer(env, env.submit(text="write a proposal for QA Round Six for £4,500")["run"], {"solution": "We take over bookkeeping.", "total": 4500})
    po = _answer(env, env.submit(text="raise a purchase order for Fasthosts")["run"], {"items": [{"name": "Server", "quantity": 1, "unit_price": 80}]})
    inv = env.fin["invoices"][0]
    note = _answer(env, env.submit(text=f"credit note for {inv['reference']}")["run"], {"invoice_id": inv["id"], "amount": 50, "reason": "Goodwill"})
    env.fin["invoices"][0].setdefault("payments", []).append({"id": "pay1", "amount": 100, "paid_at": env.now.isoformat(), "receipt": {"number": "REC-1", "issued_at": env.now.isoformat()}})
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            body = client.get("/businesses/A/agent/documents").json()
            other = client.get("/businesses/B/agent/documents")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert other.status_code in (403, 404)                                 # another business's documents are never listed
    docs = {d["kind"]: d for d in body["items"]}
    assert set(docs) == {"quotation", "invoice", "proposal", "purchase_order", "credit_note", "receipt"} and body["total"] == 6
    assert {k["key"] for k in body["kinds"]} == {"quotation", "invoice", "contract", "proposal", "purchase_order", "credit_note", "receipt"}
    for kind, task in (("quotation", quote), ("proposal", proposal), ("purchase_order", po), ("credit_note", note)):
        d = docs[kind]
        assert (d["status"], d["status_label"], d["can_edit"], d["run_id"]) == ("awaiting_approval", "Waiting for your approval", True, task["id"]), kind
    assert (docs["invoice"]["status_label"], docs["invoice"]["can_edit"], docs["invoice"]["run_id"]) == ("Sent", False, sent["id"])
    assert (docs["receipt"]["reference"], docs["receipt"]["status_label"], docs["receipt"]["total"]) == ("REC-1", "Issued, not sent", 100)
    assert (docs["proposal"]["party"], docs["proposal"]["total"], docs["purchase_order"]["party"]) == ("QA Round Six Ltd", 4500, "Fasthosts")
    assert [d["status"] for d in body["items"]][:4] == ["awaiting_approval"] * 4      # what is waiting for you comes first
