"""The rule for the Dashboard and Agent Centre: the owner sees approvals, questions only they
can answer, and what the Agent did. Nothing asks them to start, run, prepare or open a task."""
import re
from datetime import timedelta

from app.modules.agent import autostart
from app.modules.agent import router as agent_router
from app.modules.agent.summary import bucket_of, build_summary
from test_agent import ENQUIRY, OWNER, Env, run
from test_dashboard import build, card, invoice, operating

# Phrases that hand the owner a chore. "Run" and "Retry" as words on their own; "Open … to".
BANNED = re.compile(r"\b(Consider|Run|Ask Agent to|Would you like me to|You should|Retry|Retrying)\b|\bOpen\b[^.]*\bto\b", re.I)


def chores(texts):
    return [t for t in texts if t and BANNED.search(str(t))]


def _late(env, n=2):
    invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8)
    if n > 1:
        invoice(env, "late2", "Frank", 50, paid=False, due_in=-3)


# ══ 1: the next step is the Agent's status ════════════════════════════════════

def test_overdue_invoices_show_what_the_agent_has_done_about_them():
    env = Env()
    operating(env)
    _late(env)
    env.fin["invoices"][-1]["customer_email"] = ""                        # no address on record for Frank
    step = card(build(env), "next_step")
    assert step["text"] == "2 overdue (£199.00). I'm preparing the reminders for your approval." and step["cta"] is None
    run(autostart.sweep(env.orch, "A"))                                   # the Agent does it
    step = card(build(env), "next_step")
    assert step["text"] == "2 overdue (£199.00). I've prepared 1 reminder for your approval; 1 is waiting for an email address for Frank."
    assert step["cta"] == {"label": "Review in Needs Approval", "to": "/agent?tab=needs_approval"} and step["agent_action"] is None
    # Switched off by the owner: it says so, and still hands them nothing to start.
    off = Env()
    operating(off)
    _late(off, 1)
    run(off.store.set_policy("A", {"automation": {"auto_start": True, "items": {"invoice_overdue": False}}}, OWNER))
    quiet = card(build(off), "next_step")
    assert quiet["text"] == "1 overdue (£149.00). Automatic reminders are switched off in Agent settings, so nothing has been prepared."
    assert quiet["cta"] is None and quiet["agent_action"] is None


def test_nothing_overdue_and_no_risk_is_a_status_not_a_suggestion_to_model_something():
    env = Env()
    operating(env)
    step = card(build(env), "next_step")
    if step:      # shown only when it is the next step for this business
        assert step["cta"] is None and step["agent_action"] is None and not chores([step["text"]])


# ══ 4: interrupted or passing faults are tried again by the Agent ═════════════

def _failing_send(env):
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]
    env.comms.mode = "fail"
    return env.approve(r)


def test_a_passing_fault_is_tried_again_up_to_three_times_with_longer_waits_and_then_explained():
    env = Env()
    failed = _failing_send(env)
    assert failed["status"] == "failed" and failed["reason_code"] == "action_failed" and "I'll have another go shortly" in failed["error"]
    assert bucket_of(failed) == "active" and agent_router._public_run(failed)["retrying"] is True      # not the owner's problem yet
    tries = lambda: run(env.store.get_run(failed["id"]))["state"].get("auto_retries", 0)      # noqa: E731
    run(env.orch.tick())
    assert tries() == 0                                                   # not straight away
    env.now += timedelta(minutes=1)
    run(env.orch.tick())
    assert tries() == 1
    env.now += timedelta(minutes=4)
    run(env.orch.tick())
    assert tries() == 1                                                   # the second wait is five minutes
    env.now += timedelta(minutes=1)
    run(env.orch.tick())
    assert tries() == 2
    env.now += timedelta(minutes=15)
    run(env.orch.tick())
    final = run(env.store.get_run(failed["id"]))
    assert final["state"]["auto_retries"] == 3 and final["status"] == "failed" and bucket_of(final) == "needs_attention"
    assert final["error"] == ("I've tried this 3 more times and it still didn't go through. provider rejected. "
                              "Nothing was sent twice. My next attempt is on 2 Oct at 09:21 UTC.")
    assert not chores([final["error"], final["next_action"]]) and env.comms.sent == []
    shown = agent_router._public_run(final)
    assert shown["next_attempt_at"] == "2026-10-02T09:21:00+00:00"        # the page shows when, and no button to press
    env.now += timedelta(hours=3)
    run(env.orch.tick())
    assert run(env.store.get_run(failed["id"]))["state"]["auto_retries"] == 3      # not before then
    env.now += timedelta(hours=21)
    run(env.orch.tick())
    later = run(env.store.get_run(failed["id"]))
    # A day on, a send can no longer be repeated safely (the email service would treat it as a new
    # message), so the Agent stops and asks the one thing only the owner can tell it: did it arrive?
    assert later["state"]["auto_retries"] == 4 and later["reason_code"] == "delivery_unconfirmed"
    assert "tell me whether to mark it as delivered or send it again" in later["error"] and bucket_of(later) == "needs_attention"
    assert agent_router._public_run(later)["next_attempt_at"] is None and env.comms.sent == []


def test_a_fault_that_clears_is_finished_without_the_owner_doing_anything():
    env = Env()
    failed = _failing_send(env)
    env.comms.mode = "ok"                                                 # the email service is back
    env.now += timedelta(minutes=1)
    run(env.orch.tick())
    done = run(env.store.get_run(failed["id"]))
    assert done["status"] == "succeeded" and len(env.comms.sent) == 1 and env.fin["quotes"][0]["status"] == "sent"
    assert "auto_retry" in [a["event_type"] for a in run(env.store.list_audit(failed["id"]))]


def test_what_needs_the_owner_is_never_tried_again_automatically():
    env = Env()
    env.meter.balances[OWNER] = 2
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"]      # the draft takes the last credits
    out = env.approve(r)
    assert out["reason_code"] == "credits_exhausted" and bucket_of(out) == "needs_attention"
    env.now += timedelta(hours=1)
    run(env.orch.tick())
    assert run(env.store.get_run(r["id"]))["state"].get("auto_retries") is None


# ══ 5: Needs Attention is what needs the owner ════════════════════════════════

def test_needs_attention_holds_questions_and_blocks_and_nothing_the_agent_is_handling():
    env = Env()
    asking = env.submit(capability="enquiry_to_quote", params={**ENQUIRY, "body": "Please quote for your Unpriced Service"})["run"]
    assert bucket_of(asking) == "needs_attention" and asking["pending_question"]["fields"][0]["key"] == "items"
    public = agent_router._public_run(asking)
    assert public["pending_question"]["question"].startswith("I couldn't find an approved price for: Unpriced Service.")      # the exact question, with its field
    retrying = _failing_send(Env())
    assert bucket_of(retrying) == "active"


# ══ 7: no chores on these screens ═════════════════════════════════════════════

def _screen_texts(env):
    """Every sentence and button the Agent card, the next-step card and the Agent Centre show."""
    d = build(env)
    summary = run(build_summary(env.orch, OWNER, "A"))
    texts = [s["text"] for s in summary["suggestions"]]
    for c in d["insights"]:
        if c["widget_id"] in ("next_step", "approval"):
            texts += [c["text"], (c.get("cta") or {}).get("label"), (c.get("agent_action") or {}).get("label")]
    for r in run(env.store.list_runs("A")):
        p = agent_router._public_run(r)
        texts += [p["summary"], p["next_action"], p["error"], (p["pending_question"] or {}).get("question")]
    return [t for t in texts if t]


def test_the_agent_card_next_step_and_agent_centre_never_hand_the_owner_a_chore():
    env = Env()
    operating(env)
    _late(env)
    invoice(env, "paid9", "Aftred", 900, paid=True)
    env.fin["invoices"][-1]["payments"] = [{"id": "p9", "amount": 900, "paid_at": env.now.isoformat()}]
    before = _screen_texts(env)
    run(autostart.sweep(env.orch, "A"))                                   # reminders, a receipt, the concentration analysis
    env.submit(text="what if I lose Aftred")
    env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    _failing_send(env)
    after = _screen_texts(env)
    assert len(after) > len(before) > 0
    assert chores(before) == [] and chores(after) == []


def test_the_check_itself_catches_the_phrases():
    for bad in ("Consider a payment follow-up before it worsens.", "Run scenario", "Ask Agent to prepare a follow-up", "Open Simulation to explore this in detail.",
                "Would you like me to prepare a payment follow-up?", "You should chase this.", "It's safe to retry.", "Retry"):
        assert chores([bad]) == [bad]
    for fine in ("I've prepared 1 reminder for your approval", "Review in Needs Approval", "Give the email address", "2 overdue (£199.00).",
                 "I'll keep watching Aftred's share of revenue and flag it if it rises.", "Everything is on track: nothing is overdue."):
        assert chores([fine]) == []
