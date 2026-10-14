"""A3: a long step keeps the task alive (never started a second time beside itself), and the idea score comes from the
wizard's own deterministic engine at once, with the full report following. B5: risks read as sentences. C8: a market
size with no figures says so and is not charged."""
import asyncio
import time

import pytest

from app.modules.agent import orchestrator as orch_mod
from app.modules.agent.services import MemoryStudio, ModuleStudio, risk_sentence
from app.modules.agent.workflows import plain
from test_agent import OWNER, Env, run


def test_a_long_step_beats_so_it_is_never_taken_for_abandoned(monkeypatch):
    env = Env()
    beats = []
    real = env.store.update_run

    async def update(run_id, patch):
        if set(patch) == {"updated_at"}:
            beats.append(run_id)
        return await real(run_id, patch)
    monkeypatch.setattr(env.store, "update_run", update)
    monkeypatch.setattr(orch_mod.Orchestrator, "HEARTBEAT_SECONDS", 0.01)

    async def slow():
        await asyncio.sleep(0.2)      # well over one beat, whatever the clock's resolution (Windows ticks every ~15ms)
        return "done"
    assert run(env.orch._beating("run-1", slow())) == "done" and beats.count("run-1") >= 2


def test_the_idea_score_is_the_wizard_engine_and_comes_back_at_once(monkeypatch):
    monkeypatch.setattr(ModuleStudio, "_full_later", staticmethod(lambda *_a, **_k: None))      # the full report: not here
    idea = {"name": "Apex", "description": "Bookkeeping for cafés", "industry": "Accounting", "location": "Leeds", "customer": "Independent cafés",
            "problem": "Month-end takes a week", "currency": "GBP", "known": {"price": 300, "cost": 120}}
    t = time.perf_counter()
    r = run(ModuleStudio().validate_idea(user_id="u1", business_id=None, idea=idea))
    assert time.perf_counter() - t < 2 and 0 < r["score"] <= 100 and r["full_report"] == "pending"
    assert r["risks"] and all(isinstance(x, str) and "{" not in x and "':" not in x for x in r["risks"])


def test_risks_are_sentences_and_no_raw_structure_reaches_the_owner():
    assert risk_sentence({"dimension": "differentiation", "severity": "high", "note": "No differentiation is defined. More text."}) == "No differentiation is defined."
    assert "{" not in plain("Biggest risk: {'dimension': 'x', 'note': 'y'}.") and "':" not in plain("Biggest risk: {'dimension': 'x'}.")


class _WordsOnly(MemoryStudio):
    async def size_market(self, *, user_id, business_id, idea):
        return {"tam": "Search results indicate an active category", "sam": None, "som": None, "assumptions": [], "sources": []}


def test_a_market_size_without_figures_says_so_and_is_not_charged():
    env = Env(plan="starter_insight", credits=50)
    env.orch.rt.studio = _WordsOnly()
    env.meter.costs["idea_validation"] = 5
    r = env.submit(text="size the market for my bookkeeping business for small cafes in Leeds")["run"]
    for _ in range(3):
        if not r.get("pending_question"):
            break
        r = run(env.orch.provide_input(r["id"], OWNER, {f["key"]: (f["options"][0]["value"] if f.get("options") else "Leeds") for f in r["pending_question"]["fields"]}))
    assert r["summary"].startswith("I couldn't size this market") and "Nothing was charged" in r["summary"]
    assert env.meter.charges == []
