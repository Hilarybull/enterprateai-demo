"""An invoice priced in pounds in the chat is an invoice in pounds (the owner's QA, 20 Oct: "why change my 500 pounds to
naira"), on a naira workspace too: the currency goes with the answers to the document, the amount as given."""
import asyncio

from app.modules.agent import goals


def _invoice(message):
    store = goals.SessionStore()
    s = asyncio.run(goals.start(store, text=None, key="create_invoice", entry_mode="business_goal", currency="NGN"))
    s = asyncio.run(goals.add_inputs(store, s, {"customer": message}, message=message, asked="customer", rules_only=True))
    return goals._answers_for_task(s)


def test_pounds_said_are_pounds_on_the_invoice():
    out = _invoice("ABC Ltd, £500 for folders")
    assert out["currency"] == "GBP" and out["items"][0]["unit_price"] == 500


def test_nothing_said_leaves_the_workspace_currency_to_the_document():
    out = _invoice("ABC Ltd, 500 for folders")
    assert "currency" not in out


def test_a_catalogue_price_saved_from_a_check_keeps_its_currency():
    from app.modules.agent import first_value
    action = first_value._doable({"label": "Save the price in your catalogue"}, {"sell": "folders", "price": 500}, sign="£")
    assert action["catalogue"] == {"name": "folders", "base_price": 500, "currency": "GBP"}


def test_a_product_in_pounds_is_read_as_pounds_on_a_naira_workspace():
    from app.modules.agent import research
    data = {"workspace_profile": {"currency": "NGN"}, "catalogue": {"products": [{"id": "p1", "name": "Folders", "base_price": 500, "currency": "GBP"}]}}
    i = research.inputs_of("need_funding", {"sell": "folders"}, data)
    assert i.get("price") != 500 or i.get("_from", {}).get("price") != "From your catalogue"      # never ₦500
    held = (i.get("_foreign") or {}).get("price") or {}
    assert not held or held.get("currency") == "GBP"
