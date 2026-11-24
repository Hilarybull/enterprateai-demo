"""QA round 4: typed answers read on the server (U2), one question per field across a task (U3), and a payment
follow-up with nothing to chase said as it is (U7)."""
import pytest

from app.modules.agent.orchestrator import Conflict
from test_agent import OWNER, run
from test_agent_ask_then_deliver import _env
from test_dashboard import invoice

BRIGHTWAY = "I need a quotation for a new customer called Brightway Ltd"


def _no_vat_default():
    env = _env(vat=None)
    env.store.policies["A"] = {"contract_route": "direct_invoice"}
    return env


def _walk(env, said, answers):
    """Answers each question the task asks, in order, and returns the field keys of each question."""
    r = env.submit(text=said)["run"]
    rounds = []
    for _ in range(8):
        q = r.get("pending_question")
        if not q:
            break
        rounds.append([f["key"] for f in q["fields"]])
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: answers[f["key"]] for f in q["fields"] if f["key"] in answers}))
    return r, rounds


ANSWERS = {"customer_name": "Brightway Ltd", "customer_email": "ops@brightway.test",
           "items": [{"name": "Office deep clean", "quantity": 3, "unit_price": 150}], "vat_rate": "standard rate"}


def test_the_brightway_quotation_is_asked_in_one_go_and_vat_once():
    env = _no_vat_default()
    r, rounds = _walk(env, BRIGHTWAY, ANSWERS)
    assert r["status"] == "awaiting_approval"
    assert len(rounds) == 1, rounds                           # one dialog: the total is known when the task first asks
    asked = [k for keys in rounds for k in keys]
    assert asked.count("vat_rate") == 1 and len(asked) == len(set(asked))      # every field asked once
    assert r["state"]["answers"]["vat_rate"] == 20.0          # "standard rate", read on the server (U2)


def test_save_as_default_goes_with_the_vat_question_not_as_its_own():
    env = _no_vat_default()
    r = env.submit(text=BRIGHTWAY)["run"]
    fields = {f["key"]: f for f in r["pending_question"]["fields"]}
    assert fields["save_vat_default"]["companion_of"] == "vat_rate"


@pytest.mark.parametrize("typed, read", [("standard rate", 20.0), ("20%", 20.0), ("zero rated", 0.0), ("0", 0.0), ("12.5", 12.5)])
def test_a_vat_rate_typed_in_the_modal_is_read(typed, read):
    env = _no_vat_default()
    r = env.submit(text=BRIGHTWAY)["run"]
    r = run(env.orch.provide_input(r["id"], OWNER, {**ANSWERS, "vat_rate": typed}))
    assert r["state"]["answers"]["vat_rate"] == read


def test_a_discount_typed_in_words_is_read_and_nonsense_is_refused():
    env = _no_vat_default()
    r = env.submit(text=BRIGHTWAY)["run"]
    with pytest.raises(Conflict):
        run(env.orch.provide_input(r["id"], OWNER, {**ANSWERS, "discount": {"type": "percent", "value": "loads"}}))
    r = run(env.orch.provide_input(r["id"], OWNER, {**ANSWERS, "discount": {"type": "percent", "value": "10%"}}))
    assert r["state"]["answers"]["discount"] == {"type": "percent", "value": 10.0}


def test_with_no_invoices_at_all_a_payment_follow_up_never_says_every_invoice_is_paid():
    env = _env()
    res = env.submit(text="send a payment reminder")
    assert res["kind"] == "answer"
    assert res["message"] == "You haven't sent any invoices yet, so there is no one to remind."
    assert "every invoice" not in res["message"]


def test_a_draft_alone_is_not_an_invoice_sent():
    env = _env()
    invoice(env, "d1", "QA Round Six Ltd", 300, paid=False, status="draft")
    assert env.submit(text="send a payment reminder")["message"] == "You haven't sent any invoices yet, so there is no one to remind."


def test_with_every_invoice_paid_it_says_there_are_no_unpaid_invoices():
    env = _env()
    invoice(env, "p1", "QA Round Six Ltd", 300, paid=True)
    res = env.submit(text="send a payment reminder")
    assert res["message"] == "You have no unpaid invoices, so there is no one to remind."
