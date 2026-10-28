"""Synthetic: the Agent's forecast opens on the cash the records show when the owner gave none (21 Oct)."""
from datetime import date

from app.modules.readiness.service import ReadinessService


def accept_all(out):
    """Every draft the Agent left accepted, as the owner pressing Accept on each (the owner's brief, 25 Oct: drafts wait)."""
    if not out:
        return out
    import copy as _copy
    from app.modules.readiness.service import _set as _put
    out = _copy.deepcopy(out)
    for path, d in (out.pop("agent_drafts", None) or {}).items():
        _put(out, path, d["value"])
    return out


def _paid(subject_type, row, data):
    """The case with a "Do all for me" run behind it: filling is part of it, never free (the owner, 26 Oct)."""
    from app.modules.readiness import rules as _rules
    row = {**row, "id": row.get("id") or "case-under-test"}
    goal = "need_funding" if subject_type == _rules.FUNDING else "launch"
    runs = dict((data or {}).get("research_runs") or {})
    runs.setdefault("rr-paid", {"id": "rr-paid", "goal": goal, "status": "review", "case_id": row["id"], "created_at": "2026-10-01T00:00:00Z", "items": []})
    return row, {**(data or {}), "research_runs": runs}


def _fill(subject_type, row, data, today):
    from app.modules.readiness.service import ReadinessService as _R
    row, data = _paid(subject_type, row, data)
    return accept_all(_R._fill_blanks(_R.__new__(_R), subject_type, row, data, today))


def _fill_svc(svc, subject_type, row, data, today):
    row, data = _paid(subject_type, row, data)
    return accept_all(svc._fill_blanks(subject_type, row, data, today))



def test_opening_cash_from_the_records():
    data = {"financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 1000, "amount_paid": 1000, "currency": "GBP"}],
                           "expenses": [{"id": "e1", "status": "paid", "total_amount": 300, "currency": "GBP"}]},
            "workspace_profile": {"currency": "GBP"}}
    cash = ReadinessService.records_cash(data, date(2026, 10, 21))
    assert cash == 700
    got = ReadinessService._opening_of(None, {"data": data, "today": date(2026, 10, 21)})
    assert got["opening_cash_as_of"] == "2026-10-21" and float(got["opening_cash"]) == 700


def test_no_records_no_opening_cash():
    assert ReadinessService.records_cash({}, date(2026, 10, 21)) is None
    assert ReadinessService._opening_of(None, {"data": {}, "today": date(2026, 10, 21)})["opening_cash"] is None


def test_months_default_to_when_the_funding_arrives_and_non_answers_are_cleared():
    from app.modules.readiness import rules
    row = {"data": {"receipt_date": "2027-04-30", "use_of_funds": [{"id": "a1", "category": "Other", "amount": "99400", "period": None, "purpose": "Hiring staff"}],
                    "market": {"acquisition_approach": "No acquisition channels or first steps are described in the available information."}}}
    out = _fill(rules.FUNDING, row, {}, date(2026, 10, 21))
    assert out["use_of_funds"][0]["period"] == "2027-04"
    assert "Suggested by the Agent" in out["provenance"]["use_of_funds.period"]["source"]
    assert not (out.get("market") or {}).get("acquisition_approach")


def _gbp_records():
    return {"settings": {"currency": "GBP"},
            "fx_rates": {"base": "GBP", "rates": {"NGN": 0.0005}, "dates": {"NGN": "2026-10-21"}},
            "financials": {"invoices": [{"id": "i1", "status": "paid", "total_amount": 600, "amount_paid": 600, "currency": "GBP", "cost_of_sales": 200,
                                         "paid_at": "2026-10-10"}]}}


def test_records_are_converted_into_the_cases_currency():
    from app.modules.agent import business as bz
    data = _gbp_records()
    assert bz.convert(data, 600, "GBP", "NGN") == 1200000
    assert ReadinessService._to_case(data, 600, {"currency": "NGN"}) == 1200000
    assert ReadinessService._to_case({"settings": {"currency": "GBP"}}, 600, {"currency": "NGN"}) is None      # no rate: never ₦600


def test_the_agents_forecast_has_payments_and_opening_cash_from_the_records():
    from app.modules.readiness import rules
    data = _gbp_records()
    row = {"id": "c1", "kind": rules.FUNDING, "data": {"currency": "NGN"}}
    draft = ReadinessService._forecast_draft(ReadinessService.__new__(ReadinessService), row, {"data": data, "today": date(2026, 10, 21)})
    m = draft["months"][0]
    assert m["receipts"] == "1200000"                          # £600 in naira
    assert m["payments"] == "400000"                           # the cost of sales, a third of what came in
    assert float(draft["opening_cash"]) == 800000              # Business Operations' cash: £400
    assert draft["currency"] == "NGN"


def test_a_check_without_enough_evidence_still_gives_a_score_from_what_is_known():
    from app.modules.agent import first_value as fv
    crit = [{"key": "a", "label": "A", "state": fv.MET, "weight": 2, "gap": ""}, {"key": "b", "label": "B", "state": fv.UNKNOWN, "weight": 2, "gap": "B"}]
    out = fv._result("pricing_health_initial", criteria=crit, score="Insufficient evidence", score_label="")
    assert out["partial_score"] == 50 and out["evidence_coverage"] == 50
    assert fv._result("pricing_health_initial", criteria=crit, score="Fair", score_label="")["partial_score"] is None


def test_an_adopt_puts_its_lines_answers_drafts_and_saved_options_on_the_case():
    from app.modules.agent import assessment_summary as a
    adopted = [
        {"id": "u1", "derive": "use_of_funds", "decision": "accepted", "table": [{"line": "Marketing", "amount": 35000}, {"line": "Reserve: one month of fixed costs", "amount": 5000}]},
        {"id": "q1", "kind": "question", "field": "team", "decision": "answered", "answer": "Hillzy (owner)"},
        {"id": "g1", "topic": "route_grant", "decision": "accepted", "label": "Funding & Grants", "value": "Support in Leeds",
         "sources": [{"url": "https://example.org/grants", "publisher": "Invest Leeds", "date": "2025-03-27"}]},
    ]
    put = a.adopted_fields(adopted, {"market.differentiation": "Local and fast"}, "2026-10-22")
    assert put["use_of_funds"][0] == {"id": "uof1", "category": "Other", "amount": "35000", "purpose": "Marketing"}
    assert put["use_of_funds"][1]["category"] == "Reserve" and put["use_of_funds"][1]["rationale"]
    assert put["team.responsibilities"][0]["owner"] == "Hillzy (owner)"
    assert put["market.differentiation"] == "Local and fast"
    saved = a.saved_options(adopted, "2026-10-22")
    assert saved == [{"id": "g1", "route": "grant", "title": "Funding & Grants", "text": "Support in Leeds",
                      "source": {"url": "https://example.org/grants", "publisher": "Invest Leeds", "date": "2025-03-27"}, "saved_at": "2026-10-22"}]


def test_the_result_reads_the_case_as_it_is_now():
    from app.modules.agent import first_value as fv
    result = {"assessment_type": "funding_readiness_initial", "score": 40,
              "criteria": [{"key": "team", "label": "Team", "state": fv.UNKNOWN, "weight": 10}, {"key": "market", "label": "Market", "state": fv.UNKNOWN, "weight": 10}],
              "blockers": [{"key": "team", "label": "Who will deliver the plan is not recorded", "kind": "unknown"},
                           {"key": "market", "label": "Target customers not set out", "kind": "unknown"}]}
    case = {"team": {"responsibilities": [{"area": "Delivery", "owner": "Hillzy (owner)"}]},
            "market": {"target_segment": "Busy families", "differentiation": "Local", "acquisition_approach": "No acquisition channels are described in the available information."}}
    out = fv.with_case(result, case)
    assert [b["key"] for b in out["blockers"]] == ["market"] and out["blockers"][0]["kind"] == "partial"      # team done; market partly (a non-answer)


def test_asking_for_funding_readiness_chats_from_the_case_and_asks_only_what_is_missing(monkeypatch):
    import asyncio
    from app.modules.agent import goal_router as gr

    async def biz(_u, _b):
        return {}

    async def case_of(_u, _b, _c=None):
        return {"id": "c7", "data": {"target_amount": "250000", "purpose": "Hiring staff", "route_preference": "grant",
                                     "receipt_date": "2027-04-30", "market": {"location": "Leeds, United Kingdom"}, "traction": {"summary": "Pending approval"}}}
    monkeypatch.setattr(gr, "_business_for", biz)
    monkeypatch.setattr(gr, "_case_of", case_of)
    out = asyncio.run(gr.quick_check_questions("b1", "need_funding", None, user={"id": "u1"}))
    said = {q["key"]: q for q in out["questions"] if q.get("said")}
    assert set(said) == {"amount", "use", "route", "timing", "where"}                      # not asked again
    assert said["amount"]["default"] == "250000" and said["amount"]["source"] == "From your funding case"
    asked = [q["key"] for q in out["questions"] if not q.get("said")]
    assert "traction" in asked and "stage" in asked                                          # a placeholder is not an answer


def test_empty_milestone_parts_are_filled_from_the_case_and_never_overwritten():
    from app.modules.readiness import rules
    row = {"data": {"receipt_date": "2027-04-30", "currency": "GBP", "market": {"acquisition_owner": "Hillzy (owner)"},
                    "traction": {"customers": "3", "monthly_revenue": "450"},
                    "milestones": [{"id": "m1", "outcome": "Customer base established", "measure": "Number of paying customers", "target": "20"},
                                   {"id": "m2", "outcome": "Monthly revenue growth", "measure": "Monthly revenue in GBP", "owner": "Sam", "due_date": "2027-01-01"}],
                    "use_of_funds": [{"id": "a1", "category": "Reserve", "amount": "100", "period": "2027-01", "purpose": "Reserve: one month of fixed costs"}]}}
    out = _fill(rules.FUNDING, row, {}, date(2026, 10, 22))
    m1, m2 = out["milestones"]
    assert (m1["owner"], m1["due_date"], m1["baseline"]) == ("Hillzy (owner)", "2027-10-28", "3 paying customers")
    assert (m2["owner"], m2["due_date"], m2["baseline"]) == ("Sam", "2027-01-01", "£450 a month")      # theirs kept
    assert out["use_of_funds"][0]["rationale"] == "Reserve: one month of fixed costs"
    assert out["provenance"]["milestones.due_date"]["source"].startswith("Suggested by the Agent")


def test_the_purpose_takes_the_milestone_a_spending_line_names():
    from app.modules.readiness import rules
    row = {"data": {"milestones": [{"id": "m1", "outcome": "Customer base established", "measure": "customers", "target": "20", "due_date": "2027-06-01",
                                    "owner": "Hillzy", "baseline": "3"}],
                    "use_of_funds": [{"id": "a1", "category": "Operations", "amount": "100", "period": "2027-01", "purpose": "Kit", "milestone_id": "m1"}]}}
    out = _fill(rules.FUNDING, row, {}, date(2026, 10, 22))
    assert out["purpose_milestone_id"] == "m1"



def test_every_list_item_gets_an_id_so_it_can_be_picked():
    from app.modules.readiness import rules
    row = {"data": {"milestones": [{"outcome": "Grow the customer base", "measure": "customers", "target": "20", "due_date": "2027-06-01", "owner": "A", "baseline": "1"}],
                    "team": {"responsibilities": [{"area": "Delivery", "owner": "A"}]}}}
    out = _fill(rules.FUNDING, row, {}, date(2026, 10, 22))
    assert out["milestones"][0]["id"] and out["team"]["responsibilities"][0]["id"]


def test_a_finished_research_fills_the_case_and_checks_it_again(monkeypatch):
    import asyncio
    from app.modules.agent import assessment_summary as a
    put, checked = {}, []

    class Svc:
        async def list_subjects(self, *_a, **_k):
            return {"items": [{"id": "c1", "status": "draft"}]}

        async def get_subject(self, *_a, **_k):
            return {"id": "c1", "revision": 3, "data": {"market": {"acquisition_approach": "No channels are described in the available information."},
                                                         "purpose_milestone_id": None}}

        async def update_subject(self, _u, _b, _t, _id, rev, changes, _e, provenance=None):
            put.update(changes)

        async def refresh_forecast(self, *_a, **_k):
            return None

        async def request_assessment(self, *_a, **_k):
            checked.append(True)
    monkeypatch.setattr("app.modules.readiness.service.service_for", lambda _o: Svc())

    async def current(*_a, **_k):
        return {}
    monkeypatch.setattr(a, "current", current)

    class Orch:
        class rt:
            clock = staticmethod(lambda: __import__("datetime").datetime(2026, 10, 22))

            class business:
                @staticmethod
                async def mutate(_b, fn):
                    fn({})
    drafts = {"market.differentiation": "Same-day bookings across Leeds", "market.acquisition_approach": "Leaflets and local groups",
              "milestones": [{"outcome": "20 paying customers", "measure": "customers", "target": "20"}]}
    asyncio.run(a.feed(Orch, {"id": "u1"}, "b1", "need_funding", {}, {}, "ref", subject_id="c1", adopted=[], case_drafts=drafts))
    assert put["market"]["differentiation"] == "Same-day bookings across Leeds"
    assert put["market"]["acquisition_approach"] == "Leaflets and local groups"          # a non-answer is replaced
    mid = put["milestones"][0]["id"]
    assert mid and put["purpose_milestone_id"] == mid and put["market"]["acquisition_milestone_id"] == mid
    assert checked                                                                       # checked again: steps close, score moves


def test_the_case_takes_what_the_last_research_drafted():
    from app.modules.readiness import rules
    data = {"research_runs": {"rr1": {"goal": "need_funding", "status": "review", "finished_at": "2026-10-22T10:00:00",
                                      "case_drafts": {"market.differentiation": "Same-day bookings across Leeds", "market.acquisition_cost": "£300 a month on local ads"}}}}
    row = {"data": {"market": {"acquisition_approach": "Leaflets"}, "team": {"responsibilities": [{"id": "r1", "area": "Sales", "owner": "Hillzy (owner)"}]},
                    "milestones": [{"id": "m1", "outcome": "Grow the customer base", "measure": "customers", "target": "20", "due_date": "2027-06-01", "owner": "Hillzy", "baseline": "1"}]}}
    out = _fill(rules.FUNDING, row, data, date(2026, 10, 22))
    m = out["market"]
    assert m["differentiation"] == "Same-day bookings across Leeds" and m["acquisition_cost"] == "£300 a month on local ads"
    assert m["acquisition_approach"] == "Leaflets"                                     # theirs kept
    assert m["acquisition_owner"] == "Hillzy (owner)" and m["acquisition_milestone_id"] == "m1" and out["purpose_milestone_id"] == "m1"


def test_a_draft_about_another_offering_or_a_location_that_is_not_a_place_is_never_used():
    from app.modules.readiness import rules
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "services": [{"service_name": "Home cleaning"}]},
            "quick_check_answers": {"test_idea": {"answers": {"sell": "Mobile dog grooming van"}}},
            "research_runs": {"rr1": {"goal": "need_funding", "status": "review", "finished_at": "2026-10-22T10:00:00",
                                      "case_drafts": {"market.differentiation": "The mobile dog grooming service brings a van to the door.",
                                                      "market.location": "cleaning services", "market.acquisition_cost": "£300 a month on local ads"}}}}
    row = {"data": {"market": {}}}
    out = _fill(rules.FUNDING, row, data, date(2026, 10, 22))
    m = out["market"]
    assert "differentiation" not in m and "location" not in m
    assert m["acquisition_cost"] == "£300 a month on local ads"



def test_the_market_fields_are_never_left_empty_when_the_records_answer_them():
    from app.modules.readiness import rules
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "city": "Leeds", "country": "United Kingdom",
                                  "services": [{"service_name": "Home cleaning"}, {"service_name": "End of tenancy cleaning"}]}}
    row = {"data": {"currency": "GBP", "market": {"target_segment": "Busy professionals and families in Leeds"}, "economics": {"fixed_costs_monthly": "100"},
                    "use_of_funds": [{"id": "a1", "category": "Marketing", "amount": "6000", "purpose": "Local ads", "period": "2027-01"}]}}
    out = _fill(rules.FUNDING, row, data, date(2026, 10, 22))
    m = out["market"]
    assert m["location"] == "Leeds, United Kingdom"
    assert "home cleaning and end of tenancy cleaning" in m["differentiation"]
    assert "Google Business profile" in m["acquisition_approach"]
    assert m["acquisition_cost"].startswith("About £500 a month")
    assert "workspace_profile" not in out                                              # never written there



def test_a_field_the_owner_empties_is_never_filled_again():
    from app.modules.readiness import rules
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "city": "Leeds", "country": "United Kingdom",
                                  "services": [{"service_name": "Home cleaning"}]}}
    row = {"data": {"receipt_date": "2027-04-30", "market": {"target_segment": "Families", "acquisition_owner": "Hillzy"},
                    "cleared_by_owner": ["market.location", "market.differentiation", "milestones.m1.due_date"],
                    "milestones": [{"id": "m1", "outcome": "Grow", "measure": "customers", "target": "20", "owner": "Hillzy", "baseline": "1"}]}}
    out = _fill(rules.FUNDING, row, data, date(2026, 10, 22)) or row["data"]
    assert not out["market"].get("location") and not out["market"].get("differentiation")
    assert not out["milestones"][0].get("due_date")
    assert out["market"].get("acquisition_approach")                                   # one not emptied is still filled


def test_the_agents_forecast_reaches_every_month_the_check_needs():
    f = {"drafted_by": "Agent", "months": [{"month": f"2026-{m:02d}", "receipts": "1000", "payments": "800"} for m in (10, 11, 12)]}
    out = ReadinessService.extend_months(f, ["2026-10", "2026-11", "2026-12", "2027-01"])
    assert out["months"][-1] == {"month": "2027-01", "receipts": "1000", "payments": "800", "basis": "estimate"}
    assert ReadinessService.extend_months(out, ["2026-10", "2027-01"]) is None


def test_an_empty_month_in_the_forecast_is_filled_by_the_agent():
    f = {"months": [{"month": "2027-09", "receipts": "450", "payments": "155"}, {"month": "2027-10", "receipts": None, "payments": ""}]}
    out = ReadinessService.extend_months(f, ["2027-09", "2027-10"])
    assert out["months"][1] == {"month": "2027-10", "receipts": "450", "payments": "155", "basis": "estimate"}
    assert out["months"][0] == {"month": "2027-09", "receipts": "450", "payments": "155"}      # theirs untouched


def test_the_agent_does_not_fill_a_free_plans_case(monkeypatch):
    import asyncio
    from app.modules.plans import access

    async def plan(_u):
        return "explorer"
    monkeypatch.setattr(access, "effective_plan_key", plan)
    assert asyncio.run(ReadinessService._free_plan({"owner_id": "u1"}, "u1")) is True

    async def paid(_u):
        return "starter_insight"
    monkeypatch.setattr(access, "effective_plan_key", paid)
    assert asyncio.run(ReadinessService._free_plan({"owner_id": "u1"}, "u1")) is False



def test_the_agents_own_lines_are_worked_out_again_for_the_new_target():
    from app.modules.readiness import rules
    row = {"data": {"target_amount": "100000", "purpose": "Hiring staff", "receipt_date": "2027-04-30", "economics": {"fixed_costs_monthly": "100"},
                    "provenance": {"use_of_funds": {"source": "your research"}},
                    "use_of_funds": [{"id": "a", "category": "Marketing and sales", "amount": "249700", "purpose": "Marketing", "period": "2027-04"},
                                     {"id": "b", "category": "Operations", "amount": "200", "purpose": "Working capital", "period": "2027-04"}]}}
    out = _fill(rules.FUNDING, row, {}, date(2026, 10, 22))
    lines = [(x["category"], x["amount"]) for x in out["use_of_funds"]]
    assert lines == [("People", "99700"), ("Operations", "200"), ("Reserve", "100")]
    # typed by the owner (no source on them): never touched
    mine = {"data": {**row["data"], "provenance": {}}}
    kept = _fill(rules.FUNDING, mine, {}, date(2026, 10, 22)) or mine["data"]
    assert kept["use_of_funds"][0]["amount"] == "249700"


def test_a_list_answers_its_none_box_in_the_section_count():
    from app.modules.readiness import engine, rules
    prof = rules.PROFILES[rules.CURRENT[rules.FUNDING]]
    subj = {"team": {"responsibilities": [{"area": "A", "owner": "B"}], "gaps": [{"gap": "x", "action": "y"}]}, "risks": [{"risk": "r", "action": "a"}]}
    got = {x["key"]: (x["answered"], x["total"]) for x in engine.section_progress(prof, subj, None)}
    assert got["team"] == (3, 3) and got["documents"] == (2, 2)



def test_owners_and_a_first_milestone_are_filled_for_the_owner():
    from app.modules.readiness import rules
    row = {"data": {"purpose": "Marketing", "receipt_date": "2027-04-30", "traction": {"customers": "2"},
                    "team": {"responsibilities": [{"id": "r1", "area": "Customer delivery", "owner": ""}, {"id": "r2", "area": "Accounts", "owner": "Sam"}]}}}
    out = _fill(rules.FUNDING, row, {"_owner_name": "Hilary (owner)"}, date(2026, 10, 22))
    assert [p["owner"] for p in out["team"]["responsibilities"]] == ["Hilary (owner)", "Sam"]
    assert out["market"]["acquisition_owner"] == "Hilary (owner)"
    m = out["milestones"][0]
    assert (m["target"], m["baseline"], m["due_date"]) == ("10 paying customers", "2 paying customers", "2027-10-28")
    # Linked once the milestone is the case's own, never to a milestone still waiting as a draft (the owner, 28 Oct)
    assert out.get("purpose_milestone_id") is None and not (out.get("market") or {}).get("acquisition_milestone_id")
    approved = _fill(rules.FUNDING, {"data": {**row["data"], "milestones": [m]}}, {"_owner_name": "Hilary (owner)"}, date(2026, 10, 22))
    assert approved["purpose_milestone_id"] == m["id"] and approved["market"]["acquisition_milestone_id"] == m["id"]


def test_a_cut_off_draft_reply_keeps_its_complete_fields():
    from app.modules.agent import research
    text = '{"fields": {"market.differentiation": "Same-day washes at the door", "market.acquisition_cost": "\u20a650,000 a month", "risks": [{"risk": "Rain'
    out = research._fields_of(text)
    assert out["market.differentiation"] == "Same-day washes at the door" and out["market.acquisition_cost"] == "₦50,000 a month"



def test_a_confirmation_can_be_withdrawn():
    import asyncio
    svc = ReadinessService.__new__(ReadinessService)
    seen = {}

    async def ctx(*_a, **_k):
        return {"actor": None}

    async def row(*_a, **_k):
        return {"data": {"attestations": {"C4.B": {"passed": True}}}}

    async def patch(r, c, fn, note):
        fn(r["data"]); seen["data"] = r["data"]; return r

    async def nothing(*_a, **_k):
        return {}
    svc._ctx, svc._row, svc._patch_data, svc._decision, svc._detail = ctx, row, patch, nothing, nothing
    svc._need = lambda *_a: None
    asyncio.run(svc.withdraw_attestation("u", "b", "funding", "c", "C4.B"))
    assert seen["data"]["attestations"] == {}


def test_a_new_purpose_is_new_research_and_charged():
    # The owner's QA, 23 Oct: a new need (a party, not marketing) is researched again and charged, never the old run for free.
    from datetime import datetime, timezone
    from app.modules.agent import research
    said = {"route": "loan", "stage": "idea", "use": "Marketing", "where": "Abuja", "sell": "car wash subscription"}
    assert research.fingerprint_of(said, {}, [], "Nigeria") != research.fingerprint_of({**said, "use": "Party"}, {}, [], "Nigeria")
    now = datetime.now(timezone.utc)
    run = {"id": "rr1", "goal": "need_funding", "status": "review", "created_at": now.isoformat(), "answers": said, "items": [], "counts": {"sources": 1}}
    data = {"research_runs": {"rr1": run}}
    assert research.research_state(data, "need_funding", now, answers={**said, "use": "Party"})["state"] == "stale"
    assert research.reuse_for(data, "need_funding", research.fingerprint_of({**said, "use": "Party"}, {}, [], "Nigeria"), {**said, "use": "Party"}, now) is None


def test_a_launch_plan_is_filled_as_a_launch_never_with_placeholders():
    # The owner's QA, 23 Oct: a launch plan "Readiness, unknown, November 2026" for "customers", nothing filled after the
    # paid research. Synthetic data: its own launch suggestions, from the records and that research; never funding fields.
    from datetime import date
    from app.modules.readiness import rules
    from app.modules.readiness.service import ReadinessService
    row = {"id": "l1", "data": {"name": "Readiness, unknown, November 2026", "geography": "unknown", "audience": "customers", "launch_type": "new_offering",
                                "customers": {"target_segment": "customers"}, "offer": {"launch_scope": "readiness"}, "target_date": "2026-11-30",
                                "offerings": [{"id": "p0", "name": "My main offer"}, {"id": "p1", "name": "Car wash subscription"}]}}
    data = {"workspace_profile": {"city": "Abuja", "country": "Nigeria", "target_customer_type": "Office workers", "employee_count": "3",
                                  "problem": "Office workers have no time to wash their cars.", "tagline": "Clean cars for Abuja office workers"},
            "catalogue": {"products": [{"id": "p1", "name": "Car wash subscription", "base_price": 15000, "cost_of_sales": 6000}]},
            "_owner_name": "Ada (owner)",
            "research_runs": {"rr1": {"id": "rr1", "goal": "launch", "status": "review", "case_id": "l1", "created_at": "2026-10-23T00:20:00+00:00", "items": [
                {"id": "i1", "kind": "researched", "topic": "prerequisites", "value": "Registration with the Corporate Affairs Commission (CAC) is required. More text.",
                 "sources": [{"url": "https://example.org/cac"}]},
                {"id": "i3", "kind": "estimated", "topic": "bench_hours_per_person", "value": "The legal work week is 40 hours.", "number": 40.0, "sources": [{"url": "https://example.org/h"}]},
                {"id": "i2", "kind": "researched", "topic": "channels", "value": "Similar businesses find customers through social media.", "sources": [{"url": "https://example.org/x"}]}]}}}
    out = _fill(rules.LAUNCH, row, data, date(2026, 10, 23))
    assert out["name"] == "Car wash subscription, Abuja, November 2026"
    assert (out["geography"], out["audience"], out["customers"]["target_segment"]) == ("Abuja, Nigeria", "Office workers", "Office workers")
    assert out["offer"]["launch_scope"] == "Car wash subscription" and out["offer"]["price"] == "15000"
    assert out["economics"]["variable_cost_per_unit"] == "6000"
    assert out["prerequisites"][0]["name"].startswith("Registration with the Corporate Affairs Commission") and out["prerequisites"][0]["status"] == "not_completed"
    assert out["market"]["channel"] == "Similar businesses find customers through social media." and out["market"]["owner"] == "Ada (owner)"
    assert out["control"]["milestones"][0]["outcome"] == "Car wash subscription launched" and out["control"]["review_date"] == "2026-12-30"
    assert out["customers"]["problem"] == "Office workers have no time to wash their cars." and out["offer"]["customer_promise"] == "Clean cars for Abuja office workers"
    assert out["delivery"]["capacity_available"] == "520" and out["delivery"]["capacity_unit"] == "hours"      # 3 people × 40 h a week
    assert out["operations"]["process"].startswith("An enquiry or order comes in, the car wash subscription is agreed")
    assert out["market"]["message"] == "Clean cars for Abuja office workers: car wash subscription for office workers. From ₦15,000."
    assert out["economics"]["shared_cost_method"].startswith("Shared costs (rent, staff, utilities) are split")
    assert "use_of_funds" not in out and "purpose" not in out      # never a funding field
    assert out.get("geography")      # offered as a draft (25 Oct), here accepted
    # What the owner typed is theirs: a real place stays
    mine = {"id": "l1", "data": {**row["data"], "geography": "Lagos"}}
    assert _fill(rules.LAUNCH, mine, data, date(2026, 10, 23))["geography"] == "Lagos"



def test_the_launch_drafts_are_its_own_numbers_and_instructions():
    # Launch drafting asks for launch fields with launch instructions, never the funding case's; numbers come back as numbers
    import asyncio
    from app.modules.agent import research

    class LLM:
        seen = {}
        async def generate_text(self, system, prompt, feature, max_tokens):
            LLM.seen = {"system": system, "prompt": prompt}
            class R:
                text = '{"fields": {"market.budget": "About NGN 20,000 a month", "planned_volume.amount": "15 customers", "offer.delivery_terms": "Washed at the office car park; paid monthly in advance.", "delivery.dependencies": [{"name": "Water supply", "kind": "supplier", "contingency": "Stored water tank"}]}}'
            return R()
    only = {k: research.CASE_DRAFT_FIELDS["launch"][k] for k in ("market.budget", "planned_volume.amount", "offer.delivery_terms", "delivery.dependencies")}
    out = asyncio.run(research.draft_case_fields(LLM(), "launch", {"currency": "NGN"}, only=only))
    assert "market.budget" not in out and out["planned_volume.amount"] == "15"      # a budget not on record is asked, never drafted (28 Oct)
    assert out["offer.delivery_terms"].startswith("Washed at the office") and out["delivery.dependencies"][0]["name"] == "Water supply"
    assert "launch one offering" in LLM.seen["system"] and "funding case" not in LLM.seen["system"]


def test_a_launch_run_works_out_its_own_figures_instead_of_asking():
    # The owner's QA, 23 Oct: after "Do it for me" the launch still asked hours per person, sales a month and the owner.
    from datetime import datetime, timezone
    from app.modules.agent import research
    i = research.launch_estimates({"price": 30.0, "cost": 10.0, "fixed_costs": 400.0})
    assert i["hours_per_person"] == 160.0 and i["monthly_sales"] == 20.0      # 400 / (30 - 10): break-even
    assert i["_from"]["monthly_sales"].startswith("My estimate")
    # A saved run, opened again: its open questions are answered from the workspace and my estimates, free
    q = lambda f: {"id": f, "kind": "question", "field": f, "criterion": "delivery", "label": f, "question": "?", "decision": None}      # noqa: E731
    run = {"id": "rr1", "goal": "launch", "status": "review", "created_at": datetime.now(timezone.utc).isoformat(), "answers": {"sell": "Home cleaning"},
           "inputs": {"price": 30.0, "cost": 10.0, "fixed_costs": 400.0, "team_size": 2.0, "hours_per_job": 2.0}, "inputs_from": {},
           "items": [q("hours_per_person"), q("monthly_sales"), q("launch_owner"), q("dry_run")]}
    data = {"workspace_profile": {"company_name": "QA Sparkle", "contact_name": "Ada Lovelace", "country": "United Kingdom"}}
    out = research.redraft(run, data)
    by = {x.get("field") or x.get("derive"): x for x in out["items"]}
    assert by["hours_per_person"]["kind"] == "reused" and by["hours_per_person"]["value"] == 160.0
    assert by["monthly_sales"]["kind"] == "reused" and by["launch_owner"]["value"] == "Ada Lovelace"
    assert by["dry_run"]["kind"] == "question"      # only the owner knows whether they have tested an order
    assert "capacity" in by      # worked out now that its figures are there


def test_a_launch_plan_is_filled_from_its_own_business_never_another_ones_words():
    # The owner's QA, 23 Oct: a home-cleaning workspace whose profile spoke of "Food" and a dog-grooming van, a chat that said
    # it sold "readiness". Synthetic: the business's own service, the plan's price per unit, a full-time month per person.
    from datetime import date
    from app.modules.readiness import rules
    from app.modules.readiness.service import ReadinessService
    row = {"id": "l2", "data": {"name": "My launch, April 2027", "target_date": "2027-04-30", "business_model": "service",
                                "economics": {"price_per_unit": "65.0", "variable_cost_per_unit": 8.0}}}
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning", "city": "Leeds", "country": "United Kingdom", "company_size": "2-5",
                                  "services": [{"service_name": "Home cleaning"}], "key_offering_focus": "Food",
                                  "problem": "Busy dog owners struggle to get to a groomer; we come to their door with a fully equipped van."},
            "_owner_name": "Ada (owner)"}
    out = _fill(rules.LAUNCH, row, data, date(2026, 10, 23))
    assert out["offer"]["launch_scope"] == "Home cleaning" and out["offer"]["price"] == "65.0"
    assert out["name"] == "Home cleaning, Leeds, April 2027"
    assert not (out.get("customers") or {}).get("problem")      # another business's problem is never copied
    assert out["delivery"]["capacity_available"] == "320"      # 2 people × 160 hours
    assert out["control"]["milestones"][0]["outcome"] == "Home cleaning launched"


def test_a_launch_plan_lists_only_the_catalogue_item_it_launches():
    # One plan per offering (the owner, 23 Oct): the catalogue item matching what the plan launches, never the whole
    # catalogue; nothing when it is new to the catalogue.
    from datetime import date
    from app.modules.readiness import rules
    from app.modules.readiness.service import ReadinessService
    svc = ReadinessService.__new__(ReadinessService)
    cat = {"catalogue": {"products": [{"id": "p1", "name": "Home cleaning", "base_price": 65}, {"id": "p2", "name": "End of tenancy cleaning", "base_price": 180}]}}
    values, _ = svc.prefill(rules.LAUNCH, {**cat, "_case_now": {"offer": {"launch_scope": "End of tenancy cleaning"}}}, date(2026, 10, 23))
    assert values["offerings"] == [{"id": "p2", "name": "End of tenancy cleaning"}] and values["economics.price_per_unit"] == 180
    values, _ = svc.prefill(rules.LAUNCH, {**cat, "_case_now": {"offer": {"launch_scope": "Gutter clearing"}}}, date(2026, 10, 23))
    assert "offerings" not in values


def test_a_launch_plan_follows_its_own_offering_and_refreshes_the_agents_old_drafts():
    # The owner's QA, 23 Oct: a drone cleaning plan's process spoke of the profile's car wash subscription.
    from datetime import date
    from app.modules.readiness import rules
    from app.modules.readiness.service import ReadinessService
    old = "An enquiry or order comes in, the car wash subscription is agreed and paid for, it is delivered, and the payment is recorded."
    row = {"id": "l3", "data": {"name": "Drone Cleaning, November 2026", "offer": {"launch_scope": "Drone Cleaning"}, "operations": {"process": old},
                                "provenance": {"operations.process": {"source": "Suggested by the Agent: a first outline", "value": old}}}}
    data = {"workspace_profile": {"company_name": "E2E Car Wash", "key_offering_focus": "Car wash subscription", "services": [{"service_name": "Car wash subscription"}]}}
    svc = ReadinessService.__new__(ReadinessService)
    out = _fill_svc(svc, rules.LAUNCH, row, data, date(2026, 10, 23))
    assert out["operations"]["process"].startswith("An enquiry or order comes in, the drone cleaning is agreed")
    # Typed by the owner: never replaced
    mine = {"id": "l3", "data": {**row["data"], "operations": {"process": "We book a slot, fly the drone, invoice on the day."}}}
    again = _fill_svc(svc, rules.LAUNCH, mine, data, date(2026, 10, 23))
    assert (again or mine["data"])["operations"]["process"] == "We book a slot, fly the drone, invoice on the day."


def test_a_new_offerings_plan_never_borrows_the_main_offerings_tagline():
    # The owner's QA, 23 Oct: "my product is drone cleaning, why are you talking about cars"
    from datetime import date
    from app.modules.readiness import rules
    from app.modules.readiness.service import ReadinessService
    row = {"id": "l4", "data": {"offer": {"launch_scope": "Drone Cleaning", "price": "4000"}, "audience": "Office managers", "geography": "Abuja, Nigeria"}}
    data = {"workspace_profile": {"company_name": "E2E Car Wash", "key_offering_focus": "Car wash subscription", "tagline": "Clean cars for Abuja office workers",
                                  "problem": "Office workers have no time to wash their cars.", "country": "Nigeria"}}
    out = _fill(rules.LAUNCH, row, data, date(2026, 10, 23))
    assert "car" not in out["market"]["message"].lower() and out["market"]["message"].startswith("Drone Cleaning for office managers in Abuja")
    assert not (out.get("customers") or {}).get("problem") and not (out.get("offer") or {}).get("customer_promise")


def test_an_action_already_done_is_not_offered_again():
    # The owner's QA, 23 Oct: "I have added the product to the catalogue, why is it still here?"
    from app.modules.agent import goals
    session = {"goal_key": "launch", "inputs": {"sell": "Drone Cleaning", "price": "4000", "kind": "service"}, "created_at": "2026-10-23T00:00:00+00:00"}
    data = {"workspace_profile": {"country": "Nigeria"}, "catalogue": {"products": []}}
    before = goals.first_value_of(session, data)
    assert any((x.get("catalogue") or {}).get("name") == "Drone Cleaning" for x in before["free_next_actions"])
    data["catalogue"]["products"] = [{"id": "p9", "name": "Drone Cleaning", "base_price": 4000}]
    after = goals.first_value_of(session, data)
    assert not any((x.get("catalogue") or {}).get("name") == "Drone Cleaning" for x in after["free_next_actions"])


def test_a_business_plan_started_from_a_launch_plan_is_about_that_plans_offering():
    # The owner's QA, 23 Oct: "why is the business plan also about car wash, it should be about the product"
    import asyncio
    from types import SimpleNamespace
    from app.modules.agent import workflows
    data = {"workspace_profile": {"company_name": "E2E Car Wash Abuja", "about_company": "A car wash subscription for office workers in Abuja.",
                                  "services": [{"service_name": "Car wash subscription"}], "country": "Nigeria"},
            "_launch": {"id": "l1", "offering": "Drone Cleaning", "customer": "Office managers", "problem": "High windows are costly to clean.",
                        "location": "Abuja, Nigeria", "title": "Drone Cleaning, November 2026"}}
    ctx = SimpleNamespace(params={"subject_id": "l1"}, answers={}, run={"state": {}, "business_id": "A", "id": "r1"}, rt=None, actor=None)
    idea, separate = asyncio.run(workflows._idea_for(ctx, data))
    assert separate and idea["description"] == "Drone Cleaning" and idea["customer"] == "Office managers"
    assert "car wash" not in str(idea).lower()


def test_a_draft_in_needs_approval_is_named_once_and_opens_with_its_review_bar():
    # The owner's QA, 23 Oct: "Business plan: Business plan", and no Accept, Edit or Reject on it
    from app.modules.agent import drafts
    d = {"id": "dr-1", "kind": "business_plan", "title": "Business Plan for E2E Car Wash Abuja", "to": "/blueprint?tab=business-plans&document_id=x"}
    c = drafts.card(d)
    assert c["title"] == "Business plan: E2E Car Wash Abuja" and c["to"].endswith("&review=dr-1") and c["draft_id"] == "dr-1"
    assert drafts.card({**d, "title": "Business plan"})["title"] == "Business plan"
    assert drafts.card({**d, "title": "Drone Cleaning"})["title"] == "Business plan: Drone Cleaning"


def test_a_deleted_documents_draft_leaves_needs_approval_and_drafts_are_always_named():
    # The owner's QA, 23 Oct: "it should have a name; I just deleted it from the blueprints, why still on the approval?"
    from app.modules.agent import drafts
    data = {"agent_drafts": [{"id": "dr-1", "kind": "business_plan", "title": "Business plan", "to": "/blueprint?tab=business-plans&document_id=doc-9",
                              "ref": "doc-9", "status": "pending"}]}
    assert drafts.untitled(data["agent_drafts"][0])
    assert drafts.card(data["agent_drafts"][0], "Business Plan for Drone Cleaning")["title"] == "Business plan: Drone Cleaning"
    assert drafts.withdraw(data, "doc-9") == 1 and drafts.pending(data) == []


def test_a_bare_request_for_a_plan_or_an_idea_check_is_asked_about_first():
    # The owner's QA, 23 Oct: "it should be conversational, ask some basic questions too" (a business plan, an idea check)
    import sys
    sys.path.insert(0, "tests")
    from test_agent import Env
    env = Env()
    plan = env.submit(text="i need business plan")
    assert plan["kind"] == "needs_input" and [f["key"] for f in plan["fields"]][-1] == "purpose"
    idea = env.submit(text="validate my idea")
    assert idea["kind"] == "needs_input" and idea["fields"][0]["key"] == "idea_for"
    assert {o["value"] for o in idea["fields"][0]["options"]} >= {"business", "new"}
    described = env.submit(text="validate my idea of a drone cleaning service in Abuja")
    assert described.get("kind") != "needs_input" or described["fields"][0]["key"] != "idea_for"      # said already: not asked which idea


def test_a_plan_can_be_for_something_new_and_a_typo_is_still_asked_which_idea():
    # The owner's QA, 23 Oct: "no new option?", and "i need an i dea validation" went straight to its price
    import sys
    sys.path.insert(0, "tests")
    from test_agent import Env
    env = Env()
    plan = env.submit(text="i need business plan")
    choice = next(f for f in plan["fields"] if f["key"] == "plan_for")
    assert [o["value"] for o in choice["options"]][-1] == "new"
    assert next(f for f in plan["fields"] if f["key"] == "idea")["show_if"] == {"plan_for": "new"}
    typo = env.submit(text="i need an i dea validation")
    assert typo["kind"] == "needs_input" and typo["fields"][0]["key"] == "idea_for"


def test_a_new_ideas_plan_inputs_are_worked_out_and_never_borrow_the_business(monkeypatch):
    # The owner's QA, 23 Oct: a window cleaning plan was drafted as "Consulting", with no problem, its name as the value proposition
    import asyncio
    from types import SimpleNamespace
    from app.modules.agent import research, workflows

    class LLM:
        async def generate_text(self, **_k):
            return SimpleNamespace(text='{"problem": "Office windows go uncleaned for months.", "customer": "Office managers in Abuja", '
                                        '"value_prop": "Spotless windows on a fixed monthly visit.", "industry": "Commercial cleaning"}')
    monkeypatch.setattr(research, "_default_llm", lambda _u: LLM())
    ctx = SimpleNamespace(actor=SimpleNamespace(user_id="u1"), run={"id": "r1"})
    idea = {"description": "Window cleaning", "customer": "", "problem": "", "separate": True}
    out = asyncio.run(workflows._fill_idea(ctx, idea))
    assert (out["industry"], out["customer"]) == ("Commercial cleaning", "Office managers in Abuja")
    assert out["problem"].startswith("Office windows") and out["value_prop"].startswith("Spotless")
    kept = asyncio.run(workflows._fill_idea(ctx, {**idea, "customer": "Hotels"}))
    assert kept["customer"] == "Hotels"      # what was given stays


def test_a_misspelt_idea_is_corrected_and_another_idea_never_replaces_it(monkeypatch):
    # The owner's QA, 23 Oct: "why didn't it correct me? I mean cleaning"
    import asyncio
    from types import SimpleNamespace
    from app.modules.agent import research, workflows
    said = {"name": "Window cleaning"}

    class LLM:
        async def generate_text(self, **_k):
            return SimpleNamespace(text='{"name": "%s", "problem": "p", "customer": "c", "value_prop": "v", "industry": "Commercial cleaning"}' % said["name"])
    monkeypatch.setattr(research, "_default_llm", lambda _u: LLM())
    ctx = SimpleNamespace(actor=SimpleNamespace(user_id="u1"), run={"id": "r1"})
    out = asyncio.run(workflows._fill_idea(ctx, {"description": "window cleanig", "separate": True}))
    assert out["description"] == "Window cleaning" and out["name"] == "Window cleaning"
    said["name"] = "Dog grooming van"
    other = asyncio.run(workflows._fill_idea(ctx, {"description": "window cleanig", "separate": True}))
    assert other["description"] == "window cleanig"      # not the same words: never swapped for another idea


def test_what_the_owner_says_wins_over_a_profile_that_speaks_of_something_else():
    # G1, 23 Oct: a home cleaning plan written as "Industry: Pet grooming" from a contaminated profile
    from app.modules.agent import workflows
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "description": "Mobile dog grooming van serving Leeds suburbs",
                                  "about_company": "QA Sparkle Cleaning Ltd is building its business", "key_offering_focus": "Food", "city": "Leeds"}}
    clash = workflows.profile_conflict(data, "Home and end-of-tenancy cleaning in Leeds")      # both say Leeds: the place is no agreement
    assert set(clash) == {"description", "key_offering_focus"}      # about_company names cleaning too: no clash there
    assert workflows.profile_conflict(data, "Mobile dog grooming for Leeds") == {"key_offering_focus": "Food"} or \
        "description" not in workflows.profile_conflict(data, "Mobile dog grooming for Leeds")
    assert workflows.profile_conflict({"workspace_profile": {"description": "Home cleaning"}}, "End of tenancy cleaning") == {}
