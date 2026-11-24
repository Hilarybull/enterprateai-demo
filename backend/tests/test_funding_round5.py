"""Round 5 (the owner's QA, 21 Oct): the launch plan's cost asked, never used unasked; the forecast carries the loan; the
summary names the business; the check's money in plain units; one finding never costs the whole check."""
from app.modules.agent import research
from app.modules.readiness import engine

CHAT = {"sell": "car wash", "traction": "about 300 cars a month, roughly 1.2 million naira monthly revenue", "amount": 5_000_000,
        "use": "2 more washing bays", "route": "loan", "timing": "In 3 to 6 months"}
LAUNCH = {"quick_check_answers": {"launch": {"answers": {"cost": 6000, "price": 15000}, "offering": "car wash"}}}


def test_the_launch_plans_cost_is_asked_with_it_shown():
    i = research.inputs_of("need_funding", CHAT, LAUNCH)
    assert i["price"] == 4000 and "cost" not in i and i["_borrowed"]["cost"]["value"] == 6000
    calc, asked, _ = research.resolve_derivations(["financial:forecast"], {**i, "fixed_costs": 200000.0}, [], "NGN")
    assert any(c["derive"] == "forecast" for c in calc)      # drafted at once, with the launch plan's cost as an estimate
    q = next(q for q in asked if q["field"] == "cost")
    assert q["question"] == "What does each sale cost you? Your launch plan says ₦6,000." and q["prefill"] == 6000 and q["money"]


def test_the_forecast_carries_the_loan():
    i = {"monthly_revenue": 1_200_000.0, "price": 4000.0, "cost": 1500.0, "monthly_sales": 300.0, "fixed_costs": 200_000.0,
         "amount": 5_000_000.0, "route": "loan", "timing": "In 3 to 6 months", "use": "2 more washing bays"}
    f = research.derive("forecast", i, "NGN")
    month = {r["month"]: r for r in f["table"]}
    assert month[3]["funding"] == 5_000_000 and month[3]["spend"] == 4_400_000      # arrives in month 3, the bays bought then
    assert month[3]["repayment"] == 0 and month[4]["repayment"] > 0                   # repaid from the month after
    assert month[5]["revenue"] > month[4]["revenue"]                                  # the extra capacity, an estimate
    assert set(f["estimates"]) == {"loan_rate", "loan_term", "capacity"} and any("my estimate" in w for w in f["working"])
    assert f["working"][-1].startswith(("It pays back", "Cash goes below zero"))
    _c, asked, _ = research.resolve_derivations(["financial:forecast"], i, [], "NGN")
    assert {"loan_rate", "loan_term"} <= {q["field"] for q in asked}


def test_the_summary_names_the_business():
    d = research.funding_deliverables({"company": "E2E Car Wash Abuja", "sell": "car wash", "where": "Abuja", "amount": 5_000_000}, [], {"criteria": []}, "NGN")
    assert d["executive_summary"].startswith("E2E Car Wash Abuja, a car wash in Abuja.")


def test_the_checks_money_is_in_plain_units():
    assert engine._cash("NGN", 5_000_000) == "₦5,000,000" and engine._cash("NGN", -6_600_000) == "\u2212₦6,600,000"


def test_one_finding_never_costs_the_whole_check():
    assert sum(research.shares(60, ["route_loan"], "need_funding").values()) == 20
    assert sum(research.shares(60, ["market", "demand", "route_loan"], "need_funding").values()) == 60
