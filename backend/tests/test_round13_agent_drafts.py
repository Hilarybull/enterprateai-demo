"""The owner's brief, 25 Oct (F-10): "Do all for me" leaves each draft beside its field with Accept, Edit or Reject; nothing
is written for the owner, a filled field gets the draft as a suggestion under its value, and a rejected draft never returns."""
from test_goal_onboarding import world, _funding, OWNER, run  # noqa: F401
from app.modules.agent import assessment_summary
from app.modules.readiness import rules
from app.modules.readiness.service import service_for


def _case(env, client, who):
    who["user"] = OWNER
    _sid, made = _funding(client, use="a second van")
    return service_for(env.orch), made["handoff"]["subject_id"]


def _feed(env, cid, drafts):
    return run(assessment_summary.feed(env.orch, {"id": OWNER, "email": OWNER}, "A", "need_funding", {}, {}, "test-fill", subject_id=cid,
                                       adopted=[], case_drafts=drafts, as_drafts=True))


def test_drafts_wait_beside_their_fields_and_are_accepted_or_rejected(world):
    env, store, client, who = world
    svc, cid = _case(env, client, who)
    _feed(env, cid, {"market.differentiation": "Same-day service with eco products", "purpose": "A second van for more jobs"})
    data = run(svc.store.get("subjects", cid))["data"]
    assert not (data.get("market") or {}).get("differentiation")                       # never written for the owner
    assert data["agent_drafts"]["market.differentiation"]["value"] == "Same-day service with eco products"
    assert data["agent_drafts"]["purpose"]["replaces"] == "a second van"                 # a filled field: a suggestion under its value
    # Accept: the field takes the draft, the draft goes, and its source stays beside the value
    row = run(svc.store.get("subjects", cid))
    rest = {k: v for k, v in data["agent_drafts"].items() if k != "market.differentiation"}
    run(svc.update_subject(OWNER, "A", rules.FUNDING, cid, row["revision"], {"market": {"differentiation": "Same-day service with eco products"}, "agent_drafts": rest}, OWNER))
    data = run(svc.store.get("subjects", cid))["data"]
    assert data["market"]["differentiation"] == "Same-day service with eco products" and "market.differentiation" not in data["agent_drafts"]
    assert "accepted by you" in data["provenance"]["market.differentiation"]["source"]
    # Reject: gone, and never drafted again
    row = run(svc.store.get("subjects", cid))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, cid, row["revision"], {"agent_drafts": {}, "rejected_drafts": ["purpose"]}, OWNER))
    _feed(env, cid, {"purpose": "A second van for more jobs"})
    data = run(svc.store.get("subjects", cid))["data"]
    assert data["purpose"] == "a second van" and "purpose" not in (data.get("agent_drafts") or {})


def test_a_draft_that_matches_its_field_is_cleared_on_save(world):
    env, store, client, who = world
    svc, cid = _case(env, client, who)
    row = run(svc.store.get("subjects", cid))
    run(svc.update_subject(OWNER, "A", rules.FUNDING, cid, row["revision"], {"agent_drafts": {"purpose": {"value": "a second van", "replaces": "a second van"}}}, OWNER))
    assert "purpose" not in (run(svc.store.get("subjects", cid))["data"].get("agent_drafts") or {})
