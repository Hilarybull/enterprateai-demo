"""An AI figure needs a checked source for the workspace's own country that gives that figure on its page. Without
one it is asked, never a number the model gave; and an estimate adopted before sources were checked is not reused."""
from datetime import date, datetime, timezone

from app.modules.agent import credibility, planned, research

NOW = datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc)
CTX = {"country": "United Kingdom", "city": "Leeds"}
QUOTE = "A typical small consultancy in the UK wins around 4 new clients a month, the survey of 500 firms found."


def _page(url, text=QUOTE):
    return {"ok": True, "url": url, "title": "Survey", "publisher": credibility.host_of(url), "published": "2026-05-01", "text": f"Intro. {text} More."}


def _judge(cited, pages):
    item = {"id": "x", "label": "Sales a month", "value": "About 4 a month", "confidence": 0.8, "topic": "bench_monthly_sales", "number": 37000}
    return credibility.judge(item, cited, pages, CTX, NOW, True)


def test_a_model_figure_with_no_checked_source_is_asked_not_offered():
    url = "https://www.bbc.co.uk/x"
    out = _judge([{"url": url, "title": "t", "quote": "A sentence the page does not hold anywhere at all in it.", "figure": 37000, "region": "UK"}], {url: _page(url)})
    assert out["kind"] == "missing" and out["number"] is None


def test_a_figure_from_another_country_is_asked_too():
    url = "https://www.census.gov/x"
    out = _judge([{"url": url, "title": "t", "quote": QUOTE, "figure": 4, "region": "United States"}], {url: _page(url)})
    assert out["kind"] == "missing"


def test_one_checked_source_gives_its_own_figure_never_the_models():
    url = "https://www.bbc.co.uk/y"
    out = _judge([{"url": url, "title": "t", "quote": QUOTE, "figure": 4, "region": "UK"}], {url: _page(url)})
    assert out["kind"] == "estimated" and out["number"] == 4 and out["sources"][0]["url"] == url


def test_an_estimate_adopted_without_sources_is_not_reused():
    data = {"shared_answers": {"monthly_sales": {"value": 37000, "state": "accepted", "basis": "estimate", "goal": "need_funding", "offering": "",
                                                 "source": "From your funding review (an estimate you adopted)", "at": "2026-10-13T10:00:00+00:00"}}}
    assert "monthly_sales" not in research.inputs_of("need_funding", {}, data)
    assert "monthly_sales" not in planned.figures(data, today=date(2026, 10, 14))
    data["shared_answers"]["monthly_sales"]["sources"] = [{"url": "https://www.ons.gov.uk/a", "quote": QUOTE}]
    assert research.inputs_of("need_funding", {}, data)["monthly_sales"] == 37000
