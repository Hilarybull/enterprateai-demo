from app.modules.admin.router import _rollup_ai_usage
from app.shared.llm.usage import estimate_cost_usd
from app.modules.credits.catalogue import default_config


def test_opus_cost_is_estimated_for_old_unpriced_calls():
    assert estimate_cost_usd("anthropic", "claude-opus-5-5", 1000, 2000) == .044
    result = _rollup_ai_usage([{"provider": "anthropic", "model": "claude-opus-5-5", "input_tokens": 1000, "output_tokens": 2000, "total_tokens": 3000, "estimated_cost_usd": None}], {})
    assert result["estimated_cost_usd"] == .044
    assert result["recent"][0]["estimated_cost_usd"] == .044


def test_tender_evaluation_price_is_twenty_credits():
    assert default_config("tender_evaluation")["credit_cost"] == 20


def test_unknown_model_cost_stays_unknown_instead_of_becoming_free():
    result = _rollup_ai_usage([{"provider": "anthropic", "model": "unknown", "input_tokens": 1000, "total_tokens": 1000}], {})
    assert result["estimated_cost_usd"] is None
    assert result["by_model"][0]["estimated_cost_usd"] is None
    assert result["by_user"][0]["estimated_cost_usd"] is None
