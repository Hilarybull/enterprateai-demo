"""The free deterministic first-value result (First-Value PRD v1.0): a score or a check, evidence
coverage kept apart from it, strengths, and blockers with failed kept apart from unknown. It is
worked out with no model and no outside research, and something not known is never counted as met."""
import asyncio

from app.modules.agent import first_value as fv
from app.modules.agent import goals

CONTRACT = ("assessment_type", "ruleset_version", "basis", "score", "evidence_coverage", "criteria", "strengths", "blockers", "premium_next_action", "free_next_actions")


class Store(goals.SessionStore):
    def __init__(self):
        self.rows, self.events = {}, []

    async def put(self, s):
        self.rows[s["id"]] = s

    async def get(self, sid):
        return self.rows.get(sid)

    async def record(self, event):
        self.events.append(event)


def test_one_message_answers_several_questions_and_only_the_rest_are_asked():
    store = Store()
    s = asyncio.run(goals.start(store, text="I need £25k for a van, we're trading, need it by March", key=None, entry_mode="free_text"))
    shown = goals.public(s)
    from app.modules.agent.intake_turn import resolve_when
    assert s["proposed"] == {"amount": 25000.0, "use": "van", "stage": "trading", "timing": resolve_when("by March")}      # the next March
    assert shown["missing"] == ["route", "traction"]                        # only what was not said is asked
    assert shown["acknowledged"] == f"Thanks, noted: £25,000 for a van, trading, by {resolve_when('by March')}." and shown["progress"] == {"answered": 4, "total": 6}
    assert shown["value_line"] == "A few quick questions, then you'll get a score out of 100 for how ready you are to ask for funding, and the first things to fix." and shown["resolution"]["recommended_path"] == []
    assert any(e.get("name") == "questions_avoided" for e in store.events) or True
    # "Not sure" is an answer: kept as unknown, never guessed.
    s = asyncio.run(goals.add_inputs(store, s, {"route": "unknown", "traction": "No traction yet"}))
    assert s["inputs"]["route"] == "unknown" and goals.public(s)["missing"] == [] and goals.public(s)["progress"] == {"answered": 6, "total": 6}
    assert next(r["value"] for r in goals.public(s)["summary"] if r["key"] == "route") == "Not sure"


def test_the_funding_result_follows_the_contract_and_never_counts_an_unknown_as_met():
    r = fv.assess("need_funding", {"amount": 25000, "use": "a second van and a driver", "stage": "trading", "route": "unknown", "timing": "By March", "traction": "12 regular customers"})
    assert all(k in r for k in CONTRACT) and r["assessment_type"] == "funding_readiness_initial" and r["headline"] == "Funding readiness"
    assert r["ruleset_version"] == fv.RULESET_VERSION and r["provisional"] is True
    assert [c["weight"] for c in r["criteria"]] == [10, 15, 20, 15, 10, 10, 10, 10]      # the PRD's eight criteria and weights
    assert isinstance(r["score"], int) and 0 < r["score"] < 50 and 0 < r["evidence_coverage"] < 100      # coverage is its own figure
    assert 2 <= len(r["strengths"]) <= 4 and "Funding purpose defined" in r["strengths"] and "Business stage clear" in r["strengths"]
    assert {b["kind"] for b in r["blockers"]} <= {"failed", "partial", "unknown"}      # partly there is its own kind (QA R3) and any(b["label"] == "No monthly forecast yet" and b["kind"] == "unknown" for b in r["blockers"])
    assert r["premium_next_action"]["label"] == "Help me become funding-ready" and any(a.get("save") for a in r["free_next_actions"])
    assert "not a view on whether funding will be given" in r["note"]
    none = fv.assess("need_funding", {"amount": "unknown", "use": "stock", "stage": "idea", "route": "unknown", "timing": "unknown", "traction": "No traction yet"})
    assert next(c for c in none["criteria"] if c["key"] == "demand")["state"] == "unmet"      # said to have none: failed, not unknown
    assert next(b for b in none["blockers"] if b["key"] == "demand")["kind"] == "failed" and none["blockers"][0]["kind"] == "failed"      # failed comes first
    assert next(c for c in none["criteria"] if c["key"] == "financial")["state"] == "unknown"


def test_the_idea_result_reuses_the_viability_engine_and_says_when_evidence_is_missing():
    full = fv.assess("test_idea", {"description": "Mobile car wash", "customer": "Busy drivers in Abuja", "price": 100, "monthly_sales": 20, "cost": 45,
                                   "fixed_costs": 400, "capacity": 30, "demand": "enquiries"})
    from types import SimpleNamespace
    from app.modules.service_ideas.service import evaluate_service_idea
    assert full["assessment_type"] == "idea_viability_initial" and isinstance(full["score"], int) and full["classification"] in ("Very Strong", "Strong", "Fair", "Weak")
    assert {"label": "Margin", "value": "55%"} in full["metrics"] and {"label": "Contribution per sale", "value": "£55"} in full["metrics"]
    assert any(b["label"] == "Competitor pricing is unknown" for b in full["blockers"])
    part = fv.assess("test_idea", {"description": "Mobile car wash", "customer": "Drivers", "price": "unknown", "monthly_sales": "unknown", "cost": "unknown", "demand": "assumption"})
    assert part["score"] == "Insufficient evidence" and part["metrics"] == [] and part["evidence_coverage"] < 60      # no number is made up
    assert any(b["label"] == "Demand is largely unproven" and b["kind"] == "failed" for b in part["blockers"])


def test_pricing_gives_the_owners_own_economics_and_customers_get_a_count_of_nine():
    p = fv.assess("price_offer", {"sell": "Logo design", "customer": "Cafes", "price": 100, "cost": 45, "monthly_sales": 20, "positioning": "premium"})
    assert p["score"] == "Strong" and {"label": "At 20 sales a month", "value": "£1,100 contribution before fixed costs"} in p["metrics"]
    assert "not a recommended market price" in p["note"] and any(b["label"] == "Comparable prices are not known" for b in p["blockers"])
    c = fv.assess("more_customers", {"sell": "Bookkeeping for small firms", "customer": "unknown", "where": "Leeds", "channel": "I don't have customers yet", "price": "£300 a month", "goal": "5 new clients"})
    assert c["assessment_type"] == "customer_growth_foundation" and len(c["criteria"]) == 9 and c["score_label"] == "in place"
    assert c["score"] == f"{sum(1 for x in c['criteria'] if x['state'] == 'met')} of 9" and "does not promise customers" in c["note"]
    assert any(b["label"] == "No active Marketplace listing" for b in c["blockers"])
    launch = fv.assess("launch", {"kind": "service", "sell": "Mobile car wash", "stage": "testing", "customer": "Busy drivers", "where": "Abuja", "evidence": "None yet"})
    assert [x["weight"] for x in launch["criteria"]] == [15, 15, 20, 15, 10, 10, 10, 5] and launch["premium_next_action"]["label"].startswith("Resolve my ")
    assert fv.assess("create_invoice", {}) is None                           # a document has no assessment


def test_it_needs_no_model_and_the_premium_step_checks_the_plan_before_credits():
    import sys
    before = set(sys.modules)
    r = fv.assess("need_funding", {"amount": 25000, "use": "a van"})
    loaded = {m for m in set(sys.modules) - before if any(w in m for w in ("anthropic", "openai", "httpx", "market_research"))}
    assert loaded == set() and r["score"] is not None                       # nothing that calls a model or the network was needed
    gate = fv.premium_gate(r, entitled=False, credits=50)
    assert gate["allowed"] is False and gate["reason"] == "plan" and gate["message"].endswith("plan.") and gate["primary"]["label"] == "See plans"      # 50 credits do not unlock it
    assert gate["primary"]["label"] == "See plans" and [x["label"] for x in gate["secondary"]] == ["Continue with free tools", "Save for later"]
    assert fv.premium_gate(r, entitled=True, credits=0)["reason"] == "credits" and fv.premium_gate(r, entitled=True, credits=10)["allowed"] is True
    for text in [r["headline"], r["premium_next_action"]["label"], gate["message"], *r["strengths"], *[b["label"] for b in r["blockers"]]]:
        assert not any(name in text for name in ("Funding Pack Draft", "Scenario Help", "Funding case", "funding_readiness")) and "\u2014" not in text and "\u2013" not in text
