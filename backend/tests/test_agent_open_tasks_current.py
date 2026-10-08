"""Open tasks read as they should now: a waiting task created with old wording shows the new
wording when it is loaded, built from its state and the records, not from the stored string."""
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import autostart, current
from app.modules.agent import router as agent_router
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run
from test_dashboard import invoice, operating

ABOUT = "bookkeeping and invoicing support for small UK service firms"
OLD_EMAIL = "There's no valid email address for this customer, so no reminder was sent. Fix the customer's email to continue."
OLD_STOP = ("This task stopped part-way at “Send the receipt” and didn't finish: it was interrupted while it was running. "
            "Nothing has been sent twice. Retry to carry on from where it stopped.")


def _client(monkeypatch, env):
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    return TestClient(app)


def _old_email_task(env):
    """A payment follow-up as it was left before the wording changed: the old sentence, no names saved."""
    operating(env)
    inv = invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8, customer_email="")
    r = env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    stored = env.store.runs[r["id"]]
    stored.update({"error": OLD_EMAIL, "summary": OLD_EMAIL, "next_action": OLD_EMAIL})
    stored["state"].pop("email_needed", None)
    return r["id"], inv


def test_a_follow_up_stopped_with_the_old_text_names_the_customer_and_invoice_when_loaded(monkeypatch):
    env = Env()
    run_id, inv = _old_email_task(env)
    ref = inv.get("reference") or "INV-late1"
    try:
        with _client(monkeypatch, env) as client:
            shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
            want = f"Aftred has no email on record for {ref}. Add it and I'll prepare the reminder."
            assert shown["error"] == shown["summary"] == shown["next_action"] == want
            assert shown["email_needed"] == {"customer": "Aftred", "reference": ref}
            listed = client.get("/businesses/A/workflow-runs").json()["items"]
            assert next(r for r in listed if r["id"] == run_id)["error"] == want      # the same in the Agent Centre list
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert env.store.runs[run_id]["error"] == OLD_EMAIL                   # built when read; the stored sentence is only the fallback


def test_a_receipt_task_retried_under_the_old_text_shows_what_happened_and_names_the_receipt(monkeypatch):
    env = Env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    r = env.submit(capability="receipt_send", params={"invoice_id": "i2"}, channel="ui_action")["run"]
    assert r["status"] == "awaiting_approval"
    env.store.runs[r["id"]]["summary"] = OLD_STOP                         # as it was left by a retry before the fix
    number = env.fin["invoices"][0]["payments"][0]["receipt"]["number"]
    try:
        with _client(monkeypatch, env) as client:
            shown = client.get(f"/workflow-runs/{r['id']}").json()["run"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert shown["summary"] == f"Prepared receipt {number} after a retry. Waiting for your approval."
    assert "stopped part-way" not in shown["summary"] and "Retry" not in shown["summary"] and shown["error"] is None


def test_an_idea_task_waiting_on_who_is_your_customer_switches_to_the_confirm_form_when_loaded(monkeypatch):
    env = Env()
    p = env.businesses["A"]["data"]["workspace_profile"]
    env.businesses["A"]["data"].pop("validation", None)
    for k in ("about_company", "description", "problem", "target_customer", "target_market", "target_customer_type"):
        p.pop(k, None)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    r = run(env.orch.provide_input(r["id"], OWNER, {"description": "Bookkeeping"}))
    assert r["pending_question"]["question"] == "Who is your customer? (for example: independent cafés in Manchester)"      # the old, empty question
    assert "default" not in r["pending_question"]["fields"][0]
    p["about_company"] = ABOUT                                            # the profile says who it is for
    try:
        with _client(monkeypatch, env) as client:
            shown = client.get(f"/workflow-runs/{r['id']}").json()["run"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    q = shown["pending_question"]
    assert q["question"] == "Is this your customer? “Small UK service firms”"
    assert (q["fields"][0]["key"], q["fields"][0]["default"], q["fields"][0]["confirm"]) == ("customer", "Small UK service firms", True)
    again = run(current.recheck_against_profile(env.orch, run(env.store.get_run(r["id"])), env.businesses["A"]["data"]))
    assert again["seq"] == run(env.store.get_run(r["id"]))["seq"]         # already the confirm form: loading it again changes nothing


def test_the_agents_own_look_updates_the_card_too_and_other_tasks_are_left_alone():
    env = Env()
    p = env.businesses["A"]["data"]["workspace_profile"]
    env.businesses["A"]["data"].pop("validation", None)
    for k in ("about_company", "description", "problem", "target_customer", "target_market", "target_customer_type"):
        p.pop(k, None)
    idea = env.submit(capability="idea_validation", channel="ui_action")["run"]
    quote = env.submit(capability="enquiry_to_quote", params={"body": "Please quote for your Unpriced Service", "sender_name": "BrightTech Ltd",
                                                              "sender_email": "buyer@brighttech.test"})["run"]
    p.update({"about_company": ABOUT})
    changed = run(autostart.answer_from_profile(env.orch, "A", env.businesses["A"]["data"], run(env.store.list_runs("A"))))
    assert changed == 1
    assert run(env.store.get_run(idea["id"]))["pending_question"]["question"] == "Is this your customer? “Small UK service firms”"
    assert run(env.store.get_run(quote["id"]))["pending_question"] == quote["pending_question"]      # a quotation's question is not about the profile


def test_tasks_that_have_finished_keep_their_own_account():
    env = Env()
    done = {"id": "r1", "workflow_key": "payment_followup", "status": "succeeded", "summary": "Payment reminder sent.", "state": {"invoice_id": "x"}}
    assert run(current.open_runs(env.orch, "A", [done]))[0] is done
    assert current.refresh_texts({"id": "r2", "workflow_key": "payment_followup", "status": "failed", "reason_code": "credits_exhausted",
                                  "error": "You're out of AI Credits.", "state": {}}, {})["error"] == "You're out of AI Credits."


def test_the_plan_step_and_an_invoice_with_no_typed_number_both_read_as_agreed(monkeypatch):
    """Run 18621706: the invoice had no number of its own, and the "Send the reminder" step still carried the old sentence."""
    env = Env()
    run_id, inv = _old_email_task(env)
    stored = env.businesses["A"]["data"]["financials"]["invoices"]
    target = next(i for i in stored if i["id"] == inv["id"])
    for key in ("reference", "invoice_number", "number", "invoice_no"):
        target.pop(key, None)                                             # saved without a number, as many invoices are
    from app.modules.agent.dashboard import invoice_label, invoice_labels
    known_as = invoice_label(target, invoice_labels(env.businesses["A"]["data"]))
    assert known_as.startswith("INV-")                                    # the number Business Operations and the dashboard show for it
    for step in env.store.steps.values():
        if step["run_id"] == run_id and step.get("error"):
            step["error"] = OLD_EMAIL
            step["note"] = OLD_EMAIL
    want = f"Aftred has no email on record for {known_as}. Add it and I'll prepare the reminder."
    try:
        with _client(monkeypatch, env) as client:
            body = client.get(f"/workflow-runs/{run_id}").json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert body["run"]["error"] == want and body["run"]["email_needed"] == {"customer": "Aftred", "reference": known_as}
    texts = [t for s in body["steps"] + body["step_attempts"] for t in (s.get("note"), s.get("error")) if t]
    assert texts and all(t == want for t in texts if "email" in t.lower())      # the plan says the same as the task
    assert not any("no valid email address" in t or "Fix the customer" in t for t in texts)
    # A follow-up stopped from now on is worded this way from the start, with the same number.
    fresh = Env()
    operating(fresh)
    bare = invoice(fresh, "late9", "Aftred", 149, paid=False, due_in=-8, customer_email="")
    for key in ("reference", "invoice_number", "number", "invoice_no"):
        next(i for i in fresh.fin["invoices"] if i["id"] == bare["id"]).pop(key, None)
    r = fresh.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": bare["id"]})["run"]
    label = invoice_label(next(i for i in fresh.fin["invoices"] if i["id"] == bare["id"]), invoice_labels(fresh.businesses["A"]["data"]))
    assert r["error"] == f"Aftred has no email on record for {label}. Add it and I'll prepare the reminder."


def test_the_customer_question_reads_the_launch_plan_too(monkeypatch):
    """A-1: "Who is this launch for?" is already answered in the launch plan, so it is offered for a yes."""
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    env = Env()
    p = env.businesses["A"]["data"]["workspace_profile"]
    env.businesses["A"]["data"].pop("validation", None)
    for k in ("about_company", "description", "problem", "target_customer", "target_market", "target_customer_type"):
        p.pop(k, None)
    p["about_company"] = "Bookkeeping"
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert r["pending_question"]["question"].startswith("Who is your customer?")      # nothing says who it is for yet
    run(service_for(env.orch).store.insert("subjects", {
        "id": "l1", "business_id": "A", "kind": rules.LAUNCH, "status": "draft", "revision": 1, "created_at": env.now.isoformat(), "updated_at": env.now.isoformat(),
        "data": {"title": "QA Launch round 3", "profile": rules.CURRENT[rules.LAUNCH], "audience": "Small UK service firms", "geography": "United Kingdom",
                 "customers": {"target_segment": "UK service firms with 5 to 50 staff", "problem": "Owners lose evenings to paperwork"}}}))
    try:
        with _client(monkeypatch, env) as client:
            q = client.get(f"/workflow-runs/{r['id']}").json()["run"]["pending_question"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert q["question"] == "Is this your customer? “UK service firms with 5 to 50 staff”"
    field = q["fields"][0]
    assert (field["default"], field["confirm"]) == ("UK service firms with 5 to 50 staff", True)
    assert field["hint"] == "Taken from your launch plan “QA Launch round 3”. Change it if it isn't quite right."
    # Confirmed: the problem is in the launch plan too, so it is not asked for.
    after = run(env.orch.provide_input(r["id"], OWNER, {"customer": "UK service firms with 5 to 50 staff"}))
    assert not (after.get("pending_question") or {}).get("question", "").startswith("What problem")
    # A written answer is given the same launch plan, through the module's own permission check.
    from app.modules.agent import modules
    seen = run(modules.readiness_for(env.orch, OWNER, "A"))
    assert seen["launch_plans"][0]["title"] == "QA Launch round 3" and seen["launch_plans"][0]["who_it_is_for"] == "UK service firms with 5 to 50 staff"
    assert run(modules.readiness_for(env.orch, "stranger@nowhere.test", "A")) == {}      # someone with no access is given nothing
