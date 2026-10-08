"""The wording rule on every Dashboard card, tile and Agent Centre item (the shortcut chips are
optional quick starts and are left out), and the idea- and growth-stage work behind the tiles."""
import re

import pytest

from app.modules.agent import autostart
from app.modules.agent import config as agent_config
from app.modules.agent import router as agent_router
from app.modules.agent.summary import build_summary
from app.modules.agent.workflows import WORKFLOWS
from test_agent import ENQUIRY, OWNER, Env, run
from test_dashboard import build, growing, idea, invoice, operating
from test_readiness import funding_case, launch

BANNED = re.compile(r"\b(Run|Do this now|Validate your|Draft your|Size your|Test a|Open the|Consider|Ask Agent to|Try again|Would you like)\b", re.I)


def chores(texts):
    return sorted({str(t) for t in texts if t and BANNED.search(str(t))})


def screen_texts(env):
    """Every sentence and button label on the dashboard and in the Agent Centre, chips left out."""
    d = build(env)
    out = []
    for c in d["insights"]:
        out += [c.get("title"), c.get("text"), c.get("detail"), c.get("note"), (c.get("cta") or {}).get("label"),
                (c.get("agent_action") or {}).get("label"), (c.get("more") or {}).get("label")]
        out += [i.get("label") for i in c.get("items") or []]
    for s in d["agent"]["suggestions"]:
        out += [s.get("text"), (s.get("question") or {}).get("question")]
    for a in d.get("action_cards") or []:
        out += [a.get("title"), a.get("description"), a.get("cta")]
    report = d.get("report") or {}
    out += [report.get("title"), report.get("description"), report.get("cta"), (report.get("secondary") or {}).get("label")]
    for k in d.get("kpis") or []:
        out += [k.get("label"), k.get("hint"), k.get("value") if isinstance(k.get("value"), str) else None]
    out += [d["agent"].get("placeholder"), d.get("kpi_empty")]
    summary = run(build_summary(env.orch, OWNER, "A"))
    out += [s["text"] for s in summary["suggestions"]] + [i.get("text") for i in summary.get("insights") or []]
    out += [(i.get("cta") or {}).get("label") for i in summary.get("insights") or []]
    for r in run(env.store.list_runs("A")):
        p = agent_router._public_run(r)
        out += [p["title"], p["summary"], p["next_action"], p["error"], (p["pending_question"] or {}).get("question")]
    return [t for t in out if t]


def _stage(name):
    env = Env()
    if name == "idea":
        idea(env)
    elif name == "pre_launch":
        launch(env, forecast=False)
        funding_case(env)
    elif name == "operating":
        operating(env)
        invoice(env, "late1", "Aftred", 149, paid=False, due_in=-8)
    elif name == "growth":
        growing(env)
        invoice(env, "big", "Whale Ltd", 60000, paid_days_ago=20)
        invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    return env


@pytest.mark.parametrize("stage", ["idea", "pre_launch", "operating", "growth"])
def test_no_card_tile_or_agent_centre_item_hands_the_owner_a_chore(stage):
    env = _stage(stage)
    assert build(env)["context"]["business_stage"] == stage
    before = screen_texts(env)
    assert chores(before) == []
    run(autostart.sweep(env.orch, "A"))                                   # the Agent does its work for this stage
    run(autostart.sweep(env.orch, "A"))
    env.submit(capability="enquiry_to_quote", params=dict(ENQUIRY))
    after = screen_texts(env)
    assert len(after) >= len(before) > 10 and chores(after) == []


def test_the_empty_dashboards_pass_too_and_the_check_catches_each_phrase():
    assert chores(screen_texts(Env())) == []
    assert chores(screen_texts(Env(plan="explorer"))) == []
    for bad in ("Run scenario", "Do this now", "Validate your idea before you launch.", "Draft your business plan.", "Size your market.",
                "Test a price change before you make it.", "Open the check", "Consider a payment follow-up.", "Ask Agent to run it", "Try again",
                "Would you like me to prepare a payment follow-up?"):
        assert chores([bad]) == [bad]
    for fine in ("I ran the check again.", "See the scenario", "Open Business Plans", "I'm testing a 5% and a 10% price change.",
                 "Your idea hasn't been scored yet: I'm scoring it before you launch.", "My next attempt is on 2 Oct at 09:21 UTC."):
        assert chores([fine]) == []


def test_no_tile_is_hidden_at_any_stage():
    expect = {"idea": {"stage_validate", "stage_plan", "stage_market"}, "growth": {"stage_pricing", "stage_capacity", "stage_offer", "stage_expand"}}
    for stage, keys in expect.items():
        env = _stage(stage)
        run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))      # everything switched off
        shown = {s["key"]: s["text"] for s in build(env)["agent"]["suggestions"] if s["key"].startswith("stage_")}
        assert shown and set(shown) <= keys
        assert all(t.endswith("is switched off in Agent settings.") for t in shown.values()), shown


# ══ idea stage: the Agent scores the idea, sizes the market and drafts the plan ══

def _described(env):
    idea(env)
    env.businesses["A"]["data"]["workspace_profile"].update({"description": "Bookkeeping for independent cafés", "target_customer": "Independent cafés in Manchester",
                                                             "problem": "Owners lose evenings to paperwork", "primary_industry": "accounting", "location": "Manchester"})
    env.businesses["A"]["data"].pop("validation", None)
    env.meter.costs.update({"idea_validation": 5, "business_plan": 8})


def _tile(env, key):
    return next((s for s in build(env)["agent"]["suggestions"] if s["key"] == key), None)


def test_an_idea_is_scored_sized_and_planned_without_being_asked():
    env = Env()
    _described(env)
    if build(env)["context"]["business_stage"] != "idea":
        pytest.skip("this business is past the idea stage in the test fixture")
    done = {r["workflow_key"]: r for r in run(autostart.sweep(env.orch, "A"))}
    assert {"idea_validation", "market_size", "business_plan_draft"} <= set(done)
    assert done["idea_validation"]["summary"].startswith("Idea scored 68/100: 3 risks, 4 next steps.")
    assert done["market_size"]["summary"] == "Market sized: £180m serviceable (£2.4bn total, £1.2m obtainable), 3 assumptions listed."
    assert done["business_plan_draft"]["summary"] == "Business plan draft ready for review: 9 sections. Nothing has been sent to anyone."
    assert [c[0] for c in env.orch.rt.studio.calls] == ["validate_idea", "size_market", "draft_plan"] or len(env.orch.rt.studio.calls) == 3
    spent = {r["workflow_key"]: agent_router._public_run(r)["credits_used"] for r in run(env.store.list_runs("A"))}
    assert (spent["idea_validation"], spent["market_size"], spent["business_plan_draft"]) == (5, 5, 8)      # the price list's prices, recorded on each task
    assert env.businesses["A"]["data"]["validation"]["overall_score"] == 68
    assert not [r for r in run(autostart.sweep(env.orch, "A")) if r["workflow_key"] in done]      # once


def test_missing_information_is_one_question_on_the_tile_and_the_work_carries_on_when_answered():
    env = Env()
    idea(env)
    env.businesses["A"]["data"].pop("validation", None)
    profile = env.businesses["A"]["data"]["workspace_profile"]
    for k in ("description", "business_description", "problem", "target_customer", "target_market"):
        profile.pop(k, None)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    q = r["pending_question"]
    assert q["question"] == "What does your business do? (1 to 2 sentences)" and q["fields"][0]["key"] == "description"
    summary = run(build_summary(env.orch, OWNER, "A"))
    tile = summary["suggestions"][0]
    assert tile["text"] == "Idea Validation. What's the idea?"      # the tile says what it is about; the whole question opens from it
    assert tile["question"] == {"run_id": r["id"], "question": q["question"], "fields": q["fields"]}
    r = run(env.orch.provide_input(r["id"], OWNER, {"description": "Bookkeeping for independent cafés"}))
    assert r["pending_question"]["question"] == "Is this your customer? “Independent cafés”"      # read out of the description, so confirmed
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer": "Independent cafés"}))
    assert r["pending_question"]["question"] == "What problem does your business solve? (1 to 2 sentences)"
    r = run(env.orch.provide_input(r["id"], OWNER, {"problem": "Owners lose evenings to paperwork"}))
    assert r["status"] == "succeeded" and r["summary"].startswith("Idea scored 68/100")
    kept = env.businesses["A"]["data"]["workspace_profile"]
    assert (kept["description"], kept["target_customer"], kept["problem"]) == ("Bookkeeping for independent cafés", "Independent cafés", "Owners lose evenings to paperwork")
    assert env.orch.rt.studio.calls[0][1]["problem"] == "Owners lose evenings to paperwork"      # asked once, used from then on


def test_a_generator_that_fails_charges_nothing_and_is_tried_again_by_the_agent():
    env = Env()
    _described(env)
    env.orch.rt.studio.fail = True
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert r["status"] == "failed" and env.meter.charges == [] and agent_router._public_run(r)["retrying"] is True
    assert chores([r["error"]]) == []


# ══ growth stage: capacity, what sells, growing ═══════════════════════════════

def _busy(env):
    growing(env)
    at = env.now.isoformat()
    for n, (who, what, amount) in enumerate((("BrightTech Ltd", "Strategy Workshop", 3000), ("Nova Labs", "Strategy Workshop", 1500), ("Nova Labs", "Financial Review", 800))):
        env.fin["invoices"].append({"id": f"g{n}", "reference": f"INV-G{n}", "customer_name": who, "total_amount": amount, "status": "paid", "paid_at": at,
                                    "created_at": at, "issued_at": env.now.date().isoformat(), "product_names": [what],
                                    "payments": [{"id": f"gp{n}", "amount": amount, "paid_at": at, "receipt": {"number": f"REC-G{n}", "sent_at": at}}]})
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))


def test_the_three_growth_checks_report_results_from_the_records():
    env = Env()
    _busy(env)
    cap = env.submit(capability="capacity_check", channel="ui_action")["run"]
    assert cap["pending_question"]["question"] == "How many jobs can you deliver in a month, at most?"
    cap = run(env.orch.provide_input(cap["id"], OWNER, {"capacity": 40}))
    assert cap["status"] == "succeeded" and "a month against a capacity of 40: room for about" in cap["summary"]
    offer = env.submit(capability="offer_review", channel="ui_action")["run"]
    assert offer["summary"].startswith("Your best seller is Strategy Workshop: £4,500.00 in three months")
    grow = env.submit(capability="expansion_scenario", channel="ui_action")["run"]
    assert grow["summary"].startswith("Growing revenue by 20% adds £") and "monthly net goes from £" in grow["summary"]
    assert all(agent_router._public_run(r)["credits_used"] == 2 for r in (cap, offer, grow))      # each asked for by the owner: the task price
    texts = {s["key"]: s["text"] for s in build(env)["agent"]["suggestions"] if s["key"].startswith("stage_")}
    assert chores(texts.values()) == [] and not [t for t in texts.values() if t.startswith(("Check your", "Plan a", "Model an"))]


def test_every_capability_has_a_plan_a_cost_and_a_switch():
    automatic = {cap for _event, cap, _task in autostart.ITEMS.values()}
    assert set(agent_config.CAPABILITY_MIN_PLAN) == set(WORKFLOWS)
    from app.modules.agent import newdocs
    from app.modules.agent import moredocs
    on_request = {"scenario_help"} | {w.workflow_key for w in newdocs.NEW_WORKFLOWS + moredocs.MORE_WORKFLOWS}      # only ever started by asking
    assert automatic == set(WORKFLOWS) - on_request and automatic <= set(agent_config.AUTOMATIC_COST)
    assert all(agent_config.cost_of(c) for c in WORKFLOWS)                # and every one states what it costs
    env = Env()
    rows = [e for e in autostart.events(run(env.store.get_policy("A")), run(env.orch.entitlement("A"))) if e["key"]]
    assert len(rows) == len(autostart.ITEMS) and all(e["credits"] and e["minimum_plan_label"] in ("Explorer", "Starter") and e["switchable"] for e in rows)
