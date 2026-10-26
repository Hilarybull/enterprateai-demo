"""The owner, 26 Oct: "why will AI fill before the do it all for me?". Opening a funding case or launch plan never drafts
with AI; what the business's own records say fills empty fields, "From your records"; what is worked out waits as a draft."""
from datetime import date

from test_goal_onboarding import world, _launch, OWNER, run  # noqa: F401
from app.modules.readiness import rules
from app.modules.readiness.service import ReadinessService, service_for


def test_opening_a_plan_never_starts_the_ai_drafter(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _launch(client)
    called = []
    monkeypatch.setattr(ReadinessService, "_draft_blanks_later", lambda *a, **k: called.append(a))
    run(service_for(env.orch).get_subject(OWNER, "A", rules.LAUNCH, made["handoff"]["subject_id"], OWNER))
    assert called == []


def test_nothing_is_filled_without_do_all_for_me_and_after_it_everything_is_a_draft():
    """The owner, 26 Oct: "the fillers are not free... they can fill it manually"; once run, its results stay with the case."""
    row = {"id": "L1", "data": {"name": "Car wash, Abuja", "offerings": [{"name": "Car wash"}], "business_model": "service"}}
    data = {"workspace_profile": {"city": "Abuja", "country": "Nigeria"}, "catalogue": {"products": [{"name": "Car wash", "base_price": 4000, "cost_of_sales": 1500}]}}
    svc = ReadinessService.__new__(ReadinessService)
    out = svc._fill_blanks(rules.LAUNCH, row, data, date(2026, 10, 26)) or row["data"]
    assert not out.get("agent_drafts") and not (out.get("economics") or {}).get("price_per_unit") and not out.get("geography")
    paid = {**data, "research_runs": {"rr1": {"id": "rr1", "goal": "launch", "status": "review", "case_id": "L1", "created_at": "2026-10-26", "items": []}}}
    out = svc._fill_blanks(rules.LAUNCH, row, paid, date(2026, 10, 26))
    assert out["agent_drafts"]["economics.price_per_unit"]["value"] == "4000" and not (out.get("economics") or {}).get("price_per_unit")
    assert "operations.process" in out["agent_drafts"] and "geography" in out["agent_drafts"]
    other = {**data, "research_runs": {"rr1": {"id": "rr1", "goal": "launch", "status": "review", "case_id": "L2", "created_at": "2026-10-26", "items": []}}}
    assert not (svc._fill_blanks(rules.LAUNCH, row, other, date(2026, 10, 26)) or row["data"]).get("agent_drafts")      # another plan's run


def test_a_run_counts_for_its_own_case_until_the_need_is_replaced():
    run_ = {"goal": "need_funding", "status": "review", "case_id": "C1", "created_at": "2026-10-20T10:00:00Z"}
    data = {"research_runs": {"r1": run_}}
    assert ReadinessService._paid_run(rules.FUNDING, {"id": "C1", "data": {}}, data)
    replaced = {"id": "C1", "data": {"previous_needs": [{"replaced_at": "2026-10-24"}]}}
    assert not ReadinessService._paid_run(rules.FUNDING, replaced, data)        # a new need: run it again
    assert not ReadinessService._paid_run(rules.FUNDING, {"id": "C2", "data": {}}, data)        # another case's run
