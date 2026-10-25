"""The owner, 25 Oct: "I need a business paln" with plans waiting for review said so in words, with no links. Each plan opens
from its own button, and a new one can be made; a typo in "plan" is read as plan."""
from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import drafts


def ask(client, text):
    return client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()


def test_plans_waiting_are_linked_and_a_new_one_is_offered(world):
    env, store, client, who = world
    who["user"] = OWNER
    d = env.businesses["A"]["data"]
    drafts.add(d, kind="business_plan", title="Business plan: Car wash subscription", to="/blueprint?tab=business-plans&document_id=doc-1", run_id="r1", ref="doc-1")
    drafts.add(d, kind="business_plan", title="Business plan: Drone Cleaning", to="/blueprint?tab=business-plans&document_id=doc-2", run_id="r2", ref="doc-2")
    out = ask(client, "I need a business paln")
    assert out["kind"] == "answer" and "2 business plans waiting for your review" in out["message"]
    labels = [o["label"] for o in out["offers"]]
    assert labels[-1] == "Create a new one" and out["offers"][-1] == {"label": "Create a new one", "capability": "business_plan_draft"}
    assert {"Open “Car wash subscription”", "Open “Drone Cleaning”"} <= set(labels)
    assert all("review=" in o["to"] for o in out["offers"][:-1])                 # opens the draft with its review bar
    assert env.meter.charges == []


def test_with_nothing_waiting_the_plan_is_started_as_before(world):
    env, store, client, who = world
    who["user"] = OWNER
    out = ask(client, "I need a business plan")
    assert "waiting for your review" not in str(out.get("message") or "")
