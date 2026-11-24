"""QA P2-5: "What is my biggest risk?" never states a cash position of £0.00 when no money in or out is recorded."""
from datetime import date

from app.modules.agent.answers import answer_question
from test_agent import Env
from test_dashboard import operating


def _cash(data):
    out = answer_question("What is my biggest risk?", data, {}, date(2026, 10, 11))
    return next(e["value"] for e in out["evidence"] if e["label"] == "Cash position")


def test_no_records_is_not_recorded_yet():
    env = Env()
    env.businesses["A"]["data"]["financials"] = {"invoices": [], "expenses": []}
    assert _cash(env.businesses["A"]["data"]) == "Not recorded yet"


def test_with_records_the_figure_is_given():
    env = Env()
    operating(env)
    assert _cash(env.businesses["A"]["data"]).startswith("£")
