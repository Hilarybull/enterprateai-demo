"""The owner, 27 Oct: "let's do other flows": launch readiness as a conversation, as funding is. A stand-in model here: no
real model, search or charge is used. A business can have many launches, so a new offering is a new plan, never "replace?"."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import research


def _plans(env):
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    return [r for r in run(service_for(env.orch).store.list("subjects", "A", kind=rules.LAUNCH))]


def _make_plan(env, name="Car wash subscription", **more):
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    return run(service_for(env.orch).create_subject(OWNER, "A", rules.LAUNCH, {"name": name, "scope": "commercial", **more}))


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text, **kw: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", **kw}).json()      # noqa: E731
    return env, ask, model


def test_a_launch_said_in_a_sentence_becomes_a_plan_and_is_checked(talk):
    env, ask, model = talk
    model.replies.append({"say": "Got it, a car wash subscription for office workers in Abuja.", "plan": "new",
                          "change": {"name": "Car wash subscription", "audience": "office workers", "geography": "Abuja", "price": 15000}, "check": True})
    out = ask("I want to launch a car wash subscription for office workers in Abuja at 15,000 a month")
    assert out.get("conversational") and out["changed"][:1] == ["created"]
    plan = _plans(env)[0]["data"]
    assert plan["name"] == "Car wash subscription" and plan["geography"] == "Abuja" and plan["customers"]["target_segment"] == "office workers"
    assert float(plan["offer"]["price"]) == 15000 and float(plan["economics"]["price_per_unit"]) == 15000
    assert out["actions"][0]["label"] == "Open your launch plan" and out["actions"][0]["to"].startswith("/launch/")


def test_a_follow_up_updates_the_plan_being_talked_about(talk):
    env, ask, model = talk
    made = _make_plan(env)
    model.replies += [{"say": "You're at 30/100 so far.", "plan": str(made["id"])},
                      {"say": "Done.", "plan": None, "change": {"price": 20000}, "check": True}]
    ask("How ready is my launch?")
    out = ask("make it 20,000")      # no launch words: a follow-up in the same conversation
    assert model.prompts[1]["ON"] == str(made["id"]) and model.prompts[1]["TURNS"][0]["text"] == "How ready is my launch?"
    assert float(_plans(env)[0]["data"]["offer"]["price"]) == 20000 and "updated" in out["changed"]


def test_another_launch_is_a_new_plan_beside_the_first(talk):
    env, ask, model = talk
    first = _make_plan(env)
    model.replies.append({"say": "A mobile detailing service, noted as a new launch.", "plan": "new", "change": {"name": "Mobile detailing"}})
    ask("I also want to launch mobile detailing")
    names = sorted(p["data"]["name"] for p in _plans(env))
    assert names == ["Car wash subscription", "Mobile detailing"] and first["id"] in [p["id"] for p in _plans(env)]


def test_a_price_never_said_is_never_set(talk):
    env, ask, model = talk
    _make_plan(env)
    model.replies.append({"say": "I've set the price to 12,000.", "change": {"price": 12000}})
    out = ask("I want to launch it next month")
    assert "price" not in (_plans(env)[0]["data"].get("offer") or {})
    assert out["message"].startswith("Before I set that up, tell me what you'll charge")


def test_which_plan_is_asked_when_there_are_several(talk):
    env, ask, model = talk
    _make_plan(env)
    _make_plan(env, name="Mobile detailing")
    model.replies.append({"say": "Done.", "plan": None, "change": {"geography": "Lagos"}})
    out = ask("Let's launch in Lagos")
    # Each plan as a button, never "which?" in words alone (the owner, 29 Oct); nothing changed until one is picked
    assert out["message"].startswith("You have 2 launch plans") and all(not p["data"].get("geography") for p in _plans(env))
    assert {a["label"] for a in out["actions"]} == {"Car wash subscription", "Mobile detailing"}


def test_the_landing_page_hands_launch_to_the_chat_panel(world):
    env, store, client, who = world
    who["user"] = OWNER
    said = lambda t: client.post("/agent/readiness-question", json={"business_id": "A", "text": t}).json()      # noqa: E731
    # No launch plan yet: Launch Readiness's own conversation (the owner, 27 Oct: "launch readiness has no destination")
    assert said("I want to launch a product/service") == {"kind": "launch", "converse": True, "to": "/launch?tab=assistant"}
    assert said("I need funding") == {"kind": "funding", "converse": True}


def test_without_a_model_typed_launch_details_create_and_check_a_plan(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: None)
    out = client.post("/agent/requests", json={"business_id": "A", "text": "I want to launch window cleaning for offices in Leeds in March at £40 per visit", "source_channel": "text"}).json()
    assert out.get("conversational") and "created" in out.get("changed", [])
    assert "tell me what each sale costs you to deliver." in out["message"]
    plan = _plans(env)[0]["data"]
    assert plan["name"] == "window cleaning" and plan["geography"] == "Leeds"
    assert plan["customers"]["target_segment"] == "offices"
    assert plan["offer"]["price"] == 40 and plan["target_date"].endswith("-03-01")


def test_an_invoice_mid_launch_conversation_goes_to_its_own_flow(talk):
    env, ask, model = talk
    _make_plan(env)
    model.replies.append({"say": "You're at 30/100 so far."})
    ask("How ready is my launch?")
    out = ask("create an invoice for Mark for 300")
    assert not out.get("conversational") and len(model.prompts) == 1


def test_with_one_plan_a_launch_question_opens_that_plans_assistant_and_with_two_the_launch_page(world):
    env, store, client, who = world
    who["user"] = OWNER
    said = lambda t: client.post("/agent/readiness-question", json={"business_id": "A", "text": t}).json()      # noqa: E731
    one = _make_plan(env)
    assert said("So, am I ready to launch my new service?")["to"] == f"/launch/{one['id']}?tab=assistant"
    _make_plan(env, name="Mobile detailing")
    assert said("So, am I ready to launch my new service?")["to"] == "/launch?tab=assistant"      # it asks which, in the launch thread


def test_on_a_plans_page_the_answer_is_about_that_plan(talk):
    """The owner, 28 Oct: on Drone Cleaning's page, "How ready is my launch?" asked which launch, and "Help me complete it"
    asked questions instead of the chooser."""
    env, ask, model = talk
    _make_plan(env, name="Car wash subscription")
    drone = _make_plan(env, name="Drone Cleaning")
    out = ask("Help me complete it", page="launch", case_id=str(drone["id"]))
    assert "which" not in out["message"].lower() and not model.prompts      # about this plan, never "which launch?"
    model.replies.append({"say": "Drone Cleaning is at 0/100 so far."})
    ask("How ready is my launch?", page="launch", case_id=str(drone["id"]))
    assert model.prompts[-1]["ON"] == str(drone["id"])


def test_a_plan_made_in_the_chat_is_offered_research_on_get_all_for_me(talk):
    """The owner, 28 Oct: yam farming, made in the launch chat, "get all for me" twice: "Let me do that for you now" and nothing
    started, because the plan had no research of its own."""
    env, ask, model = talk
    yam = _make_plan(env, name="yam farming", audience="local markets")
    out = ask("get all for me", page="launch", case_id=str(yam["id"]))
    assert "can't research" not in out["message"] and "couldn't set up" not in out["message"]
    assert any(c.get("type") == "choose" for c in out.get("cards") or [])      # its price and Start, never a claim
    held = run(env.orch.rt.business.load("A")) or {}
    assert (held.get("chat_sessions") or {}).get(str(yam["id"]))      # its research kept with it from now on
    model.replies.append({"say": "I'll gather demand evidence for you. Let me do that for you now."})
    again = ask("what do you need from me?", page="launch", case_id=str(yam["id"]))
    assert "Let me do that for you now" not in again["message"]      # a claim of starting becomes the real offer


def test_a_claim_of_getting_started_becomes_the_real_offer(talk):
    """The owner, 29 Oct: "Great, you have 714 credits, so I can do the full research and drafting... I'll get started on that"
    with no next step and no progress."""
    env, ask, model = talk
    pot = _make_plan(env, name="Pot selling", audience="households")
    model.replies.append({"say": "Great, you have 714 credits, so I can do the full research and drafting for your pot selling launch now. I'll get started on that."})
    out = ask("what next for my launch?", page="launch", case_id=str(pot["id"]))
    assert "I'll get started" not in out["message"] and "714" not in out["message"]
    assert any(c.get("type") == "choose" for c in out.get("cards") or [])      # its price and Start


def test_fill_them_drafts_every_blank_field_with_estimates_for_review(talk, monkeypatch):
    """The owner, 29 Oct: "fill them and bring for review!!!"."""
    import json as _json
    env, ask, model = talk
    pot = _make_plan(env, name="Pot selling", audience="households", geography="Abuja")

    class _Writer:
        async def generate_text(self, **_k):
            return type("R", (), {"text": _json.dumps({"fields": {"economics.price_per_unit": "8000", "market.budget": "50000",
                                                                 "offer.launch_scope": "Cooking pots sold at local markets in Abuja"}})})()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: _Writer())
    out = ask("fill them", page="launch", case_id=str(pot["id"]))
    assert out["message"].startswith("I've added") and "review=1" in out["actions"][0]["to"]
    from app.modules.readiness.service import service_for
    drafts = run(service_for(env.orch).store.get("subjects", pot["id"]))["data"]["agent_drafts"]
    assert drafts["economics.price_per_unit"]["value"] == "8000" and "estimate" in drafts["economics.price_per_unit"]["source"]
    from app.modules.readiness.service import ReadinessService
    assert "economics.price_per_unit" in ReadinessService.drafts_now(run(service_for(env.orch).store.get("subjects", pot["id"]))["data"], {})      # kept, as an estimate


def test_a_receipt_is_its_own_task_never_the_launch_chat(talk):
    """The owner, 29 Oct: "receipt" in the Agent Centre became "I'll attach it to your pot selling launch plan"."""
    env, ask, model = talk
    _make_plan(env, name="Pot selling")
    model.replies.append({"say": "Got it, a pot selling launch."})
    ask("I want to launch pot selling")      # the launch chat is open
    out = ask("i need a new receipt")
    assert "launch plan" not in str(out.get("message")).lower() and "attach" not in str(out.get("message")).lower()
