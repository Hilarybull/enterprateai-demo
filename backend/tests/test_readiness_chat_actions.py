import asyncio
from unittest.mock import AsyncMock
from types import SimpleNamespace
import pytest
from app.modules.agent.readiness_chat import conversation_actions, remaining_card
from app.modules.agent.converse import asks_gaps
from app.modules.agent.router import _card_kept


@pytest.mark.parametrize("topic,goal", [("funding", "need_funding"), ("launch", "launch")])
def test_completed_do_all_reuses_saved_work_before_quoting_or_starting(monkeypatch, topic, goal):
    from datetime import datetime, timezone
    from app.modules.agent import converse, research
    state = lambda data, requested, **kwargs: {"run_id": "finished"} if requested == goal and kwargs.get("case_id") == "case" else {}
    monkeypatch.setattr(research, "research_state", state)
    reply = AsyncMock(return_value={"message": "Review saved drafts"})
    monkeypatch.setattr(converse, "_said", reply)
    orch = SimpleNamespace(rt=SimpleNamespace(business=SimpleNamespace(load=AsyncMock(return_value={}))))
    now = datetime.now(timezone.utc)
    out = asyncio.run(converse._ask_do_all(orch, {"id": "owner"}, "business", {"id": "case"}, {}, "Do it all", now, topic=topic))
    assert out["message"] == "Review saved drafts"
    assert "already saved" in reply.call_args.args[4]
    out = asyncio.run(converse._start_do_all(orch, {"id": "owner"}, "business", {"id": "case"}, {"session": "old"}, "Yes start", now, topic=topic))
    assert out["message"] == "Review saved drafts"


def test_other_checks_continue_their_next_actions_in_chat():
    from app.modules.agent.converse_check import next_actions
    actions = next_actions("pricing", {"free_next_actions": [{"label": "Review your price", "to": "/check/pricing"}]})
    assert actions[0]["kind"] == "explain" and "to" not in actions[0]
    assert "Review your price" in actions[0]["prompt"]


@pytest.mark.parametrize("topic", ["funding", "launch"])
def test_readiness_actions_continue_in_chat(topic):
    actions = conversation_actions([{"label": "See all 9", "to": f"/{topic}/case?tab=overview"},
                                    {"label": "Continue manually", "to": f"/{topic}/case?tab=answers"}])
    assert all("to" not in action and topic in action["prompt"] for action in actions)
    assert asks_gaps(actions[0]["prompt"])


def test_task_card_contains_every_open_source_item_and_survives_history(monkeypatch):
    subject = {"actions": [{"status": "open", "title": f"Remaining item {i}"} for i in range(9)] + [{"status": "done", "title": "Completed"}]}
    get = AsyncMock(return_value=subject)
    monkeypatch.setattr("app.modules.readiness.service.service_for", lambda _: SimpleNamespace(get_subject=get, drafts_now=lambda *_: {}))
    card = asyncio.run(remaining_card(None, {"id": "owner"}, "business", "funding", [], [{"type": "result", "case_id": "case"}]))
    assert len(card["items"]) == 9
    assert _card_kept(card) == card
    from app.modules.readiness import rules
    assert get.call_args.args[:4] == ("owner", "business", rules.FUNDING, "case")
