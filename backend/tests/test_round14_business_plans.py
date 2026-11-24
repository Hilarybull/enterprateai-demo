"""The owner, 27 Oct: business plans counted one way everywhere, versions folded, every plan named, and the plan chat that
creates a new one when asked, explains its numbers when questioned and never repeats itself. Synthetic business; no model,
no database (the saved plans are stood in for)."""
from datetime import datetime, timezone

import pytest

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from app.modules.agent import plans


SAVED = [{"id": "p1", "title": "Business Plan for E2E Car Wash Abuja", "updated_at": "2026-10-26T10:00:00Z"},
         {"id": "p2", "title": "Business plan: E2E Car Wash Abuja", "updated_at": "2026-10-16T10:00:00Z"},
         {"id": "p3", "title": "Business plan: Land Clearing", "updated_at": "2026-10-25T10:00:00Z"},
         {"id": "p4", "title": "Business plan: Drone Cleaning", "updated_at": "2026-10-24T10:00:00Z"},
         {"id": "p5", "title": "Business plan", "company_name": "", "updated_at": "2026-10-20T10:00:00Z"}]
DRAFTS = [{"id": "d1", "kind": "business_plan", "status": "pending", "ref": "p3", "title": "Business plan: Land Clearing", "to": "/blueprint?document_id=p3"},
          {"id": "d2", "kind": "business_plan", "status": "pending", "ref": "p1", "title": "", "to": "/blueprint?document_id=p1"}]


def test_one_list_versions_folded_every_plan_named_and_one_needs_review():
    out = plans.of(SAVED, {"agent_drafts": DRAFTS}, "u1", datetime(2026, 10, 27, tzinfo=timezone.utc), company="E2E Car Wash Abuja")
    subjects = [i["subject"] for i in out["items"]]
    assert subjects.count("E2E Car Wash Abuja") == 1 and len([i for i in out["items"] if i["subject"] == "E2E Car Wash Abuja"][0]["versions"]) == 3      # p5 names nothing: the business's own
    assert all(i["title"].startswith("Business plan: ") and i["subject"] for i in out["items"])      # never just "Business plan"
    assert out["total"] == 3 and out["needs_review"] == 2
    later = plans.of(SAVED, {"agent_drafts": DRAFTS, "agent_postponed": {"u1": {"d1": "2026-11-02T09:00:00+00:00"}}}, "u1", datetime(2026, 10, 27, tzinfo=timezone.utc), company="E2E Car Wash Abuja")
    assert later["needs_review"] == 1      # put off: not counted until it is back


@pytest.fixture
def talk(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    async def saved(*_a, **_k):
        return SAVED
    monkeypatch.setattr(plans, "rows", saved)
    run(env.orch.rt.business.mutate("A", lambda d: d.update({"agent_drafts": DRAFTS})))
    def ask(text, history=()):
        return client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "history": list(history)}).json()
    return env, ask


def test_the_plan_conversation_from_the_owners_test(talk):
    env, ask = talk
    first = ask("i need a business plan")
    assert "business plans" in first["message"] and "waiting for your review" in first["message"]
    assert "Drone Cleaning" in first["message"] and "Land Clearing" in first["message"]      # not only the drafts
    said = [{"role": "user", "content": "i need a business plan"}, {"role": "assistant", "content": first["message"]}]
    doubt = ask("but you said I only have 3", said)
    assert doubt["message"].startswith("Sorry, I wasn't clear.") and doubt["message"] != first["message"]
    new = ask("create a new one, Drone cleaning", said)
    assert "Open it, or write a new one" not in str(new.get("message"))      # never asked again about the old one
    fields = [f["key"] for f in new.get("fields") or []]
    assert "plan_for" not in fields and "existing_plan" not in fields      # what it is for was said: only who reads it, once


def test_the_named_new_plan_is_read_from_the_words():
    from app.modules.agent.router import _named_in
    assert _named_in("create a new one, Drone cleaning") == "Drone cleaning"
    assert _named_in("create a new one") == ""


def test_how_many_plans_is_answered_from_the_one_list(talk):
    """The owner, 28 Oct: "how many business plans do i have" still said 3."""
    env, ask = talk
    out = ask("how many business plans do i have")
    assert out["message"].startswith("You have 4 business plans, 2 waiting for your review")      # the one list: p5 is the business's own
    assert "Drone Cleaning" in out["message"]


def test_tasks_are_named_for_what_they_are_about(world):
    """The owner, 28 Oct: two rows called just "Business Plan Draft", two "Receipt Sending"."""
    from app.modules.agent.router import run_label
    assert run_label({"title": "Business Plan Draft", "state": {"outcome": {"plan": {"title": "Business plan for Drone Cleaning"}}}}) == "Business Plan Draft: Drone Cleaning"
    assert run_label({"title": "Receipt Sending", "state": {"invoice_reference": "INV-1042", "customer_name": "Northbridge"}}) == "Receipt Sending, INV-1042 for Northbridge"


def test_new_one_after_the_list_is_a_new_plan_even_with_a_funding_chat_open(talk):
    """The owner, 28 Oct: "new one...yam farming" became "a new funding case for yam farming"; then "There's nothing to change
    now"; then "i want to create new business plan" listed the plans again."""
    from datetime import datetime, timezone
    env, ask = talk
    now = datetime.now(timezone.utc).isoformat()
    run(env.orch.rt.business.mutate("A", lambda d: d.update({"agent_conversations": {str(OWNER): {"topic": "funding", "at": now, "turns": [{"role": "owner", "text": "I need funding"}],
                                                                                                  "pending_which": {"change": {}}}}})))
    first = ask("I need a business plan for a new product")
    assert first["message"].endswith("Open one, or create a new one?")
    said = [{"role": "user", "content": "I need a business plan for a new product"}, {"role": "assistant", "content": first["message"]}]
    new = ask("new one...yam farming", said)
    assert "funding" not in str(new.get("message")).lower() and "nothing to change" not in str(new.get("message")).lower()
    assert "Open one, or create a new one?" not in str(new.get("message"))
    again = ask("i want to create new business plan", [*said, {"role": "user", "content": "x"}, {"role": "assistant", "content": "There's nothing to change now."}])
    assert "Open one, or create a new one?" not in str(again.get("message"))      # made, never listed again


def test_what_was_said_comes_back_with_the_answer(talk):
    """The owner, 28 Oct: "new one....palm oil selling", then "A bank or lender": the plan was for the whole business."""
    env, ask = talk
    first = ask("I need a business plan")
    said = [{"role": "user", "content": "I need a business plan"}, {"role": "assistant", "content": first["message"]}]
    asked = ask("new one....palm oil selling", said)
    assert asked["kind"] == "needs_input" and asked["params"].get("idea") == "palm oil selling" and asked["params"].get("plan_for") == "new"


def test_another_task_after_the_plans_list_is_never_a_new_plan(talk):
    """The owner, 29 Oct: "Validate a new idea" after the plans list drafted a business plan."""
    env, ask = talk
    first = ask("I need a business plan")
    said = [{"role": "user", "content": "I need a business plan"}, {"role": "assistant", "content": first["message"]}]
    out = ask("Validate a new idea", said)
    assert "business plan" not in str(out.get("message")).lower()
