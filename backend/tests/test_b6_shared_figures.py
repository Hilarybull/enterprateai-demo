"""B6: figures adopted in a launch readiness review (prices, unit cost, fixed costs, sales a month, demand evidence) are
read by every other tool. Before revenue exists, the growth tools work from them, labelled as planned, and never say
"none on record"; Launch Evidence reports the same score and coverage the review page shows; Readiness Refresh runs when
asked, and when the figures behind a review change it scores the review again as a new version."""
import copy

from app.modules.agent import planned      # §2 replaced the review re-scoring tests: see test_s2_one_assessment.py
from test_agent import OWNER, Env, run

ADOPTED_AT = "2026-10-13T20:00:00+00:00"
SHARED = {
    "price": {"value": 45.0, "offering": "Dog grooming", "goal": "launch", "at": ADOPTED_AT, "source": "From your launch readiness review"},
    "cost": {"value": 12.0, "offering": "Dog grooming", "goal": "launch", "at": ADOPTED_AT, "source": "From your launch readiness review"},
    "fixed_costs": {"value": 800.0, "offering": "Dog grooming", "goal": "launch", "at": ADOPTED_AT, "source": "From your launch readiness review"},
    "monthly_sales": {"value": 40.0, "offering": "Dog grooming", "goal": "launch", "at": ADOPTED_AT, "source": "From your launch readiness review"},
}
REVIEW = {"version": 1, "created_at": ADOPTED_AT, "created_by": OWNER, "answers": {"sell": "Dog grooming", "evidence": "5 neighbours booked a paid trial"},
          "inputs": {"price": 45.0, "cost": 12.0, "fixed_costs": 800.0, "monthly_sales": 40.0}, "inputs_from": {}, "adopted": [],
          "result": {"score": 60, "evidence_coverage": 90, "blockers": 0, "strengths": [],
                     "criteria": [{"key": "demand", "label": "Demand evidence", "state": "met"}, {"key": "process", "label": "A dry run of the service", "state": "unknown"}]}}


def _env():
    env = Env()
    d = env.businesses["A"]["data"]
    d["financials"]["invoices"] = []                                       # no revenue on record
    d.setdefault("catalogue", {})["products"] = []                         # "no prices in your catalogue"
    d["shared_answers"] = copy.deepcopy(SHARED)
    d["assessment_datasets"] = {"launch": [copy.deepcopy(REVIEW)]}
    return env


def _do(env, capability):
    return env.submit(capability=capability, channel="ui_action")["run"]


def test_the_adopted_figures_are_read_the_same_way_everywhere_with_source_and_date():
    f = planned.figures(_env().businesses["A"]["data"])
    assert {k: f[k]["value"] for k in ("price", "cost", "fixed_costs", "monthly_sales")} == {"price": 45, "cost": 12, "fixed_costs": 800, "monthly_sales": 40}
    assert f["price"]["source"] == "From your launch readiness review" and f["price"]["at"] == "2026-10-13"


def test_before_revenue_the_growth_tools_work_from_the_planned_figures_labelled_as_planned():
    env = _env()
    price = _do(env, "price_test")
    assert price["status"] == "succeeded" and price["summary"].startswith("Planned figures") and "£1,800.00 a month" in price["summary"]
    assert "launch readiness review" in price["summary"] and price["state"]["outcome"]["planned"] is True
    grow = _do(env, "expansion_scenario")
    assert grow["summary"].startswith("Planned figures") and "none is on record" not in grow["summary"]
    offer = _do(env, "offer_review")
    assert "Planned:" in offer["summary"] and "£45.00" in offer["summary"] and "73% margin" in offer["summary"]
    for r in (price, grow, offer):
        assert "none on record" not in r["summary"] and "none is on record" not in r["summary"], r["summary"]


def test_a_scenario_that_needs_costs_uses_the_planned_costs():
    env = _env()
    r = env.submit(text="what happens if my costs go up 10%")["run"]
    assert "This needs your costs" not in (r.get("summary") or ""), r.get("summary")


def test_a_planned_figure_answered_in_one_tool_is_used_by_the_next():
    env = Env()
    env.businesses["A"]["data"]["financials"]["invoices"] = []
    r = _do(env, "capacity_check")
    assert "planned" in r["pending_question"]["question"]
    r = run(env.orch.provide_input(r["id"], OWNER, {"monthly_sales": 20, "capacity": 30}))
    assert r["status"] == "succeeded" and r["summary"].startswith("Planned figures")
    assert planned.figures(env.businesses["A"]["data"])["monthly_sales"]["value"] == 20      # kept, labelled planned, for every other tool


def test_a_written_answer_is_given_the_adopted_figures_and_the_reviews_own_results(monkeypatch):
    from test_agent_employee import Chat
    env = _env()
    chat = Chat(monkeypatch, env)
    chat.say("how ready is my launch and what are my prices?")
    prompt = chat.prompts[-1]
    assert "ADOPTED AND PLANNED FIGURES" in prompt and '"evidence_coverage":90' in prompt.replace(" ", "") and "launch readiness review" in prompt
