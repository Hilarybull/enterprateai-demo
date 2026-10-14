"""§1 (P3, R1, R2): only accepted values are reused, each with its basis, source and date; an accepted value fills an empty
field of the business's own record (with Undo), asks when the record says something else, and "this case only" leaves
the record as it is. Forecasts never reach the actual records; Funding reuses what Launch accepted."""
import copy

from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import planned, record_sync, research
from app.modules.agent import router as agent_router
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run

AT = "2026-10-13T20:00:00+00:00"


def test_a_proposed_value_is_never_reused_and_an_accepted_one_shows_its_basis_source_and_date():
    data = {"shared_answers": {
        "price": {"value": 45, "state": "proposed", "source": "Researched", "at": AT},                                # AI, not accepted
        "monthly_sales": {"value": 40, "state": "accepted", "basis": "forecast", "source": "From your launch review", "at": AT},
        "cost": {"value": 12, "state": "accepted", "basis": "estimate", "source": "From your launch review (an estimate you adopted)", "at": AT}}}
    f = planned.figures(data)
    assert "price" not in f
    assert (f["monthly_sales"]["basis"], f["monthly_sales"]["source"], f["monthly_sales"]["at"]) == ("forecast", "From your launch review", "2026-10-13")
    assert f["cost"]["basis"] == "estimate" and "estimate" in planned.monthly(data)["sources"]["cost"]


def _data(price=0):
    return {"catalogue": {"products": [{"id": "p1", "name": "Dog grooming", "base_price": price, "cost_of_sales": None}]}}


def test_an_empty_field_is_filled_and_said_and_undo_puts_it_back_and_is_logged():
    d = _data(price=0)
    out = record_sync.sync(d, {"price": 65, "cost": 15}, "Dog grooming", "launch", AT, OWNER)
    assert d["catalogue"]["products"][0]["base_price"] == 65 and d["catalogue"]["products"][0]["cost_of_sales"] == 15
    assert [s["message"] for s in out["saved"]][0].startswith("Saved to your Catalogue") and out["conflicts"] == []
    assert record_sync.undo(d, out["saved"][0]["undo_id"], AT, OWNER) == {"undone": True}
    assert d["catalogue"]["products"][0]["base_price"] == 0                          # the empty field back
    assert [c["source"] for c in d["record_changes"]][-1].startswith("undo of")       # logged


def test_a_different_value_is_asked_about_never_overwritten_and_case_only_leaves_the_record():
    d = _data(price=60)
    out = record_sync.sync(d, {"price": 65}, "Dog grooming", "launch", AT, OWNER)
    assert out["saved"] == [] and d["catalogue"]["products"][0]["base_price"] == 60
    q = out["conflicts"][0]["question"]
    assert q == "Update your Catalogue price for Dog grooming from 60.00 to 65.00, or use 65.00 for this launch only?"
    record_sync.choose(d, out["conflicts"][0], "case_only", AT, OWNER)
    assert d["catalogue"]["products"][0]["base_price"] == 60 and out["conflicts"][0]["choice"] == "case_only"
    same = record_sync.sync(_data(price=65), {"price": 65}, "Dog grooming", "launch", AT, OWNER)
    assert same == {"saved": [], "conflicts": []}                                  # the same value: nothing to do


def _client(env, monkeypatch, user=OWNER):
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    from app.modules.agent import goal_router
    monkeypatch.setattr(goal_router, "get_orchestrator", lambda: env.orch)
    app.dependency_overrides[get_current_user] = lambda: {"id": user, "email": user}
    return TestClient(app)


def test_the_owners_choice_updates_the_record_only_with_write_permission_and_can_be_undone(monkeypatch):
    env = Env()
    d = env.businesses["A"]["data"]
    d["catalogue"]["products"] = [{"id": "p1", "name": "Dog grooming", "base_price": 60}]
    conflict = record_sync.sync(d, {"price": 65}, "Dog grooming", "launch", AT, OWNER)["conflicts"][0]
    d.setdefault("research_runs", {})["rr1"] = {"id": "rr1", "status": "adopted", "record_sync": {"saved": [], "conflicts": [conflict]}}
    try:
        from test_agent import MEMBER
        env.businesses["A"]["members"][MEMBER]["permissions"]["modules"] = ["blueprint"]      # can view, can't edit the Catalogue (Operations)
        member = _client(env, monkeypatch, MEMBER)
        assert member.post("/businesses/A/research/rr1/record-choice", json={"field": "price", "choice": "update"}).status_code in (403, 404)
        assert d["catalogue"]["products"][0]["base_price"] == 60
        owner = _client(env, monkeypatch)
        res = owner.post("/businesses/A/research/rr1/record-choice", json={"field": "price", "choice": "update"}).json()
        assert res["changed"] is True and d["catalogue"]["products"][0]["base_price"] == 65
        assert owner.post(f"/businesses/A/record-changes/{res['undo_id']}/undo").json() == {"undone": True}
        assert d["catalogue"]["products"][0]["base_price"] == 60
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_forecasts_never_reach_the_actual_records():
    env = Env()
    d = env.businesses["A"]["data"]
    d["financials"]["invoices"] = []
    d["shared_answers"] = {k: {"value": v, "state": "accepted", "basis": "forecast", "source": "From your launch review", "at": AT}
                           for k, v in (("price", 45), ("monthly_sales", 40), ("fixed_costs", 800), ("cost", 12))}
    before = copy.deepcopy(d["financials"])
    for cap in ("price_test", "expansion_scenario", "capacity_check", "offer_review"):
        env.submit(capability=cap, channel="ui_action")
    assert d["financials"] == before                                              # no revenue or transaction written from a plan


def test_funding_reuses_what_launch_accepted():
    data = {"shared_answers": {"monthly_sales": {"value": 40, "offering": "Dog grooming", "goal": "launch", "state": "accepted", "basis": "forecast",
                                                 "source": "From your launch review", "at": AT}}}
    got = research.inputs_of("need_funding", {"sell": "Dog grooming"}, data)
    assert got["monthly_sales"] == 40 and got["_from"]["monthly_sales"] == "From your launch review"
