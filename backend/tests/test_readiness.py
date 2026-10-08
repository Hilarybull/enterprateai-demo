"""Funding Readiness and Launch Readiness: the shared assessment contract, the two rubrics,
their acceptance examples (AT01-AT16, LT01-LT16) and the boundary cases the PRDs name."""
import copy
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import router as agent_router
from app.modules.readiness import engine, materials, rules
from app.modules.readiness import forecast as fc
from app.modules.readiness import service as svc_mod
from app.modules.readiness.service import Conflict, Denied, Forbidden, Invalid, NotFound, Unavailable, service_for
from app.shared.auth.deps import get_current_user
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run

F, L = rules.FUNDING, rules.LAUNCH


def day(env, offset=0):
    return (env.now + timedelta(days=offset)).date().isoformat()


def months(env, count, receipts="10000", payments="8000", start_offset=0):
    start = fc.add_months((env.now.year, env.now.month), start_offset)
    return [{"month": m, "receipts": receipts, "payments": payments} for m in fc.month_range(start, count)]


def evidence(env, svc, subject_id, check, **over):
    data = {"title": "Customer research, 40 interviews", "type": "research", "claim": "Target customers have this problem",
            "source": {"kind": "note", "reference": "Interview notes"}, "effective_date": day(env, -10),
            "links": [{"subject_id": subject_id, "check": check}] if subject_id else [], **over}
    return run(svc.add_evidence(OWNER, "A", data, feature=F))


# ── a fully prepared funding case ─────────────────────────────────────────────

FUNDING_DATA = {
    "title": "Seed round", "target_amount": "100000", "currency": "GBP", "timing_confirmed": True, "stage": "pre_revenue",
    "purpose": "Hire two engineers and reach 50 paying customers",
    "milestones": [{"id": "m1", "outcome": "50 paying customers", "measure": "Paying customers", "baseline": "0", "target": "50", "owner": "Ada"}],
    "purpose_milestone_id": "m1",
    "use_of_funds": [{"id": "u1", "category": "People", "amount": "60000", "purpose": "Two engineers"},
                     {"id": "u2", "category": "Reserve", "amount": "40000", "rationale": "Six months of contingency"}],
    "market": {"target_segment": "UK accountancy firms with 5-20 staff", "differentiation": "Built for small practices",
               "acquisition_approach": "Partner referrals", "acquisition_owner": "Ada", "acquisition_cost": "£500 per customer", "acquisition_milestone_id": "m1"},
    "economics": {"price": "1000", "direct_cost": "300", "fixed_costs_monthly": "5000"},
    "team": {"responsibilities": [{"area": "Product", "owner": "Ada"}, {"area": "Sales", "owner": "Ben"}], "no_gaps": True},
    "risks": [{"risk": "Long sales cycles", "action": "Start partner conversations now", "kind": "general"}],
    "traction": {"summary": "40 interviews; no sales yet"},
}


def funding_case(env, *, forecast=True, assumptions=True, demand=True, attest=True, documents=True, **over):
    svc = service_for(env.orch)
    data = copy.deepcopy(FUNDING_DATA)
    data["receipt_date"] = day(env, 90)
    data["milestones"][0]["due_date"] = day(env, 200)
    period = fc.month_key((env.now.year, env.now.month))
    for a in data["use_of_funds"]:
        a["period"] = period
    data.update(over)
    case = run(svc.create_subject(OWNER, "A", F, data))
    cid = case["id"]
    if forecast:
        f = {"opening_cash": "50000", "opening_cash_as_of": day(env), "currency": "GBP", "months": months(env, 12),
             "assumptions": [{"applies_to": "receipts", "text": "Ten customers a month at £1,000", "source": "Pipeline"},
                             {"applies_to": "payments", "text": "Team and tools", "source": "Budget"}] if assumptions else []}
        if isinstance(forecast, dict):
            f.update(forecast)
        run(svc.save_forecast(OWNER, "A", F, cid, f))
    if demand:
        evidence(env, svc, cid, "C4.A")
    if attest:
        if demand:
            run(svc.attest(OWNER, "A", F, cid, "C4.B", True, "Interviewees match the target segment"))
        run(svc.attest(OWNER, "A", F, cid, "C5.B", True, "Break-even is 8 sales a month; capacity limits noted"))
    if documents:
        for key, title in (("executive_summary", "Executive summary v1"), ("team_summary", "Team and ownership summary")):
            e = evidence(env, svc, None, None, title=title, type="document", facts={"target_amount": data.get("target_amount"), "currency": "GBP"} if key == "executive_summary" else {})
            run(svc.review_document(OWNER, "A", cid, key, evidence_id=e["id"]))
        for key in ("executive_summary", "use_of_funds_schedule", "forecast", "team_summary"):
            run(svc.review_document(OWNER, "A", cid, key, reviewed=True))
    return svc, cid


def assess(svc, cid, kind=F, **kw):
    return run(svc.request_assessment(OWNER, "A", kind, cid, **kw))


def check(result, code):
    return next(ch for c in result["criteria"] for ch in c["checks"] if ch["code"] == code)


def gate(result, code):
    return next(g for g in result["gates"] if g["code"] == code)


def crit(result, code):
    return next(c for c in result["criteria"] if c["code"] == code)


# ══ Funding acceptance examples ═══════════════════════════════════════════════

def test_at01_all_criteria_met_and_gates_pass_is_ready_with_forecast_labels():
    env = Env()
    svc, cid = funding_case(env)
    a = assess(svc, cid)
    r = a["result"]
    assert a["execution_status"] == "succeeded"
    assert [c["score"] for c in r["criteria"]] == [100] * 8, [(c["code"], [(x["state"], x["reason"]) for x in c["checks"]]) for c in r["criteria"] if c["score"] != 100]
    assert all(g["state"] == "passed" for g in r["gates"]), r["gates"]
    assert (r["score"], r["score_display"], r["classification"], r["coverage"]) == (100.0, 100, "ready", 100)
    assert r["headline"] == "Prepared for initial equity discussions against this checklist."
    assert r["data_basis"]["label"] == "forecast" and "assumptions" in r["data_basis"]["note"]      # forecast labels stay visible
    assert r["confidence"]["level"] == "medium"                                                    # complete and current, but self-attested
    assert "not the likelihood of securing investment" in r["disclaimer"]
    assert r["gaps"] == []
    assert run(svc.get_subject(OWNER, "A", F, cid))["status"] == "active"


def test_at02_every_criterion_at_50_is_not_ready():
    env = Env()
    svc, cid = funding_case(env, assumptions=False, attest=False,
                            milestones=[{"id": "m1", "outcome": "Customers", "owner": "Ada"}],                 # no measure or target: C1.B and C6.B fail
                            use_of_funds=[{"id": "u1", "category": "People", "amount": "100000", "purpose": ""}],   # no purpose: C2.B fails
                            team={"responsibilities": [{"area": "Product", "owner": "Ada"}], "gaps": [{"gap": "No salesperson", "action": ""}]},
                            risks=[{"risk": "Long sales cycles", "action": ""}])
    run(svc.attest(OWNER, "A", F, cid, "C4.B", False, "Interviewees were not the target customer"))
    run(svc.attest(OWNER, "A", F, cid, "C5.B", False, "Capacity limits not explained"))
    r = assess(svc, cid)["result"]
    assert [c["score"] for c in r["criteria"]] == [50] * 8, [(c["code"], [(x["code"], x["state"], x["reason"]) for x in c["checks"]]) for c in r["criteria"]]
    assert all(g["state"] == "passed" for g in r["gates"])
    assert (r["score"], r["classification"]) == (50.0, "not_ready")


def test_at03_financial_assumptions_missing_scores_90_and_is_ready_with_the_gap_disclosed():
    env = Env()
    svc, cid = funding_case(env, assumptions=False)
    r = assess(svc, cid)["result"]
    assert check(r, "C3.A")["state"] == "passed" and gate(r, "G3")["state"] == "passed"      # the failure is not the reconciliation gate
    assert check(r, "C3.B")["state"] == "failed" and crit(r, "C3")["score"] == 50
    assert (r["score"], r["classification"]) == (90.0, "ready")
    assert [g["code"] for g in r["gaps"]] == ["C3.B"] and r["gaps"][0]["group"] == 3


def test_at04_allocations_short_of_the_target_fail_g2_whatever_the_score():
    env = Env()
    svc, cid = funding_case(env, use_of_funds=[{"id": "u1", "category": "People", "amount": "90000", "purpose": "Team", "period": "2026-10"}])
    r = assess(svc, cid)["result"]
    assert gate(r, "G2")["state"] == "failed" and "10,000.00 is not allocated" in gate(r, "G2")["reason"]
    assert r["classification"] == "not_ready" and r["score"] == 92.5 and r["blocker_count"] == 1
    assert r["gaps"][0]["code"] == "G2" and r["gaps"][0]["group"] == 1
    # The target is never changed to make the totals agree.
    assert run(svc.get_subject(OWNER, "A", F, cid))["data"]["target_amount"] == "100000"


def test_at05_unknown_demand_evidence_gives_no_score_85_coverage_and_insufficient_evidence():
    env = Env()
    svc, cid = funding_case(env, demand=False)
    r = assess(svc, cid)["result"]
    assert crit(r, "C4")["state"] == "unknown" and crit(r, "C4")["score"] is None
    assert (r["score"], r["score_display"], r["coverage"], r["classification"]) == (None, None, 85, "insufficient_evidence")
    assert r["confidence"]["level"] == "low"
    assert {m["code"] for m in r["missing"]} == {"C4.A", "C4.B"}


def test_at06_unknown_evidence_and_a_failed_gate_is_not_ready_with_the_missing_evidence_shown():
    env = Env()
    svc, cid = funding_case(env, demand=False, use_of_funds=[{"id": "u1", "category": "People", "amount": "90000", "purpose": "Team", "period": "2026-10"}])
    r = assess(svc, cid)["result"]
    assert r["classification"] == "not_ready" and r["score"] is None
    assert gate(r, "G2")["state"] == "failed" and {m["code"] for m in r["missing"]} == {"C4.A", "C4.B"}
    assert [g["group"] for g in r["gaps"]][:2] == [1, 2]      # the failed gate first, then missing evidence


def test_at07_pre_revenue_zero_sales_and_research_are_assessed_as_submitted():
    env = Env()
    svc, cid = funding_case(env, forecast={"months": months(env, 12, receipts="0", payments="1000")})
    r = assess(svc, cid)["result"]
    assert check(r, "C3.A")["state"] == "passed"                       # zero is a value, not a blank
    assert check(r, "C4.A")["state"] == "passed" and "market research" in check(r, "C4.A")["reason"]
    assert [(e["type"], e["strength"]) for e in r["evidence_used"]] == [("research", "indicative")]
    codes = {x["code"] for x in r["risks"]}
    assert {"pre_revenue", "indicative_demand"} <= codes
    assert r["metrics"]["forecast"]["months"][0]["receipts"] == "0.00"
    text = materials.to_text(run(svc.generate_material(OWNER, "A", F, cid, "executive_summary"))["content"])
    assert "Not trading yet" in text and "40 interviews; no sales yet" in text


def test_at08_funding_that_arrives_after_cash_runs_out_shows_a_timing_gap():
    env = Env()
    svc, cid = funding_case(env, forecast={"opening_cash": "10000", "months": months(env, 12, receipts="1000", payments="6000")}, receipt_date=None)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"receipt_date": day(env, 150)}))      # February; cash is gone in December
    m = assess(svc, cid)["result"]["metrics"]
    assert m["first_negative_month"] == "2026-12" and m["funding_timing_gap"]["exists"] and m["funding_timing_gap"]["months"] == 2
    assert "not current cash" in m["funding_timing_gap"]["text"]
    assert all(row["financing"] == "0.00" for row in m["forecast"]["months"])      # the baseline excludes the proposed raise
    assert m["funded_first_negative_month"] == "2026-12"                            # the gap stays visible in the funded view too
    assert m["runway"] == {"state": "bounded", "until": "2026-12"}


def test_at09_a_case_changed_during_the_run_keeps_its_snapshot_and_is_stale():
    env = Env()
    svc, cid = funding_case(env)

    async def edit(_run):
        case = await svc.get_subject(OWNER, "A", F, cid)
        await svc.update_subject(OWNER, "A", F, cid, case["revision"], {"target_amount": "150000"})
    svc.during_run = edit
    a = assess(svc, cid)
    svc.during_run = None
    assert a["execution_status"] == "succeeded" and a["result"]["classification"] == "ready"      # assessed on the original snapshot
    assert a["freshness"]["status"] == "stale" and "changed" in a["freshness"]["reason"]
    full = run(svc.get_assessment(OWNER, "A", F, cid, a["id"]))
    assert full["snapshot"]["subject"]["target_amount"] == "100000"
    assert run(svc.get_subject(OWNER, "A", F, cid))["data"]["target_amount"] == "150000"


def test_at10_evidence_that_expires_makes_the_view_stale_and_the_check_unknown_on_reassessment():
    env = Env()
    svc, cid = funding_case(env, demand=False, attest=False)
    evidence(env, svc, cid, "C4.A", expires_on=day(env, 10))
    run(svc.attest(OWNER, "A", F, cid, "C4.B", True, "Relevant"))
    run(svc.attest(OWNER, "A", F, cid, "C5.B", True, "Reviewed"))
    first = assess(svc, cid)
    assert first["freshness"]["status"] == "current" and check(first["result"], "C4.A")["state"] == "passed"
    env.now += timedelta(days=20)
    summary = run(svc.get_subject(OWNER, "A", F, cid))["summary"]
    assert summary["freshness"] == "stale" and "expired" in summary["freshness_reason"]
    again = assess(svc, cid)["result"]
    assert check(again, "C4.A")["state"] == "unknown" and check(again, "C4.A")["stale"] is True
    assert again["classification"] == "insufficient_evidence"
    kept = run(svc.get_assessment(OWNER, "A", F, cid, first["id"]))      # the earlier result is still readable as it was
    assert kept["result"]["classification"] == "ready"


def test_at11_another_business_never_leaks_through_ids_links_or_summaries():
    env = Env()
    svc, cid = funding_case(env)
    assess(svc, cid)
    other = run(svc.create_subject(OUTSIDER, "B", F, {"title": "B's round"}))
    for call in (svc.get_subject(OUTSIDER, "A", F, cid), svc.list_subjects(OUTSIDER, "A", F), svc.list_evidence(OUTSIDER, "A"),
                 svc.request_assessment(OUTSIDER, "A", F, cid)):
        with pytest.raises(Denied):
            run(call)
    for call in (svc.get_subject(OUTSIDER, "B", F, cid),                                          # A's case under B's business
                 svc.request_assessment(OWNER, "A", F, other["id"]), svc.history(OWNER, "A", F, other["id"]),
                 svc.generate_material(OWNER, "A", F, other["id"], "readiness_report")):
        with pytest.raises(NotFound):
            run(call)
    with pytest.raises(NotFound):                                                                 # evidence can't be linked to another business's case
        evidence(env, svc, other["id"], "C4.A", title="Cross link")
    b_evidence = run(svc.add_evidence(OUTSIDER, "B", {"title": "B's document", "type": "document", "effective_date": day(env, -1)}, feature=F))
    with pytest.raises(NotFound):
        run(svc.review_document(OWNER, "A", cid, "team_summary", evidence_id=b_evidence["id"]))
    with pytest.raises(NotFound):
        run(svc.download_file(OWNER, "A", b_evidence["id"]))
    summaries = run(svc.dashboard_summaries("B", env.businesses["B"]["data"], run(env.orch.rt.business.actor(OUTSIDER, "B", {})), env.now))
    assert summaries["funding"]["title"] == "B's round" and summaries["funding"]["case_id"] == other["id"]


def test_at12_a_retried_assessment_or_export_is_one_run_and_one_document():
    env = Env()
    svc, cid = funding_case(env)
    a = assess(svc, cid, idempotency_key="k1")
    b = assess(svc, cid, idempotency_key="k1")
    assert a["id"] == b["id"] and b["repeated"] is True
    assert len(run(svc.history(OWNER, "A", F, cid))) == 1
    m1 = run(svc.generate_material(OWNER, "A", F, cid, "readiness_report", idempotency_key="doc1"))
    m2 = run(svc.generate_material(OWNER, "A", F, cid, "readiness_report", idempotency_key="doc1"))
    assert m1["id"] == m2["id"] and m2["repeated"] is True
    assert len(run(svc.list_materials(OWNER, "A", F, cid))["items"]) == 1


def test_at13_the_assessment_never_depends_on_a_language_model():
    import inspect
    for module in (engine, fc, rules, svc_mod, materials):
        source = inspect.getsource(module).lower()
        assert "llm" not in source.replace("llm or integration", "") or module is svc_mod, module.__name__
        assert "anthropic" not in source and "openai" not in source and "classifier" not in source
    env = Env()
    env.orch.rt.classifier = None                      # no model available at all
    svc, cid = funding_case(env)
    r = assess(svc, cid)["result"]
    assert r["classification"] == "ready" and r["criteria"] and isinstance(r["gaps"], list)


def test_at14_dismissing_an_action_leaves_the_criterion_unchanged():
    env = Env()
    svc, cid = funding_case(env, assumptions=False)
    assess(svc, cid)
    action = next(a for a in run(svc.get_subject(OWNER, "A", F, cid))["actions"] if a["code"] == "C3.B")
    with pytest.raises(Invalid):
        run(svc.update_action(OWNER, "A", F, cid, action["id"], {"status": "dismissed"}))                # a reason is required
    out = run(svc.update_action(OWNER, "A", F, cid, action["id"], {"status": "dismissed", "reason": "Investors have not asked for it"}))
    assert out["status"] == "dismissed" and out["dismissal"]["reason"] == "Investors have not asked for it"
    r = assess(svc, cid)["result"]
    assert check(r, "C3.B")["state"] == "failed" and r["score"] == 90.0
    actions = [a for a in run(svc.get_subject(OWNER, "A", F, cid))["actions"] if a["code"] == "C3.B"]
    assert len(actions) == 1 and actions[0]["status"] == "dismissed"                                      # not reopened, not duplicated


def test_at15_a_funding_scenario_overwrites_nothing():
    env = Env()
    svc, cid = funding_case(env, forecast={"opening_cash": "10000", "months": months(env, 12, receipts="1000", payments="6000")})
    first = assess(svc, cid)
    before = (copy.deepcopy(env.businesses["A"]["data"]), copy.deepcopy(svc.store.rows))
    out = run(svc.scenario(OWNER, "A", F, cid, {"amount": "200000", "receipt_date": day(env, 20)}))
    assert out["saved"] is False and out["formula_version"] == fc.SCENARIO_VERSION
    assert out["comparison"]["first_negative_month"] == {"baseline": "2026-12", "scenario": None}
    assert out["baseline"]["months"][0]["financing"] == "0.00" and out["scenario"]["months"][0]["financing"] == "200000.00"
    assert (env.businesses["A"]["data"], svc.store.rows) == before                                        # live balances, the case and its assessments
    assert run(svc.get_assessment(OWNER, "A", F, cid, first["id"]))["result"] == first["result"]
    with pytest.raises(Invalid):
        run(svc.scenario(OWNER, "A", F, cid, {"amount": "-5"}))


def test_at16_a_new_profile_version_keeps_history_reproducible_and_labels_the_comparison(monkeypatch):
    env = Env()
    svc, cid = funding_case(env)
    old = assess(svc, cid)
    v2 = copy.deepcopy(rules.FUNDING_EQUITY_V1)
    v2["version"] = "0.2"
    v2["thresholds"] = {"conditionally_ready": 60, "ready": 101 - 1}
    monkeypatch.setitem(rules.PROFILES, rules.profile_key(v2), v2)
    monkeypatch.setitem(rules.CURRENT, F, rules.profile_key(v2))
    assert run(svc.get_subject(OWNER, "A", F, cid))["summary"]["freshness"] == "stale"                     # a newer checklist exists
    new = assess(svc, cid)
    assert new["profile"].endswith("@0.2") and old["profile"].endswith("@0.1")
    history = run(svc.history(OWNER, "A", F, cid))
    assert [h["profile"][-3:] for h in history] == ["0.2", "0.1"]
    assert history[0]["comparable"] is False and "a new version of the checklist" in history[0]["changed_because"]
    kept = run(svc.get_assessment(OWNER, "A", F, cid, old["id"]))
    assert kept["result"] == old["result"]                                                                 # the old result is untouched
    assert engine.assess(F, kept["snapshot"], rules.get_profile(kept["profile"]), env.now.date()) == old["result"]      # and reproducible


# ── funding boundaries ────────────────────────────────────────────────────────

@pytest.mark.parametrize("points, expected", [(59, "not_ready"), (60, "conditionally_ready"), (79, "conditionally_ready"), (80, "ready"), (100, "ready")])
def test_thresholds_at_exactly_60_and_80(points, expected):
    criteria = [{"weight": points, "score": 100}, {"weight": 100 - points, "score": 0}]
    out = engine.classify(rules.FUNDING_EQUITY_V1, criteria, [{"state": "passed"}])
    assert (out["score"], out["classification"]) == (float(points), expected)


def test_a_score_that_is_not_whole_is_shown_to_one_decimal_never_rounded_across_a_threshold():
    criteria = [{"weight": 79, "score": 100}, {"weight": 1, "score": 50}, {"weight": 20, "score": 0}]
    out = engine.classify(rules.FUNDING_EQUITY_V1, criteria, [])
    assert out["score"] == 79.5 and out["score_display"] == 79.5 and out["classification"] == "conditionally_ready"
    low = engine.classify(rules.FUNDING_EQUITY_V1, [{"weight": 59, "score": 100}, {"weight": 1, "score": 50}, {"weight": 40, "score": 0}], [])
    assert (low["score_display"], low["classification"]) == (59.5, "not_ready")          # never "60" beside "Not ready"
    assert [engine.display_score(x) for x in (100.0, 52.5, 60, None)] == [100, 52.5, 60, None]
    env = Env()                                                                          # the header, the list and the dashboard show the same figure
    svc, cid = funding_case(env, use_of_funds=[{"id": "u1", "category": "People", "amount": "90000", "purpose": "Team", "period": "2026-10"}])
    a = assess(svc, cid)
    svc.store.rows["assessments"][a["id"]]["data"]["result"]["score_display"] = 93       # as saved before this change
    case = run(svc.get_subject(OWNER, "A", F, cid))
    assert case["assessment"]["result"]["score_display"] == case["summary"]["score"] == 92.5
    assert run(svc.history(OWNER, "A", F, cid))[0]["score"] == 92.5


def test_a_failed_gate_overrides_a_perfect_score_and_an_unknown_gate_is_never_ready():
    full = [{"weight": 100, "score": 100}]
    assert engine.classify(rules.FUNDING_EQUITY_V1, full, [{"state": "failed"}])["classification"] == "not_ready"
    unknown = engine.classify(rules.FUNDING_EQUITY_V1, full, [{"state": "unknown"}])
    assert unknown["classification"] == "insufficient_evidence" and unknown["score"] == 100.0
    launch = engine.classify(rules.LAUNCH_COMMERCIAL_V1, full, [{"state": "unknown"}])      # launch: no score with an unknown gate
    assert launch["classification"] == "insufficient_evidence" and launch["score"] is None and launch["gate_completeness"] == 0


def test_blank_is_unknown_and_zero_is_a_confirmed_failure():
    env = Env()
    svc, cid = funding_case(env, target_amount=None)
    r = assess(svc, cid)["result"]
    assert gate(r, "G1")["state"] == "unknown" and gate(r, "G2")["state"] == "unknown" and r["classification"] == "insufficient_evidence"
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"target_amount": "0"}))
    r = assess(svc, cid)["result"]
    assert gate(r, "G1")["state"] == "failed" and r["classification"] == "not_ready"


def test_invalid_input_is_a_field_error_not_a_saved_value():
    env = Env()
    svc = service_for(env.orch)
    for bad, field in (({"target_amount": "-100"}, "target_amount"), ({"target_amount": "lots"}, "target_amount"),
                       ({"receipt_date": "31/31/2026"}, "receipt_date"), ({"currency": "JPY"}, "currency"),
                       ({"use_of_funds": [{"amount": "-1"}]}, "use_of_funds.0.amount"), ({"milestones": [{"due_date": "soon"}]}, "milestones.0.due_date")):
        with pytest.raises(Invalid) as e:
            run(svc.create_subject(OWNER, "A", F, {"title": "Round", **bad}))
        assert field in e.value.errors, (bad, e.value.errors)
    with pytest.raises(Unavailable) as e:                                 # an unsupported route can never produce an equity-derived score
        run(svc.create_subject(OWNER, "A", F, {"title": "Loan", "route": "debt"}))
    assert "isn't available" in str(e.value)
    assert run(svc.list_subjects(OWNER, "A", F))["items"] == []
    with pytest.raises(Invalid):
        run(svc.add_evidence(OWNER, "A", {"title": "From the future", "type": "research", "effective_date": day(env, 5)}, feature=F))
    with pytest.raises(Invalid):
        run(svc.add_evidence(OWNER, "A", {"title": "Undated", "type": "research"}, feature=F))


def test_the_same_evidence_entered_twice_is_one_item():
    env = Env()
    svc, cid = funding_case(env, demand=False)
    a = evidence(env, svc, cid, "C4.A")
    b = evidence(env, svc, cid, "C4.A")
    assert a["id"] == b["id"] and b["duplicate"] is True and len([e for e in run(svc.list_evidence(OWNER, "A")) if e["type"] == "research"]) == 1


def test_conflicting_document_figures_fail_g4_and_reviewers_can_raise_contradictions():
    env = Env()
    svc, cid = funding_case(env)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"target_amount": "120000",
                           "use_of_funds": [{"id": "u1", "category": "People", "amount": "120000", "purpose": "Team", "period": "2026-10"}]}))
    r = assess(svc, cid)["result"]
    assert gate(r, "G4")["state"] == "failed" and "100000.00" in gate(r, "G4")["reason"] and r["classification"] == "not_ready"
    assert check(r, "C8.A")["state"] == "failed"                          # the earlier reviews no longer cover the changed figures
    assert r["confidence"]["level"] == "low" and "contradict" in " ".join(r["confidence"]["reasons"])
    # A reviewer-raised contradiction also fails the gate until it is resolved.
    svc2, cid2 = funding_case(env, title="Second case")
    raised = run(svc2.contradiction(OWNER, "A", cid2, description="The deck says 18 months of runway; the forecast shows 12"))
    assert gate(assess(svc2, cid2)["result"], "G4")["state"] == "failed"
    run(svc2.contradiction(OWNER, "A", cid2, resolve_id=raised["data"]["contradictions"][0]["id"], resolution="Deck corrected"))
    assert gate(assess(svc2, cid2)["result"], "G4")["state"] == "passed"


def test_stale_writes_conflict_and_return_what_is_there_now():
    env = Env()
    svc, cid = funding_case(env)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"purpose": "First edit"}))
    with pytest.raises(Conflict) as e:
        run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"purpose": "Second edit, from a stale copy"}))
    assert e.value.code == "stale_revision" and e.value.current["data"]["purpose"] == "First edit"
    with pytest.raises(Conflict):
        run(svc.request_assessment(OWNER, "A", F, cid, revision=case["revision"]))


def test_roles_map_onto_the_existing_ones_and_revoked_access_stops_everything():
    env = Env()
    svc, cid = funding_case(env)
    assert run(svc.get_subject(MEMBER, "A", F, cid))["can"] == {"funding.read": True, "funding.edit": True, "funding.assess": True, "funding.review": False,
                                                              "funding.export": True, "business.membership.manage": False}
    with pytest.raises(Forbidden):                                        # a member who can't approve can't attest evidence
        run(svc.attest(MEMBER, "A", F, cid, "C4.B", True, "Looks fine"))
    assert run(svc.request_assessment(MEMBER, "A", F, cid))["execution_status"] == "succeeded"
    env.businesses["A"]["members"][MEMBER] = {"permission_type": "module", "permissions": {"modules": ["catalogue"]}}      # view only
    assert run(svc.get_subject(MEMBER, "A", F, cid))["can"]["funding.edit"] is False
    for call in (svc.request_assessment(MEMBER, "A", F, cid), svc.generate_material(MEMBER, "A", F, cid, "readiness_report")):
        with pytest.raises(Forbidden):
            run(call)
    del env.businesses["A"]["members"][MEMBER]                            # access revoked
    with pytest.raises(Denied):
        run(svc.get_subject(MEMBER, "A", F, cid))


def test_actions_are_ranked_deduplicated_and_closed_only_by_reassessment():
    env = Env()
    svc, cid = funding_case(env, demand=False, assumptions=False,
                            use_of_funds=[{"id": "u1", "category": "People", "amount": "90000", "purpose": "Team", "period": "2026-10"}])
    assess(svc, cid)
    assess(svc, cid)
    actions = run(svc.get_subject(OWNER, "A", F, cid))["actions"]
    assert [a["code"] for a in actions] == ["G2", "C4.A", "C4.B", "C3.B"]              # failed gate, missing evidence, then other gaps
    assert actions[0]["also"] == ["C2.A"]                                              # the gate and its check are one fix, so one action
    assert len({a["code"] for a in actions}) == len(actions)                           # two runs, no duplicates
    c3b = next(a for a in actions if a["code"] == "C3.B")
    with pytest.raises(Invalid):                                                       # ticking a box is not completion
        run(svc.update_action(OWNER, "A", F, cid, c3b["id"], {"status": "completed"}))
    done = run(svc.update_action(OWNER, "A", F, cid, c3b["id"], {"status": "completed", "rationale": "Assumptions are in the board pack"}))
    assert done["status"] == "completed" and "run again" in done["note"]
    r = assess(svc, cid)["result"]
    assert check(r, "C3.B")["state"] == "failed"                                       # readiness did not move
    reopened = next(a for a in run(svc.get_subject(OWNER, "A", F, cid))["actions"] if a["code"] == "C3.B")
    assert reopened["status"] == "open" and reopened["reopened_at"]
    # Fix the underlying record: the next check closes the action itself.
    case = run(svc.get_subject(OWNER, "A", F, cid))
    f = case["forecast"]
    run(svc.save_forecast(OWNER, "A", F, cid, {**f["data"], "assumptions": [{"applies_to": "receipts", "text": "x", "source": "y"}, {"applies_to": "payments", "text": "x", "source": "y"}]}, f["revision"]))
    assess(svc, cid)
    closed = next(a for a in run(svc.get_subject(OWNER, "A", F, cid))["actions"] if a["code"] == "C3.B")
    assert closed["status"] == "completed" and closed["completion"]["kind"] == "reassessment"


def test_materials_come_from_the_snapshot_name_their_gaps_and_are_never_rewritten():
    env = Env()
    svc, cid = funding_case(env, demand=False, attest=False, documents=False, market={"target_segment": "UK accountancy firms"})
    assess(svc, cid)
    summary = run(svc.generate_material(OWNER, "A", F, cid, "executive_summary"))
    text = summary["body"]
    assert "Gap: no customer or market evidence is attached. No customers or traction are claimed." in text
    assert "Gap: what sets the business apart is not described." in text and "(forecast)" in text
    assert summary["status"] == "draft" and summary["needs_review"] is False
    assert run(svc.get_subject(OWNER, "A", F, cid))["data"]["documents"]["executive_summary"]["artifact_id"] == summary["id"]
    pdf = run(svc.download_material(OWNER, "A", F, cid, summary["id"], "pdf"))
    assert pdf["content"][:4] == b"%PDF" and pdf["name"].endswith(".pdf")
    edited = run(svc.update_material(OWNER, "A", F, cid, summary["id"], body=text + "\nOur own words.", revision=summary["revision"]))
    assert edited["edited"] is True and run(svc.update_material(OWNER, "A", F, cid, summary["id"], reviewed=True))["status"] == "reviewed"
    # A changed target marks the draft as needing review; a new one supersedes it and the old one can no longer be edited.
    case = run(svc.get_subject(OWNER, "A", F, cid))
    run(svc.update_subject(OWNER, "A", F, cid, case["revision"], {"target_amount": "150000"}))
    assert run(svc.get_material(OWNER, "A", F, cid, summary["id"]))["needs_review"] is True
    assess(svc, cid)
    newer = run(svc.generate_material(OWNER, "A", F, cid, "executive_summary"))
    old = run(svc.get_material(OWNER, "A", F, cid, summary["id"]))
    assert (newer["version"], old["status"]) == (2, "superseded") and "Our own words." in old["body"]
    with pytest.raises(Conflict):
        run(svc.update_material(OWNER, "A", F, cid, summary["id"], body="rewrite"))
    outline = run(svc.generate_material(OWNER, "A", F, cid, "pitch_outline"))
    assert [s["heading"] for s in outline["content"]["sections"]][:2] == ["1. Customer and problem", "2. Traction"]
    report = run(svc.generate_material(OWNER, "A", F, cid, "readiness_report"))
    assert any(s["heading"] == "Method and limitations" for s in report["content"]["sections"])


def test_archived_cases_are_readable_but_need_reactivating_and_prefill_keeps_its_provenance():
    env = Env()
    env.businesses["A"]["data"]["validation"] = {"inputs": {"target_customer": "Small accountancy firms", "price_per_unit": 900, "variable_cost_per_unit": 200}}
    svc = service_for(env.orch)
    case = run(svc.create_subject(OWNER, "A", F, {"title": "Seed"}))
    assert case["data"]["economics"] == {"price": 900.0, "direct_cost": 200.0} and case["data"]["market"]["target_segment"] == "Small accountancy firms"
    assert case["data"]["provenance"]["economics.price"]["source"] == "Idea Validation" and case["data"]["provenance"]["currency"]["source"] == "Business settings"
    assert case["data"]["stage"] == "pre_revenue" and "target_amount" not in case["data"]            # an unknown amount is allowed
    edited = run(svc.update_subject(OWNER, "A", F, case["id"], case["revision"], {"economics": {"price": "950"}}))
    assert "economics.price" not in edited["data"]["provenance"] and "economics.direct_cost" in edited["data"]["provenance"]
    assert env.businesses["A"]["data"]["validation"]["inputs"]["price_per_unit"] == 900             # the business record is untouched
    run(svc.request_assessment(OWNER, "A", F, case["id"]))
    archived = run(svc.set_status(OWNER, "A", F, case["id"], "archive"))
    assert archived["status"] == "archived" and len(run(svc.history(OWNER, "A", F, case["id"]))) == 1
    for call in (svc.update_subject(OWNER, "A", F, case["id"], archived["revision"], {"purpose": "x"}), svc.request_assessment(OWNER, "A", F, case["id"])):
        with pytest.raises(Conflict):
            run(call)
    assert run(svc.set_status(OWNER, "A", F, case["id"], "reactivate"))["status"] == "active"
    second = run(svc.create_subject(OWNER, "A", F, {"title": "Bridge round"}))                      # several named cases per business
    assert {i["title"] for i in run(svc.list_subjects(OWNER, "A", F))["items"]} == {"Seed", "Bridge round"} and second["status"] == "draft"


def test_events_carry_scope_and_correlation_and_evidence_files_are_checked_on_download():
    env = Env()
    svc, cid = funding_case(env)
    assess(svc, cid)
    events = [e for e in env.store.events if e["type"] in ("FundingCaseChanged", "EvidenceUpdated", "AssessmentCompleted", "AssessmentInvalidated", "RecommendationCreated")]
    assert {"FundingCaseChanged", "EvidenceUpdated", "AssessmentCompleted"} <= {e["type"] for e in events}
    assert all(e["business_id"] == "A" and e["schema_version"] == 1 and e["id"] and e["correlation_id"] for e in events)
    e = evidence(env, svc, cid, "C4.A", title="Signed letter of intent", type="letter_of_intent")
    with pytest.raises(Invalid):
        run(svc.attach_file(OWNER, "A", e["id"], "virus.exe", "application/x-msdownload", b"MZ"))
    run(svc.attach_file(OWNER, "A", e["id"], "loi.pdf", "application/pdf", b"%PDF-1.4 test"))
    assert run(svc.download_file(OWNER, "A", e["id"]))["content"] == b"%PDF-1.4 test"
    env.businesses["A"]["members"][MEMBER] = {"permission_type": "module", "permissions": {"modules": ["catalogue"]}}
    with pytest.raises(Forbidden):                     # seeing the business is not access to its confidential attachments
        run(svc.download_file(MEMBER, "A", e["id"]))
    assert any(ev["type"] == "AssessmentInvalidated" for ev in env.store.events)


# ══ Launch Readiness ══════════════════════════════════════════════════════════

LAUNCH_DATA = {
    "name": "Bookkeeping service launch", "launch_type": "initial_business", "geography": "UK", "audience": "Small practices",
    "planned_volume": {"amount": "30", "unit": "hours"},
    "customers": {"target_segment": "UK accountancy firms with 5-20 staff", "problem": "Month-end takes too long"},
    "offer": {"launch_scope": "Monthly bookkeeping package", "price": "600", "delivery_terms": "Monthly, 30 days notice",
              "customer_promise": "Books closed by day 5", "confirmed": True},
    "economics": {"price_per_unit": "100", "variable_cost_per_unit": "40", "fixed_costs_monthly": "1000"},
    "delivery": {"capacity_available": "100", "capacity_committed": "20", "capacity_unit": "hours",
                 "dependencies": [{"name": "Accounting software", "kind": "system", "available": "yes", "needs_contingency": False}]},
    "operations": {"process": "Enquiry, proposal, onboarding, monthly close, invoice", "process_version": "1",
                   "dry_run": {"outcome": "passed", "notes": "Ran one client end to end"}},
    "market": {"channel": "Partner referrals", "audience": "Practice owners", "message": "Close your books by day 5",
               "owner": "Ben", "budget": "500", "target": "10 enquiries in month one"},
    "control": {"milestones": [{"id": "m1", "outcome": "Website live", "owner": "Ada"}, {"id": "m2", "outcome": "First client onboarded", "owner": "Ben", "depends_on": ["m1"]}],
                "success_measures": "5 clients by month three", "incident_response": "Ada handles delivery failures within one working day"},
}


def launch(env, *, forecast=True, demand=True, attest=True, prerequisite="completed", **over):
    svc = service_for(env.orch)
    data = copy.deepcopy(LAUNCH_DATA)
    data["target_date"] = day(env, 60)
    data["operations"]["dry_run"]["date"] = day(env, -3)
    data["control"]["review_date"] = day(env, 150)
    for i, m in enumerate(data["control"]["milestones"]):
        m["due_date"] = day(env, 20 + 20 * i)
    permit = evidence(env, svc, None, None, title="Professional indemnity insurance certificate", type="permission")
    if prerequisite:
        data["prerequisites"] = [{"id": "p1", "name": "Professional indemnity insurance", "applicable": "yes", "critical": True, "status": prerequisite,
                                  "evidence_id": permit["id"] if prerequisite == "completed" else None, "valid_until": day(env, 365), "required_by": day(env, 40)}]
    data.update(over)
    item = run(svc.create_subject(OWNER, "A", L, data))
    lid = item["id"]
    if forecast:
        f = {"opening_cash": "20000", "opening_cash_as_of": day(env), "months": months(env, 6, receipts="3000", payments="2500"),
             "commitments": [{"label": "Software licences", "amount": "1200", "month": fc.month_key((env.now.year, env.now.month)), "kind": "setup", "basis": "assumption"}]}
        if isinstance(forecast, dict):
            f.update(forecast)
        run(svc.save_forecast(OWNER, "A", L, lid, f))
    if demand:
        evidence(env, svc, lid, "C1.A", title="Customer research for the launch")
    if attest:
        if demand:
            run(svc.attest(OWNER, "A", L, lid, "C1.B", True, "Research covers the target segment; sample is small"))
        run(svc.attest(OWNER, "A", L, lid, "C2.B", True, "Margin of 60 per hour covers fixed costs at 17 hours"))
        run(svc.attest(OWNER, "A", L, lid, "C6.A", True, "Insurance is the only requirement we have identified"))
    return svc, lid


def test_lt01_everything_in_place_is_ready_and_nothing_launches_by_itself():
    env = Env()
    svc, lid = launch(env)
    a = assess(svc, lid, L)
    r = a["result"]
    assert [c["score"] for c in r["criteria"]] == [100] * 8, [(c["code"], [(x["code"], x["state"], x["reason"]) for x in c["checks"]]) for c in r["criteria"] if c["score"] != 100]
    assert all(g["state"] == "passed" for g in r["gates"]), [(g["code"], g["state"], g["reason"]) for g in r["gates"]]
    assert (r["score"], r["classification"], r["coverage"], r["gate_completeness"]) == (100.0, "ready", 100, 100)
    assert r["headline"] == "Prepared for the defined launch scope against this checklist."
    item = run(svc.get_subject(OWNER, "A", L, lid))
    assert item["status"] == "preparing" and "actual_launch" not in item["data"]              # ready is not launched
    assert item["summary"]["lifecycle_status"] == "preparing" and item["decisions"] == [d for d in item["decisions"] if d["kind"] == "attestation"]


def test_lt02_unknown_cash_gives_no_score_80_coverage_and_insufficient_evidence():
    env = Env()
    svc, lid = launch(env, forecast=False)
    r = assess(svc, lid, L)["result"]
    assert crit(r, "C3")["state"] == "unknown" and gate(r, "B1")["state"] == "unknown"
    assert (r["score"], r["coverage"], r["classification"], r["gate_completeness"]) == (None, 80, "insufficient_evidence", 80)
    assert r["known_points"] == 80.0


def test_lt03_a_cash_shortfall_blocks_a_launch_that_scores_90():
    env = Env()
    svc, lid = launch(env, forecast={"opening_cash": "5000", "months": months(env, 6, receipts="1000", payments="3000"),
                                     "commitments": [{"label": "Licences", "amount": "1200", "month": "2026-10"}]})      # no basis label: C3.B fails
    r = assess(svc, lid, L)["result"]
    assert check(r, "C3.A")["state"] == "passed" and check(r, "C3.B")["state"] == "failed"
    assert r["score"] == 90.0 and r["classification"] == "not_ready"
    b1 = gate(r, "B1")
    assert b1["state"] == "failed" and "December 2026".replace("December", "Dec") in b1["reason"] and b1["trigger"]["first_negative_month"] == "2026-12"
    assert b1["severity"] == "critical" and b1["remedy"] and b1["source"] == "Cash projection"
    assert r["gaps"][0]["code"] == "B1"


def test_lt04_a_missing_required_permission_blocks_even_with_other_evidence_unknown():
    env = Env()
    svc, lid = launch(env, forecast=False, prerequisite="not_completed")
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B3")["state"] == "failed" and "Professional indemnity insurance" in gate(r, "B3")["reason"]
    assert r["classification"] == "not_ready" and r["score"] is None
    assert {"C3.A", "C3.B"} <= {m["code"] for m in r["missing"]}
    b3 = next(g for g in r["gaps"] if g["code"] == "B3")
    assert b3["group"] == 1 and b3["due_date"] == day(env, 40)                               # its own required-by date, not an invented one


def test_lt05_uncommitted_funding_never_clears_the_baseline_gap():
    env = Env()
    proposed = [{"label": "Angel investment", "month": "2027-01", "amount": "50000", "status": "proposed"}]
    svc, lid = launch(env, forecast={"opening_cash": "5000", "months": months(env, 6, receipts="1000", payments="3000"), "financing_items": proposed})
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B1")["state"] == "failed" and "not committed is not counted" in gate(r, "B1")["reason"]
    assert r["metrics"]["forecast"]["excluded_financing"][0]["reason"] == "It is proposed, not committed, so it is not counted as cash."
    assert any(x["code"] == "uncommitted_financing" for x in r["risks"])
    # "Committed" without evidence is still not cash; with dated evidence it is counted.
    item = run(svc.get_subject(OWNER, "A", L, lid))
    f = item["forecast"]
    committed = [{**proposed[0], "status": "committed", "month": "2026-11"}]
    run(svc.save_forecast(OWNER, "A", L, lid, {**f["data"], "financing_items": committed}, f["revision"]))
    assert gate(assess(svc, lid, L)["result"], "B1")["state"] == "failed"
    letter = evidence(env, svc, None, None, title="Signed investment agreement", type="document")
    f = run(svc.get_subject(OWNER, "A", L, lid))["forecast"]
    run(svc.save_forecast(OWNER, "A", L, lid, {**f["data"], "financing_items": [{**committed[0], "evidence_id": letter["id"]}]}, f["revision"]))
    assert gate(assess(svc, lid, L)["result"], "B1")["state"] == "passed"
    # A scenario compares; it does not clear anything.
    out = run(svc.scenario(OWNER, "A", L, lid, {"kind": "lower_demand", "percent": 50}))
    assert out["saved"] is False and "never clears a blocker" in out["note"]


def test_lt06_existing_commitments_reduce_capacity_and_the_overload_is_stated():
    env = Env()
    svc, lid = launch(env, delivery={**LAUNCH_DATA["delivery"], "capacity_committed": "80"})
    r = assess(svc, lid, L)["result"]
    b2 = gate(r, "B2")
    assert b2["state"] == "failed" and b2["trigger"] == {"need": "30", "available": "100", "committed": "80", "free": "20", "overload": "10", "unit": "hours"}
    assert "10 hours short" in b2["reason"] and check(r, "C4.A")["state"] == "failed" and r["classification"] == "not_ready"


def test_lt07_a_pre_revenue_launch_shows_research_as_research_and_invents_no_history():
    env = Env()
    svc, lid = launch(env)
    r = assess(svc, lid, L)["result"]
    assert [(e["type"], e["strength"]) for e in r["evidence_used"]] == [("research", "indicative")]
    codes = {x["code"] for x in r["risks"]}
    assert {"pre_revenue", "indicative_demand"} <= codes
    assert "stability" not in r["metrics"] and "revenue_history" not in r["metrics"]
    assert r["metrics"]["economics"]["note"].endswith("It is not a number of months.")


def test_lt08_a_changed_price_or_process_makes_the_review_and_the_test_run_stale():
    env = Env()
    svc, lid = launch(env)
    first = assess(svc, lid, L)
    item = run(svc.get_subject(OWNER, "A", L, lid))
    changed = run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"economics": {"price_per_unit": "90"}, "operations": {"process_version": "2"}}))
    assert changed["summary"]["freshness"] == "stale" and changed["assessment"]["id"] == first["id"]
    r = assess(svc, lid, L)["result"]
    assert check(r, "C2.B")["state"] == "unknown" and check(r, "C2.B")["stale"] and "changed" in check(r, "C2.B")["reason"]
    assert check(r, "C5.B")["state"] == "unknown" and gate(r, "B4")["state"] == "unknown" and "process changed" in gate(r, "B4")["reason"]
    assert r["classification"] == "insufficient_evidence" and {s["code"] for s in r["stale_checks"]} == {"C2.B", "C5.B"}
    # Figures that are simply old need confirming again.
    svc2, lid2 = launch(env, name="Second launch")
    env.now += timedelta(days=40)
    r2 = assess(svc2, lid2, L)["result"]
    assert check(r2, "C4.A")["stale"] and gate(r2, "B5")["stale"] and gate(r2, "B5")["state"] == "unknown"
    assert check(r2, "C3.A")["state"] == "unknown"                       # the projection no longer covers the months it must


def test_lt09_marking_a_blocker_action_complete_does_not_clear_the_blocker():
    env = Env()
    svc, lid = launch(env, prerequisite="not_completed")
    assess(svc, lid, L)
    action = next(a for a in run(svc.get_subject(OWNER, "A", L, lid))["actions"] if a["code"] == "B3")
    with pytest.raises(Invalid):
        run(svc.update_action(OWNER, "A", L, lid, action["id"], {"status": "completed"}))
    run(svc.update_action(OWNER, "A", L, lid, action["id"], {"status": "completed", "rationale": "Broker says it is in hand"}))
    assert run(svc.get_subject(OWNER, "A", L, lid))["summary"]["blocker_count"] == 1          # nothing moved without a new check
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B3")["state"] == "failed" and r["classification"] == "not_ready"
    assert next(a for a in run(svc.get_subject(OWNER, "A", L, lid))["actions"] if a["code"] == "B3")["status"] == "open"


def test_lt10_moving_the_launch_past_a_permissions_validity_is_caught():
    env = Env()
    svc, lid = launch(env)
    assert assess(svc, lid, L)["result"]["classification"] == "ready"
    item = run(svc.get_subject(OWNER, "A", L, lid))
    moved = run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"target_date": day(env, 400)}))
    assert any(d["label"] == "Professional indemnity insurance" and "validity ends before" in d["issue"] for d in moved["date_review"])
    assert moved["data"]["control"]["milestones"][0]["due_date"] == day(env, 20)             # dates set by hand are listed, not rewritten
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B3")["state"] == "failed" and "before the launch date" in gate(r, "B3")["reason"]
    assert check(r, "C6.B")["state"] == "failed"


def test_lt11_a_launch_scenario_changes_nothing_and_names_its_formula():
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, L)
    before = (copy.deepcopy(env.businesses["A"]["data"]), copy.deepcopy(svc.store.rows))
    for change, words in (({"kind": "lower_demand", "percent": 40}, "40% lower"), ({"kind": "higher_costs", "percent": 25}, "25% higher"),
                          ({"kind": "launch_delay", "months": 2}, "2 months later")):
        out = run(svc.scenario(OWNER, "A", L, lid, change))
        assert out["saved"] is False and out["formula_version"] == "scenario-0.1" and words in out["assumption_changes"][0]
        assert out["baseline"]["formula_version"] == fc.FORMULA_VERSION and out["scenario"]["state"] == "complete"
    assert (env.businesses["A"]["data"], svc.store.rows) == before
    delay = run(svc.scenario(OWNER, "A", L, lid, {"kind": "launch_delay", "months": 2}))
    assert float(delay["comparison"]["min_cash"]["scenario"]["amount"]) < float(delay["comparison"]["min_cash"]["baseline"]["amount"]) + 3000
    with pytest.raises(Invalid):
        run(svc.scenario(OWNER, "A", L, lid, {"kind": "price_war"}))


def test_lt12_no_cross_business_access_through_detail_jobs_exports_or_aggregates():
    env = Env()
    svc, lid = launch(env)
    a = assess(svc, lid, L)
    other = run(svc.create_subject(OUTSIDER, "B", L, {"name": "B's launch"}))
    for call in (svc.get_subject(OUTSIDER, "A", L, lid), svc.record_decision(OUTSIDER, "A", lid, decision="proceed")):
        with pytest.raises(Denied):
            run(call)
    for call in (svc.get_subject(OWNER, "A", L, other["id"]), svc.get_assessment(OWNER, "A", L, other["id"], a["id"]),
                 svc.get_assessment(OUTSIDER, "B", L, other["id"], a["id"]),                 # A's assessment id under B's launch
                 svc.scenario(OWNER, "A", L, other["id"], {"kind": "lower_demand", "percent": 10}),
                 svc.get_subject(OWNER, "A", F, lid)):                                      # a launch is not a funding case
        with pytest.raises(NotFound):
            run(call)
    with pytest.raises(Invalid):                                                            # another business's launch as "previous"
        run(svc.create_subject(OWNER, "A", L, {"name": "v2", "previous_initiative_id": other["id"]}))
    mine = run(svc.dashboard_summaries("A", env.businesses["A"]["data"], run(env.orch.rt.business.actor(OWNER, "A", {})), env.now))
    assert mine["launch"]["initiative_id"] == lid and mine["launch"]["others"] == 0


def test_lt13_duplicate_requests_are_one_run_and_never_duplicate_actions():
    env = Env()
    svc, lid = launch(env, forecast=False)
    a = assess(svc, lid, L, idempotency_key="same")
    b = assess(svc, lid, L, idempotency_key="same")
    assess(svc, lid, L)
    assert a["id"] == b["id"] and len(run(svc.history(OWNER, "A", L, lid))) == 2
    codes = [x["code"] for x in run(svc.get_subject(OWNER, "A", L, lid))["actions"]]
    assert len(codes) == len(set(codes)) and {"C3.A", "C3.B"} <= set(codes)
    assert len([e for e in env.store.events if e["type"] == "AssessmentCompleted"]) == 2


def test_lt14_an_actual_launch_can_be_recorded_with_open_blockers_once_acknowledged():
    env = Env()
    svc, lid = launch(env, prerequisite="not_completed")
    a = assess(svc, lid, L)
    stage_before = copy.deepcopy(env.businesses["A"]["data"])
    with pytest.raises(Conflict) as e:
        run(svc.record_launch(OWNER, "A", lid, actual_date=day(env)))
    assert e.value.code == "acknowledgement_required" and e.value.current["open_risks"]["blockers"][0]["code"] == "B3"
    with pytest.raises(Invalid):
        run(svc.record_launch(OWNER, "A", lid, actual_date=day(env, 3), acknowledge=True))      # it hasn't happened yet
    done = run(svc.record_launch(OWNER, "A", lid, actual_date=day(env), scope="Two pilot clients", acknowledge=True))
    assert done["status"] == "launched" and done["data"]["actual_launch"]["acknowledged"] is True
    assert done["data"]["actual_launch"]["blockers"][0]["code"] == "B3"                          # recorded as acknowledged, not as resolved
    kept = run(svc.get_assessment(OWNER, "A", L, lid, a["id"]))
    assert kept["result"] == a["result"] and kept["result"]["classification"] == "not_ready"
    assert any(x["code"] == "post_launch_review" and x["due_date"] == day(env, 150) for x in done["actions"])
    assert env.businesses["A"]["data"] == stage_before                                           # the business's stage and records are untouched
    assert [d["kind"] for d in done["decisions"] if d["kind"] != "attestation"] == ["actual_launch"]
    assert any(ev["type"] == "LaunchRecorded" for ev in env.store.events)


def test_lt15_a_failed_report_leaves_the_findings_and_actions_usable(monkeypatch):
    env = Env()
    svc, lid = launch(env, forecast=False)
    a = assess(svc, lid, L)

    def broken(*_a, **_k):
        raise RuntimeError("document service down")
    monkeypatch.setattr(materials, "build", broken)
    with pytest.raises(RuntimeError):
        run(svc.generate_material(OWNER, "A", L, lid, "readiness_report"))
    item = run(svc.get_subject(OWNER, "A", L, lid))
    assert item["assessment"]["result"] == a["result"] and item["actions"] and run(svc.list_materials(OWNER, "A", L, lid))["items"] == []
    monkeypatch.undo()
    checklist = run(svc.generate_material(OWNER, "A", L, lid, "launch_checklist"))               # the retry makes one document
    assert "[?] The required cash projection is complete and reconciled" in checklist["body"]
    assert "It is not a complete list of legal requirements." in checklist["body"]


def test_lt16_a_dependency_cycle_is_rejected_with_a_clear_message():
    env = Env()
    svc, lid = launch(env)
    item = run(svc.get_subject(OWNER, "A", L, lid))
    looped = copy.deepcopy(item["data"]["control"]["milestones"])
    looped[0]["depends_on"] = ["m2"]                                                            # m1 -> m2 -> m1
    with pytest.raises(Invalid) as e:
        run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"control": {"milestones": looped}}))
    assert "depend on each other in a circle" in e.value.errors["control.milestones"]
    assert run(svc.get_subject(OWNER, "A", L, lid))["revision"] == item["revision"]              # nothing was saved
    # A successor can be prepared, but not marked done before what it depends on.
    early = copy.deepcopy(item["data"]["control"]["milestones"])
    early[1]["status"] = "done"
    with pytest.raises(Invalid) as e:
        run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"control": {"milestones": early}}))
    assert "until 'Website live' is done" in e.value.errors["control.milestones.1.status"]
    assert engine.dependency_cycle([{"id": "a", "depends_on": ["a"]}]) == ["a", "a"]


# ── launch boundaries ─────────────────────────────────────────────────────────

def test_an_unknown_blocker_with_full_criterion_coverage_gives_no_score():
    env = Env()
    svc, lid = launch(env, prerequisites=[
        {"id": "p1", "name": "Insurance", "applicable": "yes", "critical": True},                                  # required, status not known
        {"id": "p2", "name": "Trade body membership", "applicable": "yes", "critical": False, "status": "not_completed"}])
    run(svc.attest(OWNER, "A", L, lid, "C6.A", True, "Reviewed the list"))
    r = assess(svc, lid, L)["result"]
    assert r["coverage"] == 100 and gate(r, "B3")["state"] == "unknown"
    assert (r["score"], r["classification"], r["gate_completeness"]) == (None, "insufficient_evidence", 80)


def test_capacity_edge_cases_zero_demand_zero_capacity_and_mixed_units():
    cap = lambda **d: engine.capacity_of({"planned_volume": {"amount": d.get("need"), "unit": d.get("unit", "hours")},
                                          "delivery": {"capacity_available": d.get("avail"), "capacity_committed": d.get("used"), "capacity_unit": "hours",
                                                       "capacity_per_unit": d.get("per")}})
    for nothing in ("0", None, ""):                                                            # no planned volume: nothing to test capacity against
        assert cap(need=nothing, avail="100", used="0") == {"state": "unknown", "unit": "hours", "reason": "Enter how many you plan to deliver each month."}
    assert cap(need="5", avail="0", used="0")["overload"] == "5"                               # zero capacity cannot hide an overload
    mixed = cap(need="5", avail="100", used="0", unit="customers")
    assert mixed["state"] == "unknown" and "customers" in mixed["reason"] and "hours" in mixed["reason"]
    assert cap(need="5", avail="100", used="0", unit="customers", per="12")["need"] == "60"
    assert cap(need="5", avail=None, used="0")["state"] == "unknown"
    env = Env()
    svc, lid = launch(env, planned_volume={"amount": "0", "unit": "hours"})
    r = assess(svc, lid, L)["result"]
    assert check(r, "C4.A")["state"] == "unknown" and check(r, "C4.A")["reason"] == "Enter how many you plan to deliver each month."
    assert gate(r, "B2")["state"] == "unknown" and (r["classification"], r["score"]) == ("insufficient_evidence", None)
    svc, lid = launch(env, name="No capacity", delivery={**LAUNCH_DATA["delivery"], "capacity_available": "0", "capacity_committed": "0"})
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B2")["state"] == "failed" and gate(r, "B2")["trigger"]["overload"] == "30" and r["classification"] == "not_ready"


def test_zero_or_negative_contribution_is_a_blocker_and_a_separate_commercial_risk():
    env = Env()
    svc, lid = launch(env, attest=False, economics={"price_per_unit": "40", "variable_cost_per_unit": "40", "fixed_costs_monthly": "1000"})
    r = assess(svc, lid, L)["result"]
    assert gate(r, "B5")["state"] == "failed" and r["classification"] == "not_ready"
    assert any(x["code"] == "non_positive_contribution" for x in r["risks"])
    assert r["metrics"]["economics"]["break_even_state"] == "unreachable" and r["metrics"]["economics"]["break_even_units_per_month"] is None


def test_unsupported_launch_profiles_are_unavailable_and_invalid_dates_are_field_errors():
    env = Env()
    svc = service_for(env.orch)
    for data, words in (({"scope": "pilot"}, "limited pilots"), ({"launch_type": "new_market"}, "new market"), ({"business_model": "product"}, "stock-holding")):
        with pytest.raises(Unavailable) as e:
            run(svc.create_subject(OWNER, "A", L, {"name": "X", **data}))
        assert words in str(e.value)
    for bad, field in (({"target_date": "2026-13-45"}, "target_date"), ({"prerequisites": [{"name": "P", "valid_until": "never"}]}, "prerequisites.0.valid_until"),
                       ({"planned_volume": {"amount": "-3"}}, "planned_volume.amount")):
        with pytest.raises(Invalid) as e:
            run(svc.create_subject(OWNER, "A", L, {"name": "X", **bad}))
        assert field in e.value.errors
    unavailable = [u["id"] for u in svc.profiles(L)["unavailable"]]
    assert unavailable == ["launch.pilot", "launch.new_market", "launch.physical_product"]


def test_decisions_record_intent_and_the_lifecycle_keeps_its_history():
    env = Env()
    svc, lid = launch(env)
    a = assess(svc, lid, L)
    with pytest.raises(Forbidden):                                        # a member who can't approve can't record a launch decision
        run(svc.record_decision(MEMBER, "A", lid, decision="proceed"))
    go = run(svc.record_decision(OWNER, "A", lid, decision="proceed", rationale="Ready", assessment_id=a["id"]))
    assert go["status"] == "preparing" and "actual_launch" not in go["data"]
    deferred = run(svc.record_decision(OWNER, "A", lid, decision="defer", new_target_date=day(env, 90), rationale="Waiting for the second hire"))
    assert deferred["status"] == "preparing" and deferred["data"]["target_date"] == day(env, 90)
    decisions = [d for d in deferred["decisions"] if d["kind"] == "decision"]
    assert [d["decision"] for d in decisions] == ["defer", "proceed"] and decisions[0]["previous_target_date"] == day(env, 60)
    assert decisions[1]["classification"] == "ready" and decisions[1]["assessment_id"] == a["id"]
    cancelled = run(svc.record_decision(OWNER, "A", lid, decision="cancel", rationale="Market moved"))
    assert cancelled["status"] == "cancelled"
    with pytest.raises(Conflict):
        run(svc.request_assessment(OWNER, "A", L, lid))
    reopened = run(svc.set_status(OWNER, "A", L, lid, "reopen", reason="Client asked again"))
    assert reopened["status"] == "preparing" and any(d["kind"] == "reopen" for d in reopened["decisions"])
    archived = run(svc.set_status(OWNER, "A", L, lid, "archive"))
    assert archived["status"] == "archived" and run(svc.set_status(OWNER, "A", L, lid, "reactivate"))["status"] == "preparing"
    assert len(run(svc.history(OWNER, "A", L, lid))) == 1
    v2 = run(svc.create_subject(OWNER, "A", L, {"name": "Bookkeeping v2", "previous_initiative_id": lid}))
    assert v2["data"]["previous_initiative_id"] == lid


def test_funding_and_launch_share_one_forecast_but_own_their_results():
    env = Env()
    svc, cid = funding_case(env)
    _, lid = launch(env, forecast=False)
    case = run(svc.get_subject(OWNER, "A", F, cid))
    linked = run(svc.link_forecast(OWNER, "A", L, lid, case["forecast"]["id"]))
    assert linked["forecast"]["id"] == case["forecast"]["id"]
    assert assess(svc, cid)["result"]["classification"] == "ready"
    r = assess(svc, lid, L)["result"]
    assert check(r, "C3.A")["state"] == "passed" and gate(r, "B1")["state"] == "passed"      # a good funding result is not what clears it: the cash is
    assert check(r, "C3.B")["state"] == "unknown"                                            # the launch still needs its own commitments
    f = run(svc.get_subject(OWNER, "A", F, cid))["forecast"]
    run(svc.save_forecast(OWNER, "A", F, cid, {**f["data"], "opening_cash": "100"}, f["revision"]))
    assert run(svc.get_subject(OWNER, "A", L, lid))["summary"]["freshness"] == "stale"       # the shared forecast changed: both are stale
    assert [x["used_by"] for x in run(svc.list_forecasts(OWNER, "A"))] == [["Bookkeeping service launch", "Seed round"]] or \
           sorted(run(svc.list_forecasts(OWNER, "A"))[0]["used_by"]) == ["Bookkeeping service launch", "Seed round"]


def test_the_same_inputs_and_ruleset_always_give_the_same_result():
    env = Env()
    svc, lid = launch(env)
    a = assess(svc, lid, L)
    b = assess(svc, lid, L)
    assert a["id"] != b["id"] and a["result"] == b["result"]
    snap = run(svc.get_assessment(OWNER, "A", L, lid, a["id"]))["snapshot"]
    assert engine.assess(L, snap, rules.get_profile(a["profile"]), env.now.date()) == a["result"]


def test_section_progress_is_separate_from_readiness_and_the_default_launch_is_the_nearest():
    env = Env()
    svc = service_for(env.orch)
    later = run(svc.create_subject(OWNER, "A", L, {"name": "Later", "target_date": day(env, 200)}))
    run(svc.create_subject(OWNER, "A", L, {"name": "Undated"}))
    soon = run(svc.create_subject(OWNER, "A", L, {"name": "Soon", "target_date": day(env, 30)}))
    sections = {s["key"]: s for s in soon["sections"]}
    assert list(sections) == ["customers", "economics", "cash", "delivery", "operations", "sales"] and sections["cash"] == {"key": "cash", "title": "Cash", "answered": 0, "total": 1}
    assert soon["assessment"] is None and soon["summary"]["classification"] is None and soon["summary"]["score"] is None
    actor = run(env.orch.rt.business.actor(OWNER, "A", {}))
    picked = run(svc.dashboard_summaries("A", env.businesses["A"]["data"], actor, env.now))["launch"]
    assert (picked["title"], picked["others"], picked["selection"]) == ("Soon", 2, "Your launch with the nearest date.")
    run(svc.update_subject(OWNER, "A", L, later["id"], later["revision"], {"pinned": True}))
    assert run(svc.dashboard_summaries("A", env.businesses["A"]["data"], actor, env.now))["launch"]["title"] == "Later"
    contract = {"business_id", "initiative_id", "launch_type", "scope", "target_date", "lifecycle_status", "assessment_id", "profile_version", "classification",
                "score", "evidence_coverage", "gate_completeness", "confidence", "freshness", "blocker_count", "next_action_id"}
    assert contract <= set(picked)


# ══ API ═══════════════════════════════════════════════════════════════════════

@pytest.fixture
def http(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = {"id": OWNER, "email": OWNER}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    yield env, TestClient(app, raise_server_exceptions=False), who
    app.dependency_overrides.pop(get_current_user, None)


def test_the_api_covers_the_journey_and_maps_errors(http):
    env, client, who = http
    made = client.post("/businesses/A/funding-cases", json={"data": {"title": "Seed", "target_amount": "100000", "currency": "GBP"}})
    assert made.status_code == 201
    cid, revision = made.json()["id"], made.json()["revision"]
    assert client.get("/businesses/A/funding-cases").json()["items"][0]["title"] == "Seed"
    bad = client.patch(f"/businesses/A/funding-cases/{cid}", json={"revision": revision, "changes": {"receipt_date": "not a date"}})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"] == {"receipt_date": "Enter a valid date."}
    ok = client.patch(f"/businesses/A/funding-cases/{cid}", json={"revision": revision, "changes": {"receipt_date": day(env, 60), "timing_confirmed": True}})
    assert ok.status_code == 200
    stale = client.patch(f"/businesses/A/funding-cases/{cid}", json={"revision": revision, "changes": {"purpose": "x"}})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_revision" and stale.json()["detail"]["current"]["revision"] == revision + 1
    saved = client.put(f"/businesses/A/funding-cases/{cid}/forecast", json={"forecast": {"opening_cash": "5000", "opening_cash_as_of": day(env), "months": months(env, 12)}})
    assert saved.status_code == 200 and saved.json()["forecast"]["computed"]["state"] == "complete"
    started = client.post(f"/businesses/A/funding-cases/{cid}/assessments", json={"idempotency_key": "one"})
    assert started.status_code == 202 and started.json()["execution_status"] == "succeeded"
    assert started.json()["result"]["classification"] == "insufficient_evidence" and gate(started.json()["result"], "G1")["state"] == "passed"
    assert client.post(f"/businesses/A/funding-cases/{cid}/assessments", json={"idempotency_key": "one"}).json()["id"] == started.json()["id"]
    assert len(client.get(f"/businesses/A/funding-cases/{cid}/assessments").json()["items"]) == 1
    doc = client.post(f"/businesses/A/funding-cases/{cid}/materials", json={"kind": "readiness_report"})
    assert doc.status_code == 201
    pdf = client.get(f"/businesses/A/funding-cases/{cid}/materials/{doc.json()['id']}/download")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:4] == b"%PDF"
    assert client.post("/businesses/A/funding-cases", json={"data": {"title": "Loan", "route": "debt"}}).json()["detail"]["code"] == "unavailable"
    assert client.get(f"/businesses/A/funding-cases/not-a-uuid").status_code == 404
    assert client.post(f"/businesses/A/launch-initiatives/{cid}/decisions", json={"decision": "proceed"}).status_code == 404      # a case is not a launch
    profiles = client.get("/readiness/profiles").json()
    assert profiles["funding"]["current"]["key"] == "funding.equity.uk_service_software@0.1" and [u["route"] for u in profiles["funding"]["unavailable"]] == ["debt", "grant"]
    who.update({"id": OUTSIDER, "email": OUTSIDER})
    for path in (f"/businesses/A/funding-cases/{cid}", "/businesses/A/funding-cases", "/businesses/A/evidence", f"/businesses/A/funding-cases/{cid}/assessments"):
        assert client.get(path).status_code == 404, path
    assert client.get(f"/businesses/B/funding-cases/{cid}").status_code == 404


def test_each_feature_flag_closes_its_entry_points_and_keeps_the_data(http, monkeypatch):
    env, client, _ = http
    from app.core.config import get_settings
    cid = client.post("/businesses/A/funding-cases", json={"data": {"title": "Seed"}}).json()["id"]
    monkeypatch.setattr(get_settings(), "funding_readiness_enabled", False)
    assert client.get("/businesses/A/funding-cases").json() == {"enabled": False, "items": []}
    assert client.get(f"/businesses/A/funding-cases/{cid}").status_code == 404
    assert client.post("/businesses/A/funding-cases", json={"data": {"title": "x"}}).status_code == 404
    assert client.post("/businesses/A/launch-initiatives", json={"data": {"name": "Launch"}}).status_code == 201      # the other feature is unaffected
    monkeypatch.setattr(get_settings(), "funding_readiness_enabled", True)
    assert client.get(f"/businesses/A/funding-cases/{cid}").json()["title"] == "Seed"                                  # the draft was kept


# ══ Dashboard: presents the summaries, never recalculates ═════════════════════

def _dashboard(env, user=OWNER, business="A"):
    from app.modules.agent import dashboard as dash
    return run(dash.build_dashboard(env.orch, user, business))


def _card(d, key):
    return next((c for c in d["insights"] if c["key"] == key), None)


def test_the_dashboard_shows_the_selected_launch_and_funding_case_from_their_checks():
    env = Env()
    before = _dashboard(env)
    assert before["launch_check"] is None and before["funding_readiness"] is None and before["readiness_features"] == {"funding": True, "launch": True}
    assert "still missing before launch" in _card(before, "blocker")["text"]                    # no launch yet: the records-based card is unchanged
    assert next(c for c in before["action_cards"] if c["key"] == "funding_readiness")["href"] == "/funding"

    svc, lid = launch(env, prerequisite="not_completed")
    waiting = _dashboard(env)
    assert _card(waiting, "blocker")["state"] == "insufficient_data" and "hasn’t been checked yet" in _card(waiting, "blocker")["text"]
    assert waiting["launch_check"]["classification"] is None and waiting["launch_check"]["score"] is None      # pending is not a zero score
    a = assess(svc, lid, L)
    d = _dashboard(env)
    blocker = _card(d, "blocker")
    assert blocker["text"].startswith("1 blocker for “Bookkeeping service launch”") and blocker["cta"] == {"label": "See the check", "to": f"/launch/{lid}"}
    assert blocker["severity"] == "high" and blocker["why"]["source"] == "Launch Readiness Check"
    assert d["launch_check"]["assessment_id"] == a["id"] and d["launch_check"]["blocker_count"] == 1 and d["launch_check"]["freshness"] == "current"
    kpi = next(k for k in d["kpis"] if k["key"] == "launch_readiness")
    assert (kpi["value"], kpi["hint"], kpi["to"]) == ("Not ready", "100% of evidence in place · 1 blocker", "/launch")
    assert d["context"]["headline"]["value"] == "Not ready"

    _, cid = funding_case(env, demand=False)
    unchecked = _card(_dashboard(env), "funding_gaps")
    assert unchecked["state"] == "insufficient_data" and unchecked["cta"]["to"] == f"/funding/{cid}"
    assess(svc, cid)
    d = _dashboard(env)
    gaps = _card(d, "funding_gaps")
    assert "can’t be assessed yet" in gaps["text"] and "Next: Attach at least one dated piece of customer or market evidence." in gaps["text"]
    contract = {"business_id", "case_id", "assessment_id", "profile_version", "classification", "score", "coverage", "confidence", "freshness",
                "blocker_count", "next_action_id"}
    assert contract <= set(d["funding_readiness"]) and d["funding_readiness"]["score"] is None and d["funding_readiness"]["coverage"] == 85
    # A change makes the card say the result is out of date; nothing is recalculated on the dashboard.
    item = run(svc.get_subject(OWNER, "A", L, lid))
    run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"audience": "Practice managers"}))
    stale = _card(_dashboard(env), "blocker")
    assert stale["state"] == "stale" and stale["text"].endswith("This result is out of date.")
    assert any(e["label"] == "Out of date because" and "The details changed." in e["value"] for e in stale["why"]["evidence"])


def test_dashboard_summaries_respect_flags_scope_and_failures(monkeypatch):
    from app.core.config import get_settings
    from app.modules.agent.orchestrator import AccessDenied
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, L)
    with pytest.raises(AccessDenied):
        _dashboard(env, OUTSIDER, "A")
    assert _dashboard(env, OUTSIDER, "B")["launch_check"] is None                                # B sees nothing of A's launch
    monkeypatch.setattr(get_settings(), "launch_readiness_enabled", False)
    off = _dashboard(env)
    assert off["launch_check"] is None and off["readiness_features"]["launch"] is False and "still missing before launch" in _card(off, "blocker")["text"]
    monkeypatch.setattr(get_settings(), "launch_readiness_enabled", True)

    async def boom(*_a, **_k):
        raise RuntimeError("store down")
    monkeypatch.setattr(svc, "dashboard_summaries", boom)
    down = _dashboard(env)                                                                       # the dashboard still loads
    assert down["launch_check"] is None and _card(down, "blocker") is not None


# ══ QA round 2 ════════════════════════════════════════════════════════════════

def test_f1_the_forecast_editor_and_the_check_agree_on_committed_financing():
    env = Env()
    svc, lid = launch(env, forecast={"opening_cash": "1000", "months": months(env, 6, receipts="1000", payments="3300")})
    agreement = evidence(env, svc, None, None, title="Signed loan agreement", type="document")
    letter = evidence(env, svc, None, None, title="Letter of intent from an investor", type="letter_of_intent")

    def both(evidence_id):
        f = run(svc.get_subject(OWNER, "A", L, lid))["forecast"]
        item = {"label": "Bank loan", "month": "2026-10", "amount": "30000", "status": "committed", "evidence_id": evidence_id}
        shown = run(svc.save_forecast(OWNER, "A", L, lid, {**f["data"], "financing_items": [item]}, f["revision"]))["forecast"]["computed"]
        assessed = assess(svc, lid, L)["result"]
        scenario = run(svc.scenario(OWNER, "A", L, lid, {"kind": "higher_costs", "percent": 1}))["baseline"]
        return shown, assessed, scenario

    shown, assessed, scenario = both(agreement["id"])                       # a document: counted, everywhere
    assert shown["excluded_financing"] == [] and shown["months"][0]["financing"] == "30000.00" and shown["months"][0]["closing"] == "28700.00"
    assert assessed["metrics"]["forecast"]["months"] == shown["months"] == scenario["months"]
    assert shown["first_negative_month"] is None and gate(assessed, "B1")["state"] == "passed"

    shown, assessed, scenario = both(letter["id"])                          # a letter of intent is interest, not a commitment: left out, everywhere
    assert "letter of intent, which shows interest rather than a commitment" in shown["excluded_financing"][0]["reason"]
    assert shown["months"][0]["financing"] == "0.00" and shown["months"][0]["closing"] == "-1300.00"
    assert assessed["metrics"]["forecast"]["months"] == shown["months"] == scenario["months"]
    assert assessed["metrics"]["forecast"]["excluded_financing"] == shown["excluded_financing"]
    assert gate(assessed, "B1")["state"] == "failed" and assessed["classification"] == "not_ready"

    shown, assessed, _ = both(None)                                         # no evidence at all
    assert shown["excluded_financing"][0]["reason"] == fc.NO_FINANCING_EVIDENCE and gate(assessed, "B1")["state"] == "failed"
    assert fc.FINANCING_EVIDENCE_TYPES == ("document", "record", "other")


def test_f2_preparing_documents_never_makes_the_result_stale():
    env = Env()
    svc, cid = funding_case(env, documents=False)
    a = assess(svc, cid)
    revision = run(svc.get_subject(OWNER, "A", F, cid))["revision"]
    for kind in ("executive_summary", "pitch_outline", "readiness_report"):
        run(svc.generate_material(OWNER, "A", F, cid, kind))
        after = run(svc.get_subject(OWNER, "A", F, cid))
        assert after["assessment"]["id"] == a["id"] and after["assessment"]["freshness"] == {"status": "current", "reason": None, "as_of": a["as_of"]}, kind
        assert after["revision"] == revision and after["summary"]["freshness"] == "current"
    assert not [e for e in env.store.events if e["type"] == "AssessmentInvalidated" and e["payload"].get("reason") == "A document was prepared."]
    assert after["data"]["documents"]["executive_summary"]["artifact_id"]              # still offered as the case's summary
    run(svc.review_document(OWNER, "A", cid, "executive_summary", reviewed=True))     # the user's own review is a real change
    assert run(svc.get_subject(OWNER, "A", F, cid))["summary"]["freshness"] == "stale"
    _, lid = launch(env)
    b = assess(svc, lid, L)
    run(svc.generate_material(OWNER, "A", L, lid, "launch_checklist"))
    assert run(svc.get_subject(OWNER, "A", L, lid))["assessment"]["freshness"]["status"] == "current" and b["freshness"]["status"] == "current"


def test_f4_a_preparers_own_review_is_self_attested_whatever_was_ticked():
    env = Env()
    env.store.policies["A"]["member_can_approve"] = True
    svc, cid = funding_case(env, attest=False)
    own = run(svc.attest(OWNER, "A", F, cid, "C4.B", True, "Relevant to the segment", independent=True))
    assert own["data"]["attestations"]["C4.B"]["independent"] is False                # the owner created and filled in the case
    other = run(svc.attest(MEMBER, "A", F, cid, "C5.B", True, "I checked the break-even myself", independent=True))
    assert other["data"]["attestations"]["C5.B"]["independent"] is True               # a different authorised person who entered nothing
    r = assess(svc, cid)["result"]
    assert check(r, "C4.B")["attestation"]["independent"] is False and check(r, "C4.B")["reason"] == "Self-attested."
    assert check(r, "C5.B")["reason"] == "Confirmed by an independent reviewer." and r["confidence"]["level"] == "medium"
    case = run(svc.get_subject(MEMBER, "A", F, cid))
    run(svc.update_subject(MEMBER, "A", F, cid, case["revision"], {"economics": {"price": "1100"}}))      # now the member has entered data too
    again = run(svc.attest(MEMBER, "A", F, cid, "C5.B", True, "Re-checked", independent=True))
    assert again["data"]["attestations"]["C5.B"]["independent"] is False


def test_f5_a_gate_and_the_check_it_covers_are_one_action():
    env = Env()
    svc, cid = funding_case(env, use_of_funds=[{"id": "u1", "category": "People", "amount": "90000", "purpose": "Team", "period": "2026-10"}])
    r = assess(svc, cid)["result"]
    assert check(r, "C2.A")["state"] == "failed" and gate(r, "G2")["state"] == "failed"           # both still reported in the result
    assert [(g["code"], g["also"]) for g in r["gaps"]] == [("G2", ["C2.A"])]
    assert [(a["code"], a["also"]) for a in run(svc.get_subject(OWNER, "A", F, cid))["actions"]] == [("G2", ["C2.A"])]
    _, lid = launch(env, delivery={**LAUNCH_DATA["delivery"], "capacity_committed": "80"})
    r = assess(svc, lid, L)["result"]
    assert [(g["code"], g["also"]) for g in r["gaps"]] == [("B2", ["C4.A"])]
    # A check that fails on its own still gets its own action.
    _, lid2 = launch(env, name="Other", prerequisites=[{"id": "p", "name": "Membership", "applicable": "yes", "critical": False, "status": "not_completed"}])
    run(svc.attest(OWNER, "A", L, lid2, "C6.A", True, "Reviewed"))
    assert [(g["code"], g["also"]) for g in assess(svc, lid2, L)["result"]["gaps"]] == [("C6.B", [])]


def test_f6_unknown_fields_and_empty_document_requests_are_rejected(http):
    env, client, _ = http
    made = client.post("/businesses/A/funding-cases", json={"data": {"title": "Seed"}}).json()
    cid, revision = made["id"], made["revision"]
    bad = client.patch(f"/businesses/A/funding-cases/{cid}", json={"revision": revision, "changes": {"market.differentiation": "x", "colour": "blue", "purpose": "ok"}})
    assert bad.status_code == 422 and set(bad.json()["detail"]["errors"]) == {"market.differentiation", "colour"}
    assert "Unknown field: colour" in bad.json()["detail"]["message"]
    assert client.get(f"/businesses/A/funding-cases/{cid}").json()["revision"] == revision        # nothing was saved, not even the valid field
    assert client.post("/businesses/A/funding-cases", json={"data": {"title": "x", "nonsense": 1}}).status_code == 422
    lid = client.post("/businesses/A/launch-initiatives", json={"data": {"name": "Launch"}}).json()
    assert client.patch(f"/businesses/A/launch-initiatives/{lid['id']}", json={"revision": lid["revision"], "changes": {"offer.price": "5"}}).status_code == 422
    for body in ({}, None):
        empty = client.post(f"/businesses/A/funding-cases/{cid}/documents/team_summary", json=body) if body is not None else client.post(f"/businesses/A/funding-cases/{cid}/documents/team_summary")
        assert empty.status_code == 422 and "Say what to change" in empty.json()["detail"]["message"]
    assert client.get(f"/businesses/A/funding-cases/{cid}").json()["revision"] == revision
    assert client.post(f"/businesses/A/funding-cases/{cid}/documents/team_summary", json={"reviewed": True}).status_code == 200


def test_f7_drafts_name_the_checklist_by_title_and_version():
    env = Env()
    svc, cid = funding_case(env)
    assess(svc, cid)
    for kind in ("executive_summary", "pitch_outline", "readiness_report"):
        doc = run(svc.generate_material(OWNER, "A", F, cid, kind))
        assert doc["body"].rstrip().endswith("using the checklist Equity preparation, version 0.1. Figures are as they were on that date."), kind
        assert "funding.equity.uk_service_software" not in doc["body"] and "@0.1" not in doc["body"]
    _, lid = launch(env)
    assess(svc, lid, L)
    assert "using the checklist Commercial service launch, version 0.1." in run(svc.generate_material(OWNER, "A", L, lid, "launch_checklist"))["body"]


# ══ QA round 3 ════════════════════════════════════════════════════════════════

def test_n1_committed_capacity_cannot_exceed_what_is_available():
    env = Env()
    svc = service_for(env.orch)
    with pytest.raises(Invalid) as e:
        run(svc.create_subject(OWNER, "A", L, {"name": "X", "delivery": {"capacity_available": "50", "capacity_committed": "90"}}))
    assert e.value.errors == {"delivery.capacity_committed": "Committed can't be more than what you have available."}
    svc, lid = launch(env)
    item = run(svc.get_subject(OWNER, "A", L, lid))
    with pytest.raises(Invalid) as e:
        run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"delivery": {"capacity_committed": "101"}}))
    assert "delivery.capacity_committed" in e.value.errors
    assert run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"delivery": {"capacity_committed": "100"}}))["revision"] == item["revision"] + 1
    # Data saved before this rule: no negative capacity is shown, the check asks for it to be corrected.
    row = svc.store.rows["subjects"][lid]
    row["data"]["delivery"].update({"capacity_available": "50", "capacity_committed": "90"})
    r = assess(svc, lid, L)["result"]
    for found in (check(r, "C4.A"), gate(r, "B2")):
        assert (found["state"], found["reason"]) == ("unknown", "Committed can't be more than what you have available.")
    assert r["classification"] == "insufficient_evidence" and "-" not in str(r["metrics"]["capacity"])
    item = run(svc.get_subject(OWNER, "A", L, lid))                       # other edits to the old record still save
    assert run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"audience": "Owners"}))["data"]["audience"] == "Owners"


def test_n2_attestations_saved_before_the_rule_read_as_self_attested():
    env = Env()
    env.store.policies["A"]["member_can_approve"] = True
    svc, cid = funding_case(env)
    run(svc.attest(MEMBER, "A", F, cid, "C5.B", True, "Checked independently", independent=True))
    row = svc.store.rows["subjects"][cid]
    row["data"]["attestations"]["C4.B"]["independent"] = True              # as stored before the fix: the owner's own review marked independent
    row["data"].pop("editors")                                             # and older records have no list of editors
    old = assess(svc, cid)
    stored = svc.store.rows["assessments"][old["id"]]["data"]["result"]
    next(ch for c in stored["criteria"] for ch in c["checks"] if ch["code"] == "C4.B")["attestation"]["independent"] = True      # an old stored result too
    case = run(svc.get_subject(OWNER, "A", F, cid))
    assert case["data"]["attestations"]["C4.B"]["independent"] is False and case["data"]["attestations"]["C5.B"]["independent"] is True
    shown = check(case["assessment"]["result"], "C4.B")
    assert shown["attestation"]["independent"] is False and shown["reason"] == "Self-attested."
    assert check(case["assessment"]["result"], "C5.B")["attestation"]["independent"] is True
    assert case["assessment"]["freshness"]["status"] == "current"          # reading it this way does not make the result stale
    fresh = assess(svc, cid)["result"]
    assert check(fresh, "C4.B")["reason"] == "Self-attested." and fresh["confidence"]["level"] == "medium"


# ══ Dashboard buttons and links (routes derived from the dashboard payload) ═══

def _pre(env):
    d = _dashboard(env)
    assert d["context"]["business_stage"] == "pre_launch"
    return d


def _suggestion(d, key):
    return next((s for s in d["agent"]["suggestions"] if s["key"] == key), None)


def _shortcut(d, key):
    return next(s for s in d["agent"]["shortcuts"] if s["key"] == key)


def _kpi(d, key):
    return next(k for k in d["kpis"] if k["key"] == key)


def test_c1_scenario_help_never_runs_on_nothing_and_charges_nothing_then():
    env = Env()
    d = _pre(env)
    assert _shortcut(d, "scenario_help")["action"] == {"capability": "scenario_help", "prompt": "What happens if my costs rise by 10%?"}      # goes to the Agent box, not straight to a run
    credits = env.meter.balances[OWNER]
    res = env.submit(text="What happens if my costs rise by 10%?")
    r = res["run"]
    assert r["state"]["outcome"]["reason"] == "no_costs" and r["state"]["outcome"]["skipped"] is True
    assert "This needs your costs, and none are recorded or planned yet." in str(res) and "0.00 to 0.00" not in str(res)
    assert env.meter.balances[OWNER] == credits and not [c for c in env.meter.charges if c[1] == "agent_analyse"]
    lost = env.submit(capability="scenario_help", params={"scenario": "client_loss"})["run"]      # no revenue to lose: also not run
    assert lost["state"]["outcome"]["reason"] == "no_revenue" and env.meter.balances[OWNER] == credits

    # With a launch plan, its planned costs are used: fixed costs plus the cost of the planned volume.
    svc, lid = launch(env)                                              # 1000 fixed + 40 x 30 hours
    res = env.submit(capability="scenario_help", params={"scenario": "cost_increase", "params": {"pct": 10}})
    r, text = res["run"], str(res)
    assert "planned costs from your launch plan" in text and "2,200.00 a month" in text and "2,420.00 a month" in text
    assert "0.00 to 0.00" not in text and r["state"]["outcome"]["simulation"]["basis"] == "planned"
    assert env.meter.balances[OWNER] < credits                          # a real run is charged as before
    # No economics: the cash projection's average monthly payments are used instead.
    item = run(svc.get_subject(OWNER, "A", L, lid))
    run(svc.update_subject(OWNER, "A", L, lid, item["revision"], {"economics": {"fixed_costs_monthly": None, "variable_cost_per_unit": None}}))
    assert run(svc.planned_monthly_costs("A")) == {"amount": 2500.0, "source": "the cash projection in your launch plan \u201cBookkeeping service launch\u201d"}
    assert run(svc.planned_monthly_costs("B")) is None                  # another business's plan is never used
    # Recorded costs take over once they exist.
    env.fin["expenses"].append({"id": "e1", "price": 900, "status": "paid", "date": env.now.date().isoformat(), "updated_at": env.now.isoformat()})
    r = env.submit(capability="scenario_help", params={"scenario": "cost_increase", "params": {"pct": 10}})["run"]
    assert r["state"]["outcome"]["simulation"]["basis"] == "recorded" and "planned costs" not in str(r["state"]["outcome"])


def test_c2_run_scenario_opens_the_scenario_it_names():
    from test_dashboard import growing, idea, invoice, operating
    env = Env()
    assert _card(_pre(env), "scenario")["cta"] == {"label": "See the scenario", "to": "/simulation?template=tmpl_cost_increase"}      # cash runway at planned costs
    env = Env()
    operating(env)
    invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8)
    invoice(env, "late2", "Aftred", 50, paid=False, due_in=-3)
    d = _dashboard(env)
    assert _card(d, "next_step")["text"] == "2 overdue (£199.00). I'm preparing the reminders for your approval."              # the Agent's status, not a scenario to run
    assert _card(d, "next_step")["cta"] is None
    assert _card(d, "next_step")["detail"] == "2 overdue · £199.00"
    env = Env(plan="decision_engine")
    idea(env)
    assert _card(_dashboard(env), "scenario")["cta"]["to"] == "/simulation?template=tmpl_price_increase"
    env = Env(plan="decision_engine")
    growing(env)
    assert _card(_dashboard(env), "scenario")["cta"]["to"] in ("/simulation?template=tmpl_hire_staff", "/simulation?template=tmpl_client_loss")
    from app.modules.scenario_intelligence import service as scenarios
    import inspect
    known = set(__import__("re").findall(r"tmpl_[a-z_]+", inspect.getsource(scenarios)))
    used = set(__import__("re").findall(r"tmpl_[a-z_]+", inspect.getsource(__import__("app.modules.agent.dashboard", fromlist=["x"]))))
    assert used and used <= known                                       # every template a card names exists in Simulation


def test_c3_the_launch_suggestion_is_worded_and_routed_from_the_launch_summary():
    env = Env()
    first = _suggestion(_pre(env), "stage_blockers")
    assert (first["text"], first["action"]) == ("Your idea hasn't been scored yet: I'm scoring it before you launch.", {"to": "/validation"})
    env.businesses["A"]["data"]["decision"] = {"status": "accepted"}
    ok = _suggestion(_pre(env), "stage_blockers")
    assert (ok["text"], ok["action"]) == ("I need your launch date and scope before I can check your readiness.", {"to": "/launch"})
    svc, lid = launch(env, prerequisite="not_completed")
    waiting = _suggestion(_pre(env), "stage_blockers")
    assert (waiting["text"], waiting["action"]) == ("I'm checking your launch evidence for gaps.", {"to": f"/launch/{lid}"})      # the Agent runs the check itself
    assess(svc, lid, L)
    blocked = _suggestion(_pre(env), "stage_blockers")
    assert (blocked["text"], blocked["action"]) == ("I'm checking your launch evidence for gaps.", {"to": f"/launch/{lid}"})
    env2 = Env()
    svc2, lid2 = launch(env2, forecast=False)
    assess(svc2, lid2, L)
    gaps = _suggestion(_pre(env2), "stage_blockers")
    assert (gaps["text"], gaps["action"]) == ("I'm checking your launch evidence for gaps.", {"to": f"/launch/{lid2}"})
    env3 = Env()
    svc3, lid3 = launch(env3)
    assess(svc3, lid3, L)
    ready = _suggestion(_pre(env3), "stage_blockers")                   # ready: the tile stays and says so (no card is hidden)
    assert ready["text"] == "Your launch is ready against its checklist. I'm watching for changes."


def test_c4_funding_pack_opens_the_funding_case_materials():
    env = Env()
    d = _pre(env)
    assert _suggestion(d, "stage_funding")["action"] == {"to": "/funding"} and _shortcut(d, "funding_pack")["action"] == {"to": "/funding"}
    _, cid = funding_case(env)
    d = _pre(env)
    assert _suggestion(d, "stage_funding")["action"] == {"to": f"/funding/{cid}?tab=documents"}
    assert _shortcut(d, "funding_pack")["action"] == {"to": f"/funding/{cid}?tab=documents"}


def test_c5_add_it_links_open_the_forecast_that_holds_the_figure():
    env = Env()
    d = _pre(env)
    assert [_kpi(d, k)["to"] for k in ("planned_costs", "runway", "funding_secured")] == ["/launch", "/launch", "/funding"]
    assert next(i for i in d["launch_readiness"]["items"] if i["key"] == "costs_and_funding")["to"] == "/launch"
    _, lid = launch(env)
    _, cid = funding_case(env)
    d = _pre(env)
    cash = f"/launch/{lid}?tab=setup&section=cash"
    assert [_kpi(d, k)["to"] for k in ("planned_costs", "runway")] == [cash, cash]
    assert _kpi(d, "funding_secured")["to"] == f"/funding/{cid}?tab=setup&section=finances"
    assert next(i for i in d["launch_readiness"]["items"] if i["key"] == "costs_and_funding")["to"] == cash


def test_c6_c7_the_old_checklist_is_the_setup_checklist_and_no_link_leaves_its_subject():
    env = Env()
    _, lid = launch(env, prerequisite="not_completed")
    _, cid = funding_case(env, demand=False)
    d = _pre(env)
    assert (d["report"]["title"], d["report"]["cta"], d["report"]["secondary"]["label"]) == ("Setup checklist", "View setup checklist", "Launch readiness check")
    assert _shortcut(d, "launch_checklist")["label"] == "Setup Checklist"
    # Every route on the pre-launch dashboard goes to a page its wording is about.
    about = {"launch": ("/launch",), "funding": ("/funding",), "regist": ("/registration",), "scenario": ("/simulation",), "checklist": ("/dashboard?report=open",),
             "plan": ("/blueprint", "/launch"), "validat": ("/validation",)}
    links = [(s["text"], s["action"].get("to")) for s in d["agent"]["suggestions"]] + [(s["label"], s["action"].get("to")) for s in d["agent"]["shortcuts"]] \
        + [(c["title"] + " " + c["cta"]["label"], c["cta"].get("to")) for c in d["insights"]] + [(k["label"], k["to"]) for k in d["kpis"]]
    for words, to in links:
        if not to:
            continue
        expected = [paths for word, paths in about.items() if word in words.lower()]
        assert not expected or any(to.startswith(p) for paths in expected for p in paths), (words, to)
        assert not to.startswith("/operations") and (to.startswith("/simulation") is ("scenario" in words.lower())), (words, to)


# ══ Dashboard round S / K / L ═════════════════════════════════════════════════

def test_s1_a_scenario_the_plan_cannot_run_says_so_and_never_opens_a_disabled_run():
    from app.modules.agent import dashboard as dash
    from test_dashboard import idea, invoice, operating
    assert [dash.plan_allows_scenario(p, "tmpl_cost_increase") for p in ("explorer", None, "starter_insight", "decision_engine")] == [False, False, True, True]
    assert dash.plan_allows_scenario("starter_insight", "tmpl_hire_staff") is False
    env = Env(plan="explorer")                                          # the free plan can run no manual scenario
    card = _card(_pre(env), "scenario")
    assert card["cta"] == {"label": "See the scenario \u00b7 Pro", "to": "/pricing", "upgrade": True, "locked": True, "note": dash.SCENARIO_LOCK_NOTE,
                           "unlocked_to": "/simulation?template=tmpl_cost_increase"}
    assert card["note"] == dash.SCENARIO_LOCK_NOTE and card["detail"] is None and card["text"] == "I need your planned monthly costs in a launch plan before I can work out what a cost rise does to your runway."
    env = Env(plan="explorer")
    operating(env)
    invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8)
    step = _card(_dashboard(env), "next_step")
    assert step["cta"] == {"label": "See plans", "to": "/pricing"}
    assert step["text"] == "1 overdue (\u00a3149.00). Reminders are part of Agent tasks, which your plan doesn't include."
    assert step["detail"] == "1 overdue \u00b7 \u00a3149.00"
    assert step["agent_action"] is None                                # nothing for the owner to start
    for d in (_pre(Env(plan="explorer")), _dashboard(env)):
        assert not [c for c in d["insights"] if str((c["cta"] or {}).get("to", "")).startswith("/simulation")]
    env = Env(plan="starter_insight")                                   # Starter runs four templates; the rest say Pro
    idea(env)
    assert _card(_dashboard(env), "scenario")["cta"]["to"] == "/pricing"
    assert _card(_pre(Env(plan="starter_insight")), "scenario")["cta"] == {"label": "See the scenario", "to": "/simulation?template=tmpl_cost_increase"}


def test_k1_pre_launch_figures_come_from_the_launch_plans_cash_projection():
    env = Env()
    empty = _pre(env)
    assert [_kpi(empty, k)["value"] for k in ("runway", "planned_costs", "funding_secured")] == [None, None, None]
    svc, lid = launch(env, forecast=False)
    agreement = evidence(env, svc, None, None, title="Signed loan agreement", type="document")
    letter = evidence(env, svc, None, None, title="Investor letter of intent", type="letter_of_intent")
    month = fc.month_key((env.now.year, env.now.month))
    run(svc.save_forecast(OWNER, "A", L, lid, {
        "opening_cash": "10000", "opening_cash_as_of": day(env), "months": months(env, 6, receipts="4000", payments="9500"),
        "financing_items": [{"label": "Bank loan", "month": month, "amount": "30000", "status": "committed", "evidence_id": agreement["id"]},
                            {"label": "Angel", "month": month, "amount": "50000", "status": "committed", "evidence_id": letter["id"]},      # interest, not a commitment
                            {"label": "Grant", "month": month, "amount": "8000", "status": "proposed"}]}))
    d = _pre(env)
    costs, runway, funding = (_kpi(d, k) for k in ("planned_costs", "runway", "funding_secured"))
    assert (costs["value"], costs["state"]) == ("\u00a39,500.00", "available") and "average payments in your launch plan" in costs["hint"]
    assert (funding["value"], funding["hint"]) == ("\u00a330,000.00", "Received, or committed with evidence, in your launch plan")
    assert (runway["value"], runway["tone"]) == ("Beyond Mar 2027", "emerald")      # 40,000 less 5,500 a month lasts past the projection
    row = next(i for i in d["launch_readiness"]["items"] if i["key"] == "costs_and_funding")
    assert row["done"] is True and d["launch_readiness"]["done"] == empty["launch_readiness"]["done"] + 1
    assert d["launch_check"]["figures"]["funding_secured"] == 30000.0
    # Cash that runs out: the tile counts the months to the first month below zero.
    f = run(svc.get_subject(OWNER, "A", L, lid))["forecast"]
    run(svc.save_forecast(OWNER, "A", L, lid, {**f["data"], "financing_items": []}, f["revision"]))
    d = _pre(env)
    assert _kpi(d, "runway")["value"] == "1 month" and "Nov 2026" in _kpi(d, "runway")["hint"] and _kpi(d, "runway")["tone"] == "rose"
    assert _kpi(d, "funding_secured")["value"] is None                  # no financing items: still "Add it", never a made-up zero
    # No projection: planned costs fall back to fixed costs plus delivery costs.
    _, lid2 = launch(Env(), forecast=False)
    env2 = Env()
    launch(env2, forecast=False)
    d2 = _pre(env2)
    assert _kpi(d2, "planned_costs")["value"] == "\u00a32,200.00" and "fixed costs plus delivery costs" in _kpi(d2, "planned_costs")["hint"]
    assert _kpi(d2, "runway")["value"] is None


def test_l2_an_invoice_saved_without_a_number_is_named_as_business_operations_names_it():
    from app.modules.agent import dashboard as dash
    from test_dashboard import invoice, operating
    env = Env()
    operating(env)
    made = "2026-09-16T10:00:00+00:00"
    a = invoice(env, "29ef9b20-10e1-49ce-9e5c-c05fa8673324", "Aftred", 50, paid=False, due_in=-5, created_at=made)
    b = invoice(env, "c9e1f0f8-0000-4000-8000-000000000001", "Aftred Trading", 149, paid=False, due_in=-8, created_at="2026-09-16T15:00:00+00:00")
    c = invoice(env, "keep", "Other", 20, paid=False, due_in=-2, created_at="2026-09-16T12:00:00+00:00")      # has its own number: not counted
    a.pop("reference"); b.pop("reference")
    b["reference"] = b["id"]                                             # an id stored where the number should be is not a number
    labels = dash.invoice_labels(env.businesses["A"]["data"])
    assert (labels[a["id"]], labels[b["id"]], labels["keep"]) == ("INV-1160926", "INV-2160926", "INV-keep")
    rows = [e["label"] for e in _card(_dashboard(env), "next_step")["why"]["evidence"]]
    assert set(rows) == {"INV-1160926", "INV-2160926", "INV-keep"} and "Invoice (no number)" not in rows
    assert dash.invoice_label({"id": "x"}) == "Invoice (no number)"    # only when there is truly nothing to go on
