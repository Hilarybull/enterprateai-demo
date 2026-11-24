"""Superadmin AI tracking: the Agent's model and search cost beside the credits it charged, over a full window."""
import asyncio

from app.modules.admin import router as admin
from app.shared.llm import usage


def run(coro):
    return asyncio.run(coro)


def test_agent_rollup_separates_model_search_and_credits():
    rows = [
        {"user_id": "u1", "feature": "agent_research", "provider": "openai", "model": "gpt-4.1-mini", "total_tokens": 1000, "estimated_cost_usd": "0.002"},
        {"user_id": "u1", "feature": "agent_research", "provider": "serpapi", "model": "web_search", "total_tokens": 0,
         "estimated_cost_usd": 0.06, "metadata": {"searches": 4}},
        {"user_id": "u2", "feature": "agent_understand", "provider": "openai", "model": "gpt-4.1-mini", "total_tokens": 500, "estimated_cost_usd": 0.001},
        {"user_id": "u2", "feature": "business_plan", "provider": "openai", "model": "gpt-4.1-mini", "total_tokens": 9000, "estimated_cost_usd": 0.5},
    ]
    charges = [
        {"user_id": "u1", "feature_code": "agent_task", "credits": -2},
        {"user_id": "u2", "feature_code": "agent_send", "credits": -1},
    ]
    out = admin._rollup_agent(rows, charges, {"u1": "a@x.test", "u2": "b@x.test"})
    assert out["calls"] == 2 and out["searches"] == 4
    assert out["model_cost_usd"] == 0.003 and out["search_cost_usd"] == 0.06
    assert out["estimated_cost_usd"] == 0.063          # the non-Agent business plan call is not counted
    assert out["credits_charged"] == 3 and out["charges"] == 2
    people = {p["email"]: p for p in out["by_user"]}
    assert people["a@x.test"]["credits"] == 2 and people["a@x.test"]["calls"] == 2
    features = {f["label"]: f for f in out["by_feature"]}
    assert features["agent_task"]["credits"] == 2 and features["agent_research"]["calls"] == 2


def test_window_reads_every_page_not_just_the_latest_1000(monkeypatch):
    stamps = [f"2026-10-{d:02d}T00:00:{s:02d}+00:00" for d in range(12, 0, -1) for s in range(59, -1, -1)]   # 720 rows, newest first
    monkeypatch.setattr(admin, "_PAGE", 100)
    calls = []

    async def fake_select(table, *, columns, filters, order, desc, limit):
        calls.append(filters)
        before = next((v for c, op, v in filters if op == "lt"), None)
        page = [s for s in stamps if before is None or s < before][:limit]
        return [{"created_at": s} for s in page]

    monkeypatch.setattr(admin, "sb_select", fake_select)
    rows, complete = run(admin._select_window("ai_usage_events", "*", "2026-09-12T00:00:00+00:00"))
    assert len(rows) == 720 and complete
    assert all(("created_at", "gte", "2026-09-12T00:00:00+00:00") in f for f in calls)


def test_window_is_empty_when_the_table_is_missing(monkeypatch):
    async def missing(*_a, **_k):
        raise RuntimeError("relation ai_usage_events does not exist")
    monkeypatch.setattr(admin, "sb_select", missing)
    assert run(admin._select_window("ai_usage_events", "*", "2026-10-01")) == ([], True)


def test_search_calls_are_recorded_with_a_per_search_cost(monkeypatch):
    written = []

    async def insert(table, payload):
        written.append((table, payload))
    monkeypatch.setattr(usage, "sb_insert", insert)
    run(usage.record_search_usage(user_id="u1", feature="agent_research", provider="serper", searches=5))
    run(usage.record_search_usage(user_id="u1", feature="agent_research", provider="serper", searches=0))
    assert len(written) == 1
    table, row = written[0]
    assert table == "ai_usage_events" and row["provider"] == "serper" and row["model"] == "web_search"
    assert row["metadata"]["searches"] == 5
    assert row["estimated_cost_usd"] == usage.search_cost_usd("serper", 5) > 0


def test_a_failed_tracking_write_warns_once(monkeypatch, caplog):
    async def broken(*_a, **_k):
        raise RuntimeError("relation ai_usage_events does not exist")
    monkeypatch.setattr(usage, "sb_insert", broken)
    monkeypatch.setattr(usage, "_warned", set())
    with caplog.at_level("DEBUG", logger=usage.logger.name):
        for _ in range(3):
            run(usage.record_ai_usage(user_id="u1", feature="agent_understand", provider="openai", model="gpt-4.1-mini"))
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1 and "041_ai_usage_events" in warnings[0].getMessage()
