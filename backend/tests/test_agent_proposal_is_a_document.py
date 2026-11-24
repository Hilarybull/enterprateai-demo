"""The Agent's proposal is the same document as the Business Blueprints page's Client Proposal: written by the same
generator from the same inputs, charged at the price list's Complete Business Proposal, saved there and linked from the
PRO record. If it can't be written (not enough credits), the short version is filed, free, and the task says so."""
from test_agent import OWNER, run
from test_agent_more_documents import _answer, _env

ANSWERS = {"problem": "Month-end takes them a week.", "solution": "We take over bookkeeping and month-end.", "total": 4500, "timeline": "Live in 3 weeks"}


def _drafted(env):
    asked = env.submit(text="write a proposal for QA Round Six for £4,500")["run"]
    return _answer(env, asked, ANSWERS)


def test_the_full_proposal_is_written_by_the_blueprints_generator_and_charged_like_it():
    env = _env()
    env.meter.costs["proposal_full"] = 25
    r = _drafted(env)
    rec = env.fin["proposals"][0]
    [(what, brief)] = [c for c in env.orch.rt.studio.calls if c[0] == "draft_proposal"]
    assert brief["bill_to"] == "QA Round Six Ltd" and brief["problem"] == ANSWERS["problem"] and brief["solution"] == ANSWERS["solution"]
    assert brief["timeline"] == "Live in 3 weeks" and "4,500.00" in brief["items"] and brief["pricing_model"] == "One-off price"
    assert rec["blueprint_kind"] == "generated" and rec["blueprint_document_id"].startswith("doc-pro")
    assert (OWNER, "proposal_full", 25) in env.meter.charges and r["status"] == "awaiting_approval"
    run(env.orch.edit_draft(r["id"], OWNER, {"timeline": "Live in 2 weeks"}))
    assert [c[0] for c in env.orch.rt.studio.calls].count("draft_proposal") == 1      # an edit doesn't rewrite (or charge) it again
    assert [c[1] for c in env.meter.charges].count("proposal_full") == 1


def test_without_the_credits_for_it_the_short_version_is_filed_free_and_said():
    env = _env()
    env.meter.costs["proposal_full"] = 25
    env.meter.balances[OWNER] = 3
    r = _drafted(env)
    rec = env.fin["proposals"][0]
    doc = env.orch.rt.studio.filed[rec["blueprint_document_id"]]
    assert doc["type"] == "client_proposal" and "## What we propose\n\nWe take over bookkeeping and month-end." in doc["markdown"]
    assert not any(c[1] == "proposal_full" for c in env.meter.charges)
    notes = " ".join((s.get("note") or "") for s in r.get("steps") or []) + " " + str(r.get("state", {}).get("notes") or "")
    assert "the full proposal wasn't written. This needs 25 credits; you have 3" in str(r) + notes
