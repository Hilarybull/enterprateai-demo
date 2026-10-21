"""Round 9 (the owner's live QA, 21 Oct): Research again keeps what was adopted and dismissed, a typed change at the
recap is read and acknowledged as that change, and the opening of the chat is never lost."""
import asyncio
import copy

from app.modules.agent import goals, research
from synthetic_workspaces import WORKSPACES
from test_agent import OWNER
from test_premium_research import Model, Pages, Search, _connected, _orch, answers_for  # noqa: F401  (the fixture)
from test_thread_kept_when_saved import CopyingStore

WS = "uk_b2b_software_early_revenue"


def _start(data, answers, orch, fresh=False):
    return asyncio.run(research.start(orch, user={"id": OWNER}, business_id="W", goal="need_funding", answers=answers, data=data,
                                      search=Search(), llm=Model(), fetcher=Pages(), fresh=fresh))


def test_research_again_keeps_adopted_and_dismissed_drafts():
    data = copy.deepcopy(WORKSPACES[WS]["data"])
    data["workspace_profile"]["currency"] = "NGN"
    data["case_figures"] = {"price": 4000, "cost": 1500, "fixed_costs": 40000, "monthly_revenue": 1_200_000}
    data["catalogue"] = {"products": [{"id": "p1", "name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}      # agrees with the case
    answers = {**answers_for(WS, "need_funding", data), "amount": 5_000_000}
    orch, _m = _orch(data, 500)
    first = _start(data, answers, orch)
    drafts = research.step_drafts(first, first["items"])
    keep, drop = drafts[0], drafts[1]
    asyncio.run(research.review(orch, user={"id": OWNER}, business_id="W", run_id=first["id"],
                                decisions={keep["id"]: {"decision": "accept"}, drop["id"]: {"decision": "reject"}}))
    again = _start(data, answers, orch, fresh=True)
    assert again["id"] != first["id"]
    by_key = {research._draft_key(x): x for x in again["items"]}
    assert by_key[research._draft_key(keep)]["decision"] == "accepted"
    assert by_key[research._draft_key(drop)]["decision"] == "rejected"
    assert again["drafts"]["open"] == again["drafts"]["total"] - 2
    assert again["decisions"][by_key[research._draft_key(keep)]["id"]] == {"decision": "accept"}
    # What the new run brings that wasn't decided before is still open, and none of the kept ones is marked new.
    assert not by_key[research._draft_key(keep)].get("new")


def test_a_changed_draft_is_marked_new():
    earlier = [{"items": [{"id": "a", "derive": "forecast", "criterion": "financial", "value": "Cash after 12 months: ₦1", "decision": "accepted"}]}]
    items = [{"id": "b", "derive": "forecast", "criterion": "financial", "value": "Cash after 12 months: ₦2", "decision": None}]
    assert research.carry_decisions(items, earlier) == {} and items[0]["new"] is True and items[0]["decision"] is None


def test_a_change_typed_at_the_recap_is_read_and_said_as_that_change():
    store = CopyingStore()
    s = asyncio.run(goals.start(store, text="I need 5 million naira to expand my car wash with 2 more washing bays, we are trading, about 300 cars a month",
                                key=None, entry_mode="free_text"))
    for v in ("Equity", "In 3 to 6 months", "300 cars a month"):
        s = asyncio.run(goals.add_inputs(store, s, {}, message=v, asked=s["turns"][-1].get("next"), rules_only=True))
    assert s["inputs"]["route"] == "equity"
    s = asyncio.run(goals.add_inputs(store, s, {}, message="actually make it a loan", asked=None, rules_only=True))
    assert s["inputs"]["route"] == "loan"
    assert s["turns"][-1]["content"] == "Got it, a loan. Here's what I'll use now."
    assert s["turns"][0]["content"].startswith("I need 5 million naira")      # the opening kept


def test_the_case_forecast_asks_before_using_a_cost_the_catalogue_disagrees_with():
    from datetime import date
    from app.modules.readiness.rules import FUNDING
    from app.modules.readiness.service import ReadinessService
    row = {"kind": FUNDING, "data": {"economics": {"price": "1000", "direct_cost": "60", "fixed_costs_monthly": "40000"}, "traction": {"monthly_revenue": "1200000"}}}
    data = {"settings": {"currency": "NGN"}, "catalogue": {"products": [{"id": "p", "name": "Wash", "base_price": 4000, "cost_of_sales": 1500}]}}
    draft = ReadinessService._forecast_draft(None, row, {"data": data, "today": date(2026, 10, 21)})
    asks = {a["field"]: a for a in draft["asks"] if a.get("conflict")}
    assert set(asks) == {"price", "cost"} and asks["cost"]["choices"] == [60.0, 1500.0]
    assert all(m["payments"] is None for m in draft["months"])      # never drafted with ₦60 silently
    # Chosen on the case: never asked again.
    row["data"]["economics"]["confirmed_at"] = "2026-10-21"
    again = ReadinessService._forecast_draft(None, row, {"data": data, "today": date(2026, 10, 21)})
    assert not [a for a in again["asks"] if a.get("conflict")] and again["months"][0]["payments"] == "112000"      # ₦1,200,000 at ₦1,000 is 1,200 sales × ₦60 + ₦40,000


def test_an_edited_and_adopted_forecast_stays_adopted_and_a_changed_one_says_what_changed():
    earlier = [{"items": [{"id": "a", "derive": "forecast", "criterion": "financial", "value": "Cash after 12 months: ₦1", "decision": "edited",
                           "edited_value": "₦2", "used": {"monthly_revenue": 1_200_000.0, "cost": 1500.0}}]}]
    same = [{"id": "b", "derive": "forecast", "criterion": "financial", "value": "Cash after 12 months: ₦9", "decision": None,
             "used": {"monthly_revenue": 1_200_000.0, "cost": 1500.0}}]
    assert research.carry_decisions(same, earlier, "NGN") == {"b": {"decision": "edit", "value": "₦2"}} and not same[0].get("new")
    moved = [{"id": "c", "derive": "forecast", "criterion": "financial", "value": "x", "decision": None, "used": {"monthly_revenue": 1_500_000.0, "cost": 1500.0}}]
    research.carry_decisions(moved, earlier, "NGN")
    assert moved[0]["new"] and moved[0]["changed"] == ["Revenue each month now ₦1,500,000"]


def test_sales_that_do_not_match_the_revenue_are_asked():
    i = {"monthly_sales": 300.0, "price": 1000.0, "monthly_revenue": 1_200_000.0}
    research.sales_mismatch(i, "NGN")
    assert i["_conflicts"]["monthly_sales"]["question"] == ("Your figures don't add up: 300 sales a month at ₦1,000 is ₦300,000, not ₦1,200,000. "
                                                           "How many sales a month do you make? (1200 would match)")
    ok = {"monthly_sales": 300.0, "price": 4000.0, "monthly_revenue": 1_200_000.0}
    research.sales_mismatch(ok, "NGN")
    assert "_conflicts" not in ok
