"""PRD 6.1: a figure keeps its own currency. An NGN pricing check reused in a GBP funding case is never shown as pounds:
it is converted with the rate and its date (an estimate to Accept), or, with no rate, asked in pounds."""
import asyncio
from datetime import date

from app.modules.agent import answer_memory, credibility, research

NGN_PRICING = {"settings": {"currency": "GBP"}, "shared_answers": {"price": {"value": 30000, "offering": "", "goal": "price_offer", "at": "2026-10-14T10:00:00+00:00"},
                                                                    "cost": {"value": 12000, "offering": "", "goal": "price_offer", "at": "2026-10-14T10:00:00+00:00"}},
               "quick_check_answers": {"price_offer": {"answers": {"price": 30000, "cost": 12000}, "offering": "", "at": "2026-10-14T10:00:00+00:00",
                                                       "result": {"currency_sign": "₦"}}}}


def test_a_figure_in_another_currency_is_never_relabelled():
    i = research.inputs_of("need_funding", {}, NGN_PRICING)      # an older record: its currency read from the check's own result
    assert "price" not in i and "cost" not in i
    assert i["_foreign"]["price"] == {"value": 30000.0, "currency": "NGN", "from": "From your pricing check"}


def test_it_is_converted_with_the_rate_and_its_date_and_marked_an_estimate(monkeypatch):
    async def rate(f, t, today):
        return {"from": f, "to": t, "rate": 0.0005, "date": "2026-10-15", "source": "test"}
    monkeypatch.setattr(credibility, "dated_rate", rate)
    i = research.inputs_of("need_funding", {}, NGN_PRICING)
    i["_currency"] = "GBP"
    i = asyncio.run(research.convert_foreign(i, date(2026, 10, 15)))
    assert i["price"] == 15.0 and i["cost"] == 6.0
    assert i["_from"]["price"] == "Converted from your pricing check: ₦30,000 at the 2026-10-15 rate, an estimate to confirm"
    item = research._reused_items(i, {"price"}, {"price": "Break-even"})[0]
    assert item["state"] == "estimated" and item["converted"]["currency"] == "NGN" and item["converted"]["rate"] == 0.0005


def test_with_no_rate_it_is_asked_in_this_currency(monkeypatch):
    async def none(*_a):
        return None
    monkeypatch.setattr(credibility, "dated_rate", none)
    i = research.inputs_of("need_funding", {}, NGN_PRICING)
    i["_currency"] = "GBP"
    i = asyncio.run(research.convert_foreign(i, date(2026, 10, 15)))
    assert "price" not in i and i["_asked_in_currency"]["price"]["currency"] == "NGN"


def test_the_same_currency_is_kept_as_it_is_and_new_records_carry_their_currency():
    data = {"settings": {"currency": "NGN"}}
    answer_memory.remember(data, "price_offer", {"sell": "Cupcake boxes", "price": 30000}, currency="NGN")
    assert data["quick_check_answers"]["price_offer"]["currency"] == "NGN"
    assert research.inputs_of("price_offer", {}, data)["price"] == 30000.0
