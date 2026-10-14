"""C2: a task that ended with nothing to do is "Nothing to do", never "Completed"; a stopped task's waiting step is closed
with it; and a step still working when the owner pressed Stop never undoes the stop. C1: the History filter is the registry."""
from app.modules.agent import router as agent_router
from app.modules.agent.models import RUN_CANCELLED, RUN_RUNNING
from app.modules.agent.workflows import WORKFLOWS
from test_agent import OWNER, Env, run


def test_nothing_to_do_is_its_own_status_and_its_own_filter():
    env = Env()
    empty = env.submit(capability="risk_concentration", channel="ui_action")["run"]      # no invoices: nothing to measure
    assert empty["status"] == "succeeded" and agent_router._public_run(empty)["display_status"] == "nothing_to_do"
    env2 = Env()
    done = env2.submit(capability="registration_checklist", channel="ui_action")["run"]
    assert agent_router._public_run(done)["display_status"] == "succeeded"


def test_stopping_a_task_closes_the_step_that_was_waiting():
    env = Env()
    r = env.submit(text="invoice somebody")["run"]
    assert r.get("pending_question")
    run(env.orch.cancel(r["id"], OWNER))
    steps = run(env.store.list_steps(r["id"]))
    assert steps and not [s for s in steps if s["state"] in ("awaiting_input", "running")]


def test_a_step_that_comes_back_after_stop_never_undoes_it():
    env = Env()
    r = env.submit(text="invoice somebody")["run"]
    run(env.orch.cancel(r["id"], OWNER))
    stale = {**r, "status": RUN_RUNNING, "pending_question": None}      # the in-memory copy a working step still holds
    run(env.orch._save(stale, "Carried on."))
    assert run(env.store.get_run(r["id"]))["status"] == RUN_CANCELLED and stale["status"] == RUN_CANCELLED


def test_c1_the_history_filter_lists_every_task_in_the_registry():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        res = TestClient(app).get("/agent/capabilities").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert {w["workflow_key"] for w in res["workflows"]} == set(WORKFLOWS) and len(WORKFLOWS) >= 32
    assert all(w["title"] for w in res["workflows"])


def test_b9_a_funding_pack_the_agent_prepared_is_listed_under_documents_with_its_link(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = Env()
    r = env.submit(capability="registration_checklist", channel="ui_action")["run"]
    outcome = {"documents": ["Business plan summary", "Cash flow forecast"], "case_id": "c1",
               "links": [{"label": "Funding pack", "to": "/funding/c1?tab=documents"}]}
    run(env.store.update_run(r["id"], {"workflow_key": "funding_pack_draft", "state": {**r["state"], "outcome": outcome}}))
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        body = TestClient(app).get("/businesses/A/agent/documents").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    [pack] = [d for d in body["items"] if d["kind"] == "funding_pack_draft"]
    assert pack["kind_label"] == "Funding pack" and pack["to"] == "/funding/c1?tab=documents" and pack["run_id"] == r["id"]
    assert pack["reference"] == "Business plan summary, Cash flow forecast" and pack["total"] is None
