"""QA U8: one task asked twice. Two "Idea Validation. What's the idea?" in Needs You were the same task waiting on
the same first answer. Asked again, the one waiting opens; older copies are closed and listed once; and opening a
page never starts an Idea Validation by itself."""
from app.modules.agent import autostart
from app.modules.agent.summary import build_summary
from app.modules.agent.twins import stale_twins
from test_agent import OWNER, Env, run


def _idea_env():
    env = Env()
    p = env.businesses["A"]["data"]["workspace_profile"]
    env.businesses["A"]["data"].pop("validation", None)
    for k in ("about_company", "description", "problem", "target_customer", "target_market", "target_customer_type"):
        p.pop(k, None)
    return env


def _twin(env, r, older_by="2026-01-01T00:00:00+00:00"):
    """The same task, started earlier and stopped at the same question (as the duplicates on record were)."""
    copy = {**run(env.store.get_run(r["id"])), "id": r["id"] + "-twin", "created_at": older_by, "dedupe_key": None}
    run(env.store.create_run(copy))
    return copy


def test_asking_again_opens_the_idea_validation_already_waiting():
    env = _idea_env()
    first = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert first["pending_question"]
    again = env.submit(capability="idea_validation", channel="ui_action")
    assert again["run"]["id"] == first["id"] and again.get("duplicate")
    waiting = [r for r in run(env.store.list_runs("A")) if r["workflow_key"] == "idea_validation" and r["status"] == "running"]
    assert len(waiting) == 1


def test_once_it_has_an_answer_a_new_request_is_a_new_task():
    env = _idea_env()
    first = env.submit(capability="idea_validation", channel="ui_action")["run"]
    run(env.orch.provide_input(first["id"], OWNER, {"description": "Bookkeeping"}))
    again = env.submit(capability="idea_validation", channel="ui_action")
    assert again["run"]["id"] != first["id"]      # only a task still waiting on its first answer is a twin


def test_needs_you_shows_a_task_asked_twice_once_and_housekeeping_closes_the_older():
    env = _idea_env()
    newer = env.submit(capability="idea_validation", channel="ui_action")["run"]
    older = _twin(env, newer)
    runs = run(env.store.list_runs("A"))
    assert [r["id"] for r in stale_twins(runs)] == [older["id"]]
    tiles = [t for t in run(build_summary(env.orch, OWNER, "A"))["suggestions"] if t.get("question")]
    assert [t["question"]["run_id"] for t in tiles] == [newer["id"]]
    assert run(env.orch.close_duplicates(runs)) == 1
    assert run(env.store.get_run(older["id"]))["status"] == "cancelled"
    assert run(env.store.get_run(newer["id"]))["status"] == "running"


def test_different_questions_are_not_twins():
    env = _idea_env()
    a = env.submit(capability="idea_validation", channel="ui_action")["run"]
    b = _twin(env, a)
    b["pending_question"] = {**b["pending_question"], "question": "Who is your customer?", "fields": [{"key": "customer", "label": "Customer", "type": "text"}]}
    run(env.store.update_run(b["id"], {"pending_question": b["pending_question"]}))
    assert stale_twins(run(env.store.list_runs("A"))) == []


def test_opening_a_page_never_starts_an_idea_validation(monkeypatch):
    env = Env()
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {}}}, OWNER))

    async def an_unscored_idea(*_a, **_k):
        return [{"capability": "idea_validation", "params": {}, "reference": "idea:validation", "goal": "Started automatically: the idea has not been scored"}]
    monkeypatch.setattr(autostart, "candidates", lambda *_a, **_k: [])
    monkeypatch.setattr(autostart, "preparation", an_unscored_idea)
    assert run(autostart.sweep(env.orch, "A", visit=True)) == []
    assert not [r for r in run(env.store.list_runs("A")) if r["workflow_key"] == "idea_validation"]
    started = run(autostart.sweep(env.orch, "A"))      # the scheduler's own look still may, as before
    assert [r["workflow_key"] for r in started] == ["idea_validation"]


def test_the_dashboards_look_for_work_is_a_visit(monkeypatch):
    from app.modules.agent import router
    seen = {}
    monkeypatch.setattr(autostart, "later", lambda business_id, orch=None, visit=False: seen.update(business_id=business_id, visit=visit))
    router._look_for_work("A")
    assert seen == {"business_id": "A", "visit": True}


def test_two_invoices_waiting_at_the_same_question_are_two_invoices_unless_sent_twice_within_minutes():
    from datetime import timedelta
    env = Env()
    one = env.submit(text="invoice Customer Ltd for consulting £100")["run"]
    one = run(env.store.get_run(one["id"]))
    assert one["status"] == "running" and one["pending_question"]
    days_ago = {**one, "id": one["id"] + "-days", "created_at": (env.now - timedelta(days=3)).isoformat()}
    run(env.store.create_run(days_ago))
    assert stale_twins(run(env.store.list_runs("A"))) == []                 # days apart: perhaps two invoices wanted
    just_now = {**one, "id": one["id"] + "-again", "created_at": (env.now - timedelta(seconds=30)).isoformat()}
    run(env.store.create_run(just_now))
    newest = max([one, just_now], key=lambda r: r["created_at"])
    assert [r["id"] for r in stale_twins(run(env.store.list_runs("A")))] == [min([one, just_now], key=lambda r: r["created_at"])["id"]]
    assert newest["id"] not in [r["id"] for r in stale_twins(run(env.store.list_runs("A")))]
