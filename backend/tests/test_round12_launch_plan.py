"""The owner, 23 Oct: a business plan started from a launch plan's Overview is about that launch's product, never the
business's own offering, and is named for the product."""
import json

from test_agent import OWNER, Env, run
from app.modules.readiness import rules
from app.modules.readiness.service import service_for


def _plan_from_launch(scope):
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"].update({"company_name": "E2E Car Wash Abuja", "description": "Mobile car wash for office workers in Abuja"})
    env.meter.plans[OWNER] = "starter_insight"
    launch = run(service_for(env.orch).create_subject(OWNER, "A", rules.LAUNCH, {"name": f"{scope}, Leeds", "offer": {"launch_scope": scope}}, OWNER))
    out = env.submit(capability="business_plan_draft", params={"subject_id": launch["id"], "purpose": "planning"}, channel="ui_action", confirmed=True)
    [call] = [c for c in env.orch.rt.studio.calls if c[0] == "draft_plan"]
    drafts = [d for d in env.businesses["A"]["data"].get("agent_drafts") or [] if d.get("kind") == "business_plan"]
    return out, call, drafts


def test_a_plan_from_another_products_launch_is_about_that_product():
    out, call, drafts = _plan_from_launch("Drone window cleaning")
    said = json.dumps(call[1], default=str)
    assert "Drone window cleaning" in said and "car wash" not in said.lower()
    assert drafts and drafts[-1]["title"] == "Drone window cleaning"


def test_a_plan_from_the_businesss_own_launch_is_still_named_for_the_product():
    out, call, drafts = _plan_from_launch("Monthly car wash subscription")
    assert "Monthly car wash subscription" in json.dumps(call[1], default=str)
    assert drafts and drafts[-1]["title"] == "Monthly car wash subscription"
