"""The Agent goes through the workspace first (the owner's QA, 20 Oct: "the agent is supposed to go through the workspace
and populate these"): the price from paid invoices, the cost per sale from stock and supplies, fixed costs without them,
and the catalogue's own price and cost ahead of any average. Then the forecast has what it needs."""
from datetime import date, timedelta

from app.modules.agent import research

TODAY = date(2026, 10, 20)
d = lambda n: (TODAY - timedelta(days=n)).isoformat()      # noqa: E731
INVOICES = [{"id": f"i{n}", "status": "paid", "total_amount": 4000, "customer_name": f"C{n % 5}", "paid_at": d(5 + 2 * n)} for n in range(30)]      # trading 3 months
EXPENSES = [{"id": "e1", "status": "paid", "description": "Car wash soap and chemicals", "amount": 30000, "date": d(10)},
            {"id": "e2", "status": "paid", "description": "Shop rent", "amount": 150000, "date": d(12)},
            {"id": "e3", "status": "paid", "description": "Staff wages", "amount": 300000, "date": d(15)}]
DATA = {"workspace_profile": {"currency": "NGN", "country": "Nigeria"}, "financials": {"invoices": INVOICES, "expenses": EXPENSES}}


def test_the_records_give_price_cost_sales_and_fixed_costs():
    rec = {k: (v, w) for k, v, w in research.records_of(DATA, TODAY)}
    assert rec["price"][0] == 4000 and rec["price"][1].startswith("From your invoices")
    assert rec["cost"][0] == 1000 and "stock and supplies" in rec["cost"][1]      # ₦30,000 over 30 washes
    # rent and wages only, all paid this month: this month's, never a third of it (the owner's QA, 21 Oct)
    assert rec["fixed_costs"][0] == 450000 and "left out" in rec["fixed_costs"][1]
    assert rec["monthly_sales"][0] == 10


def test_the_catalogue_price_comes_before_the_invoice_average():
    data = {**DATA, "catalogue": {"products": [{"id": "p1", "name": "Car wash", "base_price": 5000, "cost_of_sales": 1200}]}}
    i = research.inputs_of("need_funding", {"sell": "car wash"}, data)
    assert (i["price"], i["_from"]["price"]) == (5000, "From your catalogue")
    assert (i["cost"], i["_from"]["cost"]) == (1200, "From your catalogue")
    # A product named differently still gives its cost with its price (never left empty when the catalogue has it).
    other = {**DATA, "catalogue": {"products": [{"id": "p1", "name": "Premium valet", "base_price": 5000, "cost_of_sales": 1200}]}}
    j = research.inputs_of("need_funding", {"sell": "car wash"}, other)
    assert (j["price"], j["cost"]) == (5000, 1200)


def test_the_forecast_has_everything_it_needs_from_the_records():
    i = research.inputs_of("need_funding", {"amount": 5000000}, DATA)
    assert all(i.get(f) is not None for f in ("price", "cost", "monthly_sales", "fixed_costs"))
    assert not research.derive("forecast", i, "NGN").get("needs")
