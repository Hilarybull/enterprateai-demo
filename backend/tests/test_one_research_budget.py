"""Everything on the result for the check's price (the owner's QA, 20 Oct: "it should do everything here at 60 credits"):
the steps' own prices are shares of one budget, a step already done is never charged again, and "Do all" after a step
costs only what is left. One step's research is never reopened in place of all of them."""
from datetime import datetime, timezone

from app.modules.agent import first_value, research

ANSWERS = {"amount": 25000, "use": "stock", "stage": "trading", "timing": "In 3 to 6 months", "route": "loan", "traction": "40 customers"}
DATA = {"business_profile": {"country": "United Kingdom"}}


def _plan(data):
    result = first_value.assess("need_funding", ANSWERS, data)
    i = research.inputs_of("need_funding", ANSWERS, data)
    return result, i, research.context_of(data, i)


def test_the_shares_add_up_to_the_price_exactly():
    s = research.shares(60, [f"t{n}" for n in range(7)])
    assert sum(s.values()) == 60 and sorted(s.values(), reverse=True) == [9, 9, 9, 9, 8, 8, 8]
    assert research.shares(60, []) == {} and sum(research.shares(0, ["a", "b"]).values()) == 0


def test_every_step_together_never_costs_more_than_the_check():
    result, i, ctx = _plan(DATA)
    out = research.step_prices("need_funding", result, i, ctx, 60, True, DATA, ANSWERS)
    assert out["all"] <= 60 and sum(out["steps"].values()) <= 60
    assert any(out["steps"].values())      # there is research to do for this case


def test_a_step_done_is_free_and_do_all_costs_only_what_is_left():
    result, i, ctx = _plan(DATA)
    plan = research.priced_plan("need_funding", result, i, ctx, 60, DATA, ANSWERS)
    step = next(t["criterion"] for t in plan["topics"])
    mine = [t["topic"] for t in plan["topics"] if t["criterion"] == step]
    paid = sum(plan["share"][t] for t in mine)
    run = {"id": "rr_step", "goal": "need_funding", "status": "review", "created_at": datetime.now(timezone.utc).isoformat(), "charged": paid,
           "topics": mine, "only": [step], "base": plan["base"], "answers": ANSWERS, "inputs": {}, "context": ctx,
           "fingerprint": plan["base"] + ":" + step, "counts": {"sources": 1}}
    data = {**DATA, "research_runs": {"rr_step": run}}
    out = research.step_prices("need_funding", result, i, ctx, 60, True, data, ANSWERS)
    assert out["steps"][step] == 0 and step in out["done"]
    # A full funding run is the list price, every new run (the owner, 28 Oct): one step's own price stays its share
    assert out["spent"] == paid and out["all"] == 60
    assert paid + sum(out["steps"].values()) <= 60
    # "Do all" never reopens one step's research; the same step does, free.
    assert research.reuse_for(data, "need_funding", plan["base"], ANSWERS) is None
    assert research.reuse_for(data, "need_funding", plan["base"] + ":" + step, ANSWERS, only=[step])["id"] == "rr_step"
    # And "Do all" leaves out what that step already paid for.
    after = research.priced_plan("need_funding", result, i, ctx, 60, data, ANSWERS)
    assert not set(mine) & {t["topic"] for t in after["topics"]} and after["price"] == 60
