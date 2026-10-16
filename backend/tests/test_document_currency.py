"""QA, 16 Oct (critical): documents keep their own currency for ever. An invoice made in GBP stays £2,730.00 everywhere after
the workspace switches to NGN; totals that mix currencies are converted at the stored rate and date and said as converted;
one with no rate yet is named, never added as if it were in the workspace currency."""
from datetime import datetime, timezone

from app.modules.agent import business as bz
from app.modules.agent import memory, profile_fill


def _data():
    return {"settings": {"currency": "NGN"}, "financials": {"invoices": [
        {"id": "i1", "reference": "INV-1151026", "customer_name": "Ebe", "currency": "GBP", "total_amount": 2730, "status": "sent", "due_date": "2026-10-01"},
        {"id": "i2", "reference": "INV-1131026", "customer_name": "Mark", "currency": "USD", "total_amount": 315, "status": "sent", "due_date": "2026-10-01"},
        {"id": "i3", "reference": "INV-9", "customer_name": "Ada", "currency": "NGN", "total_amount": 50000, "status": "sent", "due_date": "2026-10-01"}]}}


def test_the_agent_sees_each_invoice_in_its_own_currency_after_the_workspace_switches():
    rows = {r["reference"]: r for r in memory.sources(_data(), [], {}, datetime(2026, 10, 16, tzinfo=timezone.utc))["INVOICES"]}
    assert (rows["INV-1151026"]["currency"], rows["INV-1151026"]["total"]) == ("GBP", 2730)      # £2,730.00, never NGN 2,730
    assert rows["INV-1131026"]["currency"] == "USD" and rows["INV-9"]["currency"] == "NGN"


def test_a_mixed_total_is_converted_at_the_stored_rate_and_said_as_converted():
    d = _data()
    d["fx_rates"] = {"base": "NGN", "date": "2026-10-16", "rates": {"GBP": 2000.0, "USD": 1500.0}}
    t = bz.total_of(d, d["financials"]["invoices"], bz.invoice_outstanding)
    assert t["value"] == 2730 * 2000 + 315 * 1500 + 50000 and t["converted"] and t["rate_date"] == "2026-10-16"
    assert bz.fmt_total(t, "NGN").startswith("≈ ₦")


def test_a_currency_with_no_rate_yet_is_named_not_added():
    d = _data()
    t = bz.total_of(d, d["financials"]["invoices"], bz.invoice_outstanding)
    assert t["value"] == 50000 and t["missing"] == {"GBP": 2730, "USD": 315}
    shown = bz.fmt_total(t, "NGN")
    assert shown.startswith("₦50,000.00") and "£2,730.00" in shown and "$315.00" in shown and "not converted yet" in shown


def test_a_document_saved_without_a_currency_keeps_the_one_it_was_made_in_when_the_workspace_changes():
    d = {"settings": {}, "workspace_profile": {}, "financials": {"invoices": [{"id": "old", "total_amount": 40, "status": "sent"}]}}
    profile_fill.fill(d, {"where": "Abuja"}, "launch")      # Abuja: the workspace currency becomes NGN
    assert d["settings"]["currency"] == "NGN"
    assert d["financials"]["invoices"][0]["currency"] == "GBP"      # made while the workspace was in GBP
    assert bz.doc_currency(d["financials"]["invoices"][0], "NGN") == "GBP"
