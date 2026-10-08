"""The currency someone names is the currency of the document. From the demo: "$50" was drafted as £50.00."""
from test_agent import OWNER, Env, run


def _invoice(env, text, answers=None):
    r = env.submit(text=text)["run"]
    if r["status"] != "awaiting_approval":
        r = run(env.orch.provide_input(r["id"], OWNER, answers or {}))
    return r, env.pending(r)[0]["payload"]


def test_a_named_currency_is_used_even_when_no_form_is_shown():
    env = Env()
    _, drafted = _invoice(env, "invoice BrightTech Ltd $50 for a Strategy Workshop")
    assert drafted["currency"] == "USD"                                     # dollars, as typed
    _, coded = _invoice(Env(), "invoice BrightTech Ltd 50 EUR for a Strategy Workshop")
    assert coded["currency"] == "EUR"


def test_with_no_currency_named_the_customers_is_used_then_the_business_default():
    env = Env()
    _, plain = _invoice(env, "invoice BrightTech Ltd 50 for a Strategy Workshop")
    assert plain["currency"] == "GBP"                                       # the business default
    theirs = Env()
    theirs.businesses["A"]["data"]["catalogue"]["customers"][0]["currency"] = "EUR"
    _, drafted = _invoice(theirs, "invoice BrightTech Ltd 50 for a Strategy Workshop")
    assert drafted["currency"] == "EUR"                                     # this customer is billed in euros
