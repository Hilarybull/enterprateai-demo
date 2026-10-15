"""Every Agent output is a draft for review in its module (the owner's QA, 15 Oct): the business plan is in Business
Blueprints with a link to the draft itself, counted in Needs Approval as "Needs your review"; the task reads "Waiting for
your review" until it is accepted, then Done."""
from test_agent import OWNER, Env, run
from test_agent_wording_all import _described

from app.modules.agent import drafts
from app.modules.agent import router as agent_router
from app.modules.agent.summary import build_summary


def test_a_business_plan_is_a_draft_to_review_until_accepted():
    env = Env()
    _described(env)
    r = env.submit(capability="business_plan_draft", channel="ui_action")["run"]
    link = r["state"]["outcome"]["links"][0]
    assert link["to"].startswith("/blueprint?tab=business-plans&document_id=doc-1&review=dr-")
    s = run(build_summary(env.orch, OWNER, "A"))
    card = next(c for c in s["needs_approval"] if c.get("type") == "draft")
    assert card["subtitle"] == "Needs your review" and card["title"].startswith("Business plan: ") and s["needs_approval_count"] >= 1
    assert agent_router._public_run(r)["display_status"] == "waiting_for_review"
    run(env.orch.rt.business.mutate("A", lambda d: drafts.decide(d, card["draft_id"], "accept")))
    s = run(build_summary(env.orch, OWNER, "A"))
    assert not [c for c in s["needs_approval"] if c.get("type") == "draft"]
