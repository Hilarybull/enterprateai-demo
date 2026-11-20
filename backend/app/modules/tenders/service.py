"""Read-only Find a Tender OCDS ingestion and discovery."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, urljoin, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from app.core.supabase import sb_delete, sb_rpc, sb_select, sb_update, sb_upsert
from app.modules.proposals import sourcing

HOST = "www.find-tender.service.gov.uk"
ORIGIN = f"https://{HOST}"
ENDPOINT = "/api/1.0/ocdsReleasePackages"
SOURCE = "find-a-tender"
DETAILS_VERSION = 2
PAGE_LIMIT = 100
STAGES = ("open", "planning", "award", "closed", "other", "all")
NOTICE = re.compile(r"[0-9]{6}-[0-9]{4}")
OCID = re.compile(r"ocds-h6vhtk-[0-9a-f]{6}")
logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc)


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def text(value, limit=300):
    return value.strip()[:limit] or None if isinstance(value, str) else None


def mapping(value):
    return value if isinstance(value, dict) else {}


def objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def classify(tags, tender, lot):
    overall = (text(tender.get("status")) or "").lower()
    state = (text(lot.get("status")) or overall).lower()
    if "tenderCancellation" in tags or {overall, state} & {"cancelled", "unsuccessful", "withdrawn"}:
        return "closed"
    if tags & {"award", "awardUpdate", "contract", "contractUpdate"}:
        return "award"
    if state in ("complete", "closed"):
        return "closed"
    if tags & {"planning", "planningUpdate"} and not tags & {"tender", "tenderUpdate", "tenderAmendment"}:
        return "planning"
    if tags & {"tender", "tenderUpdate", "tenderAmendment"} and state == "active":
        return "open"
    return "other"



def safe_source_url(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ("https", "http") and parsed.hostname and not parsed.username and not parsed.password else None
    except ValueError:
        return None


def notice_sections(tender, lot):
    suitability = mapping(lot.get("suitability"))
    sme = suitability.get("sme", mapping(tender.get("suitability")).get("sme"))
    documents = []
    for doc in [*objects(tender.get("documents")), *objects(lot.get("documents"))]:
        url = safe_source_url(doc.get("url"))
        if url and not any(d["url"] == url for d in documents):
            documents.append({"title": text(doc.get("title")) or "Tender document", "description": text(doc.get("description"), 4000), "url": url})
    instructions = text(lot.get("submissionMethodDetails") or tender.get("submissionMethodDetails"), 16000)
    urls = re.findall(r"https?://[^\s<>\"\']+", instructions or "")
    submission_url = next((safe_source_url(url.rstrip(".,;)]")) for url in urls if safe_source_url(url.rstrip(".,;)]"))), None)
    participation = text(lot.get("eligibilityCriteria") or tender.get("eligibilityCriteria"), 16000)
    suitability = {**mapping(tender.get("suitability")), **suitability}
    labels = [label for key, label in (("sme", "Small and medium-sized enterprises (SME)"),
                                      ("vcse", "Voluntary, community and social enterprises (VCSE)")) if suitability.get(key) is True]
    if labels:
        participation = "\n".join(filter(None, [participation, "Particular suitability: " + "; ".join(labels)]))
    award = text(mapping(lot.get("awardCriteria")).get("description") or mapping(tender.get("awardCriteria")).get("description")
                 or lot.get("awardCriteriaDetails") or tender.get("awardCriteriaDetails"), 16000)
    period = mapping(lot.get("contractPeriod") or tender.get("contractPeriod"))
    return {"projection_version": DETAILS_VERSION, "contract_extension_end": text(period.get("maxExtentDate")),
            "extension_description": text(mapping(lot.get("renewal") or tender.get("renewal")).get("description"), 4000),
            "sme_suitable": sme if isinstance(sme, bool) else None, "submission_url": submission_url, "submission_instructions": instructions,
            "electronic_submission": text(mapping(tender.get("submissionTerms")).get("electronicSubmissionPolicy")),
            "enquiry_deadline": text(mapping(tender.get("enquiryPeriod")).get("endDate")),
            "eligibility": participation,
            "award_criteria": award,
            "procedure": text(tender.get("procurementMethodDetails") or tender.get("procurementMethod"), 4000),
            "contract_start": text(mapping(lot.get("contractPeriod") or tender.get("contractPeriod")).get("startDate")),
            "contract_end": text(mapping(lot.get("contractPeriod") or tender.get("contractPeriod")).get("endDate")),
            "documents": documents[:100]}

def parse_release(raw) -> dict:
    try:
        serialized = json.dumps(raw, ensure_ascii=False, sort_keys=True, allow_nan=False)
        encoded = serialized.encode("utf-8")
        if re.search(r"(?<!\\)(?:\\\\)*\\u0000", serialized):
            raise ValueError("Unsupported PostgreSQL JSONB control character")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        preview = ascii(raw).replace(chr(0), r"\x00")
        return {"version_id": hashlib.sha256(preview.encode()).hexdigest(),
                "payload": {"preview": preview[:16000]}, "ocid": None, "notice_id": None,
                "listings": [], "rejection": "Release contains data that cannot be stored as JSON"}
    release = mapping(raw)
    ocid, notice = release.get("ocid"), release.get("id")
    decoded = {"version_id": hashlib.sha256(encoded).hexdigest(), "payload": raw,
               "ocid": text(ocid), "notice_id": text(notice), "listings": []}
    if not isinstance(ocid, str) or not OCID.fullmatch(ocid) or not isinstance(notice, str) or not NOTICE.fullmatch(notice):
        return {**decoded, "rejection": "Invalid procurement or notice ID"}
    published = timestamp(release.get("date"))
    tags = release.get("tag")
    if not published or not isinstance(tags, list) or not tags or not all(isinstance(tag, str) for tag in tags):
        return {**decoded, "rejection": "Missing release timestamp or lifecycle tags"}
    tags = set(tags)
    tender = mapping(release.get("tender"))
    buyer = mapping(release.get("buyer"))
    buyer_name = text(buyer.get("name"))
    if not buyer_name:
        buyer_name = next((text(p.get("name")) for p in objects(release.get("parties"))
                           if p.get("id") == buyer.get("id") and buyer.get("id")), None)
    awards = objects(release.get("awards"))
    award_lots = {lot for award in awards for lot in (award.get("relatedLots") if isinstance(award.get("relatedLots"), list) else [])
                  if isinstance(lot, str)}
    tender_lots = {lot["id"]: lot for lot in objects(tender.get("lots")) if isinstance(lot.get("id"), str) and lot["id"]}
    stage = classify(tags, tender, {})
    process_ended = stage == "award" and not award_lots and (text(tender.get("status")) or "").lower() in ("complete", "closed")
    if stage == "award":
        scopes = [(lot_id, tender_lots.get(lot_id, {})) for lot_id in sorted(award_lots)] or [(None, {})]
    else:
        scopes = list(tender_lots.items()) or [(None, {})]
    if stage in ("open", "planning") and not text(tender.get("title")) and not any(text(lot.get("title")) for _, lot in scopes):
        return {**decoded, "rejection": "Missing listing title"}
    for lot_id, lot in scopes:
        status = classify(tags, tender, lot)
        if status == "other" and "planning" in tags:
            status = "planning"
        if status == "award":
            award = next((item for item in awards if lot_id is None or (isinstance(item.get("relatedLots"), list) and lot_id in item["relatedLots"])), {})
            value = mapping(award.get("value"))
        else:
            value = mapping(lot.get("value") or (tender.get("value") if lot_id is None else {}))
        amount, currency = value.get("amount"), text(value.get("currency"))
        if (not isinstance(amount, (int, float)) or isinstance(amount, bool) or (isinstance(amount, float) and not math.isfinite(amount))
                or amount < 0 or not currency or not re.fullmatch("[A-Z]{3}", currency)):
            amount = currency = None
        deadline = timestamp(mapping(lot.get("tenderPeriod") or tender.get("tenderPeriod")).get("endDate"))
        items = [i for i in objects(tender.get("items")) if lot_id is None or i.get("relatedLot") == lot_id]
        classification = mapping(lot.get("classification") or tender.get("classification"))
        if not classification:
            classification = next((mapping(i.get("classification")) for i in items if mapping(i.get("classification"))), {})
        classifications = [classification] if classification else []
        for holder in [lot, tender, *items]:
            for entry in [mapping(holder.get("classification")), *objects(holder.get("additionalClassifications"))]:
                if entry.get("scheme") == "CPV" and text(entry.get("id")) and not any(c.get("id") == entry["id"] for c in classifications):
                    classifications.append(entry)
        if not classification and classifications:
            classification = classifications[0]
        regions = {a["region"] for item in items for a in objects(item.get("deliveryAddresses")) if text(a.get("region"))}
        # Planning updates have their own card and cannot overwrite a live competition.
        scope_key = ("planning:" if status == "planning" else "") + ("lot:" + lot_id if lot_id is not None else "process")
        decoded["listings"].append({
            "id": f"{ocid}:{scope_key}", "published_at": published.isoformat(), "stage": status,
            "deadline": deadline.isoformat() if deadline else None,
            "whole_process_closed": process_ended or (stage == "closed" and (lot_id is None or "tenderCancellation" in tags)),
            "details": {"title": text(lot.get("title") or tender.get("title") or release.get("title")),
                        "description": text(lot.get("description") or tender.get("description") or release.get("description"), 16000),
                        "buyer": buyer_name, "lot_id": lot_id, "amount": amount, "currency": currency,
                        "category": text(tender.get("mainProcurementCategory")),
                        "industry": text(classification.get("description")),
                        "cpv_classifications": [{"id": c.get("id"), "description": text(c.get("description"))} for c in classifications],
                        **notice_sections(tender, lot),
                        "cpv": text(classification.get("id"), 30), "region": ", ".join(sorted(regions))[:500] or None},
        })
    return decoded


class FeedError(Exception):
    def __init__(self, message: str, retry_after=300):
        super().__init__(message)
        self.retry_after = retry_after


def retry_seconds(header: str | None) -> int:
    try:
        return max(1, int(header or 300))
    except ValueError:
        try:
            return max(1, math.ceil((parsedate_to_datetime(header) - utc_now()).total_seconds()))
        except (ValueError, TypeError, OverflowError):
            return 300


def next_cursor(link):
    if not isinstance(link, str) or not link:
        raise FeedError("Malformed pagination link")
    try:
        url = urlsplit(urljoin(ORIGIN + ENDPOINT, link))
    except ValueError as exc:
        raise FeedError("Find a Tender returned a malformed pagination link") from exc
    cursor = parse_qs(url.query).get("cursor", [])
    if (url.scheme != "https" or url.netloc != HOST or url.path.lower() != ENDPOINT.lower()
            or len(cursor) != 1 or not 1 <= len(cursor[0]) <= 300):
        raise FeedError("Invalid Find a Tender next page")
    return cursor[0]


async def fetch_package(client, params):
    try:
        response = await client.get(ORIGIN + ENDPOINT, params=params)
        if response.status_code in (429, 503):
            raise FeedError(f"Find a Tender HTTP {response.status_code}", retry_seconds(response.headers.get("Retry-After")))
        if response.status_code != 200:
            raise FeedError(f"Find a Tender HTTP {response.status_code}")
        package = response.json()
        if not isinstance(package, dict) or not isinstance(package.get("releases"), list):
            raise FeedError("Find a Tender returned an invalid release package")
        return package
    except (httpx.HTTPError, ValueError) as exc:
        raise FeedError(f"Find a Tender response failed ({type(exc).__name__})") from exc


async def ingest_window(client, start, end, apply_page, *, pause=asyncio.sleep):
    clock = ZoneInfo("Europe/London")
    params = {"updatedFrom": start.astimezone(clock).strftime("%Y-%m-%dT%H:%M:%S"),
              "updatedTo": end.astimezone(clock).strftime("%Y-%m-%dT%H:%M:%S"), "limit": PAGE_LIMIT}
    seen = set()
    summary = {"pages": 0, "seen": 0, "imported": 0, "quarantined": 0}
    for _ in range(50):
        package = await fetch_package(client, params)
        rows = [parse_release(item) for item in package["releases"]]
        summary["pages"] += 1
        summary["seen"] += len(rows)
        summary["quarantined"] += sum(bool(item.get("rejection")) for item in rows)
        summary["imported"] += await apply_page(rows)
        link = mapping(package.get("links")).get("next")
        if not link:
            return summary
        cursor = next_cursor(link)
        if cursor in seen:
            raise FeedError("Find a Tender repeated a pagination cursor")
        seen.add(cursor)
        params["cursor"] = cursor
        await pause(12)
    raise FeedError("Find a Tender window exceeded 50 pages")


def enabled():
    return os.getenv("FTS_SYNC_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def automatic_enabled(row):
    setting = row.get("automatic_sync")
    return enabled() if setting is None else setting is True


async def scheduled_sync_enabled():
    row = await sb_select("fts_sync", filters=[("id", "eq", SOURCE)], single=True) or {}
    return automatic_enabled(row)


async def set_automatic_sync(value, *, interval_minutes=None, import_scope=None):
    payload = {"automatic_sync": value}
    result = {"scheduled": value}
    if interval_minutes is not None:
        payload["interval_minutes"] = interval_minutes
        result["interval_minutes"] = interval_minutes
    if import_scope is not None:
        payload["import_scope"] = import_scope
        result["import_scope"] = import_scope
    try:
        updated = await sb_update("fts_sync", filters=[("id", "eq", SOURCE)], payload=payload)
    except Exception as exc:
        logger.warning("Could not save automatic tender sync", exc_info=True)
        raise HTTPException(503, "Could not save the schedule. Check that the tender sync migrations are applied.") from exc
    if not updated:
        raise HTTPException(503, "The tender sync configuration is unavailable.")
    return result


async def sync_once(*, manual=False):
    now = utc_now()
    lease = str(uuid4())
    rows = await sb_rpc("fts_acquire", {"p_lease": lease, "p_now": now.isoformat(), "p_manual": manual})
    if not rows:
        return {"status": "deferred"}
    checkpoint = timestamp(rows[0]["checkpoint"])
    end = min(now.replace(microsecond=0), checkpoint + timedelta(hours=12))
    start = checkpoint - timedelta(minutes=5)
    filters = [("id", "eq", SOURCE), ("lease_id", "eq", lease)]
    async def apply_page(items):
        try:
            return int(await sb_rpc("fts_apply_page", {"p_lease": lease, "p_rows": items}) or 0)
        except Exception as exc:
            raise FeedError("Could not save a Find a Tender release page") from exc
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, headers={
            "Accept": "application/json", "User-Agent": "EnterprateAI public tender discovery"
        }) as client:
            summary = await ingest_window(client, start, end, apply_page)
        await sb_update("fts_sync", filters=filters, payload={"checkpoint": end.isoformat(),
                        "last_success": utc_now().isoformat(), "retry_at": None, "error": None,
                        "summary": summary, "lease_id": None, "lease_until": None})
        return {"status": "synced", **summary}
    except Exception as exc:
        delay = exc.retry_after if isinstance(exc, FeedError) else 300
        error = str(exc) if isinstance(exc, FeedError) else "Could not finish the Find a Tender import"
        logger.warning("Find a Tender import: %s", error, exc_info=True)
        # Keep the old checkpoint so partially committed pages replay safely.
        await sb_update("fts_sync", filters=filters, payload={"error": error, "retry_at": (
            utc_now() + timedelta(seconds=delay)).isoformat(), "lease_id": None, "lease_until": None})
        return {"status": "failed", "error": error}


def public_listing(row):
    details = {key: value for key, value in row["details"].items() if key != "whole_process_closed"}
    deadline = timestamp(row.get("deadline"))
    stage = "closed" if row["stage"] == "open" and deadline and deadline <= utc_now() else row["stage"]
    return {"id": row["id"], "ocid": row["ocid"], "notice_id": row["notice_id"], "status": stage,
            "source": "Find a Tender", "url": f'{ORIGIN}/Notice/{row["notice_id"]}',
            "published_at": row["published_at"], "deadline": row["deadline"], "observed_at": row.get("observed_at"), **details}


async def sync_health():
    try:
        row = await sb_select("fts_sync", filters=[("id", "eq", SOURCE)], single=True) or {}
    except Exception as exc:
        raise HTTPException(503, "The tender index is unavailable.") from exc
    last, checkpoint = timestamp(row.get("last_success")), timestamp(row.get("checkpoint"))
    return {"last_sync": row.get("last_success"), "checkpoint": row.get("checkpoint"),
            "stale": not last or not checkpoint or utc_now() - min(last, checkpoint) > timedelta(hours=6),
            "running": bool(timestamp(row.get("lease_until")) and timestamp(row.get("lease_until")) > utc_now()),
            "last_attempt": row.get("last_attempt"), "retry_at": row.get("retry_at"), "error": row.get("error"),
            "history_available": "error_dismissed_for" in row,
            "error_dismissed": bool(row.get("error") and row.get("last_attempt") and
                                    row.get("error_dismissed_for") == row.get("last_attempt")),
            "summary": row.get("summary"), "scheduled": automatic_enabled(row), "schedule_configurable": "automatic_sync" in row,
            "preferences_configurable": "interval_minutes" in row and "import_scope" in row,
            "interval_minutes": row.get("interval_minutes", 180), "import_scope": row.get("import_scope", "all")}


async def sync_history():
    return await sb_select("fts_sync_history", order="attempted_at", desc=True, limit=30) or []


async def dismiss_sync_error(attempt):
    rows = await sb_update(
        "fts_sync",
        filters=[("id", "eq", SOURCE), ("last_attempt", "eq", attempt.isoformat())],
        payload={"error_dismissed_for": attempt.isoformat()},
    )
    if not rows:
        raise HTTPException(409, "The sync attempt has changed. Refresh and try again.")
    return {"dismissed": True}


def industry_matches(details, industry):
    codes = [details.get("cpv"), *[item.get("id") for item in objects(details.get("cpv_classifications"))]]
    return any(isinstance(code, str) and code.startswith(industry) for code in codes)


async def search(q="", stage="open", page=1, limit=24, industry="", location="", category="", deadline_from=None, deadline_to=None, sme="suitable"):
    query = " ".join(re.findall(r"[\w-]+", q)[:16])
    try:
        parameters = {"p_query": query, "p_stage": stage,
            "p_limit": limit, "p_offset": (page - 1) * limit, "p_industry": industry,
            "p_location": location, "p_category": category,
            "p_deadline_from": deadline_from, "p_deadline_to": deadline_to, "p_sme": sme}
        if industry:
            # Read the existing filtered index, not the feed. A notice may have several CPVs;
            # the legacy RPC only checks the primary code. Match all codes before paginating.
            parameters.update(p_limit=50, p_offset=0, p_industry="")
            existing = await sb_rpc("fts_discover_sme", parameters) or {}
            rows = list(existing.get("items") or [])
            total_existing = existing.get("total", len(rows))
            for offset in range(50, total_existing, 50):
                batch = await sb_rpc("fts_discover_sme", {**parameters, "p_offset": offset}) or {}
                rows.extend(batch.get("items") or [])
            unique = {row["id"]: row for row in rows}
            matched = [row for row in unique.values() if industry_matches(row.get("details") or {}, industry)]
            offset = (page - 1) * limit
            result = {"items": matched[offset:offset + limit], "total": len(matched)}
        else:
            result = await sb_rpc("fts_discover_sme", parameters) or {}
    except Exception as exc:
        logger.exception("Tender discovery query failed; verify migrations 054 and 055 are applied")
        raise HTTPException(503, "Tender search is temporarily unavailable. Please try again.") from exc
    health = await sync_health()
    rows, total = result.get("items", []), result.get("total", 0)
    return {"items": [public_listing(row) for row in rows], "total": total,
            "more": page * limit < total, "page": page, "page_size": limit,
            "last_sync": health["last_sync"], "stale": health["stale"]}


async def get_listing(listing_id):
    try:
        row = await sb_select("fts_listings", filters=[("id", "eq", listing_id)], single=True)
    except Exception as exc:
        raise HTTPException(503, "The tender index is unavailable.") from exc
    if not row or not row["details"].get("title"):
        raise HTTPException(404, "Tender listing not found.")
    if row["details"].get("projection_version", 0) < DETAILS_VERSION:
        history = await sb_select("fts_release_history", filters=[("notice_id", "eq", row["notice_id"]), ("ocid", "eq", row["ocid"])], order="observed_at", desc=True, limit=1) or []
        if history:
            parsed = parse_release(history[0].get("payload"))
            projection = next((item for item in parsed.get("listings", []) if item["id"] == row["id"]), None)
            if projection:
                row = {**row, "details": {**row["details"], **{key: value for key, value in projection["details"].items() if value is not None and value != []}}}
    health = await sync_health()
    return {**public_listing(row), "last_sync": health["last_sync"], "stale": health["stale"]}


async def watchlist(user_id, workspace_id):
    await sourcing.require_workspace(user_id, workspace_id)
    scope = [("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id)]
    saved = await sb_select("fts_watchlist", filters=scope, columns="listing_id", order="saved_at", desc=True) or []
    ids = [row["listing_id"] for row in saved]
    rows = await sb_select("fts_listings", filters=[("id", "in", ids)]) if ids else []
    by_id = {row["id"]: public_listing(row) for row in rows or [] if row["details"].get("title")}
    return {"items": [by_id[id_] for id_ in ids if id_ in by_id]}


async def set_saved(user_id, workspace_id, listing_id, saved):
    await sourcing.require_workspace(user_id, workspace_id)
    scope = [("workspace_id", "eq", workspace_id), ("user_id", "eq", user_id), ("listing_id", "eq", listing_id)]
    if saved:
        await get_listing(listing_id)
        await sb_upsert("fts_watchlist", payload={"workspace_id": workspace_id, "user_id": user_id, "listing_id": listing_id},
                        on_conflict="workspace_id,user_id,listing_id")
    else:
        await sb_delete("fts_watchlist", filters=scope)
    return {"saved": saved}


def conversation_filters(brief, query=None, stage=None):
    if stage not in STAGES:
        stage = next((value for expression, value in ((r"\bclosed\b", "closed"), (r"\bawards?\b", "award"),
                                                       (r"\bplanning\b", "planning"), (r"\ball\b", "all"))
                      if re.search(expression, brief, re.I)), "open")
    if not isinstance(query, str):
        query = re.sub(r"\b(?:show|find|search|browse|list|me|any|the|for|in|uk|public|open|tenders?|opportunities|notices|closed|awards?|planning|all)\b",
                       " ", brief, flags=re.I)
    return " ".join(re.findall(r"[\w-]+", query))[:150], stage
