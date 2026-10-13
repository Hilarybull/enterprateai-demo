"""The Agent's proposal is a document too: kept in Business Blueprints as a Client Proposal, for the workspace's
owner, and changed there when the draft is edited."""
from test_agent import OWNER, run
from test_agent_more_documents import _answer, _env


def test_a_drafted_proposal_is_filed_and_follows_an_edit():
    env = _env()
    asked = env.submit(text="write a proposal for QA Round Six for £4,500")["run"]
    r = _answer(env, asked, {"problem": "Month-end takes them a week.", "solution": "We take over bookkeeping and month-end.", "total": 4500, "timeline": "Live in 3 weeks"})
    studio = env.orch.rt.studio
    rec = env.fin["proposals"][0]
    doc = studio.filed[rec["blueprint_document_id"]]
    assert doc["type"] == "client_proposal" and doc["user_id"] == OWNER and doc["business_id"] == "A"
    assert rec["reference"] in doc["title"] and "QA Round Six Ltd" in doc["title"]
    md = doc["markdown"]
    assert "## What we propose\n\nWe take over bookkeeping and month-end." in md and "£4,500.00" in md and "Live in 3 weeks" in md
    run(env.orch.edit_draft(r["id"], OWNER, {"timeline": "Live in 2 weeks"}))
    assert len(studio.filed) == 1 and "Live in 2 weeks" in studio.filed[rec["blueprint_document_id"]]["markdown"]      # the same document, updated
