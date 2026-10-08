"""Last round of dashboard polish: a daily snapshot of the pre-launch figures, Active Risks that
matches the cards, a customer confirmed from the description, tiles that open the record they
describe, a retried task that says what happened, and a missing email that names its customer."""
from datetime import timedelta

from app.modules.agent import autostart
from app.modules.agent import dashboard as dash
from app.modules.agent import router as agent_router
from app.modules.agent.workflows import idea_of
from test_agent import OWNER, Env, run
from test_dashboard import invoice
from test_readiness import L, _dashboard, _pre, _suggestion, assess, funding_case, launch


def _figure(d, key):
    return next(k for k in d["kpis"] if k["key"] == key)


# ══ E-0 ═══════════════════════════════════════════════════════════════════════

def test_the_pre_launch_figures_are_kept_once_a_day_and_trends_appear_with_history():
    env = Env()
    d = _pre(env)
    today = env.now.date().isoformat()
    kept = env.businesses["A"]["data"]["kpi_history"]
    assert list(kept) == [today] and "launch_readiness" in kept[today]
    assert _figure(d, "launch_readiness")["trend"]["points"] == [{"at": today, "value": kept[today]["launch_readiness"]}]      # one point: "Tracking starts today"
    _pre(env)
    _pre(env)
    assert list(env.businesses["A"]["data"]["kpi_history"]) == [today]    # once a day, however often the page is opened
    env.now += timedelta(days=1)
    env.businesses["A"]["data"]["workspace_profile"]["registration_number"] = "12345678"      # one more setup item in place
    d2 = _pre(env)
    points = _figure(d2, "launch_readiness")["trend"]["points"]
    assert [p["at"] for p in points] == [today, env.now.date().isoformat()] and points[1]["value"] > points[0]["value"]
    assert _figure(d2, "runway")["trend"]["points"] == []                 # a figure with no value has no points: nothing is invented


def test_a_figure_that_changes_during_the_day_corrects_todays_row_and_a_preview_writes_nothing():
    env = Env()
    _pre(env)
    first = dict(env.businesses["A"]["data"]["kpi_history"][env.now.date().isoformat()])
    svc, lid = launch(env, prerequisite="not_completed")
    assess(svc, lid, L)
    _pre(env)
    row = env.businesses["A"]["data"]["kpi_history"][env.now.date().isoformat()]
    assert row["launch_risks"] == 1.0 and "launch_risks" not in first and len(env.businesses["A"]["data"]["kpi_history"]) == 1
    other = Env()
    run(dash.build_dashboard(other.orch, OWNER, "A", preview_stage="pre_launch"))
    assert "kpi_history" not in other.businesses["A"]["data"]             # looking at another stage keeps nothing
    assert all(k.get("trend") is None for k in _dashboard(Env())["kpis"]) or _dashboard(Env())["context"]["business_stage"] == "pre_launch"


# ══ E-1 ═══════════════════════════════════════════════════════════════════════

def test_active_risks_counts_what_the_cards_are_warning_about():
    env = Env()
    svc, cid = funding_case(env, demand=False)                            # a funding case that is not ready
    assess(svc, cid)
    d = _pre(env)
    funding = d["funding_readiness"]
    risks = _figure(d, "launch_risks")
    expected = max(len(funding.get("blockers") or []) + int(funding.get("missing_count") or 0), 1 if funding.get("classification") in ("not_ready", "insufficient_evidence") else 0)
    assert funding.get("classification") != "ready" and expected >= 1
    assert risks["value"] == str(expected) and risks["tone"] == "rose" and "funding gap" in risks["hint"]      # never 0 beside a "Not ready" case


def test_overdue_invoices_and_a_concentration_alert_are_counted_too():
    data = {"financials": {"invoices": [
        {"id": "p1", "customer_name": "QA Round Six Ltd", "total_amount": 587, "status": "paid", "paid_at": "2026-09-20T09:00:00+00:00"},
        {"id": "p2", "customer_name": "Nova Labs", "total_amount": 413, "status": "paid", "paid_at": "2026-09-21T09:00:00+00:00"},
        {"id": "o1", "customer_name": "Aftred", "total_amount": 149, "status": "sent", "due_date": "2026-09-01"},
        {"id": "o2", "customer_name": "Frank", "total_amount": 50, "status": "sent", "due_date": "2026-09-10"}]}}
    env = Env()
    count, parts = dash.active_risks_before_launch(data, {"risk": {"concentration_alert_pct": 40}}, env.now, {"launch": None, "funding": {
        "classification": "not_ready", "blockers": [{"label": "Demand evidence", "reason": "Missing"}], "missing_count": 2}})
    assert count == 3 + 2 + 1 and parts == ["3 funding gaps", "2 overdue invoices", "QA Round Six Ltd at 58.7% of revenue"]
    assert dash.active_risks_before_launch({}, {}, env.now, {"launch": None, "funding": None}) == (0, [])
    assert dash.active_risks_before_launch({}, {}, env.now, {"launch": {"blockers": [{}, {}]}, "funding": {"classification": "ready"}}) == (2, ["2 launch blockers"])


# ══ E-2 ═══════════════════════════════════════════════════════════════════════

def test_a_customer_read_out_of_the_description_is_confirmed_with_the_text_there_to_edit():
    env = Env()
    p = env.businesses["A"]["data"]["workspace_profile"]
    p["about_company"] = "bookkeeping and invoicing support for small UK service firms"
    env.businesses["A"]["data"].pop("validation", None)
    idea = idea_of(env.businesses["A"]["data"])
    assert (idea["customer"], idea["customer_guessed"]) == ("Small UK service firms", True)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    q = r["pending_question"]
    assert q["question"] == "Is this your customer? “Small UK service firms”"
    assert (q["fields"][0]["key"], q["fields"][0]["default"], q["fields"][0]["confirm"]) == ("customer", "Small UK service firms", True)
    assert run(autostart.answer_from_profile(env.orch, "A", env.businesses["A"]["data"], run(env.store.list_runs("A")))) == 0      # the owner's to confirm
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer": "Small UK service firms"}))
    assert r["pending_question"]["question"] == "What problem does your business solve? (1 to 2 sentences)"
    r = run(env.orch.provide_input(r["id"], OWNER, {"problem": "Owners lose evenings to paperwork"}))
    assert r["status"] == "succeeded" and p["target_customer"] == "Small UK service firms"
    # Confirmed once: it is on the profile now and is not asked again.
    again = idea_of(env.businesses["A"]["data"])
    assert (again["customer"], again["customer_guessed"]) == ("Small UK service firms", False)
    assert idea_of({"workspace_profile": {"about_company": "A shop", "target_customer": "Local families"}})["customer_guessed"] is False
    assert idea_of({"workspace_profile": {"about_company": "We sell things"}})["customer"] == ""      # nothing to read: asked plainly


# ══ C-1 ═══════════════════════════════════════════════════════════════════════

def test_every_agent_tile_opens_the_record_it_describes():
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, L)
    _, cid = funding_case(env)
    d = _pre(env)
    ready = _suggestion(d, "stage_blockers")
    assert ready["text"].startswith("Your launch is ready") and ready["action"] == {"to": f"/launch/{lid}"}      # the launch plan, not account settings
    allowed = {"stage_blockers": ("/launch/", "/agent/runs/"), "stage_funding": (f"/funding/{cid}", "/agent/runs/"), "stage_register": ("/registration", "/agent/runs/")}
    for tile in d["agent"]["suggestions"]:
        to = (tile.get("action") or {}).get("to") or ""
        assert not to.startswith("/account"), tile
        if tile["key"] in allowed:
            assert to.startswith(allowed[tile["key"]]), tile
    run(autostart.sweep(env.orch, "A"))                                   # after the Agent has worked: outcomes open their task
    for tile in _pre(env)["agent"]["suggestions"]:
        to = (tile.get("action") or {}).get("to") or ""
        assert not to.startswith("/account") and (tile["key"] not in allowed or to.startswith(allowed[tile["key"]])), tile
    blocked = Env()
    svc2, lid2 = launch(blocked, prerequisite="not_completed")
    assess(svc2, lid2, L)
    run(blocked.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    assert _suggestion(_pre(blocked), "stage_blockers")["action"]["to"].startswith(f"/launch/{lid2}")


# ══ C-2 ═══════════════════════════════════════════════════════════════════════

def test_after_a_retry_gets_through_the_task_says_what_happened_not_that_it_stopped():
    env = Env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    good = env.submit(capability="receipt_send", params={"invoice_id": "i2"}, channel="ui_action")["run"]
    stuck = dict(run(env.store.get_run(good["id"])), id="stuck-1", status="created", substatus=None, pending_question=None, wake_at=None, dedupe_key=None,
                 summary=None)
    env.store.runs["stuck-1"] = stuck
    for a in run(env.store.list_approvals(run_id=good["id"], status="pending")):
        run(env.store.update_approval(a["id"], {"status": "cancelled"}))
    env.store.runs[good["id"]]["status"] = "cancelled"
    env.store.runs["stuck-1"]["updated_at"] = env.now.isoformat()
    env.now += timedelta(minutes=11)
    run(env.orch.tick())
    after = run(env.store.get_run("stuck-1"))
    assert after["status"] == "awaiting_approval"
    assert after["summary"].startswith("Prepared receipt REC-") and after["summary"].endswith("after a retry. Waiting for your approval.")
    assert "stopped part-way" not in after["summary"] and "Retry" not in after["summary"]
    shown = agent_router._public_run(after)
    assert shown["summary"] == after["summary"] and shown["error"] is None


# ══ C-3 ═══════════════════════════════════════════════════════════════════════

def test_a_missing_email_names_the_customer_and_the_invoice_wherever_it_is_shown():
    env = Env()
    from test_dashboard import build, card, operating
    operating(env)
    inv = invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8, customer_email="")
    r = env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    ref = inv.get("reference") or "INV-late1"
    assert r["reason_code"] == "invalid_customer_destination"
    assert r["error"] == f"Aftred has no email on record for {ref}. Add it and I'll prepare the reminder."
    shown = agent_router._public_run(r)
    assert shown["email_needed"] == {"customer": "Aftred", "reference": ref}      # the page's heading and field use the same names
    step = card(build(env), "next_step")
    assert "waiting for an email address for Aftred" in step["text"]     # the dashboard says the same thing
    fixed = run(env.orch.fix_customer_email(r["id"], OWNER, "accounts@aftred.test"))
    assert fixed["status"] == "awaiting_approval" and agent_router._public_run(fixed)["email_needed"] is None


def test_a_task_retried_before_this_fix_no_longer_shows_the_old_stop_text():
    """REC-1061026: the retry had already succeeded, with the stop text still stored as its summary."""
    old = "This task stopped part-way at “Send the receipt” and didn't finish: it was interrupted while it was running. Nothing has been sent twice. Retry to carry on from where it stopped."
    run_ = {"id": "r1", "workflow_key": "receipt_send", "status": "awaiting_approval", "summary": old, "state": {"invoice_reference": "INV-1031026"}}
    shown = agent_router._public_run(run_)
    assert shown["summary"] == "Prepared receipt for INV-1031026 after a retry. Waiting for your approval."
    assert agent_router._public_run({**run_, "state": {"receipt_number": "REC-1061026"}})["summary"] == "Prepared receipt REC-1061026 after a retry. Waiting for your approval."
    assert agent_router._public_run({**run_, "status": "failed"})["summary"] == old      # still stopped: it says so
    fine = {"id": "r2", "workflow_key": "receipt_send", "status": "awaiting_approval", "summary": "Receipt REC-1 prepared.", "state": {}}
    assert agent_router._public_run(fine)["summary"] == "Receipt REC-1 prepared."
