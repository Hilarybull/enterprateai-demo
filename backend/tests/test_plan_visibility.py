"""Nothing a plan keeps locked is shown by any route. On Explorer a request for a quotation
arrives, but who sent it, their email, what they asked for and their message stay locked:
in the list, in what the Agent reads and says, in any task, and in the email to the owner."""
import json

import pytest

from app.modules.marketplace import service as mkt
from test_agent import OWNER, Env, run
from test_agent_rfq import WORKSHOPS, Market

# Someone the business has never dealt with, so nothing about them is in its own records.
BUYER = {"customer_name": "Zephyr Holdings Plc", "customer_email": "procurement@zephyr-holdings.test"}

MESSAGE = "Could you quote for two workshops in May, please?"


def _secrets():
    """Everything about the request that Explorer must never see."""
    words = [str(v) for v in BUYER.values() if isinstance(v, str) and len(v) > 3] + [MESSAGE]
    words += [str(i["name"]) for i in WORKSHOPS if len(str(i.get("name") or "")) > 3 and str(i["name"]) not in ("Strategy Workshop", "Financial Review")]
    return words


def _nowhere(text, where):
    for secret in _secrets():
        assert secret not in text, f"{secret!r} is shown in {where}"


ASKS = ["who sent my latest request for a quotation?", "what is the buyer's email on my latest RFQ?", "what did they ask for in the marketplace request, and what was their message?",
        "show me my requests for quotation"]


def test_explorer_never_sees_a_locked_request_by_any_route(monkeypatch):
    env = Env(plan="explorer", credits=50)
    market = Market(monkeypatch, env)
    rfq = market.request(buyer=BUYER)
    # The list: that one arrived, and nothing about it.
    listed = run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))
    assert listed["locked"] is True and len(listed["items"]) == 1
    _nowhere(json.dumps(listed), "the list of requests")
    # Any email sent about it (none goes to the owner today): never whose it is or what it asks for.
    _nowhere(json.dumps(market.emails, default=str), "the email to the owner")
    # The Agent: asked every way, it never says it.
    for ask in ASKS:
        _nowhere(json.dumps(env.submit(text=ask), default=str), f"the Agent's reply to {ask!r}")
    # What the Agent reads from is redacted before it reaches any prompt.
    _nowhere(json.dumps(run(env.orch.visible_data("A")), default=str), "what the Agent reads")
    # A task from the request is refused for the plan: no run, no charge.
    asked = env.submit(capability="enquiry_to_quote", params={"rfq_id": rfq["id"]}, channel="ui_action")
    assert asked["kind"] == "blocked" and asked["reason"] == "plan" and asked["upgrade"] is True
    assert market.runs() == [] and env.meter.charges == []
    _nowhere(json.dumps(asked, default=str), "the refusal")
    _nowhere(json.dumps(run(env.store.list_runs("A")), default=str), "the task records")
    _nowhere(json.dumps(run(env.store.list_enquiries("A")), default=str), "the enquiries")


def test_starter_sees_everything_and_an_upgrade_or_a_downgrade_takes_effect_at_once(monkeypatch):
    env = Env(plan="starter_insight", credits=50)
    market = Market(monkeypatch, env)
    market.request(buyer=BUYER)
    row = run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))
    assert row.get("locked") is not True and row["items"][0]["customer_email"] == BUYER["customer_email"]
    assert MESSAGE in json.dumps(row)                                       # on Starter the whole request is there
    env.meter.plans[OWNER] = "explorer"                                     # downgraded: locked again, straight away
    down = run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))
    assert down["locked"] is True
    _nowhere(json.dumps(down), "the list after a downgrade")
    locked_again = (run(env.orch.visible_data("A")).get("financials") or {}).get("rfq_requests") or []
    _nowhere(json.dumps(locked_again, default=str), "the requests the Agent reads after a downgrade")
    env.meter.plans[OWNER] = "starter_insight"                              # upgraded again: unlocked, in full
    assert run(mkt.list_rfqs(user_id=OWNER, workspace_id="A"))["items"][0]["customer_email"] == BUYER["customer_email"]


def test_several_requests_in_one_message_run_what_the_plan_includes_and_refuse_the_rest():
    env = Env(plan="explorer", credits=50)
    res = env.submit(text="invoice BrightTech Ltd $50 for a Strategy Workshop and then run a scenario simulation")
    assert res["kind"] == "multi" and len(res["results"]) == 2
    invoice, scenario = res["results"]
    assert invoice["kind"] == "workflow" and invoice["capability"] == "new_invoice"
    assert scenario["kind"] == "blocked" and scenario["reason"] == "plan" and scenario["message"] == "Scenario Help is on the Starter plan."
    assert [r["workflow_key"] for r in run(env.store.list_runs("A"))] == ["new_invoice"]      # one task, not two
    assert [c[1:] for c in env.meter.charges] == [("agent_invoice_draft", 2)]                  # charged for the invoice only
