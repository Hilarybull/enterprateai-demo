"""Goal-driven conversational onboarding (PRD-GO-001).

Covers what s25.8 asks for: direct feature requests, composite goals (including "I need more
customers"), partial support, a true no-match, low-confidence clarification, credit behaviour
and capability-hallucination prevention; and the first vertical slice: homepage -> task session
-> sign-in -> resume -> invoice draft -> dashboard review, then "I need funding"."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.agent import goal_router, goals
from app.modules.agent import router as agent_router
from app.modules.agent.workflows import WORKFLOWS
from app.modules.readiness import rules
from app.modules.readiness.service import service_for
from app.shared.auth.deps import get_current_user
from test_agent import OWNER, Env, run

NEW_USER = "newcomer@example.test"


# ══ the Goal Resolver ═════════════════════════════════════════════════════════

@pytest.mark.parametrize("said, capability, goal", [
    ("Create an invoice", "new_invoice", "create_invoice"), ("Create an invoice for ABC Consulting Ltd.", "new_invoice", "create_invoice"),
    ("I need a quotation", "enquiry_to_quote", "create_quotation"), ("write a proposal for Acme", "new_proposal", "prepare_proposal"),
    ("create a business plan", "business_plan_draft", "create_business_plan"),
])
def test_a_direct_feature_request_resolves_to_its_registered_task(said, capability, goal):
    r = goals.resolve(text=said)
    assert (r["resolution_class"], r["start_capability"], r["goal_key"]) == ("direct_supported", capability, goal)
    assert r["original_goal"] == said and r["confidence"] >= 0.8
    assert r["provenance"] == {"registry": "agent workflows and readiness modules", "version": goals.REGISTRY_VERSION, "rule": r["provenance"]["rule"]}


def test_i_need_more_customers_is_a_composite_goal_with_an_honest_boundary_not_an_unsupported_feature():
    for said in ("I need more customers", "help me win more work", "how do I get clients"):
        r = goals.resolve(text=said)
        assert r["resolution_class"] == "composite_goal" and r["goal_key"] == "more_customers", said
    r = goals.resolve(text="I need more customers")
    assert r["underlying_outcome"] == "Work toward winning more customers"
    assert r["execution_boundary"] == "I can't guarantee customers or bring them to you directly."
    assert r["message"].startswith("I can help you work toward getting more customers")
    assert not any(word in (r["message"] + r["execution_boundary"]).lower().replace("can't guarantee", "") for word in ("guarantee", "we will get you"))
    assert len(r["recommended_path"]) <= 4                                  # a short path, not the feature list
    assert {c["capability"] for c in r["candidate_capabilities"]} == {"offer_review", "marketplace_profile", "marketplace_offering", "new_proposal", "enquiry_to_quote"}


def test_i_need_funding_is_partial_support_through_funding_readiness_and_never_promises_funding():
    for said in (None, "I need funding", "we want to raise money from investors", "can I get a loan"):
        r = goals.resolve(text=said, key="need_funding" if said is None else None)
        assert (r["resolution_class"], r["start_capability"]) == ("partial_support", "funding_readiness"), said
    r = goals.resolve(key="need_funding")
    assert r["message"].startswith("I can help you become more funding-ready") and r["execution_boundary"] == "I can't guarantee funding, or a yes from any investor or lender."
    assert "will get you funding" not in r["message"].lower()
    assert r["credit_implication"].startswith("Free to start")


def test_a_true_no_match_says_so_and_invents_nothing():
    for said in ("book me a flight to Lagos", "file my corporation tax return with HMRC", "what's the weather"):
        r = goals.resolve(text=said)
        assert r["resolution_class"] == "no_match" and r["candidate_capabilities"] == [] and r["start_capability"] is None, said
        assert r["message"].startswith("EnterprateAI doesn't do that at the moment")


def test_two_plausible_routes_ask_one_clarifying_question_and_a_confident_one_asks_none():
    r = goals.resolve(text="I need funding to launch my new product")
    assert r["resolution_class"] == "clarify" and r["confidence"] < 0.5
    assert r["clarify"]["type"] == "choice" and [o["value"] for o in r["clarify"]["options"]] == ["need_funding", "launch", "other"]
    assert "clarify" not in goals.resolve(text="I need funding")


@pytest.mark.parametrize("said, offered", [
    ("help me with money", ["Improve cash flow", "Get funding-ready", "Price my product", "Something else"]),
    ("I need help with my finances", ["Improve cash flow", "Get funding-ready", "Price my product", "Something else"]),
    ("sort out my sales", ["Get more customers", "Price my product", "Grow the business", "Something else"]),
    ("help me with my business", ["Grow the business", "Get more customers", "Improve cash flow", "Something else"]),
])
def test_a_vague_ask_about_the_business_gets_one_question_with_chips_not_a_refusal(said, offered):
    r = goals.resolve(text=said)
    assert r["resolution_class"] == "clarify" and r["start_capability"] is None and r["confidence"] < 0.5, said
    assert [o["label"] for o in r["clarify"]["options"]] == offered
    assert r["message"] == "I can help with that in more than one way. Which is closest to what you need?"
    assert r["provenance"]["rule"] == "vague"
    # Chips only for routes that exist: with fewer than two left, it is an honest no-match instead.
    reg = goals.registry()
    bare = {k: v for k, v in reg.items() if k in ("new_invoice",)}
    assert goals.resolve(text=said, reg=bare)["resolution_class"] == "no_match"


@pytest.mark.parametrize("said, goal, found", [
    ("Create an invoice for ABC Consulting Ltd for website redesign £1,500", "create_invoice", {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1500.0}),
    ("create an invoice for ABC Consulting Ltd: website redesign for £1,500.50", "create_invoice", {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1500.5}),
    ("Invoice BrightTech Ltd 2k", "create_invoice", {"customer": "BrightTech Ltd", "amount": 2000.0}),
    # As typed in the browser: a first name in lower case, a comma, and a dollar sign.
    ("I need an invoice for mark, $300", "create_invoice", {"customer": "Mark", "amount": 300.0, "currency": "USD"}),      # shown with its capital; $300 is 300 in USD
    ("invoice for john smith for logo design, 450 dollars", "create_invoice", {"customer": "John Smith", "item": "logo design", "amount": 450.0, "currency": "USD"}),
    ("create an invoice for mark, website redesign, €1,200", "create_invoice", {"customer": "Mark", "item": "website redesign", "amount": 1200.0, "currency": "EUR"}),
    ("invoice for consulting $300", "create_invoice", {"item": "consulting", "amount": 300.0, "currency": "USD"}),
    ("quotation for a new website", "create_quotation", {"item": "a new website"}),
    ("I need a quotation for Frank for a garden office at £12k", "create_quotation", {"customer": "Frank", "item": "a garden office", "amount": 12000.0}),
    ("prepare a quote for kitchen refit", "create_quotation", {"item": "kitchen refit"}),
    ("write a proposal for Acme for a three month bookkeeping pilot", "prepare_proposal", {"customer": "Acme", "solution": "a three month bookkeeping pilot"}),
    ("I need £50k for hiring", "need_funding", {"amount": 50000.0, "use": "hiring"}),
    ("we want to raise 250,000 pounds to open a second site", "need_funding", {"amount": 250000.0, "use": "open a second site"}),
    ("I need funding", "need_funding", {}),
    ("Create an invoice", "create_invoice", {}),
])
def test_what_the_visitor_already_said_is_read_from_their_sentence(said, goal, found):
    r = goals.resolve(text=said)
    assert r["goal_key"] == goal, said
    assert goals.extract(said, goal) == found, said


def test_no_capability_is_ever_offered_that_is_not_registered():
    reg = goals.registry()
    assert set(WORKFLOWS) <= set(reg) and {"funding_readiness", "launch_readiness"} <= set(reg)
    sayings = [g["label"] for g in goals.GOALS] + ["I need more customers", "help me grow", "improve cash flow", "record a payment", "add a customer called X",
                                                    "book a flight", "invoice Acme for 2 days", "understand my risks", "price my service"]
    for said in sayings:
        r = goals.resolve(text=said)
        assert all(c["capability"] in reg and c["label"] == reg[c["capability"]] for c in r["candidate_capabilities"]), said
        assert r["start_capability"] is None or r["start_capability"] in reg
    # Take capabilities out of the registry: they vanish from the path, and a goal left with none is not offered at all.
    without = {k: v for k, v in reg.items() if k not in ("funding_readiness", "funding_pack_draft", "business_plan_draft", "scenario_help")}
    assert goals.resolve(key="need_funding", reg=without)["resolution_class"] == "no_match"
    assert "need_funding" not in [g["key"] for g in goals.suggestions(without)["goals"]]
    fewer = {k: v for k, v in reg.items() if k != "marketplace_profile"}
    assert "marketplace_profile" not in [c["capability"] for c in goals.resolve(key="more_customers", reg=fewer)["candidate_capabilities"]]


def test_the_homepage_offers_goals_first_then_quick_tasks_all_backed_by_a_registered_path():
    s = goals.suggestions()
    assert s["prompt"] == "What do you want EnterprateAI to do for your business?"
    assert [g["label"] for g in s["goals"]] == ["I need funding", "I need more customers", "Help me price my product/service", "I want to launch a product/service",
                                              "Improve my cash flow", "Help me grow my business", "Test a business idea", "Help me understand my business risks"]
    assert [t["label"] for t in s["tasks"]] == ["Create Invoice", "Create Quotation", "Create Business Plan", "Prepare Proposal"]
    assert s["reassurance"] == "Free essential business tools. 50 AI Credits to get started." and s["retention_days"] == 7
    assert not any(word in g["label"].lower() for g in s["goals"] for word in ("get funding", "get customers", "guarantee"))      # no promise in the copy


def test_a_goal_chip_a_task_chip_and_the_same_words_typed_resolve_the_same_way():
    for key, typed in (("need_funding", "I need funding"), ("more_customers", "I need more customers"), ("create_invoice", "Create Invoice"), ("test_idea", "Test a business idea")):
        chip, text = goals.resolve(key=key), goals.resolve(text=typed)
        assert (chip["goal_key"], chip["start_capability"], [c["capability"] for c in chip["candidate_capabilities"]]) == \
               (text["goal_key"], text["start_capability"], [c["capability"] for c in text["candidate_capabilities"]]), key


# ══ the vertical slice ════════════════════════════════════════════════════════

@pytest.fixture()
def world(monkeypatch):
    env = Env()
    store = goals.SessionStore()
    monkeypatch.setattr(agent_router, "get_orchestrator", lambda: env.orch)
    monkeypatch.setattr(goal_router, "get_orchestrator", lambda: env.orch)
    monkeypatch.setattr(goal_router, "_store", store)
    goal_router._STARTS.clear()
    who = {"user": None}

    def current():
        from fastapi import HTTPException
        if not who["user"]:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        return {"id": who["user"], "email": who["user"]}
    app.dependency_overrides[get_current_user] = current
    with TestClient(app) as client:
        yield env, store, client, who
    app.dependency_overrides.pop(get_current_user, None)


def _records(env):
    """Every private record in every business: there must be none of the visitor's before they sign in."""
    out = []
    for b in env.businesses.values():
        cat, fin = b["data"].get("catalogue") or {}, b["data"].get("financials") or {}
        out += [c.get("name") for c in cat.get("customers") or []] + [i.get("customer_name") for i in fin.get("invoices") or []]
    return out


def test_create_an_invoice_from_the_homepage_through_sign_in_to_a_draft_waiting_on_the_dashboard(world):
    env, store, client, who = world
    before_businesses = set(env.businesses)
    # A new visitor, no account: the task starts.
    s = client.post("/task-sessions", json={"key": "create_invoice", "entry_mode": "quick_task"}).json()
    assert s["state"] == "collecting_context" and s["next"] == "questions" and s["authenticated"] is False
    assert s["resolution"]["start_capability"] == "new_invoice" and [q["key"] for q in s["questions"]] == ["customer", "item", "amount"]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "ABC Consulting Ltd", "item": "Website redesign", "amount": 1500}}).json()
    assert s["state"] == "awaiting_identity" and s["next"] == "identity" and s["missing"] == []
    # Nothing private exists yet, and nothing can be prepared without signing in.
    assert "ABC Consulting Ltd" not in _records(env) and set(env.businesses) == before_businesses and run(env.store.list_runs("A")) == []
    assert client.post(f"/task-sessions/{s['id']}/prepare").status_code == 401
    assert env.meter.charges == []                                          # goal resolution and the questions cost nothing
    # Refresh, redirect, coming back from the verification email: the session is still there.
    again = client.get(f"/task-sessions/{s['id']}").json()
    assert again["inputs"] == {"customer": "ABC Consulting Ltd", "item": "Website redesign", "amount": 1500.0} and again["resolution"]["original_goal"] == "Create Invoice"
    # Signed in as a brand-new user: attached, a business is made for them (only now), and the task resumes.
    who["user"] = NEW_USER
    env.meter.plans[NEW_USER], env.meter.balances[NEW_USER] = "starter_insight", 50
    attached = client.post(f"/task-sessions/{s['id']}/attach-user").json()
    assert attached["authenticated"] is True and attached["state"] == "resuming"
    resumed = client.post(f"/task-sessions/{s['id']}/resume", json={"business_name": "Newcomer Studio"}).json()
    assert resumed["state"] == "ready_to_prepare" and resumed["next"] == "prepare"
    mine = resumed["business_id"]
    assert mine not in before_businesses and env.businesses[mine]["owner"] == NEW_USER
    data = env.businesses[mine]["data"]
    assert data["workspace_profile"]["company_name"] == "Newcomer Studio" and data["onboarding"]["via"] == "goal_first"      # the setup questionnaire is not put in the way
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert prepared["state"] == "awaiting_review" and prepared["handoff"]["to"].startswith("/dashboard?task=") and prepared["next"] == "handoff"
    run_id = prepared["handoff"]["run_id"]
    # On the dashboard the task shows what was said before sign-up, filled in; only what is still missing is asked.
    shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
    assert shown["workflow_key"] == "new_invoice" and shown["business_id"] == mine
    fields = {f["key"]: f for f in shown["pending_question"]["fields"]}
    assert fields["customer_name"]["default"] == "ABC Consulting Ltd" and "customer_id" not in fields      # no customers yet: straight to the new one
    assert fields["items"]["suggested"] == [{"product_id": None, "name": "Website redesign", "quantity": 1, "unit_price": 1500.0}]
    assert "customer_email" in fields and "vat_rate" in fields              # never invented: the address and the VAT rate are asked for
    done = client.post(f"/workflow-runs/{run_id}/input", json={"answers": {
        "customer_name": "ABC Consulting Ltd", "customer_email": "accounts@abc.test", "vat_rate": 0,
        "items": [{"name": "Website redesign", "quantity": 1, "unit_price": 1500}]}}).json()["run"]
    # A brand-new business has no email of its own yet, and a document is never sent under a placeholder: that one thing is asked.
    assert [f["key"] for f in done["pending_question"]["fields"]] == ["business_email"]
    done = client.post(f"/workflow-runs/{run_id}/input", json={"answers": {"business_email": "hello@newcomer.test"}}).json()["run"]
    assert done["status"] == "awaiting_approval", done.get("pending_question") or done.get("error")      # a reviewable draft; sending still needs approval
    approval = env.pending(done)[0]
    assert approval["tool_id"] == "send_invoice" and (approval["payload"]["customer_name"], approval["payload"]["total"]) == ("ABC Consulting Ltd", 1500)
    assert env.comms.sent == [] and [c["name"] for c in data["catalogue"]["customers"]] == ["ABC Consulting Ltd"]
    summary = client.get(f"/businesses/{mine}/agent/summary").json()
    assert summary["needs_approval_count"] == 1                             # not an empty dashboard
    # Preparing twice (a retry, a second tab) starts nothing new.
    assert client.post(f"/task-sessions/{s['id']}/prepare").json()["handoff"]["run_id"] == run_id and len([r for r in run(env.store.list_runs(mine)) if r["workflow_key"] == "new_invoice"]) == 1
    events = [e["type"] for e in store.rows[s["id"]]["events"]]
    assert events[:2] == ["HomepageGoalSubmitted", "GoalOutcomeResolved"] and {"AuthenticationRequired", "TaskSessionAttachedToUser", "TaskReadyToPrepare", "FirstOutputPrepared"} <= set(events)
    assert "ABC Consulting" not in str(store.rows[s["id"]]["events"])      # the funnel records steps, never what was typed
    # The MVP analytics funnel, in order, with the task key and no raw content.
    names = [e["name"] for e in store.events]
    assert names == ["goal_or_task_submitted", "goal_outcome_resolved", "capability_match_classified", "email_verified", "task_or_goal_path_resumed", "first_output_prepared"]
    assert all(e["goal_key"] == "create_invoice" and e["entry_mode"] == "quick_task" and e["capability"] == "new_invoice" for e in store.events)
    assert set().union(*[set(e) for e in store.events]) == {"name", "at", "session_id", "entry_mode", "goal_key", "capability", "resolution_class", "signed_in"}
    assert not any(word in str(store.events) for word in ("ABC Consulting", "Website redesign", "1500", NEW_USER, "Newcomer Studio"))
    assert all(len(e["session_id"]) == 12 for e in store.events)            # a prefix: the session itself can't be opened from an event
    # The first essential task on a new account is free, so the badge stays green and the meter does not move.
    assert s["resolution"]["credit_badge"] == "Free"
    assert s["resolution"]["credit_implication"] == "Free: this uses no AI Credits."
    assert env.meter.charges == [] and env.meter.balances[NEW_USER] == 50
    sent = client.post(f"/workflow-runs/{run_id}/approvals/{approval['id']}/approve").json()
    assert sent.get("run", sent).get("status") != "failed" and len(env.comms.sent) == 1
    assert [c[2] for c in env.meter.charges] == [] and env.meter.balances[NEW_USER] == 50
    assert data["onboarding"]["free_first_task"]["capability"] == "new_invoice"


def test_an_existing_user_resumes_into_their_own_business_and_another_account_cannot_take_the_session(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Create an invoice for BrightTech Ltd", "entry_mode": "free_text"}).json()
    # The customer was in the sentence: proposed for confirmation, and only the rest is still to be asked.
    assert s["proposed"] == {"customer": "BrightTech Ltd"} and s["missing"] == ["item", "amount"] and s["next"] == "questions"
    assert [(q["key"], q["proposed"], q["default"]) for q in s["questions"]] == [("customer", True, "BrightTech Ltd"), ("item", False, ""), ("amount", False, "")]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Strategy Workshop", "amount": 1500}}).json()
    assert s["inputs"] == {"customer": "BrightTech Ltd", "item": "Strategy Workshop", "amount": 1500.0} and s["proposed"] == {} and s["next"] == "identity"
    assert [(x["label"], x["value"]) for x in s["summary"]] == [("Who is it for?", "BrightTech Ltd"), ("What is it for?", "Strategy Workshop"), ("How much?", "£1,500")]
    who["user"] = OWNER
    resumed = client.post(f"/task-sessions/{s['id']}/resume").json()
    assert resumed["business_id"] == "A" and len([b for b in env.businesses.values() if b["owner"] == OWNER]) == 1      # no duplicate business
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    shown = client.get(f"/workflow-runs/{prepared['handoff']['run_id']}").json()["run"]
    # BrightTech and Strategy Workshop are on record: reused, so nothing about them is asked for.
    assert shown["status"] == "awaiting_approval" and env.pending(shown)[0]["payload"]["customer_name"] == "BrightTech Ltd"
    assert len(env.businesses["A"]["data"]["catalogue"]["customers"]) == 1
    # An account that already existed is not given a free task: this one was charged as usual.
    assert "free_first_task" not in (env.businesses["A"]["data"].get("onboarding") or {}) and env.meter.charges
    who["user"] = "someone.else@example.test"
    assert client.post(f"/task-sessions/{s['id']}/attach-user").status_code == 403
    assert client.post(f"/task-sessions/{s['id']}/prepare").status_code == 403


def test_i_need_funding_keeps_the_goal_through_sign_in_and_lands_on_a_funding_case_with_no_promise(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    assert s["resolution"]["resolution_class"] == "partial_support" and "can't guarantee funding" in s["resolution"]["execution_boundary"]
    assert [q["key"] for q in s["questions"]] == ["amount", "use", "stage"]      # only the three relevant early inputs
    amount, _use, stage = s["questions"]
    assert amount["prefix"] == "£" and [c["label"] for c in amount["chips"]] == ["£10,000", "£25,000", "£50,000", "£100,000", "£250,000"]
    assert stage["default"] == "" and s["missing"] == ["amount", "use", "stage"]      # no answer is guessed for them
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 50000, "use": "Hire two developers and fund six months of marketing", "stage": "trading"}}).json()
    assert s["next"] == "identity"
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    credits = env.meter.balances[OWNER]
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert prepared["state"] == "handed_off" and prepared["handoff"]["to"].startswith("/funding/")
    # First value is the result, not an empty case: the check has been run, and the case opens on it.
    said = prepared["handoff"]["message"]
    # Their words are quoted as they wrote them, not bent into the sentence.
    assert said.startswith('I set up your funding case from what you told me: £50,000 to fund: "Hire two developers and fund six months of marketing". ')
    assert prepared["preparing_label"] == "Checking your funding readiness"
    assert "guarantee" not in said.lower() and "Run the check" not in said
    assert prepared["handoff"]["to"].endswith("?tab=results") and prepared["handoff"]["assessment_id"]
    svc = service_for(env.orch)
    detail = run(svc.get_subject(OWNER, "A", rules.FUNDING, prepared["handoff"]["subject_id"], OWNER))
    assert detail["summary"]["assessment_id"] == prepared["handoff"]["assessment_id"] and detail["summary"]["classification"]
    assert detail["summary"]["headline"] and detail["summary"]["headline"].rstrip(".") in said
    assert prepared["handoff"]["classification"] == detail["summary"]["classification"]
    case = run(service_for(env.orch).store.get("subjects", prepared["handoff"]["subject_id"]))
    assert case["kind"] == rules.FUNDING and case["business_id"] == "A"
    assert (case["data"]["target_amount"], case["data"]["purpose"], case["data"]["stage"], case["data"]["pinned"]) == \
           (50000, "Hire two developers and fund six months of marketing", "trading", True)
    assert case["data"]["title"] == "£50,000 for hire two developers and fund six months of marketing"      # named from the answers, not "Funding case"
    assert env.meter.balances[OWNER] == credits and env.meter.charges == []      # getting here used no AI Credits


def test_a_no_match_and_a_clarifying_question_from_the_homepage(world):
    env, store, client, who = world
    none = client.post("/task-sessions", json={"text": "book me a flight to Lagos"}).json()
    assert none["state"] == "blocked" and none["next"] == "none" and none["questions"] == []      # honest, no fake task, no sign-up asked for
    unsure = client.post("/task-sessions", json={"text": "I need funding to launch my new product"}).json()
    assert unsure["next"] == "clarify" and unsure["clarify"]["key"] == "goal_key"
    picked = client.post(f"/task-sessions/{unsure['id']}/inputs", json={"answers": {"goal_key": "need_funding"}}).json()
    assert picked["goal_key"] == "need_funding" and picked["next"] == "questions" and picked["resolution"]["original_goal"] == "I need funding to launch my new product"
    # "help me with money" is asked about, not refused; "Something else" ends it plainly without asking for an account.
    money = client.post("/task-sessions", json={"text": "help me with money", "entry_mode": "free_text"}).json()
    assert money["next"] == "clarify" and money["state"] == "collecting_context"
    assert [o["label"] for o in money["clarify"]["options"]] == ["Improve cash flow", "Get funding-ready", "Price my product", "Something else"]
    cash = client.post(f"/task-sessions/{money['id']}/inputs", json={"answers": {"goal_key": "cash_flow"}}).json()
    assert cash["goal_key"] == "cash_flow" and cash["goal_label"] == "Improve my cash flow" and cash["resolution"]["resolution_class"] == "composite_goal"
    assert all(q["default"] == "" for q in cash["questions"])               # nothing preselected
    other = client.post("/task-sessions", json={"text": "help me with money"}).json()
    other = client.post(f"/task-sessions/{other['id']}/inputs", json={"answers": {"goal_key": "other"}}).json()
    assert other["next"] == "none" and other["state"] == "blocked" and other["resolution"]["message"].startswith("No problem.")


def test_everything_said_in_one_sentence_is_shown_for_confirmation_and_nothing_is_asked_twice(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Create an invoice for ABC Consulting Ltd for website redesign £1,500", "entry_mode": "free_text"}).json()
    assert s["proposed"] == {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1500.0} and s["missing"] == []
    assert s["next"] == "questions" and s["inputs"] == {}                   # proposed, not yet the visitor's confirmed answers
    assert [(x["value"], x["proposed"]) for x in s["summary"]] == [("ABC Consulting Ltd", True), ("website redesign", True), ("£1,500", True)]
    # "That's right" confirms them as they are; a correction sent with the form wins over what was read.
    ok = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "confirm": True}).json()
    assert ok["inputs"] == s["proposed"] and ok["proposed"] == {} and ok["next"] == "identity"
    t = client.post("/task-sessions", json={"text": "Create an invoice for ABC Consulting Ltd for website redesign £1,500"}).json()
    fixed = client.post(f"/task-sessions/{t['id']}/inputs", json={"answers": {"amount": 1800}}).json()
    assert fixed["inputs"] == {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1800.0}
    # Funding: the amount and what it is for are read; only the stage is left to ask.
    f = client.post("/task-sessions", json={"text": "I need £50k for hiring", "entry_mode": "free_text"}).json()
    assert f["goal_key"] == "need_funding" and f["proposed"] == {"amount": 50000.0, "use": "hiring"} and f["missing"] == ["stage"]


def test_the_page_reports_only_known_funnel_steps_and_never_content(world):
    env, store, client, who = world
    assert client.post("/goal-events", json={"name": "homepage_goal_prompt_viewed"}).status_code == 202
    assert client.post("/goal-events", json={"name": "entry_mode_selected", "entry_mode": "business_goal", "key": "need_funding"}).status_code == 202
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    assert client.post("/goal-events", json={"name": "verification_started", "session_id": s["id"]}).status_code == 202
    assert client.post("/goal-events", json={"name": "dashboard_handoff_completed", "session_id": s["id"]}).status_code == 202
    assert client.post("/goal-events", json={"name": "anything_else"}).status_code == 422
    assert client.post("/goal-events", json={"name": "entry_mode_selected", "entry_mode": "x" * 10, "key": "DROP TABLE"}).status_code == 202
    seen = [(e["name"], e["entry_mode"], e["goal_key"]) for e in store.events if e["name"] in goals.CLIENT_EVENTS]
    assert seen == [("homepage_goal_prompt_viewed", None, None), ("entry_mode_selected", "business_goal", "need_funding"),
                    ("verification_started", "business_goal", "need_funding"), ("dashboard_handoff_completed", "business_goal", "need_funding"),
                    ("entry_mode_selected", None, None)]
    # The homepage demo adds three of its own: opened, watched to the end, and "Try it yourself".
    assert {"demo_opened", "demo_completed", "demo_try_it_clicked"} <= set(goals.CLIENT_EVENTS)
    assert (set(goals.CLIENT_EVENTS) | set(goals.SERVER_EVENTS)) - {"demo_opened", "demo_completed", "demo_try_it_clicked"} == {
        "homepage_goal_prompt_viewed", "entry_mode_selected", "goal_or_task_submitted", "goal_outcome_resolved", "capability_match_classified",
        "verification_started", "email_verified", "task_or_goal_path_resumed", "first_output_prepared", "dashboard_handoff_completed"}
    assert client.get("/task-sessions/not-a-session").status_code == 404
    assert client.post("/task-sessions", json={}).status_code == 422


def test_anonymous_starts_are_capped_and_nothing_here_spends_credits(world):
    env, store, client, who = world
    assert client.get("/goal-suggestions").status_code == 200
    assert client.post("/goal-resolution", json={"text": "I need more customers"}).json()["resolution_class"] == "composite_goal"
    for _ in range(goal_router.START_LIMIT):
        assert client.post("/task-sessions", json={"key": "test_idea"}).status_code == 201
    assert client.post("/task-sessions", json={"key": "test_idea"}).status_code == 429
    assert env.meter.charges == []


def _funding(client, amount=50000, use="hiring"):
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": amount, "use": use, "stage": "trading"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    return s["id"], client.post(f"/task-sessions/{s['id']}/prepare").json()


def test_a_second_funding_goal_asks_whether_to_update_the_case_that_is_there_or_start_another(world):
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    cases = lambda: [r for r in run(svc.store.list("subjects", "A", kind=rules.FUNDING)) if r["status"] != "archived"]      # noqa: E731
    _first, made = _funding(client)
    assert made["state"] == "handed_off" and len(cases()) == 1 and cases()[0]["data"]["title"] == "£50,000 for hiring"
    first_id = made["handoff"]["subject_id"]
    # Asked again: nothing is created. One question, with what would change said on the option.
    sid, asked = _funding(client, amount=80000, use="a second site")
    assert asked["next"] == "choose" and asked["handoff"] is None and asked["state"] == "collecting_required_data" and len(cases()) == 1
    assert asked["choose"]["label"] == "You already have a funding case. Update it or start a new one?"
    assert asked["choose"]["options"] == [{"value": first_id, "label": "Update £50,000 for hiring (amount £50,000 → £80,000)"}, {"value": "new", "label": "Start a new case"}]
    assert client.post(f"/task-sessions/{sid}/prepare").json()["next"] == "choose" and len(cases()) == 1      # still nothing until they say
    assert client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": "not-theirs"}}).json()["next"] == "choose"
    # Update: the same case, with the new answers, checked again.
    assert client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": first_id}}).json()["next"] == "prepare"
    updated = client.post(f"/task-sessions/{sid}/prepare").json()
    assert updated["state"] == "handed_off" and updated["handoff"]["subject_id"] == first_id and updated["handoff"]["updated_existing"] is True
    assert updated["handoff"]["to"] == f"/funding/{first_id}?tab=results"
    assert updated["handoff"]["message"].startswith('I updated "£50,000 for hiring" with what you told me: £80,000 to fund: "a second site". ')
    assert len(cases()) == 1 and (cases()[0]["data"]["target_amount"], cases()[0]["data"]["purpose"]) == (80000, "a second site")
    # Start a new one: a second case, named from its own answers.
    sid, asked = _funding(client, amount=20000, use="Stock for Christmas")
    assert asked["next"] == "choose"
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": "new"}})
    fresh = client.post(f"/task-sessions/{sid}/prepare").json()
    assert fresh["handoff"]["subject_id"] != first_id and fresh["handoff"]["updated_existing"] is False and len(cases()) == 2
    assert {c["data"]["title"] for c in cases()} == {"£50,000 for hiring", "£20,000 for stock for Christmas"}
    # With two on record the question names both. An archived case is not offered.
    sid, asked = _funding(client, amount=1000, use="tools")
    assert asked["choose"]["label"] == "You already have funding cases. Update one or start a new one?" and len(asked["choose"]["options"]) == 3
    run(svc.set_status(OWNER, "A", rules.FUNDING, first_id, "archive", OWNER))
    sid, asked = _funding(client, amount=1000, use="tools")
    assert [o["value"] for o in asked["choose"]["options"]] == [fresh["handoff"]["subject_id"], "new"]
    assert env.meter.charges == []


def test_a_signed_in_owner_with_several_workspaces_says_which_one_and_cannot_name_someone_elses(world):
    env, store, client, who = world
    env.businesses["A2"] = {"owner": OWNER, "name": "Second Shop", "data": {"workspace_profile": {"company_name": "Second Shop"}, "catalogue": {"customers": [], "products": []}, "financials": {}}, "members": {}}
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "create_invoice", "entry_mode": "quick_task"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "Frank", "item": "Shelving", "amount": 90}})
    assert client.post(f"/task-sessions/{s['id']}/resume", json={"business_id": "A2"}).json()["business_id"] == "A2"
    t = client.post("/task-sessions", json={"key": "create_invoice", "entry_mode": "quick_task"}).json()
    client.post(f"/task-sessions/{t['id']}/inputs", json={"answers": {"customer": "Frank", "item": "Shelving", "amount": 90}})
    mine = client.post(f"/task-sessions/{t['id']}/resume", json={"business_id": "B"}).json()["business_id"]      # B belongs to someone else
    assert mine in ("A", "A2") and env.businesses[mine]["owner"] == OWNER
    assert s["preparing_label"] == "Preparing your invoice"


def test_i_need_an_invoice_for_mark_300_dollars_on_the_homepage_reads_as_the_agent_chat_reads_it(world):
    """The exact sentence from the browser check: lower-case name, a comma, a dollar sign."""
    from datetime import date
    from app.modules.agent import said
    env, store, client, who = world
    text = "I need an invoice for mark, $300"
    s = client.post("/task-sessions", json={"text": text, "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "create_invoice" and s["proposed"] == {"customer": "Mark", "amount": 300.0}
    assert (s["currency"], s["currency_note"], s["currency_options"]) == ("USD", "In USD", ["USD", "GBP"])
    assert s["missing"] == ["item"]                                         # only "What is it for?" is asked
    assert [(q["key"], q["proposed"], q["default"]) for q in s["questions"]] == [("customer", True, "Mark"), ("item", False, ""), ("amount", True, 300.0)]
    assert [q.get("prefix") for q in s["questions"]] == [None, None, "$"]   # the sign follows what was written, not the default
    assert [(x["label"], x["value"]) for x in s["summary"]] == [("Who is it for?", "Mark"), ("How much?", "$300"), ("Currency", "USD")]
    assert s["resolution"]["credit_badge"] == "Free"
    # One reader: the Agent chat takes the same name, amount and currency from the same words.
    told = said.read(text, date(2026, 10, 7))
    assert (told["party"].lower(), told["amount"], told["currency"]) == ("mark", 300.0, "USD") and "work" not in told
    # Carried through sign-in: the invoice is prepared for Mark, at 300, in dollars.
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting"}}).json()
    assert s["inputs"] == {"customer": "Mark", "item": "Consulting", "amount": 300.0} and s["next"] == "identity" and s["currency"] == "USD"
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    run_id = client.post(f"/task-sessions/{s['id']}/prepare").json()["handoff"]["run_id"]
    shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
    fields = {f["key"]: f for f in shown["pending_question"]["fields"]}
    assert fields["customer_name"]["default"] == "Mark" and fields["currency"]["default"] == "USD"
    assert fields["items"]["suggested"] == [{"product_id": None, "name": "Consulting", "quantity": 1, "unit_price": 300.0}]
    # Switched to pounds in the form: the figure stays, the sign changes, nothing is converted.
    t = client.post("/task-sessions", json={"text": text}).json()
    t = client.post(f"/task-sessions/{t['id']}/inputs", json={"answers": {"currency": "GBP", "item": "Consulting"}}).json()
    assert (t["currency"], t["currency_note"], t["inputs"]["amount"]) == ("GBP", "", 300.0) and t["questions"][2]["prefix"] == "£"
    # A sentence in pounds says nothing about currency at all.
    plain = client.post("/task-sessions", json={"text": "invoice for mark, £300"}).json()
    assert (plain["currency"], plain["currency_note"], plain["currency_options"]) == ("GBP", "", []) and plain["questions"][2]["prefix"] == "£"


def test_a_task_started_from_the_homepage_is_carried_out_on_any_plan_and_charged_in_credits(world):
    """From the browser: a workspace on the Explorer plan asked for an invoice on the homepage, pressed
    "Save to <workspace> and continue", and landed on the dashboard with no invoice and no word why."""
    env, store, client, who = world
    env.meter.plans[OWNER] = "explorer"                                     # the free plan, as that workspace was
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"text": "I need an invoice for mark, $300", "entry_mode": "free_text"}).json()
    assert s["resolution"]["credit_badge"] == "Uses AI Credits"
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    # The homepage promises free essential tools: the invoice is prepared, on the dashboard, waiting for what is still missing.
    assert done["state"] == "awaiting_review" and done["handoff"]["to"].startswith("/dashboard?task=") and "blocked" not in done["handoff"]
    shown = client.get(f"/workflow-runs/{done['handoff']['run_id']}").json()["run"]
    assert shown["workflow_key"] == "new_invoice" and {f["key"]: f for f in shown["pending_question"]["fields"]}["customer_name"]["default"] == "Mark"
    # And it goes all the way on the free plan: answered, approved, sent. Nothing later in the task turns it away.
    fields = {f["key"]: f for f in shown["pending_question"]["fields"]}
    answered = client.post(f"/workflow-runs/{shown['id']}/input", json={"answers": {
        **({"customer_id": "new"} if "customer_id" in fields else {}), "customer_name": "Mark", "customer_email": "mark@example.test", "currency": "USD",
        "items": [{"name": "Consulting", "quantity": 1, "unit_price": 300}], **({"vat_rate": 0} if "vat_rate" in fields else {})}}).json()["run"]
    assert answered["status"] == "awaiting_approval", answered.get("pending_question") or answered.get("error")
    approval = env.pending(answered)[0]
    assert (approval["payload"]["customer_name"], approval["payload"]["total"], approval["payload"]["currency"]) == ("Mark", 360, "USD")      # 300 plus this business's 20% VAT, in dollars
    assert client.get("/businesses/A/agent/summary").json()["needs_approval_count"] == 1      # it is there on the dashboard, in Needs Approval
    sent = client.post(f"/workflow-runs/{shown['id']}/approvals/{approval['id']}/approve")
    assert sent.status_code == 200 and len(env.comms.sent) == 1 and env.fin["invoices"][-1]["status"] == "sent"
    assert [c[2] for c in env.meter.charges] == [2, 2] and env.meter.balances[OWNER] == 96      # charged in AI Credits: 2 to prepare, 2 to send
    # The same request typed inside the app follows the plan, as before: the homepage is not a way round it for anything else.
    inside = client.post("/agent/requests", json={"business_id": "A", "capability": "new_proposal", "text": "a proposal for Mark"}).json()
    assert inside["kind"] == "blocked" and inside["message"] == "New Proposal is on the Starter plan." or (inside["kind"] == "blocked" and inside["message"].endswith("is on the Starter plan."))
    forged = client.post("/agent/requests", json={"business_id": "A", "capability": "new_proposal", "text": "a proposal for Mark", "essential_handoff": True,
                                                  "params": {"essential_handoff": True}, "source_reference": "goal:anything"}).json()
    assert forged["kind"] == "blocked"                                      # the pass is the server's to give, not the caller's to claim
    # Every homepage goal and task is carried out on the free plan, not just the invoice: none is turned away for the plan.
    answers = {"amount": 1000, "use": "stock", "stage": "trading", "sell": "bookkeeping", "customer": "Frank", "channel": "referrals", "price": 100, "cost": 40,
               "target_date": "2026-12-01", "owed": "some", "pressure": "late payers", "limit": "time", "description": "Bookkeeping for small firms",
               "problem": "month end takes too long", "worry": "one big client", "item": "Consulting", "solution": "A website redesign"}
    for n, goal in enumerate(goals.GOALS):                                  # twelve tasks: well past Explorer's five a month, and still none refused
        g = client.post("/task-sessions", json={"key": goal["key"]}).json()
        assert g["resolution"]["credit_badge"] in ("Free", "Uses AI Credits"), goal["key"]      # never "needs a plan"
        client.post(f"/task-sessions/{g['id']}/inputs", json={"answers": {q["key"]: answers[q["key"]] for q in g["questions"]}})
        client.post(f"/task-sessions/{g['id']}/resume")
        out = client.post(f"/task-sessions/{g['id']}/prepare").json()
        assert out["state"] in ("awaiting_review", "handed_off") and (out["handoff"].get("run_id") or out["handoff"].get("subject_id")), (goal["key"], out["handoff"])
        assert "blocked" not in out["handoff"] and "Upgrade" not in str(out["handoff"].get("message") or "")
    # What does stop a task is AI Credits. With none left it is said (never swallowed), what was told is kept, and it goes through once there are credits.
    env.meter.balances[OWNER] = 0
    p = client.post("/task-sessions", json={"key": "prepare_proposal", "entry_mode": "quick_task"}).json()
    client.post(f"/task-sessions/{p['id']}/inputs", json={"answers": {"customer": "Frank", "solution": "A website redesign", "amount": 1500}})
    client.post(f"/task-sessions/{p['id']}/resume")
    refused = client.post(f"/task-sessions/{p['id']}/prepare").json()
    assert refused["state"] == "blocked" and refused["handoff"]["blocked"] is True and "run_id" not in refused["handoff"]
    assert "credit" in refused["handoff"]["message"].lower() and "plan" not in refused["handoff"]["message"].lower().replace("see plans", "")
    assert refused["inputs"]["customer"] == "Frank"                         # what they told us is kept
    env.meter.balances[OWNER] = 20
    client.post(f"/task-sessions/{p['id']}/resume")
    now = client.post(f"/task-sessions/{p['id']}/prepare").json()
    assert now["state"] == "awaiting_review" and now["handoff"]["run_id"]   # the same session: a refusal is not remembered for ever
    # A brand-new account is on the free plan too: its first task is carried out, and charged.
    who["user"] = None
    n = client.post("/task-sessions", json={"key": "create_business_plan", "entry_mode": "quick_task"}).json()
    client.post(f"/task-sessions/{n['id']}/inputs", json={"answers": {"description": "Bookkeeping for small firms", "customer": "Small practices", "problem": "Month end takes a week"}})
    who["user"] = "brand.new@example.test"
    env.meter.balances["brand.new@example.test"] = 50                       # no plan set: Explorer
    client.post(f"/task-sessions/{n['id']}/attach-user")
    client.post(f"/task-sessions/{n['id']}/resume", json={"business_name": "Brand New Ltd"})
    first = client.post(f"/task-sessions/{n['id']}/prepare").json()
    assert first["state"] == "awaiting_review" and first["handoff"]["run_id"], first["handoff"]
    done = client.get(f"/workflow-runs/{first['handoff']['run_id']}").json()["run"]
    assert done["workflow_key"] == "business_plan_draft" and done["status"] in ("succeeded", "running", "awaiting_approval")


def test_the_funding_case_does_not_ask_again_for_what_was_given_on_the_homepage(world):
    """From the browser: £25,000, what it is for and "Not trading yet" were given on the homepage,
    and the case's first action still read "Enter the amount you want to raise…"."""
    env, store, client, who = world
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 25000, "use": "business", "stage": "pre_revenue"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    svc = service_for(env.orch)
    case = run(svc.store.get("subjects", done["handoff"]["subject_id"]))["data"]
    assert (case["target_amount"], case["currency"], case["purpose"], case["stage"]) == (25000, "GBP", "business", "pre_revenue")      # all of it is on the case, currency included
    detail = run(svc.get_subject(OWNER, "A", rules.FUNDING, done["handoff"]["subject_id"], OWNER))
    actions = {a["code"]: a for a in detail["actions"]}
    # Each action names only what is still missing.
    assert actions["C1.A"]["title"] == "Enter when you expect to receive the funding, then confirm the amount and date."
    assert actions["C1.A"]["why"] == "Not entered yet: intended receipt date. Already entered: GBP 25,000.00."
    assert actions["C1.B"]["title"] == "Add a milestone the funding pays for, with a measure and a target, and link the purpose to it."
    assert actions["C1.B"]["why"] == "What the funding is for is entered. It isn't linked to a milestone yet."
    assert not any("the amount you want to raise" in a["title"] or a["title"].startswith("Say what the funding is for") for a in detail["actions"])
    # With nothing given, the full wording stands; the result itself (state, score, gates) is the same either way.
    bare = run(svc.create_subject(OWNER, "A", rules.FUNDING, {"title": "Empty case"}, OWNER))
    run(svc.request_assessment(OWNER, "A", rules.FUNDING, bare["id"], email=OWNER))
    empty = {a["code"]: a for a in run(svc.get_subject(OWNER, "A", rules.FUNDING, bare["id"], OWNER))["actions"]}
    assert empty["C1.A"]["title"].startswith("Enter the amount you want to raise")
    assert detail["assessment"]["result"]["classification"] == run(svc.get_subject(OWNER, "A", rules.FUNDING, bare["id"], OWNER))["assessment"]["result"]["classification"]


# ══ the save checkpoint: the email is verified in place, with a code ═════════

class _Accounts:
    """Accounts in memory, standing in for the users table."""

    def __init__(self, users=None):
        self.users = {u["id"]: u for u in users or []}
        self.finds = 0

    async def find(self, email):
        self.finds += 1
        return self.users.get(email)

    async def create(self, email, timezone_name=None, name=None):
        self.users[email] = {"id": email, "email": email, "email_verified": True, "auth_provider": "email_code", **({"name": name} if name else {})}
        return self.users[email]

    async def set_name(self, email, name):
        self.users[email]["name"] = name

    async def mark_verified(self, email):
        self.users[email]["email_verified"] = True

    def token(self, user_id):
        return f"token-for-{user_id}"


@pytest.fixture()
def mail(world, monkeypatch):
    """The world, plus the accounts and the outbox the code is sent through."""
    env, store, client, who = world
    accounts = _Accounts([{"id": "has.password@example.test", "email": "has.password@example.test", "password_hash": "x", "email_verified": True},
                          {"id": "googler@gmail.com", "email": "googler@gmail.com", "auth_provider": "google", "google_sub": "g-1", "email_verified": True},
                          {"id": "unverified@example.test", "email": "unverified@example.test", "password_hash": "x", "email_verified": False},
                          {"id": "blocked@example.test", "email": "blocked@example.test", "is_blocked": True, "email_verified": True}])
    sent = []

    async def post(email, code, saving):
        sent.append({"to": email, "code": code, "saving": saving})
    monkeypatch.setattr(goal_router, "_accounts", accounts)
    monkeypatch.setattr(goal_router, "send_code_email", post)
    return env, store, client, who, accounts, sent


def _ready_to_save(client, text="I need an invoice for mark, $300"):
    s = client.post("/task-sessions", json={"text": text, "entry_mode": "free_text"}).json()
    return client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting"}}).json()


def test_a_new_email_is_verified_with_a_code_in_place_then_the_account_the_business_name_and_the_draft(mail):
    env, store, client, who, accounts, sent = mail
    s = _ready_to_save(client)
    assert s["next"] == "identity" and s["verification"] is None and s["saving"] == "Create Invoice for Mark · $300 · USD"
    out = client.post(f"/task-sessions/{s['id']}/email", json={"email": "New.Person@Example.test", "name": "  Nia   Person "}).json()
    assert out["first_name"] == "Nia" and "Person" not in str(out)          # their first name comes back, to greet them with; the rest stays on the server
    assert out["verification"] == {"sent": True, "masked": "n•••@example.test", "expires_at": out["verification"]["expires_at"], "google": False}
    assert "new.person" not in str(out).lower()                             # the address itself is not echoed back
    assert [(m["to"], len(m["code"]), m["code"].isdigit(), m["saving"]) for m in sent] == [("new.person@example.test", 6, True, "Create Invoice for Mark · $300 · USD")]
    assert accounts.finds == 0 and "new.person@example.test" not in accounts.users      # nothing is looked up, or made, before the code is right
    done = client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[0]["code"]}).json()
    assert (done["access_token"], done["email"], done["new_account"]) == ("token-for-new.person@example.test", "new.person@example.test", True)
    made = accounts.users["new.person@example.test"]
    assert made["email_verified"] is True and "password_hash" not in made   # no password asked for now
    assert made["name"] == "Nia Person"                                     # the name given with the email is on the account
    assert done["session"]["authenticated"] is True and done["session"]["verification"] is None
    assert client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[0]["code"]}).status_code == 400      # a code works once
    # Signed in with that token: only the (optional) business name is asked, then the draft is prepared.
    who["user"] = "new.person@example.test"
    env.meter.balances["new.person@example.test"] = 50
    resumed = client.post(f"/task-sessions/{s['id']}/resume", json={"business_name": "Person & Co"}).json()
    assert env.businesses[resumed["business_id"]]["owner"] == "new.person@example.test"
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    run_id = prepared["handoff"]["run_id"]
    assert prepared["handoff"]["to"] == f"/dashboard?task={run_id}"
    shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
    done = client.post(f"/workflow-runs/{run_id}/input", json={"answers": {"customer_name": "Mark", "customer_email": "mark@example.test", "vat_rate": 0, "currency": "USD",
                                                                              "items": [{"name": "Consulting", "quantity": 1, "unit_price": 300}]}}).json()["run"]
    if done.get("pending_question"):      # a brand-new business has no email of its own yet: that one thing is asked
        done = client.post(f"/workflow-runs/{run_id}/input", json={"answers": {"business_email": "hello@person.test"}}).json()["run"]
    assert shown["workflow_key"] == "new_invoice" and done["status"] == "awaiting_approval"
    assert client.get(f"/businesses/{resumed['business_id']}/agent/summary").json()["needs_approval_count"] == 1      # the draft, in Needs Approval
    names = [e["name"] for e in store.events]
    assert names.index("verification_started") < names.index("email_verified") < names.index("first_output_prepared")
    assert "new.person" not in str(store.events)


@pytest.mark.parametrize("email, google", [("has.password@example.test", False), ("googler@gmail.com", True), ("unverified@example.test", False)])
def test_an_existing_account_is_signed_in_by_the_same_code_whatever_way_it_was_made(mail, email, google):
    env, store, client, who, accounts, sent = mail
    before = dict(accounts.users[email])
    s = _ready_to_save(client)
    out = client.post(f"/task-sessions/{s['id']}/email", json={"email": email}).json()
    # The same answer as for an address with no account: nothing here says whether one exists. (Google is offered by the address's domain alone.)
    assert set(out["verification"]) == {"sent", "masked", "expires_at", "google"} and out["verification"]["google"] is google
    assert accounts.finds == 0
    done = client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[-1]["code"]}).json()
    assert (done["access_token"], done["new_account"]) == (f"token-for-{email}", False)
    after = accounts.users[email]
    assert after["email_verified"] is True and {k: v for k, v in after.items() if k != "email_verified"} == {k: v for k, v in before.items() if k != "email_verified"}      # the account is theirs, untouched
    assert done["session"]["authenticated"] is True


def test_a_wrong_or_expired_code_keeps_the_task_and_a_new_code_can_be_sent(mail):
    env, store, client, who, accounts, sent = mail
    s = _ready_to_save(client)
    sid = s["id"]
    assert client.post(f"/task-sessions/{sid}/email", json={"email": "not an address"}).status_code == 422
    assert client.post(f"/task-sessions/{sid}/verify", json={"code": "123456"}).json()["detail"] == "Enter your email address first."
    client.post(f"/task-sessions/{sid}/email", json={"email": "new.person@example.test"})
    wrong = "000000" if sent[0]["code"] != "000000" else "111111"
    bad = client.post(f"/task-sessions/{sid}/verify", json={"code": wrong})
    assert bad.status_code == 400 and bad.json()["detail"] == "That code isn't right. Check the email and try again."
    # The task is exactly as it was: a refresh mid-verification shows the code step again, with everything given.
    again = client.get(f"/task-sessions/{sid}").json()
    assert again["inputs"] == {"customer": "Mark", "item": "Consulting", "amount": 300.0} and again["currency"] == "USD" and again["next"] == "identity"
    assert again["verification"]["sent"] is True and again["verification"]["masked"] == "n•••@example.test" and again["authenticated"] is False
    # Asking again straight away does not flood the inbox; after a pause a fresh code replaces the old one.
    client.post(f"/task-sessions/{sid}/email", json={})
    assert len(sent) == 1
    row = store.rows[sid]
    row["verify"]["sent_at"] = "2026-01-01T00:00:00+00:00"
    client.post(f"/task-sessions/{sid}/email", json={})                    # Resend: no address needed, it is on the session
    assert len(sent) == 2 and sent[1]["to"] == "new.person@example.test"
    if sent[0]["code"] != sent[1]["code"]:
        assert client.post(f"/task-sessions/{sid}/verify", json={"code": sent[0]["code"]}).status_code == 400      # the old code is dead
    # Expired: said, and a new one works.
    row["verify"]["expires_at"] = "2026-01-01T00:00:00+00:00"
    assert client.post(f"/task-sessions/{sid}/verify", json={"code": sent[1]["code"]}).json()["detail"] == "That code has expired. Send a new one."
    row["verify"]["sent_at"] = "2026-01-01T00:00:00+00:00"
    client.post(f"/task-sessions/{sid}/email", json={})
    # Five wrong tries lock that code (not the task): only a new one will do.
    for _ in range(goals.CODE_ATTEMPTS):
        client.post(f"/task-sessions/{sid}/verify", json={"code": "9" * 6 if sent[-1]["code"] != "9" * 6 else "8" * 6})
    assert client.post(f"/task-sessions/{sid}/verify", json={"code": sent[-1]["code"]}).json()["detail"] == "Too many tries with that code. Send a new one."
    row["verify"]["sent_at"] = "2026-01-01T00:00:00+00:00"
    client.post(f"/task-sessions/{sid}/email", json={})
    ok = client.post(f"/task-sessions/{sid}/verify", json={"code": sent[-1]["code"]})
    assert ok.status_code == 200 and ok.json()["session"]["inputs"]["customer"] == "Mark"
    # Changing the email sends to the new address, and the old address's code no longer counts.
    t = _ready_to_save(client)
    client.post(f"/task-sessions/{t['id']}/email", json={"email": "first@example.test"})
    client.post(f"/task-sessions/{t['id']}/email", json={"email": "second@example.test"})
    assert sent[-1]["to"] == "second@example.test" and client.get(f"/task-sessions/{t['id']}").json()["verification"]["masked"] == "s•••@example.test"
    assert client.post(f"/task-sessions/{t['id']}/verify", json={"code": sent[-1]["code"]}).json()["email"] == "second@example.test"


def test_a_suspended_account_is_not_let_in_and_a_session_bound_to_someone_else_is_not_handed_over(mail):
    env, store, client, who, accounts, sent = mail
    s = _ready_to_save(client)
    client.post(f"/task-sessions/{s['id']}/email", json={"email": "blocked@example.test"})
    assert client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[-1]["code"]}).status_code == 403
    t = _ready_to_save(client)
    who["user"] = OWNER
    client.post(f"/task-sessions/{t['id']}/attach-user")
    who["user"] = None
    client.post(f"/task-sessions/{t['id']}/email", json={"email": "new.person@example.test"})
    assert client.post(f"/task-sessions/{t['id']}/verify", json={"code": sent[-1]["code"]}).status_code == 403


def test_the_name_given_at_the_checkpoint_fills_an_account_that_has_none_and_never_replaces_one(mail):
    env, store, client, who, accounts, sent = mail
    accounts.users["has.password@example.test"]["name"] = "Already Named"
    for email, expected in (("googler@gmail.com", "Typed Name"), ("has.password@example.test", "Already Named")):
        s = _ready_to_save(client)
        client.post(f"/task-sessions/{s['id']}/email", json={"email": email, "name": "Typed Name"})
        assert client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[-1]["code"]}).status_code == 200
        assert accounts.users[email]["name"] == expected
    # Resending a code needs neither the address nor the name again: both are kept with the task.
    s = _ready_to_save(client)
    client.post(f"/task-sessions/{s['id']}/email", json={"email": "later@example.test", "name": "Later Person"})
    store.rows[s["id"]]["verify"]["sent_at"] = "2026-01-01T00:00:00+00:00"
    client.post(f"/task-sessions/{s['id']}/email", json={})
    client.post(f"/task-sessions/{s['id']}/verify", json={"code": sent[-1]["code"]})
    assert accounts.users["later@example.test"]["name"] == "Later Person"
