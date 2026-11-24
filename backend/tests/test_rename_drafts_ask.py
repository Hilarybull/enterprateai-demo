"""QA, 16 Oct: a workspace rename is logged in its history, and the unsent drafts still showing the old name are listed
for the owner to update or leave: only the ones chosen are updated, never unasked, and only drafts waiting for approval."""
from test_agent import Env, run
from test_b8_named_drafts import _draft
from app.modules.agent import sender_refresh
from app.modules.workspace_profile.service import _rename_log


def test_a_rename_is_logged_with_who_and_when():
    out = _rename_log({"workspace_history": []}, {"company_name": "Apex Consulting Ltd"}, {"company_name": "Alchemy Test"}, "owner@a.test")
    entry = out["workspace_history"][0]
    assert (entry["kind"], entry["from"], entry["to"], entry["by"]) == ("workspace_renamed", "Apex Consulting Ltd", "Alchemy Test", "owner@a.test")
    assert _rename_log({}, {"company_name": "Same"}, {"company_name": "Same"}, "x") == {}      # no rename, nothing logged


def test_drafts_with_the_old_name_are_listed_and_only_the_chosen_ones_change():
    env = Env()
    sending, _inv, ref = _draft(env)
    pending = run(env.store.list_approvals(run_id=sending["id"], status="pending"))[0]
    old = pending["payload"]["company"]
    listed = run(sender_refresh.drafts_with_old_name(env.orch, "A", "Brand New Name Ltd"))
    assert [d["id"] for d in listed] == [pending["id"]] and listed[0]["company"] == old
    assert run(sender_refresh.refresh_sender(env.orch, "A", [])) == []      # nothing chosen: nothing changed
    assert run(env.store.list_approvals(run_id=sending["id"], status="pending"))[0]["payload"]["company"] == old
    env.businesses["A"]["data"].setdefault("workspace_profile", {})["company_name"] = "Brand New Name Ltd"
    assert run(sender_refresh.refresh_sender(env.orch, "A", [pending["id"]])) == [ref]
    assert run(env.store.list_approvals(run_id=sending["id"], status="pending"))[0]["payload"]["company"] == "Brand New Name Ltd"
