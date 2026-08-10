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
from app.shared.llm.usage import record_ai_usage

logger = logging.getLogger(__name__)

_FREE_PLAN_KEYS = {"free_trial", "explorer", "expired", ""}


async def _pick_llm_caller(user_id: str):
    """Return _call_claude for paid plans, _call_openai for free/trial."""
    try:
        from app.core.supabase import sb_select
        sub = await sb_select("user_subscriptions", filters=[("user_id", "eq", user_id)], single=True)
        plan_key = (sub or {}).get("plan_key") or ""
        status = (sub or {}).get("status") or ""
        is_free = plan_key in _FREE_PLAN_KEYS or status in {"trial", "expired"}
        return _call_openai if is_free else _call_claude
    except Exception:
        return _call_openai

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
    idea_name = _clean_text(fields.get("business_name") or "")
    industry = _clean_text(fields.get("industry") or fields.get("primary_industry") or fields.get("business_type") or "")
    sector = _clean_text(fields.get("sector") or "")
    location = _clean_text(fields.get("country") or fields.get("location") or "United Kingdom")
    segment = _clean_text(fields.get("customer_segment") or "customers")
    problem = _clean_text(fields.get("problem_short") or "")
    currency = _clean_text(fields.get("currency") or "GBP")
    what_long = _clean_text(fields.get("what_building") or fields.get("service_type") or idea_name or "business")

    # Build category from industry+sector first — these are proper market-sector terms.
    # NEVER use the raw idea/business name: it is invented, produces irrelevant keyword
    # matches (e.g. "Injection Test Idea" → "injection moulding market"), and contains
    # no useful category signal.
    if industry or sector:
        category = " ".join(part for part in [industry, sector] if part).strip()
    else:
        # Fall back to extracting a concept phrase from what_building, but strip the
        # brand name prefix first since it is invented and not a searchable category.
        raw = what_long
        if idea_name and raw.lower().startswith(idea_name.lower()):
            raw = raw[len(idea_name):].lstrip(" —–-:,|")
        for splitter in (" for ", " targeting ", " that helps ", " which ", " helping ", " designed for "):
            if splitter in raw.lower():
                raw = raw[:raw.lower().find(splitter)]
                break
        category = raw[:55].strip() or "business software"

    # For problem-validation / demand queries use the actual problem statement,
    # not the idea name, so searches stay topically grounded.
    problem_query = problem or category

    audience = f"{segment} {location}".strip()
    location_suffix = f" in {location}" if location else ""

    return {
        "market_opportunity": (f"{category} market size TAM SAM growth{location_suffix}", "google", {}),
        "industry_trends": (f"{category} industry trends CAGR forecast 2025 2030{location_suffix}", "google", {}),
        "target_customer": (f"{segment} pain points buying behaviour for {category}{location_suffix}", "google", {}),
        "problem_validation": (f"{problem_query} complaints pain points {audience}", "google", {}),
        "demand_signals": (f"{problem_query} search trends forums reddit reviews {audience}", "google", {}),
        "competitors": (f"top {category} competitors revenue market share{location_suffix}", "google", {}),
        "pricing": (f"{category} pricing plans cost per month annual {currency}", "google", {}),
        "pricing_shop": (f"{category} price {currency}", "google_shopping", {}),
        "news": (f"{category} market news 2025 2026{location_suffix}", "google_news", {}),
        "tam_sam": (f"{industry or category} total addressable market size billions{location_suffix}", "google", {}),
    }


def _build_synthesis_prompt(fields: dict[str, Any], evidence: dict[str, list[str]]) -> str:
    what_building = _clean_text(fields.get("what_building") or fields.get("business_name") or "")
    business_name = _clean_text(fields.get("business_name") or what_building)
    industry = _clean_text(fields.get("industry") or fields.get("primary_industry"))
    sector = _clean_text(fields.get("sector") or "")
    segment = _clean_text(fields.get("customer_segment"))
    problem = _clean_text(fields.get("problem_short"))
    country = _clean_text(fields.get("country") or "")
    location = _clean_text(country or fields.get("location") or "United Kingdom")
    currency = _clean_text(fields.get("currency") or "GBP")
    alternatives = _clean_text(fields.get("alternatives") or "")
    alternatives_display = alternatives or "not specified"
    differentiator = _clean_text(fields.get("differentiator") or "")
    market_scope = _clean_text(fields.get("market_scope") or "")

    # ── Comprehensive mode extras ────────────────────────────────────────
    validation_mode = _clean_text(fields.get("validation_mode") or "basic")
    is_comprehensive = validation_mode == "comprehensive"

    if is_comprehensive:
        revenue_model_c = _clean_text(fields.get("revenue_model") or "")
        proposed_price_c = _clean_text(fields.get("proposed_price") or "")
        payment_frequency_c = _clean_text(fields.get("payment_frequency") or "")
        wtp_evidence_c = fields.get("willingness_to_pay_evidence", False)
        variable_cost_c = _clean_text(fields.get("variable_cost_per_unit") or "")
        fixed_costs_c = _clean_text(fields.get("fixed_costs_monthly") or "")
        gross_margin_c = _clean_text(fields.get("gross_margin_estimate") or "")
        capacity_c = _clean_text(fields.get("capacity_per_month") or "")
        delivery_unit_c = _clean_text(fields.get("delivery_unit") or "")
        key_bottleneck_c = _clean_text(fields.get("key_bottleneck") or "")
        founder_experience_c = _clean_text(fields.get("founder_industry_experience") or "")
        founder_capital_c = fields.get("founder_capital_available", False)
        founder_time_c = fields.get("founder_time_available", False)
        reg_risk_c = _clean_text(fields.get("regulatory_risk_level") or "")
        reg_known_c = fields.get("regulatory_requirements_known", False)
        reg_planned_c = fields.get("regulatory_mitigation_planned", False)
        evidence_types_c = fields.get("evidence_types") or []
        evidence_list_c = (
            ", ".join(str(e).replace("_", " ") for e in evidence_types_c)
            if evidence_types_c else "none specified"
        )
        price_freq_c = f" ({payment_frequency_c})" if payment_frequency_c else ""

        comprehensive_context = (
            f"\nCOMPREHENSIVE INPUTS (Steps 7-12):\n"
            f"- Revenue Model: {revenue_model_c or 'not specified'}\n"
            f"- Proposed Price: {proposed_price_c or 'not specified'}{price_freq_c}\n"
            f"- Customer WTP Evidence: {'Yes' if wtp_evidence_c else 'No'}\n"
            f"- Variable Cost/Unit: {variable_cost_c or 'not specified'}\n"
            f"- Fixed Monthly Costs: {fixed_costs_c or 'not specified'}\n"
            f"- Gross Margin Estimate: {gross_margin_c or 'not specified'}\n"
            f"- Delivery Unit: {delivery_unit_c or 'not specified'}\n"
            f"- Monthly Capacity: {capacity_c or 'not specified'}\n"
            f"- Key Bottleneck: {key_bottleneck_c or 'not specified'}\n"
            f"- Evidence Types Collected: {evidence_list_c}\n"
            f"- Founder Industry Experience: {founder_experience_c or 'not specified'}\n"
            f"- Capital Available: {'Yes' if founder_capital_c else 'No'}\n"
            f"- Time Available to Execute: {'Yes' if founder_time_c else 'No'}\n"
            f"- Regulatory Risk Level: {reg_risk_c or 'not specified'}\n"
            f"- Regulatory Requirements Known: {'Yes' if reg_known_c else 'No'}\n"
            f"- Mitigation Planned: {'Yes' if reg_planned_c else 'No'}\n"
        )
        cap_yes_no = "Yes" if founder_capital_c else "No"
        time_yes_no = "Yes" if founder_time_c else "No"
        reg_known_yn = "Yes" if reg_known_c else "No"
        reg_planned_yn = "Yes" if reg_planned_c else "No"

        # Inject deterministic unit economics into the comprehensive context block
        # so the AI cites exact figures rather than re-estimating from raw inputs.
        computed = (fields.get("computed_metrics") or {}).get("unit_economics") or {}
        c_breakeven_u = computed.get("breakeven_units")
        c_breakeven_m = computed.get("breakeven_months")
        c_gm_pct = computed.get("gross_margin_pct")
        c_contrib = computed.get("contribution_per_unit")
        c_price = computed.get("price_per_unit")
        c_fixed = computed.get("fixed_costs_monthly")
        c_currency = computed.get("currency") or currency

        computed_lines: list[str] = []
        if c_price is not None:
            computed_lines.append(f"- Price per unit: {c_currency} {c_price:,.2f}")
        if c_contrib is not None:
            computed_lines.append(f"- Contribution per unit: {c_currency} {c_contrib:,.2f}")
        if c_gm_pct is not None:
            computed_lines.append(f"- Gross margin: {c_gm_pct}%")
        if c_fixed is not None:
            computed_lines.append(f"- Fixed costs / month: {c_currency} {c_fixed:,.2f}")
        if c_breakeven_u is not None:
            be_str = f"- Break-even: {c_breakeven_u:,.1f} units"
            if c_breakeven_m is not None:
                be_str += f" (≈ {c_breakeven_m:.1f} months at stated capacity)"
            computed_lines.append(be_str)

        if computed_lines:
            comprehensive_context += (
                "\nCOMPUTED UNIT ECONOMICS (mathematically exact — you MUST cite these precise figures in the"
                " unit_economics section, not your own estimates):\n"
                + "\n".join(computed_lines) + "\n"
            )

        # Build section instruction for unit_economics, referencing computed figures where available
        if c_breakeven_u is not None:
            ue_breakeven_hint = (
                f"The exact break-even is {c_breakeven_u:,.1f} units"
                + (f" (≈ {c_breakeven_m:.1f} months at stated capacity)" if c_breakeven_m is not None else "")
                + " — use this precise figure, not an estimate."
            )
        else:
            ue_breakeven_hint = "Calculate break-even if the inputs allow."

        comp_sections_json = (
            f',\n    "unit_economics": {{\n'
            f'      "body": "2-3 sentences on financial viability for {business_name}. '
            f'Use the EXACT computed figures: gross margin {f"{c_gm_pct}%" if c_gm_pct is not None else gross_margin_c or "unspecified"}, '
            f'contribution {f"{c_currency} {c_contrib:,.2f}" if c_contrib is not None else "unspecified"} per unit, '
            f'fixed costs {f"{c_currency} {c_fixed:,.2f}/month" if c_fixed is not None else fixed_costs_c or "unspecified"}. '
            f'{ue_breakeven_hint} '
            f'Comment whether the {revenue_model_c or "proposed"} model is sustainably profitable at this margin '
            f'and what it implies for scaling and investor returns.",\n'
            f'      "insight": "One sentence on the key unit economics strength or risk and its implication for funding runway."\n'
            f'    }},\n'
            f'    "operations": {{\n'
            f'      "body": "2-3 sentences on operational readiness. '
            f'Delivery unit: {delivery_unit_c or "unspecified"}, stated capacity: {capacity_c or "unspecified"}/month, '
            f'main bottleneck: {key_bottleneck_c or "not identified"}. '
            f'Assess whether this capacity can realistically meet early customer demand and what the bottleneck means for growth.",\n'
            f'      "insight": "One sentence on the most critical operational constraint or advantage for scaling {business_name}."\n'
            f'    }},\n'
            f'    "founder_readiness": {{\n'
            f'      "body": "2-3 sentences on founder-venture fit. '
            f'Industry experience: {founder_experience_c or "unspecified"}, capital available: {cap_yes_no}, '
            f'time available: {time_yes_no}. '
            f'Compare the venture\'s demands (domain expertise, execution bandwidth, capital intensity) '
            f'against what the founder currently brings.",\n'
            f'      "insight": "One sentence verdict on readiness and the single most important gap to close before launch."\n'
            f'    }},\n'
            f'    "regulatory": {{\n'
            f'      "body": "2-3 sentences on the regulatory landscape for {business_name} in {location}. '
            f'Assessed risk level: {reg_risk_c or "unknown"}, requirements known: {reg_known_yn}, '
            f'mitigation planned: {reg_planned_yn}. '
            f'Name the specific regulatory domains for {industry} businesses in {location} this venture must navigate before launch.",\n'
            f'      "insight": "One sentence on the realistic compliance cost, timeline, or risk this creates for market entry."\n'
            f'    }}'
        )
    else:
        comprehensive_context = ""
        comp_sections_json = ""

    evidence_text = ""
    for key, snippets in evidence.items():
        if snippets:
            evidence_text += f"\n### {key.upper().replace('_', ' ')}\n" + "\n".join(f"- {snippet}" for snippet in snippets[:2])

    engine_data = fields.get("deterministic_evaluation") or {}
    score = engine_data.get("score", "N/A")
    classification = engine_data.get("classification", "N/A")
    market_fit = fields.get("market_fit_analysis") or {}
    sector_signal = market_fit.get("sector", {})
    
    return f"""Role: Senior Market Research & Venture Strategist
Task: Synthesize market signals and deterministic data into a high-integrity validation report for {business_name}.

DETERMINISTIC ENGINE DATA (Ground Truth):
- Business Concept: {business_name}
- Idea / Description: {what_building}
- Industry: {industry}{f" / {sector}" if sector else ""}
- Country/Location: {location}{f" ({market_scope} market)" if market_scope else ""}
- Target Segment: {segment}
- Problem Solved: {problem}
- Current Alternatives: {alternatives or "not specified"}
- Key Differentiator: {differentiator or "not specified"}
- Currency: {currency}
- Spoken to: {_clean_text(fields.get('interviews_conducted')) or '0'} people
- Deterministic Score: {score}/100
- Classification: {classification}
{comprehensive_context}
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
    "MANDATORY — at least 3 specific risks. Examples: 'High CAC to acquire {segment} in competitive {industry} market', 'Established competitors with switching costs make displacement hard', 'Low demand evidence (0 interviews) increases execution risk'. Base on research evidence and the {score}/100 score.",
    "Second specific risk tied to competition or unit economics found in research.",
    "Third risk tied to market timing, regulation, or adoption barriers."
  ],
  "next_actions": [
    {{
      "step": 1,
      "action": "Immediate tactical step",
      "why": "How this resolves a specific gap in the {score}/100 score.",
      "timeframe": "7 days"
    }},
    {{
      "step": 2,
      "action": "Second action targeting the biggest risk identified above.",
      "why": "Specific rationale.",
      "timeframe": "30 days"
    }},
    {{
      "step": 3,
      "action": "Third action for market validation or revenue generation.",
      "why": "Specific rationale.",
      "timeframe": "60 days"
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
  }},
  "target_customer": {{
    "profile": "Specific description of the ideal first customer for {business_name} in {location}.",
    "pain_points": ["Specific pain 1 for {segment}", "Specific pain 2"],
    "buying_behaviour": "How {segment} typically discovers and purchases this type of product.",
    "urgency": "One sentence: how pressing is this pain for {segment} right now.",
    "willingness_to_pay": "One sentence: what {segment} already pays for alternatives or workarounds."
  }},
  "positioning": {{
    "value_proposition": "One sentence: the specific measurable benefit {business_name} delivers to {segment}.",
    "differentiation": "What makes {business_name} different from the competitors found in research.",
    "headline_message": "A punchy 5-10 word tagline that would resonate with {segment}."
  }},
  "go_to_market": {{
    "primary_channels": ["Best acquisition channel for {segment}", "Second best channel"],
    "quick_wins": ["First specific action to get first 10 customers in {location}", "Second quick win"],
    "timeline": "Realistic launch timeline for {business_name} in {location} (e.g. '60-90 day pilot')."
  }},
  "pricing_strategy": {{
    "recommended_model": "Name of the pricing model best suited for {business_name} (e.g. 'per-seat SaaS subscription', 'transaction commission', 'freemium').",
    "rationale": "Why this model works for {segment} based on research evidence.",
    "launch_offer": "A specific launch offer or trial structure to win first customers."
  }},
  "market_sizing": {{
    "total_addressable_market": "Specific {currency} or USD figure for the global/national market. Use evidence numbers. E.g. '£2.4 billion UK SME health market (2025 est.)'.",
    "tam_basis": "How the TAM figure was derived — source, segment, and year.",
    "serviceable_addressable_market": "The realistic share of TAM reachable for {business_name} targeting {segment} in {location}. E.g. '£180 million — SMEs with under 250 employees in UK'.",
    "sam_basis": "How SAM was narrowed from TAM.",
    "projected_growth_rate": "CAGR or annual % growth from research evidence. E.g. '7.2% CAGR to 2030'.",
    "projected_market_size_2030": "Projected total market value by 2030 using growth rate. E.g. '£3.4 billion by 2030'.",
    "growth_drivers": ["Key driver 1 from research", "Key driver 2", "Key driver 3"]
  }},
  "competitor_analysis": {{
    "top_competitors": [
      {{
        "name": "Competitor brand name",
        "description": "One sentence — what they do and who they serve",
        "estimated_revenue": "Revenue range or funding if found (e.g. '$5M ARR', 'Series A', 'Public')",
        "market_share": "Estimated share or relative position (e.g. 'Market leader ~30%', 'Niche player')",
        "pricing": "Pricing model and indicative range using 'to' not hyphens (e.g. '£15 to £45/user/month')",
        "weakness": "Key gap or vulnerability for {business_name} to exploit"
      }}
    ],
    "market_saturation": "Low / Medium / High — based on number and strength of competitors found",
    "competitive_moat": "What differentiated advantage {business_name} can build vs the found competitors"
  }},
  "price_intelligence": {{
    "similar_products": [
      {{
        "name": "Similar product or service name",
        "price": "Actual price found (e.g. '£29/month', '£499 one-off')",
        "source": "Where the price was found (brand, website, search result)"
      }}
    ],
    "recommended_entry_price": "Specific price point for {business_name}'s entry tier in {currency}, justified by competitor data",
    "recommended_growth_price": "Growth tier price in {currency}",
    "recommended_premium_price": "Premium tier price in {currency}",
    "pricing_rationale": "Why these price points work for {segment} — reference what competitors charge",
    "currency": "{currency}"
  }},
  "sections": {{
    "problem": {{
      "body": "2-3 sentences describing the problem '{problem}' experienced by {segment} — its severity, frequency, and consequence if left unresolved. Ground it in the inputs provided.",
      "insight": "One sentence key finding on problem validation quality and real-world impact."
    }},
    "customer": {{
      "body": "2-3 sentences assessing how precisely {segment} is defined as the primary buyer — beachhead specificity, economic buyer identity, and buying triggers provided.",
      "insight": "One sentence key finding on customer targeting precision and segment clarity."
    }},
    "solution": {{
      "body": "2-3 sentences evaluating the proposed solution's relevance to the problem and differentiation vs alternatives ({alternatives_display}). Reference the core value proposition.",
      "insight": "One sentence key finding on solution-problem fit and competitive edge."
    }},
    "market": {{
      "body": "2-3 sentences estimating the market opportunity for {business_name} in {location} — addressable size, growth signals, and any demand evidence found in research.",
      "insight": "One sentence key finding on market opportunity credibility and sizing confidence.",
      "source_hint": "Name 2-3 specific authoritative sources (e.g. a {location} government statistics body, {industry} trade association report, or recognised industry analyst) that would verify these market figures."
    }},
    "competition": {{
      "body": "2-3 sentences identifying real named competitors or substitutes customers currently use, assessing switching barriers and {business_name}'s differentiation angle. Name specific brands where known.",
      "insight": "One sentence key finding on competitive positioning and defensibility."
    }}{comp_sections_json}
  }},
  "contradictions": [
    "First specific inconsistency between claimed inputs and evidence (e.g. 'Market described as growing but no market data or sources cited', 'Customer segment defined but no customer interviews or behavioural evidence cited'). Use a real inconsistency found.",
    "Second contradiction if genuinely present — omit if only one inconsistency exists"
  ],
  "key_strengths": [
    "One sentence strength 1 — specific to the idea, grounded in the inputs or evidence",
    "One sentence strength 2",
    "One sentence strength 3 (include only if genuinely present)"
  ],
  "key_weaknesses": [
    "One sentence gap or risk 1 — what is missing or unvalidated",
    "One sentence gap or risk 2",
    "One sentence gap or risk 3 (include only if genuinely present)"
  ]
}}

STRICT CONSTRAINTS:
1. NEVER use generic templates. Every sentence must mention the segment, concept, or specific evidence.
2. If research is limited, state: "Market signals for {business_name} are currently sparse..."
3. Reference real numbers where possible.
4. JSON ONLY. No preamble.
5. BE CONCISE — each text field max 2 sentences. Arrays max 3 items. Prioritise specificity over length.
"""


async def _call_claude(prompt: str, *, user_id: str = "", feature: str = "idea_validation.market_research") -> dict:
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
        "model": settings.claude_model or "claude-3-5-sonnet-20241022",
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": prompt}],
    }
    logger.info("Calling Claude with model: %s", body["model"])
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15.0, read=180.0, write=15.0, pool=10.0)) as client:
            response = await client.post(CLAUDE_BASE, headers=headers, json=body)
        if response.status_code != 200:
            logger.error("Claude API error: status=%s, body=%s", response.status_code, response.text)
            return {}
        data = response.json()
        usage = data.get("usage") if isinstance(data, dict) and isinstance(data.get("usage"), dict) else {}
        await record_ai_usage(
            user_id=user_id or None,
            feature=feature,
            provider="anthropic",
            model=body["model"],
            input_tokens=int(usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("output_tokens") or 0),
            total_tokens=int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0),
            request_id=data.get("id") if isinstance(data, dict) else None,
        )
        text = data["content"][0]["text"].strip()
        # Strip markdown fences
        if text.startswith("```"):
            lines = text.splitlines()
            if lines[0].startswith("```json"):
                text = "\n".join(lines[1:-1]).strip()
            elif lines[0].startswith("```"):
                text = "\n".join(lines[1:-1]).strip()
        # Extract first complete JSON object by counting braces
        start = text.find("{")
        if start != -1:
            depth = 0
            for i, ch in enumerate(text[start:], start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        text = text[start : i + 1]
                        break
        result = json.loads(text)
        logger.info("Claude synthesis successful.")
        return result
    except Exception as exc:
        logger.error("Claude call failed: %s", exc, exc_info=True)
    return {}


async def _call_openai(prompt: str, *, user_id: str = "", feature: str = "idea_validation.market_research") -> dict:
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
        usage = data.get("usage") if isinstance(data, dict) and isinstance(data.get("usage"), dict) else {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        await record_ai_usage(
            user_id=user_id or None,
            feature=feature,
            provider="openai",
            model=body["model"],
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
            total_tokens=int(usage.get("total_tokens") or (prompt_tokens + completion_tokens)),
            request_id=data.get("id") if isinstance(data, dict) else None,
        )
        text = data["choices"][0]["message"]["content"].strip()
        result = json.loads(text)
        logger.info("OpenAI synthesis successful.")
        return result
    except Exception as exc:
        logger.error("OpenAI call failed: %s", exc, exc_info=True)
    return {}


def _fallback_report(fields: dict[str, Any]) -> dict[str, Any]:
    what = _clean_text(fields.get("what_building") or fields.get("business_name") or "your product")
    segment = _clean_text(fields.get("customer_segment") or "target customers")
    country = _clean_text(fields.get("country") or "")
    location = _clean_text(country or fields.get("location") or "your market")
    currency = _clean_text(fields.get("currency") or "GBP")
    industry = _clean_text(fields.get("industry") or fields.get("primary_industry") or "")

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
        "market_sizing": {
            "total_addressable_market": f"Estimating based on {industry or what} market — research in progress.",
            "tam_basis": f"Global {industry or what} market estimate.",
            "serviceable_addressable_market": f"Segment focused on {segment} in {location}.",
            "sam_basis": f"Narrowed from TAM by segment ({segment}) and geography ({location}).",
            "projected_growth_rate": "Growth rate data being gathered.",
            "projected_market_size_2030": "Projection pending research.",
            "growth_drivers": ["Digital adoption", "Growing demand in segment", "Regulatory tailwinds"],
        },
        "competitor_analysis": {
            "top_competitors": [],
            "market_saturation": "Medium",
            "competitive_moat": f"Niche focus on {segment} and superior customer experience.",
        },
        "price_intelligence": {
            "similar_products": [],
            "recommended_entry_price": f"{currency} entry tier — awaiting research",
            "recommended_growth_price": f"{currency} growth tier — awaiting research",
            "recommended_premium_price": f"{currency} premium tier — awaiting research",
            "pricing_rationale": f"Pricing based on {segment} willingness to pay and competitor benchmarks.",
            "currency": currency,
        },
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
        "market_sizing": merged.get("market_sizing") or fallback["market_sizing"],
        "competitor_analysis": merged.get("competitor_analysis") or fallback["competitor_analysis"],
        "price_intelligence": merged.get("price_intelligence") or fallback["price_intelligence"],
        "sections": merged.get("sections") or {},
        "contradictions": merged.get("contradictions") or [],
        "key_strengths": merged.get("key_strengths") or [],
        "key_weaknesses": merged.get("key_weaknesses") or [],
        "sources": sources,
    }


async def run_research_data(fields: dict[str, Any], *, use_serp: bool = True) -> dict[str, Any]:
    """
    Retrieve market research via SerpAPI/Serper.
    use_serp=False skips all external search (free/starter plans) — AI narration
    still runs but without live web evidence.
    """
    evidence: dict[str, list[str]] = {}
    sources: dict[str, list[dict[str, str]]] = {}
    shopping: list[dict[str, str]] = []
    queries = _build_queries(fields)
    search_queries = {key: query for key, (query, _, _) in queries.items()}

    if not use_serp:
        return {"evidence": evidence, "sources": sources, "shopping": shopping, "search_queries": search_queries}

    settings = get_settings()
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


def _build_market_data_prompt(fields: dict[str, Any], evidence: dict[str, list[str]]) -> str:
    """Focused prompt for market sizing, competitor metrics, and price intelligence."""
    what_building = _clean_text(fields.get("what_building") or fields.get("business_name") or "the business")
    industry = _clean_text(fields.get("industry") or fields.get("primary_industry") or "")
    sector = _clean_text(fields.get("sector") or "")
    segment = _clean_text(fields.get("customer_segment") or "customers")
    location = _clean_text(fields.get("country") or fields.get("location") or "United Kingdom")
    currency = _clean_text(fields.get("currency") or "GBP")
    problem = _clean_text(fields.get("problem_short") or "")
    alternatives = _clean_text(fields.get("alternatives") or "")
    differentiator = _clean_text(fields.get("differentiator") or "")
    market_scope = _clean_text(fields.get("market_scope") or "")

    context_lines = [
        f"- Product/Service: {what_building}",
        f"- Industry: {industry}{f' / {sector}' if sector else ''}",
        f"- Target customers: {segment}",
        f"- Location / Market scope: {location}{f' ({market_scope})' if market_scope else ''}",
        f"- Currency: {currency}",
    ]
    if problem:
        context_lines.append(f"- Problem solved: {problem}")
    if alternatives:
        context_lines.append(f"- Current alternatives customers use: {alternatives}")
    if differentiator:
        context_lines.append(f"- Key differentiator: {differentiator}")

    context_block = "\n".join(context_lines)

    evidence_text = ""
    for key in ("market_opportunity", "industry_trends", "tam_sam", "competitors", "pricing", "pricing_shop", "news"):
        snippets = evidence.get(key) or []
        if snippets:
            evidence_text += f"\n### {key.upper()}\n" + "\n".join(f"- {s}" for s in snippets[:4])

    return f"""You are a senior market research analyst. Based on the business context and live research evidence below, generate PRECISE market sizing, competitor metrics, and pricing data.

BUSINESS CONTEXT:
{context_block}

LIVE RESEARCH EVIDENCE:
{evidence_text or "No live evidence retrieved. Use your training knowledge for this industry and location."}

Return ONLY valid JSON (no markdown, no preamble):
{{
  "market_sizing": {{
    "total_addressable_market": "specific figure with currency e.g. $4.5B globally (2024)",
    "tam_basis": "one sentence: how TAM was scoped — industry + geography",
    "serviceable_addressable_market": "specific figure e.g. {currency}320M for {segment} in {location}",
    "sam_basis": "one sentence: how SAM was narrowed from TAM",
    "projected_growth_rate": "e.g. 12.4% CAGR 2024-2030",
    "projected_market_size_2030": "projected total market value by 2030",
    "growth_drivers": ["driver 1 specific to {industry}", "driver 2", "driver 3"]
  }},
  "competitor_analysis": {{
    "top_competitors": [
      {{
        "name": "Real competitor brand name",
        "description": "one-line: what they do and who they serve",
        "estimated_revenue": "revenue or funding e.g. $10M ARR or Series B",
        "market_share": "estimated share e.g. ~15% or Market leader",
        "price_range": "pricing model + range using 'to' not hyphens e.g. {currency}49 to 199/month",
        "strength": "their main competitive advantage in one sentence",
        "weakness": "the gap {what_building} can exploit in one sentence"
      }}
    ],
    "market_saturation": "Low|Medium|High",
    "competitive_moat": "one sentence: best differentiation angle for {what_building}"
  }},
  "price_intelligence": {{
    "similar_products": [
      {{"name": "similar product/service name", "price": "actual price e.g. {currency}49/month", "source": "brand or website"}}
    ],
    "recommended_entry_price": "specific entry tier price in {currency} justified by competitor data",
    "recommended_growth_price": "growth tier price in {currency}",
    "recommended_premium_price": "premium tier price in {currency}",
    "pricing_rationale": "one sentence: why these prices work for {segment} referencing what alternatives charge",
    "currency": "{currency}"
  }}
}}"""


async def run_ai_narration(fields: dict[str, Any], evidence: dict[str, list[str]], shopping: list[dict[str, Any]] = None, *, user_id: str = "", sources: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Step 2: Run narrative prompt + market-data prompt concurrently, merge results.
    """
    narrative_prompt = _build_synthesis_prompt(fields, evidence)
    market_prompt = _build_market_data_prompt(fields, evidence)

    call_llm = await _pick_llm_caller(user_id)

    narrative_report: dict[str, Any] = {}
    market_data: dict[str, Any] = {}

    async def call_narrative():
        try:
            return await call_llm(narrative_prompt, user_id=user_id, feature="idea_validation.narration")
        except Exception as e:
            logger.error("AI narrative failed: %s", e)
        return {}

    async def call_market_data():
        try:
            return await call_llm(market_prompt, user_id=user_id, feature="idea_validation.market_data")
        except Exception as e:
            logger.error("AI market-data failed: %s", e)
        return {}

    narrative_report, market_data = await asyncio.gather(call_narrative(), call_market_data())

    merged = {**(narrative_report or {}), **(market_data or {})}
    return _normalize_report(
        merged,
        fields=fields,
        search_queries={},
        evidence=evidence,
        sources=sources or {}
    )


async def run_market_research(fields: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
    res = await run_research_data(fields)
    report = await run_ai_narration(fields, res["evidence"], res["shopping"], user_id=user_id)
    return report


async def run_market_data_only(fields: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
    """Lean version for service validation — only runs the market-data LLM call
    (market_sizing, competitor_analysis, price_intelligence). Skips the full narrative
    synthesis to keep total latency under 2 minutes."""
    res = await run_research_data(fields)
    evidence = res["evidence"]
    market_prompt = _build_market_data_prompt(fields, evidence)

    call_llm = await _pick_llm_caller(user_id)
    market_data: dict[str, Any] = {}
    try:
        market_data = await call_llm(market_prompt, user_id=user_id, feature="idea_validation.market_data_only")
    except Exception as e:
        logger.error("AI market-data failed: %s", e)

    return _normalize_report(
        market_data,
        fields=fields,
        search_queries={key: q for key, (q, _, _) in _build_queries(fields).items()},
        evidence=evidence,
        sources=res["sources"],
    )


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


def flatten_fields_from_v4_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert V4 wizard step payload (step1..step12) to the flat search-query fields format."""
    step1 = payload.get("step1") or {}
    step2 = payload.get("step2") or {}
    step3 = payload.get("step3") or {}
    step4 = payload.get("step4") or {}
    step5 = payload.get("step5") or {}
    step6 = payload.get("step6") or {}
    step7 = payload.get("step7") or {}
    step8 = payload.get("step8") or {}
    step9 = payload.get("step9") or {}
    step10 = payload.get("step10") or {}
    step11 = payload.get("step11") or {}
    step12 = payload.get("step12") or {}

    competitors_raw = step4.get("direct_competitors") or []
    if isinstance(competitors_raw, list):
        alternatives = ", ".join(str(c).strip() for c in competitors_raw if c)
    else:
        alternatives = _clean_text(competitors_raw)

    country = _clean_text(step1.get("operating_country") or "")
    industry = _clean_text(step1.get("idea_sector") or step1.get("idea_type") or step6.get("market_category") or "")
    segment = _clean_text(
        step3.get("beachhead_segment")
        or step3.get("primary_segment")
        or step2.get("who_affected")
        or ""
    )
    location = _clean_text(step1.get("launch_geography") or country or "United Kingdom")
    idea_name = _clean_text(step1.get("idea_name") or "")
    idea_desc = _clean_text(step1.get("idea_description") or idea_name)
    what_building = (idea_name + (" — " + idea_desc if idea_desc and idea_desc != idea_name else "")).strip(" —")

    return {
        "business_name": idea_name,
        "what_building": what_building or idea_desc,
        "industry": industry,
        "primary_industry": industry,
        "sector": _clean_text(step1.get("idea_type") or ""),
        "customer_segment": segment,
        "country": country,
        "location": location,
        "currency": _clean_text(payload.get("currency") or "GBP"),
        "problem_short": _clean_text(step2.get("problem_description") or ""),
        "alternatives": alternatives,
        "differentiator": _clean_text(step5.get("why_better") or step5.get("defensibility") or ""),
        "market_scope": _clean_text(step6.get("market_scope") or step1.get("market_scope") or ""),
        "interviews_conducted": "0",
        # ── Comprehensive-only: Steps 7-12 ──────────────────────────────────
        "validation_mode": _clean_text(payload.get("validation_mode") or "basic"),
        "revenue_model": _clean_text(step7.get("revenue_model") or ""),
        "proposed_price": _clean_text(step7.get("proposed_price") or ""),
        "payment_frequency": _clean_text(step7.get("payment_frequency") or ""),
        "willingness_to_pay_evidence": bool(step7.get("willingness_to_pay_evidence")),
        "variable_cost_per_unit": _clean_text(step8.get("variable_cost_per_unit") or ""),
        "fixed_costs_monthly": _clean_text(step8.get("fixed_costs_monthly") or ""),
        "gross_margin_estimate": _clean_text(step8.get("gross_margin_estimate") or ""),
        "variable_cost_known": bool(step8.get("variable_cost_known")),
        "capacity_per_month": _clean_text(step9.get("capacity_per_month") or ""),
        "delivery_unit": _clean_text(step9.get("delivery_unit") or ""),
        "key_bottleneck": _clean_text(step9.get("key_bottleneck") or ""),
        "delivery_model_defined": bool(step9.get("delivery_model_defined")),
        "evidence_types": step10.get("evidence_types") or [],
        "founder_industry_experience": _clean_text(step11.get("founder_industry_experience") or ""),
        "founder_capital_available": bool(step11.get("founder_capital_available")),
        "founder_time_available": bool(step11.get("founder_time_available")),
        "regulatory_risk_level": _clean_text(step12.get("regulatory_risk_level") or ""),
        "regulatory_requirements_known": bool(step12.get("regulatory_requirements_known")),
        "regulatory_mitigation_planned": bool(step12.get("regulatory_mitigation_planned")),
    }


def flatten_fields_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    # Check for service vs business idea
    if _clean_text(payload.get("service_description")):
        svc_name = _clean_text(payload.get("service_name")) or ""
        svc_desc = _clean_text(payload.get("service_description")) or ""
        industry = _clean_text(payload.get("industry") or payload.get("service_category")) or ""
        sector = _clean_text(payload.get("sector")) or ""
        country = _clean_text(payload.get("country") or payload.get("location")) or "United Kingdom"
        currency = _clean_text(payload.get("currency")) or "GBP"
        return {
            "business_name": svc_name,
            "what_building": (svc_name + (" — " + svc_desc if svc_desc else "")).strip(" — "),
            "primary_industry": industry,
            "industry": industry,
            "sector": sector,
            "customer_segment": _clean_text(payload.get("target_customer_type")),
            "country": country,
            "location": country,
            "currency": currency,
            "problem_short": _clean_text(payload.get("problem_to_solve")) or svc_desc,
            "alternatives": _clean_text(payload.get("competitors_alternatives")),
            "differentiator": _clean_text(payload.get("differentiator")),
            "market_scope": _clean_text(payload.get("target_market_scope")),
            "interviews_conducted": _clean_text(payload.get("demand_evidence_type") or "0"),
        }
    ctx = payload.get("context") or {}
    problem = payload.get("problem") or {}
    validation = payload.get("validation") or {}

    # The JS builder resolves "Other" values into .industry / .sector / .resolved_country / .resolved_currency
    # but we also handle the raw _category fields as fallback
    industry = (
        _clean_text(ctx.get("industry"))
        or _clean_text(ctx.get("primary_industry"))
        or (_clean_text(ctx.get("industry_category")) if ctx.get("industry_category") != "Other" else "")
        or _clean_text(ctx.get("industry_other"))
        or ""
    )
    sector = (
        _clean_text(ctx.get("sector"))
        or (_clean_text(ctx.get("sector_category")) if ctx.get("sector_category") != "Other" else "")
        or _clean_text(ctx.get("sector_other"))
        or ""
    )
    country = (
        _clean_text(ctx.get("resolved_country"))
        or (_clean_text(ctx.get("country")) if ctx.get("country") != "Other" else "")
        or _clean_text(ctx.get("country_other"))
        or ""
    )
    currency = (
        _clean_text(ctx.get("resolved_currency"))
        or (_clean_text(ctx.get("currency")) if ctx.get("currency") not in ("Other", None, "") else "")
        or _clean_text(ctx.get("currency_other"))
        or "GBP"
    )
    # The business idea description is the most important search context
    what_building = (
        _clean_text(ctx.get("what_building"))
        or _clean_text(ctx.get("business_offering"))
        or _clean_text(ctx.get("description"))
        or _clean_text(ctx.get("business_name"))
        or ""
    )
    business_name = _clean_text(ctx.get("business_name")) or what_building[:60]

    return {
        "business_name": business_name,
        "what_building": what_building,
        "primary_industry": industry,
        "industry": industry,
        "sector": sector,
        "customer_segment": _clean_text(problem.get("customer_segment")),
        "country": country,
        "location": country or _clean_text(ctx.get("location")) or "United Kingdom",
        "currency": currency,
        "problem_short": _clean_text(problem.get("problem_type")),
        "interviews_conducted": _clean_text(validation.get("spoken_count") or "0"),
    }
