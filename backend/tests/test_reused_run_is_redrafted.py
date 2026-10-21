"""The paid run reused for free goes through the same accuracy rules (the owner's QA, 21 Oct): a run drafted before the
traction fix (price ₦15,000 from the launch check, ₦4.5m a month, break-even of 4, "First month's delivery costs") comes
back with this case's figures: ₦1.2m a month in, ₦4,000 a sale, a cost-above-price warning, the bays first. Called
through POST /task-sessions/{id}/premium, the path the page uses."""
from datetime import datetime, timezone

from test_agent import OWNER
from test_case_kept_between_chats import FIRST, _chat
from test_goal_onboarding import world  # noqa: F401 - the fixture

STALE_TABLE = [{"line": "First month's delivery costs", "amount": 1800000, "how": "₦6,000 × 300 sales"},
               {"line": "Working capital: three months of fixed costs", "amount": 600000, "how": "3 × ₦200,000"}]


def _stale_run(answers):
    now = datetime.now(timezone.utc).isoformat()
    calc = lambda key, value, table=None: {"id": f"c_{key}", "kind": "estimated", "basis": "calculated", "derive": key, "criterion": "financial",      # noqa: E731
                                           "label": key, "value": value, "table": table, "working": ["old"], "decision": None}
    return {"id": "rr_old", "goal": "need_funding", "status": "review", "created_at": now, "counts": {"sources": 1}, "charged": 44,
            "answers": answers, "context": {"currency": "NGN", "country": "Nigeria"},
            "inputs": {"price": 15000.0, "cost": 6000.0, "monthly_sales": 300.0, "fixed_costs": 200000.0, "amount": 5000000.0, "use": "2 more washing bays"},
            "inputs_from": {"price": "From your launch check", "cost": "From your catalogue", "monthly_sales": "From your chat", "fixed_costs": "From your expenses"},
            "items": [{"id": "r_price", "kind": "reused", "field": "price", "label": "Price per sale", "value": 15000, "source_note": "From your launch check", "decision": None},
                      calc("break_even", "4 sales a month"), calc("forecast", "Cash after 12 months: ₦32,973,396.8", [{"month": 1, "revenue": 4500000, "costs": 2000000, "profit": 2500000, "cash": 2500000}]),
                      calc("use_of_funds", "2 lines", STALE_TABLE),
                      {"id": "f_loan", "kind": "researched", "topic": "route_loan", "label": "Loans", "value": "RAPID programme for small businesses",
                       "sources": [{"url": "https://example.org", "title": "RAPID", "date": "2025-04-07"}], "decision": None}],
            "deliverables": {"use_of_funds": STALE_TABLE}}


def test_the_premium_reuse_path_redrafts_with_this_cases_figures(world):  # noqa: F811
    env, store, client, who = world
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["workspace_profile"] = {"company_name": "Synthetic Wash", "country": "Nigeria", "city": "Abuja"}
    sid, _ = _chat(client, who, FIRST)
    session = client.get(f"/task-sessions/{sid}").json()
    d.setdefault("research_runs", {})["rr_old"] = _stale_run(session["inputs"])
    d["catalogue"] = {"products": [{"id": "p1", "name": "Car wash", "base_price": 15000, "cost_of_sales": 6000}]}
    who["user"] = OWNER
    out = client.post(f"/task-sessions/{sid}/premium", json={}).json()
    run = out.get("research") or out
    assert run["id"] == "rr_old" and out.get("charged_now", 0) == 0      # reused, free
    by = {i.get("derive") or i.get("field"): i for i in run["items"]}
    # Money in: the revenue said in the chat, never ₦15,000 × 300.
    assert by["forecast"]["table"][0]["revenue"] == 1_200_000
    # Price from the chat (₦1.2m over 300), not the launch check; the catalogue's ₦15,000 asked about.
    assert run["inputs"]["price"] == 4000 and "launch" not in run["inputs_from"]["price"].lower(), (run["inputs"].get("price"), run["inputs_from"].get("price"))
    assert any(i.get("kind") == "question" and "Which is right" in (i.get("question") or "") for i in run["items"])
    # The catalogue's ₦6,000 a wash is above ₦4,000: warned, no break-even.
    assert by["break_even"]["warning"] == "cost_above_price" and "sales a month" not in by["break_even"]["value"]
    # Use of funds: the bays first, never "First month's delivery costs".
    assert by["use_of_funds"]["table"][0]["line"] == "2 more washing bays"
    assert not any("delivery costs" in r["line"] for r in by["use_of_funds"]["table"])
    # Whole naira in what is said.
    assert ".8" not in by["forecast"]["value"]
    # Opening it again later shows the same, saved.
    again = client.get(f"/businesses/A/research/rr_old").json()["research"]
    assert {i.get("derive"): i.get("value") for i in again["items"] if i.get("derive")} == {k: v["value"] for k, v in by.items() if v.get("derive")}


def test_research_again_is_a_new_run_within_60_credits(world):  # noqa: F811
    env, store, client, who = world
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    sid, _ = _chat(client, who, FIRST)
    d.setdefault("research_runs", {})["rr_old"] = _stale_run(client.get(f"/task-sessions/{sid}").json()["inputs"])
    who["user"] = OWNER
    assert client.post(f"/task-sessions/{sid}/premium/quote", json={}).json().get("reuse") == "rr_old"      # the same one, free
    quote = client.post(f"/task-sessions/{sid}/premium/quote", json={"fresh": True}).json()
    assert quote["allowed"] and not quote.get("reuse") and quote["max"] <= 60
    out = client.post(f"/task-sessions/{sid}/premium", json={"fresh": True}).json()
    assert out["started"] and out["research"]["id"] != "rr_old"
    assert d["research_runs"]["rr_old"]["status"] == "replaced"      # one run waiting for review: the new one
