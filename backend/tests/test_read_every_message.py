"""New-User Test L2, L3, L4, A1, F4: every fact and every request in a message."""
import asyncio

from app.modules.agent import answers, assistant_context as ac, converse_launch as cl
from datetime import datetime, timedelta, timezone


def test_a_figure_is_a_cost_only_when_they_spoke_of_a_cost():
    assert "cost" not in cl.grounded({"cost": 10.0}, "boiler cover for landlords, 10 enquiries so far")
    assert cl.grounded({"cost": 60.0}, "it costs about £60 to deliver")["cost"] == 60.0


def test_a_long_name_is_never_cut_mid_word():
    name = "Annual boiler cover plan for private landlords with small portfolios across the whole of West Yorkshire and also the neighbouring towns of the region in Leeds"
    assert not name.startswith(cl.clean_change({"name": name * 2})["name"] + "x")
    kept = cl.clean_change({"name": name + " and more words beyond"})["name"]
    assert (name + " and more words beyond").split(" ")[len(kept.split(" ")) - 1] == kept.split(" ")[-1]


def test_a_question_about_named_things_is_looked_up_never_answered_about_the_catalogue():
    data = {"catalogue": {"customers": [{"name": "Mark Hall"}]}, "financials": {}}
    q = "Do you have any record of ORCHID-7731 or Mark Hall?"
    assert answers.names_asked(q) == ["ORCHID-7731", "Mark Hall"]
    said = answers.named_records_answer(answers.names_asked(q), data)["message"]
    assert "I can't find ORCHID-7731" in said and "Mark Hall (in your customers)" in said
    assert answers.names_asked("Do you have any records of my customers?") == []
    assert answers.names_asked("How many invoices do I have?") == []


def test_the_options_search_is_given_up_on_sooner_than_do_all_and_says_so(monkeypatch):
    now = datetime.now(timezone.utc)
    old = (now - timedelta(minutes=4)).isoformat()
    monkeypatch.setattr(ac, "STARTED", now - timedelta(hours=1))
    data = {"agent_working": {"s": {"at": old, "search": True}, "d": {"at": old}}}
    assert ac.working(data, "s", now) is False and ac.failed(data, "s") == ac.GAVE_UP
    assert ac.working(data, "d", now) is True and ac.failed(data, "d") is None
