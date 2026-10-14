"""The live routing check (2 phrasings x 32 tasks, real model) found requests the rules placed wrongly or not at all. Each
fix is general; these are the phrasings that showed it, plus near misses that must keep their old meaning."""
import pytest

from app.modules.agent import intent
from app.modules.agent.workflows import WORKFLOWS
from app.modules.business_assistant import service as assistant

SUPPORTED = list(WORKFLOWS)


@pytest.mark.parametrize("message, task", [
    ("Fresh from the Farm agreed a one-off orchard survey for six hundred, can you draw up the paperwork", "new_contract"),
    ("Smith and Sons keep losing receipts, I'd like to offer them bookkeeping at 180 a month for two years", "new_proposal"),
    ("Nova Labs might want help with their hiring, pitch them recruitment support at 1500 per month", "new_proposal"),
    ("Smith and Sons owe 350 for the boiler service, add VAT at twenty percent", "new_invoice"),
    ("Delta are happy with the quotation, go ahead and invoice", "quote_to_cash"),
    ("the Smith and Sons invoice has been paid in full", "record_payment"),
    ("Smith and Sons should get 40 off INV-9", "credit_note"),
    ("ask Fasthosts for three extra mailboxes at five each", "new_purchase_order"),
    ("Fasthosts charged 18 for the domain, not paid yet", "record_expense"),
    ("I've started working for Bread and Roses Bakery, number 07700 900789", "add_customer"),
    ("we're going to buy paint from Coat for Coat, add them, sales@coatforcoat.test", "add_vendor"),
    ("Bookkeeping is now three hundred and fifty", "update_record"),
    ("Costco should be listed as Costco Wholesale", "update_record"),
    ("Nova Labs' accounts email is now billing@novalabs.test", "update_record"),
    ("we work across Bristol and Bath now, website www.brightclean.test", "marketplace_profile"),
    ("make Window clean visible on the marketplace", "marketplace_offering"),
    ("rent's up twelve percent, what does that do to my prices", "price_test"),
    ("should I put my prices up", "price_test"),
    ("what happens to cash if Fresh from the Farm stops ordering", "scenario_help"),
    ("model Delta Offices Ltd paying ninety days late", "scenario_help"),
    ("what if we opened in a second city", "expansion_scenario"),
    ("show me what hiring two more cleaners does", "expansion_scenario"),
    ("I'm applying for a start up loan, get my documents together", "funding_pack_draft"),
    ("build the pack for my grant application", "funding_pack_draft"),
    ("before I open what am I missing", "launch_evidence_gaps"),
    ("which service makes me the least", "offer_review"),
    ("go through my products and rank them", "offer_review"),
])
def test_the_phrasings_the_live_check_missed_are_placed(message, task):
    assert intent.rule_capability(message, SUPPORTED) == task


@pytest.mark.parametrize("message, task", [
    ("INV-7 is now paid", "record_payment"),          # a payment, not a change of record
    ("send the receipt for INV-3", "receipt_send"),
    ("what is my revenue", None),                     # questions are still answered, not acted on
    ("how much cash do I have", None),
    ("Can you ask Tom for the keys?", None),
    ("is too much of my revenue from a few clients", None),      # AC-02: risk questions are answered from the records, free
])
def test_near_misses_keep_their_meaning(message, task):
    assert intent.rule_capability(message, SUPPORTED) == task


def test_a_broad_rule_lets_the_model_correct_it_and_a_specific_one_does_not():
    assert intent.broad_rule("Costco invoice 8812 for 120 of cleaning stock", SUPPORTED)
    assert not intent.broad_rule("the Smith and Sons invoice has been paid in full", SUPPORTED)


@pytest.mark.parametrize("answer, action", [
    ("[ACTION:new_purchase_order]", "new_purchase_order"),
    ("[ACTION: new_purchase_order]", "new_purchase_order"),
    ("The price is 300.00.\n\n[ACTION:update_record]", "update_record"),
    ("[action: Update_Record ]", "Update_Record"),
])
def test_the_start_this_task_marker_is_read_wherever_and_however_it_is_written(answer, action):
    m = assistant._ACTION.search(answer)
    assert m and m.group(1) == action


def test_only_a_one_word_rule_is_broad():
    assert intent.broad_rule("Costco invoice 8812 for 120 of cleaning stock", SUPPORTED)
    assert intent.broad_rule("send the receipt for INV-3", SUPPORTED)
    for specific in ("Fresh from the Farm agreed a one-off orchard survey for six hundred, can you draw up the paperwork",
                     "quote Fresh from the Farm six oven deep cleans at sixty, valid for twenty-one days",
                     "Smith and Sons owe 350 for the boiler service"):
        assert not intent.broad_rule(specific, SUPPORTED), specific
    assert intent.rule_capability("quote Fresh from the Farm six oven deep cleans at sixty", SUPPORTED) == "enquiry_to_quote"
