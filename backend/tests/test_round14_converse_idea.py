"""The owner's mockups, 27 Oct (Idea Validation): the idea tested in a conversation. A stand-in model; no real model,
search or charge. The score is always the viability engine's, from the idea's answers."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import converse_idea, research

ANSWERS = {"description": "Managed IT security for small firms", "customer": "SMEs in Manchester", "price": 120, "monthly_sales": 500,
           "cost": 40, "fixed_costs": 2000, "capacity": 600, "demand": "research"}


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/quick-check/test_idea", json={"answers": ANSWERS})
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()      # noqa: E731
    return env, ask, model, client


def _answers(env):
    return (run(env.orch.rt.business.load("A")).get("quick_check_answers") or {})["test_idea"]["answers"]


def test_worth_launching_is_the_ideas_conversation_with_what_was_checked_and_the_result(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Which idea?"}, {"say": "Let me check what I already know about your business first."}]
    which = ask("I have a new service idea. How do I know if it's worth launching?")
    assert which["message"].startswith("Do you want to carry on with") and [a["label"] for a in which["actions"]][-1] == "A new idea"      # one on record: asked (28 Oct)
    out = ask(which["actions"][0]["prompt"])
    assert out.get("conversational") and [c["type"] for c in out["cards"]] == ["idea_inputs", "viability"]
    seen = model.prompts[0]["IDEA"]
    assert seen["answers"]["price"] == 120 and isinstance(seen["score_out_of_100"], (int, float))      # the engine's score, not the model's


def test_reduce_slightly_changes_the_answer_and_the_score_is_worked_out_again(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "You're in the Fair range."}, {"say": "Done.", "change": {"monthly_sales": 450}}]
    ask("Is my service idea worth it?")
    out = ask("Reduce the expected monthly sales slightly and keep this customer segment.")
    assert float(_answers(env)["monthly_sales"]) == 450 and "updated" in out["changed"]
    assert "Your idea is now at" in out["message"] and "/100" in out["message"]


def test_a_figure_never_said_is_never_set(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Fair."}, {"say": "I've set the price to 99.", "change": {"price": 99}}]
    ask("Is my service idea worth it?")
    out = ask("what price should it be?")
    assert float(_answers(env)["price"]) == 120 and out["message"].startswith("Before I change that")


def test_am_i_ready_to_launch_is_answered_for_the_idea(talk):
    env, ask, model, client = talk
    model.replies += [{"say": "Fair."}, {"say": "Your offer is strong, but test it first.", "show": ["launch_fit"]}]
    ask("Is my service idea worth it?")
    out = ask("So, am I ready to launch?")
    assert out.get("conversational") and [c["type"] for c in out["cards"]] == ["launch_fit"] and len(model.prompts) == 2


def test_the_landing_page_hands_an_idea_to_its_assistant(world):
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/agent/readiness-question", json={"business_id": "A", "text": "Test a business idea"}).json()
    assert out["to"] == "/check/idea?tab=assistant" and out["converse"]


def test_customer_concentration_is_the_dashboards():
    inv = lambda who, amt, st="paid": {"id": who + str(amt), "status": st, "total_amount": amt, "customer_name": who}      # noqa: E731
    data = {"financials": {"invoices": [inv("Livont Limited", 660), inv("Northbridge", 220), inv("Metro", 120), inv("Metro", 999, "draft")]}}
    risk = converse_idea.concentration(data)
    assert risk["customer"] == "Livont Limited" and risk["share"] == 66 and risk["level"] == "High"
    from app.modules.agent import business as bz
    assert risk["share"] == bz.concentration(data, 40)["top1_share_pct"]      # one number, the dashboard's
    assert converse_idea.concentration({"financials": {"invoices": [inv("Solo", 100)]}})["share"] == 100      # as the dashboard says
    assert converse_idea.concentration({}) is None


def test_the_side_column_has_the_idea_and_its_inputs(talk):
    env, ask, model, client = talk
    out = client.get("/businesses/A/agent/assistant-context?kind=idea&case_id=idea").json()
    assert [i["key"] for i in out["idea"]["inputs"]] == ["customer", "costs", "capacity", "price", "demand"]
    assert out["idea"]["answers"]["customer"] == "SMEs in Manchester"


def test_on_the_idea_page_a_launch_question_is_the_ideas_and_funding_is_taken_to_its_case(talk, monkeypatch):
    """The owner, 27 Oct: "Your launch score is now 0/100" was saved in the idea's chat: a page's message is its own topic's."""
    env, ask, model, client = talk
    model.replies.append({"say": "Your offer is strong, but test it first.", "show": ["launch_fit"]})
    page = lambda t: client.post("/agent/requests", json={"business_id": "A", "text": t, "source_channel": "text", "page": "idea"}).json()      # noqa: E731
    out = page("Am I ready to launch?")      # no idea conversation running: still the idea's, never the launch plan's
    assert out.get("conversational") and [c["type"] for c in out["cards"]] == ["launch_fit"] and len(model.prompts) == 1
    there = page("I need funding for this")
    assert there["elsewhere"].startswith(("/funding/", "/agent")) and len(model.prompts) == 1      # taken there, nothing answered here


def test_research_it_for_me_uses_what_the_idea_has_and_says_free_on_reuse(monkeypatch):
    """The owner, 28 Oct: "Research it for me" asked for price, costs and capacity the idea already had."""
    import asyncio
    from app.modules.agent import converse_idea, goal_router

    async def quote(*_a, **_k):
        return {"reuse": "r1", "max": 0}
    monkeypatch.setattr(goal_router, "_premium_quote", quote)
    held = {"agent_conversations": {}, "quick_check_answers": {"test_idea": {"answers": {"description": "Mobile valeting", "price": 5000, "cost": 1500, "capacity": 40}}}}

    class _Biz:
        async def load(self, _bid):
            return held

        async def mutate(self, _bid, fn):
            fn(held)
    orch = type("O", (), {"rt": type("R", (), {"business": _Biz()})()})()

    class _Model:
        async def generate_text(self, **_k):
            return type("R", (), {"text": '{"say": "Tell me your price, costs and capacity first."}'})()

    async def nothing(*_a, **_k):
        return []
    monkeypatch.setattr("app.modules.agent.converse.approvals_waiting", nothing)
    out = asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="Research it for me", llm=_Model()))
    assert "Tell me your price" not in out["message"] and "a price of" in out["message"] and "capacity of 40 a month" in out["message"]
    assert "This one is free" in out["message"]
    assert next(c for c in out["cards"] if c["type"] == "choose")["reuse"] is True


def test_chips_never_state_an_answer_the_owner_has_not_given(monkeypatch):
    """The owner, 28 Oct: chips offered "Fixed costs are ₦250,000" and "Demand level is pilot"."""
    import asyncio
    from app.modules.agent import converse_idea
    held = {"agent_conversations": {}, "quick_check_answers": {"test_idea": {"answers": {"description": "Mobile valeting", "price": 5000}}}}

    class _Biz:
        async def load(self, _bid):
            return held

        async def mutate(self, _bid, fn):
            fn(held)
    orch = type("O", (), {"rt": type("R", (), {"business": _Biz()})()})()

    class _Model:
        async def generate_text(self, **_k):
            return type("R", (), {"text": '{"say": "What are your costs?", "buttons": [{"kind": "reply", "label": "Fixed costs are ₦250,000", "text": "Fixed costs are ₦250,000"}, '
                                          '{"kind": "reply", "label": "Demand level is pilot", "text": "Demand level is pilot"}]}'})()

    async def nothing(*_a, **_k):
        return []
    monkeypatch.setattr("app.modules.agent.converse.approvals_waiting", nothing)
    out = asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="what next?", llm=_Model()))
    labels = [a["label"] for a in out["actions"]]
    assert labels and all(not any(ch.isdigit() for ch in x) and " is " not in x for x in labels)
    assert "Add my cost per sale" in labels and "Add my price" not in labels      # only what is missing


def test_another_idea_starts_afresh_and_research_is_for_it(monkeypatch):
    """The owner, 28 Oct: "carpet washing" then "Research and get them for me" researched the car detailing idea's figures."""
    import asyncio
    from app.modules.agent import converse_idea, goal_router
    seen = []

    async def quote(_u, _g, _r, answers, _d, **_k):
        seen.append(dict(answers))
        return {"max": 25}
    monkeypatch.setattr(goal_router, "_premium_quote", quote)
    held = {"agent_conversations": {}, "quick_check_answers": {"test_idea": {"answers": {"description": "Mobile car interior detailing", "customer": "SMEs in Abuja",
                                                                                         "price": 25000, "cost": 11000, "capacity": 60, "monthly_sales": 40}}}}

    class _Biz:
        async def load(self, _bid):
            return held

        async def mutate(self, _bid, fn):
            fn(held)
    orch = type("O", (), {"rt": type("R", (), {"business": _Biz()})()})()
    replies = [{"say": "Thanks for sharing carpet washing.", "change": {"description": "carpet washing"}},
               {"say": "I've started researching the remaining tasks for your Drone Cleaning launch plan."}]

    class _Model:
        async def generate_text(self, **_k):
            import json
            return type("R", (), {"text": json.dumps(replies.pop(0))})()

    async def nothing(*_a, **_k):
        return []
    monkeypatch.setattr("app.modules.agent.converse.approvals_waiting", nothing)
    asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="carpet washing", llm=_Model()))
    now = held["quick_check_answers"]["test_idea"]["answers"]
    assert now.get("description") == "carpet washing" and "price" not in now      # never the last idea's figures
    out = asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="what next?", llm=_Model()))
    assert "Drone Cleaning" not in out["message"] and any(c["type"] == "choose" for c in out["cards"])      # the claim became the real offer
    assert "price" not in seen[-1]


def test_new_idea_validation_asks_for_the_idea_and_starts_from_nothing(monkeypatch):
    """The owner, 28 Oct: "i need new Idea validation" carried on with the last idea."""
    import asyncio, json
    from app.modules.agent import converse_idea
    held = {"agent_conversations": {}, "quick_check_answers": {"test_idea": {"answers": {"description": "Mobile car interior detailing", "price": 25000, "cost": 11000}}}}

    class _Biz:
        async def load(self, _bid):
            return held

        async def mutate(self, _bid, fn):
            fn(held)
    orch = type("O", (), {"rt": type("R", (), {"business": _Biz()})()})()
    replies = [{"say": "Your mobile car interior detailing idea is at 57/100."}, {"say": "Thanks."}]

    class _Model:
        async def generate_text(self, **_k):
            return type("R", (), {"text": json.dumps(replies.pop(0))})()

    async def nothing(*_a, **_k):
        return []
    monkeypatch.setattr("app.modules.agent.converse.approvals_waiting", nothing)
    asked = asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="i need new Idea validation", llm=_Model()))
    assert asked["message"].startswith("Do you want to carry on with")
    replies.insert(0, {"say": "Sure."})
    what = asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="A new idea", llm=_Model()))
    assert what["message"].startswith("What's the new idea?")
    asyncio.run(converse_idea.turn(orch=orch, user={"id": "u1"}, business_id="b1", text="carpet washing for homes", llm=_Model()))
    now = held["quick_check_answers"]["test_idea"]["answers"]
    assert now.get("description") == "carpet washing for homes" and "price" not in now


def test_validate_my_idea_is_the_idea_validation_with_its_question(talk):
    """The owner, 28 Oct: "why is the validation not here? that was how it was working": fields filled, results to accept,
    modify or reject, and its approval waiting."""
    env, ask, model, client = talk
    out = ask("I want to validate a new idea")
    assert out["kind"] == "needs_input" and out.get("capability") == "idea_validation" and not model.prompts      # the validation's own question
    assert any(f["key"] == "idea_for" for f in out["fields"])
