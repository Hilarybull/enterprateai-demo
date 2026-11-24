"""The owner, 26 Oct: "it should be deleted on reject", "not only idea rejection, business plan too": a rejected idea
validation leaves Idea Validation History; a rejected business plan is deleted from Business Blueprints. Accepting keeps."""
from datetime import datetime, timezone

from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import drafts


def _data():
    data = {"validation_history": [{"id": "agent-1", "status": "pending"}, {"id": "own-2", "status": "accepted"}], "active_validation_id": "agent-1"}
    drafts.add(data, kind="idea_validation", title="Bush Clearing", to="/validation?history_id=agent-1", run_id="r1", ref="agent-1",
               now=datetime.now(timezone.utc))
    return data


def test_a_rejected_idea_validation_is_deleted_and_an_accepted_one_kept():
    data = _data()
    d = drafts.decide(data, data["agent_drafts"][0]["id"], "reject")
    assert d["status"] == "rejected" and [e["id"] for e in data["validation_history"]] == ["own-2"] and "active_validation_id" not in data
    data = _data()
    drafts.decide(data, data["agent_drafts"][0]["id"], "accept")
    assert [e["status"] for e in data["validation_history"]] == ["accepted", "accepted"]


def test_a_rejected_business_plan_is_deleted(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    gone = []

    async def delete_document(*, user_id, document_id):
        gone.append((user_id, document_id))
        return True
    import app.modules.blueprint.repository as repo
    monkeypatch.setattr(repo, "delete_document", delete_document)
    data = env.businesses["A"]["data"]
    plan = drafts.add(data, kind="business_plan", title="Bush Clearing", to="/blueprint?tab=business_plan&document_id=doc-9", run_id="r9", ref="doc-9",
                      now=datetime.now(timezone.utc))
    out = client.post(f"/businesses/A/agent-drafts/{plan['id']}/decide", json={"decision": "reject"}).json()
    assert out["message"] == "Rejected and deleted." and gone == [(OWNER, "doc-9")]
    letter = drafts.add(data, kind="sales_letter", title="Letter", to="/blueprint", run_id="r10", ref="doc-10", now=datetime.now(timezone.utc))
    client.post(f"/businesses/A/agent-drafts/{letter['id']}/decide", json={"decision": "reject"})
    assert gone == [(OWNER, "doc-9")]      # only what was asked: a business plan
