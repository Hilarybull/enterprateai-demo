"""B1: a recurring price is kept with how often and for how long, totalled, and shown as such ("£450.00/month × 12 =
£5,400.00") on the record, the approval and the email; the term said in the request isn't asked again.
B2: a contract's scope comes from the request, is asked for if it isn't there, and is never the customer's name."""
from app.modules.agent.said import pricing_text, recurring_in, scope_in
from test_agent import OWNER, run
from test_agent_more_documents import _answer, _env


def test_the_reader_keeps_how_often_and_how_long():
    assert recurring_in("£450 a month for 12 months") == {"amount": 450.0, "every": "month", "count": 12, "total": 5400.0}
    assert recurring_in("£1,200 per year for three years")["total"] == 3600.0
    assert recurring_in("£450 monthly for 1 year")["count"] == 12 and recurring_in("a one-off £900 website") is None
    assert pricing_text(recurring_in("£450 a month for 12 months")) == "£450.00/month × 12 = £5,400.00"


def test_a_contract_from_one_sentence_has_its_scope_term_and_total():
    env = _env(vat=0)
    r = env.submit(text="New contract for QA Round Six Ltd: weekly office clean, £450 a month for 12 months")["run"]
    assert not r.get("pending_question")      # everything was in the sentence: nothing asked again
    c = env.fin["contracts"][0]
    assert (c["description"], c["term"], c["amount"]) == ("Weekly office clean", "12 months", 5400.0)
    assert c["pricing"] == {"kind": "recurring", "amount": 450.0, "every": "month", "count": 12, "total": 5400.0, "text": "£450.00/month × 12 = £5,400.00"}
    a = env.pending(r)[0]
    assert a["payload"]["price_text"] == "£450.00/month × 12 = £5,400.00" and a["payload"]["description"] == "Weekly office clean"
    env.approve(r)
    assert "Value: £450.00/month × 12 = £5,400.00" in env.comms.sent[-1]["text"]


def test_a_contract_without_a_scope_asks_for_it_and_never_uses_the_name():
    assert scope_in("Create a contract for Frank", "Frank") == ""
    env = _env(vat=0)
    r = env.submit(text="New contract for QA Round Six Ltd at £450 a month for 12 months")["run"]
    fields = {f["key"]: f for f in r["pending_question"]["fields"]}
    assert fields["description"]["default"] == "" and fields["description"]["required"] is True
    assert fields["term"]["default"] == "12 months" and fields["total"]["default"] == 5400.0


def test_a_proposal_keeps_the_recurring_price():
    env = _env()
    asked = env.submit(text="write a proposal for QA Round Six for £450 a month for 12 months")["run"]
    fields = {f["key"]: f for f in asked["pending_question"]["fields"]}
    assert fields["total"]["default"] == 5400.0 and fields["total"]["hint"] == "£450.00/month × 12 = £5,400.00" and fields["timeline"]["default"] == "12 months"
    r = _answer(env, asked, {"problem": "Offices are cleaned badly.", "solution": "A weekly deep clean.", "total": 5400, "timeline": "12 months"})
    assert env.fin["proposals"][0]["pricing"]["text"] == "£450.00/month × 12 = £5,400.00"
    assert env.pending(r)[0]["payload"]["price_text"] == "£450.00/month × 12 = £5,400.00"
