"""G7 (23 Oct): a business plan already drafted for the same subject is offered before a new one is priced."""
from test_goal_onboarding import world, OWNER  # noqa: F401


def test_a_plan_for_the_same_idea_asks_open_it_or_write_a_new_one(world):
    env, store, client, who = world
    who["user"] = OWNER
    env.businesses["A"]["data"]["agent_drafts"] = [{"id": "dr-1", "kind": "business_plan", "status": "pending", "title": "Drone window cleaning",
                                                    "to": "/blueprint?tab=business-plans&document_id=d1", "inputs": {"solution": "Drone window cleaning for office buildings"}}]
    body = {"business_id": "A", "text": "write a business plan", "source_channel": "text", "capability": "business_plan_draft",
            "params": {"plan_for": "new", "idea": "Drone window cleaning for tall offices", "purpose": "investors"}}
    out = client.post("/agent/requests", json=body).json()
    assert out["message"] == "You already have a draft: “Drone window cleaning”. Open it, or write a new one?"
    assert [o["value"] for o in out["fields"][0]["options"]] == ["open", "new"]
    opened = client.post("/agent/requests", json={**body, "params": {**body["params"], "existing_plan": "open"}}).json()
    assert opened["actions"] == [{"label": "Open it", "to": "/blueprint?tab=business-plans&document_id=d1"}]
    fresh = client.post("/agent/requests", json={**body, "params": {**body["params"], "existing_plan": "new"}}).json()
    assert "Open it, or write a new one?" not in str(fresh.get("message")) and env.meter.charges == []
    # Another subject: never asked
    other = client.post("/agent/requests", json={**body, "params": {**body["params"], "idea": "Mobile dog grooming van"}}).json()
    assert "already have a draft" not in str(other.get("message"))
