"""
market_fit_service.py
─────────────────────
Fetches external signals and computes a deterministic Market Fit score (0–100).

Signals:
  1. Demand trend      — Google Trends (pytrends) by keyword + UK region
  2. Sector survival   — Companies House API: dissolution vs incorporation ratio by SIC code
  3. Local competition — Google Places API: competitor density in location radius

All scoring is deterministic. No LLM involved.
Score breakdown:
  40% Demand trend
  35% Sector survival
  25% Local competition
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass, field
import re

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


SECTOR_TO_SIC: dict[str, str] = {
    "cleaning": "81210",
    "it_services": "62020",
    "marketing": "73110",
    "trades": "43210",
    "property_management": "68320",
    "consulting": "70229",
    "digital_agency": "62010",
    "accountancy": "69201",
    "recruitment": "78200",
    "logistics": "49410",
    "food_beverage": "56102",
    "retail": "47190",
    "beauty": "96020",
    "fitness": "93110",
    "childcare": "88910",
}


REGION_TO_GEO: dict[str, str] = {
    "england": "GB-ENG",
    "london": "GB-ENG",
    "scotland": "GB-SCT",
    "wales": "GB-WLS",
    "northern_ireland": "GB-NIR",
    "GB-ENG": "GB-ENG",
    "GB-SCT": "GB-SCT",
    "GB-WLS": "GB-WLS",
    "GB-NIR": "GB-NIR",
}


@dataclass
class DemandSignal:
    keyword: str
    geo: str
    avg_interest: float
    trend_direction: str
    trend_delta_pct: float
    score: int
    explanation: str
    raw: list[dict] = field(default_factory=list)


@dataclass
class SectorSurvivalSignal:
    sic_code: str
    sector_label: str
    incorporations_12m: int
    dissolutions_12m: int
    survival_ratio: float
    score: int
    explanation: str


@dataclass
class CompetitionSignal:
    location: str
    radius_metres: int
    competitor_count: int
    competition_level: str
    score: int
    explanation: str


@dataclass
class MarketFitResult:
    market_fit_score: int
    market_fit_classification: str
    market_fit_explanation: str
    demand: DemandSignal | None
    sector: SectorSurvivalSignal | None
    competition: CompetitionSignal | None
    dimension_scores: dict[str, int]
    dimension_explanations: dict[str, str]
    flags: list[str]
    reason_codes: list[str]
    advisory_notes: list[str]
    fetched_at: float
    errors: list[str]


def clamp(n: float, lo: float = 0.0, hi: float = 100.0) -> int:
    return int(max(lo, min(hi, n)))


def _score_demand(avg: float, delta: float) -> int:
    if avg >= 60:
        base = 90
    elif avg >= 40:
        base = 75
    elif avg >= 20:
        base = 55
    elif avg >= 10:
        base = 40
    else:
        base = 25

    if delta > 15:
        base += 10
    elif delta < -10:
        base -= 15

    return clamp(base)


def _score_sector(ratio: float) -> int:
    if ratio >= 0.75:
        return 90
    if ratio >= 0.60:
        return 75
    if ratio >= 0.50:
        return 60
    if ratio >= 0.40:
        return 45
    return 30


def _score_competition(count: int, radius_m: int) -> tuple[int, str]:
    import math

    radius_km = radius_m / 1000.0
    area_km2 = math.pi * radius_km**2
    density = count / max(area_km2, 0.01)

    if density < 1:
        return 90, "low"
    if density < 3:
        return 70, "moderate"
    if density < 6:
        return 50, "high"
    return 30, "saturated"


def _classify_market_fit(score: int) -> str:
    if score >= 75:
        return "STRONG"
    if score >= 55:
        return "PROMISING"
    if score >= 35:
        return "MODERATE"
    return "WEAK"


def _resolve_sic(industry: str, sic_code: str | None) -> str:
    if sic_code and str(sic_code).strip():
        return str(sic_code).strip()
    key = (industry or "").strip().lower().replace("-", "_").replace(" ", "_")
    return SECTOR_TO_SIC.get(key, "74990")


def _companies_house_key() -> str | None:
    settings = get_settings()
    return settings.companies_house_api_key


async def _fetch_google_trends(keyword: str, geo: str, timeframe: str) -> DemandSignal:
    """
    Uses pytrends if installed. If unavailable or it errors, returns a neutral fallback.
    """
    try:
        from pytrends.request import TrendReq  # type: ignore

        loop = asyncio.get_event_loop()

        def _sync():
            pt = TrendReq(hl="en-GB", tz=0, timeout=(10, 25), retries=2, backoff_factor=0.5)
            pt.build_payload([keyword], cat=0, timeframe=timeframe, geo=geo, gprop="")
            df = pt.interest_over_time()
            if df.empty or keyword not in df.columns:
                return [], 0.0, 0.0
            vals = df[keyword].tolist()
            avg = float(sum(vals) / len(vals)) if vals else 0.0
            mid = len(vals) // 2
            first_half = vals[:mid] or [0]
            second_half = vals[mid:] or [0]
            avg_first = sum(first_half) / len(first_half)
            avg_second = sum(second_half) / len(second_half)
            delta = ((avg_second - avg_first) / max(avg_first, 1)) * 100.0
            raw = [{"date": str(d), "value": int(v)} for d, v in zip(df.index, vals)]
            return raw, avg, float(delta)

        raw, avg, delta = await loop.run_in_executor(None, _sync)
        if delta > 15:
            direction = "growing"
        elif delta < -10:
            direction = "declining"
        else:
            direction = "stable"

        score = _score_demand(avg, delta)
        explanation = (
            f"Search interest for '{keyword}' in {geo} averages {avg:.0f}/100 and is {direction} "
            f"({delta:+.1f}% over the period)."
        )
        return DemandSignal(
            keyword=keyword,
            geo=geo,
            avg_interest=float(avg),
            trend_direction=direction,
            trend_delta_pct=float(delta),
            score=score,
            explanation=explanation,
            raw=raw,
        )
    except ImportError as exc:
        logger.warning("pytrends not installed: %s", exc)
        return DemandSignal(
            keyword=keyword,
            geo=geo,
            avg_interest=0.0,
            trend_direction="unknown",
            trend_delta_pct=0.0,
            score=50,
            explanation="Demand trend data unavailable (pytrends not installed on server) — defaulting to neutral (50/100).",
        )
    except Exception as exc:
        logger.warning("Google Trends fetch failed: %s", exc)
        return DemandSignal(
            keyword=keyword,
            geo=geo,
            avg_interest=0.0,
            trend_direction="unknown",
            trend_delta_pct=0.0,
            score=50,
            explanation="Demand trend data unavailable (Google Trends fetch failed) — defaulting to neutral (50/100).",
        )


async def _fetch_sector_survival(sic_code: str) -> SectorSurvivalSignal:
    base = "https://api.companieshouse.gov.uk"
    from datetime import date, timedelta

    from_date = (date.today() - timedelta(days=365)).isoformat()
    to_date = date.today().isoformat()

    incorporations = 0
    dissolutions = 0
    sector_label = sic_code

    key = _companies_house_key()
    if not key:
        ratio = 0.6
        score = _score_sector(ratio)
        return SectorSurvivalSignal(
            sic_code=sic_code,
            sector_label=sector_label,
            incorporations_12m=0,
            dissolutions_12m=0,
            survival_ratio=ratio,
            score=score,
            explanation="Companies House API key not set — defaulting to neutral (60/100).",
        )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp_inc = await client.get(
                f"{base}/advanced-search/companies",
                params={"sic_codes": sic_code, "incorporated_from": from_date, "incorporated_to": to_date, "size": 1},
                auth=(key, ""),
            )
            if resp_inc.status_code == 200:
                incorporations = int(resp_inc.json().get("hits", 0))

            resp_dis = await client.get(
                f"{base}/advanced-search/companies",
                params={"sic_codes": sic_code, "dissolved_from": from_date, "dissolved_to": to_date, "size": 1},
                auth=(key, ""),
            )
            if resp_dis.status_code == 200:
                dissolutions = int(resp_dis.json().get("hits", 0))
    except Exception as exc:
        logger.warning("Companies House fetch failed: %s", exc)

    total = incorporations + dissolutions
    ratio = incorporations / total if total > 0 else 0.6
    score = _score_sector(ratio)

    if total > 0:
        explanation = (
            f"SIC {sic_code}: {incorporations} incorporations vs {dissolutions} dissolutions in the last 12 months."
        )
    else:
        explanation = f"SIC {sic_code}: sector data unavailable — defaulting to neutral (60/100)."

    return SectorSurvivalSignal(
        sic_code=sic_code,
        sector_label=sector_label,
        incorporations_12m=incorporations,
        dissolutions_12m=dissolutions,
        survival_ratio=ratio,
        score=score,
        explanation=explanation,
    )


async def _fetch_competition(
    *,
    location: str,
    keyword: str,
    radius_metres: int,
    google_places_api_key: str | None,
) -> CompetitionSignal:
    if not google_places_api_key:
        count = 5
        score, level = _score_competition(count, radius_metres)
        return CompetitionSignal(
            location=location,
            radius_metres=radius_metres,
            competitor_count=count,
            competition_level=level,
            score=score,
            explanation="Google Places API key not set — defaulting to neutral competition estimate.",
        )

    count = 0
    try:
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        async with httpx.AsyncClient(timeout=10.0) as client:
            geo_resp = await client.get(geocode_url, params={"address": f"{location}, UK", "key": google_places_api_key})
            geo_data = geo_resp.json()
            if geo_data.get("status") != "OK" or not geo_data.get("results"):
                raise ValueError(f"Geocode failed: {geo_data.get('status')}")

            loc = geo_data["results"][0]["geometry"]["location"]
            lat, lng = loc["lat"], loc["lng"]

            places_url = "https://places.googleapis.com/v1/places:searchText"
            places_resp = await client.post(
                places_url,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": google_places_api_key,
                    "X-Goog-FieldMask": "places.id",
                },
                json={
                    "textQuery": keyword,
                    "locationBias": {
                        "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_metres)}
                    },
                    "maxResultCount": 20,
                },
            )
            places_data = places_resp.json()
            count = len(places_data.get("places", []))
    except Exception as exc:
        logger.warning("Google Places fetch failed: %s", exc)
        count = 5

    score, level = _score_competition(count, radius_metres)
    explanation = f"Found {count} similar businesses within {radius_metres // 1000} km of {location}. Local competition is {level}."
    return CompetitionSignal(
        location=location,
        radius_metres=radius_metres,
        competitor_count=count,
        competition_level=level,
        score=score,
        explanation=explanation,
    )


async def _fetch_competition_osm(
    *,
    location: str,
    keyword: str,
    radius_metres: int,
) -> CompetitionSignal:
    """
    Competition proxy using OpenStreetMap:
      - Geocode via Nominatim (UK-only)
      - Count nearby features matching keyword terms via Overpass API

    Best-effort: failures fall back to a neutral estimate.
    """
    count = 0
    resolved_place: str | None = None

    try:
        lat, lon, resolved_place = await _geocode_uk(location)
        regex = _keyword_regex(keyword)
        count = await _overpass_competitor_count(
            lat=lat,
            lon=lon,
            radius_metres=radius_metres,
            keyword_regex=regex,
        )
    except Exception as exc:
        logger.warning("OSM competition fetch failed: %s", exc)
        count = 5

    score, level = _score_competition(count, radius_metres)
    loc_label = resolved_place or location
    explanation = (
        f"Found ~{count} nearby matches for '{keyword}' within {radius_metres // 1000} km of {loc_label}. "
        f"Local competition is {level} (via OpenStreetMap)."
    )
    return CompetitionSignal(
        location=location,
        radius_metres=radius_metres,
        competitor_count=count,
        competition_level=level,
        score=score,
        explanation=explanation,
    )


def _keyword_regex(keyword: str) -> str:
    raw_terms = re.split(r"[^a-zA-Z0-9]+", (keyword or "").lower())
    stop = {"the", "and", "for", "with", "service", "services", "ltd", "limited", "uk"}
    terms = [t for t in raw_terms if len(t) >= 3 and t not in stop]
    terms = terms[:4]
    if not terms:
        k = (keyword or "").strip()
        return re.escape(k)[:32] if k else ".*"
    return "(" + "|".join(re.escape(t) for t in terms) + ")"


async def _geocode_uk(location: str) -> tuple[float, float, str | None]:
    q = (location or "").strip()
    if not q:
        raise ValueError("location_required")

    url = "https://nominatim.openstreetmap.org/search"
    headers = {
        "User-Agent": "EnterprateAI/1.0 (market-fit; contact: support@enterprate.ai)",
        "Accept": "application/json",
    }
    params = {
        "q": f"{q}, United Kingdom",
        "format": "json",
        "limit": 1,
        "countrycodes": "gb",
    }

    async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list) or not data:
            raise ValueError("geocode_no_results")
        hit = data[0] or {}
        lat = float(hit.get("lat"))
        lon = float(hit.get("lon"))
        display = hit.get("display_name")
        return lat, lon, display


async def _overpass_competitor_count(
    *,
    lat: float,
    lon: float,
    radius_metres: int,
    keyword_regex: str,
) -> int:
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]

    r = max(250, min(int(radius_metres), 20000))
    query = f"""
[out:json][timeout:6];
(
  nwr(around:{r},{lat},{lon})["name"~"{keyword_regex}",i];
  nwr(around:{r},{lat},{lon})["brand"~"{keyword_regex}",i];
  nwr(around:{r},{lat},{lon})["operator"~"{keyword_regex}",i];
);
out count;
""".strip()

    headers = {"User-Agent": "EnterprateAI/1.0 (market-fit; contact: support@enterprate.ai)"}

    last_exc: Exception | None = None
    for endpoint in endpoints:
        try:
            async with httpx.AsyncClient(timeout=4.0, headers=headers) as client:
                resp = await client.post(endpoint, content=query.encode("utf-8"))
                resp.raise_for_status()
                payload = resp.json()
                elements = payload.get("elements") if isinstance(payload, dict) else None
                if not isinstance(elements, list) or not elements:
                    return 0
                total = 0
                for el in elements:
                    if isinstance(el, dict) and el.get("type") == "count":
                        c = el.get("count")
                        if isinstance(c, int):
                            total += c
                        elif isinstance(c, str) and c.isdigit():
                            total += int(c)
                return int(total)
        except Exception as exc:
            last_exc = exc
            continue

    if last_exc:
        raise last_exc
    return 0


def _generate_market_fit_insights(result: MarketFitResult) -> tuple[list[str], list[str], list[str]]:
    reasons: list[str] = []
    recs: list[str] = []
    codes: list[str] = []

    d = result.demand
    s = result.sector
    c = result.competition

    if d:
        if d.trend_direction == "declining":
            reasons.append(f"Search demand for '{d.keyword}' in this region is declining.")
            recs.append("Validate whether search decline reflects reduced demand. Consider adjacent keywords or niche positioning.")
            codes.append("DEMAND_DECLINING")
        elif d.avg_interest < 15 and d.trend_direction != "growing":
            reasons.append(f"Search interest for '{d.keyword}' is low — the addressable market may be small.")
            recs.append("Validate the wording customers use and run discovery interviews before committing to positioning.")
            codes.append("DEMAND_LOW")
        elif d.trend_direction == "growing":
            codes.append("DEMAND_GROWING")

    if s:
        if s.survival_ratio < 0.45:
            reasons.append("Sector survival looks weak — more dissolutions than incorporations.")
            recs.append("Research why businesses fail in this sector and ensure your model addresses structural risks.")
            codes.append("SECTOR_HIGH_FAILURE")
        elif s.survival_ratio < 0.55:
            reasons.append("Sector survival is neutral — sector volatility is possible.")
            recs.append("Maintain a higher cash buffer than usual to absorb sector volatility.")
            codes.append("SECTOR_NEUTRAL")

    if c:
        if c.competition_level == "saturated":
            reasons.append("Local market appears saturated for this keyword/location.")
            recs.append("Differentiate on niche, service quality, or vertical; consider a less saturated geographic area.")
            codes.append("COMPETITION_SATURATED")
        elif c.competition_level == "high":
            reasons.append("High local competition in this area.")
            recs.append("Define a clear differentiator and target an underserved sub-segment.")
            codes.append("COMPETITION_HIGH")
        elif c.competition_level == "low":
            codes.append("COMPETITION_LOW")

    return reasons, recs, codes


async def get_market_fit(
    *,
    keyword: str,
    industry: str,
    location: str,
    uk_region: str = "GB-ENG",
    sic_code: str | None = None,
    radius_metres: int = 5000,
    timeframe: str = "today 12-m",
) -> dict:
    """
    Returns a JSON-serialisable dict shaped like MarketFitResult.
    """
    errors: list[str] = []

    resolved_sic = _resolve_sic(industry, sic_code)
    geo = REGION_TO_GEO.get(uk_region, uk_region)

    async def _safe(coro, label: str):
        try:
            return await coro
        except Exception as exc:
            errors.append(f"{label}: {type(exc).__name__}")
            return None

    # Demand trend can be slow or blocked; cap it tightly so other signals still return.
    demand_task = _safe(asyncio.wait_for(_fetch_google_trends(keyword, geo, timeframe), timeout=3.5), "demand")
    sector_task = _safe(asyncio.wait_for(_fetch_sector_survival(resolved_sic), timeout=3.5), "sector")
    comp_task = _safe(
        asyncio.wait_for(
            _fetch_competition_osm(
                location=location,
                keyword=keyword,
                radius_metres=radius_metres,
            ),
            timeout=3.5,
        ),
        "competition",
    )

    demand, sector, competition = await asyncio.gather(demand_task, sector_task, comp_task)

    # If demand timed out/failed, fall back to a neutral signal (do not block the response).
    if demand is None:
        demand = DemandSignal(
            keyword=keyword,
            geo=geo,
            avg_interest=0.0,
            trend_direction="unknown",
            trend_delta_pct=0.0,
            score=50,
            explanation="Demand trend data unavailable — continuing with other market signals.",
            raw=[],
        )
        errors.append("demand: fallback")

    if sector is None:
        sector = SectorSurvivalSignal(
            sic_code=resolved_sic,
            sector_label=resolved_sic,
            incorporations_12m=0,
            dissolutions_12m=0,
            survival_ratio=0.6,
            score=_score_sector(0.6),
            explanation="Sector data unavailable — continuing with other market signals.",
        )
        errors.append("sector: fallback")

    if competition is None:
        score, level = _score_competition(5, radius_metres)
        competition = CompetitionSignal(
            location=location,
            radius_metres=radius_metres,
            competitor_count=5,
            competition_level=level,
            score=score,
            explanation="Competition data unavailable — continuing with other market signals.",
        )
        errors.append("competition: fallback")

    weights = {"demand": 0.40, "sector": 0.35, "competition": 0.25}
    d_score = demand.score if demand else 50
    s_score = sector.score if sector else 50
    c_score = competition.score if competition else 50

    composite = clamp(weights["demand"] * d_score + weights["sector"] * s_score + weights["competition"] * c_score)
    classification = _classify_market_fit(composite)

    dimension_scores = {"market_demand": d_score, "sector_survival": s_score, "local_competition": c_score}
    dimension_explanations = {
        "market_demand": (demand.explanation if demand else "Unavailable."),
        "sector_survival": (sector.explanation if sector else "Unavailable."),
        "local_competition": (competition.explanation if competition else "Unavailable."),
    }

    result = MarketFitResult(
        market_fit_score=composite,
        market_fit_classification=classification,
        market_fit_explanation=(
            f"Market Fit is {composite}/100 ({classification}). Weighted from demand ({d_score}), sector ({s_score}), and competition ({c_score})."
        ),
        demand=demand,
        sector=sector,
        competition=competition,
        dimension_scores=dimension_scores,
        dimension_explanations=dimension_explanations,
        flags=[],
        reason_codes=[],
        advisory_notes=[],
        fetched_at=time.time(),
        errors=errors,
    )

    reasons, recs, codes = _generate_market_fit_insights(result)
    result.reason_codes = codes
    result.advisory_notes = [f"{r} → {rec}" for r, rec in zip(reasons, recs)]

    if composite < 35:
        result.flags.append("weak_market_fit")
    if d_score < 40:
        result.flags.append("low_demand")
    if s_score < 45:
        result.flags.append("high_sector_risk")
    if c_score < 40:
        result.flags.append("saturated_market")

    # Convert nested dataclasses → dict for JSON output
    out = asdict(result)
    return out


def build_fallback_market_fit(
    *,
    keyword: str,
    industry: str,
    location: str,
    uk_region: str = "GB-ENG",
    sic_code: str | None = None,
    radius_metres: int = 5000,
    reason: str = "timeout",
) -> dict:
    """
    Build a safe, neutral market-fit response when external providers time out.
    This prevents the UI from spinning indefinitely.
    """
    resolved_sic = _resolve_sic(industry, sic_code)
    geo = REGION_TO_GEO.get(uk_region, uk_region)

    demand = DemandSignal(
        keyword=keyword,
        geo=geo,
        avg_interest=0.0,
        trend_direction="unknown",
        trend_delta_pct=0.0,
        score=50,
        explanation="Demand trend unavailable â€” using a neutral default.",
        raw=[],
    )

    sector = SectorSurvivalSignal(
        sic_code=resolved_sic,
        sector_label=resolved_sic,
        incorporations_12m=0,
        dissolutions_12m=0,
        survival_ratio=0.6,
        score=_score_sector(0.6),
        explanation="Sector survival data unavailable â€” using a neutral default.",
    )

    comp_score, comp_level = _score_competition(5, radius_metres)
    competition = CompetitionSignal(
        location=location,
        radius_metres=radius_metres,
        competitor_count=5,
        competition_level=comp_level,
        score=comp_score,
        explanation="Competition data unavailable â€” using a neutral default.",
    )

    weights = {"demand": 0.40, "sector": 0.35, "competition": 0.25}
    composite = clamp(
        weights["demand"] * demand.score
        + weights["sector"] * sector.score
        + weights["competition"] * competition.score
    )
    classification = _classify_market_fit(composite)

    dimension_scores = {
        "market_demand": demand.score,
        "sector_survival": sector.score,
        "local_competition": competition.score,
    }
    dimension_explanations = {
        "market_demand": demand.explanation,
        "sector_survival": sector.explanation,
        "local_competition": competition.explanation,
    }

    result = MarketFitResult(
        market_fit_score=composite,
        market_fit_classification=classification,
        market_fit_explanation=(
            f"Market Fit is {composite}/100 ({classification}). Weighted from demand ({demand.score}), "
            f"sector ({sector.score}), and competition ({competition.score})."
        ),
        demand=demand,
        sector=sector,
        competition=competition,
        dimension_scores=dimension_scores,
        dimension_explanations=dimension_explanations,
        flags=[],
        reason_codes=[],
        advisory_notes=[],
        fetched_at=time.time(),
        errors=[f"market_fit: {reason}"],
    )

    reasons, recs, codes = _generate_market_fit_insights(result)
    result.reason_codes = codes
    result.advisory_notes = [f"{r} â†’ {rec}" for r, rec in zip(reasons, recs)]

    if composite < 35:
        result.flags.append("weak_market_fit")
    if demand.score < 40:
        result.flags.append("low_demand")
    if sector.score < 45:
        result.flags.append("high_sector_risk")
    if competition.score < 40:
        result.flags.append("saturated_market")

    return asdict(result)
