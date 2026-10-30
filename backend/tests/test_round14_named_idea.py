"""An idea named in the message is the one checked and validated, never the earlier one (the owner, 30 Oct: "Test my idea:
a mobile phone repair kiosk in Manchester…" was validated as the stored bike repair idea in Bristol)."""
import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round14_converse_funding import _Model
from app.modules.agent import converse_idea, research

OLD = {"description": "mobile bike repair service for commuters in Bristol", "customer": "Daily cycle commuters", "price": 35}
SAID = "Test my idea: a mobile phone repair kiosk in Manchester city centre, £45 per repair, for students and office workers"


def test_the_idea_is_read_from_the_message():
    assert converse_idea.named_idea(SAID).startswith("a mobile phone repair kiosk in Manchester")
    assert converse_idea.named_idea("Test my idea") == ""      # none named: the held idea, as before
    assert converse_idea.named_idea("How do I know if it's worth launching?") == ""


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/quick-check/test_idea", json={"answers": OLD})
    model = _Model()
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: model)
    ask = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "page": "idea"}).json()      # noqa: E731
    return env, ask, model


def test_a_named_idea_replaces_the_earlier_one_never_its_figures(talk):
    env, ask, model = talk
    model.replies += [{"say": "Let me look at it."}]
    ask(SAID)
    held = (run(env.orch.rt.business.load("A")).get("quick_check_answers") or {})["test_idea"]["answers"]
    assert held["description"].startswith("a mobile phone repair kiosk in Manchester")
    assert "customer" not in held and "price" not in held      # the bike repair idea's commuters and £35 never carried over
