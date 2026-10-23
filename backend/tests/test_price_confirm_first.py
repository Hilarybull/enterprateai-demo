"""P0.5c (QA, 15 Oct): no charge without a shown price. A task priced by its own product (a business plan, a sales
letter, sizing a market) asked for in chat or from a button returns its price first, starts nothing and holds nothing;
with the price accepted it starts."""
from test_agent import OWNER, Env, run


def test_a_business_plan_shows_its_price_first_and_holds_nothing():
    env = Env()
    before = env.meter.balances.get(OWNER)
    out = env.submit(capability="business_plan_draft", params={"answers": {"description": "Mobile car wash"}}, channel="ui_action", confirmed=False)
    assert out["kind"] == "needs_confirmation" and out["price"] == 40
    assert out["message"].startswith("I'll write your business plan. It costs 40 credits")
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == [] and env.meter.balances.get(OWNER) == before
    typed = env.submit(text="write a business plan for my car wash", confirmed=False)
    assert typed["kind"] == "needs_input" and run(env.store.list_runs("A")) == []      # its questions first (23 Oct), nothing held
    answered = env.submit(capability="business_plan_draft", params={"purpose": "investors"}, channel="ui_action", confirmed=False)
    assert answered["kind"] == "needs_confirmation" and "40 credits" in answered["message"] and answered["params"]["purpose"] == "investors"
    started = env.submit(capability="business_plan_draft", params={"answers": {"description": "Mobile car wash"}}, channel="ui_action", confirmed=True)
    assert started["kind"] == "workflow"


def test_basic_idea_validation_is_free_and_needs_no_confirm_and_comprehensive_shows_its_price():
    env = Env()
    env.meter.plans[OWNER] = "explorer"      # Explorer: Basic, free, no confirm (never Comprehensive)
    out = env.submit(capability="idea_validation", params={"answers": {"description": "Mobile car wash"}}, channel="ui_action", confirmed=False)
    assert out["kind"] != "needs_confirmation"
    paid = Env()
    paid.meter.plans[OWNER] = "starter_insight"      # a paid plan: Comprehensive, its price first
    out = paid.submit(capability="idea_validation", params={"answers": {"description": "Mobile car wash"}, "depth": "comprehensive"}, channel="ui_action", confirmed=False)
    assert out["kind"] == "needs_confirmation" and out["price"] == 25 and out["params"]["depth"] == "comprehensive"
    quick = paid.submit(text="just a quick check of my mobile car wash idea", channel="text", confirmed=False)
    assert quick["kind"] != "needs_confirmation"      # "a quick check": Basic, said so
