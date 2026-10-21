"""The owner's QA (20 Oct): the workspace's own records fill the research's figures: sales a month and paying customers
from paid invoices, cash now from money in less money out, monthly fixed costs from paid expenses. An answer just given
still wins; an older review's estimate does not."""
from datetime import date

from app.modules.agent import research

TODAY = date(2026, 10, 20)
DATA = {"settings": {"currency": "NGN"}, "financials": {
    "invoices": [{"id": f"i{n}", "status": "paid", "customer_name": f"Client {n % 4}", "total_amount": 15000, "amount_paid": 15000,
                  "issue_date": "2026-09-1" + str(n % 9), "currency": "NGN"} for n in range(12)],
    "expenses": [{"id": f"e{n}", "status": "paid", "price": 30000, "date": "2026-09-0" + str(n + 1)} for n in range(3)]},
    "shared_answers": {"monthly_sales": {"value": 223250, "offering": "", "goal": "need_funding", "basis": "estimate", "sources": [{"url": "x"}]}}}


def test_the_records_fill_sales_cash_costs_and_demand():
    found = {k: (v, w) for k, v, w in research.records_of(DATA, TODAY)}
    assert "monthly_sales" not in found and "monthly_revenue" not in found
    assert found["records_thin"] == ({"count": 12, "since": "2026-09-10", "total": 180000}, "Based on 12 paid invoices from 10 Sep")
    assert found["evidence"][0] == "4 paying customers, ₦180,000 received over the last 2 months"
    assert found["fixed_costs"][0] == 45000.0 and found["cash_in_bank"][0] > 0      # ₦90,000 over the 2 months on record


def test_records_beat_an_older_estimate_and_an_answer_beats_records(monkeypatch):
    monkeypatch.setattr(research, "records_of", lambda data, today=None: [("monthly_sales", 4.0, "From your invoices: 12 paid in the last 3 months")])
    i = research.inputs_of("need_funding", {}, DATA)
    assert i["monthly_sales"] == 4.0 and i["_from"]["monthly_sales"].startswith("From your invoices")
    assert research.inputs_of("need_funding", {"monthly_sales": 9}, DATA)["monthly_sales"] == 9


def test_a_saved_run_takes_the_records_figures_free_and_keeps_the_owners_own():
    run = {"id": "rr_1", "status": "review", "inputs": {}, "inputs_from": {}, "items": [
        {"id": "q1", "kind": "question", "field": "cash_in_bank", "criterion": "financial", "label": "Financial preparation", "question": "How much cash does the business have now?"},
        {"id": "r1", "kind": "reused", "field": "evidence", "criterion": "demand", "label": "Demand evidence", "value": "40 paying customers", "source_note": "From your funding review"},
        {"id": "r2", "kind": "reused", "field": "fixed_costs", "criterion": "economics", "label": "Monthly fixed costs", "value": 5000, "source_note": "your answer"}]}
    out = {x["id"]: x for x in research.refresh_from_records(run, DATA, TODAY)["items"]}
    assert out["q1"]["kind"] == "reused" and out["q1"]["source_note"] == "From your records: money received less expenses paid" and out["q1"]["value"] > 0
    assert out["r1"]["value"] == "4 paying customers, ₦180,000 received over the last 2 months"      # the record beats an older review
    assert out["r2"]["value"] == 5000                                                                # the owner's own answer stays
