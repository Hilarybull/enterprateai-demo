"""B3 held-out: one request per Business Operations task, said the way owners say it, with what the request states.
Each must reach its task, and every detail it states must be read (shown filled in or used), never asked for blank.
Run on the rules path (no model): the model only helps when the rules are unsure."""
import pytest

from test_agent import Env
from test_agent_more_documents import _env

CASES = [
    ("new_invoice", "Invoice Nova Labs £1,200 for the website build", {"customer": "Nova Labs", "amount": 1200, "item": "'website build'"}),
    ("enquiry_to_quote", "Quote QA Round Six Ltd for 3 x Bookkeeping", {"customer": "QA Round Six"}),
    ("new_contract", "New contract for QA Round Six Ltd: weekly office clean, £450 a month for 12 months", {"scope": "Weekly office clean"}),
    ("new_proposal", "write a proposal for QA Round Six for £4,500", {"amount": 4500}),
    ("record_expense", "Record an expense of £42 for cleaning supplies from Costco today", {"vendor": "Costco", "amount": 42}),
    ("add_customer", "Add customer Nova Labs, dana@novalabs.test", {"customer": "Nova Labs", "email": "dana@novalabs.test"}),
    ("add_vendor", "add a supplier called Fasthosts, billing@fasthosts.test", {"vendor": "Fasthosts"}),
    ("add_catalogue_item", "Add Oven deep clean to my catalogue at £65", {"name": "Oven deep clean", "amount": 65}),
    ("update_record", "rename Bookkeeping to Monthly bookkeeping", {}),
    ("new_purchase_order", "Raise a purchase order to Fasthosts for 2 x hosting at £20", {"vendor": "Fasthosts"}),
    ("payment_followup", "chase up the unpaid invoices", {}),
]


def _said(r: dict) -> str:
    """Everything the task shows or has: its form's defaults, its summary and its records."""
    q = r.get("pending_question") or {}
    return " ".join([str(f.get("default") or "") + " " + str(f.get("suggested") or "") for f in q.get("fields") or []]
                    + [str(r.get("summary") or ""), str(q.get("question") or "")])


@pytest.mark.parametrize("capability,text,stated", CASES, ids=[c[0] for c in CASES])
def test_each_business_operations_request_reaches_its_task_and_keeps_what_it_says(capability, text, stated):
    env = _env(vat=0)
    env.meter.balances["owner@a.test"] = 100
    if capability == "payment_followup":      # something to chase
        env.fin["invoices"] = [{"id": "i1", "reference": "INV-1", "customer_name": "QA Round Six Ltd", "customer_email": "qa@six.test", "total_amount": 300,
                                "status": "sent", "issued_at": "2026-08-01", "due_date": "2026-09-01"}]
    res = env.submit(text=text)
    r = res.get("run") or {}
    assert r.get("workflow_key") == capability, (text, res.get("kind"), res.get("message"))
    shown = _said(r) + " " + str(env.fin) + " " + str(env.businesses["A"]["data"].get("catalogue"))
    for what, value in stated.items():
        assert str(value).lower().replace(",", "") in shown.lower().replace(",", ""), (text, what, value)
