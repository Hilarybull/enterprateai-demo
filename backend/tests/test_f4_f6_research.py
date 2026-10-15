"""F-4: official pages that state their date in words ("Last updated 3 April 2025") or by header count as dated, so a
gov.uk or council page is not thrown out as undated. F-6: the executive summary says the amount in its currency and the
stated purpose ("We are looking for £25,000 for a second van and a driver.")."""
from app.modules.agent import credibility, research


def test_a_date_stated_in_the_page_text_counts():
    assert credibility.text_date("Guidance Last updated 3 April 2025 Contents") == "2025-04-03"
    assert credibility.text_date("Published 12 March 2024 by the council") == "2024-03-12"
    assert credibility.page_date("<html><body><p>Updated: 1 May 2026</p></body></html>") == "2026-05-01"
    assert credibility.text_date("Grants of up to £10,000 are available") == ""


def test_the_last_modified_header_counts_and_junk_does_not():
    assert credibility.header_date("Wed, 21 Oct 2025 07:28:00 GMT") == "2025-10-21"
    assert credibility.header_date("not a date") == ""
    assert credibility.header_date(None) == ""


def test_pages_are_asked_for_as_a_browser_would():
    assert credibility.FETCH_HEADERS["User-Agent"].startswith("Mozilla/5.0")


def test_the_summary_says_the_amount_in_its_currency_and_the_stated_purpose():
    i = {"sell": "same-day van deliveries", "amount": 25000, "use": "second van and a driver"}
    d = research.funding_deliverables(i, [], {"criteria": []}, "GBP")
    assert "We are looking for £25,000 for a second van and a driver." in d["executive_summary"]
    d = research.funding_deliverables({**i, "amount": 5000000}, [], {"criteria": []}, "NGN")
    assert "₦5,000,000" in d["executive_summary"] and "£" not in d["executive_summary"]
