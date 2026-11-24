"""QA, 16 Oct: "I selected grant, why is the research about loans?" The funding route chosen is the one researched and
drafted; all three are compared only when the route is not decided."""
from app.modules.agent import first_value, research


def _topics(route):
    a = {"amount": 100000, "use": "buying water", "stage": "pre_revenue", "route": route, "timing": "Within 3 months", "traction": "No traction yet"}
    result = first_value.funding(a, {})
    topics, _items, _waiting = research.plan_run("need_funding", result, a, {"country": "Nigeria", "place": "Abuja"})
    return {t["topic"] for t in topics if t["topic"].startswith("route_")}, a, result


def test_a_chosen_route_is_the_only_one_researched():
    assert _topics("grant")[0] == {"route_grant"}
    assert _topics("loan")[0] == {"route_loan"}
    assert _topics("equity")[0] == {"route_equity"}


def test_not_sure_compares_all_three():
    assert _topics("unknown")[0] == {"route_equity", "route_loan", "route_grant"}


def test_the_draft_compares_only_the_chosen_route():
    _t, a, result = _topics("grant")
    d = research.funding_deliverables(a, [], result, "NGN")
    assert [r["route"] for r in d["routes"]] == ["grant"]
