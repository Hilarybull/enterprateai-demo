"""Settings must retain explicit zero values."""
from datetime import timedelta
import pytest
from test_agent import Env, OWNER, T0, invoiced, run

@pytest.mark.parametrize("customer_terms,default_terms", [(0, 14), (None, 0)])
def test_immediate_payment_terms_set_invoice_due_today(customer_terms, default_terms):
    env = Env()
    env.businesses["A"]["data"]["catalogue"]["customers"][0]["payment_terms"] = customer_terms
    run(env.store.set_policy("A", {"default_payment_terms_days": default_terms}, OWNER))
    invoiced(env)
    invoice = env.fin["invoices"][-1]
    assert invoice["due_date"] == invoice["issued_at"]

@pytest.mark.parametrize("automatic", [False, True])
def test_zero_reminders_never_requests_or_sends_a_reminder(automatic):
    env = Env(plan="decision_engine")
    run(env.store.set_policy("A", {"reminders": {"auto_send": automatic, "max_reminders": 0}}, OWNER))
    task, invoice = invoiced(env)
    before = len(env.comms.sent)
    env.now = T0 + timedelta(days=40)
    run(env.orch.tick())
    run(env.orch.advance(task["id"]))
    assert len(env.comms.sent) == before
    assert not invoice.get("reminders")
    assert not env.pending(task)

def test_zero_reminders_also_blocks_standalone_followup():
    env = Env()
    run(env.store.set_policy("A", {"reminders": {"max_reminders": 0}}, OWNER))
    env.fin["invoices"] = [{"id": "i1", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 500, "status": "sent", "due_date": "2026-09-01", "reference": "INV-1"}]
    result = env.submit(text="Remind customers whose invoices are overdue")
    assert result["run"]["reason_code"] == "reminders_exhausted"
    assert not env.pending(result["run"])
    assert not env.comms.sent


def test_settings_save_and_reload_preserves_switches_limits_and_timezone(monkeypatch):
    from app.modules.agent import router
    env = Env(plan="decision_engine")
    monkeypatch.setattr(router, "get_orchestrator", lambda: env.orch)
    body = router.PolicyIn(default_payment_terms_days=0, quote_validity_days=45,
        default_vat_rate=0, max_reminders=0, reminder_cadence_days=[21, 3, 10, 3],
        reminders_auto_send=True, member_can_approve=True, automation_credit_cap=0,
        auto_start=False, automation_items={"quote_accepted": False, "rfq_arrives": False},
        concentration_alert_pct=65, timezone="Africa/Lagos", timezone_source="owner")
    run(router.update_policy("A", body, user={"id": OWNER}))
    saved = run(router.read_policy("A", user={"id": OWNER}))
    policy = saved["policy"]
    assert policy["default_payment_terms_days"] == policy["default_vat_rate"] == 0
    assert policy["quote_validity_days"] == 45 and policy["member_can_approve"] is True
    assert policy["reminders"]["auto_send"] is True
    assert policy["reminders"]["max_reminders"] == 0
    assert policy["reminders"]["cadence_days_overdue"] == [3, 10, 21]
    assert policy["automation"]["auto_start"] is False
    assert policy["automation"]["items"]["quote_accepted"] is False
    assert policy["marketplace_rfq"]["auto_start"] is False
    assert policy["risk"]["concentration_alert_pct"] == 65
    assert saved["automatic_budget"]["left"] == 0 and saved["automatic_budget"]["paused"]
    assert saved["timezone"] == "Africa/Lagos"


def test_member_cannot_change_agent_settings(monkeypatch):
    from app.modules.agent import router
    from fastapi import HTTPException
    from test_agent import MEMBER
    env = Env()
    monkeypatch.setattr(router, "get_orchestrator", lambda: env.orch)
    with pytest.raises(HTTPException) as error:
        run(router.update_policy("A", router.PolicyIn(member_can_approve=True), user={"id": MEMBER}))
    assert error.value.status_code == 403
