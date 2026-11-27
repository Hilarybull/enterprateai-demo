import asyncio
from unittest.mock import AsyncMock
from types import SimpleNamespace
import pytest
from app.modules.agent.readiness_chat import conversation_actions, remaining_card
from app.modules.agent.converse import asks_gaps
from app.modules.agent.router import _card_kept


def test_review_controls_survive_saving_and_reopening_the_chat():
    card = _card_kept({"type": "readiness_tasks", "case_id": "case", "topic": "funding", "title": "Remaining",
                      "items": [{"title": "Review documents", "code": "C8.A", "section": "documents", "review": "documents"}]})
    assert card["items"][0]["review"] == "documents" and card["items"][0]["code"] == "C8.A"


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


def test_draft_review_text_never_exposes_internal_ids():
    from app.modules.agent.readiness_chat import readable
    text = readable([{"id": "internal-id", "gap": "Limited delivery capacity", "action": "Add support", "milestone_id": "link-id"},
                     {"id": "another-id", "owner": "Hilary", "measure": "Paying customers"}])
    assert "internal-id" not in text and "link-id" not in text and "another-id" not in text
    assert "Gap: Limited delivery capacity" in text and "Owner: Hilary" in text


@pytest.mark.parametrize("route,expected", [("loan", {"loan"}), ("grant", {"grant"}), ("equity", {"equity"}), ("unsure", {"loan", "grant", "equity"})])
def test_funding_options_filter_the_selected_route_and_compare_all_when_unsure(route, expected):
    from app.modules.agent import research
    items = [{"id": kind, "topic": f"route_{kind}", "value": f"{kind.title()} programme provides business funding.",
              "sources": [{"title": f"{kind.title()} programme", "url": f"https://funding.example.test/{kind}"}]} for kind in ("loan", "grant", "equity")]
    options = research.funding_options({"route": route}, items, limit=10)
    assert {option["route"] for option in options} == expected


def test_status_poll_returns_funding_options_instead_of_readiness_drafts(monkeypatch):
    from app.modules.agent import router, research, readiness_chat
    orch = SimpleNamespace(actor_for=AsyncMock(return_value=(SimpleNamespace(can_view=True), None)),
                           rt=SimpleNamespace(business=SimpleNamespace(load=AsyncMock(return_value={}))))
    monkeypatch.setattr(router, "get_orchestrator", lambda: orch)
    monkeypatch.setattr(research, "research_state", lambda *_a, **_k: {"run_id": "finished"})
    options = AsyncMock(return_value={"type": "options", "options": [{"title": "Working Capital Loan"}]})
    drafts = AsyncMock()
    monkeypatch.setattr(readiness_chat, "funding_options_card", options)
    monkeypatch.setattr(readiness_chat, "remaining_card", drafts)
    out = asyncio.run(router.readiness_work_status("business", "funding", "case", options=True, user={"id": "owner"}))
    assert not out["working"] and out["card"]["type"] == "options"
    drafts.assert_not_awaited()
    options.assert_awaited_once_with(orch, {"id": "owner"}, "business", "case")


def test_options_from_another_case_are_never_returned(monkeypatch):
    from app.modules.agent import converse, research
    monkeypatch.setattr(research, "research_state", lambda *_a, **_k: {"state": "review", "run_id": "wrong"})
    monkeypatch.setattr(research, "_runs", lambda *_: {"wrong": {"case_id": "other-case", "items": []}})
    assert converse.options_found({}, case_id="this-case", answers={"route": "loan"}) is None


def test_user_edited_draft_remains_pending_without_being_treated_as_an_ai_estimate():
    from app.modules.readiness.service import ReadinessService
    case = {"agent_drafts": {"economics.price": {"value": 12345, "source": "Edited by you; awaiting approval"}}}
    drafts = ReadinessService.drafts_now(case, {})
    assert drafts["economics.price"]["value"] == 12345
    assert "economics" not in case


@pytest.mark.parametrize("route,expected", [("loan", {"route_loan"}), ("grant", {"route_grant"}), ("equity", {"route_equity"}), ("unsure", {"route_loan", "route_grant", "route_equity"})])
def test_search_queries_follow_the_case_route(route, expected):
    from app.modules.agent import research
    topics, _, _ = research.plan_run("need_funding", {"criteria": [{"key": "materials", "label": "Funding options", "state": "missing"}]},
                                     {"route": route}, {"country": "Nigeria", "sector": "consulting", "amount": "NGN 5000000"})
    assert {topic["topic"] for topic in topics if topic["topic"].startswith("route_")} == expected


@pytest.mark.parametrize("result,score,partial", [({"score": None, "known_points": 6}, 6, True), ({"score": None, "known_points": 0}, 0, True), ({"score": 72, "known_points": 60}, 72, False), ({}, None, False)])
def test_handover_keeps_the_engine_points_from_saved_answers(result, score, partial):
    from app.modules.agent.assessment_summary import score_fields
    assert score_fields(result) == {"score": score, "score_partial": partial}
