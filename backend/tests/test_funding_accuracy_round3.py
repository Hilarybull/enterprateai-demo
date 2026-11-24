"""Funding "Do all for me" accuracy (the owner's brief, 20 Oct): traction read right, receipts from the revenue said,
cost above price flagged, use of funds led by the purpose, and a clash between what was said and the catalogue asked."""
import pytest

from app.modules.agent import goals, research

PHRASES = [
    ("about 300 cars a month, roughly 1.2 million naira monthly revenue", 300, 1_200_000),
    ("300 cars a month, ₦1.2m revenue", 300, 1_200_000),
    ("40 customers a month and NGN 800,000 in sales", 40, 800_000),
    ("we do 120 orders per month with revenue of about £15k", 120, 15_000),
    ("monthly revenue roughly 2.5m naira, 50 clients a month", 50, 2_500_000),
    ("about 300 cars a month", 300, None),
]


@pytest.mark.parametrize("said, sales, revenue", PHRASES)
def test_traction_is_read_as_a_count_and_a_revenue(said, sales, revenue):
    t = research.traction_figures(said)
    assert t.get("monthly_sales") == sales and t.get("monthly_revenue") == revenue


def test_a_count_is_never_stored_as_the_cases_revenue():
    case = goals.case_fields({"traction": "about 300 cars a month, roughly 1.2 million naira monthly revenue"}, currency="NGN")
    assert case["traction"]["monthly_revenue"] == 1_200_000
    assert goals.case_fields({"traction": "about 300 cars a month"}, currency="NGN")["traction"].get("monthly_revenue") is None


def test_receipts_start_from_the_revenue_said():
    i = {"monthly_revenue": 1_200_000.0, "price": 6000.0, "cost": 1500.0, "monthly_sales": 300.0, "fixed_costs": 200_000.0}
    f = research.derive("forecast", i, "NGN")
    assert f["table"][0]["revenue"] == 1_200_000 and "the revenue you gave" in f["working"][0]


def test_cost_above_price_is_flagged_and_no_break_even_is_printed():
    out = research.derive("break_even", {"price": 4000.0, "cost": 6000.0, "fixed_costs": 200_000.0}, "NGN")
    assert out["warning"] == "cost_above_price" and out["value"].startswith("Each sale costs more than you charge")


def test_a_break_even_far_below_volume_is_warned():
    out = research.derive("break_even", {"price": 4000.0, "cost": 1000.0, "fixed_costs": 3000.0, "monthly_sales": 300.0}, "NGN")
    assert out["warning"] == "implausibly_low"


def test_use_of_funds_is_led_by_the_purpose():
    out = research.derive("use_of_funds", {"amount": 5_000_000.0, "fixed_costs": 200_000.0, "use": "2 more washing bays"}, "NGN")
    lines = [r["line"] for r in out["table"]]
    assert lines[0] == "2 more washing bays" and out["table"][0]["amount"] == 4_400_000
    assert lines[1:] == ["Working capital: two months of fixed costs", "Reserve: one month of fixed costs"]
    assert not any("delivery costs" in line for line in lines)


def test_what_was_said_and_the_catalogue_disagreeing_is_asked():
    data = {"workspace_profile": {"currency": "NGN"}, "catalogue": {"products": [{"id": "p1", "name": "Car wash", "base_price": 15000}]}}
    i = research.inputs_of("need_funding", {"sell": "car wash", "traction": "300 cars a month, ₦1.2m revenue"}, data)
    assert i["monthly_revenue"] == 1_200_000 and i["_conflicts"]["monthly_revenue"]["catalogue"] == 4_500_000


def test_each_funding_option_says_whether_it_fits():
    i = {"sell": "car wash", "where": "Abuja, Nigeria"}
    assert research.fit_of("Loans for smallholder farmers in rural areas", i)["fit"] == "Unlikely"
    assert research.fit_of("RAPID programme for nano, micro and small businesses", i, [{"date": "2025-04-07"}]) == \
        {"fit": "Likely", "why": "It is for small businesses like yours", "confirmed": None, "published": "2025-04-07"}
    # "Last confirmed open" only from an open statement on the page (the owner's QA, 21 Oct); else only when published.
    assert research.fit_of("Applications are open for small businesses", i, [{"date": "2026-09-01"}])["confirmed"] == "2026-09-01"
    # On an equity case, a loan scheme is a different route, never "Likely".
    assert research.fit_of("Loans for small businesses", {**i, "route": "equity"}, [], "loan") == \
        {"fit": "Different route", "why": "Different route: loan", "confirmed": None, "published": None}
    assert research.fit_of("Applications for this grant are closed", i)["fit"] == "Unlikely"
    assert research.fit_of("Youth fund for founders under 35 in Abuja", i)["fit"] == "Maybe"


def test_the_summary_uses_only_this_cases_words():
    i = {"amount": 5_000_000, "use": "2 more washing bays", "sell": "Dog walking", "_from": {"sell": "From your launch check"}}
    d = research.funding_deliverables(i, [], {"criteria": []}, "NGN")
    assert "Dog walking" not in d["executive_summary"] and d["borrowed"] == [{"field": "sell", "value": "Dog walking", "from": "From your launch plan"}]
