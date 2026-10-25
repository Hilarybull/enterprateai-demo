"""The owner, 25 Oct: a funding case at 75+ beside "Not ready yet" says why in one line."""
from app.modules.readiness import engine


def _r(classification, gates=(), checks=()):
    return {"classification": classification, "gates": list(gates), "criteria": [{"checks": list(checks)}]}


def test_why_not_ready_names_the_one_thing_in_the_way():
    assert engine.why_not_ready(_r("ready")) is None
    assert engine.why_not_ready(_r("not_ready", gates=[{"label": "The amount matches the use of funds", "state": engine.FAILED}])) == \
        "The amount matches the use of funds must be fixed first."
    assert engine.why_not_ready(_r("insufficient_evidence", checks=[{"state": engine.FAILED, "reason": "Not reviewed: Business plan, Cash flow forecast."}])) == \
        "2 documents need marking as reviewed."
    assert engine.why_not_ready(_r("insufficient_evidence", checks=[{"state": engine.UNKNOWN, "label": "Monthly forecast", "reason": ""}])) == \
        "1 thing still to add, starting with: monthly forecast."
    assert engine.why_not_ready(_r("conditionally_ready"), 75) == "Just under the 75 needed to be ready."
    for line in ("The amount matches the use of funds must be fixed first.",):
        assert "—" not in line and "–" not in line
