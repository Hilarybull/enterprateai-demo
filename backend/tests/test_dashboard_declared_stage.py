"""QA P1-4: the stage given at sign-up ("Early revenue") is the dashboard's stage on a new account
with no records yet, said as such, until the records show the business is further on."""
from test_dashboard import Env, build, idea, operating, run


def _said(env, stage):
    env.businesses["A"]["data"].setdefault("workspace_profile", {})["operating_stage"] = stage


def test_early_revenue_at_sign_up_is_not_shown_as_idea_stage():
    env = Env()
    idea(env)
    _said(env, "early_revenue")
    c = build(env)["context"]
    # QA R10: "Early revenue" is the startup stage (not operating) until the records show more.
    assert (c["business_stage"], c["stage_label"], c["stage_source"], c["detected_stage"]) == ("startup", "Startup", "declared", "idea")
    assert c["stage_signals"][0] == "You said: Early revenue"


def test_just_an_idea_or_no_answer_leaves_the_records_to_decide():
    for given in ("idea", None):
        env = Env()
        idea(env)
        if given:
            _said(env, given)
        assert build(env)["context"]["stage_source"] == "records"


def test_records_further_on_than_what_was_said_win_and_say_why():
    env = Env()
    operating(env)
    _said(env, "pre_revenue")
    c = build(env)["context"]
    assert c["stage_source"] == "records" and c["business_stage"] in ("operating", "growth")
    assert any("more than the stage you gave (Pre-revenue)" in s for s in c["stage_signals"])


def test_a_stage_chosen_on_the_dashboard_still_wins():
    env = Env()
    idea(env)
    _said(env, "early_revenue")
    env.businesses["A"]["data"]["dashboard_stage"] = {"stage": "pre_launch", "set_by": "x", "set_at": "2026-10-11"}
    c = build(env)["context"]
    assert (c["business_stage"], c["stage_source"]) == ("pre_launch", "manual")


# ── QA P1-5: "I'm …" only for a task really running; "while you were away" leaves out what the owner did here ──
from datetime import datetime, timezone  # noqa: E402

from app.modules.agent.summary import briefing_of  # noqa: E402


def test_a_stage_tile_says_im_only_while_its_task_runs():
    env = Env()
    idea(env)
    tile = lambda: next(s for s in build(env)["agent"]["suggestions"] if s["key"] == "stage_validate")  # noqa: E731
    assert (tile()["text"], tile()["mood"]) == ("Score my idea", "suggested")
    run_ = {"id": "r1", "business_id": "A", "workflow_key": "idea_validation", "status": "running", "pending_question": None,
            "created_at": "2026-10-11T09:00:00+00:00", "updated_at": "2026-10-11T09:00:00+00:00", "state": {}}
    run(env.store.create_run(run_))
    assert (tile()["text"], tile()["mood"]) == ("I'm scoring your idea.", "working")


def test_while_you_were_away_leaves_out_what_the_owner_asked_for_here():
    since, now = "2026-10-11T09:00:00+00:00", datetime(2026, 10, 11, 10, tzinfo=timezone.utc)
    mine = {"id": "q1", "workflow_key": "enquiry_to_quote", "status": "awaiting_approval", "source_channel": "text",
            "created_at": "2026-10-11T09:30:00+00:00", "completed_at": "2026-10-11T09:31:00+00:00", "state": {}}
    agents = {**mine, "id": "q2", "source_channel": "marketplace_rfq"}
    before = {**mine, "id": "q3", "created_at": "2026-10-11T08:00:00+00:00"}      # asked for before they left, done since
    assert briefing_of([mine], since=since, needs_approval=1, now=now)["done_since_last_visit"] == {}
    assert briefing_of([mine, agents, before], since=since, needs_approval=1, now=now)["done_since_last_visit"] == {"enquiry_to_quote": 2}


# ── QA P2-6: no "Updated today" over an idea validation that has never run ──

def test_the_idea_report_is_empty_until_the_idea_is_validated():
    env = Env()
    idea(env)
    r = build(env)["report"]
    assert r["key"] == "idea_validation_report" and r["has_result"] is False and r["empty_text"].startswith("Not run yet.")
    env.businesses["A"]["data"]["validation"] = {"score": 62}
    assert build(env)["report"]["has_result"] is True


# ── QA P2-7: the next step is not "Time-sensitive", and never points at work switched off ──

def test_the_idea_next_step_skips_switched_off_work_and_is_not_time_sensitive():
    env = Env()
    idea(env)
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"market_size": False}}}, "owner@a.test"))
    nxt = next(c for c in build(env)["insights"] if c["key"] == "next_step")
    assert nxt["priority_class"] == 4 and "market size" not in nxt["text"]
    assert nxt["text"] == "After your idea's score. Next: your business plan."


def test_r10_records_prove_operating_over_early_revenue():
    env = Env()
    operating(env)
    _said(env, "early_revenue")
    c = build(env)["context"]
    assert (c["business_stage"], c["stage_source"]) in (("operating", "records"), ("growth", "records"))


def test_r10_the_mapping_is_in_one_place_and_an_old_saved_startup_choice_still_means_pre_launch():
    from app.modules.agent import stages
    assert stages.DECLARED_STAGE["early_revenue"] == "startup" and stages.STAGES.index("startup") == 2
    env = Env()
    idea(env)
    env.businesses["A"]["data"]["dashboard_stage"] = {"stage": "startup", "set_by": "x", "set_at": "2026-09-01"}      # saved before v2
    assert build(env)["context"]["business_stage"] == "pre_launch"
    env.businesses["A"]["data"]["dashboard_stage"] = {"stage": "startup", "set_by": "x", "set_at": "2026-10-11", "v": 2}
    assert build(env)["context"]["business_stage"] == "startup"
