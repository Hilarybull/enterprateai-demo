"""Round 7 (the owner's live QA, 21 Oct): the owner's edited figure is theirs, one draft adopted at a time keeps the
others, the latest chat beats an older answer, the case's price and cost are checked against the catalogue, and the
case's forecast counts the costs of the sales its revenue implies."""
import asyncio
import copy
from datetime import date, timedelta

from app.modules.agent import next_actions, research
from app.modules.agent.goal_router import case_figures_of
from app.modules.readiness.rules import FUNDING
from app.modules.readiness.service import ReadinessService
from synthetic_workspaces import WORKSPACES
from test_agent import OWNER
from test_premium_research import Model, Pages, Search, _connected, _orch, answers_for  # noqa: F401  (the fixture)
from test_goal_onboarding import world  # noqa: F401 - the fixture

WS = "uk_b2b_software_early_revenue"
TODAY = date(2026, 10, 21)
INVOICES = [{"id": f"i{n}", "status": "paid", "total_amount": 30000, "customer_name": f"C{n % 4}",
             "paid_at": (TODAY - timedelta(days=3 + n * 3)).isoformat()} for n in range(30)]


def _subject():
    """A case whose price and cost are still as copied from the records, and whose revenue the owner changed."""
    return {"data": {"economics": {"price": "1000", "direct_cost": "60", "fixed_costs_monthly": "40000"},
                     "traction": {"monthly_revenue": "1200000"},
                     "filled_from_records": ["economics.direct_cost", "economics.price", "traction.monthly_revenue"],
                     # an edit drops the field's provenance: the revenue has none left
                     "provenance": {"economics.price": {"value": "1000", "source": "your invoices"},
                                    "economics.direct_cost": {"value": "60", "source": "your records"}}},
            "forecast": {"data": {"months": [{"month": f"2026-{m:02d}", "receipts": "1,200,000" if m % 2 else 1200000} for m in range(1, 13)]}}}


def test_an_edited_figure_is_the_owners_and_a_copied_one_is_not():
    figures = case_figures_of(_subject(), "need_funding")
    # the price and cost the case shows travel too, so a different figure elsewhere is asked about first
    assert figures == {"fixed_costs": 40000.0, "monthly_revenue": 1200000.0, "_on_case": {"price": 1000.0, "cost": 60.0}}


def test_research_again_drafts_the_cases_revenue_and_the_costs_of_those_sales():
    data = copy.deepcopy(WORKSPACES[WS]["data"])
    data["workspace_profile"]["currency"] = "NGN"
    data["settings"] = {"currency": "NGN"}      # a workspace in naira, as the owner's
    data["financials"] = {"invoices": INVOICES}      # about ₦300,000 a month on record: never the case's revenue
    data["catalogue"] = {"products": [{"id": "p1", "name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}
    data["case_figures"] = case_figures_of(_subject(), "need_funding")
    answers = {**answers_for(WS, "need_funding", data), "amount": 5_000_000}
    orch, _meter = _orch(data, 500)
    r = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="need_funding", answers=answers, data=data,
                                   search=Search(), llm=Model(), fetcher=Pages()))
    # The case says ₦1,000 and ₦60, the catalogue ₦4,000 and ₦1,500: asked first, nothing drafted over it (the owner's QA, 21 Oct).
    asked = {x["field"]: x for x in r["items"] if x.get("kind") == "question" and x.get("conflict")}
    assert asked["price"]["question"] == "Your case says ₦1,000 a sale; your catalogue says ₦4,000. Which is right?"
    assert asked["cost"]["question"] == "Your case says ₦60 cost per sale; your catalogue says ₦1,500. Which is right?"
    assert not (r["deliverables"] or {}).get("forecast")
    # The catalogue's figures chosen: the forecast is drafted from them, ₦1,200,000 in and ₦490,000 out.
    out = asyncio.run(research.review(orch, user={"id": OWNER}, business_id="W", run_id=r["id"], decisions={
        asked["price"]["id"]: {"decision": "answer", "value": "4000"}, asked["cost"]["id"]: {"decision": "answer", "value": "1500"}}))
    first = out["deliverables"]["forecast"][0]
    assert (first["revenue"], first["costs"]) == (1_200_000, 490_000)      # 300 sales × ₦1,500 + ₦40,000


def _reviewed():
    data = copy.deepcopy(WORKSPACES[WS]["data"])
    data["workspace_profile"]["currency"] = "NGN"
    data["case_figures"] = {"price": 4000, "cost": 1500, "fixed_costs": 40000, "monthly_revenue": 1_200_000}
    data["catalogue"] = {"products": [{"id": "p1", "name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}      # agrees with the case
    answers = {**answers_for(WS, "need_funding", data), "amount": 5_000_000}
    orch, _meter = _orch(data, 500)
    run = asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="need_funding", answers=answers, data=data,
                                     search=Search(), llm=Model(), fetcher=Pages()))
    return orch, data, run


def test_adopting_one_draft_keeps_the_others_to_adopt():
    orch, data, run = _reviewed()
    drafts = research.step_drafts(run, run["items"])
    assert len(drafts) >= 3
    one = drafts[0]
    out = asyncio.run(research.review(orch, user={"id": OWNER}, business_id="W", run_id=run["id"], decisions={one["id"]: {"decision": "accept"}}))
    assert out["status"] == "review" and out["drafts"] == {"total": len(drafts), "adopted": 1, "open": len(drafts) - 1}
    left = {x["id"]: x for x in out["items"]}
    assert all(left[d["id"]]["decision"] is None for d in drafts[1:])
    assert all(left[d["id"]].get("value") for d in drafts[1:] if d.get("derive"))      # still drafted, with their figures
    # The next adopt remembers the first; the last one closes the review.
    rest = {d["id"]: {"decision": "accept"} for d in drafts[1:]}
    done = asyncio.run(research.review(orch, user={"id": OWNER}, business_id="W", run_id=run["id"], decisions=rest))
    assert done["status"] == "adopted" and done["drafts"]["adopted"] == len(drafts)
    assert {x["id"]: x for x in done["items"]}[one["id"]]["decision"] == "accepted"


def test_the_latest_chat_beats_an_older_answer():
    run = {"id": "rr_1", "goal": "need_funding", "status": "review", "answers": {"traction": "40 paying customers"}, "inputs": {}, "inputs_from": {},
           "items": [{"id": "c1", "kind": "reused", "private": True, "field": "contracts", "criterion": "demand", "label": "Paying customers",
                      "value": "40 paying customers", "source_note": "your answer", "decision": None}]}
    data = {"workspace_profile": {"currency": "NGN"}, "quick_check_answers": {"need_funding": {"answers": {"traction": "No traction yet"}}}}
    out = research.redraft(run, data)
    q = next(x for x in out["items"] if x["id"] == "c1")
    assert q["kind"] == "question" and q["question"] == "Earlier you said 40 paying customers; today you said No traction yet. Which is right?"
    assert q["options"] == ["40 paying customers", "No traction yet"]


def test_the_cases_price_and_cost_are_checked_against_the_catalogue():
    data = {"workspace_profile": {"currency": "NGN"}, "catalogue": {"products": [{"id": "p1", "name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}}
    result = {"blockers": [{"key": "financial", "kind": "unknown"}], "score": 22}
    items = next_actions.recommend(result, {"amount": 5_000_000, "route": "equity"}, data, plan="strategic_business_os", prices={}, pending=set(),
                                   currency="NGN", case_forecast=True, case_economics={"price": "1000", "cost": "60"})
    first = items[0]
    assert first["key"] == "catalogue" and first["kind"] == "inline" and first["prefill"]["conflict"] is True
    assert first["reason"] == "Your catalogue says ₦4,000 a sale and ₦1,500 cost; your case says ₦1,000 and ₦60. Which is right?"
    # The same figures: nothing to ask.
    same = next_actions.recommend(result, {"amount": 5_000_000}, data, plan="strategic_business_os", prices={}, pending=set(),
                                  currency="NGN", case_forecast=True, case_economics={"price": 4000, "cost": 1500})
    assert all(x["key"] != "catalogue" for x in same)
    # With a forecast on the case, the scenario says what it lacks.
    scenario = next(x for x in items if x["key"] == "scenario")
    assert scenario["reason"] == "Your forecast doesn't show the funding yet"


def test_the_cases_forecast_counts_the_costs_of_the_sales_its_revenue_implies():
    # price and cost chosen by the owner (the invoices' average says otherwise): theirs, drafted from at once
    row = {"kind": FUNDING, "data": {"economics": {"price": "4000", "direct_cost": "1500", "fixed_costs_monthly": "40000", "confirmed_at": "2026-10-21"},
                                     "traction": {"monthly_revenue": "1200000"}}}
    data = {"workspace_profile": {"currency": "NGN"}, "financials": {"invoices": INVOICES}}
    draft = ReadinessService._forecast_draft(None, row, {"data": data, "today": TODAY})
    m = draft["months"][0]
    # The case says ₦1,200,000 a month, the invoices about ₦300,000: asked first, nothing guessed.
    ask = next(a for a in draft["asks"] if a["field"] == "monthly_revenue")
    assert ask["conflict"] and ask["choices"] == [1_200_000, 300_000] and m["receipts"] is None and m["payments"] is None
    # Answered (the case's own): drafted from it, ₦1,200,000 in and ₦490,000 out.
    row["data"]["traction"]["confirmed_at"] = "2026-10-21"
    draft = ReadinessService._forecast_draft(None, row, {"data": data, "today": TODAY})
    m = draft["months"][0]
    assert (float(m["receipts"]), float(m["payments"])) == (1_200_000, 490_000)
    notes = {n["applies_to"]: n["text"] for n in draft["assumptions"]}
    assert notes["payments"] == "₦1,500 a sale for 300 sales, plus ₦40,000 fixed costs a month"
    assert notes["receipts"] == "₦1,200,000 a month, as you gave it"


def test_adopt_replies_before_a_slow_case_check(world, monkeypatch):  # noqa: F811
    import time
    from app.modules.agent import assessment_summary, goal_router
    from test_apply_keeps_one_result import _setup
    env, store, client, who = world
    _setup(env, client, who)
    slow = {"done": False}

    async def feed(*_a, **_k):
        await asyncio.sleep(1.5)
        slow["done"] = True
        return {"score": 40}
    monkeypatch.setattr(assessment_summary, "feed", feed)
    monkeypatch.setattr(goal_router, "REVIEW_CHECK_SECONDS", 0.05)
    run = client.get("/businesses/A/research/rr_old").json()["research"]
    one = next(i for i in run["items"] if i.get("derive"))
    t0 = time.perf_counter()
    out = client.post("/businesses/A/research/rr_old/review", json={"decisions": {one["id"]: {"decision": "accept"}}})
    assert out.status_code == 200, out.text
    assert time.perf_counter() - t0 < 1.4 and out.json()["checking"] is True and not slow["done"]
