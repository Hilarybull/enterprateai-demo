"""The owner, 26 Oct: research found a 25L keg sells for ₦55,000 to ₦75,000 in Lagos while the owner charges ₦25,000, and
nothing said so: a price well outside what the research found is flagged."""
from app.modules.agent.research import price_warning


def test_a_price_well_below_what_similar_sell_for_is_flagged():
    found = [{"topic": "comparable_prices", "sources": [{"url": "https://x"}], "value": "A 25L keg sells for 55,000 to 75,000 naira in Lagos"}]
    assert price_warning(found, 25000) == {"yours": 25000.0, "low": 55000.0, "high": 75000.0, "side": "below", "label": None}
    assert price_warning(found, 120000)["side"] == "above"


def test_a_price_in_range_or_without_a_source_says_nothing():
    assert price_warning([{"topic": "comparable_prices", "sources": [{"url": "https://x"}], "range": [20000, 30000]}], 25000) is None
    assert price_warning([{"topic": "comparable_prices", "value": "55,000 to 75,000"}], 25000) is None      # never from an unsourced guess
    assert price_warning([], 25000) is None and price_warning([{"topic": "comparable_prices", "sources": [1], "range": [55000, 75000]}], None) is None
