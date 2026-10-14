"""B3 (part): "Rename X to Y" renames the record, saved as said, instead of a form asking what should change, and the
chat never says it can't."""
import pytest

from test_agent import Env


@pytest.mark.parametrize("text", [
    'Rename the catalogue item "Oven deep clean to my catalogue" to "Oven deep clean"',
    "rename Oven deep clean to my catalogue to Oven deep clean",
    "change the name of the product Oven deep clean to my catalogue to Oven deep clean.",
])
def test_rename_saves_the_new_name_and_keeps_the_price(text):
    env = Env(plan="explorer", credits=20)
    products = env.businesses["A"]["data"]["catalogue"]["products"]
    products.append({"id": "px", "name": "Oven deep clean to my catalogue", "base_price": 65})
    r = env.submit(text=text)["run"]
    assert r["workflow_key"] == "update_record" and r["status"] == "succeeded", r.get("pending_question")
    item = next(p for p in products if p["id"] == "px")
    assert item["name"] == "Oven deep clean" and item["base_price"] == 65
