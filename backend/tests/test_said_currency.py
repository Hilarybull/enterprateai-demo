"""The owner's brief (20 Oct): amounts are stored in the currency the owner gave and never converted automatically (£100,000
was stored as ₦177,303,000). The check runs in that currency; figures the workspace holds in another are converted with the
rate and its date, as estimates to confirm."""
import asyncio
from datetime import date

from app.modules.agent import credibility, research
from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService

DATA = {"settings": {"currency": "NGN"}, "workspace_profile": {"country": "Nigeria", "city": "Abuja"},
        "quick_check_answers": {"need_funding": {"answers": {"amount": 100000, "route": "grant"}, "currency": "GBP"},
                                "launch": {"answers": {"cost": 6000, "fixed_costs": 6000, "sell": "car wash"}, "offering": "car wash", "currency": "NGN"}}}


def test_an_amount_said_in_pounds_stays_in_pounds(monkeypatch):
    async def rate(frm, to, today):
        return {"rate": 0.0005, "date": "2026-10-16"} if (frm, to) == ("NGN", "GBP") else None
    monkeypatch.setattr(credibility, "dated_rate", rate)
    i = research.inputs_of("need_funding", {"amount": 100000, "route": "grant", "sell": "car wash"}, DATA)
    assert i["amount"] == 100000 and i["currency"] == "GBP" and research.context_of(DATA, i)["currency"] == "GBP"
    i["_currency"] = "GBP"
    i = asyncio.run(research.convert_foreign(i, date(2026, 10, 17)))
    assert i["amount"] == 100000      # never converted
    assert i["fixed_costs"] == 3.0 and "₦6,000 at the 2026-10-16 rate" in i["_from"]["fixed_costs"]      # the workspace's naira figure: converted, to confirm
    # The launch plan's cost per sale is never used unasked (the owner's QA, 21 Oct): set aside, to be asked with it shown.
    assert "cost" not in i and i["_borrowed"]["cost"]["value"] == 6000


def test_without_a_said_currency_the_workspace_currency_applies():
    assert research.said_currency("launch", {}, {"settings": {"currency": "NGN"}}) is None


def test_the_case_never_takes_a_foreign_amount_as_its_own_by_filling():
    values, _ = ReadinessService.already_said(rules.FUNDING, DATA, date(2026, 10, 17))
    assert "target_amount" not in values
