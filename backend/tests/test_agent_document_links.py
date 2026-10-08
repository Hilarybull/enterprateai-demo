"""Every document the Agent emails carries a link to open it online, as the Share button in
Business Operations does. Before this only the quotation had one."""
from datetime import timedelta

from app.modules.agent import documents as docs
from test_agent import OWNER, run
from test_agent_more_documents import _env


def _send(env, text, answers=None):
    r = env.submit(text=text)["run"]
    if answers is not None:
        r = run(env.orch.provide_input(r["id"], OWNER, answers))
    assert r["status"] == "awaiting_approval", (text, r.get("pending_question"), r.get("error"))
    before = len(env.comms.sent)
    env.approve(r)
    assert len(env.comms.sent) == before + 1, text
    return env.comms.sent[-1]


def test_the_invoice_email_has_a_link_to_the_invoice_online_and_the_page_has_what_it_needs():
    env = _env()
    mail = _send(env, "invoice QA Round Six for 2 months bookkeeping")
    link = "https://example.test/invoice?t=doc1"
    assert f"View invoice online:\n{link}\n" in mail["text"] and mail["text"].index(link) < mail["text"].index("Kind regards")
    shared = env.comms.documents[0]
    inv = env.fin["invoices"][-1]
    assert (shared["type"], shared["ref"], shared["party"], shared["amount"], shared["currency"]) == ("invoice", inv["reference"], "QA Round Six Ltd", 600, "GBP")
    assert shared["line_items"] == [{"description": "Bookkeeping", "qty": 2, "unit_price": 300}] and shared["workspaceName"] and shared["due_date"] == inv["due_date"]


def test_every_other_document_the_agent_sends_has_its_link_too():
    env = _env()
    proposal = _send(env, "write a proposal for QA Round Six for £4,500", {"solution": "We take over bookkeeping.", "total": 4500})
    order = _send(env, "raise a purchase order for Fasthosts", {"items": [{"name": "Server", "quantity": 1, "unit_price": 80}]})
    assert "View proposal online:\nhttps://example.test/invoice?t=doc1" in proposal["text"]
    assert "View purchase order online:\nhttps://example.test/invoice?t=doc2" in order["text"]
    assert [d["type"] for d in env.comms.documents] == ["proposal", "purchase order"]
    assert env.comms.documents[0]["amount"] == 4500 and env.comms.documents[1]["line_items"][0]["description"] == "Server"
    # An invoice, then a credit note against it.
    _send(env, "invoice QA Round Six for 2 months bookkeeping")
    inv = env.fin["invoices"][-1]
    note = _send(env, f"credit note for {inv['reference']}", {"invoice_id": inv["id"], "amount": 50, "reason": "Goodwill"})
    assert "View credit note online:\nhttps://example.test/invoice?t=doc4" in note["text"]


def test_a_reminder_and_a_receipt_link_to_the_invoice_and_the_receipt():
    env = _env()
    _send(env, "invoice QA Round Six for 2 months bookkeeping")
    inv = env.fin["invoices"][-1]
    inv["due_date"] = (env.now - timedelta(days=10)).date().isoformat()
    reminder = _send(env, f"remind QA Round Six about {inv['reference']}")
    assert "View invoice online:\nhttps://example.test/invoice?t=doc2" in reminder["text"]
    assert env.comms.documents[1]["type"] == "invoice" and env.comms.documents[1]["amount"] == 600      # what is still owed


def test_an_email_still_goes_when_a_link_cannot_be_made_and_the_template_leaves_nothing_behind():
    env = _env()
    env.comms.no_document_links = True
    mail = _send(env, "invoice QA Round Six for 2 months bookkeeping")
    assert "online" not in mail["text"] and "Kind regards" in mail["text"]      # sent as it always was
    plain = docs.invoice_email({"currency": "GBP", "reference": "INV-1", "company": "Apex", "customer_name": "Frank", "items": [{"description": "Work", "qty": 1, "unit_price": 100}],
                                "subtotal": 100, "vat_rate": 0, "vat_amount": 0, "total": 100, "due_date": "2026-11-01"})
    without = docs.with_link(plain, "View invoice online", None)
    assert "<!--view-online-->" not in without["html"] and without["text"] == plain["text"]
    linked = docs.with_link(plain, "View invoice online", "https://example.test/invoice?t=abc")
    assert 'href="https://example.test/invoice?t=abc"' in linked["html"] and ">View invoice online</a>" in linked["html"] and "<!--view-online-->" not in linked["html"]
    assert linked["html"].index("View invoice online") < linked["html"].index("Kind regards")
