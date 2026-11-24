"""The owner, 26 Oct: "it didn't add the workspace admin": with no one named yet, "Do all for me" names the workspace's owner
for delivering the plan and winning customers, as a draft to accept, edit or reject; someone already named is kept."""
from datetime import date

from test_round10 import _fill
from app.modules.readiness import rules


def _row(team):
    return {"id": "case-1", "data": {"target_amount": 10000, "currency": "GBP", "purpose": "equipment", "team": team}}


def test_no_one_named_yet_the_owner_is_named_for_both():
    out = _fill(rules.FUNDING, _row({}), {"_owner_name": "Hilary Bull"}, date(2026, 10, 26))
    assert [(x["area"], x["owner"]) for x in out["team"]["responsibilities"]] == [("Delivering the plan", "Hilary Bull"), ("Winning customers", "Hilary Bull")]


def test_someone_already_named_is_kept():
    out = _fill(rules.FUNDING, _row({"responsibilities": [{"area": "Sales", "owner": "Ada"}]}), {"_owner_name": "Hilary Bull"}, date(2026, 10, 26))
    assert [(x["area"], x["owner"]) for x in out["team"]["responsibilities"]] == [("Sales", "Ada")]
