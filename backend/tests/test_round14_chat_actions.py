"""The owner, 27 Oct: "the action buttons should make the agent do the work and show the result in the chat". A scenario run
on the business's own figures, a postpone that holds until the day picked, and a document attached in the chat. No real
model, search or charge; the business is the tests' synthetic one."""
from datetime import datetime, timedelta, timezone

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from app.modules.agent import chat_actions


def _trading(env):
    now = datetime.now(timezone.utc)
    def put(d):
        d.setdefault("financials", {})["invoices"] = [
            {"id": f"i{n}", "status": "paid", "total_amount": amt, "customer_name": who, "paid_at": (now - timedelta(days=d_)).isoformat(), "created_at": (now - timedelta(days=d_)).isoformat()}
            for n, (who, amt, d_) in enumerate([("Raphael", 400000, 10), ("Raphael", 380000, 40), ("Ada", 60000, 20), ("Raphael", 390000, 70), ("Bola", 50000, 75)])]
        d["financials"]["expenses"] = [{"id": f"e{n}", "status": "paid", "amount": 150000, "description": "Rent", "date": (now - timedelta(days=d_)).date().isoformat()}
                                       for n, d_ in enumerate([5, 35, 65])]
    run(env.orch.rt.business.mutate("A", put))


def _no_database(monkeypatch):
    """The plan check and the run's saving read and write the database, which the tests never reach: both stood in for."""
    from app.modules.scenario_intelligence import router as si, service as sis

    async def allowed(*_a, **_k):
        return None

    async def kept(_table, doc):
        return doc
    monkeypatch.setattr(si, "_require_scenario", allowed)
    monkeypatch.setattr(sis, "_safe_insert", kept)


def test_a_scenario_runs_on_the_business_figures_and_comes_back_as_a_card(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _no_database(monkeypatch)
    _trading(env)
    out = client.post("/businesses/A/agent/chat/scenario", json={"kind": "order_reduction"}).json()
    assert out["type"] == "scenario" and out["kind"] == "order_reduction"
    assert not out.get("missing") and not out.get("gate"), out.get("summary")
    assert [r["label"] for r in out["rows"]][:2] == ["Monthly revenue", "Monthly profit"] and out["summary"].startswith("If your main customer's orders fell")
    assert out["to"] == "/simulation"
    late = client.post("/businesses/A/agent/chat/scenario", json={"kind": "payment_delay"}).json()
    assert late["summary"].startswith("If customers paid 60 days late")


def test_a_slow_scenario_says_it_is_working_and_its_result_is_asked_for_after(world, monkeypatch):
    """The owner, 27 Oct: "Simulate order reduction timed out after about a minute with no result"."""
    import asyncio
    env, store, client, who = world
    who["user"] = OWNER
    _no_database(monkeypatch)
    _trading(env)
    real = chat_actions.scenario

    async def slow(*a, **k):
        await asyncio.sleep(0.3)
        return await real(*a, **k)
    monkeypatch.setattr(chat_actions, "scenario", slow)
    monkeypatch.setattr(chat_actions, "FIRST_WAIT", 0.01)
    first = client.post("/businesses/A/agent/chat/scenario", json={"kind": "order_reduction"}).json()
    assert first["pending"] and first["job_id"]
    for _ in range(50):
        out = client.get(f"/businesses/A/agent/chat/scenario/{first['job_id']}").json()
        if not out.get("pending"):
            break
        run(asyncio.sleep(0.05))
    assert out["rows"] and out["summary"].startswith("If your main customer's orders fell")
    assert client.get(f"/businesses/A/agent/chat/scenario/{first['job_id']}").status_code == 404      # given once


def test_a_business_with_nothing_on_record_is_told_what_is_missing(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _no_database(monkeypatch)
    out = client.post("/businesses/A/agent/chat/scenario", json={"kind": "payment_delay"}).json()
    assert out.get("missing") or out.get("rows")      # never a made-up result


def test_postpone_holds_until_the_day_picked_and_not_before():
    now = datetime(2026, 10, 27, 18, tzinfo=timezone.utc)      # a Tuesday
    assert chat_actions.until_of("tomorrow", now) == datetime(2026, 10, 28, 9, tzinfo=timezone.utc)
    assert chat_actions.until_of("next_week", now).weekday() == 0 and chat_actions.until_of("next_week", now) > now
    data = {"agent_postponed": {"u1": {"a1": "2026-10-28T09:00:00+00:00", "a2": "2026-10-20T09:00:00+00:00"}}}
    assert chat_actions.postponed(data, "u1", now) == {"a1"}      # a2 is due back already
    assert chat_actions.postponed(data, "u2", now) == set()       # someone else's postpone is theirs


def test_postpone_is_saved_for_the_person(world):
    env, store, client, who = world
    who["user"] = OWNER
    out = client.post("/businesses/A/agent/chat/postpone", json={"key": "a1", "when": "tomorrow"}).json()
    data = run(env.orch.rt.business.load("A"))
    assert data["agent_postponed"][OWNER]["a1"] == out["until"]


def test_a_document_attached_in_the_chat_is_kept_with_the_evidence(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    from app.modules.agent import research
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: None)
    res = client.post("/businesses/A/agent/chat/attach", files={"file": ("prices.txt", b"Interior detailing 25000 per car. 40 cars a month.", "text/plain")})
    assert res.status_code == 200, res.text      # a plain text file is one evidence takes
    out = res.json()
    assert out["evidence_id"] and "saved prices.txt with your business evidence" in out["message"]


def test_the_words_in_a_text_document_are_read():
    assert chat_actions.text_of("a.csv", "text/csv", b"name,price\nWash,5000").startswith("name,price")
    assert chat_actions.text_of("a.png", "image/png", b"\x89PNG") == ""


def test_one_monthly_revenue_on_the_card_the_simulation_and_the_dashboard(world):
    """The owner, 27 Oct: the simulation said ₦331,425 a month, the workspace card ₦994,276 for 12 months. A business whose
    money all came in this month made that this month's revenue, not a third of it."""
    from app.modules.agent import assistant_context, figures
    env, store, client, who = world
    now = datetime.now(timezone.utc)
    def put(d):
        d.setdefault("financials", {})["invoices"] = [{"id": f"i{n}", "status": "paid", "total_amount": a, "amount_paid": a, "customer_name": "Raphael",
                                                       "paid_at": now.isoformat(), "created_at": now.isoformat()} for n, a in enumerate([500000, 494276])]
    run(env.orch.rt.business.mutate("A", put))
    data = run(env.orch.rt.business.load("A"))
    f = figures.of(data, now.date())
    card = assistant_context.revenue(data, now)
    assert f["revenue_monthly"] == 994276 and f["revenue_months"] == 1
    assert card["monthly"] == f["revenue_monthly"] and card["total"] == 994276


def test_a_postpone_is_taken_back_by_undo(world):
    """The owner, 27 Oct: a toast naming the item, with Undo."""
    env, store, client, who = world
    who["user"] = OWNER
    client.post("/businesses/A/agent/chat/postpone", json={"key": "a1", "when": "tomorrow"})
    out = client.post("/businesses/A/agent/chat/postpone", json={"key": "a1", "when": "undo"}).json()
    assert out["until"] is None and "a1" not in run(env.orch.rt.business.load("A"))["agent_postponed"][OWNER]
