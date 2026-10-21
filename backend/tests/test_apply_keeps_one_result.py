"""Adopt and apply (the owner's QA, 21 Oct): an edited figure is what the case uses (its forecast too), the case's own
figures are kept unless the owner picks another, and after applying the result screen and the case page show the same
assessment in the same layout."""
from test_agent import OWNER
from test_case_kept_between_chats import FIRST, _chat
from test_goal_onboarding import world  # noqa: F401 - the fixture
from test_reused_run_is_redrafted import _stale_run


def _setup(env, client, who):
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["workspace_profile"] = {"company_name": "Synthetic Wash", "country": "Nigeria", "city": "Abuja"}
    sid, _ = _chat(client, who, FIRST)
    d.setdefault("research_runs", {})["rr_old"] = _stale_run(client.get(f"/task-sessions/{sid}").json()["inputs"])
    who["user"] = OWNER
    case_id = next(c for c, s in (d.get("chat_sessions") or {}).items() if s == sid)
    return d, sid, case_id


def test_apply_keeps_the_overview_and_one_score(world):  # noqa: F811
    env, store, client, who = world
    d, sid, case_id = _setup(env, client, who)
    run = client.get("/businesses/A/research/rr_old").json()["research"]
    decisions = {i["id"]: {"decision": "accept", "pressed": True} for i in run["items"] if i.get("kind") != "question"}
    out = client.post("/businesses/A/research/rr_old/review", json={"decisions": decisions})
    assert out.status_code == 200, out.text
    overview = client.get(f"/businesses/A/cases/{case_id}/overview")
    assert overview.status_code == 200, overview.text
    result = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    o = overview.json()["result"]
    assert (o["score"], len(o["blockers"])) == (result["score"], len(result["blockers"]))


def test_an_edited_revenue_is_what_the_case_and_its_forecast_use_and_its_own_fixed_costs_stay(world):  # noqa: F811
    import asyncio
    from app.modules.agent import goal_router
    from app.modules.readiness import rules as rr
    from app.modules.readiness.service import service_for
    env, store, client, who = world
    d, sid, case_id = _setup(env, client, who)
    svc = service_for(goal_router.get_orchestrator())
    run_ = asyncio.run
    case = run_(svc.get_subject(OWNER, "A", rr.FUNDING, case_id, None))
    case = run_(svc.update_subject(OWNER, "A", rr.FUNDING, case_id, case["revision"], {"economics": {**(case["data"].get("economics") or {}), "fixed_costs_monthly": "40000"}}, None))
    months = [{"month": f"2026-{m:02d}", "receipts": "331425", "payments": "200000", "basis": "forecast"} for m in range(10, 13)]
    run_(svc.save_forecast(OWNER, "A", rr.FUNDING, case_id, {"currency": "NGN", "start_month": "2026-10", "months": months}, None, None))
    # The run offers the invoices' ₦331,425 a month; the owner edits it to ₦1,200,000 and applies.
    d["research_runs"]["rr_old"]["items"].append({"id": "r_rev", "kind": "reused", "field": "monthly_revenue", "criterion": "financial",
                                                 "label": "Revenue each month", "value": 331425, "source_note": "From your invoices", "decision": None})
    run = client.get("/businesses/A/research/rr_old").json()["research"]
    decisions = {i["id"]: {"decision": "accept", "pressed": True} for i in run["items"] if i.get("kind") != "question"}
    decisions["r_rev"] = {"decision": "edit", "value": "1200000", "saved": True, "pressed": True}
    assert client.post("/businesses/A/research/rr_old/review", json={"decisions": decisions}).status_code == 200
    after = run_(svc.get_subject(OWNER, "A", rr.FUNDING, case_id, None))
    receipts = {float(m["receipts"]) for m in after["forecast"]["data"]["months"]}
    assert receipts == {1200000.0}, receipts                                              # the edit, every month
    assert str(after["data"]["economics"]["fixed_costs_monthly"]) == "40000"              # the case's own figure kept
    assert str(after["data"]["traction"]["monthly_revenue"]).startswith("1200000")
    # One assessment everywhere: the result screen, the case Overview and the pinned strip agree.
    o = client.get(f"/businesses/A/cases/{case_id}/overview").json()["result"]
    r = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    pin = next(p for p in client.get("/businesses/A/pinned").json()["items"] if p["id"] == case_id)
    assert (o["score"], len(o["blockers"])) == (r["score"], len(r["blockers"])) == (pin["score"] if pin["score"] is not None else r["score"], pin["to_do"])
