"""The homepage check's answers reach the workspace at sign-in, and the result card's free actions do the thing:
the catalogue ones save the offering and its price, "Create a quotation" opens a new quotation."""
from datetime import datetime, timezone

from app.modules.agent import first_value, goals
from test_agent import OUTSIDER, OWNER
from test_goal_onboarding import world  # noqa: F401  (the fixture)

PRICING = {"sell": "Deep clean", "price": "120", "cost": "45", "customer": "Busy households"}


def _actions(result):
    return {a["label"]: a for a in result["free_next_actions"]}


def test_the_pricing_actions_carry_what_to_save_and_where_to_go():
    a = _actions(first_value.assess("price_offer", PRICING, {}))
    assert a["Save the price in your catalogue"]["catalogue"] == {"name": "Deep clean", "base_price": 120.0, "cost_of_sales": 45.0, "currency": "GBP"}
    assert a["Create a quotation"]["to"] == "/operations?tab=Sales&sub=Quotations&new=quote"
    no_price = _actions(first_value.assess("price_offer", {"sell": "Deep clean"}, {}))
    assert "catalogue" not in no_price["Save the price in your catalogue"]      # nothing to save: the page, to add it there


def test_the_answers_go_into_the_workspace_at_sign_in():
    data = {}
    session = {"goal_key": "price_offer", "inputs": PRICING, "currency": "GBP"}
    goals._keep_answers(data, session, datetime(2026, 10, 13, tzinfo=timezone.utc))
    kept = data["quick_check_answers"]["price_offer"]
    assert kept["answers"]["price"] == "120" and kept["result"]["assessment_type"] == "pricing_health_initial"
    assert data["shared_answers"]["sell"]["value"] == "Deep clean"
    untouched = {}
    goals._keep_answers(untouched, {"goal_key": "create_invoice", "inputs": {"customer": "X"}}, datetime.now(timezone.utc))
    assert untouched == {}      # a document task has no check to keep


def test_save_the_price_adds_then_updates_one_catalogue_item(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OWNER
    env.businesses["A"]["data"].setdefault("catalogue", {})["products"] = []
    r = client.post("/businesses/A/catalogue/from-check", json={"name": "Deep clean", "base_price": 120, "cost_of_sales": 45}).json()
    assert r["created"] and r["product"]["base_price"] == 120
    r = client.post("/businesses/A/catalogue/from-check", json={"name": "deep  clean", "base_price": 130}).json()
    products = env.businesses["A"]["data"]["catalogue"]["products"]
    assert not r["created"] and len(products) == 1 and products[0]["base_price"] == 130 and products[0]["cost_of_sales"] == 45


def test_someone_without_access_cannot_save_to_the_catalogue(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OUTSIDER
    assert client.post("/businesses/A/catalogue/from-check", json={"name": "Deep clean", "base_price": 120}).status_code == 404
