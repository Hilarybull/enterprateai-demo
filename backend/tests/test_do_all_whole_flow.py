"""The owner, 1 Nov: "the do all that cost credits should handle all", "my score should be coming up well after the do all", "let's
have a clean flow". One Do all, one Approve all: everything drafted at once, nothing approved is lost, the score comes up, and what
is left is only what the owner alone can do. The model is a stand-in here: the figures are what a reply might say."""
import asyncio
from datetime import timedelta

from test_goal_onboarding import world, _funding, OWNER  # noqa: F401
from app.modules.agent import goal_router, converse_launch, research, sign_off
from app.modules.readiness import rules
from app.modules.readiness.service import service_for

USER = {"id": OWNER, "email": None}
PLAIN = {"delivery.capacity_available": "40", "delivery.capacity_committed": "5", "delivery.capacity_per_unit": "1", "planned_volume.amount": "20", "planned_volume.unit": "orders",
         "delivery.capacity_unit": "orders", "target_date": "2027-03-01", "_forecast.opening_cash": "500", "_forecast.receipts": "900", "_forecast.payments": "500"}
LISTS = {"delivery.dependencies": [{"name": "Supplier", "kind": "supplier", "contingency": "A second supplier", "available": "yes"}],
         "control.milestones": [{"outcome": "First sale", "due_date": "2027-03-01", "owner": "Ada"}],
         "prerequisites": [{"name": "Trading registration", "applicable": "yes", "critical": "false"}]}


def _reply(kind, key, target):
    types = {f["key"]: f.get("type") for s in rules.PROFILES[rules.CURRENT[kind]]["sections"] for f in s["fields"]}
    if key in PLAIN:
        return PLAIN[key]
    if key in LISTS:
        return LISTS[key]
    if key == "use_of_funds":
        whole = float(target or 400)
        return [{"purpose": "Stock", "amount": str(int(whole * 0.75)), "category": "Operations", "period": "2027-02"},
                {"purpose": "Reserve", "amount": str(int(whole - int(whole * 0.75))), "category": "Reserve", "period": "2027-03"}]
    if key in research.CASE_LIST_FIELDS:
        return [{c: f"{c} of {key}" for c in research.CASE_LIST_FIELDS[key]}]
    return {"money": "60" if "price" in key else "10", "number": "20", "date": "2027-02-01"}.get(types.get(key), f"An answer for {key} here")


def _set(d, path, v):
    parts = path.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = v


def _do_all_then_approve_all(env, svc, kind, topic, cid, monkeypatch):
    go = asyncio.run
    target = go(svc.store.get("subjects", cid))["data"].get("target_amount")

    async def drafted(_llm, _goal, _facts, only):
        return {k: _reply(kind, k, target) for k in only}
    monkeypatch.setattr(research, "draft_estimates", drafted)
    monkeypatch.setattr(research, "_default_llm", lambda *_a, **_k: object())
    orch = goal_router.get_orchestrator()
    go(converse_launch._fill_rest(orch, USER, "A", {"id": cid}, env.businesses["A"]["data"], "", orch.rt.clock(), {}, quiet=True, topic=topic))
    row = go(svc.store.get("subjects", cid))
    data, drafts = row["data"], row["data"].get("agent_drafts") or {}
    scratch: dict = {}
    for path, d in drafts.items():
        _set(scratch, path, d["value"])
    changes = {top: ({**(data.get(top) or {}), **v} if isinstance(v, dict) and isinstance(data.get(top), dict) else v) for top, v in scratch.items()}
    go(svc.update_subject(OWNER, "A", kind, cid, row["revision"], {**changes, "agent_drafts": {}}, None))      # as the page saves Approve all
    return drafts, go(sign_off.sign_off(orch, USER, "A", topic, cid))


def _open(after):
    return {ch["code"] for c in after["assessment"]["result"]["criteria"] for ch in c["checks"] if ch["state"] != "passed"}


def test_funding_one_do_all_one_approve_all(world, monkeypatch):  # noqa: F811
    env, store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "decision_engine"
    _sid, made = _funding(client, amount=400, use="opening stock")
    cid = made["handoff"]["subject_id"]
    svc = service_for(goal_router.get_orchestrator())
    day = goal_router.get_orchestrator().rt.clock().date() - timedelta(days=5)
    env.businesses["A"]["data"].setdefault("research_runs", {})["r1"] = {
        "id": "r1", "goal": "need_funding", "case_id": cid, "created_at": goal_router.get_orchestrator().rt.clock().isoformat(), "status": "review",
        "items": [{"topic": "demand", "label": "Market demand", "sources": [{"url": "https://example.test/report", "quote": "Demand is growing.", "date": day.isoformat(), "publisher": "Example"}]}]}
    before = (asyncio.run(svc.get_subject(OWNER, "A", rules.FUNDING, cid, None)).get("summary") or {}).get("score") or 0
    drafts, after = _do_all_then_approve_all(env, svc, rules.FUNDING, "funding", cid, monkeypatch)
    for key in ("economics.price", "economics.direct_cost", "market.differentiation", "use_of_funds", "team.responsibilities", "risks"):
        assert key in drafts or key in (after["data"].get("market") or {}), key
    assert after["data"]["market"]["differentiation"] == "An answer for market.differentiation here"      # what was approved stays
    assert after["forecast"]["data"]["confirmed_at"] and after["data"]["timing_confirmed"]
    score = after["summary"]["score"]
    assert score >= 85 and score > before, (score, _open(after))
    assert "C4.B" in _open(after) and "C3.A" not in _open(after) and "C5.B" not in _open(after)      # only the owner can confirm the proof fits their customers
    assert env.businesses["A"]["data"]["agent_filled"][str(cid)] is True      # never offered again


def test_launch_one_do_all_one_approve_all(world, monkeypatch):  # noqa: F811
    env, store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "decision_engine"
    svc = service_for(goal_router.get_orchestrator())
    plan = asyncio.run(svc.create_subject(OWNER, "A", rules.LAUNCH, {"name": "Sock making"}, None))
    drafts, after = _do_all_then_approve_all(env, svc, rules.LAUNCH, "launch", plan["id"], monkeypatch)
    assert after["summary"]["score"] >= 75, (after["summary"]["score"], _open(after))
    assert after["data"]["control"]["milestones"][0]["outcome"] == "First sale" and after["forecast"]["data"]["confirmed_at"]
    assert all(p["status"] == "not_completed" for p in after["data"]["prerequisites"])      # never said to be done for them
    assert {"C1.A", "C5.B"} <= _open(after)      # real demand proof and a real test run stay the owner's


def test_a_launch_is_its_own_case_and_never_touches_another(world, monkeypatch):  # noqa: F811
    """The owner, 1 Nov: "for launching, it's a new case, not affecting the current"."""
    env, store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "decision_engine"
    svc = service_for(goal_router.get_orchestrator())
    first = asyncio.run(svc.create_subject(OWNER, "A", rules.LAUNCH, {"name": "Sock making"}, None))
    other = asyncio.run(svc.create_subject(OWNER, "A", rules.LAUNCH, {"name": "Hat making"}, None))
    day = goal_router.get_orchestrator().rt.clock().date() - timedelta(days=5)
    env.businesses["A"]["data"].setdefault("research_runs", {})["r_first"] = {
        "id": "r_first", "goal": "launch", "case_id": first["id"], "created_at": goal_router.get_orchestrator().rt.clock().isoformat(), "status": "review",
        "items": [{"topic": "demand", "label": "Demand", "sources": [{"url": "https://example.test/socks", "quote": "Socks sell.", "date": day.isoformat(), "publisher": "Example"}]}]}
    before = asyncio.run(svc.store.get("subjects", other["id"]))
    _do_all_then_approve_all(env, svc, rules.LAUNCH, "launch", first["id"], monkeypatch)
    after = asyncio.run(svc.store.get("subjects", other["id"]))
    assert after["data"] == before["data"] and after["revision"] == before["revision"]      # not a field, draft or forecast
    filled = env.businesses["A"]["data"]["agent_filled"]
    assert filled.get(str(first["id"])) is True and str(other["id"]) not in filled
    evidence_for = lambda row: asyncio.run(svc._evidence_for(row, asyncio.run(svc._forecast_of(row))))      # noqa: E731
    assert evidence_for(after) == [] and len(evidence_for(asyncio.run(svc.store.get("subjects", first["id"])))) == 1      # its research is its own


def test_a_funding_run_for_one_need_never_comes_back_for_the_next(world, monkeypatch):  # noqa: F811
    """The owner, 1 Nov: "each funding for a different purpose is replacing and updating the current"."""
    env, store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "decision_engine"
    _sid, made = _funding(client, amount=400, use="opening stock")
    cid = made["handoff"]["subject_id"]
    svc = service_for(goal_router.get_orchestrator())
    orch = goal_router.get_orchestrator()
    day = orch.rt.clock().date() - timedelta(days=5)
    env.businesses["A"]["data"].setdefault("research_runs", {})["r_old"] = {
        "id": "r_old", "goal": "need_funding", "case_id": cid, "created_at": orch.rt.clock().isoformat(), "status": "review",
        "items": [{"topic": "demand", "label": "Demand", "sources": [{"url": "https://example.test/stock", "quote": "Stock sells.", "date": day.isoformat(), "publisher": "Example"}]}]}
    _do_all_then_approve_all(env, svc, rules.FUNDING, "funding", cid, monkeypatch)
    go = asyncio.run
    assert len(go(svc._evidence_for(go(svc.store.get("subjects", cid)), None))) == 1
    go(svc.replace_need(OWNER, "A", cid, {"target_amount": 2000, "purpose": "a new site", "route_preference": "loan"}, None))
    row = go(svc.store.get("subjects", cid))
    assert float(row["data"]["target_amount"]) == 2000 and row["data"]["previous_needs"]      # the same case, the old need in History
    assert not row["data"].get("use_of_funds") and not (row["data"].get("market") or {}).get("differentiation")      # set aside with the old need
    assert str(cid) not in (env.businesses["A"]["data"].get("agent_filled") or {})      # a new need: drafted afresh
    # Approving now never brings the old need's research back
    go(sign_off.sign_off(orch, USER, "A", "funding", cid))
    assert go(svc._evidence_for(go(svc.store.get("subjects", cid)), None)) == []
    # Do all for the new need: its own drafts, adding up to its own amount, still one case
    drafts, after = _do_all_then_approve_all(env, svc, rules.FUNDING, "funding", cid, monkeypatch)
    assert sum(float(x["amount"]) for x in after["data"]["use_of_funds"]) == 2000
    assert after["data"]["market"]["differentiation"]
    assert len(go(svc.list_subjects(OWNER, "A", rules.FUNDING, None, include_archived=False))["items"]) == 1


def test_only_decision_engine_runs_do_all_and_every_plan_gets_its_first_score(world, monkeypatch):  # noqa: F811
    """The owner, 1 Nov: "the first scoring based on their input is accessible to all plans", "only decision engine can run the
    readiness do all for me": however it's reached, an earlier run included."""
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=400, use="opening stock")      # on Explorer
    cid = made["handoff"]["subject_id"]
    assert isinstance(client.get(f"/businesses/A/cases/{cid}/overview").json()["result"]["score"], (int, float))      # the first score, free
    svc = service_for(goal_router.get_orchestrator())
    called = []

    async def drafted(_llm, _goal, _facts, only):
        called.append(only)
        return {}
    monkeypatch.setattr(research, "draft_estimates", drafted)
    orch = goal_router.get_orchestrator()
    say = lambda text: client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text", "page": "funding"}).json()      # noqa: E731
    for plan in ("explorer", "starter_insight"):
        env.meter.plans[OWNER] = plan
        for text in ("Yes, do it all for me", "Do it all for me", "Fill the rest for me"):
            out = say(text)
            assert "Decision Engine" in out["message"] and out["actions"][0]["to"] == "/pricing", (plan, text, out["message"])
        asyncio.run(converse_launch._fill_rest(orch, USER, "A", {"id": cid}, env.businesses["A"]["data"], "", orch.rt.clock(), {}, quiet=True, topic="funding"))
    assert called == [] and not asyncio.run(svc.store.get("subjects", cid))["data"].get("agent_drafts")
    # An earlier run, from a higher plan, is no way round it
    monkeypatch.setattr(research, "reuse_for", lambda *a, **k: {"id": "r1", "created_at": orch.rt.clock().isoformat(), "counts": {}})
    _s, goal, data, answers, result = asyncio.run(goal_router._session_premium_context(env.businesses["A"]["data"]["chat_sessions"][cid], USER))
    quote = asyncio.run(goal_router._premium_quote(USER, goal, result, answers, data, case_id=cid))
    assert quote["allowed"] is False and quote["refusal"]["minimum_plan"] == "decision_engine"
    env.meter.plans[OWNER] = "decision_engine"
    assert asyncio.run(goal_router._premium_quote(USER, goal, result, answers, data, case_id=cid))["allowed"] is True


def test_a_run_stopped_by_a_restart_says_so_and_never_spins(world):  # noqa: F811
    """The owner, 1 Nov: "it's just spinning over 3 mins": a restart ended the run; the status must say it stopped."""
    from app.modules.agent import assistant_context
    env, store, client, who = world
    who["user"] = OWNER
    env.meter.plans[OWNER] = "decision_engine"
    _sid, made = _funding(client, amount=400, use="opening stock")
    cid = made["handoff"]["subject_id"]
    old = (assistant_context.STARTED - timedelta(minutes=1)).isoformat()
    env.businesses["A"]["data"]["agent_working"] = {str(cid): {"at": old, "topic": "funding"}}
    out = client.get(f"/businesses/A/agent/assistant-context?kind=funding&case_id={cid}").json()
    assert out["working"] is False and out["failed"]


def test_explorer_is_never_told_started(world, monkeypatch):  # noqa: F811
    """A held yes from before, or a plan that changed since: the plan is checked again before anything starts."""
    from app.modules.agent import converse
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client, amount=400, use="opening stock")
    cid = made["handoff"]["subject_id"]
    orch = goal_router.get_orchestrator()
    out = asyncio.run(converse._start_do_all(orch, USER, "A", {"id": cid}, {"session": _sid, "price": 60}, "Yes, start", orch.rt.clock()))
    assert "Started" not in out["message"] and "Decision Engine" in out["message"]
