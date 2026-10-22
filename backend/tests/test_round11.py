"""Synthetic: the Agent's forecast opens on the cash the records show when the owner gave none (21 Oct)."""
from datetime import date

from app.modules.readiness.service import ReadinessService


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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, {}, date(2026, 10, 21))
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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, {}, date(2026, 10, 22))
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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, {}, date(2026, 10, 22))
    assert out["purpose_milestone_id"] == "m1"



def test_every_list_item_gets_an_id_so_it_can_be_picked():
    from app.modules.readiness import rules
    row = {"data": {"milestones": [{"outcome": "Grow the customer base", "measure": "customers", "target": "20", "due_date": "2027-06-01", "owner": "A", "baseline": "1"}],
                    "team": {"responsibilities": [{"area": "Delivery", "owner": "A"}]}}}
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, {}, date(2026, 10, 22))
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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, data, date(2026, 10, 22))
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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, data, date(2026, 10, 22))
    m = out["market"]
    assert "differentiation" not in m and "location" not in m
    assert m["acquisition_cost"] == "£300 a month on local ads"



def test_the_market_fields_are_never_left_empty_when_the_records_answer_them():
    from app.modules.readiness import rules
    data = {"workspace_profile": {"company_name": "QA Sparkle Cleaning Ltd", "city": "Leeds", "country": "United Kingdom",
                                  "services": [{"service_name": "Home cleaning"}, {"service_name": "End of tenancy cleaning"}]}}
    row = {"data": {"currency": "GBP", "market": {"target_segment": "Busy professionals and families in Leeds"}, "economics": {"fixed_costs_monthly": "100"},
                    "use_of_funds": [{"id": "a1", "category": "Marketing", "amount": "6000", "purpose": "Local ads", "period": "2027-01"}]}}
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, data, date(2026, 10, 22))
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
    out = ReadinessService._fill_blanks(ReadinessService.__new__(ReadinessService), rules.FUNDING, row, data, date(2026, 10, 22)) or row["data"]
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
