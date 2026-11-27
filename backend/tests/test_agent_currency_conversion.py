from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.modules.agent import currency_conversion, chat_agent, converse
from app.shared import currency
from test_goal_onboarding import world, OWNER, run
from test_round14_converse_funding import talk, _case, no_background_connections

@pytest.fixture(autouse=True)
def dated_rate(monkeypatch,no_background_connections):
    lookup=AsyncMock(return_value={"rate":0.0005,"date":"2026-11-27","source":"shared converter"})
    monkeypatch.setattr(currency,"get_rate_dated",lookup)
    return lookup

def offer(talk):
    env,ask,model,cid=talk
    model.replies.append({"say":"Let me check that.","change":{"target_amount":1000000,"currency":"NGN"}})
    out=ask("I need ₦1,000,000 for funding",page="funding")
    assert (env.businesses["A"]["data"].get("agent_conversations") or {}).get(OWNER,{}).get("pending_fx"), env.businesses["A"]["data"].get("agent_conversations")
    return out

def test_shared_library_rate_is_used_and_saved_only_after_confirmation(talk,dated_rate):
    env,ask,model,cid=talk
    out=offer(talk)
    assert "£500" in out["message"] and "2026-11-27" in out["message"]
    assert "How much is that" not in out["message"]
    dated_rate.assert_awaited_once_with("NGN","GBP")
    assert float(_case(env,cid)["target_amount"]) == 50000
    applied=ask("Apply",page="funding")
    saved=_case(env,cid)
    assert float(saved["target_amount"]) == 500 and saved["currency"] == "GBP", applied
    assert saved["currency_conversion"]["original_amount"] == 1000000
    assert saved["currency_conversion"]["from_currency"] == "NGN"
    assert saved["currency_conversion"]["saved"] is True
    assert "Converted from" in saved["provenance"]["target_amount"]["source"]
    assert env.businesses["A"]["data"].get("settings",{}).get("currency") in (None,"GBP")

def test_cancel_does_not_change_the_case(talk):
    env,ask,model,cid=talk
    offer(talk);out=ask("Cancel",page="funding")
    assert "Cancelled" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000

def test_conversion_question_and_saved_reply_keep_the_exact_pence(talk,dated_rate):
    env,ask,model,cid=talk
    dated_rate.return_value={"rate":.00056627,"date":"2026-11-27","source":"shared converter"}
    out=offer(talk)
    assert "£566.27" in out["message"]
    applied=ask("Apply",page="funding")
    assert "£566.27" in applied["message"]
    assert float(_case(env,cid)["target_amount"]) == 566.27

def test_a_different_amount_in_the_confirmation_is_not_silently_overwritten(talk):
    env,ask,model,cid=talk
    offer(talk)
    out=ask("Yes use £600",page="funding")
    assert "different amount" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000

def test_unavailable_rate_is_not_guessed_and_retry_keeps_the_original_need(talk,dated_rate):
    env,ask,model,cid=talk
    dated_rate.return_value=None
    out=offer(talk)
    assert "couldn't get the exchange rate" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000
    dated_rate.return_value={"rate":.0005,"date":"2026-11-27","source":"shared converter"}
    out=ask("Retry conversion",page="funding")
    assert "£500" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000

def test_convert_followup_recovers_the_amount_from_the_old_currency_question(talk):
    env,ask,model,cid=talk
    from datetime import datetime,timezone
    run(converse._said(env.orch,{"id":OWNER,"email":OWNER},"A","I need ₦1m for funding",
        "Your business works in GBP. How much is that in GBP?",[],datetime.now(timezone.utc)))
    out=ask("convert",page="funding")
    assert "£500" in out["message"] and "Rate:" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000

def test_main_agent_resumes_conversion_confirmation_without_a_model_call(talk,monkeypatch):
    env,ask,model,cid=talk
    offer(talk)
    from app.modules.agent.router import AgentRequestIn
    blocked=AsyncMock(side_effect=AssertionError("No model needed"));monkeypatch.setattr(chat_agent,"_ask",blocked)
    out=run(chat_agent.turn(env.orch,{"id":OWNER,"email":OWNER},AgentRequestIn(business_id="A",text="Apply"),env.businesses["A"]["data"]))
    assert out["kind"] == "answer" and float(_case(env,cid)["target_amount"]) == 500, out
    blocked.assert_not_awaited()

def test_main_agent_uses_visible_history_for_the_actual_rate_lookup_followup(talk,monkeypatch):
    env,ask,model,cid=talk
    from app.modules.agent.router import AgentRequestIn
    blocked=AsyncMock(side_effect=AssertionError("No model needed"));monkeypatch.setattr(chat_agent,"_ask",blocked)
    body=AgentRequestIn(business_id="A",text="Look up today's rate for me",history=[
        {"role":"user","content":"I need ₦1m for funding"},
        {"role":"assistant","content":"Your business works in GBP. How much is that in GBP?"}])
    out=run(chat_agent.turn(env.orch,{"id":OWNER,"email":OWNER},body,env.businesses["A"]["data"]))
    assert "£500" in out["message"] and "2026-11-27" in out["message"]
    assert float(_case(env,cid)["target_amount"]) == 50000
    blocked.assert_not_awaited()

def test_generic_conversion_tool_returns_a_quote_without_changing_any_records(talk):
    env,ask,model,cid=talk
    out=run(chat_agent._use(env.orch,{"id":OWNER},"A",env.businesses["A"]["data"],SimpleNamespace(),"convert_currency",
                          {"amount":1000000,"from_currency":"NGN","to_currency":"GBP"}))
    assert out["converted_amount"] == 500 and out["saved"] is False
    assert float(_case(env,cid)["target_amount"]) == 50000

@pytest.mark.parametrize("bad",[None,0,-1,float('nan'),float('inf')])
def test_missing_or_invalid_rates_never_return_the_original_amount_as_converted(dated_rate,bad):
    dated_rate.return_value={"rate":bad,"date":"2026-11-27"}
    result=run(currency_conversion.quote(1000000,"NGN","GBP"))
    assert result["available"] is False and "converted_amount" not in result
