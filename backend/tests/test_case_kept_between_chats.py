"""Run the funding chat twice on the same naira workspace (the owner's brief, 20 Oct): the second run's Before column is the
first run's Now. Nothing else rewrites the case between them, and no page's default currency reaches it."""
from test_agent import OWNER
from test_goal_onboarding import world  # noqa: F401 - the fixture


def _chat(client, who, answers):
    who["user"] = None
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal", "currency": "GBP"}).json()      # a stale page hint
    for k, v in answers:
        s = client.post(f"/task-sessions/{s['id']}/inputs", json={"answers": {k: v}, "picked": str(v), "asked": k}).json()
    who["user"] = OWNER
    client.post(f"/task-sessions/{s['id']}/resume")
    return s["id"], client.post(f"/task-sessions/{s['id']}/prepare").json()


FIRST = (("amount", 5_000_000), ("use", "2 more washing bays"), ("stage", "trading"), ("route", "loan"), ("timing", "In 3 to 6 months"),
         ("traction", "about 300 cars a month, roughly 1.2 million naira monthly revenue"))


def test_the_second_chat_compares_with_what_the_first_one_saved(world):  # noqa: F811
    env, store, client, who = world
    d = env.businesses["A"]["data"]
    d["settings"] = {"currency": "NGN"}
    d["workspace_profile"] = {"company_name": "Synthetic Wash", "country": "Nigeria", "city": "Abuja"}
    _sid, first = _chat(client, who, FIRST)
    assert first.get("handoff") or first.get("first_value") or first.get("state"), first
    # The second chat changes the amount and the purpose: Before is exactly what the first saved, in naira.
    sid, second = _chat(client, who, (("amount", 8_000_000),) + tuple(x for x in FIRST[1:] if x[0] != "use") + (("use", "a third washing bay"),))
    # One confirmation (the owner's QA, 21 Oct): no second "I'll update your funding case" screen; what changed is said.
    saved = client.get(f"/task-sessions/{sid}").json()
    assert not saved.get("choose"), saved.get("choose")
    rows = {r["field"]: r for r in saved.get("case_changes") or []}
    assert rows, saved
    amount = next(r for f, r in rows.items() if "amount" in f.lower() or "much" in f.lower())
    assert "5,000,000" in amount["before"] and "₦" in amount["before"] and "£" not in amount["before"]
    assert "8,000,000" in amount["now"] and "₦" in amount["now"]
    purpose = next(r for f, r in rows.items() if "for" in f.lower() or "purpose" in f.lower())
    assert purpose["before"] == "2 more washing bays" and purpose["now"] == "a third washing bay"


def test_the_pinned_strip_shows_the_score_and_count_the_case_page_shows(world):  # noqa: F811
    env, store, client, who = world
    env.businesses["A"]["data"]["settings"] = {"currency": "NGN"}
    sid, _ = _chat(client, who, FIRST)
    result = client.get(f"/task-sessions/{sid}/first-value").json()["result"]
    pinned = client.get("/businesses/A/pinned").json()["items"]
    funding = next(p for p in pinned if p["kind"] == "funding")
    case_id = funding["id"]
    overview = client.get(f"/businesses/A/cases/{case_id}/overview").json()["result"]
    assert funding["score"] == overview["score"] == result["score"]
    assert funding["to_do"] == len(overview["blockers"]) == len(result["blockers"])
