"""B7: "Customer accepted QUO-x" goes to Quote to Cash (never a blank New Invoice), follows the "After a quote is accepted"
setting, and copies the quotation's items into the invoice. A quotation that was never sent is said to be so, with
the offer to send it or mark it accepted."""
from test_agent import OWNER, ENQUIRY, Env, quoted, run


def _setting(env, route):
    run(env.store.set_policy("A", {"contract_route": route}, OWNER))


def test_customer_accepted_goes_to_quote_to_cash_follows_the_setting_and_copies_the_items():
    env = Env()
    quoted(env)
    q = env.fin["quotes"][0]
    _setting(env, "direct_invoice")
    r = env.submit(text=f"Customer accepted {q['reference']}")["run"]
    assert r["workflow_key"] == "quote_to_cash" and not r.get("pending_question"), r.get("pending_question")      # not asked again
    approvals = env.pending(r)
    assert approvals and approvals[0]["tool_id"] == "send_invoice"
    inv = env.fin["invoices"][-1]
    copied = [(i["description"], float(i["qty"]), float(i["unit_price"])) for i in inv.get("line_items") or []]
    quoted_items = [(i["product_name"], float(i["quantity"]), float(i["unit_price"])) for i in q.get("items") or []]
    assert copied == quoted_items and copied and inv["quote_id"] == q["id"]


def test_with_the_setting_on_ask_the_route_is_asked_and_acceptance_is_not():
    env = Env()
    quoted(env)
    _setting(env, "ask")
    r = env.submit(text=f"{env.fin['quotes'][0]['reference']} was accepted, invoice it")["run"]
    assert r["workflow_key"] == "quote_to_cash" and r["pending_question"]["fields"][0]["key"] == "route"


def test_a_quote_never_sent_is_said_and_offers_send_or_mark_accepted():
    env = Env()
    draft = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]      # drafted, waiting for approval, never sent
    q = env.fin["quotes"][0]
    assert q.get("status") in ("draft", "pending_approval", "awaiting_approval", None) or draft["status"] == "awaiting_approval"
    r = env.submit(text=f"the customer accepted {q['reference']}")["run"]
    pq = r["pending_question"]
    assert "was never sent" in pq["question"] and [o["value"] for o in pq["fields"][0]["options"]] == ["send", "accepted", "no"]
    _setting(env, "direct_invoice")
    r = run(env.orch.provide_input(r["id"], OWNER, {"unsent_quote": "accepted"}))
    assert env.pending(r) and env.pending(r)[0]["tool_id"] == "send_invoice"      # marked accepted, then invoiced as set


def test_a_quote_already_invoiced_is_said_so_and_no_second_invoice_is_made():
    env = Env()
    quoted(env)
    q = env.fin["quotes"][0]
    _setting(env, "direct_invoice")
    env.submit(text=f"Customer accepted {q['reference']}")
    before = len(env.fin["invoices"])
    res = env.submit(text=f"Customer accepted {q['reference']}")
    assert res["kind"] == "answer" and "already been invoiced" in res["message"] and len(env.fin["invoices"]) == before
