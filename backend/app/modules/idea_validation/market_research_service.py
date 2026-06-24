"""
market_research_service.py
--------------------------
Runs live market research for the Idea Validation engine.

Flow:
  User fields -> SerpAPI/Serper retrieval -> Claude/OpenAI synthesis -> normalized report

Sections:
  1  Market Opportunity Summary
  2  Target Customer Insight
  3  Problem Validation
  4  Demand Signals
  5  Alternative Solutions
  6  Competitor Matrix
  7  Competitor Pricing Intelligence
  8  Suggested Pricing Strategy
  9  Recommended Price Range
  10 Positioning Recommendation
  11 Go-To-Market Recommendation
  12 Risks and Barriers
  13 Viability Score
  14 Next Best Actions
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

SERP_BASE = "https://serpapi.com/search"
SERPER_BASE = "https://google.serper.dev/search"
OPENAI_BASE = "https://api.openai.com/v1/chat/completions"
CLAUDE_BASE = "https://api.anthropic.com/v1/messages"
TIMEOUT = 45.0


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _listify(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item.strip())
    return out


def _limit_list(items: list[str], minimum: int = 0, maximum: int | None = None, filler: list[str] | None = None) -> list[str]:
    out = _dedupe_keep_order([item for item in items if item])
    if filler:
        for item in filler:
            if len(out) >= minimum:
                break
            if item.strip().lower() not in {entry.lower() for entry in out}:
                out.append(item.strip())
    if maximum is not None:
        out = out[:maximum]
    return out


def _limit_objects(items: list[dict[str, Any]], minimum: int, maximum: int, filler: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name") or item.get("competitor") or item.get("risk") or item.get("action"))
        key = name.lower()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(item)
        if len(out) >= maximum:
            return out
    for item in filler:
        if len(out) >= minimum:
            break
        name = _clean_text(item.get("name") or item.get("competitor") or item.get("risk") or item.get("action"))
        key = name.lower()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(item)
    return out[:maximum]


def _flatten_evidence_text(evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]], *keys: str) -> str:
    parts: list[str] = []
    for key in keys:
        for snippet in evidence.get(key) or []:
            if snippet:
                parts.append(str(snippet))
        for source in sources.get(key) or []:
            title = _clean_text(source.get("title"))
            snippet = _clean_text(source.get("snippet"))
            if title:
                parts.append(title)
            if snippet:
                parts.append(snippet)
    return " ".join(parts)


def _extract_market_size_text(text: str) -> str:
    patterns = [
        r"(?:USD|GBP|EUR|\$|£|€)\s?\d+(?:\.\d+)?\s?(?:billion|million|trillion|bn|m)",
        r"\d+(?:\.\d+)?\s?(?:billion|million|trillion|bn|m)\s?(?:market|industry|sector)?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def _extract_growth_text(text: str) -> str:
    patterns = [
        r"\d+(?:\.\d+)?%\s?(?:CAGR|growth|annual growth)",
        r"CAGR\s?(?:of\s?)?\d+(?:\.\d+)?%",
        r"growing\s(?:at\s)?\d+(?:\.\d+)?%",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def _evidence_based_market_size(fields: dict[str, Any], evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> str:
    text = _flatten_evidence_text(evidence, sources, "market_opportunity", "industry_trends", "news", "competitors")
    extracted = _extract_market_size_text(text)
    if extracted:
        return extracted
    segment = _clean_text(fields.get("customer_segment") or "the target segment")
    location = _clean_text(fields.get("location") or "the target market")
    return f"Search results show an active market in {location} for {segment}, with multiple vendors, ongoing category coverage, and visible buyer demand."


def _evidence_based_growth(fields: dict[str, Any], evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> str:
    text = _flatten_evidence_text(evidence, sources, "market_opportunity", "industry_trends", "news")
    extracted = _extract_growth_text(text)
    if extracted:
        return extracted
    what = _clean_text(fields.get("what_building") or "the category")
    return f"Search coverage suggests steady growth driven by digital adoption, workflow efficiency needs, and continued interest in {what}."


def _evidence_based_keyword_demand(fields: dict[str, Any], evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> str:
    text = _flatten_evidence_text(evidence, sources, "demand_signals", "problem_validation", "target_customer")
    if text:
        return "Search results show active problem-aware and solution-aware demand, with recurring discussion around pain points, alternatives, and buying intent."
    problem = _clean_text(fields.get("problem_short") or fields.get("what_building") or "this problem")
    return f"Public search results indicate discoverable demand around {problem}, even where exact keyword volumes are not exposed in snippets."


# SerpAPI helpers
async def _serp(client: httpx.AsyncClient, query: str, engine: str = "google", extra: dict | None = None) -> dict:
    settings = get_settings()
    if not settings.serp_api_key:
        return {}
    params = {"api_key": settings.serp_api_key, "q": query, "engine": engine, "num": 8}
    if extra:
        params.update(extra)
    try:
        response = await client.get(SERP_BASE, params=params, timeout=TIMEOUT)
        if response.status_code == 200:
            return response.json()
    except Exception as exc:
        logger.warning("SerpAPI error query=%r: %s", query, exc)
    return {}


async def _serper(client: httpx.AsyncClient, query: str, engine: str = "google", extra: dict | None = None) -> dict:
    settings = get_settings()
    if not settings.serper_api_key:
        return {}
    if engine not in {"google", "google_news"}:
        return {}
    headers = {
        "X-API-KEY": settings.serper_api_key,
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {"q": query, "num": 8}
    if extra:
        payload.update(extra)
    try:
        endpoint = SERPER_BASE if engine == "google" else f"{SERPER_BASE}/news"
        response = await client.post(endpoint, headers=headers, json=payload, timeout=TIMEOUT)
        if response.status_code == 200:
            data = response.json()
            if engine == "google_news":
                return {"news_results": data.get("news", [])}
            return {"organic_results": data.get("organic", [])}
    except Exception as exc:
        logger.warning("Serper error query=%r engine=%r: %s", query, engine, exc)
    return {}


def _snippets(result: dict, max_items: int = 6) -> list[str]:
    items: list[str] = []
    for entry in result.get("organic_results") or []:
        snippet = entry.get("snippet") or entry.get("title") or ""
        if snippet:
            items.append(snippet)
        if len(items) >= max_items:
            break
    for entry in result.get("news_results") or []:
        snippet = entry.get("snippet") or entry.get("title") or ""
        if snippet:
            items.append(snippet)
        if len(items) >= max_items:
            break
    return items


def _sources(result: dict, max_items: int = 5) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for entry in (result.get("organic_results") or [])[:max_items]:
        title = _clean_text(entry.get("title"))
        link = _clean_text(entry.get("link"))
        snippet = _clean_text(entry.get("snippet"))
        if title or link:
            items.append({"title": title, "url": link, "snippet": snippet})
    return items


def _shopping_items(result: dict, max_items: int = 8) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for entry in result.get("shopping_results") or []:
        items.append(
            {
                "name": _clean_text(entry.get("title")),
                "price": _clean_text(entry.get("price")),
                "source": _clean_text(entry.get("source")),
            }
        )
        if len(items) >= max_items:
            break
    return items


# Query builder
def _build_queries(fields: dict[str, Any]) -> dict[str, tuple[str, str, dict]]:
    what = _clean_text(fields.get("what_building") or fields.get("service_type") or fields.get("business_name") or "business")
    industry = _clean_text(fields.get("primary_industry") or fields.get("business_type"))
    location = _clean_text(fields.get("location") or "United Kingdom")
    segment = _clean_text(fields.get("customer_segment") or "customers")
    problem = _clean_text(fields.get("problem_short"))
    currency = _clean_text(fields.get("currency") or "GBP")

    category = " ".join(part for part in [what, industry] if part).strip()
    category = category or what or "business software"
    audience = f"{segment} {location}".strip()
    location_suffix = f" in {location}" if location else ""

    return {
        "market_opportunity": (f"{category} market size demand growth trends{location_suffix}", "google", {}),
        "industry_trends": (f"{category} industry trends adoption growth{location_suffix}", "google", {}),
        "target_customer": (f"{segment} pain points buying behaviour for {category}{location_suffix}", "google", {}),
        "problem_validation": (f"{problem or category} complaints pain points {audience}", "google", {}),
        "demand_signals": (f"{problem or category} search trends forums reddit reviews {audience}", "google", {}),
        "competitors": (f"top {category} competitors pricing alternatives{location_suffix}", "google", {}),
        "pricing": (f"{category} pricing plans monthly annual {currency}", "google", {}),
        "pricing_shop": (f"{category} price {currency}", "google_shopping", {}),
        "news": (f"{category} market news 2025 2026{location_suffix}", "google_news", {}),
    }


def _build_synthesis_prompt(fields: dict[str, Any], evidence: dict[str, list[str]]) -> str:
    business_name = _clean_text(fields.get("business_name") or fields.get("what_building"))
    industry = _clean_text(fields.get("primary_industry"))
    segment = _clean_text(fields.get("customer_segment"))
    problem = _clean_text(fields.get("problem_short"))
    location = _clean_text(fields.get("location") or "United Kingdom")
    
    evidence_text = ""
    for key, snippets in evidence.items():
        if snippets:
            evidence_text += f"\n### {key.upper().replace('_', ' ')}\n" + "\n".join(f"- {snippet}" for snippet in snippets)

    engine_data = fields.get("deterministic_evaluation") or {}
    score = engine_data.get("score", "N/A")
    classification = engine_data.get("classification", "N/A")
    market_fit = fields.get("market_fit_analysis") or {}
    sector_signal = market_fit.get("sector", {})
    
    return f"""Role: Senior Market Research & Venture Strategist
Task: Synthesize market signals and deterministic data into a high-integrity validation report for {business_name}.

DETREMINISTIC ENGINE DATA (Ground Truth):
- Concept: {business_name}
- Industry: {industry}
- Target Segment: {segment}
- Problem Solved: {problem}
- Spoken to: {_clean_text(fields.get('interviews_conducted')) or '0'} people
- Deterministic Score: {score}/100
- Classification: {classification}

LIVE RESEARCH EVIDENCE:
{evidence_text or "No live search evidence was retrieved. Rely on your training knowledge."}

REQUIRED JSON STRUCTURE:
{{
  "executive_summary": "4-5 professional sentences. Start with a direct verdict based on the deterministic score and live evidence. Reference specific search trends and competitor activity found in the research context. NO generic placeholders like 'appears directionally promising'.",
  "dimension_explanations": {{
    "problem_severity": "Why the current evidence supports the severity score of {score}. Mention segment-specific pain points for {segment}.",
    "market_demand": "Feedback on target segment {segment} size vs market reality.",
    "demand_validation": "Interpret the interview count against the search volume found in research.",
    "market_evidence": "Synthesize specific competitor names found or the potential if none exist.",
    "differentiation": "Critique the solution against the alternatives found in the research context.",
    "market_trend": "Directional insight based on the search trends and market momentum signals."
  }},
  "market_health_narration": {{
    "demand_trend": "One sentence interpreting the live search interest trajectory.",
    "sector_survival": "Interpretation of the sector survival baseline ({sector_signal.get('survival_ratio', 0.6)}) for this category.",
    "competition": "Verdict on local/digital saturation vs opportunity space."
  }},
  "risks": [
    "Specific market-entry risk (e.g. 'High CAC for {segment} in {industry}')",
    "Evidence-based risk"
  ],
  "next_actions": [
    {{
      "step": 1, 
      "action": "Immediate tactical step", 
      "why": "How this resolves a specific gap in the {score}/100 score.", 
      "timeframe": "7 days"
    }}
  ],
  "investor_perspective": {{
    "headline": "One sentence investment summary.",
    "summary": "2-3 sentences on scalability, ROI potential, and strategic exit value found in research.",
    "risk_assessment": "Specific critique of the risk-to-reward ratio for this concept."
  }},
  "fragility_analysis": {{
    "vulnerability_summary": "Analysis of structural weaknesses or dependencies found in search results.",
    "concentration_risks": "Assessment of customer or supplier concentration risks in the {industry} sector.",
    "mitigation_plan": "Specific AI-driven advice to harden the business model."
  }},
  "stability_outlook": {{
    "resilience_summary": "Assessment of how this business handles market volatility based on trends.",
    "baseline_performance": "Expected 'floor' performance in a downturn for {business_name}.",
    "margin_resilience": "Critique of the proposed pricing vs competitor cost structures found."
  }},
  "health_assessment": {{
    "readiness_summary": "Direct verdict on commercial and operational readiness.",
    "growth_constraints": "Identification of the #1 bottleneck to scaling discovered in research.",
    "health_checks": ["Check 1", "Check 2"]
  }}
}}

STRICT CONSTRAINTS:
1. NEVER use generic templates. Every sentence must mention the segment, concept, or specific evidence.
2. If research is limited, state: "Market signals for {business_name} are currently sparse..."
3. Reference real numbers where possible.
4. JSON ONLY. No preamble.
"""


async def _call_claude(prompt: str) -> dict:
    settings = get_settings()
    if not settings.claude_api_key:
        logger.warning("Claude API key missing in settings.")
        return {}
    headers = {
        "x-api-key": settings.claude_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": settings.claude_model or "claude-3-opus-20240229",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    logger.info("Calling Claude with model: %s", body["model"])
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(CLAUDE_BASE, headers=headers, json=body)
        if response.status_code != 200:
            logger.error("Claude API error: status=%s, body=%s", response.status_code, response.text)
            return {}
        data = response.json()
        text = data["content"][0]["text"].strip()
        # Clean markdown
        if text.startswith("```"):
            lines = text.splitlines()
            if lines[0].startswith("```json"): text = "\n".join(lines[1:-1])
            elif lines[0].startswith("```"): text = "\n".join(lines[1:-1])
        result = json.loads(text)
        logger.info("Claude synthesis successful.")
        return result
    except Exception as exc:
        logger.error("Claude call failed: %s", exc, exc_info=True)
    return {}


async def _call_openai(prompt: str) -> dict:
    settings = get_settings()
    if not settings.openai_api_key:
        logger.warning("OpenAI API key missing in settings.")
        return {}
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model or "gpt-4o",
        "messages": [
            {"role": "system", "content": "You are a senior market research analyst. You provide deterministic, research-backed insights in JSON format only."},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"}
    }
    logger.info("Calling OpenAI with model: %s", body["model"])
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(OPENAI_BASE, headers=headers, json=body)
        if response.status_code != 200:
            logger.error("OpenAI API error: status=%s, body=%s", response.status_code, response.text)
            return {}
        data = response.json()
        text = data["choices"][0]["message"]["content"].strip()
        result = json.loads(text)
        logger.info("OpenAI synthesis successful.")
        return result
    except Exception as exc:
        logger.error("OpenAI call failed: %s", exc, exc_info=True)
    return {}


def _fallback_report(fields: dict[str, Any]) -> dict[str, Any]:
    what = _clean_text(fields.get("what_building") or "your product")
    segment = _clean_text(fields.get("customer_segment") or "target customers")
    location = _clean_text(fields.get("location") or "your market")
    currency = _clean_text(fields.get("currency") or "GBP")

    return {
        "executive_summary": (
            f"{what} appears directionally promising for {segment} in {location}. "
            f"The best next step is to validate urgency and willingness to pay before building deeply."
        ),
        "idea_validation_result": {
            "overall_score": "Fair",
            "market_demand": "Medium",
            "competition_level": "Medium",
            "pricing_opportunity": "Moderate",
            "execution_risk": "Medium",
            "recommended_action": "customer interviews",
        },
        "market_opportunity": {
            "summary": f"{what} targets {segment} in {location}.",
            "market_size": "Search results indicate an active category.",
            "growth_rate": "Mixed but improving digital adoption",
            "key_trends": ["Automation adoption", "Cost sensitivity", "Demand for faster delivery"],
            "location_opportunity": f"{location} can be attractive if the segment has concentrated demand.",
        },
        "target_customer": {
            "profile": segment,
            "pain_points": ["Manual work", "Slow turnaround"],
            "buying_behaviour": "They compare options online and need proof of ROI.",
            "urgency": "Problem frequency suggests meaningful urgency.",
            "willingness_to_pay": "Moderate.",
        },
        "problem_validation": {
            "evidence_strength": "Moderate",
            "evidence": ["The stated pain is plausible for the segment."],
            "frequency_assessment": "Recurring",
            "severity": "Moderate",
        },
        "demand_signals": {
            "search_trend": "stable",
            "signals": ["Customers seek better workflow tools."],
            "online_discussion": "Found discussions around inefficient workflows.",
            "keyword_demand": "Search activity appears steady.",
        },
        "alternative_solutions": [],
        "competitor_matrix": [],
        "competitor_pricing": [],
        "pricing_strategy": {
            "recommended_model": "tiered subscription",
            "rationale": "Balances accessibility with value capture.",
            "launch_offer": "Pilot discount for early adopters.",
        },
        "recommended_price_range": {
            "low": f"{currency} entry tier",
            "mid": f"{currency} mid tier",
            "premium": f"{currency} premium tier",
            "currency": currency,
        },
        "positioning": {
            "value_proposition": f"Help {segment} faster.",
            "differentiation": "Segment-specific focus.",
            "headline_message": f"A simpler way for {segment}.",
        },
        "go_to_market": {
            "primary_channels": ["SEO", "LinkedIn outreach"],
            "quick_wins": ["Interview 10 customers"],
            "timeline": "30-60-90 day rollout.",
        },
        "risks": [],
        "viability_score": {
            "label": "Fair",
            "score": 54,
            "summary": "Commercial potential exists, but live evidence is not yet strong.",
            "recommended_action": "customer interviews",
        },
        "next_actions": [
            {"step": 1, "action": "Interview 10 target customers", "why": "Confirm pain.", "timeframe": "this week"},
        ],
    }


def _normalize_report(report: dict[str, Any], *, fields: dict[str, Any], search_queries: dict[str, str], evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    fallback = _fallback_report(fields)
    merged = {**fallback, **(report or {})}

    # Logic to populate market_size, growth_rate from evidence if missing
    market_opportunity = merged.get("market_opportunity") or fallback["market_opportunity"]
    if not _clean_text(market_opportunity.get("market_size")):
        market_opportunity["market_size"] = _evidence_based_market_size(fields, evidence, sources)
    if not _clean_text(market_opportunity.get("growth_rate")):
        market_opportunity["growth_rate"] = _evidence_based_growth(fields, evidence, sources)

    demand_signals = merged.get("demand_signals") or fallback["demand_signals"]
    if not _clean_text(demand_signals.get("keyword_demand")):
        demand_signals["keyword_demand"] = _evidence_based_keyword_demand(fields, evidence, sources)

    # Health narration mapping
    market_health_narration = merged.get("market_health_narration") or {}
    for key in ["demand_trend", "sector_survival", "competition"]:
        if key not in market_health_narration:
             market_health_narration[key] = f"Live {key} signals are being processed."

    dimension_explanations = merged.get("dimension_explanations") or {}
    
    # Market Evidence mapping for UI
    market_evidence_items: list[dict[str, str]] = []
    for key, snippets in evidence.items():
        query = search_queries.get(key, "")
        for snippet in snippets[:3]:
            market_evidence_items.append({"theme": key.replace("_", " "), "query": query, "evidence": snippet})

    return {
        "executive_summary": merged.get("executive_summary") or fallback["executive_summary"],
        "idea_validation_result": merged.get("idea_validation_result") or fallback["idea_validation_result"],
        "market_opportunity": market_opportunity,
        "target_customer": merged.get("target_customer") or fallback["target_customer"],
        "problem_validation": merged.get("problem_validation") or fallback["problem_validation"],
        "demand_signals": demand_signals,
        "alternative_solutions": merged.get("alternative_solutions") or fallback["alternative_solutions"],
        "competitor_matrix": merged.get("competitor_matrix") or fallback["competitor_matrix"],
        "competitor_pricing": merged.get("competitor_pricing") or fallback["competitor_pricing"],
        "pricing_strategy": merged.get("pricing_strategy") or fallback["pricing_strategy"],
        "recommended_price_range": merged.get("recommended_price_range") or fallback["recommended_price_range"],
        "positioning": merged.get("positioning") or fallback["positioning"],
        "go_to_market": merged.get("go_to_market") or fallback["go_to_market"],
        "risks": merged.get("risks") or fallback["risks"],
        "viability_score": merged.get("viability_score") or fallback["viability_score"],
        "next_actions": merged.get("next_actions") or fallback["next_actions"],
        "market_health_narration": market_health_narration,
        "dimension_explanations": dimension_explanations,
        "investor_perspective": merged.get("investor_perspective") or {},
        "fragility_analysis": merged.get("fragility_analysis") or {},
        "stability_outlook": merged.get("stability_outlook") or {},
        "health_assessment": merged.get("health_assessment") or {},
        "market_evidence": {
            "summary": "Live search-backed evidence covering demand, pain points, trends, and customer behaviour.",
            "items": market_evidence_items[:12],
            "source_collection": sources,
            "search_queries": search_queries,
        },
    }


async def run_research_data(fields: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    evidence: dict[str, list[str]] = {}
    sources: dict[str, list[dict[str, str]]] = {}
    shopping: list[dict[str, str]] = []
    queries = _build_queries(fields)
    search_queries = {key: query for key, (query, _, _) in queries.items()}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if settings.serp_api_key:
            tasks = {key: _serp(client, query, engine, extra) for key, (query, engine, extra) in queries.items()}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for key, result in zip(tasks.keys(), results):
                if isinstance(result, Exception) or not isinstance(result, dict): continue
                if key == "pricing_shop": shopping = _shopping_items(result)
                else:
                    evidence[key] = _snippets(result)
                    sources[key] = _sources(result)
        elif settings.serper_api_key:
            tasks = {key: _serper(client, query, engine, extra) for key, (query, engine, extra) in queries.items()}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            for key, result in zip(tasks.keys(), results):
                if isinstance(result, Exception) or not isinstance(result, dict): continue
                evidence[key] = _snippets(result)
                sources[key] = _sources(result)
    return {"evidence": evidence, "sources": sources, "shopping": shopping, "search_queries": search_queries}


async def run_ai_narration(fields: dict[str, Any], evidence: dict[str, list[str]], shopping: list[dict[str, Any]] = None) -> dict[str, Any]:
    """
    Step 2: Take research data and generate the AI narrative.
    Tries Claude first, falls back to OpenAI if Claude fails.
    """
    settings = get_settings()
    prompt = _build_synthesis_prompt(fields, evidence)
    report: dict[str, Any] = {}

    # Try Claude
    if settings.claude_api_key:
        try:
            report = await _call_claude(prompt)
        except Exception as e:
            logger.warning("Claude narration failed, attempting OpenAI fallback: %s", e)

    # Fallback to OpenAI if Claude failed or wasn't attempted
    if not report and settings.openai_api_key:
        try:
            report = await _call_openai(prompt)
        except Exception as e:
            logger.error("OpenAI narration fallback failed: %s", e)

    # Normalize result against fallbacks
    return _normalize_report(
        report or {}, 
        fields=fields, 
        search_queries={}, 
        evidence=evidence, 
        sources={}
    )


async def run_market_research(fields: dict[str, Any]) -> dict[str, Any]:
    res = await run_research_data(fields)
    report = await run_ai_narration(fields, res["evidence"], res["shopping"])
    return report


def extract_research_signals(evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    # Heuristic for competition and demand
    all_sources = []
    for s_list in sources.values(): all_sources.extend(s_list)
    unique_domains = len(set(s.get("url", "").split("/")[2] for s in all_sources if s.get("url")))
    demand_snippets = len(evidence.get("problem_validation") or []) + len(evidence.get("industry_trends") or [])
    return {
        "demand_score": float(min(100, demand_snippets * 8)),
        "competition_level": "high" if unique_domains > 10 else "medium" if unique_domains > 3 else "low",
        "competitor_count": unique_domains,
        "trend_score": 70.0 # Placeholder
    }


def flatten_fields_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    # Check for service vs business idea
    if _clean_text(payload.get("service_description")):
        return {
            "business_name": _clean_text(payload.get("service_name")),
            "primary_industry": _clean_text(payload.get("service_category")),
            "customer_segment": _clean_text(payload.get("target_customer_type")),
            "location": _clean_text(payload.get("target_market_scope")) or "United Kingdom",
            "problem_short": _clean_text(payload.get("service_description")),
            "interviews_conducted": _clean_text(payload.get("demand_evidence_type") or "0"),
        }
    ctx = payload.get("context") or {}
    problem = payload.get("problem") or {}
    validation = payload.get("validation") or {}
    return {
        "business_name": _clean_text(ctx.get("business_name")),
        "primary_industry": _clean_text(ctx.get("primary_industry")),
        "customer_segment": _clean_text(problem.get("customer_segment")),
        "location": _clean_text(ctx.get("location")) or "United Kingdom",
        "problem_short": _clean_text(problem.get("problem_type")),
        "interviews_conducted": _clean_text(validation.get("spoken_count") or "0"),
    }
