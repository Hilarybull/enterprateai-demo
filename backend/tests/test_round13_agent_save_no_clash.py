"""The owner, 26 Oct: Launch "Accept all" said "Someone else changed this while you were editing" when only the Agent's own
save came between: no clash then; another person's (or another tab's) change still is one."""
import pytest
from test_readiness import Env, funding_case, run, OWNER, F
from app.modules.readiness.service import Conflict


def test_the_agents_own_save_in_between_is_no_clash():
    env = Env()
    svc, cid = funding_case(env)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    row = run(svc.store.get("subjects", cid))
    run(svc.store.update("subjects", cid, {"data": {**row["data"], "agent_drafts": {}}}, expect_revision=row["revision"]))      # the Agent's save
    saved = run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"purpose": "Mine, after the Agent's"}))
    assert saved["data"]["purpose"] == "Mine, after the Agent's"


def test_a_persons_save_in_between_is_still_a_clash():
    env = Env()
    svc, cid = funding_case(env)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"purpose": "First edit"}))
    with pytest.raises(Conflict):
        run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"purpose": "From a stale tab"}))
