"""Round 8 (the owner's QA, 21 Oct): monthly revenue over the months actually trading, too little on record asked as a
typical month, a saved forecast never rewritten by the records, a "nothing found" result never a finding, and
"No traction yet" never marks demand as done."""
from datetime import date

from app.modules.agent import research

TODAY = date(2026, 10, 21)
TWO = {"settings": {"currency": "NGN"}, "financials": {"invoices": [
    {"id": "a", "status": "paid", "customer_name": "ABC Ltd", "total_amount": 500, "currency": "NGN", "paid_at": "2026-10-20"},
    {"id": "b", "status": "paid", "customer_name": "Raphael", "total_amount": 560, "currency": "NGN", "paid_at": "2026-10-20"}]}}


def test_two_invoices_from_one_day_are_no_monthly_figure_and_say_so():
    found = {k: (v, w) for k, v, w in research.records_of(TWO, TODAY)}
    assert "monthly_revenue" not in found and "monthly_sales" not in found
    assert found["records_thin"] == ({"count": 2, "since": "2026-10-20", "total": 1060}, "Based on 2 paid invoices from 20 Oct")


def test_too_little_on_record_asks_what_a_typical_month_brings_in():
    i = research.inputs_of("need_funding", {"amount": 5_000_000}, {**TWO, "catalogue": {"products": [{"id": "p", "name": "Wash", "base_price": 4000, "cost_of_sales": 1500}]}})
    i["fixed_costs"] = 40000
    _calc, asked, _used = research.resolve_derivations(["financial:forecast"], i, [], "NGN")
    q = next(x for x in asked if x["field"] == "monthly_revenue")
    assert q["question"] == "What do you expect to earn in a typical month?" and q["why"] == "Based on 2 paid invoices from 20 Oct." and q["money"]
    assert not any(x["field"] == "monthly_sales" for x in asked)
    # Answered: used as the owner's estimate, and the forecast drafted from it.
    i2 = {**i, "monthly_revenue": 1_200_000, "_estimates": ["monthly_revenue"]}
    f = research.derive("forecast", i2, "NGN")
    assert f["table"][0]["revenue"] == 1_200_000 and f["table"][0]["costs"] == 490_000 and "your estimate" in f["working"][0]


def test_months_trading_divide_the_revenue_never_three_for_one():
    data = {"settings": {"currency": "NGN"}, "financials": {"invoices": [
        {"id": f"i{n}", "status": "paid", "customer_name": f"C{n}", "total_amount": 1000, "currency": "NGN", "paid_at": f"2026-{8 + n % 3:02d}-1{n % 9}"}
        for n in range(9)]}}
    found = {k: (v, w) for k, v, w in research.records_of(data, TODAY)}
    assert found["monthly_revenue"][0] == 3000      # ₦9,000 over Aug, Sep and Oct


def test_nothing_found_is_not_a_finding():
    for said in ("No equity schemes were found for car washes in Nigeria.", "Nigeria: no equity schemes found for small car washes.",
                 "There are no specific programmes for this sector."):
        assert research.nothing_found({"kind": "researched", "value": said}), said
    assert not research.nothing_found({"kind": "researched", "value": "RAPID offers up to ₦5m, no collateral required."})


def test_no_traction_yet_stays_to_fix():
    got = research.research_inputs([{"id": "q", "kind": "question", "field": "contracts", "criterion": "demand", "label": "Paying customers",
                                     "decision": "answered", "answer": "No traction yet"}])
    assert got["demand"]["met"] is False and got["demand"]["gap"] == "No customers yet. Add your first sale or signed interest"
