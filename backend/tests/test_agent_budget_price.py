"""The monthly cap on what the Agent may spend by itself, what each automatic item costs,
and the price test the Agent works out for a growing business."""
from datetime import timedelta

import pytest

from app.modules.agent import autostart
from app.modules.agent import config as agent_config
from app.modules.agent import router as agent_router
from app.modules.agent.summary import build_summary
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run
from test_agent_owner_rule import chores
from test_dashboard import build, growing, invoice


def _overdue(env, n):
    env.fin["invoices"] = [{"id": f"i{k}", "customer_name": "Nova Labs", "customer_email": "dana@novalabs.test", "total_amount": 100, "status": "sent",
                            "due_date": "2026-09-01", "reference": f"INV-{k}"} for k in range(n)]


def _only(env, *keys, cap=None):
    off = {k: False for k in autostart.ITEMS if k not in keys and k != "rfq_arrives"}
    auto = {"auto_start": True, "items": off}
    if cap is not None:
        auto["monthly_credit_cap"] = cap
    run(env.store.set_policy("A", {"automation": auto}, OWNER))


# ══ 5: the cap ════════════════════════════════════════════════════════════════

def test_automatic_work_that_costs_credits_pauses_at_the_cap_and_says_so():
    env = Env()
    _overdue(env, 3)
    _only(env, "invoice_overdue", cap=2)
    for r in run(autostart.sweep(env.orch, "A")):                         # three reminders prepared (preparing is free)
        env.approve(r)                                                    # each one sent costs a credit
    runs = run(env.store.list_runs("A"))
    spend = autostart.budget(run(env.store.get_policy("A")), runs, env.now)
    assert spend == {"cap": 2, "used": 6, "paused": True}                 # three sent at 2 credits each
    _overdue(env, 5)
    for inv in env.fin["invoices"][3:]:
        inv["id"] += "-new"
    assert run(autostart.sweep(env.orch, "A")) == []                      # paused: nothing more is started
    tile = {s["key"]: s for s in run(build_summary(env.orch, OWNER, "A"))["suggestions"]}["budget"]
    assert tile["text"] == "Paused: monthly automatic budget used (6 credits). Raise it in Agent settings." and tile["action"] == {"to": "/agent?settings=1"}
    # Raised by the owner: it carries on. A new month starts the count again.
    run(env.store.set_policy("A", {"automation": {**run(env.store.get_policy("A"))["automation"], "monthly_credit_cap": 20}}, OWNER))
    assert len(run(autostart.sweep(env.orch, "A"))) == 2
    assert autostart.budget({"automation": {"monthly_credit_cap": 2}}, runs, env.now + timedelta(days=31))["used"] == 0


def test_free_work_carries_on_when_the_budget_is_used_and_work_the_owner_asked_for_is_never_counted():
    env = Env()
    _overdue(env, 1)
    _only(env, "invoice_overdue", "registration_checklist", cap=0)        # nothing may be spent automatically
    env.fin["invoices"] = []                                              # before the first invoice: the registration checklist applies
    started = [r["workflow_key"] for r in run(autostart.sweep(env.orch, "A"))]
    assert started == ["registration_checklist"]                          # free, so it still runs
    asked = env.submit(capability="risk_concentration", channel="ui_action")      # the owner's own request is theirs to spend on
    assert asked["kind"] == "workflow"
    assert autostart.budget(run(env.store.get_policy("A")), run(env.store.list_runs("A")), env.now)["used"] == 0


def test_a_marketplace_request_waits_on_its_row_when_the_budget_is_used():
    from app.modules.agent import rfq as agent_rfq
    env = Env()
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test",
                                "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {}, "monthly_credit_cap": 0}}, OWNER))
    assert run(agent_rfq.received(env.orch, "A", "r1")) is None and run(env.store.list_runs("A")) == []
    by_hand = env.submit(capability="enquiry_to_quote", params={"rfq_id": "r1"}, channel="ui_action")      # the owner can still start it
    assert by_hand["kind"] == "workflow"


def test_settings_show_each_items_cost_the_cap_and_what_has_been_used(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        with TestClient(app) as client:
            policy = client.get("/businesses/A/agent/policy").json()
            costs = {e["key"]: e["credits"] for e in policy["events"] if e["key"]}
            assert costs["quote_accepted"] == "2 credits for the invoice draft, 2 when it is sent" and costs["rfq_arrives"] == "2 credits, when the reply is sent"
            assert costs["funding_pack_draft"] == costs["price_test"] == "Free" and all(costs.values())
            assert policy["automatic_budget"] == {"cap": 50, "used": 0, "paused": False}
            saved = client.put("/businesses/A/agent/policy", json={"automation_credit_cap": 120}).json()["policy"]
            assert saved["automation"]["monthly_credit_cap"] == 120 and saved["automation"]["auto_start"] is True
            assert client.put("/businesses/A/agent/policy", json={"automation_credit_cap": -1}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    from app.modules.agent import newdocs
    from app.modules.agent import moredocs
    on_request = {"scenario_help"} | {w.workflow_key for w in newdocs.NEW_WORKFLOWS + moredocs.MORE_WORKFLOWS}      # only ever started by asking
    assert set(agent_config.AUTOMATIC_COST) == set(WORKFLOWS) - on_request      # every capability with an automatic trigger has a stated cost


# ══ the price test ════════════════════════════════════════════════════════════

def _selling(env, cost=None):
    at = env.now.isoformat()
    env.fin["invoices"] = [{"id": "i1", "reference": "INV-1", "customer_name": "BrightTech Ltd", "total_amount": 3000, "status": "paid", "paid_at": at,
                            "created_at": at, "issued_at": env.now.date().isoformat(),
                            "payments": [{"id": "p1", "amount": 3000, "paid_at": at, "receipt": {"number": "REC-1", "sent_at": at}}]}]
    env.businesses["A"]["data"]["catalogue"]["products"] = [{"id": "p1", "name": "Strategy Workshop", "base_price": 1500, **({"cost_of_sales": cost} if cost else {})}]
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))


def test_the_price_test_gives_the_extra_a_month_and_the_break_even_for_five_and_ten_percent():
    env = Env()
    _selling(env, cost=600)                                               # a 60% margin
    r = env.submit(capability="price_test", channel="ui_action")["run"]
    assert r["status"] == "succeeded" and agent_router._public_run(r)["credits_used"] == 2      # asked for by the owner: the task price
    assert r["summary"] == ("+5% price: +£50.00/month if volume holds; break-even volume drop 7.7%. "
                            "+10% price: +£100.00/month if volume holds; break-even volume drop 14.3%. "
                            "Worked out from £1,000.00 a month of paid revenue and a 60% margin (the average margin of the 1 catalogue item with a cost on record).")
    assert r["state"]["outcome"]["price_test"] == [{"pct": 5, "extra_monthly": 50.0, "break_even_volume_drop_pct": 7.7},
                                                   {"pct": 10, "extra_monthly": 100.0, "break_even_volume_drop_pct": 14.3}]
    assert chores([r["summary"], r["next_action"]]) == []


def test_with_no_cost_on_record_it_asks_the_one_thing_only_the_owner_knows_then_carries_on():
    env = Env()
    _selling(env)
    r = env.submit(capability="price_test", channel="ui_action")["run"]
    q = r["pending_question"]
    assert r["substatus"] == "waiting_for_information" and q["question"] == "What does it cost you to deliver your work, as a percentage of the price? (for example 40)"
    assert q["fields"][0]["key"] == "cost_pct" and q["fields"][0]["type"] == "number"
    done = run(env.orch.provide_input(r["id"], OWNER, {"cost_pct": 40}))
    assert done["status"] == "succeeded" and "break-even volume drop 7.7%" in done["summary"] and "(the cost of sales you gave)" in done["summary"]
    none = Env()
    assert none.submit(capability="price_test", channel="ui_action")["run"]["summary"].startswith("A price test works from revenue paid in the last three months, and none is on record yet.")


@pytest.mark.parametrize("plan", agent_config.PLAN_ORDER)
def test_the_price_test_checks_the_plan(plan):
    res = Env(plan=plan).submit(capability="price_test", channel="ui_action")
    assert res["kind"] == ("blocked" if plan == "explorer" else "workflow")


def test_a_growing_business_gets_it_once_a_month_and_the_tile_shows_the_result():
    env = Env()
    growing(env)
    assert build(env)["context"]["business_stage"] == "growth"
    tile = lambda: next(s for s in build(env)["agent"]["suggestions"] if s["key"] == "stage_pricing")      # noqa: E731
    assert tile()["text"] == "I'm testing a 5% and a 10% price change."
    _only(env, "price_test")
    [r] = run(autostart.sweep(env.orch, "A"))
    assert r["workflow_key"] == "price_test" and r["source_reference"] == f"price:test:{env.now:%Y-%m}"
    assert run(autostart.sweep(env.orch, "A")) == []                      # once for the month
    shown = tile()
    if r["status"] == "succeeded":
        assert shown["text"].startswith("+5% price: +£") and "break-even volume drop" in shown["text"] and shown["action"] == {"to": f"/agent/runs/{r['id']}"}
    else:                                                                 # no cost on record for this business: the question, in place
        assert shown["text"] == r["pending_question"]["question"]
    assert chores([shown["text"]]) == []
