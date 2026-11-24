"""D: a workspace with a country and no saved currency is never GBP: the research and the result follow the country."""
from app.modules.agent import first_value, research

NG = {"workspace_profile": {"country": "Nigeria"}}


def test_research_and_result_follow_the_country():
    assert research.task_currency(NG) == "NGN"
    out = first_value.assess("need_funding", {"amount": 50000, "use": "a van", "stage": "trading", "route": "grant"}, NG)
    assert out["currency_sign"] == "₦"
    assert research.task_currency({}) == "GBP"
