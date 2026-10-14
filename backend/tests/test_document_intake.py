"""A document from the homepage: everything it needs is asked before the dashboard, and the
dashboard opens on the finished draft. From the First-Value PRD 4.2 and 6.1."""
from test_goal_onboarding import world  # noqa: F401  (the fixture)


def test_invoice_for_mark_300_dollars_asks_only_email_vat_and_lands_ready_for_approval_in_usd(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Invoice for Mark, $300 for food", "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "create_invoice" and s["currency"] == "USD"
    assert s["missing"] == ["customer_email", "vat_rate"]                   # who, what and how much were said; the due date is stated, not asked
    due = next(q for q in s["questions"] if q["key"] == "due_days")
    assert due["label"] == "Due in 14 days. Want a different date?" and due["default"] == 14 and not due.get("required")
    email = next(q for q in s["questions"] if q["key"] == "customer_email")
    assert email["unsure"] == "I'll add it later"
    assert "Here is how I can help" not in str(s) and s["resolution"]["recommended_path"] == []
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer_email": "mark@example.test", "vat_rate": 0}, "confirm": True}).json()
    assert s["next"] == "identity"
    # An existing owner on the free plan: the invoice is prepared for credits and is waiting for approval when the dashboard opens.
    from test_agent import OWNER
    env.meter.plans[OWNER], env.meter.balances[OWNER] = "explorer", 50
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/attach-user")
    client.post(f"/task-sessions/{s['id']}/resume", json={"business_id": "A"})
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert done.get("handoff", {}).get("run_id"), done
    run = client.get(f"/workflow-runs/{done['handoff']['run_id']}").json()["run"]
    assert run["status"] == "awaiting_approval", run.get("pending_question")      # no forms on the dashboard
    assert done["handoff"]["ready"] is True, done["handoff"]
    assert done["handoff"]["ready_message"] == "Your invoice for Mark is ready to review."
    approval = env.pending(run)[0]["payload"]
    assert approval["currency"] == "USD" and "mark@example.test" in str(approval) and approval["total"] == 300
    assert env.meter.charges                                                # paid for in credits on Explorer


def test_i_will_add_it_later_leaves_the_email_empty_and_never_invents_one(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Invoice for Mark, $300 for food", "entry_mode": "free_text"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer_email": "I'll add it later", "vat_rate": 20}, "confirm": True}).json()
    assert s["inputs"]["customer_email"] == "" and s["next"] == "identity"
