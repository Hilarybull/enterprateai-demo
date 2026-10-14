"""A task the owner asked for that leads straight to another (a payment to its receipt): the follow-on starts at once when
automatic starting is on, and the reply says so ("A receipt REC-… is ready for your approval"), never "Ask me for it"."""
from test_agent import OWNER, Env, run
from test_b8_named_drafts import _draft


def test_recording_a_payment_says_the_receipt_is_ready_with_a_link():
    env = Env()
    sending, inv, ref = _draft(env)
    env.approve(sending)                                                    # the invoice is sent
    run(env.store.set_policy("A", {"automation": {"auto_start": True, "items": {"payment_recorded": True}}}, OWNER))
    r = env.submit(text=f"BrightTech paid {ref}")["run"]
    if r.get("pending_question"):
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: f.get("default") or "Bank transfer" for f in r["pending_question"]["fields"]}))
    assert r["status"] == "succeeded", r.get("summary")
    assert "is ready for your approval" in r["next_action"] and "Ask me for the receipt" not in r["next_action"], r["next_action"]
    follow = r["state"]["follow_on"][0]
    assert follow["workflow_key"] == "receipt_send" and {"label": "Review it", "to": f"/agent/runs/{follow['run_id']}"} in r["state"]["outcome"]["links"]


def test_without_automatic_starting_the_reply_offers_the_receipt_as_before():
    env = Env()
    sending, inv, ref = _draft(env)
    env.approve(sending)
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    r = env.submit(text=f"BrightTech paid {ref}")["run"]
    if r.get("pending_question"):
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: f.get("default") or "Bank transfer" for f in r["pending_question"]["fields"]}))
    assert "receipt" in r["next_action"].lower() and not r["state"].get("follow_on")
