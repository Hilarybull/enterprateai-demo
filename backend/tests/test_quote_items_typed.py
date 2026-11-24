"""QA P0-5: items typed as words in the "A few details" box are read into lines, so the
quotation goes ahead. "Items" is never followed by the same question again as "Items to quote"."""
from app.modules.agent.intent import lines_in_text
from test_agent import OWNER, run
from test_agent_ask_then_deliver import _env, _fields, _one

CATALOGUE = [{"id": "p1", "name": "Office deep clean", "unit_price": 120}, {"id": "p2", "name": "Window clean", "unit_price": 40}]


def test_quantity_and_price_are_read_from_words():
    assert lines_in_text("3 x office deep clean at £150 each", CATALOGUE) == [
        {"product_id": "p1", "name": "Office deep clean", "quantity": 3, "unit_price": 150.0}]
    # A catalogue item with no price typed keeps the catalogue's; one not in the catalogue keeps what was typed.
    assert lines_in_text("2 window clean, carpet shampoo at 60", CATALOGUE) == [
        {"product_id": "p2", "name": "Window clean", "quantity": 2, "unit_price": 40},
        {"product_id": None, "name": "carpet shampoo", "quantity": 1, "unit_price": 60.0}]
    assert lines_in_text("office deep clean x4", CATALOGUE)[0]["quantity"] == 4
    assert lines_in_text("5 hours consulting @ 80 per hour", [])[0] == {"product_id": None, "name": "consulting", "quantity": 5, "unit_price": 80.0}
    # Nothing is invented: an item with no price and no catalogue match has no price.
    assert lines_in_text("logo design", CATALOGUE) == [{"product_id": None, "name": "logo design", "quantity": 1, "unit_price": ""}]


def test_items_typed_in_the_details_box_are_not_asked_again():
    env = _env()
    asked = env.submit(text="need a quotation")["run"]
    assert "items" in _fields(asked)
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": "3 x bookkeeping at £280 each"}))
    assert r["status"] == "awaiting_approval", r.get("pending_question")
    lines = _one(env, r)["payload"]["items"]
    assert [(i.get("description") or i.get("name"), i.get("qty") or i.get("quantity"), i["unit_price"]) for i in lines] == [("Bookkeeping", 3, 280.0)]


def test_items_that_cannot_be_priced_are_asked_about_once_with_what_was_read():
    env = _env()
    asked = env.submit(text="need a quotation")["run"]
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": "2 x logo design"}))
    items = _fields(r)["items"]
    # Asked for the price of what was read, never a blank question.
    assert items["suggested"] == [{"product_id": None, "name": "logo design", "quantity": 2, "unit_price": ""}]
    done = run(env.orch.provide_input(r["id"], OWNER, {"items": [{"name": "logo design", "quantity": 2, "unit_price": 250}]}))
    assert done["status"] == "awaiting_approval"


def test_an_invoice_reads_typed_items_too():
    env = _env()
    asked = env.submit(text="invoice QA Round Six")["run"]
    r = run(env.orch.provide_input(asked["id"], OWNER, {"items": "2 x bookkeeping"}))
    assert r["status"] == "awaiting_approval", r.get("pending_question")
    assert _one(env, r)["payload"]["total"] == 600      # the catalogue's price, nothing invented


def test_r12d_a_typed_name_matches_its_catalogue_item_whatever_the_case_or_ending():
    from app.modules.agent.intent import catalogue_item_named
    cat = [{"id": "p1", "name": "End of tenancy cleaning", "unit_price": 220}]
    assert catalogue_item_named("end of tenancy clean", cat)["id"] == "p1"
    assert catalogue_item_named("END OF TENANCY CLEANING", cat)["id"] == "p1"
    assert catalogue_item_named("gutter clean", cat) is None
    env = _env()
    asked = env.submit(text="need a quotation")["run"]
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": [{"name": "BOOKKEEPING", "quantity": 2}]}))
    assert r["status"] == "awaiting_approval"
    line = _one(env, r)["payload"]["items"][0]
    assert ((line.get("description") or line.get("name")), line["unit_price"]) == ("Bookkeeping", 300)      # the catalogue's item and price
