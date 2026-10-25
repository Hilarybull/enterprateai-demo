"""The owner, 24 Oct: "Help me understand my business risks... implement it". A free, rule-based Business Risk Check:
asked only what the records can't tell, scored for resilience, said in plain words, nothing charged."""
from test_goal_onboarding import world, OWNER  # noqa: F401
from app.modules.agent import first_value


def test_the_landing_risk_check_asks_four_things_and_gives_a_free_result(world):
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "Help me understand my business risks", "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "business_risks" and s["missing"] == ["top_share", "runway", "paid_on_time", "key_person"]
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"worry": "Two clients pay most of our bills", "top_share": "over_50", "runway": "3_6",
                                                                          "paid_on_time": "sometimes_late", "key_person": "stops"}}).json()
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/attach-user")
    client.post(f"/task-sessions/{s['id']}/resume")
    r = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    assert (r["headline"], r["score"]) == ("Business Risk Check", None)      # no made-up total (24 Oct)
    assert [b["label"] for b in r["blockers"]][:2] == ["Over half your income comes from one customer", "The business stops without you"]
    assert r["premium_next_action"] is None and r["focus"]["key"] == "concentration" and r["focus"]["text"].startswith("You asked about relying on one customer: ")
    assert r["blockers"][0]["key"] == "concentration"      # the risk they named comes first
    assert all("—" not in b["label"] and "–" not in b["label"] for b in r["blockers"])
    assert env.meter.charges == []


def test_what_the_invoices_show_is_used_and_not_asked():
    data = {"financials": {"invoices": [
        {"customer_name": "Acme", "status": "paid", "total_amount": 7000, "issue_date": "2026-09-01"},
        {"customer_name": "Bolt", "status": "paid", "total_amount": 2000, "issue_date": "2026-09-05"},
        {"customer_name": "Cove", "status": "paid", "total_amount": 1000, "issue_date": "2026-09-09"}]}}
    known = first_value.known_answers("business_risks", data)
    assert known.get("top_share") == "over_50"
    r = first_value.assess("business_risks", {"runway": "over_6", "key_person": "runs", "paid_on_time": "on_time"}, data)
    conc = next(c for c in r["criteria"] if c["key"] == "concentration")
    assert conc["state"] == "unmet" and any("Acme is 70% of your paid income" == b["label"] for b in r["blockers"])


def test_the_risk_shortcut_is_on_the_landing():
    from app.modules.agent import goals
    assert any(g["key"] == "business_risks" and g.get("chip", True) is not False for g in goals.GOALS)


def test_a_reply_in_plain_words_answers_the_questions_it_covers_and_the_chat_moves_on(world):
    """The owner, 24 Oct: "one customer" was asked again as the biggest customer's share."""
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "help me to understand my risks", "entry_mode": "free_text"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "one customer", "asked": "worry"}).json()
    assert s["inputs"]["top_share"] == "over_50" and s["missing"][0] == "runway"
    assert s["agent_turn"]["ack"] == "Thanks, noted: most of your income comes from one customer."
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {}, "message": "they pay late and it's just me", "asked": "runway"}).json()
    assert (s["inputs"]["paid_on_time"], s["inputs"]["key_person"]) == ("often_late", "stops") and s["missing"] == ["runway"]


def test_the_team_size_is_read_from_the_profile_forms_own_field():
    """The owner, 24 Oct: "it's on the workspace profile" and "slows without you... how?": only "just me" answers it; a larger
    team is asked, never guessed."""
    assert first_value.known_answers("business_risks", {"workspace_profile": {"company_size": "solo"}})["key_person"] == "stops"
    for size in ("2-5", "6-10"):
        assert "key_person" not in first_value.known_answers("business_risks", {"workspace_profile": {"company_size": size}})


def test_the_dashboard_agent_agent_centre_and_the_risk_tile_open_the_same_risk_check(world):
    """The owner, 24 Oct: "make sure you're applying the fixing via all the agent"."""
    env, store, client, who = world
    who["user"] = OWNER
    for text in ("help me understand my business risks", "what are my risks?", "I'm worried I rely on one customer"):
        out = client.post("/agent/requests", json={"business_id": "A", "text": text, "source_channel": "text"}).json()
        assert (out["kind"], out["goal_key"], out["said"]) == ("check", "business_risks", text)
    tile = client.post("/agent/requests", json={"business_id": "A", "capability": "risk_concentration", "source_channel": "ui_action"}).json()
    assert (tile["kind"], tile["goal_key"]) == ("check", "business_risks") and env.meter.charges == []


def test_the_summary_says_what_each_risk_answer_means(world):
    """The owner, 24 Oct: "Late payment: Almost always" read as customers being always late."""
    env, store, client, who = world
    s = client.post("/task-sessions", json={"text": "help me understand my risks", "entry_mode": "free_text"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"worry": "x", "top_share": "over_50", "runway": "over_6", "paid_on_time": "on_time", "key_person": "slows"}}).json()
    rows = {r["key"]: r["value"] for r in s["summary"]}
    assert rows["paid_on_time"] == "Customers pay on time" and rows["top_share"] == "Most of your income comes from one customer"


def test_the_check_page_shows_the_same_result_as_the_chat(world, monkeypatch):
    """The owner, 24 Oct: "it has a different score": the page showed an older saved result."""
    from app.modules.agent import goal_router
    env, store, client, who = world
    who["user"] = OWNER

    async def signed_in(request):
        return {"id": OWNER, "email": OWNER}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    s = client.post("/task-sessions", json={"text": "help me understand my risks", "entry_mode": "free_text", "business_id": "A"}).json()
    client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"top_share": "20_50", "runway": "under_3", "paid_on_time": "on_time", "key_person": "runs"}})
    chat = client.get(f"/task-sessions/{s['id']}/first-value").json()["result"]
    page = client.get("/businesses/A/quick-check/business_risks").json()["last"]["result"]
    assert chat["score"] == page["score"] and [b["label"] for b in chat["blockers"]] == [b["label"] for b in page["blockers"]]
    assert page["free_next_actions"] == chat["free_next_actions"]
