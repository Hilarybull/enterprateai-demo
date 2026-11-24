"""The owner, 25 Oct: every change typed to the funding case is read and confirmed together, not just the first."""
from app.modules.agent import case_edit


def _all(text):
    c = case_edit.read(text)
    return c and [(x["field"], x["value"]) for x in [c, *c["more"]]]


def test_every_change_in_the_message_is_read():
    assert _all("change the funding amount to 45000 and the timing to within 3 months")[0] == ("target_amount", 45000.0)
    assert [f for f, _ in _all("change the funding amount to 45000 and the timing to within 3 months")] == ["target_amount", "receipt_date"]
    assert [f for f, _ in _all("make my funding 45000 and within 3 months")] == ["target_amount", "receipt_date"]
    assert _all("Change the amount in my funding readiness to £60,000 and check it again") == [("target_amount", 60000.0)]
    assert _all("update the funding route to loan, and the amount to £40k") == [("route_preference", "loan"), ("target_amount", 40000.0)]


def test_one_confirm_names_every_change_and_writes_them_together():
    case = {"id": "C1", "business_id": "A", "data": {"target_amount": 50000, "currency": "GBP", "receipt_date": "2027-04-30"}}
    out = case_edit.proposal(case, case_edit.read("make my funding 45000 and within 3 months"))
    assert out["message"].startswith("Change the target from £50,000 to £45,000 and the date you expect the funding from ")
    assert set(out["offers"][0]["post"]["body"]["changes"]) == {"target_amount", "receipt_date"}
