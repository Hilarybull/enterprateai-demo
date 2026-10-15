"""A quotation or invoice asked for on the homepage with "I'll add it later" for the email: the draft is made at
once, and the address is asked for when it is sent, not before (it was asked again at once, and nothing was drafted)."""
import pytest

from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401


@pytest.mark.parametrize("key,doc,prefix", [("create_quotation", "quotes", "QUO"), ("create_invoice", "invoices", "INV")])
def test_a_document_with_its_email_left_for_later_is_drafted(world, key, doc, prefix):  # noqa: F811
    env, _store, client, who = world
    s = client.post("/task-sessions", json={"key": key, "entry_mode": "quick_task"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "Investors", "customer_email": "unknown", "item": "folders",
                                                                           "quantity": 2, "amount": 300, "vat_rate": 0, "due_days": 30}}).json()
    assert s["next"] == "identity" and s["missing"] == []
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/attach-user")
    client.post(f"/task-sessions/{s['id']}/resume")
    p = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert p["handoff"]["ready"] is True and p["handoff"]["ready_message"].endswith("is ready to review. Add their email to send it.")
    shown = client.get(f"/workflow-runs/{p['handoff']['run_id']}").json()["run"]
    # In Needs Approval, flagged "Email needed" (QA, 15 Oct): never failed, and nothing else asked.
    assert shown["status"] == "awaiting_approval" and shown.get("pending_question") is None and shown["email_needed"]["customer"] == "Investors"
    records = env.businesses["A"]["data"]["financials"][doc]
    drafted = [r for r in records if (r.get("customer_name") or "") == "Investors"]
    assert len(drafted) == 1 and str(drafted[0].get("reference") or drafted[0].get("invoice_number") or prefix).startswith(prefix)
