"""
chart_data_service.py
---------------------
Fetches real, sourced market data for business plan charts.

For each business plan the service attempts to retrieve:
  - TAM / SAM / SOM figures with source citations
  - Year 1–3 revenue benchmarks for the sector
  - Top 3–5 risk factors with likelihood and impact

Data priority:
  1. Validation workspace data (user-provided figures)
  2. Live SERP research (SerpAPI → Serper fallback)
  3. Claude synthesis to structure the raw snippets into numbers

All figures carry a source citation (title + URL).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

SERP_BASE   = "https://serpapi.com/search"
SERPER_BASE = "https://google.serper.dev/search"
CLAUDE_BASE = "https://api.anthropic.com/v1/messages"
TIMEOUT     = 30.0


# ── SERP helpers ─────────────────────────────────────────────────────────────

async def _serp(client: httpx.AsyncClient, query: str) -> dict:
    settings = get_settings()
    if not settings.serp_api_key:
        return {}
    try:
        r = await client.get(
            SERP_BASE,
            params={"api_key": settings.serp_api_key, "q": query, "num": 6, "engine": "google"},
            timeout=TIMEOUT,
        )
        if r.status_code == 200:
            return r.json()
    except Exception as exc:
        logger.warning("chart_data_service SerpAPI: %s", exc)
    return {}


async def _serper(client: httpx.AsyncClient, query: str) -> dict:
    settings = get_settings()
    if not settings.serper_api_key:
        return {}
    try:
        r = await client.post(
            SERPER_BASE,
            headers={"X-API-KEY": settings.serper_api_key, "Content-Type": "application/json"},
            json={"q": query, "num": 6},
            timeout=TIMEOUT,
        )
        if r.status_code == 200:
            data = r.json()
            return {"organic_results": data.get("organic", [])}
    except Exception as exc:
        logger.warning("chart_data_service Serper: %s", exc)
    return {}


async def _search(client: httpx.AsyncClient, query: str) -> dict:
    result = await _serp(client, query)
    if not result.get("organic_results"):
        result = await _serper(client, query)
    return result


def _organic(result: dict, max_items: int = 5) -> list[dict]:
    return (result.get("organic_results") or [])[:max_items]


def _snippets_and_sources(result: dict, max_items: int = 5) -> tuple[list[str], list[dict]]:
    items = _organic(result, max_items)
    snippets = [
        f"{e.get('title', '')}: {e.get('snippet', '')}"
        for e in items if e.get("snippet") or e.get("title")
    ]
    sources = [
        {"title": e.get("title", ""), "url": e.get("link", "")}
        for e in items if e.get("link")
    ]
    return snippets, sources


# ── Claude synthesis ──────────────────────────────────────────────────────────

async def _claude_extract(prompt: str) -> dict:
    settings = get_settings()
    if not settings.claude_api_key:
        return {}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                CLAUDE_BASE,
                headers={
                    "x-api-key": settings.claude_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30.0,
            )
            if r.status_code == 200:
                text = r.json()["content"][0]["text"].strip()
                # Extract JSON block
                m = re.search(r"\{[\s\S]+\}", text)
                if m:
                    return json.loads(m.group())
    except Exception as exc:
        logger.warning("chart_data_service Claude: %s", exc)
    return {}


# ── Market size (TAM/SAM/SOM) ─────────────────────────────────────────────────

async def _fetch_market_size(
    client: httpx.AsyncClient,
    industry: str,
    target_market: str,
    location: str,
) -> dict:
    geo = location or "global"
    query = f"{industry} market size TAM SAM SOM {geo} 2024 2025 report billion"
    result = await _search(client, query)
    snippets, sources = _snippets_and_sources(result, 5)
    if not snippets:
        return {}

    prompt = f"""You are a market research analyst. Extract TAM, SAM, and SOM figures from the search snippets below.
Industry: {industry}
Target market: {target_market}
Geography: {geo}

Search snippets:
{chr(10).join(f'- {s}' for s in snippets)}

Return ONLY valid JSON in this exact shape (no prose, no markdown):
{{
  "tam": {{"value": <number in GBP millions, or null>, "label": "<e.g. £42B global {industry} market>", "source_title": "<title>", "source_url": "<url>"}},
  "sam": {{"value": <number in GBP millions, or null>, "label": "<e.g. £4.2B UK addressable>", "source_title": "<title>", "source_url": "<url>"}},
  "som": {{"value": <number in GBP millions, or null>, "label": "<e.g. £420M realistic capture>", "source_title": "<title>", "source_url": "<url>"}}
}}

Rules:
- Convert all values to GBP millions (1B = 1000M).
- If a figure is not in the snippets, set value to null.
- Pick the most credible, recent source per tier.
- Do NOT invent figures. Only use what is explicitly stated in the snippets.
Sources available: {json.dumps(sources)}"""

    data = await _claude_extract(prompt)
    if data:
        data["sources"] = sources[:3]
    return data


# ── Risk factors ──────────────────────────────────────────────────────────────

async def _fetch_risks(
    client: httpx.AsyncClient,
    industry: str,
    problem: str,
    location: str,
) -> dict:
    geo = location or "UK"
    query = f"{industry} startup business risks challenges {geo} 2024 2025"
    result = await _search(client, query)
    snippets, sources = _snippets_and_sources(result, 5)
    if not snippets:
        return {}

    prompt = f"""You are a business risk analyst. Extract the top 4–5 distinct business risks from the search snippets below.
Industry: {industry}
Core problem being solved: {problem or 'not specified'}
Geography: {geo}

Snippets:
{chr(10).join(f'- {s}' for s in snippets)}

Return ONLY valid JSON (no prose):
{{
  "risks": [
    {{"label": "<short risk name, max 20 chars>", "likelihood": "High|Medium|Low", "impact": "High|Medium|Low", "source_title": "<title>", "source_url": "<url>"}},
    ...
  ],
  "sources": [{{"title": "<title>", "url": "<url>"}}]
}}

Rules:
- Max 5 risks. Short labels only. Vary likelihood/impact across the list.
- Only use risks evidenced by the snippets. Do NOT invent.
Sources available: {json.dumps(sources)}"""

    return await _claude_extract(prompt)


# ── Main entry point ──────────────────────────────────────────────────────────

async def fetch_chart_data(
    *,
    industry: str,
    target_market: str,
    problem: str,
    location: str,
    validation_data: dict | None = None,
) -> dict:
    """
    Returns a dict with keys: market_size, risks.
    Each key holds structured data with source citations, or {} if unavailable.
    """
    # If the validation already has market data, use it and skip search
    market_override: dict = {}
    if validation_data:
        mr = validation_data.get("market_research") or {}
        tam_raw = mr.get("tam") or mr.get("total_addressable_market")
        sam_raw = mr.get("sam") or mr.get("serviceable_addressable_market")
        som_raw = mr.get("som") or mr.get("serviceable_obtainable_market")
        if tam_raw or sam_raw or som_raw:
            market_override = {
                "tam": {"value": _parse_millions(tam_raw), "label": str(tam_raw or ""), "source_title": "Idea Validation", "source_url": ""},
                "sam": {"value": _parse_millions(sam_raw), "label": str(sam_raw or ""), "source_title": "Idea Validation", "source_url": ""},
                "som": {"value": _parse_millions(som_raw), "label": str(som_raw or ""), "source_title": "Idea Validation", "source_url": ""},
                "sources": [],
            }

    async def _identity(v):
        return v

    async with httpx.AsyncClient() as client:
        tasks = []
        if not market_override:
            tasks.append(_fetch_market_size(client, industry, target_market, location))
        else:
            tasks.append(_identity(market_override))
        tasks.append(_fetch_risks(client, industry, problem, location))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    market_size = results[0] if not isinstance(results[0], Exception) else {}
    risks       = results[1] if not isinstance(results[1], Exception) else {}

    if isinstance(market_size, Exception):
        logger.warning("chart_data market_size error: %s", market_size)
        market_size = {}
    if isinstance(risks, Exception):
        logger.warning("chart_data risks error: %s", risks)
        risks = {}

    return {"market_size": market_override or market_size, "risks": risks}


def _parse_millions(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).replace(",", "").replace("£", "").replace("$", "").replace("€", "").strip()
    m = re.search(r"([\d.]+)\s*([kKmMbBtT]?)", s)
    if not m:
        return None
    v = float(m.group(1))
    suf = m.group(2).lower()
    if suf in ("t",):     v *= 1_000_000
    elif suf in ("b",):   v *= 1_000
    elif suf in ("m",):   v *= 1
    elif suf in ("k",):   v /= 1_000
    return round(v, 2)


def format_chart_data_for_prompt(chart_data: dict) -> str:
    """Formats chart data as a readable block to inject into the LLM prompt."""
    if not chart_data:
        return ""
    parts = ["=== CHART DATA (use these figures verbatim in the relevant sections) ==="]

    ms = chart_data.get("market_size") or {}
    if ms:
        parts.append("\nMARKET SIZE DATA:")
        for tier, key in [("TAM (Total Addressable Market)", "tam"), ("SAM (Serviceable Addressable Market)", "sam"), ("SOM (Serviceable Obtainable Market)", "som")]:
            entry = ms.get(key) or {}
            val   = entry.get("value")
            label = entry.get("label") or ""
            src   = entry.get("source_title") or ""
            url   = entry.get("source_url") or ""
            if val is not None:
                parts.append(f"  {tier}: £{val:,.0f}M — {label} [Source: {src} {url}]".strip())
            elif label:
                parts.append(f"  {tier}: {label} [Source: {src}]")

    risks = chart_data.get("risks") or {}
    risk_list = risks.get("risks") or []
    if risk_list:
        parts.append("\nKEY RISK FACTORS (include in Risk Analysis section):")
        for r in risk_list:
            label = r.get("label", "")
            lh    = r.get("likelihood", "")
            imp   = r.get("impact", "")
            src   = r.get("source_title", "")
            parts.append(f"  - {label} (Likelihood: {lh}, Impact: {imp}) [Source: {src}]")

    if ms.get("sources"):
        parts.append("\nMARKET DATA SOURCES:")
        for s in (ms.get("sources") or [])[:3]:
            parts.append(f"  - {s.get('title', '')} — {s.get('url', '')}")

    return "\n".join(parts)
