"""The owner's launch repro (QA, 15 Oct), from the landing page on a Nigeria/Abuja workspace: every value the sentence gives is
read (only what is missing is asked), the currency is the naira said, one clean line says what was captured, an existing
plan with another offering defaults to a new plan, a pending choice survives a resume, the new plan carries the price and
cost, and the free result is truthful."""
import re

from test_agent import OWNER, run
from test_goal_onboarding import world  # noqa: F401  (the fixture)
from app.modules.agent import goals
from app.modules.readiness import rules
from app.modules.readiness.service import service_for

MSG = ("I want to launch a car wash subscription for office workers in Abuja in January 2027. It's a service at testing stage, "
       "10 customers tried it, I'll charge 15000 naira a month and it costs me 6000 per customer")


def test_the_sentence_is_read_in_full_and_only_what_is_missing_is_asked():
    read = goals.extract(MSG, "launch")
    assert {k: read.get(k) for k in ("kind", "sell", "stage", "customer", "where", "evidence", "price", "cost", "currency")} == {
        "kind": "service", "sell": "car wash subscription", "stage": "testing", "customer": "office workers", "where": "Abuja",
        "evidence": "10 customers tried it", "price": 15000.0, "cost": 6000.0, "currency": "NGN"}
    assert goals.launch_date(read["target_date"]) == "2027-01-31"


def test_the_chat_asks_nothing_more_in_naira_with_one_clean_line(world):  # noqa: F811
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"text": MSG, "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "launch" and s["missing"] == [] and s["currency"] == "NGN"
    assert s["progress"] == {"answered": 6, "total": 6}      # PRD 8.1: six questions, where and when one of them
    line = s["turns"][-1]["content"]
    assert line == "Here's what I'll use:"      # one line before the recap (the owner's QA, 21 Oct) (the owner's brief, 17 Oct): never a recap or findings
    assert not re.search("[–—]", line) and "£" not in line


def test_an_existing_plan_for_another_offering_defaults_to_a_new_one_and_the_new_plan_is_truthful(world):  # noqa: F811
    env, _store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    run(svc.create_subject(OWNER, "A", rules.LAUNCH, {"name": "QA Launch UK SMB plan"}, OWNER))
    s = client.post("/task-sessions", json={"text": MSG, "entry_mode": "free_text"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": s["proposed"], "confirm": True})
    client.post(f"/task-sessions/{s['id']}/resume")
    asked = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert asked["next"] == "choose" and asked["choose"]["default"] == "new"
    # Picked up again (a reload): still at the choice, never skipped.
    again = client.post(f"/task-sessions/{s['id']}/resume").json()
    assert again["next"] == "choose"
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"subject_choice": "new"}})
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert done["state"] == "handed_off" and done["handoff"]["to"].startswith("/launch/")
    plans = {p["data"]["name"]: p["data"] for p in run(svc.store.list("subjects", "A", kind=rules.LAUNCH))}
    plan = plans["Car wash subscription, Abuja, January 2027"]      # a new initiative, beside the other one
    assert len(plans) == 2 and plan["target_date"] == "2027-01-31" and plan["audience"] == "office workers"
    assert (plan["offer"]["price"], plan["economics"]["price_per_unit"], plan["economics"]["variable_cost_per_unit"]) == (15000, 15000, 6000)
    result = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    states = {c["key"]: c["state"] for c in result["criteria"]}
    assert states["offer"] == "met" and states["cash"] == states["delivery"] == states["prerequisites"] == "unknown"      # unknown never passes
    assert result["score"] < 100 and result["evidence_coverage"] < 100
    assert any(a["label"] == "Add 'Car wash subscription · ₦15,000 a month' to your catalogue" for a in result["free_next_actions"])


def test_the_in_app_quick_check_reads_the_sentence_as_the_chat_does():
    from app.modules.agent.goal_router import _read_said
    read = _read_said(MSG, "launch", {})
    assert {k: read.get(k) for k in ("sell", "customer", "where", "stage", "kind", "evidence", "price", "cost")} == {
        "sell": "car wash subscription", "customer": "office workers", "where": "Abuja", "stage": "testing", "kind": "service",
        "evidence": "10 customers tried it", "price": 15000.0, "cost": 6000.0}
