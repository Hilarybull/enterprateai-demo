"""The owner, 24 Oct: "even when following the fixed question list, it should be flexible and adaptive based on what was
given to it... once it gets its answer it continues, else it should understand and respond accordingly"."""
import pytest

from test_goal_onboarding import world  # noqa: F401

CASES = [("top_share", "most of it", "over_50"), ("top_share", "about 30%", "20_50"),
         ("top_share", "we have about 10 clients, the biggest pays maybe 30%", "20_50"), ("runway", "maybe 2 months", "under_3"),
         ("runway", "a year or so", "over_6"), ("paid_on_time", "mostly yes", "on_time"), ("paid_on_time", "some are slow", "sometimes_late"),
         ("key_person", "I have 3 staff", "slows"), ("key_person", "my manager runs things", "runs")]


def _at(client, asked, msg):
    s = client.post("/task-sessions", json={"text": "help me to understand my risks", "entry_mode": "free_text"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"worry": "nothing"}})
    return client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": msg, "asked": asked}).json()


@pytest.mark.parametrize("asked,msg,value", CASES)
def test_a_plain_answer_is_understood_and_the_chat_moves_on(world, asked, msg, value):
    env, store, client, who = world
    s = _at(client, asked, msg)
    assert s["inputs"][asked] == value and asked not in s["missing"]
    assert s["agent_turn"]["ack"].startswith("Thanks, noted:")


def test_a_reply_that_answers_nothing_is_answered_with_how_to_answer(world):
    env, store, client, who = world
    t = _at(client, "top_share", "hmm")["agent_turn"]
    assert t["answer"].startswith("I didn't quite get that for your biggest customer's share. Pick the closest:")


def test_why_and_check_my_invoices_get_real_answers(world):
    env, store, client, who = world
    assert _at(client, "top_share", "why do you need this?")["agent_turn"]["answer"].startswith("If one customer pays most of your bills")
    assert _at(client, "top_share", "can you check my invoices instead?")["agent_turn"]["answer"].startswith("Once you're signed in I read that from your invoices")


@pytest.mark.parametrize("text,goal", [("i want to understand a rsisk", "business_risks"), ("i need fundng", "need_funding"),
                                       ("help me lauch my product", "launch"), ("create an invocie for Mark", "create_invoice"),
                                       ("validate my idae", "test_idea"), ("i need more custmers", "more_customers")])
def test_a_typo_in_the_goal_word_is_read_as_meant(text, goal):
    """The owner, 24 Oct: "i want to understand a rsisk" was offered launch, idea and funding."""
    from app.modules.agent import goals
    assert goals.resolve(text=text)["goal_key"] == goal


def test_a_typo_on_the_dashboard_agent_is_read_the_same(world):
    from test_goal_onboarding import OWNER
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/agent/requests", json={"business_id": "A", "text": "i want to understand a rsisk", "source_channel": "text"}).json()
    assert (out["kind"], out["goal_key"]) == ("check", "business_risks")
