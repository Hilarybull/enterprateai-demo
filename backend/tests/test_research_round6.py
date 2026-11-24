"""Round 6 (the owner's QA, 21 Oct), through the real research run: the case's own forecast leads the forecast draft, its
costs follow the sales that revenue implies, a finding already bought is never charged again, and the run says one count."""
import asyncio
import copy

from app.modules.agent import research
from synthetic_workspaces import WORKSPACES
from test_agent import OWNER
from test_premium_research import Model, Pages, Search, _connected, _orch, answers_for  # noqa: F401  (the fixture)

WS = "uk_b2b_software_early_revenue"


def _run(data, answers, balance=100):
    orch, meter = _orch(data, balance)
    r = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="need_funding", answers=answers, data=data,
                                   search=Search(), llm=Model(), fetcher=Pages()))
    return r, meter


def _case(price=4000, cost=1500, fixed=40000, revenue=1_200_000):
    data = copy.deepcopy(WORKSPACES[WS]["data"])
    data["workspace_profile"]["currency"] = "NGN"
    data["case_figures"] = {"price": price, "cost": cost, "fixed_costs": fixed, "monthly_revenue": revenue}
    data["catalogue"] = {"products": [{"id": "p1", "name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}      # agrees with the case
    return data


def test_the_forecast_draft_uses_the_cases_revenue_and_the_costs_of_those_sales():
    data = _case()
    answers = {**answers_for(WS, "need_funding", data), "amount": 5_000_000, "route": "equity"}
    r, _ = _run(data, answers)
    forecast = (r.get("deliverables") or {}).get("forecast") or []
    assert forecast, r.get("deliverables")
    first = forecast[0]
    assert first["revenue"] == 1_200_000
    # 300 sales (₦1,200,000 ÷ ₦4,000) × ₦1,500 + ₦40,000 fixed
    assert first["costs"] == 490_000


def test_a_repeat_finding_is_never_charged_and_the_count_is_one_number():
    data = _case()
    answers = {**answers_for(WS, "need_funding", data), "amount": 5_000_000}
    first, meter = _run(data, answers, balance=500)
    sourced = {x["topic"] for x in first["items"] if x.get("sources") and not x.get("carried_from")}
    assert first["charged"] == 500 - meter.balances[OWNER] > 0 and first["findings"] == len(sourced) == 4
    # Research again (a fresh run): the search brings back the same sources, so nothing new is sold.
    orch, meter2 = _orch(data, 500)
    again = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="need_funding", answers=answers, data=data,
                                       search=Search(), llm=Model(), fetcher=Pages(), fresh=True))
    assert again["id"] != first["id"]
    assert again["findings"] == 0 and again["charged"] == 0 and meter2.balances[OWNER] == 500
