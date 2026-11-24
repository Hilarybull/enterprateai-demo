"""The F1/F2 cleanup script's finder, on synthetic tasks and documents shaped like the reported cases (no database)."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("cleanup_agent_charges", Path(__file__).resolve().parents[1] / "scripts" / "cleanup_agent_charges.py")
cleanup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cleanup)

PLAN_RUN = {"id": "run-plan", "business_id": "ws-1", "requester_id": "u-1", "workflow_key": "business_plan_draft", "title": "Business Plan Draft",
            "source_channel": "business_event", "status": "failed", "reason_code": "retries_exhausted",
            "created_at": "2026-10-13T22:55:00+00:00", "updated_at": "2026-10-13T23:40:00+00:00",
            "state": {"credits": [{"feature": "business_plan_full", "for": "business_plan_full", "credits": 40, "at": "2026-10-13T22:59:00+00:00"}],
                      "outcome": {}}}
QUOTE_RUN = {"id": "run-quote", "business_id": "ws-2", "requester_id": "u-2", "workflow_key": "enquiry_to_quote", "title": "Enquiry to Quote",
             "source_channel": "text", "status": "succeeded", "created_at": "2026-10-11T16:48:00+00:00", "updated_at": "2026-10-11T16:52:00+00:00",
             "state": {"credits": [{"feature": "agent_classify", "for": "Reading the enquiry", "credits": 2, "at": "2026-10-11T16:49:02+00:00"},
                                   {"feature": "agent_classify", "for": "Reading the enquiry", "credits": 2, "at": "2026-10-11T16:49:40+00:00"},
                                   {"feature": "agent_quote_draft", "for": "create_quotation_draft", "credits": 2, "at": "2026-10-11T16:50:00+00:00"}]}}
REMINDERS = {"id": "run-remind", "business_id": "ws-2", "requester_id": "u-2", "workflow_key": "payment_followup", "source_channel": "business_event",
             "status": "succeeded", "created_at": "2026-10-01T09:00:00+00:00", "updated_at": "2026-10-09T09:00:00+00:00",
             "state": {"credits": [{"feature": "agent_send", "for": "send_payment_reminder", "credits": 2, "at": "2026-10-02T09:00:00+00:00"},
                                   {"feature": "agent_send", "for": "send_payment_reminder", "credits": 2, "at": "2026-10-09T09:00:00+00:00"}]}}
DOCS = [{"id": f"bp-{i}", "type": "business_plan", "workspace_id": "ws-1", "user_id": "u-1", "title": "Business Plan for QA Sparkle Cleaning Ltd",
         "created_at": f"2026-10-13T{h}+00:00"} for i, h in enumerate(("22:59:30", "23:10:00", "23:25:00", "23:39:00"), start=1)] \
    + [{"id": "bp-other", "type": "business_plan", "workspace_id": "ws-1", "user_id": "u-1", "title": "My own plan", "created_at": "2026-10-01T10:00:00+00:00"}]


def test_it_finds_the_runaway_plan_the_double_read_and_the_three_extra_drafts_and_nothing_else():
    found = cleanup.plan_cleanup([PLAN_RUN, QUOTE_RUN, REMINDERS], DOCS)
    assert [(r["run_id"], r["credits"]) for r in found["refunds"]] == [("run-plan", 40), ("run-quote", 2)]
    assert sorted(d["document_id"] for d in found["removals"]) == ["bp-1", "bp-2", "bp-3"]      # the newest is kept; the owner's own plan is untouched
    assert all(d["kept"] == "bp-4" for d in found["removals"])
    print("\n" + cleanup.report(found))


def test_a_refunded_task_and_one_still_to_be_retried_are_left_alone():
    done = {**PLAN_RUN, "state": {**PLAN_RUN["state"], "refunded": {"credits": 40}}}
    retrying = {**PLAN_RUN, "id": "run-retry", "reason_code": "stalled", "state": {**PLAN_RUN["state"], "auto_retries": 1}}
    assert cleanup.plan_cleanup([done, retrying], [])["refunds"] == []


def test_the_draft_the_task_points_at_is_the_one_kept():
    pointed = {**PLAN_RUN, "state": {**PLAN_RUN["state"], "outcome": {"plan": {"document_id": "bp-2"}}}}
    found = cleanup.plan_cleanup([pointed], DOCS)
    assert sorted(d["document_id"] for d in found["removals"]) == ["bp-1", "bp-3", "bp-4"]


def test_a_task_named_for_a_full_refund_is_refunded_once_and_not_also_as_a_double():
    succeeded = {**PLAN_RUN, "status": "succeeded", "reason_code": None}
    assert cleanup.plan_cleanup([succeeded], [])["refunds"] == []                       # delivered: only on the owner's say
    found = cleanup.plan_cleanup([succeeded], [], refund_runs={"run-plan"})
    assert [(r["run_id"], r["credits"], r["key"]) for r in found["refunds"]] == [("run-plan", 40, "refund:run-plan")]


def test_a_double_already_refunded_is_not_found_again():
    done = {**QUOTE_RUN, "state": {**QUOTE_RUN["state"], "refunded_doubles": [{"key": "refund:run-quote:double:1", "credits": 2}]}}
    assert cleanup.plan_cleanup([done], [])["refunds"] == []
