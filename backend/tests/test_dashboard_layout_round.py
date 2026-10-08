"""Dashboard layout round: tile looks follow their meaning, a ready launch is good news in its
slot, registration has a status, the runway scenario is worked out, and the idea capabilities
read the profile before they ask anything."""
from datetime import datetime, timezone

from app.modules.agent import dashboard as dash
from app.modules.agent.workflows import idea_of
from test_agent import OWNER, Env, run
from test_readiness import L, _dashboard, _pre, _suggestion, assess, funding_case, launch

NOW = datetime(2026, 10, 6, tzinfo=timezone.utc)


# ══ C-1 ═══════════════════════════════════════════════════════════════════════

def test_the_profile_is_read_before_anything_is_asked():
    data = {"workspace_profile": {"company_name": "Alchemy Test", "about_company": "We keep the books for independent cafés.", "primary_industry": "accounting",
                                  "city": "Manchester", "country": "United Kingdom", "target_customer_type": "b2b",
                                  "services": [{"service_name": "Monthly bookkeeping", "service_description": "Books kept and reconciled each month."}]},
            "catalogue": {"products": [{"id": "p1", "name": "VAT returns", "base_price": 120}]}}
    idea = idea_of(data)
    assert idea["description"] == "We keep the books for independent cafés." and idea["industry"] == "accounting"
    assert idea["location"] == "Manchester, United Kingdom" and idea["customer"] == "Independent cafés" and idea["customer_guessed"] is True
    assert idea["services"] == ["Monthly bookkeeping", "VAT returns"] and idea["problem"] == ""      # the one thing not on record
    # The Marketplace description, then the services, stand in when "about" is empty.
    assert idea_of({"workspace_profile": {}, "marketplace": {"description": "Bookkeeping for cafés"}})["description"] == "Bookkeeping for cafés"
    assert idea_of({"workspace_profile": {"services": [{"service_name": "Bookkeeping"}, {"service_name": "Payroll"}]}})["description"] == "Offers Bookkeeping, Payroll"
    assert idea_of({"workspace_profile": {"services": [{"service_name": "Gooat"}]}})["description"] == ""      # one bare name is not an idea: it is asked for instead
    assert idea_of({"workspace_profile": {"primary_industry": "other", "primary_industry_other": "Pet grooming"}})["industry"] == "Pet grooming"
    assert idea_of({"workspace_profile": {"about_company": "On file"}}, {"description": "What they typed"})["description"] == "What they typed"


def test_only_what_is_really_empty_is_asked_for():
    env = Env()
    env.businesses["A"]["data"]["workspace_profile"].update({"about_company": "We keep the books for independent cafés.", "target_customer_type": "b2b"})
    env.businesses["A"]["data"].pop("validation", None)
    r = env.submit(capability="idea_validation", channel="ui_action")["run"]
    assert r["pending_question"]["question"] == "Is this your customer? “Independent cafés”"      # not "What does your business do?"
    r = run(env.orch.provide_input(r["id"], OWNER, {"customer": "Independent cafés"}))
    assert r["pending_question"]["question"] == "What problem does your business solve? (1 to 2 sentences)"
    r = run(env.orch.provide_input(r["id"], OWNER, {"problem": "Owners lose evenings to paperwork"}))
    assert r["status"] == "succeeded"
    sent = env.orch.rt.studio.calls[0][1]
    assert sent["description"] == "We keep the books for independent cafés." and sent["customer"] == "Independent cafés"
    plan = env.submit(capability="business_plan_draft", channel="ui_action")["run"]
    assert plan["status"] == "succeeded" and plan["pending_question"] is None      # nothing left to ask


# ══ L-4 and L-5 ═══════════════════════════════════════════════════════════════

def test_a_ready_launch_is_good_news_on_its_tile_and_in_its_card():
    env = Env()
    svc, lid = launch(env)
    assess(svc, lid, L)
    d = _pre(env)
    tile = _suggestion(d, "stage_blockers")
    assert tile["text"] == "Your launch is ready against its checklist. I'm watching for changes."
    assert (tile["mood"], tile["tone"], tile["icon"]) == ("good", "emerald", "check")      # never the red warning sign
    card = next(c for c in d["insights"] if c["key"] == "blocker")
    assert card["positive"] is True and card["title"] == "Launch status" and card["tone"] == "emerald" and card["severity"] is None
    assert "is ready against its checklist" in card["text"] and "I'm watching for changes." in card["text"]
    assert d["launch_check"]["classification"] == "ready" and not d["launch_check"]["blockers"]


def test_a_launch_with_a_blocker_keeps_its_warning():
    env = Env()
    svc, lid = launch(env, prerequisite="not_completed")
    assess(svc, lid, L)
    run(env.store.set_policy("A", {"automation": {"auto_start": False}}, OWNER))
    d = _pre(env)
    card = next(c for c in d["insights"] if c["key"] == "blocker")
    assert card["positive"] is False and card["title"] != "Launch status" and card["tone"] == "rose" and card["severity"] == "high"
    tile = _suggestion(d, "stage_blockers")
    assert tile["mood"] in ("problem", "idle") and tile["tone"] != "emerald"


def test_every_stage_tile_carries_a_look_that_matches_its_state():
    env = Env()
    funding_case(env)
    d = _pre(env)
    moods = {s["key"]: (s.get("mood"), s.get("tone"), s.get("icon")) for s in d["agent"]["suggestions"] if s["key"].startswith("stage_")}
    assert moods["stage_funding"] == ("working", "indigo", "clock") and moods["stage_register"] == ("working", "indigo", "clock")
    assert all(m[0] in ("good", "working", "needs_you", "problem", "idle") for m in moods.values())
    none = _pre(Env())
    assert _suggestion(none, "stage_funding")["mood"] == "needs_you" and _suggestion(none, "stage_funding")["tone"] == "amber"      # "I need a funding case…"


# ══ L-6 ═══════════════════════════════════════════════════════════════════════

def test_registration_has_a_status_like_the_launch_and_funding_cards():
    env = Env()
    status = _dashboard(env)["registration_status"]
    assert status["registered"] is False and status["label"] == "Not registered" and status["steps_total"] == 12
    assert status["progress"] == f"{status['steps_done']} of 12 steps" and 0 < status["steps_done"] < 12 and status["subject"] == "Apex Consulting"
    env.businesses["A"]["data"]["workspace_profile"]["registration_number"] = "12345678"
    done = _dashboard(env)["registration_status"]
    assert (done["registered"], done["label"], done["number"], done["progress"], done["steps_done"]) == (True, "Registered", "12345678", None, 12)
    assert dash.registration_status({})["steps_done"] == 0 and dash.registration_status({})["subject"] == "Your business"


# ══ L-7 ═══════════════════════════════════════════════════════════════════════

def test_the_runway_scenario_states_what_a_ten_percent_cost_rise_does():
    assert dash.runway_after_cost_rise({"runway": {"months": 11}, "planned_costs": 2000, "currency": "GBP"}, NOW) == \
        "A 10% cost rise shortens your runway by 1 month (to Aug 2027)."
    assert dash.runway_after_cost_rise({"runway": {"months": 24}}, NOW) == "A 10% cost rise shortens your runway by 3 months (to Jul 2028)."
    assert dash.runway_after_cost_rise({"runway": {"beyond_label": "Sep 2027"}, "planned_costs": 2000, "currency": "GBP"}, NOW) == \
        "A 10% cost rise still leaves cash above zero to Sep 2027, the end of your launch plan's projection. It adds £200.00 a month to planned costs."
    assert dash.runway_after_cost_rise({"planned_costs": 2000, "currency": "GBP"}, NOW).startswith("A 10% cost rise takes planned costs from £2,000.00 to £2,200.00 a month.")
    assert dash.runway_after_cost_rise({}, NOW).startswith("I need your planned monthly costs in a launch plan")
    assert "shows by how much" not in dash.runway_after_cost_rise({"runway": {"months": 6}}, NOW)


def test_the_pre_launch_scenario_card_uses_the_launch_plans_own_figures():
    env = Env()
    launch(env)
    card = next(c for c in _pre(env)["insights"] if c["key"] == "scenario")
    assert "shows by how much" not in card["text"]
    assert card["text"].startswith(("A 10% cost rise shortens your runway by ", "A 10% cost rise still leaves cash above zero to ",
                                    "A 10% cost rise takes planned costs from ", "A 10% cost rise leaves your runway at "))
