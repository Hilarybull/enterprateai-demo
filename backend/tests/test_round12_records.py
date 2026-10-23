"""G8 (23 Oct): signed in, the landing funding chat does not ask again what is on record."""
from test_goal_onboarding import world, _funding, OWNER  # noqa: F401
from app.modules.agent import goal_router


def test_signed_in_funding_chat_takes_stage_traction_and_purpose_from_the_latest_case(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    async def signed_in(request):
        return {"id": OWNER, "email": OWNER}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    _sid, made = _funding(client)
    s = client.post("/task-sessions", json={"key": "need_funding", "entry_mode": "business_goal", "business_id": "A"}).json()
    rows = {r["key"]: r for r in s["summary"]}
    assert rows["stage"]["from_records"] and rows["traction"]["from_records"] and rows["use"]["from_records"]
    assert not {"stage", "traction", "use"} & set(s["missing"])
    # A new need said: its purpose is theirs, never the old case's
    t = client.post("/task-sessions", json={"text": "I need £20k for a new van", "entry_mode": "free_text", "business_id": "A"}).json()
    assert not ({r["key"]: r for r in t["summary"]}.get("use") or {}).get("from_records")


def test_signed_in_business_plan_chat_reuses_what_the_business_does(world, monkeypatch):
    env, store, client, who = world
    who["user"] = OWNER
    async def signed_in(request):
        return {"id": OWNER, "email": OWNER}
    monkeypatch.setattr(goal_router, "get_optional_user", signed_in)
    env.businesses["A"]["data"]["workspace_profile"].update({"description": "Drone window cleaning for offices in Leeds", "target_customer": "Office managers"})
    s = client.post("/task-sessions", json={"key": "create_business_plan", "entry_mode": "quick_task", "business_id": "A"}).json()
    rows = {r["key"]: r for r in s["summary"]}
    assert rows["description"]["value"] == "Drone window cleaning for offices in Leeds" and rows["description"]["from_records"]
    assert "description" not in s["missing"]
