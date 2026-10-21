"""What to do next after a funding check (the owner's brief, 21 Oct): for a ₦5m loan with no price or cost, no forecast
and no plan, the three are: set the wash price and cost (free, the price worked out from the chat), see if the loan pays
back, and draft the business plan. A locked feature says which plan has it."""
from test_agent import OWNER
from test_case_kept_between_chats import FIRST, _chat
from test_goal_onboarding import world  # noqa: F401 - the fixture

from app.modules.agent import next_actions


def test_the_three_next_actions_for_a_loan_with_no_price_forecast_or_plan(world):  # noqa: F811
    env, store, client, who = world
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["catalogue"] = {"products": []}      # no price or cost yet (the acceptance case)
    for k in ("business_plan", "live_plan", "blueprint"):
        d.pop(k, None)
    sid, _ = _chat(client, who, FIRST)
    who["user"] = OWNER
    out = client.get(f"/task-sessions/{sid}/next-actions").json()
    items = out["items"]
    assert len(items) <= 3 and items, out
    keys = [i["key"] for i in items]
    assert keys[0] == "catalogue" and "scenario" in keys and "plan" in keys, keys
    first = items[0]
    assert first["cost"] == "Free" and first["prefill"]["price"] == 4000 and first["title"].startswith("Set your")
    loan = next(i for i in items if i["key"] == "scenario")
    assert loan["title"] == "See if the ₦5m loan pays back" and loan["reason"] == "Your forecast doesn't include repayments yet"      # the case's drafted forecast
    for i in items:
        assert len(i["title"].split()) <= 8 and not any(c in i["title"] + i["reason"] for c in "–—")


def test_a_locked_feature_names_its_plan_and_one_waiting_is_left_out():
    result = {"blockers": [{"key": "financial", "kind": "unknown"}, {"key": "materials", "kind": "unknown"}], "score": 30}
    answers = {"amount": 5_000_000, "route": "loan", "use": "2 more washing bays"}
    items = next_actions.recommend(result, answers, {}, plan="explorer", prices={"expansion_scenario": 4, "business_plan_draft": 20},
                                   pending={"business_plan_draft"}, currency="NGN")
    keys = [i["key"] for i in items]
    assert "plan" not in keys      # already waiting in Needs Approval
    locked = [i for i in items if not i["allowed"]]
    assert all(i["cost"].endswith("plan") and i["upgrade"]["to"] == "/pricing" for i in locked)


def test_saving_the_price_and_cost_rechecks_and_refreshes_the_list(world):  # noqa: F811
    env, store, client, who = world
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["catalogue"] = {"products": []}
    sid, _ = _chat(client, who, FIRST)
    who["user"] = OWNER
    before = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    assert "economics" in {b["key"] for b in before["blockers"]}
    saved = client.post("/businesses/A/catalogue/from-check", json={"name": "Car wash", "base_price": 4000, "cost_of_sales": 1500, "currency": "NGN"})
    assert saved.status_code == 200 and saved.json()["product"]["currency"] == "NGN"
    after = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    assert "economics" not in {b["key"] for b in after["blockers"]}      # checked again, free
    assert "catalogue" not in [i["key"] for i in client.get(f"/task-sessions/{sid}/next-actions").json()["items"]]
