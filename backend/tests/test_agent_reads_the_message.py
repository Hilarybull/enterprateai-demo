"""The Agent reads what the owner already said, for every document and task, and asks only for
what is missing. One sentence per document: every stated field is filled and shown back under
"From what you said" (`said`), the currency that was written is kept, nothing is invented, and
the draft lands in Needs Approval (or the record is saved) once the rest is given."""
from datetime import date, timedelta

import pytest

from app.modules.agent import said
from test_agent import OWNER, run
from test_agent_more_documents import _env

TODAY = date(2026, 10, 7)      # a Wednesday


def _world():
    env = _env()
    cat = env.businesses["A"]["data"]["catalogue"]
    cat["customers"] += [{"id": "cf", "name": "Frank", "email": "frank@frank.test"}, {"id": "ca", "name": "Aftred", "email": "a@aftred.test"},
                         {"id": "ct", "name": "QA Test Ltd", "email": "t@qa.test"}]
    env.fin["invoices"] += [
        {"id": "i-a", "invoice_number": "INV-1160926", "customer_name": "Aftred", "customer_email": "a@aftred.test", "customer_id": "ca", "status": "sent", "total_amount": 149,
         "created_at": env.now.isoformat(), "due_date": "2026-01-01", "payments": []},
        {"id": "i-6", "invoice_number": "INV-2031026", "customer_name": "QA Round Six Ltd", "customer_email": "qa@six.test", "customer_id": "c6", "status": "sent", "total_amount": 360,
         "created_at": env.now.isoformat(), "due_date": "2027-01-01", "payments": []}]
    return env


def _ask(env, text):
    r = env.submit(text=text)["run"]
    fields = {f["key"]: f for f in (r.get("pending_question") or {}).get("fields") or []}
    return r, fields


def _said(fields):
    return {k: f.get("said_text") for k, f in fields.items() if f.get("said") and f.get("said_text")}


def _still_to_ask(fields):
    """What the owner has to supply: required, not filled from the message or the records, and showing."""
    values = {k: (f.get("default") if f.get("default") not in (None, "") else None) for k, f in fields.items()}
    out = []
    for k, f in fields.items():
        if f.get("show_if") and not all(values.get(a) == b for a, b in f["show_if"].items()):
            continue
        if k == "items":
            if not all(str(s.get("name") or s.get("product_id") or "").strip() and s.get("unit_price") not in (None, "") for s in f.get("suggested") or [{}]):
                out.append(k)
        elif f.get("required") and values[k] is None:
            out.append(k)
    return out


def _answer(env, r, answers):
    return run(env.orch.provide_input(r["id"], OWNER, answers))


def _defaults(fields, **more):
    """Sending the form as it stands (what "That's right, continue" does), plus what was still asked."""
    out = {}
    for k, f in fields.items():
        v = f.get("suggested") if k == "items" else f.get("default")
        if v not in (None, "", []):
            out[k] = v
    return {**out, **more}


# ══ the reader itself ═════════════════════════════════════════════════════════

def test_money_is_read_with_the_currency_it_was_written_in():
    for text, amount, currency in (("invoice Mark $300", 300, "USD"), ("quote Frank £200", 200, "GBP"), ("€1,250.50 for design", 1250.5, "EUR"), ("raise 50k", 50000, None),
                                   ("1.5m facility", 1500000, None), ("USD 99", 99, "USD"), ("300 dollars", 300, "USD"), ("GBP 40", 40, "GBP")):
        told = said.read(text, TODAY)
        assert (told["amount"], told.get("currency")) == (amount, currency), text
    assert "amount" not in said.read("invoice Mark for consulting", TODAY)      # no figure said, none made up


def test_dates_terms_vat_and_discount_are_read_as_people_write_them():
    r = lambda t: said.read(t, TODAY)      # noqa: E731
    assert r("invoice Acme £100, due in 14 days")["due"] == TODAY + timedelta(days=14)
    assert r("invoice Acme £100 net 30")["due"] == TODAY + timedelta(days=30) and r("invoice Acme £100 net 30")["terms_days"] == 30
    assert r("invoice Acme £100 by 30 Nov")["by"] == date(2026, 11, 30)
    assert r("quote Acme £100, valid for a month")["valid"] == TODAY + timedelta(days=30)
    assert r("quote Acme £100, valid 30 days")["valid"] == TODAY + timedelta(days=30)
    assert r("PO to Acme for 10 chairs at £50, deliver by Friday")["delivery"] == date(2026, 10, 9)
    c = r("contract with Acme for bookkeeping, £300/month, 12 months from 1 Dec")
    assert (c["start"], c["duration"]) == (date(2026, 12, 1), "12 months")
    assert r("Acme paid £50 yesterday by card")["paid_on"] == TODAY - timedelta(days=1)
    assert r("invoice Acme £100 no VAT")["vat"] == 0 and r("invoice Acme £100, 20% VAT")["vat"] == 20
    assert r("invoice Acme £100 plus VAT") .get("vat_default") is True and "vat" not in r("invoice Acme £100 plus VAT")      # a rate is never made up
    assert r("invoice Acme £100, 10% off")["discount"] == {"type": "percent", "value": 10}
    d = r("invoice Acme £500, £50 discount")
    assert d["discount"] == {"type": "amount", "value": 50} and d["amount"] == 500      # the discount is not taken for the price
    assert r("invoice QUO-2041026")["refs"] == ["QUO-2041026"] and "party" not in r("invoice QUO-2041026")


def test_quantities_and_unit_prices():
    r = lambda t: said.read(t, TODAY)["items"]      # noqa: E731
    assert r("PO to Acme for 10 chairs at £50") == [{"name": "chairs", "quantity": 10, "unit_price": 50}]
    assert r("invoice Acme for 3 days consulting at £400 each") == [{"name": "consulting", "quantity": 3, "unit_price": 400}]
    assert r("invoice Acme for 4 chairs, £200") == [{"name": "chairs", "quantity": 4, "unit_price": 50}]      # a total over four: what each comes to
    assert r("invoice Acme for logo design x3 at £90") == [{"name": "logo design", "quantity": 3, "unit_price": 90}]
    assert r("invoice Mark, $300") == [{"name": "", "quantity": 1, "unit_price": 300}]      # what for was not said: left for the owner


# ══ one sentence per document ═════════════════════════════════════════════════

def test_invoice_for_someone_new_in_dollars_asks_only_for_their_email_and_what_it_is_for():
    env = _world()
    r, f = _ask(env, "I want an Invoice for Mark, $300")
    assert r["workflow_key"] == "new_invoice"
    assert (f["customer_id"]["default"], f["customer_name"]["default"]) == ("new", "Mark")      # nobody called Mark on record: "+ New", name filled in
    assert f["items"]["suggested"] == [{"product_id": None, "name": "", "quantity": 1, "unit_price": 300}]      # one line at 300
    assert _said(f) == {"customer_id": "Mark (new)"}
    assert _still_to_ask(f) == ["customer_email", "items"]                  # Mark's email, and the item's description
    # The currency that was written is kept and said, with the way to switch: never dropped, never converted.
    cur = f["currency"]
    assert (cur["default"], cur["hint"], cur["toggle"]) == ("USD", "In USD (your default is GBP).", True)
    assert [o["value"] for o in cur["options"]] == ["USD", "GBP"]
    done = _answer(env, r, _defaults(f, customer_email="mark@example.test", vat_rate=0, items=[{"name": "Consulting", "quantity": 1, "unit_price": 300}]))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    p = env.pending(done)[0]["payload"]
    assert (p["customer_name"], p["total"], p["currency"]) == ("Mark", 300, "USD")
    assert env.fin["invoices"][-1]["currency"] == "USD" and env.fin["invoices"][-1]["total_amount"] == 300      # $300 stays $300
    # Switched back to the default in the form: the same figure, in pounds, because the owner said so.
    env = _world()
    r, f = _ask(env, "I want an Invoice for Mark, $300")
    done = _answer(env, r, _defaults(f, customer_email="mark@example.test", currency="GBP", items=[{"name": "Consulting", "quantity": 1, "unit_price": 300}]))
    assert env.pending(done)[0]["payload"]["currency"] == "GBP"


def test_invoice_with_everything_on_record_asks_nothing():
    env = _world()
    r = env.submit(text="invoice QA Round Six for 2 months bookkeeping")["run"]
    assert r["status"] == "awaiting_approval" and r.get("pending_question") is None      # existing customer, catalogue item, quantity 2
    p = env.pending(r)[0]["payload"]
    assert (p["customer_name"], p["total"], p["currency"]) == ("QA Round Six Ltd", 600, "GBP")
    assert [(i["description"], i["qty"]) for i in p["items"]] == [("Bookkeeping", 2)]


def test_invoice_with_work_terms_and_a_named_stranger():
    env = _world()
    r, f = _ask(env, "invoice Mark $300 for consulting, due in 14 days")
    assert _said(f) == {"customer_id": "Mark (new)", "items": "1 × consulting at $300.00", "due_date": (env.now + timedelta(days=14)).strftime("%d %b %Y").lstrip("0")}
    assert _still_to_ask(f) == ["customer_email"]
    assert f["due_date"]["default"] == (env.now + timedelta(days=14)).date().isoformat()


def test_invoice_from_a_quotation_by_its_number():
    env = _world()
    for who in ("QA Round Six", "Frank"):      # two quotations out: naming one by its number is enough, nothing is asked
        env.approve(env.submit(text=f"quote {who} for 2 months bookkeeping")["run"])
    first, second = env.fin["quotes"][-2], env.fin["quotes"][-1]
    assert env.submit(text="turn my quotation into an invoice").get("kind") == "needs_input"      # not named: which one is asked
    out = env.submit(text=f"invoice {first['reference']}")
    assert out.get("run"), out
    assert (out["run"].get("state") or {}).get("quote_id") == first["id"] != second["id"]


def test_quotation_for_a_customer_on_record_is_one_yes_away():
    env = _world()
    r, f = _ask(env, "quote Frank £200 for logo design, valid 30 days")
    assert r["workflow_key"] == "enquiry_to_quote" and "customer_id" not in f      # Frank is on record: not asked
    assert _said(f) == {"items": "1 × logo design at £200.00", "valid_until": (env.now + timedelta(days=30)).strftime("%d %b %Y").lstrip("0")}
    assert _still_to_ask(f) == [] and "currency" not in f                   # pounds is the default: nothing to say about it
    done = _answer(env, r, _defaults(f))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    p = env.pending(done)[0]["payload"]
    assert (p["customer_name"], p["total"]) == ("Frank", 200) and str(p.get("valid_until") or "")[:10] == (env.now + timedelta(days=30)).date().isoformat()


def test_receipt_reads_the_invoice_the_amount_the_day_and_how_it_was_paid():
    env = _world()
    r, f = _ask(env, "receipt for INV-1160926, paid £149 by bank transfer yesterday")
    assert (f["invoice_id"]["default"], f["amount"]["default"], f["method"]["default"]) == ("i-a", 149, "Bank transfer")
    assert f["paid_at"]["default"] == (env.now - timedelta(days=1)).date().isoformat()
    assert set(_said(f)) == {"invoice_id", "amount", "paid_at", "method"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] in ("awaiting_approval", "succeeded"), done.get("pending_question")
    assert env.fin["invoices"][-2]["payments"][0]["amount"] == 149


def test_reminder_names_the_invoice_and_goes_straight_to_approval():
    env = _world()
    r = env.submit(text="remind Aftred about INV-1160926 politely")["run"]
    assert r["workflow_key"] == "payment_followup" and r["status"] == "awaiting_approval"
    p = env.pending(r)[0]["payload"]
    assert p["customer_name"] == "Aftred" and "INV-1160926" in str(p)


def test_contract_reads_who_scope_price_term_and_start():
    env = _world()
    r, f = _ask(env, "contract with QA Test Ltd for monthly bookkeeping, £300/month, 12 months from 1 Nov")
    assert r["workflow_key"] == "new_contract" and "customer_id" not in f      # on record
    assert (f["description"]["default"], f["total"]["default"], f["term"]["default"], f["start_date"]["default"]) == ("Monthly bookkeeping", 300, "12 months", "2026-11-01")
    assert set(_said(f)) == {"description", "total", "term", "start_date"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    assert env.pending(done)[0]["payload"]["customer_name"] == "QA Test Ltd"


def test_proposal_reads_who_what_price_and_timeline():
    env = _world()
    r, f = _ask(env, "proposal to Inject Test Ltd for a website redesign, £1,500, 4 weeks")
    assert r["workflow_key"] == "new_proposal"
    assert (f["customer_name"]["default"], f["solution"]["default"], f["total"]["default"], f["timeline"]["default"]) == ("Inject Test Ltd", "A website redesign", 1500, "4 weeks")
    assert _said(f) == {"customer_id": "Inject Test Ltd (new)", "solution": "a website redesign", "total": "£1,500.00", "timeline": "4 weeks"}
    assert _still_to_ask(f) == ["customer_email"]
    done = _answer(env, r, _defaults(f, customer_email="hello@inject.test"))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    p = env.pending(done)[0]["payload"]
    assert (p["customer_name"], p["total"], p["timeline"]) == ("Inject Test Ltd", 1500, "4 weeks")


def test_purchase_order_reads_the_supplier_the_lines_and_the_delivery_date():
    env = _world()
    r, f = _ask(env, "PO to Acme for 10 chairs at £50, deliver by Friday")
    assert r["workflow_key"] == "new_purchase_order"
    assert f["items"]["suggested"] == [{"product_id": None, "name": "chairs", "quantity": 10, "unit_price": 50}]
    assert set(_said(f)) == {"vendor_id", "items", "delivery_date"} and _said(f)["vendor_id"] == "Acme (new)" and _still_to_ask(f) == ["vendor_email"]
    friday = env.now.date() + timedelta(days=(4 - env.now.weekday() - 1) % 7 + 1)
    assert f["delivery_date"]["default"] == friday.isoformat()
    done = _answer(env, r, _defaults(f, vendor_email="orders@acme.test"))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    p = env.pending(done)[0]["payload"]
    assert (p["total"], p["delivery_date"]) == (500, friday.isoformat())
    # A supplier on record is matched, however it was typed.
    r, f = _ask(_world(), "po to fasthosts for 2 servers at £80")
    assert "vendor_id" not in f and "vendor_name" not in f and _still_to_ask(f) == []      # found on record: not asked about at all
    assert _said(f) == {"items": "2 × servers at £80.00"}


def test_supplier_bill_reads_who_how_much_what_for_and_when():
    env = _world()
    r, f = _ask(env, "record a £120 bill from BT for broadband, paid today")
    assert r["workflow_key"] == "supplier_bill"
    assert f["vendor_name"]["default"] == "BT" and f["items"]["suggested"] == [{"product_id": None, "name": "broadband", "quantity": 1, "unit_price": 120}]
    assert f["date"]["default"] == env.now.date().isoformat()
    assert {"vendor_name", "items", "date"} <= set(_said(f)) and _still_to_ask(f) == []


def test_credit_note_reads_the_invoice_the_amount_and_the_reason():
    env = _world()
    r, f = _ask(env, "credit note on INV-2031026 for £60, overcharge")
    assert r["workflow_key"] == "credit_note"
    assert (f["invoice_id"]["default"], f["amount"]["default"], f["reason"]["default"]) == ("i-6", 60, "overcharge")
    assert set(_said(f)) == {"invoice_id", "amount", "reason"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] == "awaiting_approval", done.get("pending_question")
    p = env.pending(done)[0]["payload"]
    assert (p["total"], p["reason"], p["invoice_reference"]) == (60, "overcharge", "INV-2031026")


def test_a_payment_said_in_passing_is_recorded_against_the_right_invoice():
    env = _world()
    r, f = _ask(env, "QA Round Six paid £360 today by card")
    assert r["workflow_key"] == "record_payment"
    assert (f["invoice_id"]["default"], f["amount"]["default"], f["method"]["default"], f["paid_at"]["default"]) == ("i-6", 360, "Card", env.now.date().isoformat())
    assert set(_said(f)) == {"invoice_id", "amount", "paid_at", "method"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] in ("awaiting_approval", "succeeded"), done.get("pending_question")
    paid = env.fin["invoices"][-1]["payments"][0]
    assert paid["amount"] == 360 and "Card" in str(paid)


def test_a_customer_and_a_catalogue_item_are_read_whole():
    env = _world()
    r, f = _ask(env, "add customer Mark, mark@example.com")
    assert r["workflow_key"] == "add_customer" and (f["customer_name"]["default"], f["customer_email"]["default"]) == ("Mark", "mark@example.com")
    assert _said(f) == {"customer_name": "Mark", "customer_email": "mark@example.com"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] == "succeeded" and any(c["name"] == "Mark" and c["email"] == "mark@example.com" for c in env.businesses["A"]["data"]["catalogue"]["customers"])
    env = _world()
    r, f = _ask(env, "add service Logo design £450")
    assert r["workflow_key"] == "add_catalogue_item" and (f["name"]["default"], f["price"]["default"]) == ("Logo design", 450)
    assert _said(f) == {"name": "Logo design", "price": "£450.00"} and _still_to_ask(f) == []
    done = _answer(env, r, _defaults(f))
    assert done["status"] == "succeeded" and any(p["name"] == "Logo design" and p["base_price"] == 450 for p in env.businesses["A"]["data"]["catalogue"]["products"])


@pytest.mark.parametrize("text", ["invoice someone", "prepare a quotation", "write a proposal", "raise a purchase order"])
def test_nothing_is_invented_when_nothing_was_said(text):
    env = _world()
    r, f = _ask(env, text)
    assert _said(f) == {} and "currency" not in f
    assert not any(f[k].get("default") for k in ("customer_name", "vendor_name") if k in f)
    assert all(not (s.get("unit_price") or s.get("name")) for s in (f.get("items") or {}).get("suggested") or [])


def test_what_the_owner_has_answered_is_never_overwritten_by_what_they_first_said():
    env = _world()
    r, f = _ask(env, "invoice Mark $300 for consulting")
    # They correct the name and the price in the form; the next question (the business has VAT to settle) must not put "Mark" or 300 back.
    env.store.policies["A"].pop("default_vat_rate", None)
    again = _answer(env, r, {"customer_id": "new", "customer_name": "Marc Ltd", "customer_email": "marc@example.test", "currency": "USD",
                             "items": [{"name": "Consulting", "quantity": 2, "unit_price": 250}]})
    later = {x["key"]: x for x in (again.get("pending_question") or {}).get("fields") or []}
    assert "customer_name" not in later or later["customer_name"].get("default") != "Mark"
    assert "items" not in later


# ══ follow-ups from the browser check ═════════════════════════════════════════

def test_everything_taken_from_the_message_is_listed_even_where_something_is_still_asked():
    env = _world()
    r, f = _ask(env, "I want an Invoice for Mark, $300")
    listed = [(x.get("said_label") or x["label"], x.get("said_text") or x.get("said_note")) for x in f.values() if x.get("said_text") or x.get("said_note")]
    assert listed == [("Customer", "Mark (new)"), ("Amount", "$300.00"), ("Currency", "USD")]      # Customer Mark (new) · $300 · USD
    assert f["items"].get("said") is not True                               # the line is still shown: its description is missing
    r, f = _ask(_world(), "invoice Mark for consulting")                    # what for, but no price: listed, and the price is asked
    assert (f["items"]["said_label"], f["items"]["said_note"]) == ("Items", "consulting")


def test_vat_is_not_asked_when_settings_has_a_default_and_is_asked_once_with_save_as_default_when_not():
    env = _world()                                                          # Agent settings: default VAT rate 0
    for text in ("I want an Invoice for Mark, $300", "quote Frank £200 for logo design", "write a proposal for Frank", "raise a purchase order for Fasthosts"):
        _r, f = _ask(env, text)
        assert "vat_rate" not in f and "save_vat_default" not in f, text
    env = _world()
    env.store.policies["A"].pop("default_vat_rate")
    r, f = _ask(env, "invoice Mark $300 for consulting")
    assert list(f).index("save_vat_default") == list(f).index("vat_rate") + 1
    assert (f["save_vat_default"]["type"], f["save_vat_default"]["label"], f["save_vat_default"]["default"]) == ("checkbox", "Save as my default VAT rate", False)
    done = _answer(env, r, _defaults(f, customer_email="mark@example.test", vat_rate=20, save_vat_default=True))
    assert done["status"] == "awaiting_approval" and env.pending(done)[0]["payload"]["vat_rate"] == 20
    assert run(env.store.get_policy("A"))["default_vat_rate"] == 20         # saved to Agent settings
    _r, again = _ask(env, "invoice Mark $300 for consulting")
    assert "vat_rate" not in again and "save_vat_default" not in again      # asked once: never again
    # Not ticked: this invoice only; the question comes back next time.
    env = _world()
    env.store.policies["A"].pop("default_vat_rate")
    r, f = _ask(env, "invoice Mark $300 for consulting")
    _answer(env, r, _defaults(f, customer_email="mark@example.test", vat_rate=20))
    assert run(env.store.get_policy("A")).get("default_vat_rate") is None and "vat_rate" in _ask(env, "invoice Mark $300 for consulting")[1]


def test_a_request_left_unanswered_for_14_days_closes_itself_with_a_note_and_a_discarded_one_leaves_needs_you():
    from app.modules.agent import autostart, config
    env = _world()
    old, _f = _ask(env, "I want an Invoice for Mark, $300")
    recent, _f = _ask(env, "invoice Mark $300 for consulting")
    waiting = env.submit(text="invoice QA Round Six for 2 months bookkeeping")["run"]      # waiting for approval, not for an answer
    assert config.UNANSWERED_CLOSE_DAYS == 14
    for x in (old, recent, waiting):      # the store stamps changes with the real time: set to when these were asked
        env.store.runs[x["id"]]["updated_at"] = env.now.isoformat()
    env.now = env.now + timedelta(days=13, hours=23)
    assert run(env.orch.close_unanswered(run(env.store.list_runs("A")))) == 0      # not yet
    touched = run(env.store.get_run(recent["id"]))
    env.store.runs[recent["id"]]["updated_at"] = env.now.isoformat()         # something happened on this one today
    env.now = env.now + timedelta(hours=2)
    run(autostart.sweep(env.orch, "A"))                                     # the ordinary background pass, automatic starting off or on
    closed, kept, approval = (run(env.store.get_run(x["id"])) for x in (old, recent, waiting))
    assert (closed["status"], closed["reason_code"]) == ("cancelled", "closed_unanswered") and closed["pending_question"] is None
    assert closed["summary"] == "Closed automatically: it waited 14 days for an answer. Nothing was sent. Ask again whenever you're ready."
    assert kept["status"] == "running" and kept["pending_question"] and touched     # activity resets the clock
    assert approval["status"] == "awaiting_approval"                        # a draft waiting for approval is not a question: left alone
    assert env.fin["invoices"][-1]["customer_name"] != "Mark" and env.comms.sent == []
    # Discard (the dialog's "Discard this request") is an ordinary cancel: it leaves Needs You for History.
    gone = run(env.orch.cancel(recent["id"], OWNER))
    assert gone["status"] == "cancelled" and gone["summary"] == "Cancelled. Nothing had been sent."


# ══ from the demo call ═══════════════════════════════════════════════════════

@pytest.mark.parametrize("text, work", [
    ("I want to create an invoice for a client that i consulted for in research work", "research work"),
    ("invoice my client in Leeds for consulting", "consulting"),
    ("quote a customer for a new kitchen", "a new kitchen"),
    ("invoice the company I worked for last month", None),
    ("invoice one of my customers for training", "training"),
])
def test_someone_described_is_not_taken_for_their_name_so_the_name_is_asked_for(text, work):
    """The homepage showed "A Client That I Consulted" as the customer and never asked who the client was."""
    from app.modules.agent import goals
    told = said.read(text, TODAY)
    assert "party" not in told and told.get("work") == work and "tone" not in told, told
    read = goals.extract(text, "create_invoice")
    assert "customer" not in read and read.get("item") == work
    env = _world()
    r, f = _ask(env, text)
    assert not f.get("customer_name", {}).get("default") and not f.get("customer_id", {}).get("said")      # asked: nothing is filled in for them
    # A real name still reads as one, with or without capitals.
    assert said.read("invoice mark for research work", TODAY)["party"] == "mark" and said.read("invoice Acme Research Ltd £400", TODAY)["party"] == "Acme Research Ltd"


def test_the_business_email_question_offers_the_address_the_owner_signed_in_with():
    from test_agent import Env
    env = Env()
    env.businesses["A"]["data"].setdefault("workspace_profile", {}).pop("email", None)
    env.businesses["A"]["data"].pop("contact", None)
    r = env.submit(text="invoice BrightTech Ltd for Strategy Workshop")["run"]
    q = (r.get("pending_question") or {}).get("fields") or []
    asked = {f["key"]: f for f in q}
    if "business_email" in asked:      # this business has no email of its own on record
        assert asked["business_email"]["default"] == OWNER and asked["business_email"]["required"] is True
