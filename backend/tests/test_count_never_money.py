"""The owner's QA (17 Oct): "223250", a naira amount, became 223,250 sales a month. A count is never filled from money, and
a count beyond what the business can do is asked with the reason, never computed from."""
from app.modules.agent import research


def test_a_monthly_revenue_figure_never_becomes_monthly_sales():
    assert not research.plausible_count("monthly_sales", 223250, said="₦223,250 monthly revenue")
    assert not research.plausible_count("monthly_sales", 223250)                       # beyond a small business with no team on record
    assert research.plausible_count("monthly_sales", 400, {"team_size": 3})
    assert not research.plausible_count("monthly_sales", 5000, {"team_size": 3})       # 3 people: at most about 1,800 a month


def test_an_adopted_implausible_count_is_set_aside_and_asked_with_the_reason():
    data = {"shared_answers": {"monthly_sales": {"value": 223250, "offering": "car wash", "goal": "need_funding", "basis": "estimate",
                                                 "sources": [{"url": "x"}], "source": "From your funding review (an estimate you adopted)"}}}
    i = research.inputs_of("need_funding", {"sell": "car wash", "cost": 6000, "fixed_costs": 35000, "price": 15000}, data)
    assert "monthly_sales" not in i and i["_implausible"]["monthly_sales"]["value"] == 223250
    calculated, asked, _ = research.resolve_derivations(["economics:break_even", "financial:forecast"], {**i, "amount": 50000}, [], "NGN")
    q = next(q for q in asked if q.get("field") == "monthly_sales")
    assert q["why"].startswith("Check this number: 223,250 looks too high for a business this size")
