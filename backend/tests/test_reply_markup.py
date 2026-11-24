from app.modules.agent.chat_agent import quick_actions


def test_provider_invoke_presentation_is_removed_and_converted_to_actions():
    clean, actions = quick_actions('Your loan is ready.\n<invoke name="quick_actions"><parameter name="actions">["Show my loan", "Search grants"]</parameter></invoke>')
    assert clean == "Your loan is ready."
    assert [a["prompt"] for a in actions] == ["Show my loan", "Search grants"]


def test_malformed_or_incomplete_metadata_does_not_leak_into_the_reply():
    clean, actions = quick_actions('Your answer.<invoke name="quick_actions"><parameter name="actions">broken')
    assert clean == "Your answer." and not actions


def test_plain_actions_keep_their_existing_format_and_limit():
    clean, actions = quick_actions('Answer.\n<quick_actions>\n- One\nTwo\nThree\nFour\n</quick_actions>')
    assert clean == "Answer." and [a["label"] for a in actions] == ["One", "Two", "Three"]


def test_question_uses_its_answer_choices_and_discards_unrelated_tasks():
    clean, actions = quick_actions('Did you mean no revenue, or no funding yet?\n<quick_actions>Restart my loan\nShow another case</quick_actions>\n<reply_options>No revenue yet\nNo funding yet</reply_options>')
    assert clean == "Did you mean no revenue, or no funding yet?"
    assert [a["prompt"] for a in actions] == ["No revenue yet", "No funding yet"]
    assert all(a["answers_question"] for a in actions)


def test_legacy_question_without_answer_choices_does_not_offer_task_buttons():
    clean, actions = quick_actions('What would the money pay for?\n<quick_actions>Search lenders</quick_actions>')
    assert clean == "What would the money pay for?" and not actions
