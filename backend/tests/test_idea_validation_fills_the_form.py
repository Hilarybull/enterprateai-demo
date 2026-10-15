"""Idea validation asked for in the Agent chat fills the Idea Validation form with what the owner said: the wizard's own
steps, saved with the workspace, for the page to fill the fields still empty."""
from test_agent import Env


def test_the_agents_idea_validation_fills_the_wizard_form_from_what_was_said():
    env = Env()
    said = {"description": "Weekend cookery classes for children", "customer": "Parents of 8 to 12 year olds",
            "problem": "Parents want screen free weekends for their children"}
    res = env.submit(text="validate my idea", capability="idea_validation", params={"answers": said})
    form = env.businesses["A"]["data"]["agent_validation_form"]
    assert form["run_id"] == res["run"]["id"]
    assert form["form"]["step1"]["idea_description"] == said["description"]
    assert form["form"]["step2"] == {"problem_description": said["problem"], "who_affected": said["customer"], "proposed_solution": said["description"]}
    assert form["form"]["step3"]["primary_segment"] == said["customer"]
    assert "steps_completed" not in form["form"]
    links = (res["run"]["state"]["outcome"] or {}).get("links") or []
    assert links[0]["label"] == "draft in Idea Validation" and links[0]["to"].startswith("/validation?history_id=agent-")
