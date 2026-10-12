"""QA P2-4: payment terms on a quotation are never a silent default: the draft says where they came
from, and a change made by the owner says so instead."""
from test_agent import OWNER, run
from test_agent_ask_then_deliver import _env, _one


def test_the_terms_say_they_come_from_the_default_settings():
    env = _env()
    asked = env.submit(text="need a quotation")["run"]
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": [{"product_id": "p4", "quantity": 1}]}))
    p = _one(env, r)["payload"]
    assert p["payment_terms"] == "Net 14 days" and p["payment_terms_source"] == "from your default settings"
