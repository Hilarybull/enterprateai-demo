"""The shared extractor: the model reads the fields, code only checks them. Offline, with a stand-in model that returns
fixed JSON, so what is tested is the checking: nothing the owner didn't say is ever filled in, values are normalised,
records are matched only by an id that exists, a doubtful value is not used as an answer, and the tasks use what was
read (no slicing of the text) when the model has read it."""
import json
from datetime import date

import app.modules.agent.orchestrator  # noqa: F401  (loads the Agent)
from app.modules.agent import extraction
from app.modules.agent.services import Classifier
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run
from test_agent_more_documents import _env

TODAY = date(2026, 10, 14)


def f(value, span, confidence=0.95, **extra):
    return {"value": value, "span": span, "confidence": confidence, **extra}


def test_every_capability_declares_its_fields_and_nothing_else_is_needed():
    assert set(extraction.SCHEMAS) == set(WORKFLOWS)
    for cap, schema in extraction.SCHEMAS.items():
        for field in schema:
            assert field["key"] and field["type"] and field["about"] and field["examples"], (cap, field)


def test_a_value_not_in_the_message_is_never_filled_in():
    msg = "Add Oven deep clean to my catalogue at £65"
    got = extraction.check("add_catalogue_item", {"fields": {"name": f("Oven deep clean", "Oven deep clean"), "price": f(65, "£65"),
                                                             "cost": f(20, "costs £20")}}, msg, {}, TODAY)
    assert got["name"]["value"] == "Oven deep clean" and got["price"]["value"] == 65.0 and "cost" not in got


def test_an_email_must_be_written_in_the_message():
    got = extraction.check("add_customer", {"fields": {"customer_name": f("Nova Labs", "Nova Labs"), "customer_email": f("dana@novalabs.test", "Nova Labs")}},
                           "Add customer Nova Labs", {}, TODAY)
    assert "customer_email" not in got


def test_dates_money_and_periods_are_normalised():
    msg = "Record an expense: £45 on cleaning supplies from Costco today"
    got = extraction.check("record_expense", {"fields": {"vendor_name": f("Costco", "Costco"), "description": f("cleaning supplies", "cleaning supplies"),
                                                         "amount": f("£45", "£45"), "date": f("today", "today")}}, msg, {}, TODAY)
    assert (got["vendor_name"]["value"], got["description"]["value"], got["amount"]["value"], got["date"]["value"]) == ("Costco", "cleaning supplies", 45.0, "2026-10-14")
    rec = extraction.check("new_contract", {"fields": {"price_amount": f(450, "£450"), "price_every": f("monthly", "a month")}}, "£450 a month", {}, TODAY)
    assert rec["price_every"]["value"] == "month"


def test_a_record_is_matched_only_by_an_id_that_exists():
    records = {"customers": [{"id": "c9", "name": "Delta Offices Ltd"}]}
    got = extraction.check("new_contract", {"fields": {"customer_name": f("c9", "Delta Offices Ltd")}}, "contract for Delta Offices Ltd", records, TODAY)
    assert got["customer_name"]["record_id"] == "c9" and got["customer_name"]["value"] == "Delta Offices Ltd"
    made_up = extraction.check("record_payment", {"fields": {"invoice_id": f("i-404", "INV-404")}}, "INV-404 was paid", {"invoices": []}, TODAY)
    assert "invoice_id" not in made_up


def test_a_doubtful_value_is_not_an_answer():
    fields = {"name": f("Oven deep clean", "Oven deep clean", confidence=0.4), "price": f(65.0, "£65")}
    assert extraction.as_answers("add_catalogue_item", fields) == {"price": 65.0}


class Reader(Classifier):
    """A stand-in model: what it returns is fixed per message."""
    available = True

    def __init__(self, answers):
        self.answers, self.asked = answers, []

    async def read_fields(self, *, system, prompt, user_id):
        self.asked.append(prompt)
        message = prompt.split("Request:\n<external_content>\n", 1)[1].split("\n</external_content>", 1)[0]
        return json.dumps({"fields": self.answers[message]})


def test_the_live_contract_example_reads_scope_term_and_recurring_price_and_nothing_is_sliced():
    msg = "Draft a contract for Delta Offices Ltd, weekly office clean, £450 a month for 12 months"
    env = _env(vat=0)
    env.businesses["A"]["data"]["catalogue"]["customers"].append({"id": "c9", "name": "Delta Offices Ltd", "email": "ops@delta.test"})
    env.orch.rt.classifier = Reader({msg: {"customer_name": f("c9", "Delta Offices Ltd"), "description": f("weekly office clean", "weekly office clean"),
                                           "price_amount": f(450, "£450"), "price_every": f("month", "a month"), "term": f("12 months", "for 12 months"),
                                           "total": None, "start_date": None, "customer_email": None}})
    r = env.submit(text=msg)["run"]
    assert not r.get("pending_question"), r.get("pending_question")      # nothing asked again
    c = env.fin["contracts"][0]
    assert (c["customer_name"], c["description"], c["term"], c["amount"]) == ("Delta Offices Ltd", "weekly office clean", "12 months", 5400.0)
    assert c["pricing"]["text"] == "£450.00/month × 12 = £5,400.00"
    assert r["state"]["understood"]["by"] == "model"


def test_the_live_catalogue_expense_and_proposal_examples_on_the_model_path():
    env = _env(vat=0)
    cat, exp, pro = ("Add Oven deep clean to my catalogue at £65", "Record an expense: £45 on cleaning supplies from Costco today",
                     "write a proposal for QA Round Six for a weekly office clean at £450 a month for 12 months")
    env.orch.rt.classifier = Reader({
        cat: {"name": f("Oven deep clean", "Oven deep clean"), "price": f(65, "£65"), "cost": None},
        exp: {"vendor_name": f("Costco", "Costco"), "description": f("cleaning supplies", "cleaning supplies"), "amount": f(45, "£45"),
              "date": f("today", "today"), "paid": None},
        pro: {"customer_name": f("c6", "QA Round Six"), "solution": f("a weekly office clean", "a weekly office clean"), "price_amount": f(450, "£450"),
              "price_every": f("month", "a month"), "timeline": f("12 months", "for 12 months"), "problem": None, "total": None}})
    r = env.submit(text=cat)["run"]
    assert r["status"] == "succeeded" and any(p["name"] == "Oven deep clean" and p["base_price"] == 65 for p in env.businesses["A"]["data"]["catalogue"]["products"])
    r = env.submit(text=exp)["run"]
    fields = {x["key"]: x for x in (r.get("pending_question") or {}).get("fields") or []}
    if fields:      # the one confirmation the expense form always has: everything filled in, nothing to type
        assert fields["vendor_name"]["default"] == "Costco" and fields["description"]["default"] == "cleaning supplies" and fields["date"]["default"] == env.now.date().isoformat()
    r = env.submit(text=pro)["run"]
    assert not r.get("pending_question")      # customer, work and price were all said: drafted without a question
    p = env.fin["proposals"][0]
    assert (p["customer_name"], p["solution"], p["total_amount"], p["timeline"]) == ("QA Round Six Ltd", "a weekly office clean", 5400.0, "12 months")
    assert p["pricing"]["text"] == "£450.00/month × 12 = £5,400.00"


def test_what_was_read_is_shown_as_said_with_its_words():
    from app.modules.agent.orchestrator import extraction_defaults
    fields = [{"key": "description", "type": "textarea"}, {"key": "total", "type": "number"}, {"key": "term", "type": "text"}]
    understood = {"description": f("weekly office clean", "weekly office clean"), "term": f("12 months", "for 12 months", confidence=0.5)}
    shown = {x["key"]: x for x in extraction_defaults(fields, understood, {"description": "weekly office clean"})}
    assert shown["description"]["said"] and shown["description"]["said_text"] == "weekly office clean" and shown["description"]["default"] == "weekly office clean"
    assert shown["term"]["confirm"] is True and shown["term"]["default"] == "12 months"      # not sure: filled in, to confirm
    assert "said" not in shown["total"]      # not said: asked, empty


def test_e1_word_quantities_and_prices_without_a_sign():
    assert [extraction.quantity(x) for x in ("three", "a couple of", "half a dozen", "a dozen", 4, "5")] == [3, 2, 6, 12, 4, 5]
    msg = "bill delta for three office cleans at 150 each, no VAT"
    got = extraction.check("new_invoice", {"fields": {"items": f([{"name": "office cleans", "quantity": "three", "unit_price": "150", "span": "three office cleans at 150 each"}],
                                                                  "three office cleans at 150 each"), "vat_rate": f(0, "no VAT")}}, msg, {}, TODAY)
    assert got["items"]["value"] == [{"product_id": None, "name": "office cleans", "said": "three office cleans at 150 each", "quantity": 3, "unit_price": 150.0}]
    assert got["vat_rate"]["value"] == 0.0


def test_e1_a_line_without_a_price_is_asked_never_priced_at_zero():
    env = _env(vat=0)
    msg = "invoice QA Round Six Ltd for 3 office cleans"
    env.orch.rt.classifier = Reader({msg: {"customer_name": f("c6", "QA Round Six Ltd"), "items": f([{"name": "office cleans", "quantity": 3, "span": "3 office cleans"}], "3 office cleans")}})
    r = env.submit(text=msg)["run"]
    fields = {x["key"]: x for x in r["pending_question"]["fields"]}
    assert fields["items"]["suggested"][0]["name"] == "office cleans" and fields["items"]["suggested"][0]["quantity"] == 3
    assert not (env.fin.get("invoices") or [])      # nothing made at £0


def test_e3_every_field_read_is_listed_with_a_recurring_price_as_one_line():
    fields = {"customer_name": f("Delta Offices Ltd", "Delta Offices Ltd"), "description": f("weekly office clean", "weekly office clean"),
              "price_amount": f(320.0, "£320"), "price_every": f("month", "a month"), "term": f("6 months", "for 6 months")}
    lines = {l["label"]: l["text"] for l in extraction.said_lines("new_contract", fields)}
    assert lines == {"Price": "£320.00/month × 6 = £1,920.00", "Customer": "Delta Offices Ltd", "Scope": "weekly office clean", "Term": "6 months"}
    po = {"vendor_name": f("Fasthosts", "Fasthosts"), "items": f([{"product_id": None, "name": "hosting", "quantity": 2, "unit_price": 20.0}], "2 x hosting at £20")}
    assert {l["label"]: l["text"] for l in extraction.said_lines("new_purchase_order", po)} == {"Supplier": "Fasthosts", "Items": "2 × hosting at £20.00"}


def test_e3_the_question_carries_the_lines():
    msg = "Draft a contract for Delta Offices Ltd, weekly office clean, £320 a month for 6 months"
    env = _env(vat=0)
    env.orch.rt.classifier = Reader({msg: {"customer_name": f("Delta Offices Ltd", "Delta Offices Ltd"), "description": f("weekly office clean", "weekly office clean"),
                                           "price_amount": f(320, "£320"), "price_every": f("month", "a month"), "term": f("6 months", "for 6 months")}})
    r = env.submit(text=msg)["run"]
    said = {l["label"]: l["text"] for l in r["pending_question"]["said"]}      # Delta isn't on record: its email is asked
    assert said["Price"] == "£320.00/month × 6 = £1,920.00" and said["Customer"] == "Delta Offices Ltd" and said["Scope"] == "weekly office clean"


def test_numbers_written_as_words_are_read_in_dates_and_durations():
    msg = "invoice Nova Labs for consulting, 800, due in ten days, valid for thirty days, a contract for twelve months"
    assert extraction._date("due in ten days", "due in ten days", TODAY) == "2026-10-24"
    assert extraction._date("valid for thirty days", "valid for thirty days", TODAY) == "2026-11-13"
    assert extraction._date("within a week", "within a week", TODAY) == "2026-10-21"
    assert extraction._date("due in a fortnight", "due in a fortnight", TODAY) == "2026-10-28"
    assert extraction.duration("twelve months") == "12 months" and extraction.duration("for twenty-four months") == "24 months"
    assert extraction.numerals("three thousand five hundred") == "3500" and extraction.numerals("for a year") == "for a year"
    raw = {"fields": {"due_date": f("in ten days", "due in ten days")}}
    assert extraction.check("new_invoice", raw, msg, {}, TODAY)["due_date"]["value"] == "2026-10-24"


def test_a_paraphrase_is_never_kept_only_the_owners_own_words():
    msg = "Back to Basics Ltd asked what we'd charge to run their payroll, put something together for them"
    raw = {"fields": {"problem": f("they want to know what we'd charge to run their payroll", "asked what we'd charge to run their payroll")}}
    got = extraction.check("new_proposal", raw, msg, {}, TODAY)
    assert got["problem"]["value"] == "asked what we'd charge to run their payroll" and extraction.said_in(got["problem"]["value"], msg)
