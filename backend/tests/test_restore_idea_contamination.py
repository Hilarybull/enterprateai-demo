"""The idea-contamination restore's finder, on synthetic records: values written by an Agent idea task for a different
idea go back to the snapshot before it; nothing unknown is guessed; the idea gets its own record."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("restore", Path(__file__).resolve().parents[1] / "scripts" / "restore_idea_contamination.py")
restore = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(restore)

PROV = {"source": {"kind": "agent_task", "run_id": "r1", "workflow": "idea_validation", "offering": "Mobile dog grooming van"}}
RUN = {"id": "r1", "created_at": "2026-10-13T21:49:19", "state": {"answers": {"description": "Mobile dog grooming van", "customer": "Dog owners"},
                                                              "outcome": {"score": 15}}}


def _ws(**profile):
    return {"id": "w1", "data": {"workspace_profile": {"company_name": "Sparkle", "target_customer": "Dog owners", "provenance": {"target_customer": PROV}, **profile},
                                 "validation": {"source": "agent", "overall_score": 15}}}


def test_a_different_idea_is_taken_back_to_the_snapshot_and_kept_as_its_own_idea():
    snaps = [{"created_at": "2026-10-12T16:37:45", "data": {"workspace_profile": {"services": [{"service_name": "Home cleaning"}]}}}]
    found = restore.plan_restore(_ws(), {"r1": RUN}, snaps)
    assert [(r["field"], r["remove"]) for r in found["restore"]] == [("target_customer", True), ("validation", True)]
    assert found["ideas"][0]["record"]["results"][0]["score"] == 15 and found["confirm"] == []
    fixed = restore.apply_restore(_ws()["data"], found)
    assert "target_customer" not in fixed["workspace_profile"] and "validation" not in fixed and "target_customer" not in fixed["workspace_profile"]["provenance"]
    assert list(fixed["agent_ideas"]) == ["mobile-dog-grooming-van"]


def test_nothing_is_guessed_without_a_snapshot_or_when_the_idea_may_be_the_business_own():
    assert restore.plan_restore(_ws(), {"r1": RUN}, [])["restore"] == []                     # no snapshot before: asked
    own = [{"created_at": "2026-10-12T16:37:45", "data": {"workspace_profile": {"description": "Mobile dog grooming van"}}}]
    found = restore.plan_restore(_ws(), {"r1": RUN}, own)
    assert found["restore"] == [] and found["confirm"]                                     # the same offer: maybe theirs
