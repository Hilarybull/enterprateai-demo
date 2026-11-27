"""One way for the Agent to talk to a model with tools, whichever model it is (the owner, 11 Nov: "use Claude, then OpenAI as
backup"). The conversation is kept in a neutral form; each provider turns it into its own request and its reply back into
text and tool calls. Claude answers first; when it can't (not set up, down, timed out), OpenAI answers the same request.

Neutral items:
  {"role": "user", "text": "..."}
  {"role": "assistant", "text": "...", "calls": [Call], "raw": {"provider": "claude", "content": [...]}}
  {"role": "tool", "results": [{"id", "name", "content", "is_error"}]}
  {"role": "note", "text": "..."}      # an operator note for this turn, such as the business's context
"""
from __future__ import annotations

import json
import asyncio
import logging
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.shared.llm.openai_client import ai_slot
from app.shared.llm.usage import record_ai_usage

logger = logging.getLogger(__name__)
PROVIDER_SECONDS = 25

CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass
class Call:
    id: str
    name: str
    input: dict


@dataclass
class Reply:
    text: str
    calls: list[Call] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    refused: bool = False
    raw: dict | None = None      # the provider's own reply, sent back unchanged to that provider (Claude's thinking blocks)

    def as_item(self) -> dict:
        return {"role": "assistant", "text": self.text, "calls": self.calls, "raw": self.raw}


def providers() -> list[str]:
    s = get_settings()
    return [p for p, key in (("claude", s.claude_api_key), ("openai", s.openai_api_key)) if key]


async def chat(*, system: str, items: list[dict], tools: list[dict], user_id: str | None = None, feature: str = "agent_conversation") -> Reply:
    """Claude first, OpenAI if Claude can't answer. Raises when neither can."""
    last: Exception | None = None
    for p in providers():
        try:
            return await asyncio.wait_for((_claude if p == "claude" else _openai)(system, items, tools, user_id, feature), timeout=PROVIDER_SECONDS)
        except Exception as e:      # noqa: BLE001 - the next provider answers the same request
            logger.warning("agent chat: %s did not answer, trying the next provider", p, exc_info=True)
            last = e
    raise last or RuntimeError("no AI provider is set up")


# ── Claude ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

_anthropic = None


def _claude_client():
    global _anthropic
    if _anthropic is None:
        import anthropic
        _anthropic = anthropic.AsyncAnthropic(api_key=get_settings().claude_api_key, max_retries=1, timeout=get_settings().ai_http_seconds)
    return _anthropic


def claude_messages(items: list[dict]) -> list[dict]:
    out: list[dict] = []
    for it in items:
        role = it.get("role")
        if role == "user":
            if it.get("images"):
                out.append({"role": "user", "content": [{"type": "image", "source": {"type": "base64", "media_type": image["media_type"], "data": image["data"]}} for image in it["images"]] + [{"type": "text", "text": it["text"]}]})
            elif out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], str):
                out[-1]["content"] += "\n" + it["text"]
            else:
                out.append({"role": "user", "content": it["text"]})
        elif role == "assistant":
            raw = it.get("raw") or {}
            if raw.get("provider") == "claude":
                out.append({"role": "assistant", "content": raw["content"]})      # unchanged, thinking blocks included
            else:
                blocks = ([{"type": "text", "text": it["text"]}] if it.get("text") else []) + \
                         [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in it.get("calls") or []]
                out.append({"role": "assistant", "content": blocks or it.get("text") or "…"})
        elif role == "tool":
            out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": r["id"], "content": r["content"],
                                                     **({"is_error": True} if r.get("is_error") else {})} for r in it["results"]]})
        elif role == "note":
            out.append({"role": "system", "content": it["text"]})
    return out


async def _claude(system: str, items: list[dict], tools: list[dict], user_id: str | None, feature: str) -> Reply:
    import anthropic
    s = get_settings()
    args = dict(model=s.agent_model, max_tokens=16000, system=system, tools=tools, messages=claude_messages(items),
                output_config={"effort": "low"}, cache_control={"type": "ephemeral"})
    async with ai_slot():
        try:
            # Refusal fallbacks on: a declined request is re-run on a fallback model by the server
            res = await _claude_client().beta.messages.create(**args, betas=[CLAUDE_FALLBACK_BETA], extra_body={"fallbacks": "default"})
        except anthropic.BadRequestError as e:
            if "fallback" not in str(getattr(e, "message", "") or e).lower():
                raise
            res = await _claude_client().messages.create(**args)      # an account without that beta
    u = getattr(res, "usage", None)
    await record_ai_usage(user_id=user_id, feature=feature, provider="claude", model=str(getattr(res, "model", s.agent_model)),
                          input_tokens=getattr(u, "input_tokens", 0), output_tokens=getattr(u, "output_tokens", 0),
                          request_id=getattr(res, "id", None))
    text = " ".join(b.text for b in res.content if getattr(b, "type", "") == "text").strip()
    calls = [Call(id=b.id, name=b.name, input=dict(b.input or {})) for b in res.content if getattr(b, "type", "") == "tool_use"]
    return Reply(text=text, calls=calls, provider="claude", model=str(getattr(res, "model", s.agent_model)),
                 refused=getattr(res, "stop_reason", "") == "refusal", raw={"provider": "claude", "content": res.content})


# ── OpenAI (the backup) ────────────────────────────────────────────────────────────────────────────────────────────────

def openai_input(system: str, items: list[dict]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": system}]
    for it in items:
        role = it.get("role")
        if role == "user":
            content = ([{"type": "input_image", "image_url": f"data:{image['media_type']};base64,{image['data']}"} for image in it["images"]] + [{"type": "input_text", "text": it["text"]}]) if it.get("images") else it["text"]
            out.append({"role": "user", "content": content})
        elif role == "assistant":
            if it.get("text"):
                out.append({"role": "assistant", "content": it["text"]})
            out += [{"type": "function_call", "call_id": c.id, "name": c.name, "arguments": json.dumps(c.input, ensure_ascii=False)}
                    for c in it.get("calls") or []]
        elif role == "tool":
            out += [{"type": "function_call_output", "call_id": r["id"], "output": r["content"]} for r in it["results"]]
        elif role == "note":
            out.append({"role": "system", "content": it["text"]})
    return out


def openai_tools(tools: list[dict]) -> list[dict]:
    return [{"type": "function", "name": t["name"], "description": t.get("description") or "", "parameters": t["input_schema"],
             "strict": bool(t.get("strict"))} for t in tools]


async def _openai(system: str, items: list[dict], tools: list[dict], user_id: str | None, feature: str) -> Reply:
    s = get_settings()
    model = s.agent_openai_model or s.openai_model
    payload = {"model": model, "max_output_tokens": 4000, "input": openai_input(system, items), "tools": openai_tools(tools)}
    async with ai_slot(), httpx.AsyncClient(timeout=s.ai_http_seconds) as client:
        resp = await client.post("https://api.openai.com/v1/responses", json=payload, headers={"Authorization": f"Bearer {s.openai_api_key}"})
        if resp.status_code >= 400:
            raise RuntimeError(f"OpenAI API error {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
    texts, calls = [], []
    for item in data.get("output") or []:
        if item.get("type") == "function_call":
            try:
                args = json.loads(item.get("arguments") or "{}")
            except ValueError:
                args = {}
            calls.append(Call(id=str(item.get("call_id") or item.get("id")), name=str(item.get("name")), input=args if isinstance(args, dict) else {}))
        elif item.get("type") == "message":
            texts += [c.get("text") or "" for c in item.get("content") or [] if c.get("type") in ("output_text", "text")]
    usage = data.get("usage") or {}
    await record_ai_usage(user_id=user_id, feature=feature, provider="openai", model=model, input_tokens=usage.get("input_tokens"),
                          output_tokens=usage.get("output_tokens"), total_tokens=usage.get("total_tokens"), request_id=data.get("id"))
    refused = any(c.get("type") == "refusal" for item in data.get("output") or [] for c in item.get("content") or [] if isinstance(c, dict))
    return Reply(text=" ".join(t for t in texts if t).strip(), calls=calls, provider="openai", model=model, refused=refused)
