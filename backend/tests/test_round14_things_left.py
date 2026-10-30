"""A reply that says "N things to do" shows them and recommends Do all for me (the owner, 29 Oct)."""
from app.modules.agent.converse import offer_things_left


def test_things_to_do_shows_the_list_and_recommends_do_all():
    got = {}
    say, out = offer_things_left("Got it. Your launch score is now 0/100 so far, with 16 things to do.", got, [{"label": "Open your launch plan", "to": "/launch/p1"}])
    assert "result" in got["show"]
    assert "Want me to do them for you?" in say
    assert out[-1] == {"label": "Do all for me", "kind": "explain", "prompt": "Do it all for me"}
    assert out[0]["label"] == "Open your launch plan"


def test_no_count_said_leaves_the_reply_as_it_is():
    got = {}
    acts = [{"label": "Set audience", "kind": "explain", "prompt": "x"}]
    assert offer_things_left("What's the target audience?", got, acts) == ("What's the target audience?", acts)
    assert "show" not in got


def test_once_researched_it_drafts_the_rest_and_asks_what_it_needs():
    from app.modules.agent.converse import launch_ask
    ask = launch_ask({"economics": {"price_per_unit": "1000", "variable_cost_per_unit": "2500"}})
    assert "loses money" in ask and "1,000" in ask and "2,500" in ask
    say, out = offer_things_left("Your launch score is now 10/100, with 15 things to do.", {}, [], researched=True, ask=ask)
    assert out == [{"label": "Draft the rest", "kind": "explain", "prompt": "Fill the rest for me"}]
    assert "I can draft the rest" in say and "Do all" not in say and ask in say
    assert "When do you want to launch?" in launch_ask({"economics": {"price_per_unit": "3000", "variable_cost_per_unit": "400"}})
    assert launch_ask({"economics": {"price_per_unit": "3000", "variable_cost_per_unit": "400"}, "target_date": "2026-12-01"}) == ""


def test_do_all_never_twice():
    acts = [{"label": "Do all for me", "kind": "explain", "prompt": "Do it all for me"}]
    assert offer_things_left("Your score is now 40/100, with 1 thing to do.", {}, acts)[1] == acts
