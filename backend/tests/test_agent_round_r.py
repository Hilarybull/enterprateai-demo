"""Round R: the customer question when an address is on record under another name, the
watchdog for tasks that stop part-way, and a what-if that answers in full."""
from datetime import timedelta

from app.modules.agent.summary import bucket_of
from test_agent import OWNER, Env, run


# ══ R-1: the same address under a different name is the owner's choice ════════

def _rfq_from(env, name, email="buyer@brighttech.test"):
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": name, "customer_email": email,
                                "items": [{"name": "Strategy Workshop", "quantity": 1}]}]
    return env.submit(capability="enquiry_to_quote", params={"rfq_id": "r1"}, channel="ui_action")["run"]


def test_an_address_on_record_under_another_name_is_asked_about_never_matched_silently():
    env = Env()
    r = _rfq_from(env, "QA Buyer Two")                                    # the address belongs to BrightTech Ltd (c1)
    q = r["pending_question"]
    assert r["substatus"] == "waiting_for_information" and env.fin["quotes"] == []
    assert q["question"] == "QA Buyer Two wrote from buyer@brighttech.test that is on record for BrightTech Ltd. Use BrightTech Ltd, or create QA Buyer Two?"
    assert q["fields"][0]["options"] == [{"value": "c1", "label": "Use BrightTech Ltd"}, {"value": "new", "label": "Create QA Buyer Two as a new customer"}]
    # "Create": a separate customer under the name the buyer gave, and the quotation is addressed to them.
    done = run(env.orch.provide_input(r["id"], OWNER, {"customer_id": "new"}))
    quote = env.fin["quotes"][0]
    customers = env.businesses["A"]["data"]["catalogue"]["customers"]
    assert done["status"] == "awaiting_approval" and quote["customer_name"] == "QA Buyer Two" and quote["customer_id"] != "c1"
    assert [(c["name"], c["email"]) for c in customers] == [("BrightTech Ltd", "buyer@brighttech.test"), ("QA Buyer Two", "buyer@brighttech.test")]


def test_choosing_the_customer_on_record_addresses_the_quotation_to_them():
    env = Env()
    r = _rfq_from(env, "QA Buyer Two")
    done = run(env.orch.provide_input(r["id"], OWNER, {"customer_id": "c1"}))
    assert done["status"] == "awaiting_approval" and env.fin["quotes"][0]["customer_name"] == "BrightTech Ltd"
    assert len(env.businesses["A"]["data"]["catalogue"]["customers"]) == 1


def test_the_same_name_is_still_matched_without_a_question_and_ordinary_enquiries_follow_the_rule():
    same = Env()
    assert _rfq_from(same, "BrightTech Ltd")["status"] == "awaiting_approval" and same.fin["quotes"][0]["customer_id"] == "c1"
    assert _rfq_from(Env(), "Brighttech Limited")["status"] == "awaiting_approval"      # the same firm, written slightly differently
    typed = Env().submit(capability="enquiry_to_quote", params={"body": "Please quote for 1 x Strategy Workshop", "sender_name": "Someone Else",
                                                                "sender_email": "buyer@brighttech.test"})["run"]
    assert typed["pending_question"]["fields"][0]["key"] == "customer_id" and "Someone Else" in typed["pending_question"]["question"]


# ══ R-2: a task that stopped part-way is moved to Needs Attention ══════════════

def test_a_task_stuck_mid_step_for_ten_minutes_goes_to_needs_attention():
    env = Env()
    env.fin["invoices"] = [{"id": "i2", "customer_name": "BrightTech Ltd", "customer_email": "buyer@brighttech.test", "total_amount": 300, "status": "paid",
                            "reference": "INV-2", "payments": [{"id": "pay1", "amount": 300, "paid_at": env.now.isoformat()}]}]
    good = env.submit(capability="receipt_send", params={"invoice_id": "i2"}, channel="ui_action")["run"]
    # The same task as it was found: created, its step still "running", nothing happening.
    stuck = dict(run(env.store.get_run(good["id"])), id="stuck-1", status="created", substatus=None, pending_question=None, wake_at=None, dedupe_key=None)
    env.store.runs["stuck-1"] = stuck
    run(env.store.add_step({"id": "s1", "run_id": "stuck-1", "business_id": "A", "seq": 1, "step_key": "send", "title": "Send the receipt",
                            "state": "running", "retry_count": 0, "started_at": env.now.isoformat(), "finished_at": None, "error": None}))
    env.store.runs["stuck-1"]["updated_at"] = env.now.isoformat()
    env.now += timedelta(minutes=9)
    run(env.orch.tick())
    assert env.store.runs["stuck-1"]["status"] == "created"               # not yet
    env.now += timedelta(minutes=2)
    run(env.orch.tick())
    found = run(env.store.get_run("stuck-1"))
    # Noticed, and picked up again by the Agent itself: it carries on to the approval, with nothing for the owner to retry.
    assert found["status"] == "awaiting_approval" and found["state"]["auto_retries"] == 1
    happened = [a["event_type"] for a in run(env.store.list_audit("stuck-1"))]
    assert "stalled_detected" in happened and "auto_retry" in happened and bucket_of(found) == "needs_approval"
    assert [s["state"] for s in run(env.store.list_steps("stuck-1")) if s["id"] == "s1"] == ["failed"]
    # A task waiting for approval is not "stuck", however long it waits.
    env.now += timedelta(days=2)
    run(env.orch.tick())
    assert run(env.store.get_run(good["id"]))["status"] == "awaiting_approval"


def test_a_stuck_task_is_surfaced_even_with_automatic_starting_off_and_one_waiting_for_an_answer_is_left_alone():
    env = Env()
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    waiting = env.submit(capability="enquiry_to_quote", params={"body": "Please quote for your Unpriced Service"})["run"]
    env.now += timedelta(minutes=30)
    assert run(env.orch.release_stalled(run(env.store.list_runs("A")))) == 0      # it is waiting for the owner's answer
    env.store.runs[waiting["id"]].update(status="running", substatus=None, pending_question=None, updated_at=(env.now - timedelta(minutes=11)).isoformat())
    assert run(env.orch.release_stalled(run(env.store.list_runs("A")))) == 1
    again = run(env.store.get_run(waiting["id"]))
    assert again["reason_code"] == "stalled" and run(env.orch.retry(waiting["id"], OWNER))["status"] in ("running", "awaiting_approval")      # and it can be retried


# ══ item 2: a what-if answers in full ═════════════════════════════════════════

def _trading(env):
    def paid(n, who, amount):
        at = env.now.isoformat()
        return {"id": f"i{n}", "reference": f"INV-{n}", "customer_name": who, "total_amount": amount, "status": "paid", "paid_at": at,
                "created_at": at, "issued_at": env.now.date().isoformat(),
                "payments": [{"id": f"p{n}", "amount": amount, "paid_at": at, "receipt": {"number": f"REC-{n}", "sent_at": at}}]}
    env.fin["invoices"] = [paid(1, "QA Round Six", 6000), paid(2, "Nova Labs", 3000),
                           {"id": "i3", "reference": "INV-3", "customer_name": "QA Round Six", "total_amount": 900, "status": "sent", "due_date": "2026-11-01"}]
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))


def test_what_if_i_lose_a_customer_returns_the_figures_the_effect_and_what_to_do():
    env = Env()
    _trading(env)
    res = env.submit(text="what if I lose QA Round Six")
    r = res["run"]
    assert res["kind"] == "workflow" and r["workflow_key"] == "scenario_help" and r["status"] == "succeeded"
    said = r["summary"]
    assert said.startswith("If you lost QA Round Six (66.7% of all your revenue, against your 40% alert level), monthly revenue would fall by 66.7%, from £3,000.00 to £1,000.00.")
    assert "Recommended: (1) Win work from other customers until QA Round Six is under 40% of revenue." in said
    assert "Collect what QA Round Six already owes: £900.00 is outstanding." in said
    assert "Open Simulation" not in said and "Open Simulation" not in (r["next_action"] or "") and "Ask me" not in (r["next_action"] or "")
    assert r["next_action"] == "I'll keep watching QA Round Six's share of revenue and flag it if it rises."
    out = r["state"]["outcome"]
    assert out["simulation"]["customer"] == "QA Round Six" and out["concentration"]["top1_share_pct"] == 66.7 and 2 <= len(out["recommendations"]) <= 3
    assert {"label": "Full scenario in Simulation", "to": "/simulation"} in out["links"]


def test_my_biggest_client_is_worked_out_and_the_risk_check_answers_the_follow_up_itself():
    env = Env()
    _trading(env)
    assert env.submit(text="what if I lose my biggest client")["run"]["summary"].startswith("If you lost QA Round Six")
    risk = env.submit(capability="risk_concentration", channel="ui_action")["run"]
    assert "Losing QA Round Six would cut monthly revenue by 66.7%" in risk["summary"] and "Ask me" not in (risk["next_action"] or "")
