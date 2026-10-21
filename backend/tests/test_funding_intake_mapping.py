"""P0.1 (QA, 15 Oct): each funding intake answer lands in its own case field, and revenue is never the funding amount.
The repro: "8 million naira", "buy two pressure washers and a second van", trading, June 2027, Loan, "40 paying
subscribers and about 1.2 million naira revenue a month", Abuja."""
import asyncio
from datetime import date

from app.modules.agent import goals, intake_turn

A = {"amount": 8000000.0, "use": "buy two pressure washers and a second van", "stage": "trading", "timing": "June 2027", "route": "loan",
     "traction": "40 paying subscribers and about 1.2 million naira revenue a month"}


def test_every_slot_maps_to_its_case_field():
    f = goals.case_fields(A, currency="NGN", where="Abuja", country="Nigeria", today=date(2026, 10, 15))
    assert f == {"target_amount": 8000000.0, "timing_confirmed": True, "currency": "NGN", "purpose": "buy two pressure washers and a second van", "receipt_date": "2027-06-30",
                 "route_preference": "loan", "stage": "trading", "jurisdiction": "Nigeria", "market": {"location": "Abuja"},
                 "traction": {"summary": A["traction"], "customers": 40, "monthly_revenue": 1200000.0}}


def test_timing_is_the_end_of_the_month_said():
    today = date(2026, 10, 15)
    assert goals.end_of_month("June 2027", today) == "2027-06-30"
    assert goals.end_of_month("by March", today) == "2027-03-31"
    assert goals.end_of_month("Within 3 months", today) == "2027-01-31"
    assert goals.end_of_month("In 6 to 12 months", today) == "2027-10-31"
    assert goals.end_of_month("when we can", today) is None


def test_revenue_is_never_the_funding_amount():
    assert goals.extract(A["traction"], "need_funding") == {}
    assert goals.extract("8 million naira", "need_funding") == {"amount": 8000000.0}
    assert goals.extract("I need £25k for a second van, we make £2k a month", "need_funding")["amount"] == 25000.0
    assert goals.extract("We need funding of 5m naira", "need_funding")["amount"] == 5000000.0


def test_the_traction_answer_never_overwrites_the_amount_already_given():
    slots = [q for q in goals._BY_KEY["need_funding"]["questions"]]
    out = asyncio.run(intake_turn.turn(goal_key="need_funding", message=A["traction"], slots=slots,
                                       known={"amount": 8000000.0, "use": A["use"], "stage": "trading", "route": "loan", "timing": "June 2027"},
                                       asked="traction", llm=None, currency="NGN"))
    assert "amount" not in out["values"] and out["values"]["traction"] == A["traction"]


def test_a_new_need_is_said_as_a_diff_and_core_changes_ask_replace():
    before = {"title": "QA Seed round", "target_amount": 100000, "currency": "GBP", "purpose": "hiring", "route": "equity", "receipt_date": "2026-12-01"}
    wanted = goals.case_fields(A, currency="NGN", where="Abuja", country="Nigeria", today=date(2026, 10, 15))
    diff = goals.case_diff(before, wanted)
    line = goals.diff_line(diff, before, wanted)
    assert line.startswith("Amount £100,000 → ₦8,000,000 · Currency GBP → NGN · Purpose hiring → buy two pressure washers and a")
    assert "Timing Dec 2026 → Jun 2027 · Route equity → loan" in line and "Market not set → Abuja" in line
    # One case per business (the owner's brief, 20 Oct): never "Replace". "Update my case" keeps the old version in History
    # when the need itself changes; the changes are a clean list, five rows at most.
    choose = goals._replace_or_update({"id": "c1", "data": before}, diff, wanted)
    assert [(o["value"], o["label"]) for o in choose["options"]] == [("replace:c1", "Update my case"), ("cancel:c1", "Cancel")]
    assert choose["label"] == "I'll update your funding case"
    assert choose["rows"][0] == {"field": "Amount", "before": "£100,000", "now": "₦8,000,000"} and len(choose["rows"]) <= 5
    assert goals.need_title(wanted) == "₦8m loan to buy two pressure washers and a second van"
    # Only details: a plain update, no Replace.
    small = goals._replace_or_update({"id": "c1", "data": {**before, "stage": "pre_revenue"}}, goals.case_diff({**before, "stage": "pre_revenue"}, {"stage": "trading"}), {"stage": "trading"})
    assert [o["label"] for o in small["options"]] == ["Update my case", "Cancel"] and small["options"][0]["value"] == "update:c1"


def test_a_loan_case_is_labelled_and_investor_only_documents_never_block():
    from datetime import date as _d
    from app.modules.readiness import engine, rules
    base = {"title": "Van", "route": "equity", "business_model": "service", "target_amount": 8000000, "currency": "NGN", "receipt_date": "2027-06-30",
            "timing_confirmed": True, "purpose": "a second van"}
    equity = engine.assess(rules.FUNDING, {"subject": base, "forecast": None, "evidence": []}, rules.FUNDING_EQUITY_V1, _d(2026, 10, 15))
    loan = engine.assess(rules.FUNDING, {"subject": {**base, "route_preference": "loan"}, "forecast": None, "evidence": []}, rules.FUNDING_EQUITY_V1, _d(2026, 10, 15))
    assert loan["route_note"] == "Loan checklist coming soon, using general checks."
    assert equity["route_note"] is None
    said = lambda r: " ".join(str(x) for x in (r.get("missing"), r.get("gaps"), r.get("criteria")))      # noqa: E731
    assert "Team and ownership summary" in said(equity) and "Team and ownership summary" not in said(loan)


def test_got_it_reads_to_buy_never_for_a_buy():
    line = intake_turn.acknowledgement({"amount": 8000000.0, "use": "buy two pressure washers and a second van"},
                                       {s["key"]: s for s in goals._BY_KEY["need_funding"]["questions"]}, {}, "NGN")
    assert "₦8,000,000 to buy two pressure washers and a second van" in line and "for a buy" not in line
