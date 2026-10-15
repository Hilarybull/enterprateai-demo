"""Idea validation asked of the Agent fills every field the wizard needs, runs the validation, and leaves it in Idea
Validation History as a pending draft for the owner to accept or reject; the full report updates that same draft."""
import asyncio

from app.modules.agent import services
from test_agent import Env

REQUIRED = {"step1": ("idea_name", "idea_type"), "step2": ("problem_description", "proposed_solution"), "step3": ("primary_segment",),
            "step5": ("solution_description",)}


def test_the_form_is_complete_for_the_wizard_and_the_idea_type_is_one_of_its_own():
    p = services.validation_payload({"description": "Bookkeeping and invoicing support for small UK service firms", "customer": "Small UK service firms",
                                     "problem": "Owners lose evenings to admin"}, "A")
    for step, keys in REQUIRED.items():
        assert all(str(p[step].get(k) or "").strip() for k in keys), (step, keys, p.get(step))
    assert p["step1"]["idea_type"] == "Professional service" and p["step1"]["business_stage"] == "Idea only"
    assert p["step1"]["idea_tagline"] == "Bookkeeping and invoicing support for small UK service firms"
    assert services.idea_type_of("a mobile car wash") == "Local service" and services.idea_type_of("cupcake boxes") == "Physical product"
    assert services.idea_type_of("an app for dog walkers") == "Mobile application" and services.idea_type_of("something new") == "Other"


def test_the_agents_validation_is_a_pending_draft_in_history():
    env = Env()
    said = {"description": "Weekend cookery classes for children", "customer": "Parents of 8 to 12 year olds", "problem": "Parents want screen free weekends"}
    res = env.submit(text="validate my idea", capability="idea_validation", params={"answers": said})
    history = env.businesses["A"]["data"]["validation_history"]
    entry = history[0]
    assert entry["id"].startswith("agent-") and entry["status"] == "pending" and entry["type"] == "v4_validation" and entry["source"] == "agent"
    assert entry["payload"]["step1"]["idea_type"] == "Training or education" and entry["score"] == 68
    link = res["run"]["state"]["outcome"]["links"][0]
    assert link == {"label": "draft in Idea Validation", "to": f"/validation?history_id={entry['id']}&history_type=v4_validation"}


def test_the_full_report_updates_the_same_draft(monkeypatch):
    store = {"data": {"validation_history": [{"id": "agent-1", "status": "pending", "score": 50, "result": {}}, {"id": "other", "status": "accepted"}]}}

    class WS:
        @property
        def data(self):
            return store["data"]

    async def get_workspace(*, user_id, workspace_id):
        return WS()

    async def update_workspace(*, user_id, workspace_id, data_patch, name=None):
        store["data"] = {**store["data"], **data_patch}
    from app.modules.idea_validation import service as iv
    monkeypatch.setattr(iv, "get_workspace", get_workspace)
    monkeypatch.setattr(iv, "update_workspace", update_workspace)
    asyncio.run(services.update_history_entry("u", "A", "agent-1", {"scores": {"potential_score": 72, "evidence_confidence_score": 40},
                                                                   "verdict": {"category": "promising"}, "research_data": {"big": True}}))
    entry = store["data"]["validation_history"][0]
    assert (entry["status"], entry["score"], entry["verdict"], entry["full_report"]) == ("pending", 72, "promising", "ready")
    assert "research_data" not in entry["result"] and store["data"]["validation_history"][1]["status"] == "accepted"
