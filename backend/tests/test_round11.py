"""Synthetic: the Agent's forecast opens on the cash the records show when the owner gave none (21 Oct)."""
from datetime import date

from app.modules.readiness.service import ReadinessService


def test_opening_cash_from_the_records():
    data = {"financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 1000, "amount_paid": 1000, "currency": "GBP"}],
                           "expenses": [{"id": "e1", "status": "paid", "amount": 300, "currency": "GBP"}]},
            "workspace_profile": {"currency": "GBP"}}
    cash = ReadinessService.records_cash(data, date(2026, 10, 21))
    assert cash == 700
    got = ReadinessService._opening_of(None, {"data": data, "today": date(2026, 10, 21)})
    assert got["opening_cash_as_of"] == "2026-10-21" and float(got["opening_cash"]) == 700


def test_no_records_no_opening_cash():
    assert ReadinessService.records_cash({}, date(2026, 10, 21)) is None
    assert ReadinessService._opening_of(None, {"data": {}, "today": date(2026, 10, 21)})["opening_cash"] is None


def test_months_default_to_when_the_funding_arrives_and_non_answers_are_cleared():
    from app.modules.readiness import rules
    row = {"data": {"receipt_date": "2027-04-30", "use_of_funds": [{"id": "a1", "category": "Other", "amount": "99400", "period": None, "purpose": "Hiring staff"}],
                    "market": {"acquisition_approach": "No acquisition channels or first steps are described in the available information."}}}
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, {}, date(2026, 10, 21))
    assert out["use_of_funds"][0]["period"] == "2027-04"
    assert "Suggested by the Agent" in out["provenance"]["use_of_funds.period"]["source"]
    assert not (out.get("market") or {}).get("acquisition_approach")
