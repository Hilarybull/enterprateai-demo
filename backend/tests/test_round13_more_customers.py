"""Winning more customers (the owner's brief, 25 Oct), the risk check's way: the records first, only what they don't show
asked (as buttons), the result free in one request on its own page; real gaps, what isn't on record asked in place, what's
fine said; no made-up score. The same chat from the landing page, the dashboard Agent and the Agent Centre."""
from test_goal_onboarding import world, OWNER, run  # noqa: F401
from test_round12_risk_chat_e2e import _signed_in


def _records(env, who, monkeypatch):
    d = _signed_in(env, who, monkeypatch)
    d.setdefault("catalogue", {})["products"] = [{"name": "Monthly car wash", "base_price": 4000, "cost_of_sales": 1500}]
    d["financials"]["quotes"] = [{"customer_name": "Bola Stores", "status": "sent", "total_amount": 8000}]
    d["workspace_profile"].update({"city": "Abuja", "country": "Nigeria"})
    return d


def _ran(d, said, run_id="rr1"):
    """A "Do all for me" run for these answers, already reviewed."""
    d.setdefault("research_runs", {})[run_id] = {"id": run_id, "goal": "more_customers", "status": "adopted", "answers": said, "created_at": "2026-10-26T10:00:00+00:00", "items": []}
    return d


def test_the_records_are_read_and_only_the_rest_asked_as_buttons(world, monkeypatch):
    env, store, client, who = world
    _records(env, who, monkeypatch)
    s = client.post("/task-sessions", json={"text": "I need more customers", "entry_mode": "free_text", "business_id": "A"}).json()
    assert s["goal_key"] == "more_customers"
    assert s["value_line"].startswith("I'll look at who buys from you now")
    assert "price" not in s["missing"] and "where" not in s["missing"]          # from the catalogue and the profile
    q = {x["key"]: x for x in s["questions"]}
    assert q["channel"]["type"] == "choice" and q["goal"]["type"] == "choice"        # buttons, never a blank box
    assert "I don't have customers yet" in [o["label"] for o in q["channel"]["options"]]


def test_the_result_is_free_in_one_request_with_real_gaps_and_no_score(world, monkeypatch):
    env, store, client, who = world
    _records(env, who, monkeypatch)
    s = client.post("/task-sessions", json={"text": "I need more customers", "entry_mode": "free_text", "business_id": "A"}).json()
    out = client.post(f"/task-sessions/{s['id']}/risk-check", json={"answers": {"sell": "Monthly car wash", "customer": "Office managers in Abuja",
                                                                                 "channel": "word_of_mouth", "goal": "10"}})
    assert out.status_code == 200, out.text
    r = out.json()["result"]
    assert r["score"] is None and r["assessment_type"] == "customer_growth_foundation"
    gaps = {b["key"]: b for b in r["blockers"]}
    assert gaps["channel"]["label"] == "New customers only come by word of mouth" and gaps["channel"]["why"]
    assert gaps["marketplace"]["label"] == "Not listed on the Marketplace"
    assert gaps["follow_up"]["label"] == "1 quote waiting for an answer"
    assert gaps["concentration"]["label"].startswith("Delta Offices Ltd is 100%")
    assert r["focus"]["text"].startswith("Now: 1 paying customer on record")
    assert any(x.startswith("Goal for the next three months: 10 new customers") for x in r["fine"])
    assert out.json()["session"]["handoff"]["to"] == "/check/customers"
    assert run(env.store.list_runs("A")) == [] and env.meter.charges == []        # free: no task, no charge


def test_what_isnt_said_is_asked_in_place(world, monkeypatch):
    env, store, client, who = world
    _records(env, who, monkeypatch)
    s = client.post("/task-sessions", json={"text": "I need more customers", "entry_mode": "free_text", "business_id": "A"}).json()
    out = client.post(f"/task-sessions/{s['id']}/risk-check", json={"answers": {"sell": "Monthly car wash", "customer": "unknown", "channel": "none", "goal": "unknown"}}).json()
    gaps = {x["key"]: x for x in out["result"]["not_on_record"]}
    assert gaps["goal"]["ask"] == "goal" and gaps["goal"]["ask_type"] == "choice" and gaps["goal"]["ask_options"]
    assert gaps["target"]["ask"] == "customer" and gaps["target"]["ask_type"] == "text"
    assert {b["key"]: b for b in out["result"]["blockers"]}["channel"]["label"] == "No way for new customers to find you yet"


def test_the_dashboard_and_agent_centre_open_the_same_chat(world, monkeypatch):
    env, store, client, who = world
    _records(env, who, monkeypatch)
    for text in ("I need customers", "I need more customers", "help me find customers"):
        out = client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()
        assert out["kind"] == "check" and out["goal_key"] == "more_customers", (text, out)
    assert env.meter.charges == []


def test_research_already_run_stays_on_the_plan_when_it_opens_again(world, monkeypatch):
    """The owner, 26 Oct: "what I got last time disappeared and I didn't change or make a new customer request"."""
    env, store, client, who = world
    d = _records(env, who, monkeypatch)
    said = {"sell": "Monthly car wash", "customer": "Office managers in Abuja", "channel": "word_of_mouth", "goal": "10", "where": "Abuja", "price": "4000"}
    client.post("/businesses/A/quick-check/more_customers", json={"answers": said})
    d.setdefault("research_runs", {})["rr1"] = {"id": "rr1", "goal": "more_customers", "status": "review", "answers": said, "created_at": "2026-10-26T10:00:00Z",
                                                "items": [{"id": "i1", "topic": "channels", "kind": "researched", "value": "Flyers and social media", "sources": [{"url": "https://x"}]}]}
    last = client.get("/businesses/A/quick-check/more_customers").json()["last"]
    assert last["result"]["research"]["state"] == "review" and last["result"]["research"]["run_id"] == "rr1"      # never "Do all for me" again


def test_the_plan_is_there_with_steps_and_words_ready_to_send(world, monkeypatch):
    """The owner, 26 Oct: "so where is the plan?" and "no link to fix it": a weekly target from the goal, then steps with the
    words ready to send; what was accepted from the research is the reason; the channel card opens the plan."""
    env, store, client, who = world
    d = _records(env, who, monkeypatch)
    d["workspace_profile"]["company_name"] = "E2E Car Wash Abuja"
    said = {"sell": "Monthly car wash", "customer": "office workers", "channel": "none", "goal": "5", "where": "Abuja", "price": "4000"}
    d.setdefault("research_runs", {})["rr1"] = {"id": "rr1", "goal": "more_customers", "status": "adopted", "answers": said, "created_at": "2026-10-26T10:00:00Z",
                                                "items": [{"id": "i1", "topic": "channels", "kind": "researched", "decision": "accepted", "value": "Flyers and Facebook pages", "sources": [{"url": "https://x"}]}]}
    client.post("/businesses/A/quick-check/more_customers", json={"answers": said})
    result = client.get("/businesses/A/quick-check/more_customers").json()["last"]["result"]
    plan = result["plan"]
    assert plan["goal"] == "Your goal: 5 new customers in 3 months, about 1 every 2 weeks."
    keys = [s["key"] for s in plan["steps"]]
    assert "where_they_are" in keys and "post" in keys and keys[-1] == "marketplace"
    office = next(s for s in plan["steps"] if s["key"] == "where_they_are")
    assert "E2E Car Wash Abuja" in office["draft"] and "Monthly car wash" in office["draft"] and "notice board" in office["why"]
    assert next(s for s in plan["steps"] if s["key"] == "post")["why"] == "What similar businesses do: Flyers and Facebook pages."
    assert next(b for b in result["blockers"] if b["key"] == "channel")["to"] == "#customer-plan"


def test_the_plans_words_name_what_is_sold_never_the_request(world, monkeypatch):
    """The owner, 26 Oct: "offering need more customers for ₦4,000": the request is not the offer; the catalogue's product is."""
    env, store, client, who = world
    d = _records(env, who, monkeypatch)
    said = {"sell": "need more customers", "customer": "office workers", "channel": "none", "goal": "5", "where": "Abuja"}
    client.post("/businesses/A/quick-check/more_customers", json={"answers": said})
    _ran(d, said)
    plan = client.get("/businesses/A/quick-check/more_customers").json()["last"]["result"]["plan"]
    words = " ".join(s["draft"] for s in plan["steps"])
    assert "need more customers" not in words and "Monthly car wash" in words


def test_a_change_typed_in_the_chat_is_applied(world, monkeypatch):
    """The owner, 26 Oct: "want to change my response": typed at [See my customer plan], it changes the answer it is about."""
    env, store, client, who = world
    _records(env, who, monkeypatch)
    s = client.post("/task-sessions", json={"text": "I need more customers", "entry_mode": "free_text", "business_id": "A"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"customer": "office workers", "channel": "word_of_mouth", "goal": "20"}}).json()
    assert s["inputs"]["goal"] == "20"
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "make it 10 new customers", "asked": None}).json()
    assert s["inputs"]["goal"] == "10", s["inputs"]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "we also use social media", "asked": None}).json()
    assert "social" in s["inputs"]["channel"], s["inputs"]


def test_no_plan_before_do_all_for_me_for_these_answers(world, monkeypatch):
    """The owner, 26 Oct: "why show old one... haven't done do it all": the plan is what the run makes, for these answers."""
    env, store, client, who = world
    d = _records(env, who, monkeypatch)
    said = {"sell": "Monthly car wash", "customer": "office workers", "channel": "none", "goal": "10", "where": "Abuja"}
    client.post("/businesses/A/quick-check/more_customers", json={"answers": said})
    result = client.get("/businesses/A/quick-check/more_customers").json()["last"]["result"]
    assert "plan" not in result and "to" not in next(b for b in result["blockers"] if b["key"] == "channel")
    d.setdefault("research_runs", {})["old"] = {"id": "old", "goal": "more_customers", "status": "adopted", "created_at": "2026-10-26T09:00:00+00:00",
                                                "answers": {**said, "customer": "car owners", "channel": "word_of_mouth"}, "items": []}
    assert "plan" not in client.get("/businesses/A/quick-check/more_customers").json()["last"]["result"]      # an earlier request's
    d["research_runs"]["new"] = {"id": "new", "goal": "more_customers", "status": "adopted", "created_at": "2026-10-26T11:00:00+00:00", "answers": said, "items": []}
    plan = client.get("/businesses/A/quick-check/more_customers").json()["last"]["result"]["plan"]
    assert plan["goal"] == "Your goal: 10 new customers in 3 months, about 1 a week."


def test_every_do_all_run_and_free_check_is_in_the_agent_centre_history(world, monkeypatch):
    """The owner, 26 Oct: "hope all these agentic runs, from other flows too, are stored in the agent centre": each paid run
    from every flow is its own History row, with what it cost and where it stands; each free check's latest result too."""
    env, store, client, who = world
    d = _records(env, who, monkeypatch)
    d.setdefault("research_runs", {}).update({
        "c1": {"id": "c1", "goal": "more_customers", "status": "adopted", "created_at": "2026-10-26T10:00:00+00:00", "findings": 3, "charged": 30, "items": []},
        "c2": {"id": "c2", "goal": "more_customers", "status": "review", "created_at": "2026-10-26T11:00:00+00:00", "findings": 1, "charged": 10, "items": []},
        "f1": {"id": "f1", "goal": "need_funding", "case_id": "case9", "status": "review", "created_at": "2026-10-25T09:00:00+00:00", "findings": 2, "charged": 20, "items": []}})
    d["quick_check_answers"] = {"business_risks": {"at": "2026-10-26T08:00:00+00:00", "answers": {}, "result": {"headline": "2 risks to act on."}}}
    rows = client.get("/businesses/A/workflow-runs?bucket=history").json()["items"]
    mine = {r["id"]: r for r in rows if r.get("kind") == "research"}
    assert mine["research:c1"]["summary"] == "3 findings · 30 credits · Replaced by a newer run"
    assert mine["research:c2"]["summary"] == "1 finding · 10 credits · Waiting for you to review" and mine["research:c2"]["to"] == "/check/customers"
    assert mine["research:f1"]["title"] == "Do all for me: Funding readiness" and mine["research:f1"]["to"] == "/funding/case9?tab=results"
    assert mine["check:business_risks"]["title"] == "Risk check" and mine["check:business_risks"]["summary"] == "2 risks to act on · Free"
    others = client.get("/businesses/A/workflow-runs?bucket=completed").json()["items"]
    assert not [r for r in others if r.get("kind") == "research"]      # only in History
