"""B-1: a what-if is run for the customer who was named, or not at all.
B-2: what each task cost is recorded on the task and shown with it."""
import pytest

from app.modules.agent import router as agent_router
from app.modules.agent.workflows import _match_customer, _named_customer
from test_agent import ENQUIRY, OWNER, Env, run


def _trading(env):
    def paid(n, who, amount):
        at = env.now.isoformat()
        return {"id": f"i{n}", "reference": f"INV-{n}", "customer_name": who, "total_amount": amount, "status": "paid", "paid_at": at,
                "created_at": at, "issued_at": env.now.date().isoformat(),
                "payments": [{"id": f"p{n}", "amount": amount, "paid_at": at, "receipt": {"number": f"REC-{n}", "sent_at": at}}]}
    env.fin["invoices"] = [paid(1, "QA Round Six Ltd", 6000), paid(2, "Nova Labs", 3000)]
    env.fin["quotes"] = [{"id": "q1", "reference": "QUO-1", "customer_name": "Frank", "status": "draft", "total_amount": 200, "amount": 200}]
    env.businesses["A"]["data"]["catalogue"]["customers"] += [{"id": "c9", "name": "Frank", "email": "frank@example.test"}]
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))


# ══ B-1 ═══════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("text", ["run a what-if on losing Nova Labs", "If I lose Nova Labs then what happens?", "what if I lose nova labs?"])
def test_the_named_customer_is_the_one_analysed(text):
    env = Env()
    _trading(env)
    r = env.submit(text=text)["run"]
    assert r["status"] == "succeeded" and r["summary"].startswith("If you lost Nova Labs (33.3% of all your revenue")
    assert r["state"]["outcome"]["simulation"]["customer"] == "Nova Labs" and "QA Round Six" not in r["summary"].split("Recommended")[0]


@pytest.mark.parametrize("text", ["run a what-if on losing Frank", "If I lose Frank then what happens?"])
def test_a_customer_with_no_paid_revenue_gets_that_answer_and_nobody_else_is_analysed(text):
    env = Env()
    _trading(env)
    r = env.submit(text=text)["run"]
    assert r["status"] == "succeeded"
    assert r["summary"] == "Frank has no paid revenue on record, so losing them changes nothing today; they have a £200.00 draft quote."
    assert "QA Round Six" not in r["summary"] and r["state"]["outcome"] == {"reason": "no_customer_revenue", "customer": "Frank", "skipped": True}
    assert env.meter.charges == [] and r["state"].get("credits") is None      # nothing was analysed, so nothing was charged


def test_a_name_that_isnt_a_customer_is_said_plainly_and_nobody_else_is_analysed():
    env = Env()
    _trading(env)
    r = env.submit(text="what if I lose Zebedee Holdings")["run"]
    assert r["summary"] == "“Zebedee Holdings” isn't one of your customers on record, so I haven't run this for anyone else."
    assert r["state"]["outcome"]["reason"] == "customer_not_found" and env.meter.charges == []


def test_a_name_that_matches_more_than_one_customer_is_asked_about():
    env = Env()
    _trading(env)
    env.fin["invoices"][1]["customer_name"] = "Nova Labs North"
    env.businesses["A"]["data"]["catalogue"]["customers"] += [{"id": "c8", "name": "Nova Labs South", "email": "south@nova.test"}]
    r = env.submit(text="what if I lose Nova Labs")["run"]
    q = r["pending_question"]
    assert r["substatus"] == "waiting_for_information" and q["question"] == "“Nova Labs” matches more than one customer. Which one do you mean?"
    assert [o["value"] for o in q["fields"][0]["options"]] == ["Nova Labs North", "Nova Labs South"] and env.meter.charges == []
    done = run(env.orch.provide_input(r["id"], OWNER, {"customer": "Nova Labs North"}))
    assert done["status"] == "succeeded" and done["summary"].startswith("If you lost Nova Labs North (")


def test_my_biggest_client_still_means_the_largest_and_a_lapsed_customer_is_described_as_lapsed():
    env = Env()
    _trading(env)
    assert env.submit(text="what if I lose my biggest client")["run"]["summary"].startswith("If you lost QA Round Six Ltd")
    assert env.submit(text="what happens if I lose my largest customer?")["run"]["summary"].startswith("If you lost QA Round Six Ltd")
    env.fin["invoices"].append({"id": "i9", "reference": "INV-9", "customer_name": "Old Friend Ltd", "total_amount": 500, "status": "paid",
                                "paid_at": "2026-01-10T09:00:00+00:00", "issued_at": "2026-01-05"})
    assert env.submit(text="what if I lose Old Friend Ltd")["run"]["summary"] == \
        "Old Friend Ltd has had no paid revenue in the last three months, so losing them changes nothing today."


def test_reading_the_name_out_of_the_sentence():
    assert _named_customer("Frank then what happens") == "Frank" and _named_customer("my customer Nova Labs, and what then?") == "Nova Labs"
    assert _named_customer("QA Round Six Ltd?") == "QA Round Six Ltd" and _named_customer("the client Frank") == "Frank"
    names = ["Frank", "Frankfurt Bakery", "Nova Labs North", "Nova Labs South"]
    assert _match_customer("frank", names) == ["Frank"]                   # the exact name wins; "Frankfurt" is not "Frank"
    assert _match_customer("Nova Labs", names) == ["Nova Labs North", "Nova Labs South"] and _match_customer("Zed", names) == []


# ══ B-2 ═══════════════════════════════════════════════════════════════════════

def test_each_task_records_what_it_cost_and_the_total_matches_the_wallet():
    env = Env()
    _trading(env)
    res = env.submit(text="Check my concentration risk and then run a what-if on losing Nova Labs")
    risk, what_if = (agent_router._public_run(r["run"]) for r in res["results"])
    assert (risk["credits_used"], what_if["credits_used"]) == (2, 2)
    assert risk["credits"][0]["what"] == "Risk or scenario analysis" and risk["credits"][0]["credits"] == 2
    assert sum(cost for _, _, cost in env.meter.charges) == 4 == risk["credits_used"] + what_if["credits_used"]
    assert env.meter.balances[OWNER] == 96


def test_a_quotation_shows_the_draft_and_the_send_separately_and_a_declined_one_only_the_draft():
    env = Env()
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]
    assert agent_router._public_run(r)["credits"] == [{"what": "Preparing the quotation", "credits": 2, "at": env.now.isoformat()}]
    sent = agent_router._public_run(env.approve(r))
    assert sent["credits_used"] == 4 and [c["what"] for c in sent["credits"]] == ["Preparing the quotation", "Sending the document"]
    other = Env()
    declined = other.approve(other.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"], ok=False)
    assert agent_router._public_run(declined)["credits_used"] == 2 and other.meter.balances[OWNER] == 98


def test_the_recorded_cost_follows_the_price_list_and_free_work_records_nothing():
    env = Env()
    _trading(env)
    env.meter.costs["agent_analyse"] = 2                                  # an admin has set the price to 2
    r = env.submit(capability="risk_concentration", channel="ui_action")["run"]
    assert agent_router._public_run(r)["credits_used"] == 2 and env.meter.balances[OWNER] == 98
    answer = env.submit(text="What is my biggest risk?")                  # answered from records: no task, no charge
    assert answer["kind"] == "answer" and env.meter.balances[OWNER] == 98
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test",
                                "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    rfq = env.submit(capability="enquiry_to_quote", params={"rfq_id": "r1"}, channel="ui_action")["run"]
    assert agent_router._public_run(rfq)["credits_used"] == 0             # a marketplace reply costs nothing until it is sent
    assert agent_router._public_run(env.approve(rfq))["credits"][0]["what"] == "Replying to the marketplace request"
