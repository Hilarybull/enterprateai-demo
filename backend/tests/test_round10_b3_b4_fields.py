"""B3: names and details are read from the request without the command or connecting words, and nothing stated is
asked again. B4: a cost not given is unknown (None), never 0, so the margin isn't shown as 100%."""
import pytest

import app.modules.agent.orchestrator  # noqa: F401  (loads the Agent first: newdocs builds on it)
from app.modules.agent.newdocs import item_name_in
from test_agent import OWNER, Env, run


@pytest.mark.parametrize("text,name", [
    ("Add Oven deep clean to my catalogue at £65", "Oven deep clean"),
    ("add a product called Window clean at £40", "Window clean"),
    ("add service: Gutter clean, £80", "Gutter clean"),
    ("Put deep oven clean on my price list for £70", "deep oven clean"),
])
def test_an_item_name_is_only_the_name(text, name):
    assert item_name_in(text) == name


def test_adding_an_item_reads_name_and_price_and_keeps_an_unknown_cost_unknown():
    env = Env(plan="starter_insight", credits=50)
    r = env.submit(text="Add Oven deep clean to my catalogue at £65")["run"]
    assert r["workflow_key"] == "add_catalogue_item"
    fields = {f["key"]: f for f in r["pending_question"]["fields"]}
    assert fields["name"]["default"] == "Oven deep clean" and fields["price"]["default"] == 65
    r = run(env.orch.provide_input(r["id"], OWNER, {"name": "Oven deep clean", "price": 65, "cost": ""}))
    item = next(p for p in env.businesses["A"]["data"]["catalogue"]["products"] if p["name"] == "Oven deep clean")
    assert item["cost_of_sales"] is None and "margin isn't shown" in r["summary"]


def test_an_expense_reads_supplier_description_and_date_from_the_sentence():
    env = Env(plan="starter_insight", credits=50)
    r = env.submit(text="Record an expense of £42 for cleaning supplies from Costco today")["run"]
    fields = {f["key"]: f.get("default") for f in r["pending_question"]["fields"]}
    assert fields["vendor_name"] == "Costco" and fields["description"] == "cleaning supplies" and fields["amount"] == 42.0
    assert fields["date"] == env.now.date().isoformat()
