"""The 12-month forecast is built as soon as its figures are answered (the owner's QA, 20 Oct: "what of the forecasting?"):
in the review's live preview and on adopting, from the answers only."""
from datetime import datetime, timezone

from app.modules.agent import research

Q = lambda f, d: {"id": f"q_{f}", "kind": research.QUESTION, "criterion": "financial", "field": f, "label": f, "for_derive": d}
RUN = {"id": "rr_f", "goal": "need_funding", "status": "review", "created_at": datetime.now(timezone.utc).isoformat(),
       "answers": {"amount": 25000, "route": "loan"}, "inputs": {"amount": 25000.0}, "context": {"currency": "GBP"},
       "blockers": [{"key": "financial"}, {"key": "use_of_funds"}],
       "items": [Q("price", "forecast"), Q("cost", "forecast"), Q("monthly_sales", "forecast"), Q("fixed_costs", "use_of_funds")]}


def test_the_forecast_appears_once_its_figures_are_answered():
    assert not [c for c in research.preview(RUN, {}) if c["derive"] == "forecast"]      # nothing made up
    said = {"q_price": {"decision": "answer", "value": "4000"}, "q_cost": {"decision": "answer", "value": "1500"},
            "q_monthly_sales": {"decision": "answer", "value": "300"}, "q_fixed_costs": {"decision": "answer", "value": "200000"}}
    calc = {c["derive"]: c for c in research.preview(RUN, said)}
    f = calc["forecast"]
    assert f["from_answers"] and len(f["table"]) == 12
    assert f["table"][0]["revenue"] == 1200000 and f["table"][0]["costs"] == 1500 * 300 + 200000
    assert "use_of_funds" in calc      # the other calculation waiting for the same figures too
