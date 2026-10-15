"""After research is adopted, the dashboard card is the result as the research left it, with its next step first (the
funding pack for a funding check): never the first answers again."""
from app.modules.agent import first_value, goals
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401


def test_the_card_shows_the_adopted_result_and_recommends_the_funding_pack():
    adopted = {**first_value.assess("need_funding", {"amount": 10000}, {}), "score": 61}
    data = {"assessment_datasets": {"need_funding": [{"version": 1, "created_at": "2026-10-13T10:00:00+00:00", "full_result": {**adopted, "score": 40}},
                                                     {"version": 2, "created_at": "2026-10-14T18:20:00+00:00", "full_result": adopted}]}}
    out = goals.first_value_of({"goal_key": "need_funding", "inputs": {"amount": 10000}}, data)
    assert out["score"] == 61 and out["adopted"]["version"] == 2
    assert out["free_next_actions"][0] == {"label": "Draft my funding pack", "capability": "funding_pack_draft"}


def test_with_nothing_adopted_the_card_is_worked_out_from_the_answers():
    out = goals.first_value_of({"goal_key": "need_funding", "inputs": {"amount": 10000}}, {})
    assert "adopted" not in out


def test_agent_centre_results_lists_the_latest_result_of_each_check(world):
    """Agent Centre > Results: a quick check's result and one updated by adopted research, newest first, each with its
    band, key numbers and gaps (the same at-a-glance fields the dashboard shows)."""
    env, store, client, who = world
    who["user"] = OWNER
    data = env.businesses["A"]["data"]
    pricing = first_value.assess("price_offer", {"sell": "Cupcake boxes", "customer": "HR teams", "price": 30, "cost": 12, "monthly_sales": 40, "positioning": "premium"}, {})
    data["quick_check_answers"] = {"price_offer": {"answers": {}, "at": "2026-10-13T10:00:00+00:00", "result": pricing}}
    funded = first_value.assess("need_funding", {"amount": 25000}, {})
    data["assessment_datasets"] = {"need_funding": [{"version": 2, "created_at": "2026-10-14T18:00:00+00:00", "full_result": funded}]}
    items = client.get("/businesses/A/first-results").json()["items"]
    assert [i["goal_key"] for i in items] == ["need_funding", "price_offer"] and items[0]["adopted"] == 2
    assert items[1]["band"] == "Strong" and items[1]["result"]["key_numbers"][:2] == ["£30 price", "60% margin"]
    assert items[1]["result"]["gaps"]["unknown"] == ["comparable prices", "customer price sensitivity"]
