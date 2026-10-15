"""The owner's QA (15 Oct): an invoice's recipient is a Catalogue > Customers record (matched or added, never twice), never
the business's target customer; with no email the invoice waits for it in Needs You (never fails), and the answer goes on
that same customer record."""
from test_agent import OWNER, Env, run


# The invoice's own form, answered with no email (left for later).
FORM = {"customer_id": "new", "customer_name": "Ebe", "items": [{"name": "Flower", "quantity": 1, "unit_price": 200}]}


def _customers(env, name):
    return [c for c in env.businesses["A"]["data"]["catalogue"]["customers"] if c["name"].lower() == name.lower()]


def _invoice_for_ebe(env):
    return env.submit(text="Create an invoice for Ebe: flower for £200")["run"]


def test_an_invoice_for_a_new_name_adds_one_customer_linked_to_it_and_waits_for_the_email():
    env = Env()
    before = dict(env.businesses["A"]["data"].get("workspace_profile") or {})
    r = _invoice_for_ebe(env)
    r = run(env.orch.provide_input(r["id"], OWNER, FORM))
    ebe = _customers(env, "Ebe")
    assert len(ebe) == 1 and ebe[0]["industry"] == "Individual" and ebe[0]["provenance"].startswith("Added by the Agent from your invoice, ")
    inv = next(i for i in env.businesses["A"]["data"]["financials"]["invoices"] if i.get("agent_run_id") == r["id"])
    assert inv["customer_id"] == ebe[0]["id"]
    # In Needs Approval flagged "Email needed" (never failed); Approve and send needs a valid email first.
    assert r["status"] == "awaiting_approval"
    approval = env.pending(r)[0]
    assert approval["payload"]["to_email"] == "" and approval["payload"]["email_needed"]["customer"] == "Ebe"
    assert (env.businesses["A"]["data"].get("workspace_profile") or {}).get("target_customer_type") == before.get("target_customer_type")
    import pytest
    from app.modules.agent.orchestrator import Conflict
    with pytest.raises(Conflict):
        run(env.orch.approve_with_email(r["id"], approval["id"], OWNER, "not an email"))
    done = run(env.orch.approve_with_email(r["id"], approval["id"], OWNER, "ebe@example.test"))["run"]
    ebe = _customers(env, "Ebe")
    assert len(ebe) == 1 and ebe[0]["email"] == "ebe@example.test"      # the same record, no duplicate
    assert done["status"] == "succeeded" and env.comms.sent[-1]["to"] == "ebe@example.test"      # approved and sent


def test_a_second_invoice_for_the_same_name_reuses_the_customer():
    env = Env()
    for _ in range(2):
        r = _invoice_for_ebe(env)
        run(env.orch.provide_input(r["id"], OWNER, FORM if not _customers(env, "Ebe") else {**FORM, "customer_id": _customers(env, "Ebe")[0]["id"]}))
    assert len(_customers(env, "Ebe")) == 1
