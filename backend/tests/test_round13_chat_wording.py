"""The owner, 26 Oct: "got it: the quantity: 10", "the vat rate: 7.5", VAT as "7.50" or "0" with no total, and "...Lagos., nice"."""
from app.modules.agent import goals
from app.modules.agent.intake_turn import acknowledgement

SLOTS = {q["key"]: q for q in goals.questions_for("create_invoice")}


def test_figures_are_said_in_words():
    said = acknowledgement({"quantity": 10, "vat_rate": 7.5}, SLOTS, {}, "NGN")
    assert "the quantity" not in said and "the vat rate" not in said
    assert "10 of them" in said and "VAT at 7.5%" in said
    assert "no VAT" in acknowledgement({"vat_rate": 0}, SLOTS, {}, "GBP")


def test_a_whole_sentence_is_never_echoed_back_with_nice():
    slots = {"description": {"key": "description", "type": "textarea"}}
    said = acknowledgement({"description": "We clean offices and homes for busy families across Lagos."}, slots, {}, "NGN")
    assert ".," not in said and said == "Thanks, that helps."
    assert acknowledgement({"description": "Cupcake boxes."}, slots, {}, "GBP") == "Cupcake boxes, nice."


def test_the_summary_shows_vat_as_a_rate_and_adds_up_the_total():
    session = {"goal_key": "create_invoice", "currency": "NGN", "resolution": {"resolution_class": "direct_supported"}, "inputs": {"customer": "Ada", "item": "Cleaning", "quantity": 2, "amount": 10000, "vat_rate": 7.5}}
    rows = {r["label"]: r["value"] for r in goals._summary(session)}
    assert rows["Do you charge VAT on this?"] == "7.5%" and rows["Total"] == "₦21,500 including VAT"
    session["inputs"]["vat_rate"] = 0
    rows = {r["label"]: r["value"] for r in goals._summary(session)}
    assert rows["Do you charge VAT on this?"] == "No VAT" and rows["Total"] == "₦20,000"
