"""The owner, 28 Oct: "Find options still opens the general 'complete your case' offer. It must search for funding programmes and
lenders that fit the case (country, kind of funding, amount, sector), with sources." """
from app.modules.agent import research


def test_options_alone_are_planned_even_when_their_check_is_met():
    result = {"criteria": [{"key": "materials", "label": "Funding materials", "state": "met"}], "blockers": []}
    i = {"route": "loan", "amount": 25000000}
    ctx = {"sector": "car wash", "country": "Nigeria", "place": "Abuja", "currency": "NGN", "amount": "25 million NGN"}
    plan = research.priced_plan("need_funding", result, i, ctx, 60, {}, {}, ["materials"])
    assert [t["topic"] for t in plan["topics"]] == ["route_loan"]      # the kind of funding chosen, nothing else
    q = plan["topics"][0]["query"]
    assert "car wash" in q and "25 million NGN" in q and "Nigeria" in q


def test_the_amount_is_in_the_context_in_words():
    ctx = research.context_of({"workspace_profile": {"country": "Nigeria"}}, {"amount": 25000000, "currency": "NGN"})
    assert ctx["amount"] == "25 million NGN"


def test_a_full_funding_run_is_the_list_price_every_new_run():
    """The owner, 28 Oct: "to research and draft for funding readiness, the agent should charge 60 credits", "if the user
    updates the funding readiness and runs research again, still 60 credits"."""
    result = {"criteria": [{"key": "market", "label": "Market", "state": "missing"}, {"key": "demand", "label": "Demand", "state": "missing"}],
              "blockers": [{"key": "market"}, {"key": "demand"}]}
    ctx = {"sector": "car wash", "country": "Nigeria", "place": "Abuja", "currency": "NGN"}
    plan = research.priced_plan("need_funding", result, {}, ctx, 60, {}, {}, None)
    assert plan["price"] == 60
    narrow = research.priced_plan("need_funding", result, {}, ctx, 60, {}, {}, ["materials"])
    assert narrow["price"] <= 60      # one step on its own keeps its share
    assert research.flat_price("need_funding") and not research.flat_price("need_funding", ["materials"]) and not research.flat_price("launch")


def test_the_list_price_is_charged_when_anything_is_found(monkeypatch):
    import asyncio
    from contextlib import asynccontextmanager

    class _Meter:
        async def cost(self, _f):
            return 60

        @asynccontextmanager
        async def charge(self, *_a, **_k):
            yield

        async def refund(self, *_a, **_k):
            pass
    orch = type("O", (), {"rt": type("R", (), {"meter": _Meter()})()})()
    found = [{"kind": research.RESEARCHED, "topic": "market", "sources": [{"url": "https://a.example"}], "criterion": "market", "label": "Market"}]
    _f, charged = asyncio.run(research.charge_fields(orch, "u1", "r1", found, 60, "research_funding_readiness", 6, flat=True))
    assert charged == 60
    _f, none = asyncio.run(research.charge_fields(orch, "u1", "r2", [], 60, "research_funding_readiness", 6, flat=True))
    assert none == 0      # nothing found: nothing charged


def test_replaced_runs_past_the_newest_three_are_kept_as_history_lines():
    """The owner, 28 Oct: 26 old runs, 592 KB, every page waiting on them; "keep the last 3"."""
    runs = {f"r{n}": {"id": f"r{n}", "goal": "need_funding", "status": "replaced", "created_at": f"2026-10-{10 + n:02d}T09:00:00+00:00", "charged": 10,
                      "topics": ["market"], "findings": 2, "items": [{"x": "y" * 500}], "deliverables": {"d": "z" * 500}, "answers": {"use": "van"}, "inputs": {"amount": 1}}
            for n in range(6)}
    runs["live"] = {"id": "live", "goal": "need_funding", "status": "review", "created_at": "2026-10-28T09:00:00+00:00", "items": [{"x": 1}]}
    out = research.compact_runs(runs)
    full = [r for r in out.values() if "items" in r]
    assert {r["id"] for r in full} == {"live", "r5", "r4", "r3"}      # the run in use and the newest three replaced ones
    old = out["r0"]
    assert old["trimmed"] and old["charged"] == 10 and old["findings"] == 2 and old["topics"] == ["market"] and old["base"]
    assert "deliverables" not in old and "inputs" not in old
    assert research.compact_runs(out) == out      # trimmed once


def test_a_value_the_run_took_from_the_records_is_not_a_change():
    """The owner, 28 Oct: idea research done in 29 seconds read as "your answers changed", so its progress never ended."""
    from datetime import datetime, timezone
    run = {"id": "r1", "goal": "test_idea", "status": "review", "created_at": datetime.now(timezone.utc).isoformat(),
           "answers": {"description": "mat washing", "customer": "office workers"}, "items": []}
    data = {"research_runs": {"r1": run}, "quick_check_answers": {"test_idea": {"answers": {"description": "mat washing"}}}}
    assert research.research_state(data, "test_idea")["state"] == "review"
    data["quick_check_answers"]["test_idea"]["answers"]["description"] = "carpet washing"
    assert research.research_state(data, "test_idea")["state"] == "stale"      # what they said changing still counts
