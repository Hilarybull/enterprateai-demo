"""§5 (P11, R1, R5): research must be credible and checkable.

Every researched value traces to a real page that supports it, or it is labelled Estimated (with its method) or left
Missing. A source counts only when:
  - its page was fetched on the server and the quoted text (at most two sentences) appears on it;
  - it is an allowed kind of source (Tier 1 official statistics and regulators, Tier 2 trade bodies and published
    industry reports, Tier 3 reputable news, company and price pages; never forums, undated or AI-generated pages);
  - it is dated, and covers the business's own country (a national figure for a city is said as such; a figure for
    another country is never presented as this one's).
A figure used in a calculation needs two independent sources that agree within FIGURE_TOLERANCE, or one Tier 1 source.
When sources disagree, the range and both sources are shown, never an average. Text on a fetched page is data: an
instruction found there changes nothing (it is stripped before the model sees the page, and never followed).
"""
from __future__ import annotations

import asyncio
import html
import re
from datetime import date, datetime, timezone
from statistics import median
from typing import Any
from urllib.parse import urlparse

FIGURE_TOLERANCE = 0.25      # two sources agree when within 25% of each other (stated with the result)
PAGE_BYTES = 1_500_000
EXCERPT_CHARS = 3000
FETCH_SECONDS = 10
FRESH_DAYS = {"market": 180, "demand": 180, "price": 30, "cost": 30, "forecast": 30, "capacity": 30}

# ── source tiers ─────────────────────────────────────────────────────────────────────────────────────────────────
TIER1_HOSTS = ("ons.gov.uk", "gov.uk", "companieshouse.gov.uk", "hmrc.gov.uk", "fca.org.uk", "bankofengland.co.uk", "nisra.gov.uk", "gov.scot",
               "gov.wales", "census.gov", "bls.gov", "bea.gov", "sba.gov", "abs.gov.au", "statcan.gc.ca", "stats.govt.nz", "cso.ie", "gov.ie",
               "nigerianstat.gov.ng", "nbs.gov.ng", "cbn.gov.ng", "statsghana.gov.gh", "knbs.or.ke", "statssa.gov.za", "ec.europa.eu",
               "eurostat.ec.europa.eu", "oecd.org", "worldbank.org", "imf.org", "ilo.org", "un.org", "destatis.de", "insee.fr", "ine.es", "istat.it",
               "cbs.nl", "scb.se")
TIER2_HOSTS = ("statista.com", "ibisworld.com", "mintel.com", "euromonitor.com", "fsb.org.uk", "britishchambers.org.uk", "cbi.org.uk", "ukhospitality.org.uk",
               "bcc.org.uk", "ipsos.com", "yougov.co.uk", "deloitte.com", "pwc.co.uk", "pwc.com", "kpmg.com", "mckinsey.com", "nielsen.com", "kantar.com",
               "grandviewresearch.com", "mordorintelligence.com", "marketresearch.com", "barclayscorporate.com", "lloydsbankinggroup.com",
               "cleaning-matters.co.uk", "bics.org.uk", "pcfa.org.uk", "ncass.org.uk", "petfoodindustry.com", "pfma.org.uk", "ukpetfood.org")
TIER3_HOSTS = ("bbc.co.uk", "bbc.com", "theguardian.com", "ft.com", "reuters.com", "telegraph.co.uk", "independent.co.uk", "thetimes.co.uk",
               "economist.com", "cityam.com", "which.co.uk", "checkatrade.com", "mybuilder.com", "bark.com", "yell.com", "trustatrader.com",
               "ratedpeople.com", "rated.people.com", "moneysavingexpert.com", "nerdwallet.com", "forbes.com", "bloomberg.com", "businessinsider.com")
NOT_ALLOWED = ("reddit.com", "quora.com", "mumsnet.com", "facebook.com", "twitter.com", "x.com", "tiktok.com", "instagram.com", "pinterest.com",
               "youtube.com", "medium.com", "answers.com", "wikihow.com", "chatgpt.com", "openai.com", "perplexity.ai", "fandom.com", "linkedin.com",
               "forum", "forums", "community.", "boards.")
TIER_WORD = {1: "Tier 1: official statistics or a regulator", 2: "Tier 2: trade body or published industry report", 3: "Tier 3: news, company or price page"}


def host_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower().split(":")[0]
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _matches(host: str, patterns: tuple[str, ...]) -> bool:
    return any(host == p or host.endswith("." + p) or (p.endswith(".") and host.startswith(p)) or (p in ("forum", "forums") and p in host.split(".")) for p in patterns)


def tier_of(url: str) -> int | None:
    """1, 2 or 3; None when the source is not allowed as evidence."""
    host = host_of(url)
    if not host or _matches(host, NOT_ALLOWED) or "/forum" in url.lower() or "/community/" in url.lower():
        return None
    if _matches(host, TIER1_HOSTS) or re.search(r"\.gov(\.[a-z]{2})?$", host) or host.endswith(".gov.uk"):
        return 1
    if _matches(host, TIER2_HOSTS) or re.search(r"(association|federation|institute|council|chamber|society|board)", host):
        return 2
    return 3      # a company's own page, a price listing or a reputable publication: the lowest allowed tier


def publisher_of(url: str, page: dict | None = None) -> str:
    return str((page or {}).get("publisher") or host_of(url))


# ── fetching and checking a page ──────────────────────────────────────────────────────────────────────────────────
_INSTRUCTION = re.compile(r"(?i)(ignore (all |any |the )?(previous|prior|above|earlier) (instructions?|messages?)[^.]*\.?|disregard [^.]{0,80}instructions?[^.]*\.?|"
                          r"you are now [^.]*\.?|system prompt[^.]*\.?|(call|use) the [a-z_ ]*tool[^.]*\.?|send (an )?email[^.]*\.?)")


def _strip(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", raw)
    text = re.sub(r"(?s)<[^>]+>", " ", raw)
    return " ".join(html.unescape(text).split())


def _meta(raw: str, *names: str) -> str:
    for n in names:
        m = re.search(r'(?is)<meta[^>]+(?:property|name|itemprop)=["\']' + re.escape(n) + r'["\'][^>]+content=["\']([^"\']+)', raw) or \
            re.search(r'(?is)<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name|itemprop)=["\']' + re.escape(n), raw)
        if m:
            return html.unescape(m.group(1)).strip()
    return ""


def page_date(raw: str) -> str:
    """The page's publication or update date (ISO), from its own metadata; "" when undated."""
    found = _meta(raw, "article:published_time", "article:modified_time", "datePublished", "dateModified", "date", "dc.date", "DC.date.issued",
                  "og:updated_time", "last-modified")
    if not found:
        m = re.search(r'(?is)<time[^>]+datetime=["\']([^"\']+)', raw) or re.search(r'"date(?:Published|Modified)"\s*:\s*"([^"]+)"', raw)
        found = m.group(1) if m else ""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", found)
    return m.group(1) if m else text_date(_strip(raw))


_MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
                                        "november", "december"), 1)}
_SAID_DATE = re.compile(r"(?i)\b(?:last\s+updated|updated|published|last\s+modified|reviewed)(?:\s+on)?\s*:?\s*(\d{1,2})\s+"
                        r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})")


def text_date(text: str) -> str:
    """A date the page states in its own words ("Last updated 3 April 2025", as gov.uk and council pages print it); "" if none."""
    m = _SAID_DATE.search(text or "")
    if not m:
        return ""
    day, month, year = int(m.group(1)), _MONTHS[m.group(2).lower()], int(m.group(3))
    return f"{year:04d}-{month:02d}-{day:02d}" if 1 <= day <= 31 else ""


def header_date(value: str | None) -> str:
    """The Last-Modified header, as ISO; "" when absent or unreadable."""
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(value).date().isoformat() if value else ""
    except (TypeError, ValueError, IndexError):
        return ""


# A browser's headers: many official and publisher sites refuse an unknown bot (HTTP 403), so a page is read as a person would.
FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
                               "EnterprateAI-research",
                 "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9"}


async def fetch_page(client, url: str) -> dict:
    """{"ok", "url", "text", "title", "publisher", "published"}. Never raises: a page that can't be read is not a source."""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=FETCH_SECONDS, headers=FETCH_HEADERS)
        if resp.status_code != 200 or "html" not in resp.headers.get("content-type", "text/html") and "text" not in resp.headers.get("content-type", ""):
            return {"ok": False, "url": url, "reason": f"HTTP {resp.status_code}"}
        raw = resp.text[:PAGE_BYTES]
    except Exception as e:      # noqa: BLE001
        return {"ok": False, "url": url, "reason": type(e).__name__}
    title = _meta(raw, "og:title") or (re.search(r"(?is)<title[^>]*>(.*?)</title>", raw).group(1).strip() if re.search(r"(?is)<title[^>]*>(.*?)</title>", raw) else "")
    return {"ok": True, "url": str(getattr(resp, "url", url)), "text": _strip(raw), "title": html.unescape(title)[:200],
            "publisher": _meta(raw, "og:site_name", "application-name", "publisher") or host_of(url),
            "published": page_date(raw) or header_date(resp.headers.get("last-modified"))}


async def fetch_all(urls: list[str], fetcher=None) -> dict[str, dict]:
    """Every distinct URL fetched once, side by side. `fetcher(url) -> page dict` stands in for the network in tests."""
    urls = list(dict.fromkeys(u for u in urls if str(u).startswith("http")))
    if fetcher is not None:
        pages = await asyncio.gather(*(fetcher(u) for u in urls))
        return dict(zip(urls, pages))
    import httpx

    async def one(client, u):
        try:
            return await asyncio.wait_for(fetch_page(client, u), FETCH_SECONDS + 2)
        except asyncio.TimeoutError:
            return {"ok": False, "url": u, "why": "took too long to load"}
    async with httpx.AsyncClient() as client:
        pages = await asyncio.gather(*(one(client, u) for u in urls))
    return dict(zip(urls, pages))


def as_data(text: str) -> str:
    """A page's text for the model: data only. Anything that reads as an instruction to the model is removed."""
    return _INSTRUCTION.sub(" [removed: text addressed to an assistant] ", text or "")


def excerpt(text: str, words: list[str], size: int = EXCERPT_CHARS) -> str:
    """The part of a page most about the topic: the window with most topic words, else its start."""
    text = text or ""
    if len(text) <= size:
        return text
    best, at = -1, 0
    low = text.lower()
    keys = [w.lower() for w in words if len(w) > 3]
    for start in range(0, len(text) - size + 1, max(size // 3, 1)):
        hits = sum(low.count(k, start, start + size) for k in keys)
        if hits > best:
            best, at = hits, start
    return text[at:at + size]


def _norm(s: str) -> str:
    s = html.unescape(str(s or "")).lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[–—]", "-", s)
    return " ".join(re.sub(r"[^\w%£$€₦.,'\- ]", " ", s).split())


def sentences(quote: str) -> int:
    return len([x for x in re.split(r"(?<=[.!?])\s+", str(quote or "").strip()) if x])


def quote_on_page(quote: str, page_text: str) -> bool:
    """The quote, case, spacing and punctuation marks aside, is on the page: no more than two sentences, at least six words."""
    q = _norm(quote)
    return bool(q) and len(q.split()) >= 6 and sentences(quote) <= 2 and q.rstrip(".") in _norm(page_text)


def quote_close(quote: str, page_text: str) -> bool:
    """Most of the quote's three-word runs are on the page: what the page says, lightly reworded by the model."""
    words = _norm(quote).rstrip(".").split()
    if len(words) < 6:
        return False
    page = _norm(page_text)
    runs = [" ".join(words[n:n + 3]) for n in range(len(words) - 2)]
    return sum(1 for r in runs if r in page) / len(runs) >= 0.6


# ── region and period ─────────────────────────────────────────────────────────────────────────────────────────────
COUNTRY_WORDS = {"united kingdom": ("uk", "united kingdom", "britain", "great britain", "england", "scotland", "wales", "northern ireland", "gb"),
                 "ireland": ("ireland", "republic of ireland", "roi"), "nigeria": ("nigeria",), "ghana": ("ghana",), "kenya": ("kenya",),
                 "south africa": ("south africa",), "united states": ("us", "usa", "united states", "america"), "canada": ("canada",),
                 "australia": ("australia",), "india": ("india",), "germany": ("germany",), "france": ("france",)}


# A city names its country when the country itself isn't said ("a car wash in Abuja"). The main business cities only:
# a place not listed falls back to the country on record.
CITY_COUNTRY = {
    "nigeria": ("abuja", "lagos", "ikeja", "lekki", "port harcourt", "ibadan", "kano", "kaduna", "enugu", "benin city", "jos", "ilorin",
                "abeokuta", "owerri", "uyo", "calabar", "warri", "onitsha", "akure", "asaba", "fct", "garki", "wuse", "maitama"),
    "ghana": ("accra", "kumasi", "tema", "takoradi", "tamale", "cape coast"),
    "kenya": ("nairobi", "mombasa", "kisumu", "nakuru", "eldoret"),
    "south africa": ("johannesburg", "cape town", "durban", "pretoria", "port elizabeth", "gqeberha", "sandton", "soweto"),
    "united kingdom": ("london", "manchester", "birmingham", "leeds", "liverpool", "bristol", "sheffield", "newcastle", "nottingham",
                       "leicester", "glasgow", "edinburgh", "cardiff", "belfast", "brighton", "oxford", "cambridge", "york", "reading",
                       "southampton", "coventry", "bradford", "milton keynes", "aberdeen", "swansea"),
    "ireland": ("dublin", "cork", "galway", "limerick"),
    "united states": ("new york", "los angeles", "chicago", "houston", "san francisco", "miami", "atlanta", "boston", "seattle", "dallas"),
    "canada": ("toronto", "vancouver", "montreal", "calgary", "ottawa"),
    "india": ("mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "pune"),
}
# Google's country (gl) and language for each country's searches.
SEARCH_LOCALE = {"united kingdom": "uk", "ireland": "ie", "nigeria": "ng", "ghana": "gh", "kenya": "ke", "south africa": "za",
                 "united states": "us", "canada": "ca", "australia": "au", "india": "in", "germany": "de", "france": "fr"}
COUNTRY_CURRENCY = {"united kingdom": "GBP", "nigeria": "NGN", "ghana": "GHS", "kenya": "KES", "south africa": "ZAR", "united states": "USD",
                    "canada": "CAD", "australia": "AUD", "india": "INR", "ireland": "EUR", "germany": "EUR", "france": "EUR"}


def search_locale(country: str | None) -> str | None:
    return SEARCH_LOCALE.get(country_of(country) or "")


def currency_of_country(country: str | None) -> str | None:
    return COUNTRY_CURRENCY.get(country_of(country) or "")


# A currency that belongs to one country names it, when nothing else on record does (EUR is shared, so it doesn't).
CURRENCY_COUNTRY = {"GBP": "united kingdom", "NGN": "nigeria", "GHS": "ghana", "KES": "kenya", "ZAR": "south africa", "USD": "united states",
                    "CAD": "canada", "AUD": "australia", "INR": "india"}


def country_of_currency(code: str | None) -> str:
    return CURRENCY_COUNTRY.get(str(code or "").upper(), "").title()


def country_of(words: str | None) -> str | None:
    """The country a place names: a country ("Nigeria", "UK") or one of its main cities ("Abuja", "Leeds")."""
    w = " ".join(str(words or "").lower().replace(".", "").split())
    if not w:
        return None
    for country, names in COUNTRY_WORDS.items():
        if w in names or any(re.search(rf"\b{re.escape(n)}\b", w) for n in names if len(n) > 2):
            return country
    for country, cities in CITY_COUNTRY.items():
        if any(re.search(rf"\b{re.escape(c)}\b", w) for c in cities):
            return country
    return None


# Where a source is published, from its address: a US federal site is about the US, a .co.uk one about the UK.
HOST_COUNTRY = ((".gov.uk", "united kingdom"), (".uk", "united kingdom"), (".gov.ng", "nigeria"), (".ng", "nigeria"), (".gh", "ghana"),
                (".ke", "kenya"), (".za", "south africa"), (".ie", "ireland"), (".ca", "canada"), (".au", "australia"), (".in", "india"),
                (".de", "germany"), (".fr", "france"), (".gov", "united states"), (".mil", "united states"), (".us", "united states"))


def host_country(url: str | None) -> str | None:
    host = host_of(url or "")
    return next((country for end, country in HOST_COUNTRY if host.endswith(end)), None)


def region_note(source_region: str | None, business_country: str | None, business_city: str | None, url: str | None = None) -> tuple[bool, str]:
    """(usable, what to say). A figure for another country is never this business's; a national one for a city is said.
    With no country on record for the business, no source can be matched to it, so none is used."""
    theirs, ours = country_of(source_region) or host_country(url), country_of(business_country)
    if not ours:
        return False, "The business's country isn't on record, so no source can be matched to where it trades."
    published = host_country(url)
    if published and published != ours and not (country_of(source_region) == ours):
        return False, f"This source is published for {published.title()}, not {business_country}: not used as {business_country} evidence."
    if not source_region:
        return (True, "") if published == ours else (False, "The region the source covers isn't stated.")
    if theirs and theirs != ours:
        return False, f"This source covers {source_region}, not {business_country}: not used as {business_country} evidence."
    if business_city and business_city.lower() not in str(source_region).lower():
        return True, f"A {source_region} figure, used for a {business_city} business."
    return True, ""


# ── an item, judged ───────────────────────────────────────────────────────────────────────────────────────────────
def judge(item: dict, cited: list[dict], pages: dict[str, dict], ctx: dict, now: datetime, figure: bool) -> dict:
    """The item with only its checked sources, labelled Researched, Estimated or Missing, with why.
    `cited`: what the model said each source shows: {url, title, quote, figure, region, period, search_date}."""
    accessed = now.date().isoformat()
    checked, dropped = [], []
    for c in cited:
        url = c.get("url") or ""
        page = pages.get(url) or {}
        tier = tier_of(url)
        why = None
        exact = close = False
        if tier is None:
            why = "not an allowed source (forum, social or AI-written page)"
        elif not page.get("ok"):
            why = f"the page couldn't be loaded ({page.get('reason') or page.get('why') or 'no response'})"
        else:
            exact = quote_on_page(c.get("quote") or "", page.get("text") or "")
            close = exact or quote_close(c.get("quote") or "", page.get("text") or "")
            if not close:      # not on the page even reworded: the model's own words, never a source
                why = "the quoted text isn't on the page"
            elif _norm(c.get("quote") or "").rstrip(".") in _norm(page.get("title") or ""):
                why = "the quote is only the page's title, not what the page says"
        dated = page.get("published") or _iso(c.get("search_date"))
        if not why and dated and dated[:4].isdigit() and int(dated[:4]) < now.year - 3:
            why = f"the page is from {dated[:4]}, more than 3 years old"
        usable, note = region_note(c.get("region"), ctx.get("country"), ctx.get("city"), url)
        if not why and not usable and not note.startswith("The region the source"):
            why = note      # about another country (or no country on record to match it to): not this business's evidence
        if not usable and note.startswith("The region the source"):
            note = "The region this source covers isn't stated."
        if why:
            dropped.append({"url": url, "why": why})
            continue
        checked.append({"url": page.get("url") or url, "title": page.get("title") or c.get("title") or "", "publisher": publisher_of(url, page),
                        "site": host_of(page.get("url") or url),
                        "date": dated or "undated", "undated": not dated, "quote_checked": "exact" if exact else ("close" if close else "unchecked"),
                        "accessed": accessed, "quote": " ".join(str(c.get("quote") or "").split())[:400], "tier": tier,
                        "tier_label": TIER_WORD[tier], "region": c.get("region") or "", "period": c.get("period") or "", "region_note": note,
                        "figure": _num(c.get("figure"))})
    checked.sort(key=lambda s: s["tier"])
    out = {**item, "sources": checked, "dropped_sources": dropped, "retrieved_at": now.isoformat()}
    if not figure:
        if checked:
            return {**out, "kind": "researched", "state": "researched", "label": item.get("label"), "standard": "a checked source supports it"}
        return {**out, "kind": "missing", "state": "missing", "sources": [], "standard": "no checked source supports it"}
    figures = [s for s in checked if s["figure"] is not None]
    if figures:
        values = [s["figure"] for s in figures]
        lo, hi = min(values), max(values)
        independent = len({s["publisher"].lower() for s in figures}) >= 2
        agree = hi <= lo * (1 + FIGURE_TOLERANCE) if lo > 0 else False
        tier1 = [s for s in figures if s["tier"] == 1]
        if tier1:
            return {**out, "kind": "researched", "state": "researched", "number": tier1[0]["figure"], "basis": "researched",
                    "standard": "one Tier 1 source", **({"range": [lo, hi]} if len(values) > 1 and not agree else {})}
        if independent and agree:
            return {**out, "kind": "researched", "state": "researched", "number": round(median(values), 2), "basis": "researched",
                    "standard": f"{len(figures)} independent sources within {int(FIGURE_TOLERANCE * 100)}% of each other"}
        if len(values) > 1 and not agree:
            return {**out, "kind": "estimated", "state": "estimated", "number": item.get("number") or round(median(values), 2), "range": [lo, hi],
                    "basis": "benchmark", "standard": f"sources disagree ({lo:g} to {hi:g}): the range and both sources are shown", "method": item.get("method") or ""}
        # One checked source for this country, its figure on the page: Estimated, with that source and its figure (never
        # the model's own number).
        return {**out, "kind": "estimated", "state": "estimated", "basis": "benchmark", "number": figures[0]["figure"],
                "standard": "not corroborated: needs two agreeing sources or one Tier 1 source", "method": item.get("method") or "taken from one checked source"}
    # No checked source for this country gives the figure: it is asked, never a number the model gave.
    return {**out, "kind": "missing", "state": "missing", "sources": [], "number": None, "standard": "no checked source for this country gives the figure"}


def _num(v: Any) -> float | None:
    try:
        n = float(str(v).replace(",", "").replace("£", "").replace("$", "").replace("€", "").strip())
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _iso(v: Any) -> str:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", str(v or ""))
    if m:
        return m.group(1)
    try:
        return datetime.strptime(str(v).strip(), "%b %d, %Y").date().isoformat()
    except ValueError:
        return ""


def fresh(kind: str, at: str | None, today: date) -> bool:
    """Still current: market and demand evidence 180 days; price, cost, forecast and capacity 30 days."""
    try:
        when = datetime.fromisoformat(str(at)[:19]).date() if at else None
    except ValueError:
        when = None
    return bool(when) and (today - when).days <= FRESH_DAYS.get(kind, 180)


def freshness_kind(field_or_topic: str | None) -> str:
    f = str(field_or_topic or "")
    if f in ("price", "comparable_prices", "positioning"):
        return "price"
    if f in ("cost", "fixed_costs"):
        return "cost"
    if f in ("monthly_sales", "forecast"):
        return "forecast"
    if f in ("capacity", "team_size", "hours_per_job", "hours_per_person"):
        return "capacity"
    return "market"


async def dated_rate(from_currency: str, to_currency: str, today: date) -> dict | None:
    """A currency conversion as it is shown: the rate, its date and where it came from."""
    from app.shared.currency import get_rate
    rate = await get_rate(from_currency, to_currency)
    if rate is None:
        return None
    return {"from": from_currency, "to": to_currency, "rate": rate, "date": today.isoformat(), "source": "exchangerate-api.com"}


def references(items: list[dict]) -> list[dict]:
    """Every checked source behind accepted items, numbered once, for exports (funding pack, plan, launch report)."""
    seen, out = {}, []
    for x in items:
        if x.get("decision") not in ("accepted", "edited"):
            continue
        for s in x.get("sources") or []:
            if s.get("url") in seen or not s.get("quote"):
                continue
            seen[s["url"]] = len(out) + 1
            out.append({"n": len(out) + 1, "title": s.get("title"), "publisher": s.get("publisher"), "date": s.get("date"), "accessed": s.get("accessed"),
                        "url": s["url"], "tier": s.get("tier"), "used_for": x.get("used_for") or x.get("label")})
    return out


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
