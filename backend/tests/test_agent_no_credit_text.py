"""The Agent never says what anything cost (the owner's rule, 14 Oct 2026). Not in a chat reply, a task's reply or its
page, a task card, an approval, a question, a notification or an email. The sidebar balance, the Credits page (which
lists each charge with its task) and the prices in Agent settings say it; the Agent speaks of credits only when there
aren't enough: "This needs 40 credits; you have 31. Top up." Charging itself is unchanged."""
import re

import pytest

from app.modules.agent import config
from app.modules.agent import router as agent_router
from test_agent import ENQUIRY, OWNER, Env, run
from test_agent_employee import Chat

# "credit note", "credited" and "Amount to credit" are documents and accounting, not the price of the Agent's work.
CREDIT = re.compile(r"(?<!\bI )(?<!\bto )credit(?!\s*notes?\b|_notes?\b|ed\b|\s+the\b|\s+card\b|\s+in full\b|s the invoice\b|:\s*\S*\d)", re.I)
SHORT_OF = re.compile(r"^(?:This needs \d+ credits?; you have \d+\. Top up\.|You have (?:no|\d+) credits? left\. Top up\.)")
# What a person reads: the words of a reply, a task, a question, an approval and an email (not codes or keys).
READ = {"summary", "next_action", "message", "title", "question", "label", "text", "hint", "detail", "note", "notes", "ready_message",
        "doing", "question_title", "question_detail", "subject", "html", "error", "explains", "reassurance", "said_text", "said_note"}


def read_texts(obj, key=None):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from read_texts(v, k)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from read_texts(v, key)
    elif isinstance(obj, str) and key in READ:
        yield obj


def credit_words(*objs) -> list[str]:
    return [t for o in objs for t in read_texts(o) if CREDIT.search(t) and not SHORT_OF.match(t)]


def test_a_completed_task_its_page_its_approval_and_its_email_never_say_what_it_cost():
    env = Env()
    r = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    waiting = r["run"]
    approval = env.pending(waiting)
    done = env.approve(waiting)
    page = agent_router._public_run(done)
    assert credit_words(r, agent_router._public_run(waiting), approval, page, env.comms.sent) == []
    assert not {"credits_used", "credits", "credits_left"} & set(page) and not {"credits_used", "credits_left"} & set(r)
    # Charged as before, and listed where charges are listed.
    assert agent_router.credits_of(done) == 4 and env.meter.balances[OWNER] == 96
    # Snapshot: what the owner sees of the finished task.
    assert {k: page[k] for k in ("status", "summary", "next_action")} == {
        "status": "succeeded", "summary": "Quotation QUO-1011026 was sent to buyer@brighttech.test.",
        "next_action": "When the customer accepts, ask me to turn it into an invoice."}


def test_a_refused_task_says_only_what_is_missing_in_one_sentence():
    env = Env(plan="starter_insight", credits=0)
    res = env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    # Snapshot of the refusal: the one place the Agent speaks of credits.
    assert {k: res[k] for k in ("kind", "reason_codes", "reason", "message", "actions")} == {
        "kind": "blocked", "reason_codes": ["credits_exhausted"], "reason": "credits",
        "message": "This needs 2 credits; you have 0. Top up.", "actions": [{"label": "Top up", "to": "/pricing", "upgrade": True}]}
    assert "balance" not in res and "cost" not in res and env.meter.charges == []


@pytest.fixture
def chat(monkeypatch):
    return Chat(monkeypatch, Env())


def test_a_chat_reply_is_only_the_answer(chat):
    out = chat.say("please write me a short note about my business")
    # Snapshot: the reply as the owner gets it. Charged as before, never said.
    assert out == {"kind": "answer", "message": "Here is what I found.", "conversational": True}
    assert chat.charges == [(OWNER, "chat_message")] and chat.balance == 8


def test_a_chat_reply_with_too_few_credits_says_so_in_one_sentence(chat):
    chat.balance = 1
    out = chat.say("please write me a short note about my business")
    assert out["message"] == "This needs 2 credits; you have 1. Top up." and chat.charges == []


def test_the_dashboard_summary_and_the_task_cards_carry_no_price():
    from app.modules.agent.summary import build_summary
    env = Env()
    env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    summary = run(build_summary(env.orch, OWNER, "A"))
    assert "prices" not in summary["entitlement"] and credit_words(summary["suggestions"], summary["needs_approval"]) == []


def test_the_homepage_task_cards_carry_no_price():
    from app.modules.agent import goals
    for goal in goals.GOALS:
        res = goals.resolve(key=goal["key"])
        assert not any(k.startswith("credit") for k in res) and credit_words(res) == [], goal["key"]


def test_the_insufficient_credits_sentence():
    assert config.short_of(40, 31) == "This needs 40 credits; you have 31. Top up."
    assert config.short_of(1, 0) == "This needs 1 credit; you have 0. Top up."
    assert config.short_of(None, 0) == "You have no credits left. Top up."


def test_the_credits_page_lists_each_charge_with_its_task_and_a_link_to_it(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.shared.auth.deps import get_current_user
    env = Env()
    done = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": OWNER, "email": OWNER}
    try:
        rows = TestClient(app).get("/businesses/A/agent/charges").json()["charges"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert sorted(r["what"] for r in rows) == ["Preparing the quotation", "Sending the document"]
    assert all(r["run_id"] == done["id"] and r["link"] == f"/agent/runs/{done['id']}" and r["task"] and r["credits"] == 2 for r in rows)


def test_f3_every_charge_is_on_the_credits_page_and_its_total_is_the_ledgers(monkeypatch):
    """A task's charges, a written answer's and a refund: the page lists each, and adds up to what the ledger took."""
    env = Env()
    chat = Chat(monkeypatch, env)
    try:
        done = env.approve(env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))["run"])
        chat.say("please write me a short note about my business")
        chat.say("what should I focus on this month? I'd like a plain answer that is longer than sixty characters")
        res = chat.client.get("/businesses/A/agent/charges").json()
    finally:
        from app.main import app
        from app.shared.auth.deps import get_current_user
        app.dependency_overrides.pop(get_current_user, None)
    rows = res["charges"]
    answers = [r for r in rows if r["task"] == "Written answer"]
    assert len(answers) == 2 and all(r["credits"] == 2 and r["link"] is None and len(r["what"]) <= 60 for r in answers)
    assert any(r["what"].startswith("what should I focus on this month") for r in answers)      # the question, as asked
    ledger = sum(cost for _, _, cost in env.meter.charges) + 2 * len(chat.charges)      # what the wallet took
    assert res["total"] == sum(r["credits"] for r in rows) == ledger
    assert {r["run_id"] for r in rows if r["task"] != "Written answer"} == {done["id"]}
