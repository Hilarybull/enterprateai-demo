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
    await _insert(payload)


_warned: set[str] = set()


async def _insert(payload: dict) -> None:
    try:
        await sb_insert("ai_usage_events", payload)
    except Exception as exc:
        # Loud once per kind of failure (a missing table shows up in the logs), quiet after that.
        kind = type(exc).__name__ + ":" + str(exc)[:80]
        if kind in _warned:
            logger.debug("AI usage event not recorded: %s", exc)
        else:
            _warned.add(kind)
            logger.warning("AI usage event not recorded (is migration 041_ai_usage_events applied?): %s", exc)


def search_cost_usd(provider: str, searches: int) -> float | None:
    from app.core.config import get_settings
    s = get_settings()
    each = {"serpapi": s.serpapi_cost_per_search_usd, "serper": s.serper_cost_per_search_usd}.get(provider)
    return None if each is None else round(each * max(int(searches), 0), 8)


async def record_search_usage(*, user_id: str | None, feature: str, provider: str, searches: int,
                              metadata: dict[str, Any] | None = None) -> None:
    """A web search call, billed per search: recorded with no tokens and the per-search cost."""
    if searches <= 0:
        return
    await _insert({
        "id": str(uuid4()),
        "user_id": user_id,
        "feature": feature or "unknown",
        "provider": provider,
        "model": "web_search",
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "estimated_cost_usd": search_cost_usd(provider, searches),
        "request_id": None,
        "metadata": {"searches": int(searches), **(metadata or {})},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
