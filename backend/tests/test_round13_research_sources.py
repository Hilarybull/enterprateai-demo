"""The owner, 25 Oct: no franchise sales pages as sources, and a finding is labelled by what it says."""
from datetime import datetime, timezone

from app.modules.agent import credibility, research


def test_a_franchise_sales_page_is_never_a_source():
    assert credibility.sales_page("https://www.dazzle-clean.co.uk/franchise/", "Cleaning franchise opportunities UK")
    assert credibility.sales_page("https://x.co.uk/blog", "Own a cleaning franchise today")
    assert not credibility.sales_page("https://www.bbc.co.uk/news/1", "Franchises in the UK economy")
    page = {"ok": True, "title": "Cleaning franchise opportunities UK", "text": "Become a franchisee. The UK cleaning market is worth £60bn."}
    out = credibility.judge({"label": "Market size and growth (United Kingdom)"},
                            [{"url": "https://www.dazzle-clean.co.uk/franchise/", "quote": "The UK cleaning market is worth £60bn.", "region": "United Kingdom"}],
                            {"https://www.dazzle-clean.co.uk/franchise/": page}, {"country": "United Kingdom"}, datetime.now(timezone.utc), figure=False)
    assert out["kind"] == "missing" and "franchise" in out["dropped_sources"][0]["why"]


def test_local_prices_are_never_labelled_market_size():
    assert research.about_its_topic("market", "The UK cleaning industry is worth £60 billion and grew 4% last year")
    assert not research.about_its_topic("market", "Carpet cleaning in Leeds costs £25 to £40 per room")
    assert research.about_its_topic("comparable_prices", "Carpet cleaning in Leeds costs £25 to £40 per room")
