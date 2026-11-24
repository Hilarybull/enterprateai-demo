"""New-User Test F2, F3: Replace keeps the business's facts and takes the new date; a conflict is answered before any drafting."""
import asyncio
from datetime import date

from app.modules.agent import converse, goal_router, goals
from app.modules.readiness import rules
from app.modules.readiness.service import service_for
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401 - the fixture


def run(c):
    return asyncio.run(c)


def test_every_way_of_saying_when_becomes_a_date():
    t = date(2026, 11, 1)
    for said, day in (("3 to 6 months", "2027-05-31"), ("In 3 to 6 months", "2027-05-31"), ("3-6 months", "2027-05-31"), ("within 3 months", "2027-02-28")):
        assert goals.end_of_month(said, t) == day, said
    assert goals.end_of_month("Not sure yet", t) is None and goals.end_of_month("3,000 a month", t) is None


def test_replace_keeps_the_business_facts_and_never_the_old_date(world):  # noqa: F811
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(goal_router.get_orchestrator())
    case = run(svc.create_subject(OWNER, "A", rules.FUNDING, {
        "title": "Old need", "target_amount": 250000, "currency": "GBP", "purpose": "A warehouse", "receipt_date": "2027-01-31",
        "market": {"target_segment": "Cafes", "differentiation": "Same day", "location": "Leeds"},
        "traction": {"summary": "12 customers", "customers": 12}}, None))
    made = run(svc.replace_need(OWNER, "A", case["id"], {"target_amount": 50000, "purpose": "Equipment", "market": {"location": "Manchester"}}, None, summary="Old need"))
    data = made["data"]
    assert data["market"] == {"target_segment": "Cafes", "differentiation": "Same day", "location": "Manchester"}      # carried, and what was said wins
    assert data["traction"]["customers"] == 12
    assert not data.get("receipt_date")      # the old date never stays
    old = data["previous_needs"][0]
    assert old["values"]["receipt_date"] == "2027-01-31" and old["set_aside"]["traction"]["customers"] == 12      # and History still has it all


def test_a_figure_that_differs_from_the_records_is_settled_once():
    case = {"id": "c1", "data": {"traction": {"customers": 12}, "market": {"location": "Manchester"}}}
    data = {"workspace_profile": {"city": "Leeds"}}
    assert [h["path"] for h in converse.figures_to_settle(case, data)] == ["market.location"]
    assert converse.figures_to_settle(case, {**data, "records_settled": {"c1": True}}) == []
    assert converse.figures_to_settle({"id": "c1", "data": {"market": {"location": "Leeds, UK"}}}, data) == []


def test_it_waits_for_the_answer_before_any_price_or_drafting(world, monkeypatch):  # noqa: F811
    env, store, client, who = world
    who["user"] = OWNER
    orch = goal_router.get_orchestrator()
    case = {"id": "c1", "data": {"market": {"location": "Manchester"}}}
    data = {"workspace_profile": {"city": "Leeds"}}
    started = []
    monkeypatch.setattr(converse, "_start_do_all", lambda *a, **k: started.append(1))
    out = run(converse._ask_do_all(orch, {"id": OWNER, "email": OWNER}, "A", case, data, "do it all", converse.datetime.now(converse.timezone.utc), go_now=True))
    words = str(out)
    assert "Before I draft anything" in words and "Manchester" in words and "Leeds" in words and "Use my records" in words
    assert started == []
