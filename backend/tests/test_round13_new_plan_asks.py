"""The owner, 26 Oct: "selected create new of the business plan on the agent and it just started creating, no question":
[Create a new one] asks what the plan is for and who will read it, as a typed request does, then its price."""
from test_goal_onboarding import world, OWNER  # noqa: F401


def test_create_a_new_one_asks_its_questions_first(world):
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/agent/requests", json={"business_id": "A", "capability": "business_plan_draft", "source_channel": "ui_action",
                                               "params": {"existing_plan": "new"}}).json()
    assert out["kind"] == "needs_input", out
    assert [f["key"] for f in out["fields"] if not f.get("show_if")] == ["plan_for", "purpose"]
    assert env.meter.charges == []      # nothing started or charged
    answered = client.post("/agent/requests", json={"business_id": "A", "capability": "business_plan_draft", "source_channel": "ui_action",
                                                    "params": {"existing_plan": "new", "plan_for": "business", "purpose": "lender"}}).json()
    assert answered["kind"] != "needs_input" or not any(f["key"] == "purpose" for f in answered.get("fields") or []), answered      # never asked twice
