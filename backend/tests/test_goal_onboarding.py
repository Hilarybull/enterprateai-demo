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
    assert not any(k.startswith("credit") for k in r)      # a task card never says what it costs


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
    # Only funding until the others are ready (the owner, 22 Oct); typed, they are still understood
    assert [g["label"] for g in s["goals"]] == ["I need funding"]
    assert goals.resolve(text="Test a business idea")["goal_key"] == "test_idea"
    # Off the chips (13 Oct 2026), still understood when typed.
    assert goals.resolve(text="Improve my cash flow")["goal_key"] == "cash_flow" and goals.resolve(text="Help me grow my business")["goal_key"] == "grow"
    assert [t["label"] for t in s["tasks"]] == ["Create Invoice", "Create Quotation", "Create Business Plan"]      # a proposal is asked for in words, not a homepage shortcut
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
    assert s["resolution"]["start_capability"] == "new_invoice" and [q["key"] for q in s["questions"]] == ["customer", "customer_email", "item", "quantity", "amount", "vat_rate", "due_days"]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "ABC Consulting Ltd", "item": "Website redesign", "amount": 1500,
                                                                               "customer_email": "accounts@abc.test", "vat_rate": 20}}).json()
    assert s["state"] == "awaiting_identity" and s["next"] == "identity" and s["missing"] == []
    # Nothing private exists yet, and nothing can be prepared without signing in.
    assert "ABC Consulting Ltd" not in _records(env) and set(env.businesses) == before_businesses and run(env.store.list_runs("A")) == []
    assert client.post(f"/task-sessions/{s['id']}/prepare").status_code == 401
    assert env.meter.charges == []                                          # goal resolution and the questions cost nothing
    # Refresh, redirect, coming back from the verification email: the session is still there.
    again = client.get(f"/task-sessions/{s['id']}").json()
    assert {k: v for k, v in again["inputs"].items() if k in ("customer", "item", "amount")} == {"customer": "ABC Consulting Ltd", "item": "Website redesign", "amount": 1500.0} and again["resolution"]["original_goal"] == "Create Invoice"
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
    # Everything the invoice needs was asked on the homepage: on the dashboard nothing about it is asked again.
    shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
    assert shown["workflow_key"] == "new_invoice" and shown["business_id"] == mine
    asked = {f["key"] for f in (shown.get("pending_question") or {}).get("fields") or []}
    assert not asked & {"customer_name", "customer_id", "customer_email", "items", "vat_rate"}
    done = shown
    # A brand-new business starts with the sign-up email as its contact email (the owner's rule, 16 Oct): nothing more is
    # asked, and the draft waits for approval.
    assert data["workspace_profile"]["email"] == NEW_USER
    assert done["status"] == "awaiting_approval", done.get("pending_question") or done.get("error")      # a reviewable draft; sending still needs approval
    approval = env.pending(done)[0]
    assert approval["tool_id"] == "send_invoice" and (approval["payload"]["customer_name"], approval["payload"]["total"]) == ("ABC Consulting Ltd", 1800)      # 1,500 plus the 20% VAT given on the homepage
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
    # The first task is not free any more (config.FIRST_TASK_FREE is off): the badge and the line say what it costs,
    # and the meter moves by exactly that (QA R13: the badge said "Free" while 2 credits were charged).
    assert not any(k.startswith("credit") for k in s["resolution"])      # a task card never says what it costs
    assert env.meter.charges == [(NEW_USER, "agent_invoice_draft", 2)] and env.meter.balances[NEW_USER] == 48
    sent = client.post(f"/workflow-runs/{run_id}/approvals/{approval['id']}/approve").json()
    assert sent.get("run", sent).get("status") != "failed" and len(env.comms.sent) == 1
    assert [c[2] for c in env.meter.charges] == [2, 2] and env.meter.balances[NEW_USER] == 46      # prepared, then sent: 2 + 2
    assert "free_first_task" not in (data.get("onboarding") or {})      # nothing is marked free while FIRST_TASK_FREE is off


def test_an_existing_user_resumes_into_their_own_business_and_another_account_cannot_take_the_session(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Create an invoice for BrightTech Ltd", "entry_mode": "free_text"}).json()
    # The customer was in the sentence: proposed for confirmation, and only the rest is still to be asked.
    assert s["proposed"] == {"customer": "BrightTech Ltd"} and s["missing"] == ["customer_email", "item", "amount", "vat_rate"] and s["next"] == "questions"
    assert [(q["key"], q["proposed"], q["default"]) for q in s["questions"] if q["key"] in ("customer", "item", "amount")] == [("customer", True, "BrightTech Ltd"), ("item", False, ""), ("amount", False, "")]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Strategy Workshop", "amount": 1500, "customer_email": "buyer@brighttech.test", "vat_rate": 20}}).json()
    assert {k: v for k, v in s["inputs"].items() if k in ("customer", "item", "amount")} == {"customer": "BrightTech Ltd", "item": "Strategy Workshop", "amount": 1500.0} and s["proposed"] == {} and s["next"] == "identity"
    assert [(x["label"], x["value"]) for x in s["summary"]] == [("Who is it for?", "BrightTech Ltd"), ("What is their email address?", "buyer@brighttech.test"), ("What is it for?", "Strategy Workshop"),
                                                                ("What price for each?", "£1,500"), ("Do you charge VAT on this?", "20")]
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
    assert [q["key"] for q in s["questions"] if not q.get("hidden")] == ["amount", "use", "stage", "route", "timing", "traction"]      # the six questions asked (the place is read, never asked)
    assert s["progress"] == {"answered": 0, "total": 6} and s["resolution"]["recommended_path"] == []      # counted in questions; no list of engines
    amount, _use, stage = s["questions"][:3]
    assert amount["prefix"] == "£" and [c["label"] for c in amount["chips"]] == ["£10k", "£25k", "£50k", "£100k", "£250k"]      # short, as people say them (the owner's brief)
    assert stage["default"] == "" and s["missing"] == ["amount", "use", "stage", "route", "timing", "traction"]      # no answer is guessed for them
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 50000, "use": "Hire two developers and fund six months of marketing", "stage": "trading", "route": "equity", "timing": "Within 3 months", "traction": "Paying customers"}}).json()
    assert s["next"] == "identity"
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    credits = env.meter.balances[OWNER]
    prepared = client.post(f"/task-sessions/{s['id']}/prepare").json()
    assert prepared["state"] == "handed_off" and prepared["handoff"]["to"].startswith("/funding/")
    # First value is the result, not an empty case: the check has been run, and the case opens on it.
    said = prepared["handoff"]["message"]
    # Their words are quoted as they wrote them, not bent into the sentence.
    assert said.startswith('I set up your funding plan from what you told me: £50,000 to fund: "Hire two developers and fund six months of marketing". ')
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
    assert case["data"]["title"].startswith("£50k equity investment to hire two developers")      # named in plain words (the owner's brief)
    assert env.meter.balances[OWNER] == credits and env.meter.charges == []      # getting here used no AI Credits


def test_a_no_match_and_a_clarifying_question_from_the_homepage(world):
    env, store, client, who = world
    # QA U1a: the rules alone never refuse. With no model to agree that nothing fits (as in tests), the closest
    # goals are offered in one question, and "Something else" ends it plainly.
    unplaced = client.post("/task-sessions", json={"text": "book me a flight to Lagos"}).json()
    assert unplaced["next"] == "clarify" and unplaced["questions"] == []
    assert [o["value"] for o in unplaced["clarify"]["options"]][-1] == "other"
    ended = client.post(f"/task-sessions/{unplaced['id']}/inputs", json={"answers": {"goal_key": "other"}}).json()
    assert ended["state"] == "blocked" and ended["next"] == "none" and ended["questions"] == []      # honest, no fake task, no sign-up asked for
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
    assert s["proposed"] == {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1500.0} and s["missing"] == ["customer_email", "vat_rate"]
    assert s["next"] == "questions" and s["inputs"] == {}                   # proposed, not yet the visitor's confirmed answers
    assert [(x["value"], x["proposed"]) for x in s["summary"]] == [("ABC Consulting Ltd", True), ("website redesign", True), ("£1,500", True)]
    # "That's right" confirms them as they are; a correction sent with the form wins over what was read.
    ok = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "confirm": True}).json()
    assert ok["inputs"] == s["proposed"] and ok["proposed"] == {} and ok["next"] == "questions" and ok["missing"] == ["customer_email", "vat_rate"]      # what was said is confirmed; only the rest is asked
    t = client.post("/task-sessions", json={"text": "Create an invoice for ABC Consulting Ltd for website redesign £1,500"}).json()
    fixed = client.post(f"/task-sessions/{t['id']}/inputs", json={"answers": {"amount": 1800}}).json()
    assert fixed["inputs"] == {"customer": "ABC Consulting Ltd", "item": "website redesign", "amount": 1800.0}
    # Funding: the amount and what it is for are read; only the stage is left to ask.
    f = client.post("/task-sessions", json={"text": "I need £50k for hiring", "entry_mode": "free_text"}).json()
    assert f["goal_key"] == "need_funding" and f["proposed"] == {"amount": 50000.0, "use": "hiring"} and f["missing"] == ["stage", "route", "timing", "traction"]


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
        "verification_started", "email_verified", "task_or_goal_path_resumed", "first_output_prepared", "dashboard_handoff_completed",
        "questions_avoided", "first_value_shown",
        # QA PF7: the funnel past the goal (first value, the premium step chosen, its upgrade, the clarifying choice).
        "first_value_premium_clicked", "premium_upgrade_clicked", "onboarding_match_choice",
        # Time to the first question (a number of milliseconds, nothing typed).
        "first_question_shown"}
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
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": amount, "use": use, "stage": "trading", "route": "equity", "timing": "Within 3 months", "traction": "Paying customers"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    return s["id"], client.post(f"/task-sessions/{s['id']}/prepare").json()


def test_a_different_funding_need_asks_update_or_new_and_never_overwrites_the_case_unasked(world):
    """G2 (23 Oct): "I need funding" turned the £100k grant case into a £50k loan under the same id. A different need (amount,
    route or purpose) now asks "Start a new funding case, or update that one?", new by default; Update changes only what
    differs and keeps the title; an archived case is reactivated only when the owner chooses to update it."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    cases = lambda: run(svc.store.list("subjects", "A", kind=rules.FUNDING))      # noqa: E731
    _first, made = _funding(client)
    data = cases()[0]["data"]
    assert made["state"] == "handed_off" and len(cases()) == 1 and data["title"] == "£50k equity investment for hiring"
    assert (data["target_amount"], data["purpose"], data["route_preference"], data["traction"]["summary"]) == (50000, "hiring", "equity", "Paying customers")
    assert data["receipt_date"] and data["provenance"]["target_amount"]["source"].startswith("From your funding chat, ")
    first_id = made["handoff"]["subject_id"]
    # A different need: asked, nothing changed yet
    sid, asked = _funding(client, amount=80000, use="a second site")
    assert asked["choose"]["key"] == "subject_choice" and asked["choose"]["default"] == "new"
    assert [o["value"] for o in asked["choose"]["options"]] == ["new", f"update:{first_id}"]
    assert len(cases()) == 1 and cases()[0]["data"]["target_amount"] == 50000
    # New (the default): a second case beside the first, the first untouched
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": "new"}})
    new = client.post(f"/task-sessions/{sid}/prepare").json()
    assert new["state"] == "handed_off" and new["handoff"]["subject_id"] != first_id and len(cases()) == 2
    first = run(svc.store.get("subjects", first_id))["data"]
    assert (first["title"], first["target_amount"], first["purpose"]) == ("£50k equity investment for hiring", 50000, "hiring")
    # Update, chosen: only what differs changes; the title stays
    sid, asked = _funding(client, amount=60000, use="hiring")
    client.post(f"/task-sessions/{sid}/inputs", json={"answers": {"subject_choice": f"update:{first_id}"}})
    done = client.post(f"/task-sessions/{sid}/prepare").json()
    first = run(svc.store.get("subjects", first_id))["data"]
    assert done["handoff"]["subject_id"] == first_id and first["target_amount"] == 60000 and first["title"] == "£50k equity investment for hiring"
    assert len(cases()) == 2
    # Archived: reactivated only on Update
    run(svc.set_status(OWNER, "A", rules.FUNDING, first_id, "archive", OWNER))
    sid, again = _funding(client, amount=20000, use="Stock for Christmas")
    assert run(svc.store.get("subjects", first_id))["status"] == "archived"
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
    assert s["missing"] == ["customer_email", "item", "vat_rate"]           # only what was not said is asked
    assert [(q["key"], q["proposed"], q["default"]) for q in s["questions"] if q["key"] in ("customer", "item", "amount")] == [("customer", True, "Mark"), ("item", False, ""), ("amount", True, 300.0)]
    assert [q.get("prefix") for q in s["questions"] if q["key"] in ("customer", "item", "amount")] == [None, None, "$"]   # the sign follows what was written, not the default
    assert [(x["label"], x["value"]) for x in s["summary"]] == [("Who is it for?", "Mark"), ("What price for each?", "$300"), ("Currency", "USD")]
    assert not any(k.startswith("credit") for k in s["resolution"])      # no price on the card, signed in or not
    # One reader: the Agent chat takes the same name, amount and currency from the same words.
    told = said.read(text, date(2026, 10, 7))
    assert (told["party"].lower(), told["amount"], told["currency"]) == ("mark", 300.0, "USD") and "work" not in told
    # Carried through sign-in: the invoice is prepared for Mark, at 300, in dollars.
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting", "customer_email": "mark@example.test", "vat_rate": 0}}).json()
    assert s["inputs"] == {"customer": "Mark", "item": "Consulting", "amount": 300.0, "customer_email": "mark@example.test", "vat_rate": 0.0} and s["next"] == "identity" and s["currency"] == "USD"
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    run_id = client.post(f"/task-sessions/{s['id']}/prepare").json()["handoff"]["run_id"]
    shown = client.get(f"/workflow-runs/{run_id}").json()["run"]
    # Everything was said or answered before sign-up: the draft is in dollars and nothing is asked again.
    assert shown["status"] == "awaiting_approval", shown.get("pending_question")
    drafted = env.pending(shown)[0]["payload"]
    assert (drafted["customer_name"], drafted["currency"]) == ("Mark", "USD") and "Consulting" in str(drafted)
    # Switched to pounds in the form: the figure stays, the sign changes, nothing is converted.
    t = client.post("/task-sessions", json={"text": text}).json()
    t = client.post(f"/task-sessions/{t['id']}/inputs", json={"answers": {"currency": "GBP", "item": "Consulting", "customer_email": "mark@example.test", "vat_rate": 0}}).json()
    assert (t["currency"], t["currency_note"], t["inputs"]["amount"]) == ("GBP", "", 300.0) and next(q for q in t["questions"] if q["key"] == "amount")["prefix"] == "£"
    # A sentence in pounds says nothing about currency at all.
    plain = client.post("/task-sessions", json={"text": "invoice for mark, £300"}).json()
    assert (plain["currency"], plain["currency_note"], plain["currency_options"]) == ("GBP", "", []) and next(q for q in plain["questions"] if q["key"] == "amount")["prefix"] == "£"


def test_a_task_started_from_the_homepage_is_carried_out_on_any_plan_and_charged_in_credits(world):
    """From the browser: a workspace on the Explorer plan asked for an invoice on the homepage, pressed
    "Save to <workspace> and continue", and landed on the dashboard with no invoice and no word why."""
    env, store, client, who = world
    env.meter.plans[OWNER] = "explorer"                                     # the free plan, as that workspace was
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"text": "I need an invoice for mark, $300", "entry_mode": "free_text"}).json()
    assert not any(k.startswith("credit") for k in s["resolution"])      # charged as before, never said on the card
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting", "customer_email": "mark@example.test", "vat_rate": 0}})
    client.post(f"/task-sessions/{s['id']}/resume")
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    # The homepage promises free essential tools: the invoice is prepared, on the dashboard, waiting for what is still missing.
    assert done["state"] == "awaiting_review" and done["handoff"]["to"].startswith("/dashboard?task=") and "blocked" not in done["handoff"]
    shown = client.get(f"/workflow-runs/{done['handoff']['run_id']}").json()["run"]
    # And it goes all the way on the free plan, with nothing asked again: approved, sent. Nothing later in the task turns it away.
    answered = shown
    assert answered["status"] == "awaiting_approval", answered.get("pending_question") or answered.get("error")
    approval = env.pending(answered)[0]
    assert (approval["payload"]["customer_name"], approval["payload"]["total"], approval["payload"]["currency"]) == ("Mark", 300, "USD")      # the VAT rate answered on the homepage (none), in dollars
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
    answers = {"amount": 1000, "use": "stock", "stage": "trading", "route": "loan", "timing": "Within 3 months", "traction": "Paying customers", "kind": "service", "where": "Leeds", "evidence": "None yet",
               "monthly_sales": 10, "capacity": 20, "demand": "enquiries", "fixed_costs": 100, "positioning": "mid", "goal": "5 new clients", "sell": "bookkeeping", "customer": "Frank", "channel": "referrals", "price": 100, "cost": 40,
               "target_date": "2026-12-01", "owed": "some", "pressure": "late payers", "limit": "time", "description": "Bookkeeping for small firms",
               "problem": "month end takes too long", "worry": "one big client", "item": "Consulting", "solution": "A website redesign",
               # the document questions (an invoice or a quotation asks these too)
               "customer_email": "frank@example.test", "quantity": 1, "vat_rate": 0, "due_days": 14}
    for n, goal in enumerate(goals.GOALS):                                  # twelve tasks: well past Explorer's five a month, and still none refused
        g = client.post("/task-sessions", json={"key": goal["key"]}).json()
        assert "credit_badge" not in g["resolution"], goal["key"]
        client.post(f"/task-sessions/{g['id']}/inputs", json={"answers": {q["key"]: answers[q["key"]] for q in g["questions"]}})
        client.post(f"/task-sessions/{g['id']}/resume")
        out = client.post(f"/task-sessions/{g['id']}/prepare").json()
        if out.get("confirm"):      # a paid task: its price shown first (P0.5c), then Start
            assert " credits" in out["confirm"]["message"] and out["confirm"]["message"].startswith("I'll ")
            out = client.post(f"/task-sessions/{g['id']}/prepare", json={"confirmed": True}).json()
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
    assert first["confirm"]["message"] == "I'll write your business plan. It costs 40 credits, and you have 50." and first["handoff"] is None      # its price first (P0.5c)
    first = client.post(f"/task-sessions/{n['id']}/prepare", json={"confirmed": True}).json()
    assert first["state"] == "awaiting_review" and first["handoff"]["run_id"], first["handoff"]
    done = client.get(f"/workflow-runs/{first['handoff']['run_id']}").json()["run"]
    assert done["workflow_key"] == "business_plan_draft" and done["status"] in ("succeeded", "running", "awaiting_approval")


def test_the_funding_case_does_not_ask_again_for_what_was_given_on_the_homepage(world):
    """From the browser: £25,000, what it is for and "Not trading yet" were given on the homepage,
    and the case's first action still read "Enter the amount you want to raise…"."""
    env, store, client, who = world
    who["user"] = OWNER
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"amount": 25000, "use": "business", "stage": "pre_revenue", "route": "equity", "timing": "Within 3 months", "traction": "Paying customers"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    done = client.post(f"/task-sessions/{s['id']}/prepare").json()
    svc = service_for(env.orch)
    case = run(svc.store.get("subjects", done["handoff"]["subject_id"]))["data"]
    assert (case["target_amount"], case["currency"], case["purpose"], case["stage"]) == (25000, "GBP", "business", "pre_revenue")      # all of it is on the case, currency included
    detail = run(svc.get_subject(OWNER, "A", rules.FUNDING, done["handoff"]["subject_id"], OWNER))
    actions = {a["code"]: a for a in detail["actions"]}
    # Each action names only what is still missing.
    # "Within 3 months" is the receipt date now and the amount came from the chat: confirmed, nothing to ask (20 Oct).
    assert "C1.A" not in actions
    assert case["receipt_date"]
    assert actions["C1.B"]["title"] == "Add a milestone the funding pays for, with a measure and a target, and link the purpose to it."
    assert actions["C1.B"]["why"] == "What the funding is for is entered. It isn't linked to a milestone yet."
    assert not any("the amount you want to raise" in a["title"] or a["title"].startswith("Say what the funding is for") for a in detail["actions"])
    # With nothing given, the full wording stands; the result itself (state, score, gates) is the same either way.
    # (One funding case per business: the first is set aside here, so the empty one can be compared with it.)
    run(svc.store.update("subjects", done["handoff"]["subject_id"], {"status": "cancelled"}))
    bare = run(svc.create_subject(OWNER, "A", rules.FUNDING, {"title": "Empty case"}, OWNER))
    run(svc.request_assessment(OWNER, "A", rules.FUNDING, bare["id"], email=OWNER))
    empty = {a["code"]: a for a in run(svc.get_subject(OWNER, "A", rules.FUNDING, bare["id"], OWNER))["actions"]}
    # A case made by hand in the same business is filled from what was said there too (the owner's QA, 17 Oct): only the
    # date is asked, never the amount again.
    assert empty["C1.A"]["title"] == "When do you need the money?"
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
    return client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"item": "Consulting", "customer_email": "mark@example.test", "vat_rate": 0}}).json()


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
    done = shown
    if done.get("pending_question") and any(f["key"] in ("customer_name", "items") for f in done["pending_question"]["fields"]):
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
    assert again["inputs"] == {"customer": "Mark", "item": "Consulting", "amount": 300.0, "customer_email": "mark@example.test", "vat_rate": 0.0} and again["currency"] == "USD" and again["next"] == "identity"
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


def test_a_request_nothing_fits_is_refused_only_when_the_model_agrees(world, monkeypatch):  # noqa: F811
    """QA U1a: "doesn't do that" needs the model's agreement, never the rules' alone."""
    from app.modules.agent import understanding as und
    _env, _store, client, _who = world

    async def agrees(message, context, **_k):
        return und.Understanding(intent=und.UNSUPPORTED, confidence=0.9, method="llm+rules")
    monkeypatch.setattr(und, "understand", agrees)
    none = client.post("/task-sessions", json={"text": "book me a flight to Lagos"}).json()
    assert none["state"] == "blocked" and none["next"] == "none" and none["questions"] == []


def test_a_price_typed_in_another_currency_sets_it_to_confirm(world):  # noqa: F811
    _env, _store, client, _who = world
    s = client.post("/task-sessions", json={"key": "create_quotation", "entry_mode": "quick_task"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "Investors", "amount": 300, "currency_said": "USD"}}).json()
    assert s["currency"] == "USD" and s["currency_note"] == "In USD" and s["currency_options"] == ["USD", "GBP"]      # shown, with the switch back
    row = next(r for r in s["summary"] if r["key"] == "currency")
    assert row["value"] == "USD" and row["proposed"] is True      # theirs to confirm, not taken as settled


def test_the_agent_chat_edits_the_one_funding_case_and_checks_it_again(world):
    """QA P0.2: "Change the amount in my funding readiness to £60,000 and check it again" asks first, then changes the same
    case (provenance "Changed via Agent"), checks it again for free, and starts no intake and no second case."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    _sid, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    sessions_before = len(store.sessions) if hasattr(store, "sessions") else None
    out = client.post("/agent/requests", json={"business_id": "A", "text": "Change the amount in my funding readiness to £60,000 and check it again",
                                              "source_channel": "text"}).json()
    assert out["message"] == "Change the target from £50,000 to £60,000?"
    yes = out["offers"][0]
    assert yes["label"] == "Yes, update" and out["offers"][1] == {"label": "Cancel", "dismiss": True}
    assert run(svc.store.get("subjects", case_id))["data"]["target_amount"] == 50000      # nothing written before Yes
    done = client.post(yes["post"]["url"], json=yes["post"]["body"]).json()
    case = run(svc.store.get("subjects", case_id))["data"]
    assert case["target_amount"] == 60000 and case["provenance"]["target_amount"]["source"].startswith("Changed via Agent, ")
    assert done["message"].startswith(("Updated. Score ", "Updated. Checked again: ")) and done["actions"][-1] == {"label": "Open funding case", "to": f"/funding/{case_id}?tab=results"}
    assert len(run(svc.store.list("subjects", "A", kind=rules.FUNDING))) == 1
    if sessions_before is not None:
        assert len(store.sessions) == sessions_before
    assert env.meter.charges == []


def test_the_same_message_sent_twice_is_answered_once(world):
    """P1.8: a retry of the same message (the page's client_message_id) never adds a second turn or a second reply."""
    env, store, client, who = world
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal"}).json()
    body = {"answers": {"amount": 8000000}, "message": "8 million naira", "asked": "amount", "client_message_id": "m-1"}
    first = client.post(f"/task-sessions/{s['id']}/inputs", json=body).json()
    again = client.post(f"/task-sessions/{s['id']}/inputs", json=body).json()
    assert len(again.get("turns") or []) == len(first.get("turns") or []) and again["inputs"] == first["inputs"]


def test_add_these_answers_makes_a_new_launch_plan_for_a_new_launch(world):
    """QA, 15 Oct: several launches are allowed. Answers for another offering make a NEW launch plan (a draft) with its link;
    answers for the same launch go onto that launch's own plan."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    launches = lambda: run(svc.store.list("subjects", "A", kind=rules.LAUNCH))      # noqa: E731
    a = {"sell": "Home cleaning", "kind": "service", "customer": "Busy households in Leeds", "target_date": "In 3 to 6 months", "stage": "testing"}
    first = client.post("/businesses/A/quick-check/launch/attach", json={"answers": a}).json()
    second = client.post("/businesses/A/quick-check/launch/attach", json={"answers": {**a, "sell": "Mobile car wash", "customer": "Office workers in Abuja"}}).json()
    assert first["created"] and second["created"] and first["initiative_id"] != second["initiative_id"] and len(launches()) == 2
    assert second["to"].startswith(f"/launch/{second['initiative_id']}")
    again = client.post("/businesses/A/quick-check/launch/attach", json={"answers": a}).json()
    assert again["created"] is False and again["initiative_id"] == first["initiative_id"] and len(launches()) == 2


def test_a_pinned_funding_case_shows_on_the_dashboard_live_and_unpins_with_undo(world):
    """P1.14: the case pinned to the dashboard (stored on the case, per workspace) as a live card: its label, score, verdict
    and where to open it; Unpin removes it and pin (Undo) brings it back."""
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client)      # a funding goal pins its case
    case_id = made["handoff"]["subject_id"]
    cards = client.get("/businesses/A/pinned").json()["items"]
    card = next(c for c in cards if c["id"] == case_id)
    assert card["label"].startswith("Funding readiness · ") and card["open"] == f"/funding/{case_id}" and card["answers"] == f"/funding/{case_id}?tab=answers"
    assert card["verdict"] in ("Ready to approach funders", "Not ready to approach funders yet")
    client.post(f"/businesses/A/pinned/{case_id}/unpin")
    assert not [c for c in client.get("/businesses/A/pinned").json()["items"] if c["id"] == case_id]
    client.post(f"/businesses/A/pinned/{case_id}/pin")
    assert [c for c in client.get("/businesses/A/pinned").json()["items"] if c["id"] == case_id]


def test_history_says_what_changed_and_its_effect(world):
    """P2.19: each check in History says what changed and its effect, and who changed it."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    _sid, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    out = client.post("/agent/requests", json={"business_id": "A", "text": "Change the amount in my funding readiness to £60,000", "source_channel": "text"}).json()
    client.post(out["offers"][0]["post"]["url"], json=out["offers"][0]["post"]["body"])
    items = run(svc.history(OWNER, "A", rules.FUNDING, case_id, OWNER))
    assert items[0]["what_changed"].startswith("Target £50,000 → £60,000 (changed via Agent)")
    assert items[-1]["what_changed"] == "First check"


def test_replacing_a_need_saves_what_each_document_said_for_view_details(world):
    """Saved in full at Replace (QA, 15 Oct): each document's linked evidence in words and its latest prepared text, so
    "View details" shows them next time, never only a title or the record's ids."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    _first, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    ev = run(svc.store.insert("evidence", {"id": "ev-1", "business_id": "A", "kind": "document", "subject_id": None, "revision": 1, "key": "k1",
                                           "data": {"title": "Executive summary v1", "type": "document", "effective_date": "2026-10-01",
                                                    "verification": "unverified", "notes": "Raising for two vans.", "links": []},
                                           "created_by": OWNER, "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-01T00:00:00+00:00"}))
    run(svc.store.insert("artifacts", {"id": "art-1", "business_id": "A", "kind": "executive_summary", "subject_id": case_id, "status": "draft", "revision": 1,
                                       "key": None, "data": {"title": "Executive summary draft", "body": "We wash cars for office workers.", "version": 2},
                                       "created_by": OWNER, "created_at": "2026-10-04T00:00:00+00:00", "updated_at": "2026-10-04T00:00:00+00:00"}))
    row = run(svc.store.get("subjects", case_id))
    run(svc.store.update("subjects", case_id, {"data": {**row["data"], "documents": {"executive_summary": {"reviewed": True, "evidence_id": ev["id"] if isinstance(ev, dict) else "ev-1",
                                                                                                          "reviewed_at": "2026-10-04"}}}}))
    out = run(svc.replace_need(OWNER, "A", case_id, {"target_amount": 250000, "purpose": "a new office"}, OWNER))
    saved = run(svc.store.get("subjects", case_id))["data"]["previous_needs"][0]["documents"]["executive_summary"]["saved"]
    assert saved["title"] == "Executive summary v1" and saved["notes"] == "Raising for two vans." and saved["text"] == "We wash cars for office workers."
    shown = out["data"]["previous_needs"][0]["documents"]["executive_summary"]["preview"]
    assert shown == saved and "evidence_id" not in shown


def _launch(client, sell="Monthly car wash subscription", when="In 1 to 3 months"):
    s = client.post("/task-sessions", json={"key": "launch", "entry_mode": "business_goal"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"kind": "service", "sell": sell, "stage": "testing", "customer": "Office workers in Abuja",
                                                                       "where": "Abuja", "target_date": when, "evidence": "10 pre-orders"}})
    client.post(f"/task-sessions/{s['id']}/resume")
    return s["id"], client.post(f"/task-sessions/{s['id']}/prepare").json()


@pytest.mark.parametrize("when, date_kept, name", [("Within a month", "2026-11-30", "Monthly car wash subscription, Abuja, November 2026"),
                                                   ("In 1 to 3 months", "2027-01-31", "Monthly car wash subscription, Abuja, January 2027"),
                                                   ("Not decided yet", None, "Monthly car wash subscription, Abuja")])
def test_a_launch_chat_sets_up_its_plan_with_a_real_date_whichever_chip_was_picked(world, when, date_kept, name):
    """QA, 15 Oct: a date chip ("In 1 to 3 months") failed the plan's date check, so a launch chat never set its plan up.
    Now the chip is the end of that month, each answer is in its own field, the plan is pinned, and its result card and
    pinned card name it."""
    env, store, client, who = world
    who["user"] = OWNER
    from datetime import date
    from app.modules.agent import goals as goals_mod
    real = goals_mod.launch_date
    goals_mod.launch_date = lambda said, today=None: real(said, date(2026, 10, 15))
    try:
        sid, made = _launch(client, when=when)
    finally:
        goals_mod.launch_date = real
    assert made["state"] == "handed_off" and made["handoff"]["to"].startswith("/launch/"), made.get("problem")
    plan = run(service_for(env.orch).store.list("subjects", "A", kind=rules.LAUNCH))[0]["data"]
    assert (plan["name"], plan["audience"], plan["geography"], plan.get("target_date"), plan["pinned"]) == \
        (name, "Office workers in Abuja", "Abuja", date_kept, True)
    result = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    assert result["assessment"]["kind"] == "launch" and result["assessment"]["title"] == name
    pinned = client.get("/businesses/A/pinned").json()["items"]
    assert pinned[0]["id"] == result["assessment"]["initiative_id"] and pinned[0]["label"] == f"Launch readiness · {name}"
    assert pinned[0]["verdict"] == "Not enough evidence to judge the launch yet"
    # A second launch chat asks whether to update the plan or start another, before anything is written.
    _sid, again = _launch(client, sell="Van washing")
    assert [o["label"] for o in again["choose"]["options"]] == [f"Update {name}", "Start a new launch plan"]


def test_the_result_card_edits_the_answers_updates_the_case_and_runs_again(world):
    """QA, 15 Oct: "I should be able to edit, update and rerun from there": the card's answers are changed in place, the
    funding case gets only what changed, the check runs again, and the new result comes from the new answers."""
    env, store, client, who = world
    who["user"] = OWNER
    sid, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    first = client.get(f"/task-sessions/{sid}/first-value").json()
    assert {q["key"] for q in first["edit"]["questions"]} >= {"amount", "use", "stage", "route", "timing", "traction"}
    assert first["edit"]["answers"]["amount"] == 50000
    again = client.post(f"/task-sessions/{sid}/answers", json={"answers": {"amount": "120000", "use": "a new van", "traction": "No traction yet"}}).json()
    data = run(service_for(env.orch).store.get("subjects", case_id))["data"]
    assert (data["target_amount"], data["purpose"]) == (120000, "a new van")
    assert again["edit"]["answers"]["amount"] == 120000 and again["result"]["assessment_type"] == "funding_readiness_initial"
    assert any("No traction yet" == b["label"] for b in again["result"]["blockers"])
    assert env.meter.charges == []      # free: no model, no research
    # Someone else can't edit it.
    who["user"] = "someone.else@example.test"
    assert client.post(f"/task-sessions/{sid}/answers", json={"answers": {"amount": 1}}).status_code == 404


def test_after_two_replaces_the_first_needs_items_can_still_be_kept(world):
    """QA, 15 Oct: replacing twice hid the first need's items; Keep works on any earlier need."""
    env, store, client, who = world
    who["user"] = OWNER
    svc = service_for(env.orch)
    _first, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    for amount, use in ((120000, "a new van"), (250000, "a new office")):      # replaced from the case page (the chat asks update or new)
        run(svc.replace_need(OWNER, "A", case_id, {"target_amount": amount, "purpose": use, "title": f"£{amount // 1000}k for {use}"}, OWNER))
    needs = run(svc.store.get("subjects", case_id))["data"]["previous_needs"]
    assert len(needs) == 2 and "traction" in needs[1]["set_aside"]
    out = run(svc.keep_previous(OWNER, "A", case_id, "traction", True, OWNER, need=1))
    assert out["data"]["previous_needs"][1]["review"] == {"traction": "kept"} and out["data"]["previous_needs"][0]["review"] == {}


def test_run_the_check_again_returns_the_case_in_the_same_request(world):
    """QA: "Run the check again" in one round trip: the check returns the case as it is after the check."""
    env, store, client, who = world
    who["user"] = OWNER
    _sid, made = _funding(client)
    case_id = made["handoff"]["subject_id"]
    case = client.get(f"/businesses/A/funding-cases/{case_id}").json()
    out = client.post(f"/businesses/A/funding-cases/{case_id}/assessments", json={"revision": case["revision"], "idempotency_key": "again-1", "with_detail": True}).json()
    assert out["subject"]["id"] == case_id and out["subject"]["latest_assessment"]["id"] == out["id"] if "latest_assessment" in out["subject"] else out["subject"]["id"] == case_id
    plain = client.post(f"/businesses/A/funding-cases/{case_id}/assessments", json={"revision": out["subject"]["revision"], "idempotency_key": "again-2"}).json()
    assert "subject" not in plain      # only when asked for
