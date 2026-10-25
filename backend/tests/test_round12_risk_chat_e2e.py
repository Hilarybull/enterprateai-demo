"""The Business Risk Check end to end, signed in (the owner's brief, 24 Oct, R-1 to R-6): the chat reads the records, asks
only what they can't tell, hands off without a paid task, and the result lists only real risks from the one source of
figures, with what is fine and what isn't on record said apart. Answers are kept and reused; nothing is charged."""
from datetime import datetime, timedelta, timezone

from test_goal_onboarding import world, OWNER, run  # noqa: F401
from app.modules.agent import goal_router


def _signed_in(env, who, monkeypatch, expenses=True):
    who["user"] = OWNER

    async def signed_in(request):
        return {"id": OWNER, "email": OWNER}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    day = lambda n: (datetime.now(timezone.utc).date() - timedelta(days=n)).isoformat()      # noqa: E731
    d = env.businesses["A"]["data"]
    d["workspace_profile"]["company_size"] = "2-5"
    d.setdefault("financials", {})["invoices"] = [{"customer_name": "Delta Offices Ltd", "status": "paid", "total_amount": 450, "paid_at": day(14)}]
    # Spending in two different months: enough to judge (R-9); the same-day case is its own test below
    d["financials"]["expenses"] = [{"status": "paid", "price": 40, "date": day(40)}, {"status": "paid", "price": 28.5, "date": day(9)}] if expenses == True else (
        [{"status": "paid", "price": 40, "date": day(9)}, {"status": "paid", "price": 28.5, "date": day(9)}] if expenses == "same_day" else [])
    return d


def _check(client, text="business risk"):
    return client.post("/task-sessions", json={"text": text, "entry_mode": "free_text", "business_id": "A"}).json()


def test_the_chat_previews_asks_only_the_away_question_and_hands_off_free(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    assert s["value_line"].startswith("I'll check your biggest customer, cash, late payments and how much the business depends on you.")
    assert s["missing"] == ["key_person"]                                       # the one thing the records can't tell
    bubbles = [t for t in s.get("turns") or [] if t.get("role") == "assistant"]
    assert [t.get("next") for t in bubbles] == ["key_person"]                   # the bubble is the question really asked
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "It would slow down", "asked": "key_person"}).json()
    assert s["inputs"]["key_person"] == "slows" and s["missing"] == []
    client.post(f"/task-sessions/{s['id']}/resume")
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert done["handoff"]["to"] == "/check/risks" and not done.get("confirm")
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []        # R-1: no paid background task, no history row


def test_the_result_lists_only_real_risks_from_the_records_and_the_engines(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "slows"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    r = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    assert r["score"] is None                                                   # R-5: no made-up total
    assert [b["label"] for b in r["blockers"]] == ["Delta Offices Ltd is 100% of your paid income", "The business slows down without you"]
    away = next(b for b in r["blockers"] if b["key"] == "key_person")
    assert "stop" not in away.get("why", "")                                     # wording follows the answer
    assert r["not_on_record"] == []
    runway = next(x for x in r["fine"] if x.startswith("About"))                 # R-3: from the £450 in, £68.50 out
    assert "£381.50 in the bank" in runway and "2 expenses recorded" in runway
    assert r["checked"] == 4 and {"survival", "stability", "fragility"} <= set(r["engines"])
    assert env.meter.charges == []


def test_an_answer_is_kept_and_never_asked_again(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "slows"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    again = _check(client, "help me understand my business risks")
    assert again["missing"] == []                                                # R-2: reused
    row = next(r for r in again["summary"] if r["key"] == "key_person")
    assert row["source"].startswith("From you, ")


def test_no_expenses_says_so_and_is_never_counted_as_a_risk(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch, expenses=False)
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "runs"}})
    r = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    gaps = {x["key"]: x["label"] for x in r["not_on_record"]}
    assert gaps["runway"] == "I can't tell how long your cash would last because no expenses are recorded. Add last month's expenses and I'll show you."
    assert "runway" not in {b["key"] for b in r["blockers"]} and r["engines"] is None


def test_the_away_question_answered_on_the_result_updates_it(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "unknown"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    before = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    assert [x.get("ask") for x in before["not_on_record"]] == ["key_person"]
    pressed = client.post(f"/task-sessions/{s['id']}/answers", json={"answers": {"key_person": "runs"}})      # what the result's button sends
    assert pressed.status_code == 200, pressed.text
    after = pressed.json()["result"]
    assert after["not_on_record"] == [] and "The business carries on without you" in after["fine"]
    assert env.meter.charges == []



def test_spending_from_one_day_is_an_estimate_and_asks_for_the_regular_costs(world, monkeypatch):
    """R-9 (the owner, 24 Oct): 2 same-day expenses averaged over 3 months understate spending."""
    env, store, client, who = world
    _signed_in(env, who, monkeypatch, expenses="same_day")
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "runs"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    client.post(f"/task-sessions/{s['id']}/prepare")
    r = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    gap = next(x for x in r["not_on_record"] if x["key"] == "runway")
    assert gap["ask"] == "monthly_costs" and "only an estimate: it's based on 2 expenses on " in gap["label"] and "regular monthly costs" in gap["label"]
    assert not any(x.startswith("About") for x in r["fine"])                     # no months of cash until confirmed
    after = client.post(f"/task-sessions/{s['id']}/answers", json={"answers": {"monthly_costs": 300}}).json()["result"]
    runway = [b["label"] for b in after["blockers"]] + after["fine"]
    assert any("months of cash" in x for x in runway) and not any(x["key"] == "runway" for x in after["not_on_record"])


def test_a_kept_answer_says_its_date_in_words(world, monkeypatch):
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"key_person": "slows"}})
    row = next(r for r in _check(client)["summary"] if r["key"] == "key_person")
    import re
    assert re.fullmatch(r"From you, \d{1,2} [A-Z][a-z]{2} \d{4}", row["source"]), row["source"]      # "From you, 24 Oct 2026"


def test_check_my_risks_is_one_request_with_the_result_in_under_5_seconds(world, monkeypatch):
    """The owner's brief, 25 Oct (3): one request saves the answer, hands off free and returns the result."""
    import time
    env, store, client, who = world
    _signed_in(env, who, monkeypatch)
    s = _check(client)
    started = time.perf_counter()
    out = client.post(f"/task-sessions/{s['id']}/risk-check", json={"answers": {"key_person": "slows"}})
    assert out.status_code == 200, out.text
    assert time.perf_counter() - started < 5
    body = out.json()
    assert [b["label"] for b in body["result"]["blockers"]][-1] == "The business slows down without you"
    assert body["session"]["handoff"]["to"] == "/check/risks" and body["session"]["missing"] == []
    again = client.post(f"/task-sessions/{s['id']}/risk-check", json={"answers": {}})      # pressed twice: the same answer
    assert again.status_code == 200 and again.json()["result"]["blockers"] == body["result"]["blockers"]
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []
    assert _check(client, "what are my business risks")["missing"] == []      # kept for every later check (R-2)


def test_the_dashboard_cash_card_says_estimate_like_the_risk_check(world, monkeypatch):
    """The owner's brief, 25 Oct (5): spending from one day gives an estimated runway on the dashboard too."""
    from datetime import datetime, timezone
    from app.modules.agent import dashboard, figures
    env, store, client, who = world
    d = _signed_in(env, who, monkeypatch, expenses="same_day")
    now = datetime.now(timezone.utc)
    f = figures.of(d, now.date())
    assert f["costs_estimate"] is True
    kpi = dashboard._runway_kpi(d, now.date(), lambda v, h=None, t=None: {"value": v, "hint": h, "tone": t}, lambda w: {"value": None, "hint": w})
    assert kpi["value"].startswith("About ") and kpi["hint"].startswith("An estimate: based on 2 expenses on ")
    cards = dashboard.compose_insights(d, {}, now, stage="operating", prefs={}, approvals=[], can_send=True)
    card = next(c for c in cards if c.get("widget_id") == "cash" or c.get("key") == "cash" or "cash position" in str(c).lower())
    assert "only an estimate: it's based on 2 expenses on " in str(card) and "Add regular monthly costs" in str(card)
    # Told the regular costs (the risk check's answer), it is no longer an estimate, on both
    d["quick_check_answers"] = {"business_risks": {"answers": {"monthly_costs": 300}, "at": now.date().isoformat()}}
    f = figures.of(d, now.date())
    assert f["costs_estimate"] is False and f["costs_monthly"] == 300 and f["sources"]["costs_monthly"] == "your usual monthly costs, as you told me"


def test_simulation_the_risk_check_and_the_dashboard_read_one_set_of_figures(world, monkeypatch):
    """R-4 (the owner's brief, 24 Oct): one calculation; the "lose them" what-if is about the customer the check found."""
    from datetime import datetime, timezone
    from app.modules.agent import business as bz
    env, store, client, who = world
    d = _signed_in(env, who, monkeypatch, expenses="same_day")
    s = _check(client)
    out = client.post(f"/task-sessions/{s['id']}/risk-check", json={"answers": {"key_person": "runs"}}).json()
    concentration = next(b for b in out["result"]["blockers"] if b["key"] == "concentration")
    assert concentration["customer"] == "Delta Offices Ltd"
    client.post(f"/task-sessions/{s['id']}/answers", json={"answers": {"monthly_costs": 300}})
    shared = client.get("/businesses/A/figures").json()
    assert shared["costs_monthly"] == 300 and shared["customers"] == [{"name": "Delta Offices Ltd", "share": 100.0}]
    lost = bz.simulate(d, "client_loss", {"customer": "Delta Offices Ltd"}, datetime.now(timezone.utc).date())
    assert lost["customer"] == "Delta Offices Ltd" and lost["monthly_burn"] == 300      # the owner's costs, as everywhere
