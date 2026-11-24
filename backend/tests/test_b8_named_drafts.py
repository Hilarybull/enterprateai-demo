"""B8: a message about an invoice that is still a draft says what state it is in and offers the next step (approve and
send it, or mark it issued, and paid, when the owner handed it over themselves), never "no invoice is waiting" or "ask me
for a new invoice" while a draft waits for approval."""
from test_agent import OWNER, Env, run


def _draft(env):
    r = env.submit(text="invoice BrightTech Ltd for a Strategy Workshop")["run"]
    assert r["status"] == "awaiting_approval", r.get("pending_question")
    inv = env.fin["invoices"][-1]
    return r, inv, inv.get("reference") or inv.get("invoice_number")


def test_a_payment_for_a_draft_says_it_is_a_draft_and_offers_both_ways_on():
    env = Env()
    _, inv, ref = _draft(env)
    res = env.submit(text=f"BrightTech paid {ref}")
    assert "run" in res, (ref, res)
    r = res["run"]
    q = r["pending_question"]
    assert ref in q["question"] and "draft waiting for your approval" in q["question"] and "Ask me for a new invoice" not in str(r)
    assert [o["value"] for o in q["fields"][0]["options"]] == ["issued_paid", "issued", "approve"]


def test_handed_over_in_person_it_is_issued_paid_and_never_emailed_as_well():
    env = Env()
    sending, inv, ref = _draft(env)
    r = env.submit(text=f"record a payment for {ref}")["run"]
    r = run(env.orch.provide_input(r["id"], OWNER, {"draft_choice": "issued_paid"}))
    if r.get("pending_question"):      # the payment form: how much, when, how
        r = run(env.orch.provide_input(r["id"], OWNER, {"amount": "", "paid_at": "2026-10-14", "method": "Cash"}))
    assert r["status"] == "succeeded" and "paid in full" in r["summary"]
    assert inv["issued_outside_app"] is True and inv["status"] == "paid"
    assert env.pending(sending) == [] and run(env.store.get_run(sending["id"]))["status"] == "cancelled"      # the Agent's send is withdrawn
    assert env.comms.sent == []                                                                              # nothing emailed


def test_with_only_drafts_the_reply_names_them_instead_of_asking_for_a_new_invoice():
    env = Env()
    _, inv, ref = _draft(env)
    r = env.submit(capability="record_payment", channel="ui_action")["run"]
    assert ref in r["summary"] and "Ask me for a new invoice" not in (r.get("next_action") or "")
    assert "draft waiting for your approval" in r["summary"]


def test_a_credit_note_for_a_named_draft_says_it_is_a_draft():
    env = Env()
    _, inv, ref = _draft(env)
    r = env.submit(text=f"credit note for {ref}, the job was cancelled")["run"]
    assert ref in r["summary"] and "is a draft" in r["summary"] and "No invoice has been sent yet" not in r["summary"]


def test_rules_read_an_amount_back_as_the_amount_never_as_the_reason():
    env = Env()
    _, inv, ref = _draft(env)
    env.approve(_)                                                         # sent, so it can be credited
    r = env.submit(text=f"credit note for {ref}, 150 back, the job was cancelled")["run"]
    f = {x["key"]: x.get("default") for x in r["pending_question"]["fields"]}
    assert f["amount"] == 150 and f["reason"] == "the job was cancelled"
