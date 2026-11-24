"""The owner, 25 Oct: the Agent fills an idea's price, cost per sale and sales a month when nothing gives them, as estimates
to change on Idea Validation, instead of stopping at "still needed"."""
import asyncio
from types import SimpleNamespace

from app.modules.agent import research, workflows


class _Model:
    def __init__(self, text):
        self.text = text

    async def generate_text(self, **_k):
        return SimpleNamespace(text=self.text)


def _ctx():
    return SimpleNamespace(actor=SimpleNamespace(user_id="u1"), answers={}, run={"id": "r1"})


def test_missing_figures_are_estimated_and_marked(monkeypatch):
    monkeypatch.setattr(research, "_default_llm", lambda _u: _Model('{"price": 25, "cost": 8, "monthly_sales": 40, "basis": "typical for a small car wash in Abuja"}'))
    idea = {"description": "Car wash subscription", "location": "Abuja", "currency": "NGN", "known": {"price": 30000}}
    out = asyncio.run(workflows._estimate_economics(_ctx(), idea))
    assert out["known"]["price"] == 30000                                   # on record: kept, never estimated
    assert out["known"]["cost"] == 8 and out["known"]["monthly_sales"] == 40 and out["estimated"] == ["cost", "monthly_sales"]
    assert workflows.economics_gaps(out, {}) == []                          # scored, never "still needed"
    assert out["estimate_basis"].startswith("typical")


def test_an_estimate_that_makes_no_sense_is_not_used(monkeypatch):
    monkeypatch.setattr(research, "_default_llm", lambda _u: _Model('{"price": 10, "cost": 90, "monthly_sales": null}'))
    out = asyncio.run(workflows._estimate_economics(_ctx(), {"description": "Dog walking", "known": {}}))
    assert out["known"].get("cost") is None and out["known"]["price"] == 10 and out["estimated"] == ["price"]
    monkeypatch.setattr(research, "_default_llm", lambda _u: None)      # no model: nothing guessed
    assert "estimated" not in asyncio.run(workflows._estimate_economics(_ctx(), {"description": "Dog walking", "known": {}}))
