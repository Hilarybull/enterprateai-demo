"""The traction answer already gives the price (the owner's brief, 20 Oct): "300 cars a month, ₦1.2m revenue" is about
₦4,000 a wash, so the price step is partly there and asks only for the cost per sale. The score is unchanged."""
from app.modules.agent import goals


def test_the_price_is_worked_out_from_the_traction_answer():
    session = {"goal_key": "need_funding", "currency": "NGN", "created_at": "2026-10-20T00:00:00+00:00",
               "inputs": {"amount": 5000000, "use": "2 more washing bays", "stage": "trading", "timing": "3 to 6 months", "route": "loan",
                          "traction": "300 cars a month, ₦1.2m revenue"}}
    result = goals.first_value_of(session)
    step = next(b for b in result["blockers"] if b["key"] == "economics")
    assert step["prefill"]["price"] == 4000
    assert step["prefill"]["text"].startswith("About ₦4,000 a sale")
    plain = goals.first_value.assess("need_funding", session["inputs"], None, now=goals._now(None), sign="₦")
    assert plain["score"] == result["score"]      # display only
