"""Adaptive Dashboard composition (PRD-AD-001): stage-aware surfaces driven by configuration,
priority order and the five-card rule, explainability, UX states, preferences and isolation."""
import copy
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import dashboard as dash
from app.modules.agent import router as agent_router
from app.modules.agent.orchestrator import AccessDenied
from app.shared.auth.deps import get_current_user
from test_agent import MEMBER, OUTSIDER, OWNER, Env, run


def build(env, user=OWNER, business="A", **kw):
    return run(dash.build_dashboard(env.orch, user, business, **kw))


def card(d, key):
    return next((c for c in d["insights"] if c["key"] == key), None)


def keys(d, surface):
    return [x["key"] for x in d[surface]]


def invoice(env, iid, customer, total, *, paid=True, due_in=14, paid_days_ago=60, **over):
    when = (env.now - timedelta(days=paid_days_ago)).isoformat()
    inv = {"id": iid, "reference": f"INV-{iid}", "customer_name": customer, "customer_email": "buyer@brighttech.test",
           "status": "paid" if paid else "sent", "total_amount": total, "created_at": when, "updated_at": env.now.isoformat(),
           "due_date": (env.now + timedelta(days=due_in)).date().isoformat(),
           "payments": [{"id": f"p-{iid}", "amount": total, "paid_at": when,
                         "receipt": {"number": f"REC-{iid}", "sent_at": when}}] if paid else [], **over}
    env.fin["invoices"].append(inv)
    return inv


def idea(env):
    """Nothing but a name: no products, no validated idea, no invoices."""
    env.businesses["A"]["data"]["catalogue"]["products"] = []


def operating(env):
    """A business that has been trading for a while: spread revenue, costs, a comfortable runway."""
    env.businesses["A"]["data"]["decision"] = {"status": "accepted"}
    for n, name in enumerate(["Alpha Ltd", "Beta Ltd", "Gamma Ltd", "Delta Ltd"]):
        invoice(env, f"i{n}", name, 5000)
    env.fin["expenses"].append({"id": "e1", "price": 3000, "status": "paid", "date": env.now.date().isoformat(), "updated_at": env.now.isoformat()})


def growing(env):
    env.businesses["A"]["data"]["decision"] = {"status": "accepted"}
    for n, (name, amount, ago) in enumerate([("Alpha Ltd", 4000, 150), ("Beta Ltd", 4000, 120), ("Gamma Ltd", 5000, 60),
                                             ("Delta Ltd", 5000, 30), ("Epsilon Ltd", 4000, 10)]):
        invoice(env, f"g{n}", name, amount, paid_days_ago=ago, cost_of_sales=amount * 0.25)
    env.fin["expenses"].append({"id": "e1", "price": 2000, "status": "paid", "date": env.now.date().isoformat(), "updated_at": env.now.isoformat()})


# ── configuration is data ────────────────────────────────────────────────────
def test_each_stage_fills_the_same_skeleton_from_configuration():
    assert set(dash.STAGE_LAYOUT) == set(dash.STAGES) == {"idea", "pre_launch", "operating", "growth"}
    expect_cards = {
        "idea": ["validate", "business_plan", "scenarios", "registration"],
        "pre_launch": ["business_plan", "funding_readiness", "registration", "scenarios"],
        "operating": ["essentials", "validate", "business_plan", "scenarios"],
        "growth": ["essentials", "scenarios", "marketplace", "business_plan"],
    }
    expect_kpis = {
        "idea": ["validation_score", "market_size", "startup_costs", "funding_needed"],
        "pre_launch": ["launch_readiness", "runway", "planned_costs", "funding_secured", "launch_risks"],
        "operating": ["revenue", "cash_balance", "costs", "receivables", "active_risks"],
        "growth": ["revenue_growth", "margin", "cash_balance", "receivables", "top_customer_share"],
    }
    expect_report = {"idea": "Idea Validation Report", "pre_launch": "Setup checklist",
                     "operating": "Business Health Report", "growth": "Business Health Report"}
    for stage in dash.STAGES:
        d = build(Env(), preview_stage=stage)
        assert d["context"]["business_stage"] == stage and d["context"]["stage_label"] == dash.STAGE_LABEL[stage]
        assert keys(d, "action_cards") == expect_cards[stage] and len(d["action_cards"]) == 4
        assert keys(d, "kpis") == expect_kpis[stage]
        assert d["report"]["title"] == expect_report[stage] and d["report"]["cta"] and d["report"]["action"]
        assert all(c["title"] and c["href"] and c["cta"] and c["description"] for c in d["action_cards"])
        assert set(keys(d, "insights")) <= set(dash.STAGE_LAYOUT[stage]["insights"])
        # Every widget used is declared eligible for the stage: nothing is hard-wired around the tables.
        for surface in ("action_cards", "kpis", "insights"):
            for k in keys(d, surface):
                assert stage in dash.WIDGETS[k].eligible_business_stages, (stage, k)
        assert d["context"]["pathway"] in dash.WIDGETS[d["report"]["key"]].supported_pathways


def test_a_layout_that_names_an_ineligible_widget_is_rejected(monkeypatch):
    bad = copy.deepcopy(dash.STAGE_LAYOUT)
    bad["idea"]["action_cards"] = ("essentials", "business_plan", "scenarios", "registration")      # essentials isn't an idea-stage card
    monkeypatch.setattr(dash, "STAGE_LAYOUT", bad)
    with pytest.raises(AssertionError):
        dash._check_configuration()


# ── stage detection ──────────────────────────────────────────────────────────
def test_the_stage_is_read_from_the_records():
    env = Env()
    idea(env)
    d = build(env)
    assert d["context"]["business_stage"] == "idea" and d["context"]["stage_source"] == "records" and d["context"]["pathway"] == "startup"

    env = Env()                                                               # products listed, nothing invoiced
    d = build(env)
    assert d["context"]["business_stage"] == "pre_launch" and "No invoices issued yet" in d["context"]["stage_signals"]

    env = Env()
    invoice(env, "a", "Alpha Ltd", 500, paid=False)                           # one issued invoice is enough
    assert build(env)["context"]["business_stage"] == "operating"

    env = Env()
    env.fin["invoices"].append({"id": "d", "status": "draft", "total_amount": 100})      # a draft is not trading
    assert build(env)["context"]["business_stage"] == "pre_launch"

    env = Env()
    operating(env)
    d = build(env)
    assert d["context"]["business_stage"] == "operating" and d["context"]["pathway"] == "small_business"

    env = Env()
    growing(env)
    d = build(env)
    assert d["context"]["business_stage"] == "growth" and any("Revenue up" in s for s in d["context"]["stage_signals"])


def test_composing_the_dashboard_writes_nothing():
    env = Env()
    operating(env)
    before = copy.deepcopy(env.businesses["A"]["data"])
    build(env)
    build(env, preview_stage="idea")
    assert env.businesses["A"]["data"] == before


# ── headline, KPIs and collapsing ────────────────────────────────────────────
def test_each_stage_has_its_headline_metric():
    env = Env()
    idea(env)
    h = build(env)["context"]["headline"]
    assert h["key"] == "validation_score" and h["value"] == "Not run yet" and h["state"] == "insufficient_data"
    env.businesses["A"]["data"]["validation"] = {"result": {"overall_score": 72}}
    assert build(env, preview_stage="idea")["context"]["headline"]["value"] == "72%"

    h = build(Env())["context"]["headline"]
    assert h["label"] == "Launch readiness" and h["value"] == "3 of 7"       # name, email, a priced product

    env = Env()
    operating(env)
    assert build(env)["context"]["headline"] == {"key": "health", "label": "Health", "value": "Stable", "state": "available", "tone": "emerald"}
    invoice(env, "big", "Whale Ltd", 90000)
    assert build(env)["context"]["headline"]["value"] == "Needs attention"

    env = Env()
    growing(env)
    h = build(env)["context"]["headline"]
    assert h["label"] == "Health" and h["value"] == "Stable · Growth +75%"    # health together with growth: 14,000 against 8,000


def test_kpis_show_values_or_name_what_is_missing_and_collapse_when_all_are_empty():
    env = Env()
    idea(env)
    d = build(env)
    assert all(k["state"] == "insufficient_data" and k["value"] is None and k["hint"] for k in d["kpis"])
    assert d["kpis_empty"] == "Your idea's score, market size and the money it needs appear here once the idea is scored."
    env.businesses["A"]["data"]["validation"] = {"result": {"overall_score": 0.64, "market": {"serviceable_addressable_market": 2500000}}}
    env.businesses["A"]["data"]["inputs"] = {"startup_costs": 12000, "funding_needed": "20,000"}
    d = build(env, preview_stage="idea")
    values = {k["key"]: k["value"] for k in d["kpis"]}
    assert values == {"validation_score": "64%", "market_size": "£2.5m", "startup_costs": "£12,000.00", "funding_needed": "£20,000.00"}
    assert d["kpis_empty"] is None

    d = build(Env())                                                          # pre-launch: readiness is always known
    by = {k["key"]: k for k in d["kpis"]}
    assert by["launch_readiness"]["value"] == "43%" and by["launch_readiness"]["hint"] == "3 of 7 in place"
    assert by["runway"]["state"] == "insufficient_data" and d["kpis_empty"] is None

    env = Env()
    growing(env)
    by = {k["key"]: k for k in build(env)["kpis"]}
    # 22,000 received, 5,500 cost of sales, 2,000 expenses
    assert by["revenue_growth"]["value"] == "+75%" and by["margin"]["value"] == "66%" and by["top_customer_share"]["value"].endswith("%")
    assert by["cash_balance"]["client_trend"] == "cash" and by["receivables"]["client_trend"] == "receivables"

    env = Env()
    invoice(env, "a", "Alpha Ltd", 500, paid=False)                           # operating with records: the five tiles
    d = build(env)
    assert [k["client_trend"] for k in d["kpis"]] == ["revenue", "cash", "costs", "receivables", "risks"] and d["kpis_empty"] is None
    assert build(Env(), preview_stage="operating")["kpis_empty"]              # operating layout, no records: one line


# ── insights: priority, the five-card rule, stage families ───────────────────
def test_never_more_than_five_priority_cards_and_classes_are_in_order():
    env = Env()
    operating(env)
    invoice(env, "big", "Whale Ltd", 90000)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    d = build(env)
    assert d["max_priority_cards"] == 4 and len(d["insights"]) <= dash.CANDIDATE_CARDS == 5
    classes = [c["priority_class"] for c in d["insights"]]
    assert classes == sorted(classes) and classes[0] == 1
    assert card(d, "risk")["severity"] == "high" and card(d, "scenario")["text"].startswith("Losing Whale Ltd would cut monthly revenue by ")


# The four insight slots per stage, as in the QA table:
#   critical · time-sensitive · goal or scenario · supporting
def test_idea_slots_weakness_next_validation_step_pricing_scenario_similar_businesses():
    env = Env()
    idea(env)
    d = build(env)
    assert keys(d, "insights") == ["idea_weakness", "next_step", "scenario", "marketplace_similar"]
    assert [c["priority_class"] for c in d["insights"]] == [1, 2, 3, 5]
    weak = card(d, "idea_weakness")
    assert weak["state"] == "insufficient_data" and weak["cta"] == {"label": "Validate my idea", "to": "/validation"}
    # G-4: validation is the weakness card's call to action; the next-step slot moves on.
    assert card(d, "next_step")["text"] == "Next: your market size. I'm working it out." and card(d, "next_step")["cta"] == {"label": "See the market size", "to": "/validation"}
    assert [c["cta"]["label"] for c in d["insights"]].count("Validate my idea") == 1
    assert card(d, "scenario")["text"].startswith("Price moves an early plan more than anything else") and card(d, "scenario")["agent_action"] is None
    assert card(d, "marketplace_similar")["cta"]["to"] == "/marketplace"

    env.businesses["A"]["data"]["validation"] = {"result": {"overall_score": 58, "dimension_scores": {
        "market_demand": 72, "competition": 31, "financial_viability": 64, "founder_fit": 80}}}
    weak = card(build(env, preview_stage="idea"), "idea_weakness")
    assert weak["state"] == "available" and weak["text"].startswith("Your idea's weakest point is competition (31%)")
    assert weak["why"]["evidence"][0] == {"label": "Competition", "value": "31%"} and len(weak["why"]["evidence"]) == 4
    assert weak["cta"] == {"label": "Review validation", "to": "/results"}


def test_pre_launch_slots_blocker_next_launch_action_runway_scenario_funding_gaps():
    d = build(Env())
    assert keys(d, "insights") == ["blocker", "next_step", "scenario", "funding_gaps"]
    assert [c["priority_class"] for c in d["insights"]] == [1, 2, 3, 5]
    assert "A validated business idea" in card(d, "blocker")["why"]["missing"] and len(d["launch_readiness"]["items"]) == 7
    nxt = card(d, "next_step")
    assert nxt["text"] == "3 of 7 launch items in place. I need from you: a validated business idea." and nxt["cta"] == {"label": "Add it", "to": "/validation"}
    assert nxt["detail"] == "3 of 7 launch items in place"
    assert card(d, "scenario")["text"].startswith("I need your planned monthly costs in a launch plan")
    gaps = card(d, "funding_gaps")
    assert gaps["why"]["missing"] == ["A business plan", "Planned costs", "How much funding you need", "Funding or starting cash already secured"]
    assert "cash" not in keys(d, "insights") and "risk" not in keys(d, "insights")

    env = Env()
    env.businesses["A"]["data"].update({"business_plan": {"id": "bp"}, "inputs": {"monthly_costs": 2000, "funding_needed": 30000, "starting_cash": 10000}})
    gaps = card(build(env), "funding_gaps")
    assert gaps["tone"] == "emerald" and gaps["why"]["missing"] == [] and gaps["text"].startswith("The basics a funder asks for")


def test_operating_slots_risk_overdue_scenario_cash():
    env = Env()
    operating(env)
    invoice(env, "big", "Whale Ltd", 90000)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    d = build(env)
    assert keys(d, "insights") == ["risk", "next_step", "scenario", "cash"]
    assert [c["priority_class"] for c in d["insights"]] == [1, 2, 3, 5]
    assert card(d, "next_step")["detail"].startswith("1 overdue")


def test_growth_slots_concentration_contract_action_growth_scenario_opportunities():
    env = Env()
    growing(env)
    invoice(env, "big", "Whale Ltd", 60000, paid_days_ago=20)
    env.fin["contracts"] = [{"id": "c1", "reference": "CON-1", "party_name": "Whale Ltd", "status": "pending"},
                            {"id": "c2", "reference": "CON-2", "party_name": "Beta Ltd", "status": "active",
                             "end_date": (env.now + timedelta(days=12)).date().isoformat()},
                            {"id": "c3", "reference": "CON-3", "party_name": "Old Ltd", "status": "active",
                             "end_date": (env.now + timedelta(days=200)).date().isoformat()}]
    env.fin["rfq_requests"] = [{"id": "r1", "status": "pending", "customer_name": "Buyer Co", "created_at": env.now.isoformat()},
                               {"id": "r2", "status": "approved", "customer_name": "Done Co"}]
    d = build(env)
    assert d["context"]["business_stage"] == "growth"
    assert keys(d, "insights") == ["risk", "contract_action", "scenario", "opportunities"]
    assert [c["priority_class"] for c in d["insights"]] == [1, 2, 3, 5]
    contract = card(d, "contract_action")
    assert contract["text"].startswith("2 contracts need action: CON-1 awaiting signature from Whale Ltd")
    assert [e["label"] for e in contract["why"]["evidence"]] == ["CON-1", "CON-2"] and contract["cta"]["to"] == "/operations?tab=Contracts"
    assert card(d, "scenario")["text"].startswith("Losing Whale Ltd would cut monthly revenue by ")          # concentration drives the scenario
    opp = card(d, "opportunities")
    assert opp["text"].startswith("1 request for quotation is waiting") and opp["cta"]["to"] == "/operations?tab=Procurement"

    env2 = Env()                                                              # nothing waiting: no contract card, marketplace opportunity
    growing(env2)
    d = build(env2)
    assert "contract_action" not in keys(d, "insights") and card(d, "opportunities")["cta"]["to"] == "/marketplace"
    assert card(d, "scenario")["text"].startswith("I'm testing what a 5% and a 10% price rise")


def test_agent_suggestions_follow_the_stage():
    env = Env()
    idea(env)
    texts = [s["text"] for s in build(env)["agent"]["suggestions"]]
    assert texts == ["I'm scoring your idea.", "I'm drafting your business plan.", "I'm sizing your market."]
    agent = build(env)["agent"]
    assert [x["label"] for x in agent["shortcuts"]] == ["Validate Idea", "Business Plan", "Market Sizing", "Scenario Help"]
    assert agent["placeholder"] == "Ask EnterprateAI about your idea, plan or market…"
    pre = build(Env())["agent"]["suggestions"]
    assert [s["text"] for s in pre] == ["Your idea hasn't been scored yet: I'm scoring it before you launch.", "I need a funding case before the funding pack can be drafted.",
                                         "I'm preparing your registration checklist."]      # what the Agent needs, and what it is doing
    assert pre[0]["action"] == {"to": "/validation"}                          # no launch plan and the idea isn't validated: wording and route agree
    assert [x["label"] for x in build(Env())["agent"]["shortcuts"]] == ["Setup Checklist", "Funding Pack", "Registration", "Scenario Help"]
    env = Env()
    growing(env)
    assert {"I'm testing a 5% and a 10% price change.", "I'm checking your capacity."} <= \
        {s["text"] for s in build(env)["agent"]["suggestions"]}
    env = Env()
    operating(env)
    agent = build(env)["agent"]
    assert not any(s["key"].startswith("stage_") for s in agent["suggestions"])      # operating: from the records only
    assert agent["shortcuts"] is None and "quotes, payments, risks or scenarios" in agent["placeholder"]      # the standard set


def test_growth_suggestions_keep_at_most_two_records_items_under_the_attention_line():
    env = Env()
    growing(env)
    invoice(env, "big", "Whale Ltd", 60000, paid_days_ago=20)                 # concentration
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)             # follow-up available
    invoice(env, "unreceipted", "Zed Ltd", 300, paid_days_ago=5)["payments"][0].pop("receipt")      # receipt to send
    env.businesses["A"]["data"]["catalogue"]["customers"][0]["email"] = ""
    blocked = invoice(env, "noemail", "BrightTech Ltd", 100, paid=False, due_in=-10, customer_email="")
    env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": blocked["id"]})
    d = build(env)
    assert d["context"]["business_stage"] == "growth"
    sug = d["agent"]["suggestions"]
    assert len(sug) == 4 and sug[0]["key"] == "attention" and sug[0]["text"] == "1 task needs attention."
    assert sum(1 for x in sug if not x["key"].startswith("stage_") and x["key"] != "attention") == 2
    assert sug[3]["text"] == "I'm testing a 5% and a 10% price change."       # a stage item fills the rest: what the Agent is doing
    assert [x["label"] for x in d["agent"]["shortcuts"]] == ["Pricing Scenario", "Quote to Invoice", "Risk & Concentration", "Opportunities"]
    assert "pricing, capacity, new offers or expansion" in d["agent"]["placeholder"]


def test_margin_and_growth_need_real_inputs():
    env = Env()
    env.businesses["A"]["data"]["decision"] = {"status": "accepted"}
    for n, ago in enumerate([150, 120, 60, 30, 10]):                          # paid invoices, but no cost recorded anywhere
        invoice(env, f"m{n}", f"Customer {n}", 4000, paid_days_ago=ago)
    by = {k["key"]: k for k in build(env, preview_stage="growth")["kpis"]}
    assert by["margin"]["value"] is None and by["margin"]["state"] == "insufficient_data"
    assert by["margin"]["hint"] == "Add expenses or cost of sales to see margin"
    env.fin["expenses"].append({"id": "e1", "price": 5000, "status": "paid", "date": env.now.date().isoformat()})
    assert {k["key"]: k for k in build(env, preview_stage="growth")["kpis"]}["margin"]["value"] == "75%"

    env2 = Env()                                                              # all revenue in the last 90 days: nothing to compare against
    invoice(env2, "a", "Alpha Ltd", 4000, paid_days_ago=20)
    d = build(env2, preview_stage="growth")
    g = {k["key"]: k for k in d["kpis"]}["revenue_growth"]
    assert g["value"] is None and g["state"] == "insufficient_data" and "90 days before" in g["hint"]
    assert d["context"]["headline"]["value"].endswith("· growth not measurable yet")


def test_overdue_money_takes_the_time_sensitive_slot_at_every_stage():
    env = Env()
    growing(env)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    for stage in ("idea", "pre_launch", "operating", "growth"):
        d = build(env, preview_stage=stage)
        c = card(d, "next_step")
        assert c and c["priority_class"] == 2 and c["detail"].startswith("1 overdue"), stage
        assert c["agent_action"] is None and c["text"].startswith("1 overdue (£500.00). ")      # what the Agent is doing, never a task for the owner
        assert [x["priority_class"] for x in d["insights"]] == sorted(x["priority_class"] for x in d["insights"])
    env.fin["invoices"] = [i for i in env.fin["invoices"] if i["id"] != "late"]
    assert card(build(env), "next_step") is None                             # growth without overdue money: no such card


def test_overdue_money_is_time_sensitive_and_carries_its_evidence():
    env = Env()
    operating(env)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    c = card(build(env), "next_step")
    assert c["priority_class"] == 2 and c["detail"].startswith("1 overdue")
    assert c["text"] == "1 overdue (£500.00). I'm preparing the reminders for your approval." and c["cta"] is None and c["agent_action"] is None
    assert any(e["label"] == "INV-late" and "Slow Ltd" in e["value"] for e in c["why"]["evidence"])


def test_an_approval_about_to_expire_gets_a_card_only_for_someone_who_can_approve():
    env = Env()
    operating(env)
    inv = invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    r = env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})["run"]
    approval = env.pending(r)[0]
    assert card(build(env), "approval") is None                              # 72 hours left: not yet time-sensitive
    run(env.store.update_approval(approval["id"], {"expires_at": (env.now + timedelta(hours=5)).isoformat()}))
    c = card(build(env), "approval")
    assert c["priority_class"] == 2 and "about 5 hours" in c["text"] and c["cta"]["run_id"] == r["id"]
    assert card(build(env, MEMBER), "approval") is None


def test_opening_a_card_never_starts_an_agent_run_and_agent_help_is_labelled():
    env = Env()
    operating(env)
    invoice(env, "big", "Whale Ltd", 90000)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    for c in build(env)["insights"]:
        assert "capability" not in (c["cta"] or {}) and "capability" not in (c.get("more") or {}), c["key"]
        assert c["agent_action"] is None      # no card hands the owner a task to start: the Agent starts its own
        assert c["why"]["summary"] and c["why"]["source"], c["key"]
    assert card(build(env), "risk")["cta"] == {"label": "View risk details", "explain": True}


# ── the goal reorders within the stage ───────────────────────────────────────
def test_the_goal_raises_related_cards_but_never_brings_in_another_stages_cards():
    env = Env()
    operating(env)
    base = build(env)
    assert card(base, "cash")["priority_class"] == 5 and "blocker" not in keys(base, "insights")
    env.businesses["A"]["data"]["dashboard_preferences"] = {OWNER: {"current_goal": "cash"}}
    d = build(env)
    assert card(d, "cash")["priority_class"] == 3 and card(d, "cash")["goal_match"] and d["composition_key"] != base["composition_key"]
    assert d["context"]["business_stage"] == "operating"
    for goal in ("launch", "funding"):                                        # launch goals on a trading business
        env.businesses["A"]["data"]["dashboard_preferences"] = {OWNER: {"current_goal": goal}}
        d = build(env)
        assert "blocker" not in keys(d, "insights") and set(keys(d, "insights")) == set(keys(base, "insights"))
        assert keys(d, "action_cards") == keys(base, "action_cards") and keys(d, "kpis") == keys(base, "kpis")


def test_preferences_are_per_user_validated_and_cannot_hide_a_critical_card():
    env = Env()
    operating(env)
    invoice(env, "big", "Whale Ltd", 90000)
    prefs = dash.clean_preferences({"hidden_widget_ids": ["risk", "scenario"], "pinned_widget_ids": ["cash", "scenario"],
                                    "current_goal": "growth"}, {}, env.now)
    assert prefs["pinned_widget_ids"] == ["cash"] and prefs["created_at"] and prefs["updated_at"]
    env.businesses["A"]["data"]["dashboard_preferences"] = {OWNER: prefs}
    shown = keys(build(env), "insights")
    assert "scenario" not in shown and "risk" in shown                       # routine card hidden; the critical one stays
    assert build(env, MEMBER)["preferences"]["hidden_widget_ids"] == []
    for bad in ({"current_goal": "world_domination"}, {"hidden_widget_ids": ["agent"]}, {"pinned_widget_ids": ["essentials"]}):
        with pytest.raises(ValueError):
            dash.clean_preferences(bad, {}, env.now)


def test_minor_data_changes_do_not_rearrange_the_page():
    env = Env()
    operating(env)
    first = build(env)
    invoice(env, "extra", "Epsilon Ltd", 4800)
    second = build(env)
    assert second["composition_key"] == first["composition_key"] and keys(second, "insights") == keys(first, "insights")
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    assert build(env)["composition_key"] != first["composition_key"]


# ── transition after the first payment ───────────────────────────────────────
def test_launch_items_stay_for_thirty_days_after_the_first_payment():
    env = Env()
    invoice(env, "first", "Alpha Ltd", 500, paid_days_ago=3)
    d = build(env)
    t = d["context"]["transition"]
    assert d["context"]["business_stage"] == "operating" and t["from"] == "pre_launch" and "first payment" in t["message"]
    assert card(d, "blocker") is not None and "A validated business idea" in card(d, "blocker")["why"]["missing"]
    assert keys(d, "kpis")[0] == "revenue"                                    # the page itself is the operating one
    env.now += timedelta(days=31)
    d = build(env)
    assert d["context"]["transition"] is None and card(d, "blocker") is None
    assert build(env, preview_stage="operating")["context"]["transition"] is None


# ── Agent suggestions by stage ───────────────────────────────────────────────
def test_no_receipt_or_follow_up_suggestions_before_the_first_invoice():
    env = Env()
    operating(env)
    invoice(env, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    invoice(env, "big", "Whale Ltd", 90000)
    trading = build(env)["agent"]
    assert {"followup", "concentration"} <= {s["key"] for s in trading["suggestions"]} and trading["hidden_capabilities"] == []
    for stage in ("idea", "pre_launch"):
        agent = build(env, preview_stage=stage)["agent"]
        caps = {(s.get("action") or {}).get("capability") for s in agent["suggestions"]}
        assert not caps & {"payment_followup", "receipt_send", "risk_concentration", "quote_to_cash"}
        assert {"payment_followup", "receipt_send"} <= set(agent["hidden_capabilities"])


def test_the_agent_panel_separates_approvals_from_tasks_needing_attention():
    env = Env()
    operating(env)
    env.businesses["A"]["data"]["catalogue"]["customers"][0]["email"] = ""
    for n in range(2):
        inv = invoice(env, f"late{n}", "BrightTech Ltd", 100, paid=False, due_in=-10, customer_email="")
        env.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})
    agent = build(env)["agent"]
    texts = {s["key"]: s for s in agent["suggestions"]}
    assert "approvals" not in texts and agent["needs_approval_count"] == 0 and agent["needs_attention_count"] == 2
    assert texts["attention"]["text"] == "2 tasks need attention." and texts["attention"]["action"] == {"to": "/agent?tab=needs_attention"}

    env2 = Env()
    operating(env2)
    inv = invoice(env2, "late", "Slow Ltd", 500, paid=False, due_in=-10)
    env2.submit(capability="payment_followup", channel="ui_action", params={"invoice_id": inv["id"]})
    texts = {s["key"]: s for s in build(env2)["agent"]["suggestions"]}
    assert texts["approvals"]["text"] == "1 approval waiting for you." and "attention" not in texts


# ── UX states and source of truth ────────────────────────────────────────────
def test_missing_inputs_are_named_not_invented():
    d = build(Env(), preview_stage="operating")
    for key in ("risk", "cash"):
        c = card(d, key)
        assert c["state"] == "insufficient_data" and c["why"]["missing"] and c["severity"] is None
        assert not any(ch.isdigit() for ch in c["text"])
    assert d["financial_summary"]["has_records"] is False and d["financial_summary"]["runway_months"] is None


def test_stale_records_are_flagged_with_the_reason_and_a_way_to_refresh():
    env = Env()
    operating(env)
    assert build(env)["freshness"]["stale"] is False
    env.now += timedelta(days=45)
    d = build(env)
    assert d["freshness"]["stale"] is True and "Nothing has been recorded since 1 Oct 2026" in d["freshness"]["stale_reason"]
    c = card(d, "cash")
    assert c["state"] == "stale" and c["stale"]["reason"] and c["stale"]["refresh"]["to"]


def test_figures_match_the_engines_exactly():
    from app.modules.agent import business as bz
    env = Env()
    operating(env)
    invoice(env, "a", "Aftred", 189, paid=False, due_in=-18)
    invoice(env, "b", "Beta Ltd", 10, paid=False, due_in=-1, status="delivered")
    invoice(env, "c", "Gamma Ltd", 40, paid=False, due_in=-5, status="disputed", status_reason="Wrong hours")
    invoice(env, "d", "Delta Ltd", 70, paid=False, status="draft")
    d = build(env)
    cash = bz.cash_position(env.businesses["A"]["data"], env.now.date())
    s = d["financial_summary"]
    assert s["cash"] == cash["cash"] and s["runway_months"] == cash["runway_months"]
    assert s["receivables"] == 199 and s["overdue_count"] == 2 and s["overdue_total"] == 199      # disputed and draft excluded


def test_free_credits_and_exhaustion_are_reported():
    env = Env(plan="explorer", credits=50)
    d = build(env)
    assert d["entitlement"]["plan"] == "explorer" and d["entitlement"]["credits"] == 50 and d["entitlement"]["credits_exhausted"] is False
    env.meter.balances[OWNER] = 0
    d = build(env)
    assert d["entitlement"]["credits_exhausted"] is True and d["insights"]


def test_no_dashboard_for_another_business():
    env = Env()
    operating(env)
    with pytest.raises(AccessDenied):
        build(env, OUTSIDER, "A")
    other = build(env, OUTSIDER, "B")
    assert other["financial_summary"]["cash"] == 0 and other["context"]["business_stage"] == "pre_launch"


# ── over HTTP ────────────────────────────────────────────────────────────────
@pytest.fixture
def http(monkeypatch):
    env = Env()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    who = {"id": OWNER, "email": OWNER}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    yield env, TestClient(app, raise_server_exceptions=False), who
    app.dependency_overrides.pop(get_current_user, None)


def test_the_dashboard_endpoint_returns_every_surface(http):
    env, client, _ = http
    operating(env)
    body = client.get("/businesses/A/dashboard").json()
    for section in ("context", "action_cards", "kpis", "financial_summary", "insights", "agent", "needs_approval", "report",
                    "freshness", "entitlement", "preferences", "launch_readiness"):
        assert section in body, section
    assert "_ctx" not in body["agent"] and body["context"]["stages"][0] == {"key": "idea", "label": "Idea"}


def test_the_stage_can_be_changed_and_reset_and_every_change_is_audited(http):
    env, client, who = http
    operating(env)
    before = copy.deepcopy(env.fin)
    res = client.put("/businesses/A/dashboard/stage", json={"stage": "growth"})
    assert res.status_code == 200 and res.json() == {"stage": "growth", "source": "manual", "detected": "operating"}
    ctx = client.get("/businesses/A/dashboard").json()["context"]
    assert ctx["business_stage"] == "growth" and ctx["stage_source"] == "manual" and ctx["detected_stage"] == "operating"
    assert ctx["transition"] is None and env.fin == before                    # no business record changed
    assert client.put("/businesses/A/dashboard/stage", json={"stage": "startup"}).json()["stage"] == "pre_launch"      # alias
    assert client.put("/businesses/A/dashboard/stage", json={"stage": "unicorn"}).status_code == 400
    assert client.put("/businesses/A/dashboard/stage", json={"stage": None}).json() == {"stage": "operating", "source": "records", "detected": "operating"}
    assert "dashboard_stage" not in env.businesses["A"]["data"]
    audits = [a for a in env.store.audits if a["event_type"] == "dashboard_stage_changed"]
    assert [(a["detail"]["from"], a["detail"]["to"]) for a in audits] == [("operating", "growth"), ("growth", "pre_launch"), ("pre_launch", "operating")]
    assert all(a["actor_id"] == OWNER and a["business_id"] == "A" for a in audits)
    who.update({"id": OUTSIDER, "email": OUTSIDER})
    assert client.put("/businesses/A/dashboard/stage", json={"stage": "idea"}).status_code == 404


def test_preferences_round_trip_null_clears_the_goal_and_unknown_values_are_refused(http):
    env, client, _ = http
    operating(env)
    ok = client.put("/businesses/A/dashboard/preferences", json={"current_goal": "risk_reduction", "hidden_widget_ids": ["scenario"]})
    assert ok.status_code == 200 and ok.json()["preferences"]["current_goal"] == "risk_reduction"
    body = client.get("/businesses/A/dashboard").json()
    assert body["context"]["current_goal"] == "risk_reduction" and "scenario" not in [c["key"] for c in body["insights"]]
    assert client.put("/businesses/A/dashboard/preferences", json={"current_goal": "nonsense"}).status_code == 400
    assert client.put("/businesses/A/dashboard/preferences", json={"current_goal": None}).json()["preferences"]["current_goal"] is None
    client.put("/businesses/A/dashboard/preferences", json={"current_goal": "cash"})
    assert client.put("/businesses/A/dashboard/preferences", json={"current_goal": ""}).json()["preferences"]["current_goal"] is None
    client.put("/businesses/A/dashboard/preferences", json={"current_goal": "growth"})
    kept = client.put("/businesses/A/dashboard/preferences", json={"hidden_widget_ids": []}).json()
    assert kept["preferences"]["current_goal"] == "growth"                    # not sent = unchanged


def test_any_stage_can_be_previewed_outside_production_only(http, monkeypatch):
    env, client, _ = http
    operating(env)
    before = copy.deepcopy(env.businesses["A"]["data"])
    for stage in ("idea", "pre_launch", "operating", "growth"):
        ctx = client.get(f"/businesses/A/dashboard?preview_stage={stage}").json()["context"]
        assert ctx["business_stage"] == stage and ctx["preview"] is (stage != "operating")
    assert client.get("/businesses/A/dashboard?preview_pathway=startup").json()["context"]["business_stage"] == "pre_launch"
    assert env.businesses["A"]["data"] == before
    from app.core import config
    real = config.get_settings()
    monkeypatch.setattr(config, "get_settings", lambda: real.model_copy(update={"environment": "production"}))
    ctx = client.get("/businesses/A/dashboard?preview_stage=idea").json()["context"]
    assert ctx["business_stage"] == "operating" and ctx["preview"] is False


def test_another_business_is_not_readable_or_writable(http):
    env, client, who = http
    who.update({"id": OUTSIDER, "email": OUTSIDER})
    assert client.get("/businesses/A/dashboard").status_code == 404
    assert client.put("/businesses/A/dashboard/preferences", json={"current_goal": "cash"}).status_code == 404
    assert client.post("/businesses/A/dashboard/events", json={"type": "dashboard_viewed"}).status_code == 404
    assert "dashboard_preferences" not in env.businesses["A"]["data"]


def test_events_are_recorded_for_the_metrics_and_unknown_ones_refused(http):
    env, client, _ = http
    assert client.post("/businesses/A/dashboard/events", json={"type": "insight_opened", "widget_id": "risk",
                                                                "detail": {"priority_class": 1, "nested": {"x": 1}}}).status_code == 202
    event = env.store.events[-1]
    assert event["type"] == "Dashboard.insight_opened" and event["payload"]["widget_id"] == "risk"
    assert event["payload"]["priority_class"] == 1 and "nested" not in event["payload"]
    assert client.post("/businesses/A/dashboard/events", json={"type": "drop_tables"}).status_code == 400


def test_the_feature_flag_switches_the_composition_off_without_touching_data(http, monkeypatch):
    env, client, _ = http
    operating(env)
    before = copy.deepcopy(env.businesses["A"]["data"])
    monkeypatch.setattr(agent_router, "_dashboard_on", lambda: False)
    assert client.get("/businesses/A/dashboard").json() == {"enabled": False}
    assert client.get("/businesses/A/agent/summary").status_code == 200
    assert env.businesses["A"]["data"] == before
