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
OPENAI_BASE = "https://api.openai.com/v1/responses"
CLAUDE_BASE = "https://api.anthropic.com/v1/messages"
TIMEOUT = 20.0


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
    business_type = _clean_text(fields.get("business_type"))
    location = _clean_text(fields.get("location") or "United Kingdom")
    segment = _clean_text(fields.get("customer_segment") or "customers")
    problem = _clean_text(fields.get("problem_short"))
    frequency = _clean_text(fields.get("frequency"))
    alternatives = _clean_text(fields.get("alternatives"))
    currency = _clean_text(fields.get("currency") or "GBP")

    category = " ".join(part for part in [what, industry or business_type] if part).strip()
    category = category or what or "business software"
    audience = f"{segment} {location}".strip()
    location_suffix = f" in {location}" if location else ""
    frequency_hint = f" {frequency}" if frequency else ""

    return {
        "market_opportunity": (f"{category} market size demand growth trends{location_suffix}", "google", {}),
        "industry_trends": (f"{category} industry trends adoption growth{location_suffix}", "google", {}),
        "target_customer": (f"{segment} pain points buying behaviour for {category}{location_suffix}", "google", {}),
        "problem_validation": (f"{problem or category} complaints pain points frequency {audience}{frequency_hint}", "google", {}),
        "demand_signals": (f"{problem or category} search trends forums reddit reviews {audience}", "google", {}),
        "alternatives": (f"{alternatives or problem or category} alternatives spreadsheet agency freelancer software", "google", {}),
        "competitors": (f"top {category} competitors pricing alternatives{location_suffix}", "google", {}),
        "pricing": (f"{category} pricing plans monthly annual free trial {currency}", "google", {}),
        "pricing_shop": (f"{category} price {currency}", "google_shopping", {}),
        "go_to_market": (f"best channels to market {category} to {segment}{location_suffix}", "google", {}),
        "risks": (f"{category} adoption barriers regulation switching cost price sensitivity{location_suffix}", "google", {}),
        "news": (f"{category} market news 2025 2026{location_suffix}", "google_news", {}),
    }


# LLM synthesis
def _build_synthesis_prompt(fields: dict[str, Any], evidence: dict[str, list[str]]) -> str:
    idea_type = _clean_text(fields.get("idea_type") or "business_idea")
    is_service = idea_type == "service_idea"

    business_idea_name = _clean_text(fields.get("business_idea_name"))
    business_name = _clean_text(fields.get("business_name"))
    what = _clean_text(fields.get("what_building"))
    industry = _clean_text(fields.get("primary_industry"))
    location = _clean_text(fields.get("location") or "United Kingdom")
    segment = _clean_text(fields.get("customer_segment"))
    problem = _clean_text(fields.get("problem_short"))
    frequency = _clean_text(fields.get("frequency"))
    alternatives = _clean_text(fields.get("alternatives"))
    business_type = _clean_text(fields.get("business_type"))
    currency = _clean_text(fields.get("currency") or "GBP")
    price = _clean_text(fields.get("price_per_unit"))
    expected_customers = _clean_text(fields.get("expected_customers"))
    expected_units = _clean_text(fields.get("expected_units_per_month"))
    competitor_price_range = _clean_text(fields.get("competitor_price_range"))
    delivery_capacity = _clean_text(fields.get("delivery_capacity"))

    evidence_text = ""
    for key, snippets in evidence.items():
        if snippets:
            evidence_text += f"\n### {key.upper().replace('_', ' ')}\n" + "\n".join(f"- {snippet}" for snippet in snippets)

    if is_service:
        idea_details = f"""SERVICE / PRODUCT OFFERING DETAILS
- Service / product name: {business_idea_name or what or "Untitled offering"}
- Service category: {business_type or industry or "Not provided"}
- Service description: {problem or "Not provided"}
- Target customer type: {segment or "Not provided"}
- Market scope / location: {location}
- Currency: {currency}
- Demand evidence: {frequency or "Not provided"}
- Differentiation vs alternatives: {alternatives or "Not provided"}
- Competitor price range: {competitor_price_range or "Unknown"}
- Current intended price per sale: {currency} {price or "Unknown"}
- Expected paying customers: {expected_customers or "Unknown"}
- Expected sales per month: {expected_units or "Unknown"}
- Delivery capacity: {delivery_capacity or "Not provided"}"""
        pathway_note = (
            "This is a SERVICE / PRODUCT IDEA — the founder already has a specific offering in mind. "
            "Focus on market demand for this specific service, pricing intelligence for comparable services, "
            "how they can win customers away from incumbents, and whether their delivery capacity can meet demand. "
            "Avoid framing insights as if this is a startup building software unless that is explicitly the case."
        )
    else:
        idea_details = f"""BUSINESS IDEA DETAILS
- Idea label: {business_idea_name or business_name or what or "Untitled idea"}
- Business name: {business_name or "Not provided"}
- What are you building: {what or "Not provided"}
- Business type: {business_type or "Not provided"}
- Primary industry: {industry or "Not provided"}
- Location: {location}
- Currency: {currency}
- Target customer segment: {segment or "Not provided"}
- Core problem being solved: {problem or "Not provided"}
- Problem frequency: {frequency or "Not provided"}
- Alternatives currently used: {alternatives or "Not provided"}
- Current intended price: {currency} {price or "Unknown"}
- Expected customers: {expected_customers or "Unknown"}
- Expected units per month: {expected_units or "Unknown"}"""
        pathway_note = (
            "This is a BUSINESS IDEA — the founder is validating whether a market opportunity exists for a new venture. "
            "Focus on problem severity, market size, competitive landscape, and whether there is a viable path to first revenue. "
            "Next actions should be founder-oriented: interviews, landing pages, MVP scoping, and early sales tests."
        )

    return f"""You are a senior commercial analyst writing a private intelligence briefing for a founder.

Your job is to produce the sharpest, most grounded market insight report possible — not a generic template.
Every sentence must add information the founder cannot find by Googling "is my idea good."

REASONING CHAIN: User Fields → Search Evidence → Pattern Recognition → Specific Conclusions → Scored Verdict → Executable Actions

PATHWAY NOTE: {pathway_note}

{idea_details}

LIVE SEARCH EVIDENCE
{evidence_text or "No live search evidence was retrieved. Rely on your training knowledge, clearly distinguish what is known vs inferred, and flag where the founder needs to do primary research."}

QUALITY RULES — READ THESE BEFORE WRITING A SINGLE WORD
1. NAME REAL THINGS. Name actual competitors, actual platforms, actual trade publications. Never write "Generic SaaS tool" or "Specialist niche vendor" as a competitor — those are category labels, not insights.
2. QUOTE THE EVIDENCE. Where a search snippet supports a claim, weave it in or paraphrase it. If evidence contradicts the founder's assumptions, say so directly.
3. GIVE ACTUAL NUMBERS. Market size: give a figure with a source signal (e.g. "£2.4bn UK market per IBISWorld estimates from search results"). Growth rate: give a percentage or trend descriptor grounded in evidence. Pricing: give real ranges like "£300–£900/month" not "mid-tier pricing."
4. MAKE JUDGEMENTS. Do not hedge every statement. Pick a side: "This segment is over-served at the low end, creating a gap for a premium specialist." "The founder's intended price of {price or 'N/A'} is below market — competitors charge 2× this and still win customers."
5. CONNECT TO THE FOUNDER'S INPUTS. Every major section must reference at least one field from the idea details above. Generic advice that could apply to any business is a failure.
6. SURFACE REAL RISKS. Identify the single biggest commercial threat (not "competition exists"). E.g. "The top 3 search results are dominated by VC-backed platforms with free tiers — price competition will be brutal in the first 12 months."
7. MAKE NEXT ACTIONS SPECIFIC AND TIMED. Not "interview customers" — "Interview 8 {segment or "target customers"} in {location or "the target market"} using a 5-question problem-severity script on Calendly; aim to complete within 10 days."
8. ANTI-PATTERNS TO AVOID — never write these phrases:
   - "Automation adoption", "Cost sensitivity", "Demand for faster delivery" (lazy trend labels)
   - "Varies" or "Unknown" as a price range when evidence exists
   - "the founder should do more research" without specifying exactly what research and where
   - "You should lower your price", "Reduce your costs per unit", "Improve your margins" (prohibited financial advice)

RETURN EXACTLY THIS JSON SHAPE — fill every field with sharp, specific content:
{{
  "executive_summary": "3-6 sentences. State the commercial opportunity with a sharp, specific angle: what the market signal says, where the pricing sits vs competition, and a clear verdict (go / go with caveats / stop and rethink). Use subtle bolding for emphasis on key findings. Vary your sentence structure—do not follow a fixed template. Focus on the 'why' behind the verdict. DO NOT GIVE FINANCIAL ADVICE.",
  "idea_validation_result": {{
    "overall_score": "Very Strong / Strong / Fair / Weak",
    "market_demand": "High / Medium / Low",
    "competition_level": "High / Medium / Low",
    "pricing_opportunity": "Strong / Moderate / Weak",
    "execution_risk": "High / Medium / Low",
    "recommended_action": "One specific action: e.g. 'Run a 2-week landing page test targeting [segment] on LinkedIn before building anything'"
  }},
  "market_opportunity": {{
    "summary": "Specific market size, category growth, and why this moment is or isn't a good entry window. Reference evidence snippets.",
    "market_size": "Concrete figure or range with source signal, e.g. '£1.8bn UK HR tech market (Statista 2024 per search results)'",
    "growth_rate": "Specific percentage or descriptor backed by evidence, e.g. '11% CAGR driven by hybrid work adoption'",
    "key_trends": ["Specific trend backed by search evidence", "Second trend with evidence signal", "Third trend that directly affects this idea"],
    "location_opportunity": "Why {location or 'this market'} specifically helps or hurts this idea — concentration of target customers, regulatory environment, competitor density"
  }},
  "target_customer": {{
    "profile": "Precise description: company size, role of buyer, annual revenue band, tech maturity, pain trigger that makes them search for a solution",
    "pain_points": ["Specific pain with consequence, e.g. 'Manual reconciliation takes 3–4 hours/week and causes end-of-month reporting delays'", "Second specific pain", "Third specific pain"],
    "buying_behaviour": "How this segment actually buys: procurement cycle, who signs off, typical evaluation criteria, trial vs demo preference",
    "urgency": "What forces the decision now vs next quarter — regulatory deadline, growth pressure, staff cost, compliance risk",
    "willingness_to_pay": "Specific range backed by evidence, e.g. 'Evidence suggests £200–£500/month is the accepted range for this segment; above £600 requires a proven ROI case'"
  }},
  "problem_validation": {{
    "evidence_strength": "Strong / Moderate / Weak",
    "evidence": ["Direct quote or paraphrase from search evidence proving the problem exists", "Second evidence point — forum complaint, review, news item, or data point"],
    "frequency_assessment": "How often this pain surfaces and what it costs when it does — time, money, or risk",
    "severity": "Is this a 'nice to fix' problem or a 'must fix' problem? What happens if the customer does nothing?"
  }},
  "demand_signals": {{
    "search_trend": "rising / stable / declining",
    "signals": ["Specific signal from evidence, e.g. 'Reddit r/smallbusiness has 47 threads in the last 6 months about this exact pain'", "Second signal with source", "Third signal"],
    "online_discussion": "Where customers are talking about this problem and what they're saying — name the platforms and the tone",
    "keyword_demand": "Specific keyword insight: e.g. 'Search volume for [related term] is high and rising; top results are dominated by US tools with no UK-local option'"
  }},
  "alternative_solutions": [
    {{"name": "Real named solution the target customer actually uses today", "type": "manual / software / agency / freelancer / competitor", "weakness": "Specific reason this falls short for the described segment — not 'too generic' but e.g. 'No API integration with Xero, which 60% of UK SMEs use'"}}
  ],
  "competitor_matrix": [
    {{"name": "Real named competitor", "positioning": "Their actual market angle and who they target", "strengths": ["Specific strength grounded in evidence"], "weaknesses": ["Specific weakness the founder can exploit"], "est_price": "Actual price from search evidence or best estimate with note"}}
  ],
  "competitor_pricing": [
    {{"competitor": "Real named competitor", "model": "subscription / one-off / usage / hybrid", "price_range": "Specific range e.g. '£199–£499/month'", "free_plan": true, "notes": "What you get at each tier and where the upsell triggers are"}}
  ],
  "pricing_strategy": {{
    "recommended_model": "subscription / usage-based / freemium / one-off / tiered / commission / hybrid",
    "rationale": "Why this model fits this specific segment's buying behaviour and the competitive landscape — not just 'it matches recurring revenue needs'",
    "launch_offer": "Specific launch tactic with numbers: e.g. 'Offer first 10 customers a 6-month pilot at 40% off in exchange for a case study and referral'"
  }},
  "recommended_price_range": {{
    "low": "Specific entry price with justification",
    "mid": "Specific mid-market price with justification",
    "premium": "Specific premium price with justification",
    "currency": "{currency}",
    "notes": "Explain the spread: what earns each tier, how it compares to competitors, and where the founder's intended price sits"
  }},
  "positioning": {{
    "value_proposition": "One sentence that names the customer, the problem, and the measurable outcome — not a category description",
    "differentiation": "Specific wedge vs the named competitors above — what this idea can do that they structurally cannot",
    "headline_message": "One punchy line a target customer would forward to a colleague"
  }},
  "go_to_market": {{
    "primary_channels": ["Channel with specific tactic, e.g. 'LinkedIn outreach targeting Finance Directors at UK SMEs using Sales Navigator'", "Second channel with tactic", "Third channel with tactic"],
    "quick_wins": ["Specific win achievable in under 2 weeks, e.g. 'Post in 3 UK small business Facebook groups with a problem-survey link'", "Second quick win with concrete action"],
    "timeline": "Days 1–30: [specific milestone]. Days 31–60: [specific milestone]. Days 61–90: [specific milestone with a revenue or lead target]"
  }},
  "risks": [
    {{"risk": "Specific risk with named cause, e.g. 'Xero and QuickBooks are adding native features that overlap with this idea — 2 product updates in the last 18 months'", "severity": "High / Medium / Low", "mitigation": "Specific mitigation: e.g. 'Focus on the workflow integration layer these platforms won't build; validate this gap with 10 customer calls before month 2'"}}
  ],
  "viability_score": {{
    "label": "Very Strong / Strong / Fair / Weak",
    "score": 0,
    "market_demand": "High / Medium / Low",
    "competition_level": "High / Medium / Low",
    "pricing_opportunity": "Strong / Moderate / Weak",
    "execution_risk": "High / Medium / Low",
    "summary": "2 sentences that explain the score: what drove it up, what held it back. Be direct — no 'this idea has potential if executed well' non-answers.",
    "recommended_action": "The single most important thing the founder should do in the next 7 days, named specifically"
  }},
  "next_actions": [
    {{"step": 1, "action": "Specific action with named platform, tool, or person type", "why": "The exact risk or opportunity this action resolves — tied to evidence above", "timeframe": "Specific deadline, e.g. 'Complete by day 7'"}}
  ]
}}

CONSTRAINTS
- viability_score.score must be an integer from 0 to 100.
- competitor_matrix must contain 3 to 6 entries — all named real companies or tools, not category labels.
- competitor_pricing must contain 3 to 6 entries with specific price ranges.
- risks must contain 3 to 5 entries — each risk must name a specific cause.
- next_actions must contain exactly 5 entries — each must be completable in under 30 days.
- executive_summary must be 3–4 sentences, direct, and verdict-first.
- Do not write any field using generic placeholder language. Every sentence must be specific to the idea, segment, and location above.
"""


async def _call_claude(prompt: str) -> dict:
    settings = get_settings()
    if not settings.claude_api_key:
        return {}
    headers = {
        "x-api-key": settings.claude_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": settings.claude_model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(CLAUDE_BASE, headers=headers, json=body)
        if response.status_code == 200:
            data = response.json()
            text = data["content"][0]["text"].strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.warning("Claude returned non-JSON: %s", exc)
    except Exception as exc:
        logger.warning("Claude synthesis error: %s", exc)
    return {}


async def _call_openai(prompt: str) -> dict:
    settings = get_settings()
    if not settings.openai_api_key:
        return {}
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.openai_model,
        "max_output_tokens": 4096,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": "You are a market research analyst. Return only valid JSON."}]},
            {"role": "user", "content": [{"type": "input_text", "text": prompt}]},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(OPENAI_BASE, headers=headers, json=body)
        if response.status_code == 200:
            data = response.json()
            text = ""
            if isinstance(data, dict):
                if isinstance(data.get("output_text"), str):
                    text = data["output_text"].strip()
                elif isinstance(data.get("output"), list):
                    chunks: list[str] = []
                    for item in data["output"]:
                        if not isinstance(item, dict):
                            continue
                        for content in item.get("content", []) if isinstance(item.get("content"), list) else []:
                            if isinstance(content, dict) and content.get("type") in ("output_text", "text"):
                                value = content.get("text") or content.get("value")
                                if isinstance(value, str):
                                    chunks.append(value)
                    text = "\n".join(chunk for chunk in chunks if chunk).strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.warning("OpenAI returned non-JSON: %s", exc)
    except Exception as exc:
        logger.warning("OpenAI synthesis error: %s", exc)
    return {}


def _fallback_report(fields: dict[str, Any]) -> dict[str, Any]:
    what = _clean_text(fields.get("what_building") or "your product")
    segment = _clean_text(fields.get("customer_segment") or "target customers")
    location = _clean_text(fields.get("location") or "your market")
    currency = _clean_text(fields.get("currency") or "GBP")
    problem = _clean_text(fields.get("problem_short") or "solve a painful workflow")
    frequency = _clean_text(fields.get("frequency") or "recurring")

    return {
        "executive_summary": (
            f"{what} appears directionally promising for {segment}, but the opportunity still needs stronger live proof. "
            f"The best next step is to validate urgency and willingness to pay in {location} before building deeply."
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
            "summary": f"{what} targets {segment} in {location}, where demand may benefit from ongoing digitisation and workflow improvement needs.",
            "market_size": f"Search results indicate an active category for {segment} in {location}.",
            "growth_rate": "Mixed but improving digital adoption",
            "key_trends": ["Automation adoption", "Cost sensitivity", "Demand for faster delivery"],
            "location_opportunity": f"{location} can be attractive if the segment has concentrated demand and existing solutions are weak.",
        },
        "target_customer": {
            "profile": segment,
            "pain_points": ["Manual work", "Slow turnaround", "Limited visibility or control"],
            "buying_behaviour": "They compare options online, ask for referrals, and need proof of ROI before switching.",
            "urgency": f"{frequency.capitalize()} problem frequency suggests meaningful urgency if the pain is tied to revenue, time, or compliance.",
            "willingness_to_pay": "Moderate if the offer clearly saves time or reduces risk.",
        },
        "problem_validation": {
            "evidence_strength": "Moderate",
            "evidence": ["The stated pain is plausible for the segment.", "The problem appears recurring rather than one-off."],
            "frequency_assessment": f"The problem appears {frequency.lower()} for the chosen customer segment.",
            "severity": "Moderate to high if it affects revenue, service speed, or operational reliability.",
        },
        "demand_signals": {
            "search_trend": "stable",
            "signals": ["Customers often seek better workflow tools.", "Alternative solutions suggest an existing need.", "Digital-first buying behaviour supports discoverability."],
            "online_discussion": "Expect to find discussions around inefficient workflows, pricing frustration, and tools that are too generic.",
            "keyword_demand": "Search activity appears strong enough to justify deeper testing, even where exact public keyword volumes are limited.",
        },
        "alternative_solutions": [
            {"name": "Spreadsheets and manual work", "type": "manual", "weakness": "Cheap, but error-prone and hard to scale."},
            {"name": "Freelancers or agencies", "type": "agency", "weakness": "Can solve the work, but consistency and margin control are weaker."},
            {"name": "Generic SaaS tools", "type": "software", "weakness": "Often broad, less tailored to the specific workflow or segment."},
        ],
        "competitor_matrix": [
            {"name": "Generic platform tools", "positioning": "Broad all-in-one option", "strengths": ["Brand familiarity", "Feature breadth"], "weaknesses": ["Less tailored", "Can feel bloated"], "est_price": "Varies"},
            {"name": "Specialist niche vendors", "positioning": "Focused point solution", "strengths": ["Better fit", "Clearer use case"], "weaknesses": ["Smaller brand trust", "May lack integrations"], "est_price": "Varies"},
            {"name": "DIY manual alternative", "positioning": "Lowest-cost substitute", "strengths": ["Free or cheap", "No switching effort"], "weaknesses": ["Slow", "High hidden labour cost"], "est_price": "Free to low cost"},
        ],
        "competitor_pricing": [
            {"competitor": "Generic platform tools", "model": "subscription", "price_range": f"{currency} low-mid monthly", "free_plan": True, "notes": "Often upsell for advanced features."},
            {"competitor": "Specialist niche vendors", "model": "tiered subscription", "price_range": f"{currency} mid monthly", "free_plan": False, "notes": "Better fit can support higher pricing."},
            {"competitor": "Manual or agency alternative", "model": "one-off / service fee", "price_range": f"{currency} variable", "free_plan": False, "notes": "Costs are often inconsistent and hard to forecast."},
        ],
        "pricing_strategy": {
            "recommended_model": "tiered subscription",
            "rationale": "A tiered recurring model balances accessibility for smaller customers with room to capture value from heavier users.",
            "launch_offer": "Offer a pilot discount or founder plan for early adopters in exchange for feedback and testimonials.",
        },
        "recommended_price_range": {
            "low": f"{currency} low entry tier",
            "mid": f"{currency} mid-market tier",
            "premium": f"{currency} premium tier",
            "currency": currency,
            "notes": "Use competitor pricing and interview-based willingness-to-pay testing to set exact numbers.",
        },
        "positioning": {
            "value_proposition": f"Help {segment} {problem} faster, with less manual effort and more predictable outcomes.",
            "differentiation": "Focus on the segment-specific workflow instead of acting like a generic platform.",
            "headline_message": f"A simpler way for {segment} to {problem}.",
        },
        "go_to_market": {
            "primary_channels": ["SEO", "LinkedIn outreach", "Partnerships"],
            "quick_wins": ["Interview 10 target customers", "Launch a focused landing page with one clear pain point"],
            "timeline": "Days 1-30: interviews and message testing. Days 31-60: landing page and waitlist. Days 61-90: pilot with early adopters.",
        },
        "risks": [
            {"risk": "Customers may not feel enough urgency to switch", "severity": "High", "mitigation": "Test problem intensity with interviews and landing-page conversion before building more."},
            {"risk": "Competitors may already anchor pricing", "severity": "Medium", "mitigation": "Position clearly around a narrower use case or faster ROI."},
            {"risk": "Manual alternatives may feel good enough", "severity": "Medium", "mitigation": "Show time savings, reduced errors, or revenue upside in the message."},
        ],
        "viability_score": {
            "label": "Fair",
            "score": 54,
            "market_demand": "Medium",
            "competition_level": "Medium",
            "pricing_opportunity": "Moderate",
            "execution_risk": "Medium",
            "summary": "The idea has commercial potential, but live evidence is not yet strong enough to call it a clear go. Validate urgency, pricing, and differentiation first.",
            "recommended_action": "customer interviews",
        },
        "next_actions": [
            {"step": 1, "action": "Interview 10 target customers", "why": "Confirm the pain is real, frequent, and worth paying to solve.", "timeframe": "this week"},
            {"step": 2, "action": "Map 5 real competitors and substitutes", "why": "Clarify how crowded the market is and where the gap exists.", "timeframe": "this week"},
            {"step": 3, "action": "Test a landing page with one strong promise", "why": "Measure real interest and message resonance before building.", "timeframe": "this month"},
            {"step": 4, "action": "Run a lightweight pricing test", "why": "Learn what entry point feels credible to the segment.", "timeframe": "this month"},
            {"step": 5, "action": "Define a narrow MVP", "why": "Reduce execution risk and focus on the highest-urgency workflow.", "timeframe": "this month"},
        ],
    }


def _normalize_report(report: dict[str, Any], *, fields: dict[str, Any], search_queries: dict[str, str], evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    fallback = _fallback_report(fields)
    merged = {**fallback, **(report or {})}

    market_opportunity = {**fallback["market_opportunity"], **(merged.get("market_opportunity") or {})}
    target_customer = {**fallback["target_customer"], **(merged.get("target_customer") or {})}
    problem_validation = {**fallback["problem_validation"], **(merged.get("problem_validation") or {})}
    demand_signals = {**fallback["demand_signals"], **(merged.get("demand_signals") or {})}
    pricing_strategy = {**fallback["pricing_strategy"], **(merged.get("pricing_strategy") or {})}
    recommended_price_range = {**fallback["recommended_price_range"], **(merged.get("recommended_price_range") or {})}
    positioning = {**fallback["positioning"], **(merged.get("positioning") or {})}
    go_to_market = {**fallback["go_to_market"], **(merged.get("go_to_market") or {})}
    viability_score = {**fallback["viability_score"], **(merged.get("viability_score") or {})}
    idea_validation_result = {**fallback["idea_validation_result"], **(merged.get("idea_validation_result") or {})}

    market_size_text = _clean_text(market_opportunity.get("market_size"))
    if not market_size_text or market_size_text.lower() in {"needs live research", "estimated market size if known", "unknown"}:
        market_opportunity["market_size"] = _evidence_based_market_size(fields, evidence, sources)

    growth_rate_text = _clean_text(market_opportunity.get("growth_rate"))
    if not growth_rate_text or growth_rate_text.lower() in {"growth indicator if known", "unknown"}:
        market_opportunity["growth_rate"] = _evidence_based_growth(fields, evidence, sources)

    keyword_demand_text = _clean_text(demand_signals.get("keyword_demand"))
    if not keyword_demand_text or "needs live search confirmation" in keyword_demand_text.lower():
        demand_signals["keyword_demand"] = _evidence_based_keyword_demand(fields, evidence, sources)

    market_opportunity["key_trends"] = _limit_list(
        _listify(market_opportunity.get("key_trends")),
        minimum=3,
        maximum=5,
        filler=fallback["market_opportunity"]["key_trends"],
    )
    target_customer["pain_points"] = _limit_list(
        _listify(target_customer.get("pain_points")),
        minimum=3,
        maximum=5,
        filler=fallback["target_customer"]["pain_points"],
    )
    demand_signals["signals"] = _limit_list(
        _listify(demand_signals.get("signals")),
        minimum=3,
        maximum=5,
        filler=fallback["demand_signals"]["signals"],
    )
    go_to_market["primary_channels"] = _limit_list(
        _listify(go_to_market.get("primary_channels")),
        minimum=3,
        maximum=5,
        filler=fallback["go_to_market"]["primary_channels"],
    )
    go_to_market["quick_wins"] = _limit_list(
        _listify(go_to_market.get("quick_wins")),
        minimum=2,
        maximum=4,
        filler=fallback["go_to_market"]["quick_wins"],
    )

    competitor_matrix = _limit_objects(
        merged.get("competitor_matrix") if isinstance(merged.get("competitor_matrix"), list) else [],
        minimum=3,
        maximum=6,
        filler=fallback["competitor_matrix"],
    )
    for entry in competitor_matrix:
        entry["name"] = _clean_text(entry.get("name")) or "Unnamed competitor"
        entry["positioning"] = _clean_text(entry.get("positioning")) or "General market alternative"
        strengths = entry.get("strengths")
        weaknesses = entry.get("weaknesses")
        entry["strengths"] = _limit_list(_listify(strengths), minimum=1, maximum=4, filler=["Recognisable offer"])
        entry["weaknesses"] = _limit_list(_listify(weaknesses), minimum=1, maximum=4, filler=["Less tailored to the niche"])
        entry["est_price"] = _clean_text(entry.get("est_price")) or "Unknown"

    competitor_pricing = _limit_objects(
        merged.get("competitor_pricing") if isinstance(merged.get("competitor_pricing"), list) else [],
        minimum=3,
        maximum=6,
        filler=fallback["competitor_pricing"],
    )
    for entry in competitor_pricing:
        entry["competitor"] = _clean_text(entry.get("competitor")) or "Unnamed competitor"
        entry["model"] = _clean_text(entry.get("model")) or "subscription"
        entry["price_range"] = _clean_text(entry.get("price_range")) or "Unknown"
        entry["free_plan"] = bool(entry.get("free_plan"))
        entry["notes"] = _clean_text(entry.get("notes"))

    alternative_solutions = _limit_objects(
        merged.get("alternative_solutions") if isinstance(merged.get("alternative_solutions"), list) else [],
        minimum=3,
        maximum=6,
        filler=fallback["alternative_solutions"],
    )
    for entry in alternative_solutions:
        entry["name"] = _clean_text(entry.get("name")) or "Unnamed alternative"
        entry["type"] = _clean_text(entry.get("type")) or "alternative"
        entry["weakness"] = _clean_text(entry.get("weakness")) or "Unclear"

    risks = _limit_objects(
        merged.get("risks") if isinstance(merged.get("risks"), list) else [],
        minimum=3,
        maximum=5,
        filler=fallback["risks"],
    )
    for entry in risks:
        entry["risk"] = _clean_text(entry.get("risk")) or "Unspecified market risk"
        severity = _clean_text(entry.get("severity")) or "Medium"
        entry["severity"] = severity if severity in {"High", "Medium", "Low"} else "Medium"
        entry["mitigation"] = _clean_text(entry.get("mitigation")) or "Validate this risk directly with customers and market evidence."

    next_actions = _limit_objects(
        merged.get("next_actions") if isinstance(merged.get("next_actions"), list) else [],
        minimum=5,
        maximum=5,
        filler=fallback["next_actions"],
    )
    for index, entry in enumerate(next_actions, start=1):
        entry["step"] = index
        entry["action"] = _clean_text(entry.get("action")) or fallback["next_actions"][index - 1]["action"]
        entry["why"] = _clean_text(entry.get("why")) or fallback["next_actions"][index - 1]["why"]
        entry["timeframe"] = _clean_text(entry.get("timeframe")) or fallback["next_actions"][index - 1]["timeframe"]

    label = _clean_text(viability_score.get("label")) or _clean_text(idea_validation_result.get("overall_score")) or "Fair"
    if label not in {"Very Strong", "Strong", "Fair", "Weak"}:
        label = "Fair"
    score = viability_score.get("score")
    try:
        score = max(0, min(100, int(score)))
    except Exception:
        score = fallback["viability_score"]["score"]

    market_demand = _clean_text(viability_score.get("market_demand") or idea_validation_result.get("market_demand")) or "Medium"
    competition_level = _clean_text(viability_score.get("competition_level") or idea_validation_result.get("competition_level")) or "Medium"
    pricing_opportunity = _clean_text(viability_score.get("pricing_opportunity") or idea_validation_result.get("pricing_opportunity")) or "Moderate"
    execution_risk = _clean_text(viability_score.get("execution_risk") or idea_validation_result.get("execution_risk")) or "Medium"
    recommended_action = _clean_text(viability_score.get("recommended_action") or idea_validation_result.get("recommended_action")) or "customer interviews"

    viability_score.update(
        {
            "label": label,
            "score": score,
            "market_demand": market_demand,
            "competition_level": competition_level,
            "pricing_opportunity": pricing_opportunity,
            "execution_risk": execution_risk,
            "recommended_action": recommended_action,
            "summary": _clean_text(viability_score.get("summary")) or fallback["viability_score"]["summary"],
        }
    )
    idea_validation_result.update(
        {
            "overall_score": label,
            "market_demand": market_demand,
            "competition_level": competition_level,
            "pricing_opportunity": pricing_opportunity,
            "execution_risk": execution_risk,
            "recommended_action": recommended_action,
        }
    )

    executive_summary = _clean_text(merged.get("executive_summary")) or viability_score["summary"]

    market_evidence_items: list[dict[str, str]] = []
    for key, snippets in evidence.items():
        query = search_queries.get(key, "")
        for snippet in snippets[:3]:
            market_evidence_items.append({"theme": key.replace("_", " "), "query": query, "evidence": snippet})

    competitor_pricing_report = {
        "summary": (
            f"Competitive pricing for this category clusters around {recommended_price_range['low']} to {recommended_price_range['premium']} "
            f"where value, segment fit, and switching friction justify the spread."
        ),
        "competitor_matrix": competitor_matrix,
        "competitor_pricing": competitor_pricing,
    }

    return {
        "executive_summary": executive_summary,
        "idea_validation_result": idea_validation_result,
        "market_evidence": {
            "summary": "Live search-backed evidence covering demand, pain points, trends, and customer behaviour.",
            "items": market_evidence_items[:12],
            "source_collection": sources,
            "search_queries": search_queries,
        },
        "competitor_pricing_report": competitor_pricing_report,
        "suggested_pricing_strategy": pricing_strategy,
        "recommended_positioning": positioning,
        "next_5_actions": next_actions,
        "market_opportunity": market_opportunity,
        "target_customer": target_customer,
        "problem_validation": problem_validation,
        "demand_signals": demand_signals,
        "alternative_solutions": alternative_solutions,
        "competitor_matrix": competitor_matrix,
        "competitor_pricing": competitor_pricing,
        "pricing_strategy": pricing_strategy,
        "recommended_price_range": recommended_price_range,
        "positioning": positioning,
        "go_to_market": go_to_market,
        "risks": risks,
        "viability_score": viability_score,
        "next_actions": next_actions,
    }


async def run_research_data(fields: dict[str, Any]) -> dict[str, Any]:
    """
    Step 1: Just get the raw research data (SERP/Search results).
    """
    settings = get_settings()
    evidence: dict[str, list[str]] = {}
    sources: dict[str, list[dict[str, str]]] = {}
    shopping: list[dict[str, str]] = []

    queries = _build_queries(fields)
    search_queries = {key: query for key, (query, _, _) in queries.items()}

    if settings.serp_api_key:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            tasks = {key: _serp(client, query, engine, extra) for key, (query, engine, extra) in queries.items()}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)

        for key, result in zip(tasks.keys(), results):
            if isinstance(result, Exception) or not isinstance(result, dict):
                continue
            if key == "pricing_shop":
                shopping = _shopping_items(result)
                continue
            evidence[key] = _snippets(result)
            sources[key] = _sources(result)
    elif settings.serper_api_key:
        logger.info("SERP_API_KEY not set - using Serper fallback for web retrieval.")
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            tasks = {key: _serper(client, query, engine, extra) for key, (query, engine, extra) in queries.items()}
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)

        for key, result in zip(tasks.keys(), results):
            if isinstance(result, Exception) or not isinstance(result, dict):
                continue
            if key == "pricing_shop":
                continue
            evidence[key] = _snippets(result)
            sources[key] = _sources(result)

    return {
        "evidence": evidence,
        "sources": sources,
        "shopping": shopping,
        "search_queries": search_queries
    }

async def run_ai_narration(fields: dict[str, Any], evidence: dict[str, list[str]], shopping: list[dict[str, Any]] = None) -> dict[str, Any]:
    """
    Step 2: Take research data and generate the AI narrative.
    """
    settings = get_settings()
    prompt = _build_synthesis_prompt(fields, evidence)
    report: dict[str, Any] = {}

    if settings.claude_api_key:
        report = await _call_claude(prompt)
    elif settings.openai_api_key:
        report = await _call_openai(prompt)

    if shopping and isinstance(report.get("competitor_pricing"), list):
        for item in shopping[:3]:
            if not item.get("price"):
                continue
            report["competitor_pricing"].append(
                {
                    "competitor": item["name"] or item["source"] or "Shopping result",
                    "model": "one-off / subscription",
                    "price_range": item["price"],
                    "free_plan": False,
                    "notes": item.get("source", ""),
                }
            )
    
    # Normalize result against fallbacks to ensure structured data always exists
    return _normalize_report(
        report or {}, 
        fields=fields, 
        search_queries={}, 
        evidence=evidence, 
        sources={}
    )

async def run_market_research(fields: dict[str, Any]) -> dict[str, Any]:
    """
    Main entry point — combines retrieval and narration (legacy compatibility).
    """
    res = await run_research_data(fields)
    report = await run_ai_narration(fields, res["evidence"], res["shopping"])
    
    return _normalize_report(
        report or {},
        fields=fields,
        search_queries=res["search_queries"],
        evidence=res["evidence"],
        sources=res["sources"],
    )

def extract_research_signals(evidence: dict[str, list[str]], sources: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    """
    Extract deterministic signals from raw research evidence.
    """
    competitors = _sources(evidence.get("competitors") or {}) # Simplified
    # Count unique domains in sources
    all_sources = []
    for s_list in sources.values():
        all_sources.extend(s_list)
    
    unique_domains = len(set(s.get("source") for s in all_sources if s.get("source")))
    
    # Heuristic for demand: number of snippets found for problem/industry
    demand_snippets = len(evidence.get("problem_validation") or []) + len(evidence.get("industry_trends") or [])
    
    demand_score = min(100, demand_snippets * 5)
    trend_score = 60 # Default
    if "growing" in str(evidence).lower() or "increasing" in str(evidence).lower():
        trend_score = 85
    elif "declining" in str(evidence).lower() or "decreasing" in str(evidence).lower():
        trend_score = 40

    return {
        "demand_score": float(demand_score),
        "competition_level": "high" if unique_domains > 10 else "medium" if unique_domains > 3 else "low",
        "competitor_count": unique_domains,
        "trend_score": float(trend_score)
    }


def flatten_fields_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Flatten business-idea or service-idea payloads into search-oriented research fields."""
    if _clean_text(payload.get("service_name")) or _clean_text(payload.get("service_description")):
        service_name = _clean_text(payload.get("service_name"))
        service_category = _clean_text(payload.get("service_category"))
        service_description = _clean_text(payload.get("service_description"))
        target_customer = _clean_text(payload.get("target_customer_type"))
        market_scope = _clean_text(payload.get("target_market_scope"))
        demand_evidence = _clean_text(payload.get("demand_evidence_type"))
        differentiation = _clean_text(payload.get("differentiation_level"))
        price_low = _clean_text(payload.get("competitor_price_low"))
        price_high = _clean_text(payload.get("competitor_price_high"))
        price_range = " - ".join(part for part in [price_low, price_high] if part)

        return {
            "idea_type": "service_idea",
            "business_idea_name": service_name,
            "business_name": service_name,
            "what_building": service_name or service_description or "service business",
            "business_type": service_category,
            "primary_industry": service_category,
            "location": market_scope or "United Kingdom",
            "currency": _clean_text(payload.get("currency")) or "GBP",
            "customer_segment": target_customer,
            "problem_short": service_description,
            "frequency": demand_evidence,
            "alternatives": differentiation,
            "service_type": service_description or service_name,
            "pricing_model": "",
            "price_per_unit": _clean_text(payload.get("price_per_sale")),
            "expected_customers": _clean_text(payload.get("number_of_paying_customers")),
            "expected_units_per_month": _clean_text(payload.get("expected_sales_per_month")),
            "competitor_price_range": price_range,
            "delivery_capacity": _clean_text(payload.get("delivery_capacity")),
        }

    ctx = payload.get("context") or {}
    problem = payload.get("problem") or {}
    offer = payload.get("offer") or {}
    demand = payload.get("demand") or {}

    business_name = _clean_text(ctx.get("business_name") or ctx.get("business_offering"))
    service_type = _clean_text(offer.get("service_type") or ctx.get("business_offering"))

    # If both business_name and service_type are empty, we do NOT fall back to generic context keys like 'description'
    # which might contain workspace-level metadata on some legacy payloads.
    return {
        "idea_type": "business_idea",
        "business_idea_name": business_name,
        "business_name": business_name,
        "what_building": service_type or business_name or "New Venture",
        "business_type": _clean_text(ctx.get("business_type")),
        "primary_industry": _clean_text(ctx.get("primary_industry")),
        "location": _clean_text(ctx.get("location")) or "United Kingdom",
        "currency": _clean_text(ctx.get("currency")) or "GBP",
        "customer_segment": _clean_text(problem.get("customer_segment")),
        "problem_short": _clean_text(problem.get("problem_type")),
        "frequency": _clean_text(problem.get("frequency")),
        "alternatives": _clean_text(problem.get("alternatives")),
        "service_type": service_type,
        "pricing_model": _clean_text(offer.get("pricing_model")),
        "price_per_unit": _clean_text(offer.get("price_per_unit")),
        "expected_customers": _clean_text(demand.get("expected_customers")),
        "expected_units_per_month": _clean_text(demand.get("expected_units_per_month")),
    }
