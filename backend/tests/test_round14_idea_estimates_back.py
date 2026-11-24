"""The full Idea Validation's estimated figures are offered back to the idea, and saved only when the owner says
(the owner, 29 Oct: the Viability Snapshot stayed "Not known" after a validation run)."""
import asyncio
from types import SimpleNamespace

from app.modules.agent import router


class _Store:
    def __init__(self, data):
        self.data = data

    async def mutate(self, _bid, fn):
        return fn(self.data)


def _with(monkeypatch, data):
    orch = SimpleNamespace(rt=SimpleNamespace(business=_Store(data)))
    monkeypatch.setattr(router, "get_orchestrator", lambda: orch)
    return SimpleNamespace(business_id="b1", text="Use the estimated figures for my idea", locale=None)


def test_use_these_figures_fills_the_idea_marked_as_estimates(monkeypatch):
    data = {"quick_check_answers": {"test_idea": {"answers": {"description": "Home baked bread delivery"}}},
            "idea_estimates": {"idea": "Home baked bread delivery", "figures": {"price": 2500, "cost": 1200, "monthly_sales": 300}}}
    body = _with(monkeypatch, data)
    out = asyncio.run(router._use_estimates({"id": "u1"}, body, data))
    answers = data["quick_check_answers"]["test_idea"]["answers"]
    assert answers["price"] == 2500 and answers["cost"] == 1200 and answers["monthly_sales"] == 300
    assert answers["_estimated"] == "cost,monthly_sales,price"
    assert answers["description"] == "Home baked bread delivery"
    assert "idea_estimates" not in data
    assert "estimates" in out["message"] and "—" not in out["message"] and "–" not in out["message"]


def test_the_owners_own_figures_are_never_replaced(monkeypatch):
    data = {"quick_check_answers": {"test_idea": {"answers": {"description": "Bread", "price": 3000}}},
            "idea_estimates": {"idea": "Bread", "figures": {"price": 2500, "cost": 1200}}}
    body = _with(monkeypatch, data)
    asyncio.run(router._use_estimates({"id": "u1"}, body, data))
    answers = data["quick_check_answers"]["test_idea"]["answers"]
    assert answers["price"] == 3000 and answers["cost"] == 1200


def test_nothing_waiting_says_so(monkeypatch):
    data = {"quick_check_answers": {"test_idea": {"answers": {"description": "Bread"}}}}
    body = _with(monkeypatch, data)
    out = asyncio.run(router._use_estimates({"id": "u1"}, body, data))
    assert "no estimated figures" in out["message"]
    assert "price" not in data["quick_check_answers"]["test_idea"]["answers"]
