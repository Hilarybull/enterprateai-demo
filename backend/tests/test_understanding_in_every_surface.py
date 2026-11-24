"""QA H: the understanding layer behind every chat surface: the homepage's first message and its answers, the
Agent's requests the rules can't place, the Agent modal's typed answers, and the quick checks."""
from app.modules.agent import goal_router, understanding as und
from test_agent import OWNER, run
from test_agent_ask_then_deliver import _env, _fields
from test_goal_onboarding import world  # noqa: F401  (the fixture)


def test_homepage_answers_in_words_are_read(world):  # noqa: F811
    _env_, _store, client, _who = world
    s = client.post("/task-sessions", json={"key": "test_idea", "entry_mode": "business_goal"}).json()
    s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {"monthly_sales": "about sixty", "price": "£45 per groom"}}).json()
    assert s["inputs"]["monthly_sales"] == 60 and s["inputs"]["price"] == 45 and not s.get("rejected")


def test_homepage_first_sentence_fills_launch_questions_once(world):  # noqa: F811
    _env_, _store, client, _who = world
    s = client.post("/task-sessions", json={"text": "I want to launch a home cleaning service in Leeds", "entry_mode": "free_text"}).json()
    assert {"sell", "kind", "where"}.isdisjoint(s["missing"])      # not asked again: shown under "From what you said"


def test_the_agent_modal_reads_a_vat_rate_in_words_and_refuses_what_it_cannot_read():
    env = _env(vat=None)
    env.store.policies["A"] = {"contract_route": "direct_invoice"}
    asked = env.submit(text="need a quotation")["run"]
    fields = _fields(asked)
    assert "vat_rate" in fields      # no default rate: VAT is asked, so this test is never vacuous
    import pytest
    from app.modules.agent.orchestrator import Conflict
    with pytest.raises(Conflict):
        run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": [{"product_id": "p4", "quantity": 1}], "vat_rate": "whatever"}))
    r = run(env.orch.provide_input(asked["id"], OWNER, {"customer_id": "c6", "items": [{"product_id": "p4", "quantity": 1}], "vat_rate": "standard rate"}))
    assert r["state"]["answers"]["vat_rate"] == 20.0


def test_quick_check_answers_are_read_the_same_way():
    out = goal_router._read_answers("test_idea", {"monthly_sales": "about sixty", "price": "£45 per groom", "cost": "not sure", "nonsense": "x"})
    assert out == {"monthly_sales": 60.0, "price": 45.0, "cost": "unknown"}


def test_an_agent_request_the_rules_cannot_place_goes_to_the_understanding_layer(monkeypatch):
    seen = {}

    async def fake(message, context, **_k):
        seen["capabilities"] = set(context["capabilities"])
        return und.Understanding(intent="enquiry_to_quote", confidence=0.9)
    monkeypatch.setattr(und, "understand", fake)
    env = _env()
    res = env.submit(text="sort out something for the Delta lot, two of the usual")
    assert res["kind"] == "workflow" and res["run"]["workflow_key"] == "enquiry_to_quote"
    assert "export_customer_list" not in seen["capabilities"] and "enquiry_to_quote" in seen["capabilities"]      # only the registry


def test_homepage_routes_starting_a_business_to_launch_with_what_was_said(world):  # noqa: F811
    """QA U1: "start a small cafe" and the dog-walking sentence are launch goals, read by the rules alone (no model
    in tests), with what they said proposed and not asked again."""
    _env_, _store, client, _who = world
    s = client.post("/task-sessions", json={"text": "I want to start a small cafe", "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "launch" and s["proposed"] == {"sell": "cafe"} and "sell" not in s["missing"]
    s = client.post("/task-sessions", json={"text": "thinking of opening a dog walking biz in Bristol around March, already got 3 mates who said they'd pay",
                                            "entry_mode": "free_text"}).json()
    assert s["goal_key"] == "launch"
    assert s["proposed"] == {"sell": "dog walking", "kind": "service", "where": "Bristol", "target_date": "March", "evidence": "3 mates who said they'd pay"}
    assert set(s["missing"]) == {"stage", "customer"}
