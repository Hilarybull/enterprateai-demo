"""Round 10 (the owner's QA, 21 Oct): the case is filled from the other modules with only what is about this business, and
services get a suggested description with the brand fields."""
from datetime import date

from app.modules.agent import profile_fill
from app.modules.readiness import rules
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


def _fill(*a):
    from app.modules.readiness.service import ReadinessService as _R
    return accept_all(_R._fill_blanks(_R.__new__(_R), *a))


def _fill_svc(svc, *a):
    return accept_all(svc._fill_blanks(*a))



def _data():
    return {"workspace_profile": {"company_name": "Synthetic Cleaning", "city": "Leeds", "country": "United Kingdom",
                                  "services": [{"service_name": "Home cleaning"}, {"service_name": "End of tenancy cleaning", "description": "Deep clean."}],
                                  "usp": "A fully equipped mobile grooming van that comes to the door."},
            "quick_check_answers": {"need_funding": {"answers": {"customer": "anybody"}}, "more_customers": {"answers": {"channel": "Local Facebook groups"}}},
            "assessment_datasets": {"need_funding": [{"answers": {}, "inputs": {}, "adopted": [{"field": "team", "decision": "answered", "answer": "22 people"}]}]}}


def test_only_what_is_about_this_business_fills_the_case():
    values, _prov = ReadinessService.already_said(rules.FUNDING, _data(), date(2026, 10, 21))
    assert "market.acquisition_owner" not in values and "team.responsibilities" not in values      # a count, not who
    assert "market.target_segment" not in values                                                     # "anybody" is no answer
    assert "market.differentiation" not in values                                                    # another business's words
    assert values["market.location"] == "Leeds, United Kingdom"
    assert values["market.acquisition_approach"] == "Local Facebook groups"                         # from the customers check


def test_services_without_a_description_are_drafted_with_the_brand_fields():
    data = _data()
    brief = profile_fill.brand_brief(data)
    assert "service_descriptions" in brief["fields"] and brief["services"] == ["Home cleaning"]
    profile_fill.apply_brand(data, {"service_descriptions": {"home cleaning": "Regular cleaning for busy households in Leeds."}})
    s = data["workspace_profile"]["services"]
    assert s[0]["service_description"] == "Regular cleaning for busy households in Leeds." and s[0]["description_suggested"] is True
    assert s[1]["description"] == "Deep clean."      # the owner's own is kept


def test_wrong_values_put_in_for_the_owner_are_cleared_and_theirs_kept():
    data = _data()
    row = {"kind": rules.FUNDING, "data": {"market": {"target_segment": "anybody", "differentiation": "A mobile grooming van.", "acquisition_owner": "22 people"},
                                           "provenance": {"market.target_segment": {"value": "anybody"}, "market.differentiation": {"value": "A mobile grooming van."},
                                                          "market.acquisition_owner": {"value": "22 people"}}}}
    out = _fill(rules.FUNDING, row, data, date(2026, 10, 21))
    m = out["market"]
    assert not m.get("target_segment") and not m.get("differentiation") and not m.get("acquisition_owner")
    assert m["location"] == "Leeds, United Kingdom"
    # Typed by the owner (no provenance left): kept, whatever it says.
    mine = {"kind": rules.FUNDING, "data": {"market": {"target_segment": "anybody"}, "provenance": {}}}
    kept = _fill(rules.FUNDING, mine, data, date(2026, 10, 21))
    assert (kept or mine["data"])["market"]["target_segment"] == "anybody"


def test_the_agent_drafts_what_is_still_blank_and_never_another_offerings_words(monkeypatch):
    import asyncio
    import json as _json
    from types import SimpleNamespace
    from app.modules.agent import research
    data = {**_data(), "workspace_profile": {**_data()["workspace_profile"], "description": "Mobile dog grooming van serving Leeds suburbs",
                                             "target_customer": "Dog owners in Leeds suburbs", "target_customer_type": "Busy professionals and families in Leeds"}}
    seen = {}

    class Model:
        async def generate_text(self, *, system, prompt, feature, max_tokens):
            seen["prompt"] = prompt
            return SimpleNamespace(text=_json.dumps({"fields": {
                "market.acquisition_approach": "Leaflets and local Facebook groups in Leeds, then repeat bookings",
                "market.differentiation": "A mobile grooming van at the door",
                "risks": [{"risk": "Few repeat bookings", "action": "Offer a monthly plan"}]}}))
    monkeypatch.setattr(research, "_default_llm", lambda _u: Model())

    class Store:
        def __init__(self, row):
            self.row = row

        async def get(self, _table, _id):
            return self.row

        async def update(self, _table, _id, patch, bump=False):
            self.row = {**self.row, **patch}
            return self.row
    row = {"id": "c1", "kind": rules.FUNDING, "data": {}}
    svc = ReadinessService.__new__(ReadinessService)
    svc.store = Store(row)
    ReadinessService._DRAFTED_ON.clear()

    async def go():
        svc._draft_blanks_later("u1", rules.FUNDING, row, {"data": data, "today": date(2026, 10, 21), "now": "2026-10-21T10:00:00Z"})
        for _ in range(100):      # drafted in the background: waited for, up to 5 s
            if (svc.store.row.get("data") or {}).get("agent_drafts"):
                break
            await asyncio.sleep(0.05)
    asyncio.run(go())
    assert not (svc.store.row["data"].get("market") or {}).get("acquisition_approach")      # never written for the owner (25 Oct)
    case = accept_all(svc.store.row["data"])      # the drafts, accepted
    assert case["market"]["acquisition_approach"].startswith("Leaflets")
    assert "differentiation" not in case["market"]                       # another offering's words: never put in
    assert case["risks"][0]["risk"] == "Few repeat bookings" and case["risks"][0]["id"]
    assert svc.store.row["data"]["agent_drafts"]["market.acquisition_approach"]["source"]      # a draft, with where it came from
    assert "grooming" not in seen["prompt"]                                # nor sent to the model


def test_months_gone_by_become_actuals_from_business_operations():
    data = {"settings": {"currency": "GBP"}, "financials": {
        "invoices": [{"id": "a", "status": "paid", "total_amount": 450, "currency": "GBP", "paid_at": "2026-09-14", "customer_name": "Delta"}],
        "expenses": [{"id": "e", "status": "paid", "amount": 45, "currency": "GBP", "date": "2026-09-20"}]}}
    forecast = {"months": [{"month": "2026-09", "receipts": "900", "payments": "300", "basis": "forecast"},
                           {"month": "2026-10", "receipts": "900", "payments": "300", "basis": "forecast"}]}
    out = ReadinessService.roll_actuals(forecast, data, date(2026, 10, 21))
    assert out["months"][0] == {"month": "2026-09", "receipts": "450", "payments": "45", "basis": "actual", "actual_from": "Business Operations"}
    assert out["months"][1]["basis"] == "forecast"      # this month is still to come
    assert ReadinessService.roll_actuals(out, data, date(2026, 10, 21)) is None      # once only
