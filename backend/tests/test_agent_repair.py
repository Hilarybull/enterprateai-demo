"""Tasks started before the reader and the plan gate were fixed are put right once, and a tile's
title can never again be built from a subject that isn't one ("Proposal for business proposal")."""
from app.modules.agent import repair, summary
from test_agent import OWNER, Env, run

GOAL = "Write a business proposal for ABC Ltd for website maintenance"


def _old_proposal(env):
    """A proposal task as the old reader left it: the kind of document as the customer, and the customer's name in the scope."""
    r = env.submit(text=GOAL)["run"]
    q = r["pending_question"]
    for f in q["fields"]:
        if f["key"] == "customer_name":
            f.update({"default": "business proposal", "said": True})
        if f["key"] == "customer_id":
            f.update({"default": "new", "said_text": "business proposal (new)"})
        if f["key"] == "solution":
            f.update({"default": "ABC Ltd for website maintenance", "said": True, "said_text": "ABC Ltd for website maintenance"})
    run(env.store.update_run(r["id"], {"pending_question": q}))
    return r["id"]


def _history(env, run_id):
    return [e for e in env.store.audit if e.get("run_id") == run_id and e.get("event_type") == "agent_updated"] if hasattr(env.store, "audit") else None


def test_a_stored_task_with_the_document_type_as_its_customer_is_put_right_from_its_own_request():
    env = Env()
    rid = _old_proposal(env)
    before = run(env.store.get_run(rid))
    assert summary.question_title(before)["title"] == "New Proposal. Who is it for?"      # even unrepaired, the tile never says "Proposal for business proposal"
    would = run(repair.repair_business(env.orch, "A"))
    assert [e["run_id"] for e in would] == [rid] and run(env.store.get_run(rid))["pending_question"]["fields"] == before["pending_question"]["fields"]      # a dry run changes nothing
    done = run(repair.repair_business(env.orch, "A", apply=True))
    assert done[0]["changes"] == ["customer set to ABC Ltd", "what you propose set to Website maintenance"]
    after = run(env.store.get_run(rid))
    fields = {f["key"]: f for f in after["pending_question"]["fields"]}
    assert fields["customer_name"]["default"] == "ABC Ltd" and fields["customer_id"]["said_text"] == "ABC Ltd (new)" and fields["solution"]["default"] == "Website maintenance"
    assert summary.question_title(after)["title"].startswith("Proposal for ABC Ltd. ")
    assert env.meter.charges == []                                           # nothing is charged for being put right
    assert run(repair.repair_business(env.orch, "A", apply=True)) == []      # run again: nothing left to do


def test_what_the_owner_typed_is_never_changed():
    env = Env()
    rid = _old_proposal(env)
    r = run(env.store.get_run(rid))
    r["state"]["answers"] = {"customer_name": "business proposal", "solution": "ABC Ltd for website maintenance"}      # they typed these themselves
    run(env.store.update_run(rid, {"state": r["state"]}))
    assert run(repair.repair_business(env.orch, "A", apply=True)) == []
    fields = {f["key"]: f for f in run(env.store.get_run(rid))["pending_question"]["fields"]}
    assert fields["customer_name"]["default"] == "business proposal" and fields["solution"]["default"] == "ABC Ltd for website maintenance"


def test_an_idea_taken_from_the_profile_is_replaced_by_the_one_the_request_names():
    env = Env()
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    r["goal"] = "Validate my idea: a mobile car wash in Abuja"
    r["state"]["answers"].pop("description", None)
    r["state"].pop("idea_from_message", None)
    run(env.store.update_run(r["id"], {"goal": r["goal"], "state": r["state"]}))
    done = run(repair.repair_business(env.orch, "A", apply=True))
    assert done[0]["changes"] == ["idea set to Mobile car wash in Abuja"]
    assert run(env.store.get_run(r["id"]))["state"]["answers"]["description"] == "Mobile car wash in Abuja"


def test_a_subject_that_is_not_one_gets_a_task_only_title_and_an_empty_second_line():
    for bad in ("business proposal", "proposal", "my latest marketplace RFQ", "MMMMMMMM", "invoice", ""):
        assert summary.bad_subject(bad, "new_proposal"), bad
    assert not summary.bad_subject("ABC Ltd", "new_proposal") and not summary.bad_subject("Mark", "new_invoice")
    tile = summary.question_title({"workflow_key": "new_proposal", "state": {"params": {"customer_name": "business proposal"}},
                                   "pending_question": {"question": "Is this right?", "fields": [{"key": "customer_name", "label": "Customer name", "confirm": True, "default": "business proposal"}]}})
    assert tile == {"title": "New Proposal. Who is it for?", "detail": ""}
    idea = summary.question_title({"workflow_key": "idea_validation", "state": {"answers": {}},
                                   "pending_question": {"question": "Is this right?", "fields": [{"key": "description", "label": "What the business does", "confirm": True, "default": "Gooat"}]}})
    assert idea == {"title": "Idea Validation. What's the idea?", "detail": ""}
    assert "proposal for business proposal" not in tile["title"].lower()


def test_a_starter_only_task_on_explorer_is_held_with_upgrade_or_cancel_and_nothing_is_charged():
    env = Env(plan="starter_insight", credits=50)
    rid = env.submit(text=GOAL)["run"]["id"]
    spent = list(env.meter.charges)
    env.meter.plans[OWNER] = "explorer"                                      # the workspace is on Explorer now: proposals are not included
    done = run(repair.repair_business(env.orch, "A", apply=True))
    assert done[0]["plan"] == "held: New Proposal is on the Starter plan"
    held = run(env.store.get_run(rid))
    assert (held["substatus"], held["reason_code"], held["pending_question"]) == ("blocked", "plan", None) and held["next_action"] == "On the Starter plan. Upgrade or cancel."
    assert env.meter.charges == spent and env.meter.balances[OWNER] == 50 - sum(c[2] for c in spent)      # the credits are unchanged
    tile = next(t for t in run(summary.build_summary(env.orch, OWNER, "A"))["suggestions"] if t.get("held"))
    assert tile["text"] == "Proposal for ABC Ltd. On the Starter plan. Upgrade or cancel"
    assert tile["held"] == {"run_id": rid, "plan_required_label": "Starter", "task": "New Proposal"} and tile["action"] == {"to": "/pricing"}
    assert run(env.orch.cancel(rid, OWNER))["status"] == "cancelled"         # Cancel works on a held task
    # Upgraded instead: the same repair releases it, with its question as it was.
    again = Env(plan="starter_insight", credits=50)
    rid2 = again.submit(text=GOAL)["run"]["id"]
    asked = run(again.store.get_run(rid2))["pending_question"]
    again.meter.plans[OWNER] = "explorer"
    run(repair.repair_business(again.orch, "A", apply=True))
    again.meter.plans[OWNER] = "starter_insight"
    assert run(repair.repair_business(again.orch, "A", apply=True))[0]["plan"] == "released: the plan now includes it"
    back = run(again.store.get_run(rid2))
    assert back["substatus"] != "blocked" and back["pending_question"] == asked
