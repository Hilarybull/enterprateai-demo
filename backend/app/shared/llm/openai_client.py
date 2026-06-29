from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMTextResult:
    text: str
    provider: str
    model: str


class LLMClient:
    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:  # pragma: no cover
        raise NotImplementedError


class OpenAIResponsesClient(LLMClient):
    """
    Uses OpenAI's Responses API via raw HTTP to avoid tight coupling to a specific SDK version.
    This client is used ONLY for narrative generation and explanations.
    """

    def __init__(self) -> None:
        self._settings = get_settings()

    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:
        if not self._settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not configured")

        headers = {"Authorization": f"Bearer {self._settings.openai_api_key}"}
        payload = {
            "model": self._settings.openai_model,
            # Long-form documents need more output room. This client is used only
            # for narrative generation; all numeric/calculation outputs are
            # blocked by guardrails upstream/downstream.
            "max_output_tokens": 9000,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system}]},
                {"role": "user", "content": [{"type": "input_text", "text": prompt}]},
            ],
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post("https://api.openai.com/v1/responses", json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"OpenAI API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict):
            if isinstance(data.get("output_text"), str):
                text = data["output_text"]
            elif isinstance(data.get("output"), list):
                chunks: list[str] = []
                for item in data["output"]:
                    if not isinstance(item, dict):
                        continue
                    for c in item.get("content", []) if isinstance(item.get("content"), list) else []:
                        if isinstance(c, dict) and c.get("type") in ("output_text", "text"):
                            val = c.get("text") or c.get("value")
                            if isinstance(val, str):
                                chunks.append(val)
                text = "\n".join([c for c in chunks if c]).strip()

        text = text.strip()
        if not text:
            logger.warning("OpenAI response did not include output text; returning empty string")
        return LLMTextResult(text=text, provider="openai", model=self._settings.openai_model)


class NoopLLMClient(LLMClient):
    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:
        return LLMTextResult(text="", provider="noop", model="none")


class AnthropicMessagesClient(LLMClient):
    """
    Minimal Anthropic Messages API client.
    Used ONLY for narrative generation and explanations.
    """

    def __init__(self) -> None:
        self._settings = get_settings()

    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:
        if not self._settings.claude_api_key:
            raise RuntimeError("CLAUDE_API_KEY not configured")

        headers = {
            "x-api-key": self._settings.claude_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": self._settings.claude_model,
            "max_tokens": 8000,
            "temperature": 0.5,
            "system": system,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"Anthropic API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict) and isinstance(data.get("content"), list):
            chunks: list[str] = []
            for c in data["content"]:
                if isinstance(c, dict) and c.get("type") == "text" and isinstance(c.get("text"), str):
                    chunks.append(c["text"])
            text = "\n".join(chunks).strip()
        return LLMTextResult(text=text, provider="anthropic", model=self._settings.claude_model)


class GeminiGenerateClient(LLMClient):
    """
    Minimal Google Gemini API client.
    Used ONLY for narrative generation and explanations.
    """

    def __init__(self) -> None:
        self._settings = get_settings()

    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:
        if not self._settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not configured")

        # Gemini uses an API key in the query string.
        model = self._settings.gemini_model
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": f"{system}\n\n{prompt}"}],
                }
            ],
            "generationConfig": {"temperature": 0.5, "maxOutputTokens": 8000},
        }

        async with httpx.AsyncClient(timeout=900) as client:
            try:
                resp = await client.post(url, params={"key": self._settings.gemini_api_key}, json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                body = e.response.text if e.response is not None else ""
                raise RuntimeError(f"Gemini API error {e.response.status_code if e.response else 'unknown'}: {body}") from e
            data = resp.json()

        text = ""
        if isinstance(data, dict) and isinstance(data.get("candidates"), list) and data["candidates"]:
            cand = data["candidates"][0]
            if isinstance(cand, dict):
                content = cand.get("content")
                if isinstance(content, dict) and isinstance(content.get("parts"), list):
                    chunks: list[str] = []
                    for p in content["parts"]:
                        if isinstance(p, dict) and isinstance(p.get("text"), str):
                            chunks.append(p["text"])
                    text = "\n".join(chunks).strip()
        return LLMTextResult(text=text, provider="gemini", model=model)


class AutoLLMClient(LLMClient):
    """
    Picks the best available LLM provider based on configured keys.
    Order: Claude -> OpenAI -> Gemini -> Noop

    This client is resilient: if a configured provider errors (network, auth, quota),
    it falls back to the next configured provider.
    """

    def __init__(self) -> None:
        self._settings = get_settings()
        self._clients: list[LLMClient] = []
        has_primary = False
        if self._settings.claude_api_key:
            self._clients.append(AnthropicMessagesClient())
            has_primary = True
        if self._settings.openai_api_key:
            self._clients.append(OpenAIResponsesClient())
            has_primary = True
        if self._settings.gemini_api_key and (not has_primary or self._settings.allow_gemini_fallback):
            self._clients.append(GeminiGenerateClient())
        if not self._clients:
            self._clients.append(NoopLLMClient())

    async def generate_text(self, *, system: str, prompt: str) -> LLMTextResult:
        last_err: Exception | None = None
        for c in self._clients:
            try:
                res = await c.generate_text(system=system, prompt=prompt)
                # Some providers can return an HTTP 200 but our parsing yields empty text.
                # Treat that as a failure so we can fall back to the next configured provider.
                if not (res.text or "").strip() and not isinstance(c, NoopLLMClient):
                    raise RuntimeError(f"{res.provider} returned empty text")
                return res
            except Exception as e:
                last_err = e
                continue
        if last_err:
            raise last_err
        return await NoopLLMClient().generate_text(system=system, prompt=prompt)


_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}


async def pick_llm_for_user(user_id: str) -> LLMClient:
    """Return AnthropicMessagesClient for paid plans, OpenAIResponsesClient for free/trial."""
    from app.core.supabase import sb_select
    sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
    plan_key = (sub or {}).get("plan_key") or ""
    status = (sub or {}).get("status") or ""
    is_free = plan_key in _FREE_PLAN_KEYS or status in {"trial", "expired"}
    return OpenAIResponsesClient() if is_free else AnthropicMessagesClient()
