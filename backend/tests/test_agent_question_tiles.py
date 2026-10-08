"""A question tile says what it is about, and the Agent uses what the owner actually said.
From the browser check: tiles read "Is this right?" and "Which customer is this for?", a proposal
"for ABC Ltd" was addressed to "business proposal", and an idea named in the message was dropped
for the profile's "Offers Gooat"."""
from datetime import date

from app.modules.agent import said, summary
from app.modules.agent.workflows import WORKFLOWS, idea_of
from test_agent import OWNER, Env, run


def test_the_reader_never_takes_a_kind_of_document_or_a_pointer_as_the_customer():
    r = said.read("Write a business proposal for ABC Ltd for website maintenance", date(2026, 10, 8))
    assert r["party"] == "ABC Ltd" and r["work"] == "website maintenance"
    assert "party" not in said.read("create a quotation for my latest marketplace RFQ", date(2026, 10, 8))
    assert "party" not in said.read("write a business proposal", date(2026, 10, 8))
    assert said.read("a formal quotation for Acme Ltd for a new kitchen", date(2026, 10, 8))["party"] == "Acme Ltd"
    assert said.read("invoice for Mark $300", date(2026, 10, 8))["party"] == "Mark"      # the ordinary case is as it was


def test_an_idea_named_in_the_message_is_the_subject_not_the_profile():
    assert said.idea_in("Validate my idea: a mobile car wash in Abuja") == "Mobile car wash in Abuja"
    assert said.idea_in("test my business idea of selling handmade candles online") == "Selling handmade candles online"
    assert said.idea_in("validate my idea") == "" and said.idea_in("validate my idea please") == ""
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"]["about_company"] = "We advise small firms on pricing."
    res = env.submit(text="Validate my idea: a mobile car wash in Abuja")
    r = res["run"]
    assert r["workflow_key"] == "idea_validation" and r["state"]["answers"]["description"] == "Mobile car wash in Abuja" and r["state"]["idea_from_message"] is True
    assert "pricing" not in str(r["state"]["answers"])                     # the profile's description was not used in its place
    if r.get("pending_question"):
        title = summary.question_title(r)
        assert title["title"].startswith("Validating your mobile car wash idea. ") and "Mobile car wash in Abuja" in title["detail"]


def test_a_poor_profile_description_is_not_used_and_one_that_is_used_is_said_to_be():
    assert idea_of({"workspace_profile": {"about_company": "MMMMMMMMMMMMMMMM"}, "catalogue": {"products": [{"id": "p", "name": "Gooat"}]}})["description"] == ""
    assert idea_of({"workspace_profile": {"about_company": "We advise small firms on pricing."}})["description"] == "We advise small firms on pricing."
    guessed = idea_of({"workspace_profile": {"services": [{"service_name": "Monthly bookkeeping"}, {"service_name": "Invoicing support"}]}})
    assert guessed["description"] == "Offers Monthly bookkeeping, Invoicing support" and guessed["description_guessed"] is True


def test_a_proposal_tile_names_the_customer_and_asks_for_what_is_missing():
    tile = summary.question_title({"workflow_key": "new_proposal", "state": {"answers": {}, "params": {"customer_name": "ABC Ltd"}},
                                   "pending_question": {"question": "Is this right?", "fields": [
                                       {"key": "solution", "label": "What you are proposing", "type": "textarea", "required": True, "default": "Website maintenance"},
                                       {"key": "total", "label": "Price", "type": "number", "required": True, "default": ""}]}})
    assert tile == {"title": "Proposal for ABC Ltd. Add a price?", "detail": ""}      # the title already says what is missing
    invoice = summary.question_title({"workflow_key": "new_invoice", "state": {"answers": {"customer_name": "Mark"}},
                                      "pending_question": {"question": "Is this right?", "fields": [{"key": "vat_rate", "label": "VAT rate", "confirm": True, "default": 20}]}})
    assert invoice == {"title": "Invoice for Mark. Confirm the VAT rate?", "detail": "20"}
    idea = summary.question_title({"workflow_key": "idea_validation", "state": {"answers": {}},
                                   "pending_question": {"question": "Is this right?", "fields": [{"key": "description", "label": "What the business does", "confirm": True, "default": "Mobile car wash in Abuja"}]}})
    assert idea == {"title": "Validating your mobile car wash idea. Confirm what it does?", "detail": "Mobile car wash in Abuja"}


def test_no_tile_has_a_bare_generic_question_for_a_title():
    bare = ("Is this right?", "Which customer is this for?", "Is this correct?", "Who is it for?")
    assert all(summary.is_bare_question(b) for b in bare)
    # Every task, asked a bare question about any kind of field, still gets a title that says what it is about.
    for key in WORKFLOWS:
        for field in ({"key": "customer_id", "label": "Customer", "required": True}, {"key": "x", "label": "Something", "confirm": True, "default": "A value"}, {}):
            title = summary.question_title({"workflow_key": key, "title": WORKFLOWS[key].title, "state": {}, "pending_question": {"question": "Is this right?", "fields": [field] if field else []}})["title"]
            assert not summary.is_bare_question(title) and len(title) > 12 and "\u2014" not in title and "\u2013" not in title, (key, title)
    # And on the dashboard itself: a real waiting question is titled that way.
    env = Env()
    env.submit(text="write a proposal for ABC Ltd for website maintenance")
    from app.modules.agent.summary import build_summary
    for tile in run(build_summary(env.orch, OWNER, "A"))["suggestions"]:
        if tile.get("question"):
            assert not summary.is_bare_question(tile["text"]) and tile["text"].startswith("Proposal for ABC Ltd. "), tile["text"]
