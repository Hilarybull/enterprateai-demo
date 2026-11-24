"""£250,000 typed in a naira workspace stays £: the currency the owner said wins over the workspace's own."""
import asyncio

from app.modules.agent import goals


def test_the_typed_currency_is_kept_from_the_chat():
    s = {"turns": [{"role": "user", "content": "£250,000"}, {"role": "assistant", "content": "Got it"}], "resolution": {"original_goal": "I need funding"}}
    assert goals.said_currency(s) == "GBP"
    assert goals.said_currency({"turns": [{"role": "user", "content": "250000"}], "resolution": {}}) is None      # none said: the workspace's


def test_a_chip_answer_keeps_its_currency():
    store = goals.SessionStore()
    s = asyncio.run(goals.start(store, text=None, key="need_funding", entry_mode="business_goal"))
    s = asyncio.run(goals.add_inputs(store, s, {"amount": 250000}, asked="amount", picked="£250,000"))
    assert s.get("currency") == "GBP"
