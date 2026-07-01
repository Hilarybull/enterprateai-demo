from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.supabase import sb_insert

logger = logging.getLogger(__name__)


OPENAI_PRICING_USD_PER_1M = {
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
}

ANTHROPIC_PRICING_USD_PER_1M = {
    "claude-3-5-sonnet-20240620": {"input": 3.00, "output": 15.00},
    "claude-3-5-sonnet-20241022": {"input": 3.00, "output": 15.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
}

GEMINI_PRICING_USD_PER_1M = {
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50},
}


def estimate_cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float | None:
    model_key = (model or "").strip()
    pricing = None
    if provider == "openai":
        pricing = OPENAI_PRICING_USD_PER_1M.get(model_key)
    elif provider == "anthropic":
        pricing = ANTHROPIC_PRICING_USD_PER_1M.get(model_key)
    elif provider == "gemini":
        pricing = GEMINI_PRICING_USD_PER_1M.get(model_key)
    if not pricing:
        return None
    return round(((input_tokens * pricing["input"]) + (output_tokens * pricing["output"])) / 1_000_000, 8)


async def record_ai_usage(
    *,
    user_id: str | None,
    feature: str,
    provider: str,
    model: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    input_count = max(int(input_tokens or 0), 0)
    output_count = max(int(output_tokens or 0), 0)
    total_count = max(int(total_tokens or (input_count + output_count)), 0)
    cost = estimate_cost_usd(provider, model, input_count, output_count)
    payload = {
        "id": str(uuid4()),
        "user_id": user_id,
        "feature": feature or "unknown",
        "provider": provider or "unknown",
        "model": model or "unknown",
        "input_tokens": input_count,
        "output_tokens": output_count,
        "total_tokens": total_count,
        "estimated_cost_usd": cost,
        "request_id": request_id,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await sb_insert("ai_usage_events", payload)
    except Exception as exc:
        logger.debug("AI usage event not recorded; migration may be missing: %s", exc)
