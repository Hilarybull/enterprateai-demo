"""The owner, 26 Oct: "agent is supposed to populate the field and get me the full validation output, based on basic or
comprehensive": the Agent runs the page's own full validation at either depth, kept on its draft, a separate idea's too."""
import asyncio

from app.modules.agent import services


def _go(depth, business_id="A", history_business=None, monkeypatch=None):
    started = []
    monkeypatch.setattr(services.ModuleStudio, "_full_later", staticmethod(lambda user_id, payload, business_id=None, history_id=None:
                                                                         started.append((payload["validation_mode"], business_id, history_id))))
    idea = {"description": "Truck cleaning for haulage firms", "customer": "haulage firms", "problem": "dirty trucks", "currency": "NGN",
            "depth": depth, "history_id": "agent-1", **({"history_business": history_business} if history_business else {})}
    out = asyncio.run(services.ModuleStudio().validate_idea(user_id="u1", business_id=business_id, idea=idea))
    return out, started


def test_basic_runs_the_full_validation_too(monkeypatch):
    out, started = _go("basic", monkeypatch=monkeypatch)
    assert started == [("basic", "A", "agent-1")] and out["full_report"] == "pending"
    assert "scores" in out["quick"] and len(out["quick"]) > 4      # the engine's whole result, never a cut-down one


def test_comprehensive_and_a_separate_ideas_draft(monkeypatch):
    _, started = _go("comprehensive", business_id=None, history_business="A", monkeypatch=monkeypatch)
    assert started == [("comprehensive", "A", "agent-1")]      # kept on the business's draft, though the idea is separate
