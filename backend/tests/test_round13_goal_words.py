"""The owner, 26 Oct: typing "Test a business idea" was kept as the idea ("Test a business idea, nice", "₦25,000 a idea", the
summary listing it as the product): a goal's own words are never an answer; the idea is asked instead."""
import asyncio
import json

from app.modules.agent import goals, intake_turn


class _Llm:
    """A model that reads the goal's words as the idea, as the live one did."""
    async def generate_text(self, **kw):
        return type("R", (), {"text": json.dumps({"i": "answer", "x": [["description", "Test a business idea", "Test a business idea", 0.95]]})})()


def test_the_goals_words_are_never_the_answer():
    for said in ("Test a business idea", "validate my idea", "I want to test a new business idea.", "Test a business idea"):
        assert intake_turn.just_the_goal(said), said
    assert not intake_turn.just_the_goal("A mobile car wash for offices in Abuja")


def test_the_idea_is_asked_instead(monkeypatch):
    # The same model, with a real idea: kept (so the check above is not passing for want of a reading)
    class _Real(_Llm):
        async def generate_text(self, **kw):
            return type("R", (), {"text": json.dumps({"i": "answer", "x": [["description", "A mobile car wash for offices", "A mobile car wash for offices", 0.95]]})})()
    kept = asyncio.run(intake_turn.turn(goal_key="test_idea", message="A mobile car wash for offices", slots=goals.questions_for("test_idea"), known={},
                                        asked="description", llm=_Real()))
    assert kept["values"].get("description") == "A mobile car wash for offices", kept
    monkeypatch.setattr(intake_turn, "_default_llm", lambda *a, **k: _Llm(), raising=False)
    slots = goals.questions_for("test_idea")
    r = asyncio.run(intake_turn.turn(goal_key="test_idea", message="Test a business idea", slots=slots, known={}, asked="description", llm=_Llm()))
    assert "description" not in (r.get("values") or {}) and "Test a business idea" not in str(r.get("ack") or "")


def test_a_question_about_the_goal_is_never_the_product_but_a_worry_still_counts():
    """The owner, 26 Oct: "Got it: a how ready am I to launch?. What are you launching?"."""
    assert intake_turn.just_the_goal("How ready am I to launch?", "sell")
    assert not intake_turn.just_the_goal("What if my biggest client leaves?", "worry")      # a risk chat's answer, kept
