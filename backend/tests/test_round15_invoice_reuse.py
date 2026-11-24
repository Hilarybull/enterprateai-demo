from app.modules.agent import answer_memory, first_value
from app.modules.agent.goals import _answers_for_task
from app.modules.agent.intake_turn import acknowledgement


def test_invoice_intake_reuses_exact_existing_customer_and_email():
    data = {"catalogue": {"customers": [{"id": "c1", "name": "Greenleaf", "email": "accounts@greenleaf.example"}]}}
    match = first_value.customer_match("Greenleaf", data)
    assert match == {"customer_email": "accounts@greenleaf.example", "customer_id": "c1"}
    answers = _answers_for_task({"goal_key": "create_invoice", "inputs": {"customer": "Greenleaf", "item": "cleaning", "amount": 180},
                                 "matched_customer": match})
    assert answers["customer_id"] == "c1"
    assert answers["customer_email"] == "accounts@greenleaf.example"


def test_invoice_intake_does_not_guess_between_conflicting_emails():
    data = {"catalogue": {"customers": [{"id": "c1", "name": "Greenleaf", "email": "one@example.com"},
                                         {"id": "c2", "name": "Greenleaf", "email": "two@example.com"}]}}
    assert first_value.customer_match("Greenleaf", data) is None


def test_catalogue_duplicate_service_names_match_plural_and_gerund_forms():
    assert answer_memory.same_offering("end of tenancy cleans", "End of tenancy cleaning")


def test_invoice_email_deferred_acknowledgement_is_not_empty():
    assert acknowledgement({"customer_email": ""}, {"customer_email": {"label": "Customer email"}}, {}, "GBP") == (
        "No problem, I'll leave the email off the draft for now. You can add it before sending.")
