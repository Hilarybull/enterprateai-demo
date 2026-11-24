"""The case's cash forecast, filled in from the workspace (the owner's QA, 20 Oct: "these too"): 12 months of receipts
(sales a month times the price) and payments (cost of those sales plus fixed costs), opening cash from the records."""
from datetime import date

from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService
from datetime import timedelta

TODAY = date(2026, 10, 20)
d_ = lambda n: (TODAY - timedelta(days=n)).isoformat()      # noqa: E731
DATA = {"workspace_profile": {"currency": "NGN", "country": "Nigeria"}, "financials": {
    "invoices": [{"id": f"i{n}", "status": "paid", "total_amount": 4000, "customer_name": f"C{n % 5}", "paid_at": d_(5 + 2 * n)} for n in range(30)],
    "expenses": [{"id": "e1", "status": "paid", "description": "Car wash soap and chemicals", "amount": 30000, "date": d_(10)},
                 {"id": "e2", "status": "paid", "description": "Shop rent", "amount": 150000, "date": d_(12)},
                 {"id": "e3", "status": "paid", "description": "Staff wages", "amount": 300000, "date": d_(15)}]}}


def test_the_draft_forecast_comes_from_the_records():
    d = ReadinessService._forecast_draft(None, {"kind": rules.FUNDING}, {"data": DATA, "today": TODAY})
    assert len(d["months"]) == 12 and d["months"][0]["month"] == "2026-10" and d["months"][-1]["month"] == "2027-09"
    assert d["months"][0]["receipts"] == "40000"      # 10 sales a month at ₦4,000
    assert d["months"][0]["payments"] == "460000"      # ₦1,000 × 10 sales + this month's ₦450,000 fixed
    assert d["opening_cash"] is None and d["currency"] == "NGN"      # more paid out than received: not guessed
    assert d["assumptions"][0]["text"] == "₦40,000 a month, from your records"      # the revenue the invoices show, first


def test_nothing_known_no_draft():
    assert ReadinessService._forecast_draft(None, {"kind": rules.FUNDING}, {"data": {}, "today": date(2026, 10, 20)}) is None
