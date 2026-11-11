"""Marketplace Business Index and Claim (PRD-MKT-GTM-001; Claim UX Flows v0.1).

A directory profile is a sourced, public projection of a business: it is not a tenant, has no
login and grants nobody access to anything. Claiming one proves authority to manage it and
then links it to exactly one canonical business (a workspace): an existing one the claimant
owns, or a new one created through the same gateway a homepage signup uses. Nothing here
decides a dashboard stage, scores a business or approves a claim with a language model.

Records share the generic store (id, scope, kind, subject_id, status, revision, key, data).
Public index records live under the scope "marketplace"; a business's own Marketplace settings
live in that business's data and are written through the business gateway.
"""
from __future__ import annotations

import copy
import hashlib
import logging
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

from app.modules.agent import business as bz
from app.modules.readiness.store import Duplicate, MemoryStore, NotSetUp, Store

logger = logging.getLogger(__name__)

SCOPE = "marketplace"
TABLES = {
    "profiles": "marketplace_directory_profiles",          # MarketplaceDirectoryProfile (key = public slug)
    "identities": "marketplace_directory_identities",      # one row per external identity key -> profile (deduplication)
    "snapshots": "marketplace_index_snapshots",            # IndexSourceSnapshot: what was sourced, from where, when
    "claims": "marketplace_business_claims",               # BusinessClaim (key = profile:user while open)
    "verifications": "marketplace_claim_verifications",    # ClaimVerification
    "invitations": "marketplace_claim_invitations",        # ClaimInvitation (key = token hash)
    "intents": "marketplace_claim_intents",                # claim context kept through sign-in (key = token hash)
    "reports": "marketplace_directory_reports",            # corrections, unlist requests, opt-outs
    "events": "marketplace_events",                        # audit and funnel events
    "requests": "marketplace_held_requests",               # quotes and questions sent to a profile nobody has claimed yet
}
FILES_BUCKET = "marketplace-claim-evidence"

RULESET_VERSION = "index-0.1"
MATCH_RULESET_VERSION = "match-0.1"
CLAIM_STATES = ("claim_started", "verification_pending", "verified", "rejected", "disputed", "revoked", "cancelled")
OPEN_CLAIM_STATES = ("claim_started", "verification_pending", "disputed")
OPPORTUNITY_TYPES = ("enquiries", "rfqs", "proposals", "partnerships", "subcontracting")

# First cohort: digitally active, service-led businesses (a go-to-market setting, not an ontology rule).
TARGET_CATEGORIES = ("Professional Services", "Consulting", "Technology", "Marketing & Creative", "Finance & Accounting", "Legal",
                     "Design", "Training & Education", "HR & Recruitment", "IT Services", "Business Services")
DISALLOWED_CATEGORIES = ("Adult", "Gambling", "Weapons", "Tobacco")
FREE_MAIL = ("gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "icloud.com",
             "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "msn.com", "btinternet.com", "sky.com")

TRUST = {
    # Set up by the business from its own EnterprateAI account. Nobody has checked who is behind it.
    "created": {"state": "created", "label": "Created on EnterprateAI \u00b7 not verified",
                "meaning": "This profile was set up by the business from its own EnterprateAI account. Nobody has checked who is behind it yet."},
    "unclaimed": {"state": "unclaimed", "label": "Public listing",
                  "meaning": "This profile is built from public sources. The business has not yet confirmed it on EnterprateAI."},
    "verified": {"state": "verified", "label": "Owner-verified",
                 "meaning": "Someone with authority to manage this business has confirmed this profile. It is not a rating of quality or financial health."},
    "disputed": {"state": "disputed", "label": "Ownership under review",
                 "meaning": "Who manages this profile is being reviewed. Changes to it are paused until that is settled."},
}
CODE_TTL = timedelta(minutes=30)
CODE_ATTEMPTS = 5
CODE_SENDS_PER_HOUR = 5
CLAIMS_PER_DAY = 5
INVITE_GAP = timedelta(days=30)
REMINDER_GAP = timedelta(days=3)      # just listed: the first weekly reminder waits for the next Monday
HAND_SENT = ("profile_control", "opportunity")      # what the 30 day gap is for: the automatic emails have their own schedule
MAX_TEXT = 2000
MAX_FILE_BYTES = 10 * 1024 * 1024
FILE_TYPES = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg"}
ADMIN_EMAIL = "tech.support@enterprateai.com"
# States in which a business holds the profile: it made it itself, or its claim was verified.
HELD_STATES = ("created", "verified", "disputed")
# Why control of a profile is removed. A revocation always names one.
REVOKE_CATEGORIES = {
    "no_longer_authorised": "The person no longer has authority over the business",
    "verified_in_error": "The claim was verified in error",
    "fraud_or_impersonation": "Fraud or impersonation",
    "owner_request": "The business asked for it",
    "policy": "A breach of Marketplace policy",
    "other": "Another reason (explained in the reason given)",
}
# Who can see a profile nobody has claimed yet. Profiles a business holds are never affected.
VISIBILITY_LEVELS = {
    "admin_only": ("Moderators only", "Unclaimed profiles are hidden from the directory, search and search engines. Only moderators see them, "
                                      "plus anyone opening a claim invitation link for that profile."),
    "invite_only": ("Invitation or exact match", "Unclaimed profiles are hidden from the directory, search and search engines. They open from a claim invitation "
                                                 "link, or when someone finds their own business by its exact name with its company number or website."),
    "public": ("Public", "Unclaimed profiles are listed in the directory and can be found by anyone."),
}
VISIBILITY_KEY = "setting:unclaimed_visibility"
VISIBILITY_CACHE_SECONDS = 30
HELD_REQUESTS_PER_PROFILE = 200          # waiting at once on one unclaimed profile
HELD_REQUESTS_PER_SENDER_DAY = 5         # from one address to one profile
TEAM_KEY = "setting:marketplace_team"      # the internal team the administrator keeps: emails, who added them and when
TEAM_CACHE_SECONDS = 30                    # read at most this often; a change made here applies at once
INVITE_TTL = timedelta(days=60)          # how long an invitation link opens its profile
LOOKUP_GRANT_TTL = timedelta(hours=24)   # how long an exact-match lookup opens the profile it found
LOOKUPS_PER_HOUR = 10
REVIEW_MODES = ("off", "post_publish", "pre_publish")
# A moderator can set one unclaimed profile's visibility apart from the global level. "inherit" follows the global one.
PROFILE_VISIBILITY = {"inherit": None, "hidden": "admin_only", "invite_only": "invite_only", "public": "public"}
VISIBILITY_WORDS = {"admin_only": "Moderators only", "invite_only": "Invite only", "public": "Public"}
# The Marketplace's categories, for records added by hand.
CATEGORIES = (*TARGET_CATEGORIES, "Accounting", "Construction & Trades", "Retail", "Hospitality", "Health & Wellbeing", "Manufacturing", "Property", "Transport & Logistics", "Other")
SOURCE_PROVIDERS = ("Companies House", "Company website", "Manual research", "Other")
MANUAL_FIELDS = ("name", "trading_name", "company_number", "country", "category", "location", "website", "description", "service_tags", "business_status", "contact_email", "contact_phone", "logo_data_url")


LOGO_MAX_CHARS = 60_000      # about 45 KB: the page shrinks a logo before sending it, and every directory card carries it


def clean_logo(value: Any) -> str | None:
    """A small image as a data URL, or None. Nothing else is ever stored or shown as a logo."""
    text = str(value or "")
    return text if len(text) <= LOGO_MAX_CHARS and re.match(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$", text) else None


def level_for(d: dict, global_level: str) -> str:
    """The visibility that applies to one unclaimed profile: its own setting if a moderator gave it one, otherwise the global level."""
    return PROFILE_VISIBILITY.get(d.get("visibility") or "inherit") or global_level
REVIEW_SLA = timedelta(hours=24)       # how soon a person should have looked at a newly published self-made profile
# A reviewer who made a claim on a profile stays a party to it for this long after it closed.
PARTY_WINDOW = timedelta(days=180)
PARTY_MESSAGE = {
    "claimant": "You can't review your own claim. Another reviewer needs to decide it.",
    "competitor": "You have, or recently had, a claim of your own on this profile, so you can't decide this one. Another reviewer needs to decide it.",
    "member": "You can't decide a claim about a business you belong to. Another reviewer needs to decide it.",
}


def _moderators() -> set[str]:
    """Extra moderators for development and test (MARKETPLACE_MODERATORS). Never in production."""
    try:
        from app.core.config import get_settings
        settings = get_settings()
        if str(settings.environment or "").lower() in ("production", "prod"):
            return set()
        return {e.strip().lower() for e in str(settings.marketplace_moderators or "").split(",") if e.strip()}
    except Exception:      # noqa: BLE001 - no settings: nobody extra
        return set()


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


class Invalid(Exception):
    def __init__(self, errors: dict[str, str] | str):
        self.errors = errors if isinstance(errors, dict) else {"_": errors}
        super().__init__(next(iter(self.errors.values())))


class Conflict(Exception):
    def __init__(self, code: str, message: str, detail: dict | None = None):
        self.code, self.message, self.detail = code, message, detail or {}
        super().__init__(message)


class RateLimited(Exception):
    pass


def _with_public_services(settings: dict, profile: dict | None) -> dict:
    """A claimed profile's services are already public, so they count without the owner saving anything. If the owner
    cleared them, the profile holds none and nothing comes back."""
    d = (profile or {}).get("data") or {}
    if d.get("linked_business_id") and d.get("origin") != "created" and not settings["profile"]["service_tags"]:
        settings["profile"]["service_tags"] = [t.get("tag") for t in d.get("service_tags") or [] if isinstance(t, dict) and t.get("tag")]
    return settings


def _keep_public_services(marketplace: dict, profile_data: dict) -> None:
    """Services already public on the profile stay on it once claimed. Services the owner has already set are theirs."""
    public = dict(marketplace.get("profile") or {})
    tags = [t.get("tag") for t in profile_data.get("service_tags") or [] if isinstance(t, dict) and t.get("tag")]
    if tags and not public.get("service_tags"):
        public["service_tags"] = tags
        marketplace["profile"] = public


WORKSPACE_KEPT = timedelta(days=30)      # how long a workspace closed by a revocation can still be put back


def _addresses(*found: Any) -> list[str]:
    """Each real email address once, ignoring case."""
    out: dict[str, str] = {}
    for a in found:
        a = str(a or "").strip()
        if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", a):
            out.setdefault(a.lower(), a)
    return list(out.values())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "").strip()[:limit]


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(text or "").lower())).strip("-")[:80] or "business"


def domain_of(url: str | None) -> str | None:
    """The registrable host of a website address, lower-case, without www."""
    text = str(url or "").strip().lower()
    if not text:
        return None
    text = re.sub(r"^[a-z]+://", "", text).split("/")[0].split("?")[0].split("@")[-1].split(":")[0]
    text = text[4:] if text.startswith("www.") else text
    return text if re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", text) else None


_POSTCODE = r"\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b"
_STREET_END = r"\b(street|st|road|rd|avenue|ave|lane|ln|drive|close|court|crescent|terrace|square|way|boulevard|blvd)\.?$"
_PREMISES_START = r"^(\d|unit\b|suite\b|floor\b|flat\b|apartment\b|apt\b|building\b|po box\b|p\.o\.)"


def town_of(location: Any) -> tuple[str | None, bool]:
    """(town or region, whether anything was removed). House numbers, street names, premises and
    full postcodes are dropped; a location that was only a postcode keeps its outward half."""
    text = _text(location, 200)
    if not text:
        return None, False
    parts, removed, outward = [], False, None
    for part in re.split(r"[,;\n]+", text):
        found = re.search(_POSTCODE, part, flags=re.I)
        if found:
            outward, removed = found.group(1).upper(), True
            part = re.sub(_POSTCODE, " ", part, flags=re.I)
        part = " ".join(part.split())
        if not part:
            continue
        if re.search(_PREMISES_START, part, flags=re.I) or re.search(_STREET_END, part, flags=re.I):
            removed = True
            continue
        parts.append(part)
    town = ", ".join(parts[:2]) or outward
    return (town[:80] if town else None), removed or len(parts) > 2


def _norm_name(name: str) -> str:
    return " ".join(re.sub(r"\b(ltd|limited|llp|plc|inc|co|company|the)\b", "", re.sub(r"[^a-z0-9 ]+", " ", str(name or "").lower())).split())


def name_likeness(typed: str, name: str) -> float:
    """How well what someone is typing fits a business name, 0 to 1. Starting or containing it counts most; from three
    letters, a close spelling counts too, word by word ("blu shrak" finds Blue Shark Design)."""
    wanted, have = _norm_name(typed), _norm_name(name)
    if len(wanted) < 2 or not have:
        return 0.0
    if have.startswith(wanted):
        return 1.0
    if wanted in have:
        return 0.9
    if len(wanted) < 3:
        return 0.0
    words = have.split()

    def fit(word: str) -> float:
        return max((1.0 if w.startswith(word) else SequenceMatcher(None, word, w).ratio()) for w in words)
    typed_words = wanted.split()
    # Only as much of a long name as was typed: "bluee sh" is still on its way to "blue shark design"
    return max(sum(fit(w) for w in typed_words) / len(typed_words) * 0.85, SequenceMatcher(None, wanted, have[:len(wanted) + 2]).ratio() * 0.85)


def country_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    return "GB" if text in ("", "UK", "GB", "UNITED KINGDOM", "GREAT BRITAIN", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN IRELAND") else text[:2]


def identity_keys(record: dict) -> list[str]:
    """Keys that identify the same business across sources, strongest first."""
    keys = []
    number = re.sub(r"[^A-Z0-9]", "", str(record.get("company_number") or "").upper())
    country = country_code(record.get("country"))
    if number:
        keys.append(f"reg:{country}:{number}")
    if domain_of(record.get("website")):
        keys.append(f"domain:{domain_of(record.get('website'))}")
    if record.get("name"):
        keys.append(f"name:{_norm_name(record['name'])}|{slugify(record.get('location') or '')}")
    return keys


# ── index rules (versioned, deterministic, explainable) ───────────────────────

def assess_index_record(record: dict) -> dict:
    """Fit band, quality score and publication state for a sourced record, with the reasons."""
    reasons: list[str] = []
    status = str(record.get("business_status") or "active").lower()
    category = _text(record.get("category"), 80)
    source = record.get("source") or {}
    if status != "active":
        return {"band": "excluded", "quality": 0, "publication": "unpublished", "reasons": [f"Business status is {status}."], "ruleset": RULESET_VERSION}
    if not source.get("provider") or not source.get("record_id"):
        return {"band": "excluded", "quality": 0, "publication": "unpublished", "reasons": ["No source reference, so its provenance can't be kept."], "ruleset": RULESET_VERSION}
    if category in DISALLOWED_CATEGORIES or record.get("privacy_risk"):
        return {"band": "excluded", "quality": 0, "publication": "unpublished",
                "reasons": ["Category is not listed on the Marketplace." if category in DISALLOWED_CATEGORIES else "Flagged as a privacy risk."], "ruleset": RULESET_VERSION}
    points = 0
    for ok, value, label in ((bool(category), 2, "category"), (len(_text(record.get("description"))) >= 40, 2, "description"),
                             (bool(domain_of(record.get("website"))), 2, "website"), (bool(_text(record.get("location"))), 1, "location"),
                             (bool(record.get("service_tags")), 2, "service tags"), (bool(record.get("company_number")), 1, "registered number")):
        if ok:
            points += value
        else:
            reasons.append(f"No {label}.")
    target = category in TARGET_CATEGORIES
    has_site = bool(domain_of(record.get("website")))
    band = "high" if target and has_site else "medium" if target or has_site else "low"
    publication = "published" if points >= 6 and band in ("high", "medium") else "noindex" if points >= 3 else "unpublished"
    return {"band": band, "quality": points, "publication": publication, "reasons": reasons, "ruleset": RULESET_VERSION}


def match_opportunity(candidate: dict, opportunity: dict) -> dict:
    """Whether a business (or an unclaimed profile) is eligible for an opportunity, and why.
    Deterministic gates only: nothing here ranks suppliers or recommends one to a buyer."""
    reasons, failed = [], []
    wanted = {str(c).strip().lower() for c in opportunity.get("categories") or [] if c}
    have = {str(c).strip().lower() for c in [candidate.get("category"), *(candidate.get("service_tags") or [])] if c}
    if wanted and not wanted & have:
        failed.append("No category or service in common with the request.")
    elif wanted:
        reasons.append("Category or service matches: " + ", ".join(sorted(wanted & have)) + ".")
    place = str(opportunity.get("location") or "").strip().lower()
    if place and not opportunity.get("remote_ok"):
        where = " ".join(str(candidate.get(k) or "") for k in ("location", "service_area")).lower()
        (reasons if place in where else failed).append("Location matches the request." if place in where else "Outside the request's location.")
    if candidate.get("claim_state") == "disputed" or candidate.get("publication") in ("suppressed", "unpublished"):
        failed.append("The profile is not available for matching.")
    kind = opportunity.get("type") or "proposals"
    if candidate.get("claimed") and not (candidate.get("preferences") or {}).get(kind):
        failed.append("The business has not opted in to this kind of opportunity.")
    if opportunity.get("status") not in (None, "open", "PUBLISHED", "published"):
        failed.append("The request is no longer open.")
    return {"eligible": not failed, "reasons": reasons, "failed": failed, "ruleset": MATCH_RULESET_VERSION}


# ── public settings held in the business's own data ───────────────────────────

def marketplace_settings(data: dict) -> dict:
    """A business's public Marketplace settings, with defaults. Read-only view of its data."""
    m = data.get("marketplace") or {}
    profile = data.get("workspace_profile") or {}
    public = m.get("profile") or {}
    prefs = m.get("opportunity_preferences") or {}
    proposals = data.get("proposal_preferences") or {}
    products = [p for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict) and p.get("name") and not p.get("archived")]
    return {
        "directory_profile_id": m.get("directory_profile_id"),
        "is_published": bool(m.get("is_active")), "published_at": m.get("published_at"), "activated_at": m.get("activated_at"),
        "profile": {
            "name": profile.get("company_name") or "",
            "description": public.get("description") or profile.get("about_company") or "",
            "website": public.get("website") or profile.get("website") or "",
            "service_area": public.get("service_area") or ", ".join(x for x in (profile.get("city"), profile.get("country")) if x),
            "contact_preference": public.get("contact_preference") or "enquiry_form",
            # Entered by the owner for the public. The account and workspace addresses are never used here.
            "public_email": public.get("public_email") or "", "public_phone": public.get("public_phone") or "",
            "service_tags": list(public.get("service_tags") or []),
            "revision": int(public.get("revision") or 0), "updated_at": public.get("updated_at"), "updated_by": public.get("updated_by"),
        },
        "offerings": [{"id": str(p.get("id")), "name": p.get("name"), "description": p.get("description") or "", "published": bool(p.get("marketplace_listed", True))} for p in products],
        "preferences": {
            "enquiries": {"enabled": bool((prefs.get("enquiries") or {}).get("enabled"))},
            "rfqs": {"enabled": bool((prefs.get("rfqs") or {}).get("enabled")), "categories": list((prefs.get("rfqs") or {}).get("categories") or []),
                     "service_areas": list((prefs.get("rfqs") or {}).get("service_areas") or [])},
            # Proposals are owned by Proposal Intelligence: shown here, written through its own writer.
            "proposals": {"enabled": bool(proposals.get("enabled")), "accepted_modes": list(proposals.get("accepted_modes") or ["general"])},
            "partnerships": {"enabled": bool((prefs.get("partnerships") or {}).get("enabled")), "notes": (prefs.get("partnerships") or {}).get("notes") or ""},
            "subcontracting": {"enabled": bool((prefs.get("subcontracting") or {}).get("enabled")), "notes": (prefs.get("subcontracting") or {}).get("notes") or ""},
            "notifications": {"email": bool((prefs.get("notifications") or {}).get("email", True))},
            "version": int(prefs.get("version") or 0),
        },
    }


def public_contact(data: dict) -> dict:
    """The contact route a business chose to show. An address or number appears only when the
    owner picked that method and typed a public one in; nothing falls back to the account or
    workspace email (PRD 8.3, AC-12)."""
    public = (data.get("marketplace") or {}).get("profile") or {}
    method = public.get("contact_preference") or "enquiry_form"
    email = str(public.get("public_email") or "").strip() if method == "email" else ""
    phone = str(public.get("public_phone") or "").strip() if method == "phone" else ""
    return {"method": method, "email": email or None, "phone": phone or None}


# Names a workspace has before anyone has named the business. None of them can be published or become an address.
PLACEHOLDER_NAMES = ("", "business", "my business", "my workspace", "workspace", "unnamed", "untitled", "untitled business", "new business", "company", "my company")


def real_name(name: Any) -> bool:
    return " ".join(str(name or "").lower().split()) not in PLACEHOLDER_NAMES and len(str(name or "").strip()) >= 2


def real_text(text: Any, *, least: int = 20, words: int = 3) -> bool:
    """Words someone could read: long enough, more than one word, and not a key held down or mashed."""
    t = " ".join(str(text or "").split())
    if len(t) < least or len(t.split()) < words:
        return False
    if re.search(r"(.)\1{4,}", t, re.I):      # the same character five times running
        return False
    return len({c for c in t.lower() if c.isalpha()}) >= 5


def listing_quality(settings: dict) -> dict[str, str]:
    """What stops a profile being shown to the public, by checklist row. Empty when it is good enough to list.
    A listing is a business's shop window: placeholder text in it reflects on every business beside it."""
    p = settings["profile"]
    problems: dict[str, str] = {}
    described = str(p["description"] or "").strip()
    if len(described) >= 20 and not real_text(described):
        problems["description"] = "Write a real description: a sentence or two on what you do and who for, not repeated characters."
    shown = [o for o in settings["offerings"] if o["published"]]
    if shown and not any(real_text(o.get("description"), least=10, words=2) for o in shown) and not p["service_tags"]:
        problems["offering"] = "Add a short description to at least one offering you show (in your Catalogue), or list your services."
    return problems


def activation_of(settings: dict, *, verified_claim: bool) -> dict:
    """The activation checklist. North star: verified claim + linked business + a complete
    enough profile + at least one public offering or service + at least one opportunity mode."""
    p = settings["profile"]
    offered = any(o["published"] for o in settings["offerings"]) or bool(p["service_tags"])
    modes = [k for k in OPPORTUNITY_TYPES if settings["preferences"][k]["enabled"]]
    poor = listing_quality(settings)
    items = [
        {"key": "claim", "label": "Profile claimed and verified", "done": verified_claim, "optional": True},
        {"key": "name", "label": "A business name", "done": real_name(p["name"])},
        {"key": "description", "label": "A public description (at least 20 characters)", "done": len(p["description"].strip()) >= 20 and "description" not in poor,
         **({"fix": poor["description"]} if "description" in poor else {})},
        {"key": "service_area", "label": "A location or service area", "done": bool(p["service_area"].strip())},
        {"key": "offering", "label": "At least one public offering or service", "done": offered and "offering" not in poor,
         **({"fix": poor["offering"]} if "offering" in poor else {})},
        {"key": "opportunity", "label": "At least one kind of opportunity switched on", "done": bool(modes)},
    ]
    ready = all(i["done"] for i in items if not i.get("optional"))
    return {"items": items, "ready": ready, "enabled_modes": modes, "counts_as_activated_claim": ready and verified_claim}


class DirectoryService:
    def __init__(self, *, store: Store, business: bz.Business, clock: Callable[[], datetime] = now_utc,
                 send_code: Callable[[str, str, str], Awaitable[None]] | None = None,
                 send_invitation: Callable[[dict], Awaitable[None]] | None = None,
                 opportunity_lookup: Callable[[str], Awaitable[dict | None]] | None = None,
                 plan_of: Callable[[str], Awaitable[str]] | None = None,
                 request_delivered: Callable[[str, str], Awaitable[None]] | None = None,
                 send_decision: Callable[[dict], Awaitable[bool]] | None = None,
                 email_of: Callable[[str], Awaitable[str | None]] | None = None,
                 send_team_invite: Callable[[dict], Awaitable[bool]] | None = None):
        self.store, self.business, self.clock = store, business, clock
        self._send_code, self._send_invitation = send_code, send_invitation
        self._opportunity_lookup, self._plan_of = opportunity_lookup, plan_of
        self._request_delivered = request_delivered
        self._send_decision, self._email_of = send_decision, email_of
        self._send_team_invite = send_team_invite
        self.sent_decisions: list[dict] = []      # what would have gone when no mailer is configured: tests and local development
        self.sent_codes: list[tuple[str, str]] = []      # (email, code) when no mailer is configured: tests and local development
        self._visibility: tuple[str, float] | None = None      # (level, read at): looked up at most every few seconds
        self._team: tuple[set[str], float] | None = None       # (emails, read at): the same
        self._lookups: dict[str, list[datetime]] = {}          # exact-match lookups per caller, for the hourly limit

    # ── small helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def is_admin(user: dict | None) -> bool:
        email = str((user or {}).get("email") or "").lower()
        return bool(email) and (email == ADMIN_EMAIL or email in _moderators())

    @staticmethod
    def is_superadmin(user: dict | None) -> bool:
        return str((user or {}).get("email") or "").lower() == ADMIN_EMAIL

    async def _team_row(self) -> dict | None:
        try:
            return await self.store.find_key("identities", SCOPE, None, TEAM_KEY)
        except NotSetUp:
            return None

    async def team_emails(self) -> set[str]:
        """The internal team. If the list can't be read, nobody extra gets in."""
        if self._team and time.monotonic() - self._team[1] < TEAM_CACHE_SECONDS:
            return self._team[0]
        try:
            row = await self._team_row()
        except Exception:      # noqa: BLE001 - never a reason to let someone in, and not remembered
            logger.warning("The Marketplace team list could not be read")
            return set()
        emails = {str(m.get("email") or "").lower() for m in ((row or {}).get("data") or {}).get("members") or []} - {""}
        self._team = (emails, time.monotonic())
        return emails

    async def is_team_member(self, user: dict | None) -> bool:
        email = str((user or {}).get("email") or "").lower()
        return bool(email) and (user or {}).get("email_verified") is not False and email in await self.team_emails()

    async def can_moderate(self, user: dict | None) -> bool:
        """The administrator, a development moderator, or someone on the internal team."""
        return self.is_admin(user) or await self.is_team_member(user)

    # ── the internal team (only the administrator changes it; every change is kept) ──

    async def _team_view(self) -> dict:
        data = ((await self._team_row()) or {}).get("data") or {}
        members = [{k: m.get(k) for k in ("email", "added_by", "added_at", "invite_sent_at", "invite_expires_at", "accepted_at") if m.get(k)}
                   for m in data.get("members") or []]
        return {"members": sorted(members, key=lambda m: m.get("email") or ""), "history": list(reversed(data.get("history") or []))[:30]}

    async def team(self, admin: dict) -> dict:
        if not self.is_superadmin(admin):
            raise Forbidden("Not available.")
        return await self._team_view()

    async def _save_team(self, admin: dict, row: dict | None, members: list[dict], entry: dict) -> None:
        now = self.clock()
        data = {"members": members, "history": [*(((row or {}).get("data") or {}).get("history") or []), entry][-100:]}
        if row:
            await self.store.update("identities", row["id"], {"data": data, "updated_at": now}, bump=False)
        else:
            await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "setting", "subject_id": None, "status": "active", "revision": 1,
                                                   "key": TEAM_KEY, "data": data, "created_by": admin["id"], "created_at": now, "updated_at": now})
        self._team = ({m["email"] for m in members}, time.monotonic())
        await self.event("MarketplaceTeamChanged", actor=f"moderator:{admin['id']}", payload={"action": entry["action"], "members": len(members)})

    async def add_team_member(self, admin: dict, email: str) -> dict:
        if not self.is_superadmin(admin):
            raise Forbidden("Not available.")
        address = _text(email, 200).lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", address):
            raise Invalid({"email": "Enter a valid email address."})
        if address == ADMIN_EMAIL:
            raise Invalid({"email": "This is the administrator's address, which already has access."})
        row = await self._team_row()
        members = list(((row or {}).get("data") or {}).get("members") or [])
        at, by = self.clock(), admin.get("email") or admin["id"]
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires = at + timedelta(days=2)
        previous = next((m for m in members if str(m.get("email") or "").lower() == address), None)
        updated = {**(previous or {}), "email": address, "added_by": (previous or {}).get("added_by") or by,
                   "added_at": (previous or {}).get("added_at") or at.isoformat(), "invite_token_hash": token_hash,
                   "invite_expires_at": expires.isoformat(), "invite_sent_at": at.isoformat()}
        members = [m for m in members if str(m.get("email") or "").lower() != address] + [updated]
        entry = {"action": "invite_resent" if previous else "added", "email": address, "by": by, "at": at.isoformat()}
        await self._save_team(admin, row, members, entry)
        sent = False
        if self._send_team_invite:
            try:
                sent = bool(await self._send_team_invite({"email": address, "token": token, "expires_at": expires.isoformat()}))
            except Exception as exc:      # noqa: BLE001 - adding the member is saved; the admin can issue a fresh link
                logger.warning("Marketplace team invitation email could not be sent to %s: %s", address, exc)
        return {**(await self._team_view()), "invite_sent": sent}

    async def consume_team_invitation(self, token: str) -> str:
        """Consume a short-lived, email-delivered team link and return its verified address."""
        token_hash = hashlib.sha256(str(token or "").encode()).hexdigest()
        row = await self._team_row()
        data = (row or {}).get("data") or {}
        members = list(data.get("members") or [])
        member = next((m for m in members if secrets.compare_digest(str(m.get("invite_token_hash") or ""), token_hash)), None)
        if not row or not member:
            raise NotFound()
        try:
            expires = datetime.fromisoformat(str(member.get("invite_expires_at") or "").replace("Z", "+00:00"))
        except ValueError:
            expires = self.clock() - timedelta(seconds=1)
        if expires <= self.clock():
            raise NotFound()
        address = str(member.get("email") or "").lower()
        if not address:
            raise NotFound()
        members = [{k: v for k, v in m.items() if k not in ("invite_token_hash", "invite_expires_at", "invite_sent_at")} | ({"accepted_at": self.clock().isoformat()} if m is member else {}) for m in members]
        saved = await self.store.update("identities", row["id"], {"data": {**data, "members": members}, "updated_at": self.clock()},
                                        expect_revision=int(row.get("revision") or 0))
        if not saved:
            raise NotFound()
        self._team = ({str(m.get("email") or "").lower() for m in members}, time.monotonic())
        return address

    async def remove_team_member(self, admin: dict, email: str) -> dict:
        if not self.is_superadmin(admin):
            raise Forbidden("Not available.")
        address = _text(email, 200).lower()
        row = await self._team_row()
        members = list(((row or {}).get("data") or {}).get("members") or [])
        kept = [m for m in members if m.get("email") != address]
        if len(kept) == len(members):
            raise NotFound()
        await self._save_team(admin, row, kept, {"action": "removed", "email": address, "by": admin.get("email") or admin["id"], "at": self.clock().isoformat()})
        return await self._team_view()

    # ── who can see an unclaimed profile ──────────────────────────────────────

    @staticmethod
    def _default_visibility() -> str:
        try:
            from app.core.config import get_settings
            value = str(get_settings().marketplace_unclaimed_visibility or "").strip().lower()
        except Exception:      # noqa: BLE001
            value = ""
        return value if value in VISIBILITY_LEVELS else "invite_only"

    async def _visibility_row(self) -> dict | None:
        try:
            return await self.store.find_key("identities", SCOPE, None, VISIBILITY_KEY)
        except NotSetUp:
            return None

    async def visibility(self) -> str:
        """The level in force: a moderator's choice if one was made, otherwise the configured default."""
        if self._visibility and time.monotonic() - self._visibility[1] < VISIBILITY_CACHE_SECONDS:
            return self._visibility[0]
        row = await self._visibility_row()
        chosen = ((row or {}).get("data") or {}).get("value")
        level = chosen if chosen in VISIBILITY_LEVELS else self._default_visibility()
        self._visibility = (level, time.monotonic())
        return level

    async def visibility_setting(self, admin: dict) -> dict:
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        row = await self._visibility_row()
        data = (row or {}).get("data") or {}
        chosen = data.get("value") if data.get("value") in VISIBILITY_LEVELS else None
        return {"unclaimed_visibility": chosen or self._default_visibility(), "source": "moderator" if chosen else "default", "default": self._default_visibility(),
                "changed_by": data.get("changed_by") if chosen else None, "changed_at": data.get("changed_at") if chosen else None, "history": (data.get("history") or [])[-10:],
                "levels": [{"key": k, "label": v[0], "explanation": v[1]} for k, v in VISIBILITY_LEVELS.items()]}

    async def set_visibility(self, admin: dict, value: str) -> dict:
        """A moderator chooses the level. Kept on the server with who chose it and when."""
        if not self.is_admin(admin):      # applies to the whole directory: not the team
            raise Forbidden("Not available.")
        if value not in VISIBILITY_LEVELS:
            raise Invalid({"unclaimed_visibility": "Choose admin_only, invite_only or public."})
        now = self.clock()
        row = await self._visibility_row()
        before = ((row or {}).get("data") or {}).get("value") or self._default_visibility()
        entry = {"value": value, "from": before, "by": admin.get("email") or admin["id"], "at": now.isoformat()}
        data = {"value": value, "changed_by": entry["by"], "changed_at": entry["at"], "history": [*(((row or {}).get("data") or {}).get("history") or []), entry][-50:]}
        if row:
            await self.store.update("identities", row["id"], {"data": data, "updated_at": now}, bump=False)
        else:
            await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "setting", "subject_id": None, "status": "active", "revision": 1,
                                                   "key": VISIBILITY_KEY, "data": data, "created_by": admin["id"], "created_at": now, "updated_at": now})
        self._visibility = (value, time.monotonic())
        await self.event("MarketplaceVisibilityChanged", actor=f"moderator:{admin['id']}", payload={"from": before, "to": value})
        return await self.visibility_setting(admin)

    async def _may_see(self, profile: dict, viewer: dict | None = None, via: dict | None = None) -> bool:
        """Whether this caller may open this profile. A profile a business holds is open to all.
        An unclaimed one follows the visibility level: always for moderators; with an invitation
        link for it; for someone already claiming it or whose own business it matches; and, at
        invite_only, for someone who found it by an exact-match lookup."""
        d = profile["data"] or {}
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            return True
        level = level_for(d, await self.visibility())
        if level == "public" or (viewer and await self.can_moderate(viewer)):
            return True
        via = via or {}
        invitation = await self._invitation(via.get("invitation"))
        if invitation and invitation["subject_id"] == profile["id"] and str(invitation.get("created_at")) >= (self.clock() - INVITE_TTL).isoformat():
            return True
        for token in (via.get("intent"), via.get("access")):
            grant = await self._intent(token)      # unexpired only
            if grant and grant["subject_id"] == profile["id"] and (grant.get("kind") != "lookup_grant" or level != "admin_only"):
                return True
        if viewer:
            mine = await self.store.find_key("claims", SCOPE, profile["id"], f"{profile['id']}:{viewer['id']}")
            if mine and mine.get("status") != "cancelled":
                return True
            # Their own business, by registered number or website: they are sent here to link it rather than duplicate it.
            keys = {k for k in identity_keys({"name": "", "company_number": d.get("company_number"), "website": d.get("website"), "country": d.get("country")})}
            for b in await self.business.owned_by(viewer["id"]):
                wp = (b["data"] or {}).get("workspace_profile") or {}
                saved = ((b["data"] or {}).get("marketplace") or {}).get("profile") or {}
                if keys & set(identity_keys({"name": "", "company_number": wp.get("registration_number"), "website": saved.get("website") or wp.get("website"), "country": wp.get("country")})):
                    return True
        return False

    async def find_to_claim(self, *, name: str, company_number: str = "", website: str = "", client: str = "anonymous") -> dict:
        """"Find and claim your business": an exact name together with its company number or its
        website. Nothing is browsed or suggested; a miss says only that it wasn't found."""
        now = self.clock()
        recent = [t for t in self._lookups.get(client, []) if t > now - timedelta(hours=1)]
        if len(recent) >= LOOKUPS_PER_HOUR:
            raise RateLimited()
        self._lookups[client] = [*recent, now]
        wanted = _norm_name(name)
        errors = {}
        if len(wanted) < 2:
            errors["name"] = "Enter the business name as it is registered or trades."
        if not re.sub(r"[^A-Z0-9]", "", str(company_number or "").upper()) and not domain_of(website):
            errors["company_number"] = "Enter the company number or the website address."
        if errors:
            raise Invalid(errors)
        level = await self.visibility()
        for key in identity_keys({"name": "", "company_number": company_number, "website": website, "country": ""}):
            hit = await self.store.find_key("identities", SCOPE, None, key)
            profile = await self.store.get("profiles", hit["data"]["profile_id"]) if hit else None
            d = (profile or {}).get("data") or {}
            if not profile or d.get("publication") not in ("published", "noindex") or wanted not in {_norm_name(d.get("name") or ""), _norm_name(d.get("trading_name") or "")}:
                continue
            if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
                return {"found": True, "slug": d.get("slug"), "name": d.get("name"), "claimed": True, "access": None}
            if level_for(d, level) == "admin_only":
                continue      # at this level only an invitation opens an unclaimed profile
            token = secrets.token_urlsafe(24)
            await self.store.insert("intents", {"id": new_id(), "business_id": SCOPE, "kind": "lookup_grant", "subject_id": profile["id"], "status": "open", "revision": 1,
                                                "key": _hash(token), "created_by": None, "created_at": now, "updated_at": now,
                                                "data": {"expires_at": (now + LOOKUP_GRANT_TTL).isoformat(), "matched_on": "registered number" if key.startswith("reg:") else "website"}})
            await self.event("claim_lookup_matched", profile_id=profile["id"], payload={"matched_on": "registered number" if key.startswith("reg:") else "website"})
            return {"found": True, "slug": d.get("slug"), "name": d.get("name"), "claimed": False, "access": token}
        return {"found": False}

    async def unclaimed_profiles(self, admin: dict) -> dict:
        """Every profile nobody holds, for moderators, whatever the visibility level."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        rows = [r for r in await self.store.list("profiles", SCOPE, limit=5000) if not (r["data"] or {}).get("linked_business_id") and (r["data"] or {}).get("publication") != "merged"]
        level = await self.visibility()
        waiting: dict[str, int] = {}
        try:
            for h in await self.store.list("requests", SCOPE, limit=5000):
                if h.get("status") == "held":
                    waiting[str(h.get("subject_id"))] = waiting.get(str(h.get("subject_id")), 0) + 1
        except NotSetUp:
            pass
        items = [{"id": r["id"], "slug": r["data"].get("slug"), "name": r["data"].get("name"), "category": r["data"].get("category"), "location": r["data"].get("location"),
                  "requests_waiting": waiting.get(str(r["id"]), 0), "has_logo": bool(r["data"].get("logo_data_url")),
                  "proposals_open": bool(r["data"].get("held_proposals_open")),
                  "publication": r["data"].get("publication"), "has_contact": bool(r["data"].get("contact_email")), "contact_email": r["data"].get("contact_email"), "contact_phone": r["data"].get("contact_phone"), "indexed_at": r["data"].get("indexed_at"),
                  "visibility": (r["data"] or {}).get("visibility") or "inherit", "effective_visibility": level_for(r["data"] or {}, level),
                  "visibility_label": VISIBILITY_WORDS[level_for(r["data"] or {}, level)] + (" (override)" if PROFILE_VISIBILITY.get((r["data"] or {}).get("visibility") or "inherit") else " (default)"),
                  "trading_name": r["data"].get("trading_name"), "company_number": r["data"].get("company_number"), "country": r["data"].get("country"), "website": r["data"].get("website"),
                  "description": r["data"].get("description"), "service_tags": [t["tag"] for t in r["data"].get("service_tags") or []], "business_status": r["data"].get("business_status"),
                  "fit_band": r["data"].get("fit_band"), "quality": r["data"].get("quality"),
                  **self._effective_state(r["data"] or {}, level_for(r["data"] or {}, level))} for r in rows]
        items.sort(key=lambda i: (-i["requests_waiting"], str(i["name"]).lower()))      # the ones to invite first
        return {"items": items, "total": len(items), "unclaimed_visibility": level, "invites_enabled": self._invites_enabled(),
                "options": {"categories": list(CATEGORIES), "providers": list(SOURCE_PROVIDERS), "visibility": list(PROFILE_VISIBILITY)}}

    @staticmethod
    def _invites_enabled() -> bool:
        try:
            from app.core.config import get_settings
            return bool(get_settings().marketplace_claim_invites_enabled)
        except Exception:      # noqa: BLE001
            return False

    @staticmethod
    def _reminders_enabled() -> bool:
        try:
            from app.core.config import get_settings
            return bool(get_settings().marketplace_claim_reminders_enabled)
        except Exception:      # noqa: BLE001
            return False

    @staticmethod
    def _effective_state(d: dict, level: str) -> dict:
        """What the public can see of an unclaimed profile: its own publication state together with the visibility level."""
        publication = d.get("publication")
        if publication == "suppressed":
            return {"public_state": "Archived" if (d.get("suppressed") or {}).get("kind") == "archived" else "Suppressed", "state_tone": "rose"}
        if publication == "unpublished":
            return {"public_state": "Unpublished (quality)", "state_tone": "slate"}
        if level == "public" and publication == "noindex":
            # Visible to anyone with the address, but not in the directory or search until it has more detail.
            return {"public_state": "Public \u00b7 not listed until quality passes", "state_tone": "amber", "state_detail": list(d.get("index_reasons") or []),
                    # Outside the first cohort's categories, nothing lists it without a website, however complete the rest is.
                    "state_hint": "It needs a website before it can be listed." if d.get("fit_band") == "low" else "It needs more detail before it can be listed."}
        if level == "public":
            return {"public_state": "Ready \u00b7 public", "state_tone": "emerald"}
        return {"public_state": "Ready \u00b7 hidden (" + ("invite only" if level == "invite_only" else "moderators only") + ")", "state_tone": "amber"}

    async def profile_sources(self, admin: dict, ref: str) -> dict:
        """Where a profile's details came from, for a moderator: each field's source and every import of it."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        d = profile["data"] or {}
        snapshots = await self.store.list("snapshots", SCOPE, subject_id=profile["id"], limit=20)
        return {"id": profile["id"], "slug": d.get("slug"), "name": d.get("name"), "quality": d.get("quality"), "fit_band": d.get("fit_band"), "ruleset": d.get("ruleset"),
                "reasons": d.get("index_reasons") or [], "suppressed": d.get("suppressed"),
                "fields": [{"field": k, "provider": v.get("provider"), "record_id": v.get("record_id"), "retrieved_at": v.get("retrieved_at"),
                             "previous": (v.get("previous") or {}).get("provider")} for k, v in sorted((d.get("provenance") or {}).items())],
                "edits": d.get("edits") or [], "visibility_history": d.get("visibility_history") or [],
                "imports": [{"provider": ((s["data"] or {}).get("source") or {}).get("provider"), "record_id": ((s["data"] or {}).get("source") or {}).get("record_id"),
                             "retrieved_at": ((s["data"] or {}).get("source") or {}).get("retrieved_at"), "imported_at": s.get("created_at")} for s in snapshots]}

    async def set_held_proposals(self, admin: dict, ref: str, enabled: bool) -> dict:
        """A moderator opens (or closes) a profile nobody has claimed for proposals. Proposals sent to it are kept
        the way quotes and questions are, and go to the business's Proposals inbox once its claim is verified."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't change a profile your own business is tied to. Another reviewer needs to do it.")
        d = profile["data"] or {}
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            raise Conflict("claimed", "This business has claimed its profile. It chooses for itself whether it takes proposals.")
        if bool(d.get("held_proposals_open")) != bool(enabled):
            await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {
                **d, "held_proposals_open": bool(enabled), "held_proposals_changed": {"by": f"moderator:{admin['id']}", "at": self.clock().isoformat()}}}, bump=False)
            await self.event("HeldProposalsOpened" if enabled else "HeldProposalsClosed", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={})
        return {"id": profile["id"], "slug": d.get("slug"), "name": d.get("name"), "proposals_open": bool(enabled)}

    async def _team_profile(self, admin: dict, ref: str) -> dict:
        """A profile nobody has claimed, for a moderator with no interest in it."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't change a profile your own business is tied to. Another reviewer needs to do it.")
        d = profile["data"] or {}
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            raise Conflict("claimed", "This business has claimed its profile. It publishes its own requests now.")
        return profile

    async def publish_rfp(self, admin: dict, ref: str, raw: dict) -> dict:
        """A request for proposals published by the team on behalf of a business that hasn't claimed its profile. It is
        listed with every other RFP; replies are kept, and the request and its replies go to the business once it claims."""
        profile = await self._team_profile(admin, ref)
        d = profile["data"] or {}
        if d.get("publication") not in ("published", "noindex"):
            raise Conflict("not_live", "This profile isn't live. Make it ready before publishing a request for it.")
        raw = raw if isinstance(raw, dict) else {}
        title, description = _text(raw.get("title"), 200), _text(raw.get("description"), MAX_TEXT)
        deadline = _text(raw.get("deadline"), 40) or None
        errors: dict[str, str] = {}
        if len(title) < 3:
            errors["title"] = "Give the request a title."
        if len(description) < 20:
            errors["description"] = "Describe what the business needs (at least 20 characters)."
        if deadline:
            try:
                if date.fromisoformat(deadline[:10]) < self.clock().date():
                    errors["deadline"] = "The deadline can't be in the past."
            except ValueError:
                errors["deadline"] = "That date isn't valid."
        if errors:
            raise Invalid(errors)
        now = self.clock().isoformat()
        rfp = {"id": new_id(), "type": "general", "title": title, "description": description, "category": d.get("category"),
               "budget_range": _text(raw.get("budget_range"), 80) or None, "budget_currency": _text(raw.get("budget_currency"), 3).upper() or "GBP",
               "budget_visible": bool(_text(raw.get("budget_range"), 80)), "deadline": deadline, "submission_cap": None,
               "requirements": [{"text": _text(t, 300), "mandatory": False, "weight": 1, "format": "text"} for t in (raw.get("requirements") or [])[:20] if len(_text(t, 300)) >= 3],
               "accepted_modes": ["general"], "accepted_categories": None, "specific_criteria": None, "visibility": "marketplace",
               "status": "PUBLISHED", "created_at": now, "published_at": now, "updated_at": now, "published_by_team": f"moderator:{admin['id']}"}
        await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {**d, "rfps": [rfp, *(d.get("rfps") or [])]}}, bump=False)
        await self.event("DirectoryRfpPublished", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={"rfp_id": rfp["id"]})
        return {**rfp, "profile": d.get("slug")}

    async def close_rfp(self, admin: dict, ref: str, rfp_id: str) -> dict:
        profile = await self._team_profile(admin, ref)
        d = profile["data"] or {}
        rfps = [dict(r) for r in d.get("rfps") or []]
        hit = next((r for r in rfps if r.get("id") == rfp_id), None)
        if not hit:
            raise NotFound()
        if hit.get("status") == "PUBLISHED":
            hit.update({"status": "CLOSED", "closed_at": self.clock().isoformat(), "updated_at": self.clock().isoformat()})
            await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {**d, "rfps": rfps}}, bump=False)
            await self.event("DirectoryRfpClosed", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={"rfp_id": rfp_id})
        return hit

    async def profile_rfps(self, admin: dict, ref: str) -> dict:
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        held = await self._held_requests(profile["id"])
        return {"name": (profile["data"] or {}).get("name"), "slug": (profile["data"] or {}).get("slug"), "items": [
            {**r, "replies_waiting": sum(1 for h in held if (h["data"] or {}).get("request_id") == r.get("id"))} for r in (profile["data"] or {}).get("rfps") or []]}

    async def public_rfps(self) -> list[dict]:
        """Open RFPs the team published for unclaimed profiles the public can see, shaped like any listed request."""
        out = []
        try:
            rows = [r for r in await self.store.list("profiles", SCOPE, limit=5000) if (r["data"] or {}).get("rfps")]
        except NotSetUp:
            return []
        for row in rows:
            d = row["data"] or {}
            if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
                continue      # handed to the business: listed from its own workspace now
            if d.get("publication") not in ("published", "noindex") or not await self._may_see(row):
                continue
            for r in d.get("rfps") or []:
                if r.get("status") == "PUBLISHED":
                    out.append({**{k: v for k, v in r.items() if k != "published_by_team"}, "workspace_id": None, "directory_slug": d.get("slug"),
                                "company_name": d.get("name"), "company_logo": d.get("logo_data_url"), "company_industry": d.get("category") or "",
                                "company_country": d.get("country") or "", "location": d.get("location")})
        return out

    def _rfp_of(self, d: dict, rfp_id: str | None) -> dict | None:
        """An RFP of this profile still taking replies."""
        r = next((x for x in d.get("rfps") or [] if rfp_id and x.get("id") == rfp_id), None)
        if not r or r.get("status") != "PUBLISHED":
            return None
        if r.get("deadline"):
            try:
                if date.fromisoformat(str(r["deadline"])[:10]) < self.clock().date():
                    return None
            except ValueError:
                pass
        return r

    async def moderate_profile(self, admin: dict, ref: str, *, action: str, reason: str) -> dict:
        """suppress | restore, by a moderator, with a reason that is kept. Never on a profile their own business is tied to."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't moderate a profile your own business is tied to. Another reviewer needs to do it.")
        if len(_text(reason)) < 5:
            raise Invalid({"reason": "Give the reason. It is kept with the profile."})
        d = profile["data"] or {}
        actor = f"moderator:{admin['id']}"
        if action in ("suppress", "archive"):
            if d.get("publication") != "suppressed":
                await self.suppress(profile["id"], actor=actor, reason=_text(reason))
                if action == "archive":      # put away rather than taken down for cause: same effect, said differently
                    fresh = await self.store.get("profiles", profile["id"])
                    await self.store.update("profiles", profile["id"], {"data": {**fresh["data"], "suppressed": {**fresh["data"]["suppressed"], "kind": "archived"}}}, bump=False)
        elif action == "restore":
            if d.get("publication") != "suppressed":
                raise Conflict("not_suppressed", "This profile isn't suppressed.")
            back = (d.get("suppressed") or {}).get("was") if (d.get("suppressed") or {}).get("was") in ("published", "noindex", "unpublished") else "noindex"
            await self.store.update("profiles", profile["id"], {"status": back, "updated_at": self.clock(), "data": {
                **d, "publication": back, "suppressed": None, "restored": {"by": actor, "reason": _text(reason), "at": self.clock().isoformat()}}})
            await self.event("DirectoryProfileRestored", profile_id=profile["id"], actor=actor, payload={"publication": back})
        else:
            raise Invalid({"action": "Choose suppress, archive or restore."})
        fresh = await self.store.get("profiles", profile["id"])
        if action == "restore":
            await self._ensure_first_claim_invite(fresh)
        return {"id": fresh["id"], "slug": fresh["data"].get("slug"), "publication": fresh["data"].get("publication"),
                **self._effective_state(fresh["data"], level_for(fresh["data"], await self.visibility()))}

    # ── per-profile visibility ────────────────────────────────────────────────

    async def set_profile_visibility(self, admin: dict, refs: list[str], value: str, reason: str = "") -> dict:
        """Set one or many unclaimed profiles' own visibility. Who, when and why are kept on each."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        if value not in PROFILE_VISIBILITY:
            raise Invalid({"visibility": "Choose inherit, hidden, invite_only or public."})
        if not refs:
            raise Invalid({"profiles": "Choose at least one profile."})
        now, who = self.clock().isoformat(), admin.get("email") or admin["id"]
        changed, skipped = [], []
        for ref in refs[:500]:
            try:
                profile = await self._profile(ref)
            except NotFound:
                skipped.append({"ref": ref, "why": "Not found."})
                continue
            d = profile["data"] or {}
            if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
                skipped.append({"ref": d.get("slug"), "why": "A business holds this profile, so it is always public."})
                continue
            if await self._own_interest(admin, profile_id=profile["id"]):
                skipped.append({"ref": d.get("slug"), "why": "You or your business has a claim on this profile. Another reviewer needs to do it."})
                continue
            before = d.get("visibility") or "inherit"
            if before == value:
                continue
            entry = {"from": before, "to": value, "by": who, "at": now, "reason": _text(reason) or None}
            await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {
                **d, "visibility": value, "visibility_changed": entry, "visibility_history": [*(d.get("visibility_history") or []), entry][-30:]}})
            await self.event("DirectoryProfileVisibilityChanged", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={"from": before, "to": value})
            changed.append(d.get("slug"))
        return {"changed": changed, "count": len(changed), "skipped": skipped}

    # ── adding and editing records by hand ────────────────────────────────────

    def _check_manual(self, raw: dict) -> dict[str, str]:
        """What a record added by hand must have. A location is a town or region, never an address."""
        errors: dict[str, str] = {}
        if len(_text(raw.get("name"), 160)) < 2:
            errors["name"] = "Enter the legal name."
        if _text(raw.get("category"), 80) not in CATEGORIES:
            errors["category"] = "Choose a category from the list."
        town, trimmed = town_of(raw.get("location"))
        if not town:
            errors["location"] = "Enter the town or region."
        elif trimmed:
            errors["location"] = f"Enter the town or region only, not a street address or full postcode (for example: {town})."
        if _text(raw.get("website")) and not domain_of(raw.get("website")):
            errors["website"] = "Enter a web address like example.co.uk."
        email = _text(raw.get("contact_email"), 200)
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            errors["contact_email"] = "Enter a valid email address, or leave it empty."
        phone = _text(raw.get("contact_phone"), 40)
        if phone and len(re.sub(r"\D", "", phone)) < 7:
            errors["contact_phone"] = "Enter a valid phone number, or leave it empty."
        source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
        if _text(source.get("provider"), 80) not in SOURCE_PROVIDERS:
            errors["source.provider"] = "Choose where this came from."
        if not _text(source.get("record_id"), 300):
            errors["source.record_id"] = "Give the source link or reference."
        try:
            datetime.fromisoformat(str(source.get("retrieved_at") or "").replace("Z", "+00:00"))
        except ValueError:
            errors["source.retrieved_at"] = "Give the date it was retrieved."
        if raw.get("logo_data_url") and not clean_logo(raw.get("logo_data_url")):
            errors["logo_data_url"] = "Use a PNG, JPG or WebP image."
        if (raw.get("visibility") or "inherit") not in PROFILE_VISIBILITY:
            errors["visibility"] = "Choose inherit, hidden, invite_only or public."
        if str(raw.get("business_status") or "active").lower() not in ("active", "dormant", "dissolved", "closed"):
            errors["business_status"] = "Choose the business status."
        return errors

    async def _existing_matches(self, raw: dict, exclude: str | None = None) -> list[dict]:
        """What already exists that may be this business: a profile with the same number or website,
        a profile with the same name, or a signed-up business with the same name or number."""
        out, seen = [], set()
        for key in identity_keys({"name": "", "company_number": raw.get("company_number"), "website": raw.get("website"), "country": raw.get("country")}):
            hit = await self.store.find_key("identities", SCOPE, None, key)
            pid = hit["data"]["profile_id"] if hit else None
            if pid and pid not in seen and pid != exclude:
                p = await self.store.get("profiles", pid)
                if p and (p["data"] or {}).get("publication") != "merged":
                    seen.add(pid)
                    out.append({"kind": "profile", "id": pid, "slug": p["data"].get("slug"), "name": p["data"].get("name"), "location": p["data"].get("location") or "",
                                "matched_on": "company number" if key.startswith("reg:") else "website"})
        wanted = _norm_name(raw.get("name") or "")
        if len(wanted) >= 2:
            for p in await self.store.list("profiles", SCOPE, limit=5000):
                d = p["data"] or {}
                if p["id"] in seen or p["id"] == exclude or d.get("publication") == "merged":
                    continue
                if wanted in {_norm_name(d.get("name") or ""), _norm_name(d.get("trading_name") or "")}:
                    seen.add(p["id"])
                    out.append({"kind": "profile", "id": p["id"], "slug": d.get("slug"), "name": d.get("name"), "location": d.get("location") or "", "matched_on": "name"})
        number = re.sub(r"[^A-Z0-9]", "", str(raw.get("company_number") or "").upper())
        for b in await self.business.find_by_profile(company_name=_text(raw.get("name"), 160), registration_number=number):
            out.append({"kind": "business", "id": b["id"], "name": b["name"], "matched_on": "a business already signed up"})
        return out

    async def check_business(self, admin: dict, raw: dict) -> dict:
        """What saving this record would do, without saving it: problems, what already exists, and the quality result."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        raw = raw if isinstance(raw, dict) else {}
        errors = self._check_manual(raw)
        town, _ = town_of(raw.get("location"))
        record = {**raw, "location": town, "business_status": str(raw.get("business_status") or "active").lower(), "source": raw.get("source") if isinstance(raw.get("source"), dict) else {}}
        verdict = assess_index_record(record) if not errors else None
        return {"errors": errors, "duplicates": await self._existing_matches(raw), "verdict": verdict,
                "suggested_visibility": "public" if verdict and verdict["band"] == "high" and verdict["quality"] >= 10 else None}

    async def add_business(self, admin: dict, raw: dict, *, allow_duplicate: bool = False) -> dict:
        """Add one business from the form (or one CSV row). Refused if something is missing; held back
        if it may already exist, unless the moderator says to add it anyway."""
        checked = await self.check_business(admin, raw)
        if checked["errors"]:
            raise Invalid(checked["errors"])
        blocking = [x for x in checked["duplicates"] if x["matched_on"] in ("company number", "website")]
        if blocking or (checked["duplicates"] and not allow_duplicate):
            # The same number or website is the same record: open it and edit it instead. A name match can be overridden.
            raise Conflict("possible_duplicate", "This business may already exist.", {"duplicates": checked["duplicates"], "can_add_anyway": not blocking})
        result = await self._index_one(raw, f"moderator:{admin['id']}")
        return {**result, "suggested_visibility": checked["suggested_visibility"], "link": f"/marketplace/business/{result['slug']}" if result.get("slug") else None}

    async def import_businesses(self, admin: dict, records: list[dict], *, commit: bool = False) -> dict:
        """CSV import. Without `commit` it is a preview: each row with its problems and what it would
        duplicate. With it, the rows that are clean are added and the rest are reported."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        rows = []
        for n, raw in enumerate((records or [])[:500], start=1):
            raw = raw if isinstance(raw, dict) else {}
            checked = await self.check_business(admin, raw)
            row = {"row": n, "name": _text(raw.get("name"), 160), "errors": checked["errors"], "duplicates": checked["duplicates"], "verdict": checked["verdict"],
                   "ok": not checked["errors"] and not checked["duplicates"]}
            if commit and row["ok"]:
                row["result"] = await self._index_one(raw, f"moderator:{admin['id']}")
            rows.append(row)
        return {"rows": rows, "committed": commit, "summary": {"total": len(rows), "ready": sum(1 for r in rows if r["ok"]),
                                                                "with_problems": sum(1 for r in rows if r["errors"]), "duplicates": sum(1 for r in rows if r["duplicates"] and not r["errors"]),
                                                                "added": sum(1 for r in rows if (r.get("result") or {}).get("result") == "created")}}

    async def edit_profile(self, admin: dict, ref: str, changes: dict, reason: str = "") -> dict:
        """Correct an unclaimed profile. The earlier value and where it came from are kept in its history."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        d = profile["data"] or {}
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            raise Conflict("held", "A business manages this profile. Its owner edits it.")
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't edit a profile you or your business has a claim on. Another reviewer needs to do it.")
        c = {k: v for k, v in (changes or {}).items() if k in MANUAL_FIELDS}
        if not c:
            raise Invalid({"changes": "Nothing to change."})
        merged = {**{k: d.get(k) for k in MANUAL_FIELDS}, "service_tags": [t["tag"] for t in d.get("service_tags") or []], **c,
                  "source": {"provider": "Manual research", "record_id": "edit", "retrieved_at": self.clock().isoformat()}}
        errors = {k: v for k, v in self._check_manual(merged).items() if not k.startswith("source.") and (k in c or k == "location" and "location" in c)}
        if errors:
            raise Invalid(errors)
        now, who = self.clock().isoformat(), admin.get("email") or admin["id"]
        before = {k: (d.get(k) if k != "service_tags" else [t["tag"] for t in d.get("service_tags") or []]) for k in c}
        if "logo_data_url" in before:
            before["logo_data_url"] = "(an image)" if before["logo_data_url"] else None      # the history says it changed; it doesn't keep a copy
        patch: dict = {}
        for k, v in c.items():
            if k == "service_tags":
                patch[k] = [{"tag": _text(t, 60), "source": "moderator", "confirmed": False} for t in (v or [])[:20] if _text(t, 60)]
            elif k == "location":
                patch[k] = town_of(v)[0]
            elif k == "company_number":
                patch[k] = re.sub(r"[^A-Z0-9]", "", str(v or "").upper()) or None
            elif k == "contact_email":
                patch[k] = _text(v, 200).lower() or None
            elif k == "contact_phone":
                patch[k] = _text(v, 40) or None
            elif k == "logo_data_url":
                patch[k] = clean_logo(v)
            else:
                patch[k] = _text(v, 1200 if k == "description" else 200) or None
        if "website" in patch:
            patch["domain"] = domain_of(patch["website"])
        provenance = dict(d.get("provenance") or {})
        for k in c:
            if k not in ("contact_email", "contact_phone", "logo_data_url"):
                provenance[k] = {"provider": "Moderator edit", "record_id": who, "retrieved_at": now, "previous": provenance.get(k)}
        data = {**d, **patch, "provenance": provenance, "edits": [*(d.get("edits") or []), {"by": who, "at": now, "reason": _text(reason) or None, "before": before}][-50:]}
        if d.get("publication") != "suppressed":
            verdict = assess_index_record({**data, "service_tags": [t["tag"] for t in data.get("service_tags") or []],
                                           "source": {"provider": "Moderator edit", "record_id": who}})
            data.update({"publication": verdict["publication"], "fit_band": verdict["band"], "quality": verdict["quality"], "index_reasons": verdict["reasons"]})
        saved = await self.store.update("profiles", profile["id"], {"status": data["publication"], "updated_at": self.clock(), "data": data}) or profile
        for key in identity_keys({"name": data.get("name"), "company_number": data.get("company_number"), "website": data.get("website"), "country": data.get("country"), "location": data.get("location")}):
            try:      # a corrected number or website must find this profile from now on
                await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "identity", "subject_id": profile["id"], "status": "active", "revision": 1,
                                                       "key": key, "data": {"profile_id": profile["id"]}, "created_by": f"moderator:{admin['id']}", "created_at": self.clock(), "updated_at": self.clock()})
            except Duplicate:
                pass
        await self.event("DirectoryProfileEdited", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={"fields": sorted(c)})
        await self._ensure_first_claim_invite(saved)
        return {"id": saved["id"], "slug": saved["data"].get("slug"), "publication": saved["data"].get("publication"), "quality": saved["data"].get("quality"),
                "reasons": saved["data"].get("index_reasons") or [], **self._effective_state(saved["data"], level_for(saved["data"], await self.visibility()))}

    async def sitemap_slugs(self) -> list[str]:
        """Profiles search engines may list: published ones a business holds, and unclaimed ones only when those are public."""
        level = await self.visibility()
        out = []
        for r in await self.store.list("profiles", SCOPE, limit=5000):
            d = r["data"] or {}
            held = bool(d.get("linked_business_id")) and d.get("claim_state") in HELD_STATES
            if d.get("publication") == "published" and d.get("slug") and (held or level_for(d, level) == "public"):
                out.append(d["slug"])
        return sorted(out)

    async def event(self, type_: str, *, profile_id: str | None = None, business_id: str | None = None, claim_id: str | None = None,
                    actor: str | None = None, payload: dict | None = None, correlation: str | None = None) -> None:
        """Audit and funnel record. Identifiers and states only: no contact details, document
        bodies, opportunity bodies or private business data."""
        try:
            await self.store.insert("events", {
                "id": new_id(), "business_id": SCOPE, "kind": type_, "subject_id": profile_id, "status": "recorded", "revision": 1, "key": None,
                "created_by": actor, "created_at": self.clock(), "updated_at": self.clock(),
                "data": {"schema_version": 1, "claim_id": claim_id, "business_id": business_id, "correlation_id": correlation or new_id(), **(payload or {})}})
        except Exception:      # noqa: BLE001 - an event that can't be recorded never fails the action
            logger.warning("marketplace event %s could not be recorded", type_)

    async def _profile(self, ref: str) -> dict:
        """By id or public slug."""
        row = None
        try:
            uuid.UUID(str(ref))
            row = await self.store.get("profiles", str(ref))
        except ValueError:
            row = await self.store.find_key("profiles", SCOPE, None, str(ref).lower())
        if not row:
            # A slug that was merged into another profile still resolves (stable public URLs).
            moved = await self.store.find_key("identities", SCOPE, None, f"slug:{str(ref).lower()}")
            row = await self.store.get("profiles", moved["data"]["profile_id"]) if moved else None
        if row and (row["data"] or {}).get("merged_into"):
            row = await self.store.get("profiles", row["data"]["merged_into"])
        if not row:
            raise NotFound()
        return row

    async def _claim(self, claim_id: str, user: dict) -> dict:
        try:
            uuid.UUID(str(claim_id))
        except ValueError:
            raise NotFound()
        row = await self.store.get("claims", str(claim_id))
        if not row or row.get("kind") != user["id"]:
            raise NotFound()      # someone else's claim is simply not there, for a moderator too
        return row

    async def _owner_ctx(self, user: dict, business_id: str, *, edit: bool = False) -> dict:
        try:
            actor, record = await self.business.context(user["id"], business_id, user.get("email"))
        except bz.BusinessAccessDenied as e:
            raise NotFound() from e
        if edit and not (actor.is_owner or actor.can_send):
            raise Forbidden("Your role in this business doesn't include managing its Marketplace profile.")
        return {"actor": actor, "data": record["data"], "owner_id": record["owner_id"]}

    # ── index (EnterprateAI services; no tenant, user or business is created) ──

    async def index_records(self, records: list[dict], *, actor: str = "indexer") -> dict:
        """Add or refresh sourced public records. Returns what happened to each."""
        out = []
        for raw in records[:2000]:
            out.append(await self._index_one(raw if isinstance(raw, dict) else {}, actor))
        return {"ruleset": RULESET_VERSION, "results": out,
                "summary": {k: sum(1 for r in out if r["result"] == k) for k in ("created", "updated", "excluded", "invalid")}}

    async def _index_one(self, raw: dict, actor: str) -> dict:
        name = _text(raw.get("name"), 160)
        source = raw.get("source") if isinstance(raw.get("source"), dict) else {}
        if not name:
            return {"result": "invalid", "reason": "No business name."}
        town, trimmed = town_of(raw.get("location"))
        notes = ["The location was reduced to a town or region. Street addresses and full postcodes are not kept."] if trimmed else []
        now = self.clock()
        record = {
            "name": name, "trading_name": _text(raw.get("trading_name"), 160) or None,
            "company_number": re.sub(r"[^A-Z0-9]", "", str(raw.get("company_number") or "").upper()) or None,
            "country": _text(raw.get("country") or "United Kingdom", 80), "category": _text(raw.get("category"), 80) or None,
            "service_tags": [_text(t, 60) for t in (raw.get("service_tags") or [])[:20] if _text(t, 60)],
            # A general location only: a town or region, never a street address.
            "location": town, "website": _text(raw.get("website"), 200) or None,
            "description": _text(raw.get("description"), 1200) or None, "business_status": _text(raw.get("business_status") or "active", 30).lower(),
            "privacy_risk": bool(raw.get("privacy_risk")),
            "source": {"provider": _text(source.get("provider"), 80), "type": _text(source.get("type") or "public_register", 40),
                       "record_id": _text(source.get("record_id"), 120), "retrieved_at": _text(source.get("retrieved_at"), 40) or now.isoformat()},
        }
        verdict = assess_index_record(record)
        wanted_visibility = raw.get("visibility") if raw.get("visibility") in PROFILE_VISIBILITY else None
        keys = identity_keys(record)
        existing = None
        for key in keys:
            hit = await self.store.find_key("identities", SCOPE, None, key)
            if hit:
                existing = await self.store.get("profiles", hit["data"]["profile_id"])
                break
        if existing is None and verdict["band"] == "excluded":
            return {"result": "excluded", "name": name, "reasons": verdict["reasons"]}
        provenance = {f: {"provider": record["source"]["provider"], "record_id": record["source"]["record_id"], "retrieved_at": record["source"]["retrieved_at"]}
                      for f in ("name", "trading_name", "company_number", "country", "category", "service_tags", "location", "website", "description") if record.get(f)}
        sourced = {k: record[k] for k in ("name", "trading_name", "company_number", "country", "category", "location", "website", "description", "business_status")}
        sourced["service_tags"] = [{"tag": t, "source": "indexed", "confirmed": False} for t in record["service_tags"]]
        sourced["domain"] = domain_of(record["website"])
        # A route to reach the business about its own profile. Never shown publicly, never searchable.
        contact = _text(raw.get("contact_email"), 200).lower() or None
        phone = _text(raw.get("contact_phone"), 40) or None
        logo = clean_logo(raw.get("logo_data_url"))

        if existing:
            data = dict(existing["data"])
            suppressed = data.get("publication") == "suppressed"
            # A later source adds to what is known; it doesn't blank a field it has nothing for, and a
            # source without the registered number doesn't rename a business the register has named.
            sourced = {k: v for k, v in sourced.items() if v not in (None, "", [])}
            if data.get("linked_business_id") and data.get("claim_state") in HELD_STATES:
                sourced = {k: v for k, v in sourced.items() if not data.get(k)}
                provenance = {k: v for k, v in provenance.items() if k in sourced}
                contact = None
                logo = None
            if data.get("company_number") and not record["company_number"]:
                sourced.pop("name", None)
                provenance.pop("name", None)
            data.update({**sourced, "provenance": {**(data.get("provenance") or {}), **provenance}, "fit_band": verdict["band"], "quality": verdict["quality"],
                         "index_reasons": verdict["reasons"], "ruleset": RULESET_VERSION, "indexed_at": now.isoformat(),
                         # A suppressed profile stays suppressed whatever a later import says (AC-22).
                         "publication": "suppressed" if suppressed else verdict["publication"]})
            if contact:
                data["contact_email"] = contact
            if phone:
                data["contact_phone"] = phone
            if logo:
                data["logo_data_url"] = logo
            if wanted_visibility:
                data["visibility"] = wanted_visibility
            saved = await self.store.update("profiles", existing["id"], {"data": data, "status": data["publication"], "updated_at": now}) or existing
            saved = await self._reslug(saved, actor) or saved
            profile_id, result = existing["id"], "updated"
        else:
            profile_id = new_id()
            slug = slugify(f"{name} {(town or '').split(',')[0]}")      # name and town only
            if await self.store.find_key("profiles", SCOPE, None, slug):
                slug = f"{slug}-{_hash(keys[0])[:6]}"
            data = {**sourced, "slug": slug, "provenance": provenance, "fit_band": verdict["band"], "quality": verdict["quality"], "index_reasons": verdict["reasons"],
                    "ruleset": RULESET_VERSION, "publication": verdict["publication"], "claim_state": "unclaimed", "linked_business_id": None,
                    "contact_email": contact, "contact_phone": phone, "logo_data_url": logo, "indexed_at": now.isoformat(), "visibility": wanted_visibility or "inherit"}
            try:
                saved = await self.store.insert("profiles", {"id": profile_id, "business_id": SCOPE, "kind": "directory_profile", "subject_id": None,
                                                             "status": data["publication"], "revision": 1, "key": slug, "data": data, "created_by": actor,
                                                             "created_at": now, "updated_at": now})
            except Duplicate:
                return {"result": "invalid", "name": name, "reason": "A profile with this address already exists."}
            result = "created"
        for key in keys:      # every key points at the one profile: the same business never gets a second
            try:
                await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "identity", "subject_id": profile_id, "status": "active",
                                                       "revision": 1, "key": key, "data": {"profile_id": profile_id}, "created_by": actor, "created_at": now, "updated_at": now})
            except Duplicate:
                pass
        await self.store.insert("snapshots", {"id": new_id(), "business_id": SCOPE, "kind": record["source"]["type"], "subject_id": profile_id, "status": "processed",
                                              "revision": 1, "key": None, "created_by": actor, "created_at": now, "updated_at": now,
                                              "data": {"source": record["source"], "fields": {k: v for k, v in record.items() if k not in ("source", "privacy_risk")},
                                                       "normalisation_version": RULESET_VERSION, "verdict": verdict}})
        if saved["data"]["publication"] in ("published", "noindex"):
            await self.event("DirectoryProfileIndexed", profile_id=profile_id, actor=actor, payload={"publication": saved["data"]["publication"], "band": verdict["band"]})
        else:
            await self.event("DirectoryProfileSuppressed", profile_id=profile_id, actor=actor, payload={"reason": "index_rules", "publication": saved["data"]["publication"]})
        await self._ensure_first_claim_invite(saved)      # send when the record first becomes eligible, even if it was imported earlier
        return {"result": result, "id": profile_id, "slug": saved["data"]["slug"], "publication": saved["data"]["publication"], "band": verdict["band"],
                "quality": verdict["quality"], "reasons": verdict["reasons"], "location": saved["data"].get("location"), "notes": notes,
                "visibility": saved["data"].get("visibility") or "inherit",
                # Only a suggestion: nothing becomes public unless a moderator chooses it.
                "suggested_visibility": "public" if verdict["band"] == "high" and verdict["quality"] >= 10 else None}

    async def _reslug(self, profile: dict, actor: str) -> dict | None:
        """A sourced profile stored with an address as its location: keep the town only, rebuild
        its public address from name and town, and keep the old address working."""
        d = profile["data"] or {}
        if d.get("claim_state") == "created" or d.get("origin") == "created" or d.get("merged_into"):
            return None
        town, trimmed = town_of(d.get("location"))
        if not trimmed and town == (d.get("location") or None):
            return None
        old = d.get("slug")
        slug = slugify(f"{d.get('name') or ''} {(town or '').split(',')[0]}")
        if slug != old and (await self.store.find_key("profiles", SCOPE, None, slug) or await self.store.find_key("identities", SCOPE, None, f"slug:{slug}")):
            slug = f"{slug[:70]}-{_hash(profile['id'])[:6]}"
        now = self.clock()
        saved = await self.store.update("profiles", profile["id"], {"key": slug, "updated_at": now, "data": {**d, "location": town, "slug": slug}})
        if saved and old and old != slug:
            try:
                await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "identity", "subject_id": profile["id"], "status": "active", "revision": 1,
                                                       "key": f"slug:{old}", "data": {"profile_id": profile["id"]}, "created_by": actor, "created_at": now, "updated_at": now})
            except Duplicate:
                pass
        return saved

    async def normalise_locations(self, admin: dict) -> dict:
        """Tidy every sourced profile that was indexed before locations were reduced to a town."""
        if not self.is_admin(admin):      # applies to the whole directory: not the team
            raise Forbidden("Not available.")
        changed = []
        for profile in await self.store.list("profiles", SCOPE, limit=5000):
            before = (profile["data"] or {}).get("slug")
            saved = await self._reslug(profile, f"moderator:{admin['id']}")
            if saved:
                changed.append({"id": profile["id"], "from": before, "to": saved["data"]["slug"], "location": saved["data"].get("location")})
        return {"changed": changed, "count": len(changed)}

    # ── public views ──────────────────────────────────────────────────────────

    async def _linked(self, profile: dict) -> dict | None:
        bid = (profile["data"] or {}).get("linked_business_id")
        if not bid:
            return None
        try:
            return await self.business.load(bid)
        except Exception:      # noqa: BLE001 - the business is gone: the profile reads as unclaimed
            return None

    def _public(self, profile: dict, linked: dict | None, *, full: bool = False) -> dict:
        """What anyone may see. Sourced fields before a claim; owner-confirmed fields after.
        Never private contacts, financial or engine data, customers, or workflow state."""
        d = profile["data"] or {}
        state = d.get("claim_state") or "unclaimed"
        if state == "disputed":
            # A challenge under review changes nothing the public sees. The holder's edits are paused; the
            # page, its label and its actions stay as they were until a person decides.
            state = d.get("state_before_dispute") if d.get("state_before_dispute") in ("created", "verified") else "verified"
        claimed = state in HELD_STATES and linked is not None
        base = {"id": profile["id"], "slug": d.get("slug"), "name": d.get("name"), "trading_name": d.get("trading_name"), "country": d.get("country"),
                "category": d.get("category"), "trust": TRUST["unclaimed" if not claimed else state], "claimed": claimed,
                "noindex": d.get("publication") != "published", "updated_at": profile.get("updated_at")}
        if not claimed:
            base.update({
                "description": d.get("description") or "", "location": d.get("location") or "", "website": d.get("website") or "", "logo_data_url": d.get("logo_data_url"),
                "service_tags": [t["tag"] for t in d.get("service_tags") or []], "offerings": [],
                "opportunities": {k: False for k in OPPORTUNITY_TYPES}, "opportunity_note": "Claim to set opportunity preferences",
                "claim": {"eligible": d.get("publication") in ("published", "noindex"), "cta": "Claim this Business for Free"},
                # A quote or a question can be left here and is kept for whoever claims it. Its own settings start after a claim.
                "held_requests_open": d.get("publication") in ("published", "noindex"),
                # A proposal too, when the team has opened this profile for proposals
                "held_proposals_open": d.get("publication") in ("published", "noindex") and bool(d.get("held_proposals_open")),
            })
            if full:
                base["legal_identifier"] = d.get("company_number")
                base["source_basis"] = "This profile is based on public sources and has not been confirmed by the business."
                base["sources"] = sorted({p.get("provider") for p in (d.get("provenance") or {}).values() if p.get("provider")})
            return base
        s = marketplace_settings(linked)
        base["logo_data_url"] = (linked.get("workspace_profile") or {}).get("logo_data_url") or d.get("logo_data_url")
        if not s["is_published"]:
            # Claimed, not yet published: the owner's draft stays private, exactly as their own page says
            # ("Not published yet"). The public keeps the sourced details, now under the owner's label.
            sourced_tags = d.get("sourced_service_tags") or d.get("service_tags") or []
            base.update({
                "description": d.get("description") or "", "location": d.get("location") or "", "website": d.get("website") or "",
                "service_tags": [t["tag"] for t in sourced_tags if t.get("source") != "owner"], "offerings": [],
                "opportunities": {k: False for k in OPPORTUNITY_TYPES}, "opportunity_note": "This business hasn't published its Marketplace profile yet.",
                "proposal_modes": [], "activated": False, "listing_id": None, "claim": {"eligible": False},
            })
            if full:
                base["legal_identifier"] = d.get("company_number")
                base["source_basis"] = "These details come from public sources. The business manages this profile and hasn't published its own details yet."
                base["sources"] = sorted({p.get("provider") for p in (d.get("provenance") or {}).values() if p.get("provider")})
            return base
        own_tags = s["profile"]["service_tags"] or [t["tag"] for t in d.get("service_tags") or [] if t.get("confirmed") or d.get("origin") != "created"]
        base.update({
            "name": s["profile"]["name"] or d.get("name"), "description": s["profile"]["description"], "location": s["profile"]["service_area"] or d.get("location") or "",
            "website": s["profile"]["website"] or d.get("website") or "", "service_tags": own_tags,
            "offerings": [{"id": o["id"], "name": o["name"], "description": o["description"]} for o in s["offerings"] if o["published"]] if s["is_published"] else [],
            "since": s.get("activated_at") or s.get("published_at"),
            # An action is offered only when the business switched that kind of opportunity on, and never while ownership is under review.
            "opportunities": {k: bool(s["preferences"][k]["enabled"]) and s["is_published"] and state in ("verified", "created") for k in OPPORTUNITY_TYPES},
            "proposal_modes": s["preferences"]["proposals"]["accepted_modes"] if s["preferences"]["proposals"]["enabled"] else [],
            "activated": bool(s["is_published"]), "listing_id": d.get("linked_business_id") if s["is_published"] else None,
            "claim": {"eligible": False},
        })
        if full:
            base["legal_identifier"] = d.get("company_number")
            base["contact_preference"] = s["profile"]["contact_preference"]
            base["contact"] = public_contact(linked)
        return base

    async def search(self, *, q: str = "", category: str = "", location: str = "", trust: str = "", open_for: str = "", page: int = 1, page_size: int = 24) -> dict:
        rows = [r for r in await self.store.list("profiles", SCOPE, limit=5000) if (r["data"] or {}).get("publication") == "published"]
        linked_ids = list(dict.fromkeys(str((r["data"] or {}).get("linked_business_id")) for r in rows if (r["data"] or {}).get("linked_business_id")))
        linked_by_id = await self.business.load_many(linked_ids)
        level = await self.visibility()
        listed = level == "public"      # becomes true below if any unclaimed profile is listed (its own setting may make it public)
        items, shown = [], []
        for row in rows:
            linked = linked_by_id.get(str((row["data"] or {}).get("linked_business_id")))
            item = self._public(row, linked)
            if item["claimed"] and item.get("activated") and listing_quality(_with_public_services(marketplace_settings(linked), row)):
                continue      # published before the quality check, and not good enough to show yet
            if not item["claimed"]:
                if level_for(row["data"] or {}, level) != "public":
                    continue
                listed = True
            shown.append(row)
            text = " ".join(str(x or "") for x in (item["name"], item.get("trading_name"), item["description"], item["category"], item["location"], " ".join(item["service_tags"]),
                                                   " ".join(o["name"] for o in item["offerings"]))).lower()
            if q and q.strip().lower() not in text:
                continue
            if category and (item["category"] or "").lower() != category.lower():
                continue
            if location and location.strip().lower() not in (item["location"] or "").lower():
                continue
            state = item["trust"]["state"]
            if (trust == "claimed" and state not in ("verified", "disputed")) or (trust in ("created", "unclaimed") and state != trust):
                continue
            if open_for in OPPORTUNITY_TYPES and not item["opportunities"][open_for] and not (item.get("held_requests_open") and open_for in ("enquiries", "rfqs")):
                continue
            items.append(item)
        items.sort(key=lambda i: (not i["claimed"], str(i["name"]).lower()))
        start = (max(1, page) - 1) * page_size
        return {"items": items[start:start + page_size], "total": len(items), "unclaimed_listed": listed,
                "categories": sorted({(r["data"] or {}).get("category") for r in shown if (r["data"] or {}).get("category")})}

    async def suggest_names(self, typed: str = "", *, company_number: str = "", website: str = "", limit: int = 6) -> list[dict]:
        """Fast name suggestions, or an exact public match by registered number/domain."""
        if company_number or website:
            key = next(iter(identity_keys({"name": "", "company_number": company_number, "website": website, "country": ""})), None)
            if not key:
                return []
            hit = await self.store.find_key("identities", SCOPE, None, key)
            profile = await self.store.get("profiles", hit["data"]["profile_id"]) if hit else None
            data = (profile or {}).get("data") or {}
            if not profile or data.get("publication") not in ("published", "noindex") or level_for(data, await self.visibility()) != "public":
                return []
            return [{"id": profile["id"], "slug": data.get("slug"), "name": data.get("name"), "location": data.get("location"),
                     "claimed": bool(data.get("linked_business_id"))}]
        if len(str(typed or "").strip()) < 2:
            return []
        items = (await self.search(page_size=5000))["items"]
        scored = [(max(name_likeness(typed, b.get("name")), name_likeness(typed, b.get("trading_name"))), b) for b in items]
        scored = sorted((x for x in scored if x[0] >= 0.62), key=lambda x: (-x[0], str(x[1].get("name")).lower()))
        return [{"id": b["id"], "slug": b.get("slug"), "name": b.get("name"), "location": b.get("location"), "claimed": bool(b.get("claimed"))} for _s, b in scored[:limit]]

    async def public_profile(self, ref: str, viewer: dict | None = None, via: dict | None = None) -> dict:
        row = await self._profile(ref)
        d = row["data"] or {}
        if not await self._may_see(row, viewer, via):
            raise NotFound()      # hidden at this visibility level: the same answer as a profile that doesn't exist
        # Suppressed (unlisted) profiles are gone for everyone; an unpublished one shows only once a business has claimed it.
        own_page = False
        if viewer and d.get("linked_business_id") and (d.get("origin") == "created" or d.get("claim_state") == "created"):
            try:      # its owner can open their own profile before it is public (to verify the business, or while it waits for review)
                await self.business.actor(viewer["id"], d["linked_business_id"], {}, viewer.get("email"))
                own_page = True
            except bz.BusinessAccessDenied:
                own_page = False
        self_made = d.get("origin") == "created" or d.get("claim_state") == "created"
        if d.get("publication") in ("suppressed", "merged") or (d.get("publication") == "unpublished" and (not d.get("linked_business_id") or (self_made and not own_page))):
            raise NotFound()
        linked = await self._linked(row)
        out = self._public(row, linked, full=True)
        held = listing_quality(_with_public_services(marketplace_settings(linked), row)) if out["claimed"] and out.get("activated") else {}
        if not out["claimed"] and level_for(d, await self.visibility()) != "public":
            out["noindex"] = True      # opened by invitation or exact match: never for search engines
        out["canonical_slug"] = d.get("slug")
        if not out["claimed"]:
            out["requests_waiting"] = len(await self._held_requests(row["id"]))      # the number only: never who, or what they asked
        out["owner_controls"] = False
        if viewer and d.get("linked_business_id"):
            try:      # owner controls only for an authorised member of the linked business
                actor = await self.business.actor(viewer["id"], d["linked_business_id"], {}, viewer.get("email"))
                out["owner_controls"] = bool(actor.is_owner or actor.can_send)
                out["business_id"] = d["linked_business_id"] if out["owner_controls"] else None
            except bz.BusinessAccessDenied:
                pass
        if held:
            if not out["owner_controls"]:
                raise NotFound()      # not shown to the public until it passes; its owner still sees it, with what to fix
            out["quality_hold"] = list(held.values())
            out["noindex"] = True
        return out

    async def record_view(self, ref: str, viewer: dict | None = None, via: dict | None = None) -> None:
        row = await self._profile(ref)
        if not await self._may_see(row, viewer, via):
            return
        await self.event("profile_viewed", profile_id=row["id"], payload={"claimed": (row["data"] or {}).get("claim_state") == "verified"})

    # ── requests left on a profile nobody has claimed yet ─────────────────────

    async def _held_requests(self, profile_id: str) -> list[dict]:
        try:
            return [r for r in await self.store.list("requests", SCOPE, subject_id=profile_id, limit=500) if r.get("status") == "held"]
        except NotSetUp:
            return []

    async def hold_request(self, ref: str, raw: dict, *, viewer: dict | None = None, via: dict | None = None, sender_workspace_id: str | None = None) -> dict:
        """A quote, a question or a proposal for a business that hasn't claimed its profile. Kept privately until a claim
        on this profile is verified, then handed to that business. Nobody sees the sender's details before that.
        A proposal is taken when the team opened the profile for proposals, or in reply to an RFP the team published for it."""
        row = await self._profile(ref)
        d = row["data"] or {}
        if not await self._may_see(row, viewer, via) or d.get("publication") not in ("published", "noindex"):
            raise NotFound()
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            raise Conflict("claimed", "This business has claimed its profile. Contact it from its listing.")
        raw = raw if isinstance(raw, dict) else {}
        kind = raw.get("kind") if raw.get("kind") in ("quote", "enquiry", "proposal") else "enquiry"
        rfp = self._rfp_of(d, _text(raw.get("request_id"), 64)) if kind == "proposal" and raw.get("request_id") else None
        if kind == "proposal" and raw.get("request_id") and not rfp:
            raise Conflict("request_closed", "This request isn't taking proposals any more.")
        if kind == "proposal" and not rfp and not d.get("held_proposals_open"):
            raise Conflict("proposals_closed", "This business isn't taking proposals here. You can ask a question instead.")
        title = (_text(raw.get("title"), 200) or (rfp or {}).get("title") or "") if kind == "proposal" else ""
        name, email = _text(raw.get("name"), 120), _text(raw.get("email"), 200).lower()
        details = _text(raw.get("details"), MAX_TEXT)
        items = []
        for it in (raw.get("items") if isinstance(raw.get("items"), list) else [])[:20]:
            label = _text((it or {}).get("name"), 200) if isinstance(it, dict) else ""
            if len(label) >= 2:
                try:
                    amount = max(1, min(int(it.get("quantity") or 1), 1_000_000))
                except (TypeError, ValueError):
                    amount = 1
                items.append({"name": label, "quantity": amount, "notes": _text(it.get("notes"), 400) or None})
        errors: dict[str, str] = {}
        if len(name) < 2:
            errors["name"] = "Enter your name."
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            errors["email"] = "Enter a valid email address, so the business can reply."
        if kind == "quote" and not items:
            errors["items"] = "Choose at least one product or service."
        if kind == "enquiry" and len(details) < 5:
            errors["details"] = "Write your question."
        if kind == "proposal":
            if len(title) < 3:
                errors["title"] = "Give your proposal a title."
            if len(details) < 20 and not rfp and not isinstance(raw.get("proposal"), dict):      # the full flow may carry a document instead
                errors["details"] = "Describe what you're proposing (at least 20 characters)."
        if errors:
            raise Invalid(errors)
        waiting = await self.store.list("requests", SCOPE, subject_id=row["id"], limit=500)
        now = self.clock()
        mine = [r for r in waiting if (r["data"] or {}).get("customer_email") == email]
        same = next((r for r in mine if r.get("status") == "held" and (r["data"] or {}).get("items") == items and (r["data"] or {}).get("details") == details
                     and str(r.get("created_at")) >= (now - timedelta(minutes=10)).isoformat()), None)
        if same:      # a double click, or a retry after a slow reply: the request already on record
            return {"id": same["id"], "status": "held", "new": False, "business_name": d.get("name")}
        if len([r for r in mine if str(r.get("created_at")) >= (now - timedelta(days=1)).isoformat()]) >= HELD_REQUESTS_PER_SENDER_DAY \
                or len([r for r in waiting if r.get("status") == "held"]) >= HELD_REQUESTS_PER_PROFILE:
            raise RateLimited()
        saved = await self.store.insert("requests", {
            "id": new_id(), "business_id": SCOPE, "kind": kind, "subject_id": row["id"], "status": "held", "revision": 1, "key": None,
            "created_by": (viewer or {}).get("id"), "created_at": now, "updated_at": now,
            "data": {"customer_name": name, "customer_email": email, "customer_company": _text(raw.get("company"), 200) or None, "items": items, "details": details,
                     "needed_by": _text(raw.get("needed_by"), 40) or None, "sender_workspace_id": sender_workspace_id,
                     **({"title": title} if kind == "proposal" else {}), **({"request_id": rfp["id"], "request_title": rfp["title"]} if rfp else {}),
                     **({"proposal": raw["proposal"]} if kind == "proposal" and isinstance(raw.get("proposal"), dict) else {})}})
        await self.event("HeldRequestReceived", profile_id=row["id"], payload={"kind": kind, "request_id": saved["id"]})      # nothing about the sender
        return {"id": saved["id"], "status": "held", "new": True, "business_name": d.get("name"), "request_title": (rfp or {}).get("title")}

    async def waiting_requests(self, admin: dict, ref: str) -> dict:
        """The requests kept for a profile nobody has claimed, in full, for the team. Who looked is kept.
        A party to the profile doesn't read them: they could be a competitor collecting its buyers."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You have a claim on this profile, or belong to a business that does, so someone else has to read its requests.")
        rows = sorted(await self._held_requests(profile["id"]), key=lambda r: str(r.get("created_at")), reverse=True)
        await self.event("HeldRequestsViewed", profile_id=profile["id"], actor=f"moderator:{admin['id']}", payload={"count": len(rows)})
        return {"name": (profile["data"] or {}).get("name"), "slug": (profile["data"] or {}).get("slug"), "items": [
            {"id": r["id"], "kind": r.get("kind"), "received_at": r.get("created_at"), "name": (r["data"] or {}).get("customer_name"), "email": (r["data"] or {}).get("customer_email"),
             "company": (r["data"] or {}).get("customer_company"), "items": (r["data"] or {}).get("items") or [], "details": (r["data"] or {}).get("details") or "", "needed_by": (r["data"] or {}).get("needed_by"),
             "title": (r["data"] or {}).get("title"), "request_title": (r["data"] or {}).get("request_title")} for r in rows]}

    async def _delivered_count(self, profile_id: str, business_id: str | None) -> int:
        return len([r for r in await self.store.list("requests", SCOPE, subject_id=profile_id, limit=500)
                    if r.get("status") == "delivered" and (r["data"] or {}).get("delivered_to") == business_id])

    async def _take_back_held(self, profile_id: str, business_id: str) -> int:
        """Control was removed: requests it hasn't answered leave its workspace and wait for whoever claims next.
        One it has already answered stays, as the record of what it sent. A failure here never undoes the revocation."""
        try:
            sent = [r for r in await self.store.list("requests", SCOPE, subject_id=profile_id, limit=500)
                    if r.get("status") == "delivered" and (r["data"] or {}).get("delivered_to") == business_id]
            if not sent:
                return 0
            ids = {str(r["id"]) for r in sent}
            back: list[str] = []

            def take(data: dict) -> None:
                fin = dict(data.get("financials") or {})
                keep = []
                for x in fin.get("rfq_requests") or []:
                    if isinstance(x, dict) and str(x.get("id")) in ids and x.get("status") == "pending" and not x.get("quote_id"):
                        back.append(str(x["id"]))
                    else:
                        keep.append(x)
                fin["rfq_requests"] = keep
                data["financials"] = fin
                inbox = []
                for x in data.get("proposal_inbox") or []:
                    if isinstance(x, dict) and str(x.get("id")) in ids and x.get("status") == "SUBMITTED" and not x.get("viewed_at"):
                        back.append(str(x["id"]))
                    else:
                        inbox.append(x)
                data["proposal_inbox"] = inbox
            await self.business.mutate(business_id, take)
            for r in sent:
                if str(r["id"]) in back:
                    data = {k: v for k, v in (r["data"] or {}).items() if k not in ("delivered_to", "delivered_at")}
                    await self.store.update("requests", r["id"], {"status": "held", "updated_at": self.clock(), "data": data}, bump=False)
            await self.event("HeldRequestsTakenBack", profile_id=profile_id, business_id=business_id, payload={"count": len(back)})
            return len(back)
        except Exception:      # noqa: BLE001
            logger.warning("Requests could not be taken back after a revocation", exc_info=True)
            return 0

    async def _hand_over_rfps(self, profile_id: str, business_id: str) -> None:
        """RFPs the team published for this profile become the business's own requests, still open, so replies keep coming."""
        profile = await self.store.get("profiles", profile_id)
        rfps = [r for r in ((profile or {}).get("data") or {}).get("rfps") or [] if isinstance(r, dict)]
        if not rfps:
            return

        def put(data: dict) -> None:
            have = list(data.get("proposal_requests") or [])
            known = {str(x.get("id")) for x in have if isinstance(x, dict)}
            data["proposal_requests"] = [*[{**r, "workspace_id": business_id} for r in rfps if str(r.get("id")) not in known], *have]
        await self.business.mutate(business_id, put)

    async def _deliver_held(self, profile_id: str, business_id: str) -> int:
        """Authority is established: everything left on this profile goes to the business's own requests, in the shape
        any request has, with the date it was really sent. Safe to run again. A failure here never undoes a claim."""
        try:
            waiting = await self._held_requests(profile_id)
            await self._hand_over_rfps(profile_id, business_id)
            if not waiting:
                return 0
            profile = await self.store.get("profiles", profile_id)
            listing = ((profile or {}).get("data") or {}).get("name")

            def as_request(r: dict) -> dict:
                h = r["data"] or {}
                return {"id": r["id"], "workspace_id": business_id, "customer_name": h.get("customer_name"), "customer_email": h.get("customer_email"),
                        "items": h.get("items") or [{"name": "A question", "quantity": 1, "notes": None}], "message": h.get("details") or None,
                        "status": "pending", "created_at": str(r.get("created_at")), "quote_id": None, "sender_workspace_id": h.get("sender_workspace_id"),
                        "customer_company": h.get("customer_company"), "needed_by": h.get("needed_by"), "listing": listing, "kept_until_claimed": True}

            def as_proposal(r: dict, recipient: str | None) -> dict:
                h = r["data"] or {}
                at = str(r.get("created_at"))
                return {"id": r["id"], "status": "SUBMITTED", "version": 1, "request_id": h.get("request_id"), "request_title": h.get("request_title"),
                        "proposer_workspace_id": h.get("sender_workspace_id"), "proposer_name": h.get("customer_company") or h.get("customer_name"),
                        "proposer_email": h.get("customer_email"), "proposer_contact_name": h.get("customer_name"),
                        "recipient_workspace_id": business_id, "recipient_name": recipient or listing, "title": h.get("title"), "summary": h.get("details") or "",
                        "sections": (h.get("proposal") or {}).get("sections") or [], "requirement_responses": (h.get("proposal") or {}).get("requirement_responses") or [],
                        "attachments": (h.get("proposal") or {}).get("attachments") or [],
                        "events": [{"event_type": "submitted", "actor": "proposer", "created_at": at}],
                        "submitted_at": at, "updated_at": at, "viewed_at": None, "kept_until_claimed": True, "listing": listing}

            def put(data: dict) -> None:
                fin = dict(data.get("financials") or {})
                have = list(fin.get("rfq_requests") or [])
                known = {str(x.get("id")) for x in have if isinstance(x, dict)}
                fin["rfq_requests"] = [*have, *[as_request(r) for r in waiting if r.get("kind") != "proposal" and str(r["id"]) not in known]]
                data["financials"] = fin
                inbox = list(data.get("proposal_inbox") or [])
                there = {str(x.get("id")) for x in inbox if isinstance(x, dict)}
                recipient = (data.get("workspace_profile") or {}).get("company_name")
                data["proposal_inbox"] = [*[as_proposal(r, recipient) for r in waiting if r.get("kind") == "proposal" and str(r["id"]) not in there], *inbox]
            await self.business.mutate(business_id, put)
            at = self.clock()
            for r in waiting:
                await self.store.update("requests", r["id"], {"status": "delivered", "updated_at": at, "data": {**r["data"], "delivered_to": business_id, "delivered_at": at.isoformat()}}, bump=False)
            await self.event("HeldRequestsDelivered", profile_id=profile_id, business_id=business_id, payload={"count": len(waiting)})
        except Exception:      # noqa: BLE001 - they stay held, and the next step of the claim tries again
            logger.warning("Requests held for a claimed profile could not be delivered yet", exc_info=True)
            return 0
        if self._request_delivered:
            for r in waiting:
                await self._request_delivered(business_id, r["id"])
        return len(waiting)

    async def report(self, ref: str, *, kind: str, message: str, reporter_email: str | None = None, viewer: dict | None = None, via: dict | None = None) -> dict:
        """A correction, or a request to unlist, from anyone who can see the profile: no account or claim needed."""
        row = await self._profile(ref)
        if not await self._may_see(row, viewer, via):
            raise NotFound()
        if kind not in ("correction", "unlist", "other"):
            raise Invalid({"kind": "Choose what you are reporting."})
        if len(_text(message)) < 5:
            raise Invalid({"message": "Tell us what is wrong so it can be put right."})
        open_ = [r for r in await self.store.list("reports", SCOPE, subject_id=row["id"], limit=50) if r.get("status") == "open"]
        if len(open_) >= 20:
            raise RateLimited()
        saved = await self.store.insert("reports", {"id": new_id(), "business_id": SCOPE, "kind": kind, "subject_id": row["id"], "status": "open", "revision": 1,
                                                    "key": None, "created_by": None, "created_at": self.clock(), "updated_at": self.clock(),
                                                    "data": {"message": _text(message), "reporter_email": _text(reporter_email, 200).lower() or None}})
        await self.event("directory_report_submitted", profile_id=row["id"], payload={"kind": kind, "report_id": saved["id"]})
        return {"id": saved["id"], "status": "open", "message": "Thank you. We'll review this; you don't need an account for us to act on it."}

    # ── claim context through sign-in ─────────────────────────────────────────

    async def create_intent(self, ref: str, *, opportunity_ref: str | None = None, source: str | None = None, invitation_token: str | None = None,
                            access: str | None = None, viewer: dict | None = None) -> dict:
        """Remember which profile is being claimed, and why, before the person has signed in."""
        row = await self._profile(ref)
        if not await self._may_see(row, viewer, {"invitation": invitation_token, "access": access}):
            raise NotFound()
        token = secrets.token_urlsafe(24)
        invitation = await self._invitation(invitation_token) if invitation_token else None
        if invitation and invitation["subject_id"] == row["id"]:
            opportunity_ref = opportunity_ref or invitation["data"].get("opportunity_ref")
            source = source or f"invitation:{invitation['data'].get('reason')}"
        await self.store.insert("intents", {"id": new_id(), "business_id": SCOPE, "kind": "claim_intent", "subject_id": row["id"], "status": "open", "revision": 1,
                                            "key": _hash(token), "created_by": None, "created_at": self.clock(), "updated_at": self.clock(),
                                            "data": {"opportunity_ref": _text(opportunity_ref, 120) or None, "acquisition_source": _text(source, 80) or "marketplace_profile",
                                                     "invitation_id": invitation["id"] if invitation else None, "expires_at": (self.clock() + timedelta(days=7)).isoformat()}})
        await self.event("claim_cta_clicked", profile_id=row["id"], payload={"source": _text(source, 80) or "marketplace_profile", "has_opportunity": bool(opportunity_ref)})
        return {"intent": token, "profile": self._public(row, None), "opportunity": await self._opportunity_teaser(row, opportunity_ref)}

    async def _intent(self, token: str | None) -> dict | None:
        if not token:
            return None
        row = await self.store.find_key("intents", SCOPE, None, _hash(token))
        if not row or str((row["data"] or {}).get("expires_at")) < self.clock().isoformat():
            return None
        return row

    async def _opportunity_teaser(self, profile: dict, ref: str | None) -> dict | None:
        """Says only that a current request may be relevant, and only when a real, open one is.
        Never the buyer, their contact details or the request body."""
        if not ref:
            return None
        found = await self._opportunity_lookup(ref) if self._opportunity_lookup else None
        if not found:
            return {"reference": ref, "available": False, "text": "The request that brought you here is no longer available. You can still claim your profile."}
        match = match_opportunity({**(profile["data"] or {}), "service_tags": [t["tag"] for t in (profile["data"] or {}).get("service_tags") or []]}, found)
        if not match["eligible"]:
            return {"reference": ref, "available": False, "text": "The request that brought you here is no longer available. You can still claim your profile."}
        return {"reference": ref, "available": True, "text": "A current Marketplace request may match your services.",
                "note": "Claim and verify your profile to see the request and respond. This is not a promise of work."}

    # ── claims ────────────────────────────────────────────────────────────────

    def _next_step(self, claim: dict, profile: dict) -> str:
        st, d = claim.get("status"), claim["data"] or {}
        if st in ("rejected", "cancelled", "revoked"):
            return "closed"
        if st == "verified":
            return "profile_review" if not d.get("profile_reviewed") else "preferences" if not d.get("preferences_saved") else "context" if not d.get("handoff_completed") else "done"
        if st in ("verification_pending", "disputed") and d.get("awaiting") == "review":
            return "pending_review"
        if not d.get("target"):
            return "match"
        return "verification"

    async def _public_claim(self, claim: dict, user: dict) -> dict:
        d = claim["data"] or {}
        profile = await self.store.get("profiles", claim["subject_id"])
        pub = self._public(profile, None)      # safe identity fields only: never the linked business's private data
        pd = profile["data"] or {}
        holder = pd.get("linked_business_id")
        shown = pd.get("state_before_dispute") if pd.get("claim_state") == "disputed" else pd.get("claim_state")
        if holder and shown in ("created", "verified"):
            pub = {**pub, "trust": TRUST[shown], "claimed": True, "claim": {"eligible": False}}
        held_by_another = bool(holder) and holder != d.get("linked_business_id") and bool(d.get("challenge")) and claim.get("status") in OPEN_CLAIM_STATES
        verifications = await self.store.list("verifications", SCOPE, subject_id=claim["id"], limit=20)
        latest = verifications[0] if verifications else None
        out = {
            "id": claim["id"], "status": claim.get("status"), "revision": claim.get("revision"), "created_at": claim.get("created_at"), "updated_at": claim.get("updated_at"),
            "profile": {**pub, "legal_identifier": (profile["data"] or {}).get("company_number"), "has_website": bool((profile["data"] or {}).get("domain")),
                        "domain": (profile["data"] or {}).get("domain")},
            "challenge": bool(d.get("challenge")), "target": d.get("target"), "business_id": d.get("linked_business_id") if claim.get("status") == "verified" else None,
            "self_verify": bool(d.get("self_verify")),
            "held_by_another": held_by_another,
            "notice": "This profile is managed by another business. Your request will be reviewed." if held_by_another else None,
            "next_step": self._next_step(claim, profile), "reason": d.get("public_reason"),
            "verification": ({"id": latest["id"], "method": latest["kind"], "status": latest.get("status"), "submitted_at": latest.get("created_at"),
                              "destination": (latest["data"] or {}).get("masked"), "attempts_left": max(0, CODE_ATTEMPTS - int((latest["data"] or {}).get("attempts") or 0))
                              if latest["kind"] == "email_domain" else None} if latest else None),
            "methods": self._methods(profile),
            "opportunity": await self._opportunity_teaser(profile, d.get("opportunity_ref")),
            "can": {"cancel": claim.get("status") in OPEN_CLAIM_STATES, "verify": claim.get("status") in ("claim_started", "verification_pending") and bool(d.get("target")),
                    "edit_profile": claim.get("status") == "verified"},
        }
        if claim.get("status") == "verified":
            try:
                out["requests_delivered"] = await self._delivered_count(claim["subject_id"], d.get("linked_business_id"))
            except NotSetUp:
                out["requests_delivered"] = 0
        if out["next_step"] == "match":
            out["candidates"] = await self._candidates(user, profile)
        return out

    @staticmethod
    def _methods(profile: dict) -> list[dict]:
        d = profile["data"] or {}
        out = []
        if d.get("domain"):
            out.append({"method": "email_domain", "label": f"Email a code to an address at {d['domain']}",
                        "help": f"Use an email address at {d['domain']}. We send a 6-digit code that works for 30 minutes."})
        out.append({"method": "manual", "label": "Send evidence for review",
                    "help": "Tell us how you are connected to the business and attach a document if you have one. A person reviews it."})
        return out

    async def _candidates(self, user: dict, profile: dict) -> list[dict]:
        """The claimant's own businesses, most likely match first. Only safe identity fields."""
        d = profile["data"] or {}
        wanted, number, dom = _norm_name(d.get("name") or ""), d.get("company_number"), d.get("domain")
        out = []
        for b in await self.business.owned_by(user["id"]):
            wp = (b["data"] or {}).get("workspace_profile") or {}
            name = wp.get("company_name") or b.get("name") or "Untitled business"
            linked = ((b["data"] or {}).get("marketplace") or {}).get("directory_profile_id")
            if linked and linked != profile["id"] and await self._own_created(b["id"], b["data"] or {}):
                linked = None      # its own "Created on EnterprateAI" profile is folded into the claimed one
            score = (3 if number and re.sub(r"[^A-Z0-9]", "", str(wp.get("registration_number") or "").upper()) == number else 0) \
                + (2 if dom and domain_of(wp.get("website")) == dom else 0) + (2 if _norm_name(name) == wanted else 0)
            out.append({"business_id": b["id"], "name": name, "location": ", ".join(x for x in (wp.get("city"), wp.get("country")) if x), "likely_match": score >= 2,
                        "already_linked": bool(linked) and linked != profile["id"], "_score": score})
        out.sort(key=lambda c: -c["_score"])
        return [{k: v for k, v in c.items() if k != "_score"} for c in out]

    async def start_claim(self, user: dict, ref: str, *, intent: str | None = None, opportunity_ref: str | None = None, source: str | None = None,
                          access: str | None = None, invitation: str | None = None) -> dict:
        """Begin, or resume, this person's claim on a profile. One open claim per person per profile."""
        profile = await self._profile(ref)
        d = profile["data"] or {}
        if not await self._may_see(profile, user, {"intent": intent, "access": access, "invitation": invitation}):
            raise NotFound()
        if d.get("publication") in ("suppressed", "unpublished"):
            raise NotFound()
        key = f"{profile['id']}:{user['id']}"
        existing = await self.store.find_key("claims", SCOPE, profile["id"], key)
        if existing and existing.get("status") in (*OPEN_CLAIM_STATES, "verified"):
            return await self._public_claim(existing, user)
        challenge = False
        if d.get("linked_business_id") and d.get("claim_state") in HELD_STATES:
            try:      # an authorised member of the business that holds it goes straight to it
                actor = await self.business.actor(user["id"], d["linked_business_id"], {}, user.get("email"))
                raise Conflict("already_yours", "Your business already manages this profile.", {"business_id": d["linked_business_id"], "owner_controls": bool(actor.is_owner or actor.can_send)})
            except bz.BusinessAccessDenied:
                challenge = True      # someone else holds it: this becomes a controlled challenge, reviewed by a person
        day_ago = (self.clock() - timedelta(days=1)).isoformat()
        recent = [c for c in await self.store.list("claims", SCOPE, kind=user["id"], limit=50) if str(c.get("created_at")) >= day_ago]
        if len(recent) >= CLAIMS_PER_DAY:
            raise RateLimited()
        ctx = await self._intent(intent)
        ctx_data = (ctx["data"] if ctx and ctx["subject_id"] == profile["id"] else {}) or {}
        now = self.clock()
        record = {"id": new_id(), "business_id": SCOPE, "kind": user["id"], "subject_id": profile["id"], "status": "claim_started", "revision": 1,
                  "key": key if not existing else f"{key}:{now.isoformat()}", "created_by": user["id"], "created_at": now, "updated_at": now,
                  "data": {"claimant_email": user.get("email"), "challenge": challenge, "target": None,
                           "opportunity_ref": ctx_data.get("opportunity_ref") or _text(opportunity_ref, 120) or None,
                           "acquisition_source": ctx_data.get("acquisition_source") or _text(source, 80) or "marketplace_profile",
                           "invitation_id": ctx_data.get("invitation_id"),
                           "history": [{"status": "claim_started", "at": now.isoformat(), "actor": user["id"], "method": None, "reason": "Claim started" + (" as a challenge" if challenge else "")}]}}
        if existing:      # an earlier claim that was rejected or cancelled: free its key so this one is the open claim
            await self.store.update("claims", existing["id"], {"key": f"{key}:closed:{existing['id']}"}, bump=False)
            record["key"] = key
        try:
            claim = await self.store.insert("claims", record)
        except Duplicate:      # the same request arrived twice
            claim = await self.store.find_key("claims", SCOPE, profile["id"], key)
        await self.event("BusinessClaimStarted", profile_id=profile["id"], claim_id=claim["id"], actor=user["id"],
                         payload={"challenge": challenge, "source": claim["data"]["acquisition_source"], "has_opportunity": bool(claim["data"]["opportunity_ref"])})
        return await self._public_claim(claim, user)

    async def start_self_verification(self, user: dict, business_id: str) -> dict:
        """"Verify your business": the owner of a self-made profile shows they manage the business,
        by the same methods as a claim. The profile is created (unpublished) if there isn't one yet,
        so a business can verify before it publishes."""
        ctx = await self._owner_ctx(user, business_id, edit=True)
        if ctx["owner_id"] != user["id"]:
            raise Forbidden("Only the owner of the business can verify it.")
        profile = await self._editable(business_id, ctx["data"])
        if profile and (profile["data"] or {}).get("claim_state") == "verified":
            raise Conflict("already_verified", "This business is already verified.")
        if profile is None:
            profile = await self.sync_listing(business_id, actor=user["id"], data=ctx["data"], profile=None, ensure=True)
        key = f"{profile['id']}:{user['id']}"
        existing = await self.store.find_key("claims", SCOPE, profile["id"], key)
        if existing and existing.get("status") in (*OPEN_CLAIM_STATES, "verified"):
            return await self._public_claim(existing, user)
        now = self.clock()
        record = {"id": new_id(), "business_id": SCOPE, "kind": user["id"], "subject_id": profile["id"], "status": "claim_started", "revision": 1, "key": key,
                  "created_by": user["id"], "created_at": now, "updated_at": now,
                  "data": {"claimant_email": user.get("email"), "challenge": False, "self_verify": True, "target": business_id, "opportunity_ref": None,
                           "acquisition_source": "self_verification", "invitation_id": None,
                           "history": [{"status": "claim_started", "at": now.isoformat(), "actor": user["id"], "method": None, "reason": "Verification of a self-made profile started"}]}}
        if existing:
            await self.store.update("claims", existing["id"], {"key": f"{key}:closed:{existing['id']}"}, bump=False)
        claim = await self.store.insert("claims", record)
        await self.event("BusinessClaimStarted", profile_id=profile["id"], claim_id=claim["id"], business_id=business_id, actor=user["id"], payload={"self_verify": True, "challenge": False, "source": "self_verification"})
        return await self._public_claim(claim, user)

    async def _name_matches(self, business_id: str, data: dict, profile: dict | None) -> list[dict]:
        """Other profiles that carry this business's name (ignoring case, punctuation and "Ltd",
        "Limited", "LLP"): sourced ones at any visibility, and verified ones. Not profiles this
        business holds, and not other unverified self-made ones."""
        wanted = _norm_name(marketplace_settings(data)["profile"]["name"])
        if len(wanted) < 2:
            return []
        out = []
        try:
            rows = await self.store.list("profiles", SCOPE, limit=5000)
        except NotSetUp:
            return []
        for r in rows:
            d = r["data"] or {}
            if (profile and r["id"] == profile["id"]) or d.get("publication") in ("suppressed", "merged") or d.get("linked_business_id") == business_id:
                continue
            sourced = not d.get("linked_business_id") and d.get("origin") != "created"
            verified = bool(d.get("linked_business_id")) and d.get("claim_state") in ("verified", "disputed")
            if (sourced or verified) and wanted in {_norm_name(d.get("name") or ""), _norm_name(d.get("trading_name") or "")}:
                out.append({"id": r["id"], "slug": d.get("slug"), "name": d.get("name"), "location": d.get("location") or "", "claimed": verified,
                            "trust": TRUST["verified" if verified else "unclaimed"], "domain": d.get("domain")})
        return out

    async def _approve_self(self, claim: dict, *, actor: str, method: str, reason: str) -> dict:
        """A self-made profile is verified. An emailed code is enough on its own only when nothing
        else carries the business's name or details; otherwise a person decides. If it matches a
        sourced profile, the two become one: the sourced address stays, the self-made one redirects."""
        cd = claim["data"] or {}
        business_id = cd.get("target")
        own = await self._own_created(business_id)
        if not own:
            raise Conflict("not_self_made", "This business no longer has a self-made profile to verify.")
        data = await self.business.load(business_id)
        indexed = await self._duplicates(business_id, data, own)
        names = await self._name_matches(business_id, data, own)
        if method != "manual_review":
            domain = (own["data"] or {}).get("domain")
            sourced_ids = {i["id"] for i in indexed}
            unsafe = any(n["id"] not in sourced_ids for n in names) or any(domain_of(i.get("website")) != domain for i in indexed)
            if unsafe:
                # The code shows they control their own website. It doesn't show they are the business another profile describes.
                return await self._move(claim, "verification_pending", actor=actor, method=method, reason="Matches another profile: a person checks before it is verified",
                                        patch={"awaiting": "review", "needs_review_because": "name_or_details_match"})
        now = self.clock().isoformat()
        final = own
        if indexed:
            into = await self.store.get("profiles", indexed[0]["id"])
            entry = await self._merge_created(own, into, business_id, actor)
            d = into["data"] or {}
            final = await self.store.update("profiles", into["id"], {"updated_at": self.clock(), "data": {
                **d, "linked_business_id": business_id, "claim_state": "verified", "claimed_at": now, "merged_from": [*(d.get("merged_from") or []), entry]}}) or into

            def link(doc: dict) -> None:
                m = dict(doc.get("marketplace") or {})
                m["directory_profile_id"] = into["id"]
                _keep_public_services(m, d)
                doc["marketplace"] = m
            await self.business.mutate(business_id, link)
            await self.store.update("claims", claim["id"], {"subject_id": into["id"]}, bump=False)
            claim = {**claim, "subject_id": into["id"]}
        else:
            final = await self.store.update("profiles", own["id"], {"updated_at": self.clock(), "data": {**own["data"], "claim_state": "verified", "claimed_at": now}}) or own
        # Their existing business: nothing to set up afterwards, so the journey is complete.
        saved = await self._move(claim, "verified", actor=actor, method=method, reason=reason,
                                 patch={"linked_business_id": business_id, "awaiting": None, "verified_at": now, "profile_reviewed": True, "preferences_saved": True, "handoff_completed": True})
        await self._deliver_held(final["id"], business_id)
        await self.event("BusinessClaimVerified", profile_id=final["id"], claim_id=claim["id"], business_id=business_id, actor=actor, payload={"method": method, "self_verify": True, "merged": bool(indexed)})
        return saved

    async def my_claims(self, user: dict) -> list[dict]:
        rows = await self.store.list("claims", SCOPE, kind=user["id"], limit=50)
        return [await self._public_claim(c, user) for c in rows if c.get("status") != "cancelled"]

    async def get_claim(self, user: dict, claim_id: str) -> dict:
        return await self._public_claim(await self._claim(claim_id, user), user)

    async def _move(self, claim: dict, status: str, *, actor: str, method: str | None = None, reason: str = "", patch: dict | None = None,
                    public_reason: str | None = None) -> dict:
        """Every claim state change keeps who, how, when and why."""
        data = {**(claim["data"] or {}), **(patch or {}), "public_reason": public_reason}
        data["history"] = [*(data.get("history") or []), {"status": status, "at": self.clock().isoformat(), "actor": actor, "method": method, "reason": reason}]
        return await self.store.update("claims", claim["id"], {"status": status, "data": data, "updated_at": self.clock()}) or claim

    async def confirm_match(self, user: dict, claim_id: str, target: str) -> dict:
        """W05: which of the claimant's businesses this profile belongs to, or "new"."""
        claim = await self._claim(claim_id, user)
        if claim.get("status") != "claim_started":
            raise Conflict("not_open", "This claim is past the matching step.")
        profile = await self.store.get("profiles", claim["subject_id"])
        if target != "new":
            owned = {b["id"]: b for b in await self.business.owned_by(user["id"])}
            if target not in owned:
                raise NotFound()      # not theirs, or not there: the same answer
            linked = ((owned[target]["data"] or {}).get("marketplace") or {}).get("directory_profile_id")
            if linked and linked != profile["id"] and not await self._own_created(target, owned[target]["data"] or {}):
                raise Conflict("business_already_linked", "That business already has a Marketplace profile. One business has one profile; contact support if they should be merged.")
        saved = await self._move(claim, "claim_started", actor=user["id"], reason="Business confirmed" if target != "new" else "A new business will be created after verification",
                                 patch={"target": target})
        await self.event("business_match_confirmed", profile_id=profile["id"], claim_id=claim["id"], actor=user["id"], payload={"new_business": target == "new"})
        return await self._public_claim(saved, user)

    async def start_verification(self, user: dict, claim_id: str, *, method: str, email: str | None = None, note: str | None = None) -> dict:
        claim = await self._claim(claim_id, user)
        if claim.get("status") not in ("claim_started", "verification_pending"):
            raise Conflict("not_open", "This claim can't be verified in its current state.")
        if not (claim["data"] or {}).get("target"):
            raise Conflict("match_first", "Confirm which business this profile belongs to first.")
        profile = await self.store.get("profiles", claim["subject_id"])
        d = profile["data"] or {}
        now = self.clock()
        if method == "email_domain":
            address = _text(email, 200).lower()
            host = address.split("@")[-1] if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", address) else ""
            if not d.get("domain"):
                raise Invalid({"method": "This profile has no website on record, so an email check isn't possible. Send evidence for review instead."})
            if not host:
                raise Invalid({"email": "Enter a valid email address."})
            if host in FREE_MAIL or not (host == d["domain"] or host.endswith("." + d["domain"])):
                raise Invalid({"email": f"Use an email address at {d['domain']}. A personal address can't show that you manage this business."})
            hour_ago = (now - timedelta(hours=1)).isoformat()
            sends = [v for v in await self.store.list("verifications", SCOPE, subject_id=claim["id"], limit=50) if v["kind"] == "email_domain" and str(v.get("created_at")) >= hour_ago]
            if len(sends) >= CODE_SENDS_PER_HOUR:
                raise RateLimited()
            code = f"{secrets.randbelow(1_000_000):06d}"
            masked = address[0] + "\u2022\u2022\u2022@" + host
            v = await self.store.insert("verifications", {"id": new_id(), "business_id": SCOPE, "kind": "email_domain", "subject_id": claim["id"], "status": "sent", "revision": 1,
                                                          "key": None, "created_by": user["id"], "created_at": now, "updated_at": now,
                                                          "data": {"code_hash": _hash(f"{claim['id']}:{code}"), "expires_at": (now + CODE_TTL).isoformat(), "attempts": 0,
                                                                   "masked": masked, "domain": host, "address": address}})
            if self._send_code:
                await self._send_code(address, code, d.get("name") or "your business")
            else:
                self.sent_codes.append((address, code))
            saved = await self._move(claim, "verification_pending", actor=user["id"], method="email_domain", reason="Code sent", patch={"awaiting": "code"})
        elif method == "manual":
            if len(_text(note)) < 10:
                raise Invalid({"note": "Tell us how you are connected to this business (a sentence or two)."})
            v = await self.store.insert("verifications", {"id": new_id(), "business_id": SCOPE, "kind": "manual", "subject_id": claim["id"], "status": "submitted", "revision": 1,
                                                          "key": None, "created_by": user["id"], "created_at": now, "updated_at": now, "data": {"note": _text(note), "files": []}})
            if (claim["data"] or {}).get("challenge"):
                # Someone else holds the profile: it is now under review, and their public edits pause until a person decides.
                saved = await self._open_dispute(claim, user["id"], "manual")
            else:
                saved = await self._move(claim, "verification_pending", actor=user["id"], method="manual", reason="Evidence submitted for review", patch={"awaiting": "review"})
        else:
            raise Invalid({"method": "Choose one of the verification methods offered."})
        await self.event("verification_started", profile_id=profile["id"], claim_id=claim["id"], actor=user["id"], payload={"method": method, "verification_id": v["id"]})
        return await self._public_claim(saved, user)

    async def attach_evidence(self, user: dict, claim_id: str, verification_id: str, name: str, content_type: str, content: bytes) -> dict:
        claim = await self._claim(claim_id, user)
        v = await self.store.get("verifications", verification_id)
        if not v or v["subject_id"] != claim["id"] or v["kind"] != "manual" or v.get("status") != "submitted":
            raise NotFound()
        if content_type not in FILE_TYPES:
            raise Invalid({"file": "Attach a PDF or an image."})
        if not content or len(content) > MAX_FILE_BYTES:
            raise Invalid({"file": "The file is empty or larger than 10 MB."})
        if len((v["data"] or {}).get("files") or []) >= 5:
            raise Invalid({"file": "Up to five files can be attached."})
        path = f"{claim['id']}/{new_id()}.{FILE_TYPES[content_type]}"
        await self.store.put_file(path, content, content_type)
        files = [*((v["data"] or {}).get("files") or []), {"path": path, "name": _text(name, 200) or "evidence", "content_type": content_type, "size": len(content)}]
        await self.store.update("verifications", v["id"], {"data": {**v["data"], "files": files}, "updated_at": self.clock()}, bump=False)
        return await self._public_claim(claim, user)

    async def complete_verification(self, user: dict, claim_id: str, verification_id: str, code: str) -> dict:
        """Check the emailed code. Passing it establishes authority; the business is then linked."""
        claim = await self._claim(claim_id, user)
        if claim.get("status") == "verified":
            return await self._public_claim(claim, user)      # a retry after success changes nothing
        v = await self.store.get("verifications", verification_id)
        if not v or v["subject_id"] != claim["id"] or v["kind"] != "email_domain":
            raise NotFound()
        data = dict(v["data"] or {})
        if v.get("status") != "sent" or str(data.get("expires_at")) < self.clock().isoformat():
            await self.store.update("verifications", v["id"], {"status": "expired"}, bump=False)
            raise Invalid({"code": "That code has expired. Ask for a new one."})
        if int(data.get("attempts") or 0) >= CODE_ATTEMPTS:
            raise Invalid({"code": "Too many attempts. Ask for a new code, or send evidence for review instead."})
        if not secrets.compare_digest(_hash(f"{claim['id']}:{_text(code, 12)}"), str(data.get("code_hash"))):
            data["attempts"] = int(data.get("attempts") or 0) + 1
            failed = data["attempts"] >= CODE_ATTEMPTS
            await self.store.update("verifications", v["id"], {"data": data, "status": "failed" if failed else "sent", "updated_at": self.clock()}, bump=False)
            await self.event("ClaimVerificationCompleted", profile_id=claim["subject_id"], claim_id=claim["id"], actor=user["id"], payload={"method": "email_domain", "result": "failed"})
            raise Invalid({"code": "That code isn't right." + (" Ask for a new one, or send evidence for review instead." if failed else "")})
        await self.store.update("verifications", v["id"], {"status": "passed", "data": {**data, "passed_at": self.clock().isoformat()}, "updated_at": self.clock()}, bump=False)
        if data.get("address"):      # the address given on the form, now shown to be theirs: the outcome goes there too
            claim = await self.store.update("claims", claim["id"], {"data": {**(claim["data"] or {}), "verified_email": data["address"]}}, bump=False) or claim
        await self.event("ClaimVerificationCompleted", profile_id=claim["subject_id"], claim_id=claim["id"], actor=user["id"], payload={"method": "email_domain", "result": "passed"})
        if await self.is_team_member(user):
            # The team can edit a profile's website, so their own code proves nothing. Another reviewer decides.
            return await self._public_claim(await self._move(claim, "verification_pending", actor=user["id"], method="email_domain",
                                                             reason="The claimant is on the Marketplace team: another reviewer decides", patch={"awaiting": "review"}), user)
        if (claim["data"] or {}).get("challenge"):
            # Authority shown, but someone else holds the profile: a person decides. Their edits pause meanwhile.
            return await self._public_claim(await self._open_dispute(claim, user["id"], "email_domain"), user)
        return await self._public_claim(await self._approve(claim, actor=user["id"], method="email_domain", reason="Email code confirmed"), user)

    async def _open_dispute(self, claim: dict, actor: str, method: str) -> dict:
        profile = await self.store.get("profiles", claim["subject_id"])
        before = profile["data"].get("claim_state")
        await self.store.update("profiles", profile["id"], {"data": {**profile["data"], "claim_state": "disputed",
                                                                     "state_before_dispute": profile["data"].get("state_before_dispute") if before == "disputed" else before},
                                                            "updated_at": self.clock()})
        saved = await self._move(claim, "disputed", actor=actor, method=method, reason="Competing claim on a profile another business manages", patch={"awaiting": "review"})
        await self.event("business_claim_disputed", profile_id=profile["id"], claim_id=claim["id"], actor=actor, payload={})
        return saved

    async def _approve(self, claim: dict, *, actor: str, method: str, reason: str) -> dict:
        """Authority is established: link the profile to its one business. Safe to run twice."""
        if claim.get("status") == "verified" and (claim["data"] or {}).get("linked_business_id"):
            return claim
        if (claim["data"] or {}).get("self_verify"):
            return await self._approve_self(claim, actor=actor, method=method, reason=reason)
        user_id = claim["kind"]
        profile = await self.store.get("profiles", claim["subject_id"])
        d = profile["data"] or {}
        target = (claim["data"] or {}).get("target")
        if d.get("linked_business_id") and not (claim["data"] or {}).get("challenge"):
            if d["linked_business_id"] == (claim["data"] or {}).get("linked_business_id"):
                return claim
            raise Conflict("already_claimed", "This profile was claimed by another business while your claim was open. You can ask for a review.")
        if target == "new":
            # The same id every time for this claim: a retry finds the business it already made.
            business_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"enterprateai:claim:{claim['id']}"))
            await self.business.create(user_id, d.get("trading_name") or d.get("name") or "My business", self._workspace_seed(d), business_id=business_id)
        else:
            business_id = target
            owned = {b["id"] for b in await self.business.owned_by(user_id)}
            if business_id not in owned:      # authority over the business is checked again at the moment of linking
                raise Conflict("not_owner", "You no longer own the business you chose. Start the claim again.")
        claim = await self._move(claim, claim.get("status"), actor=actor, method=method, reason="Business resolved", patch={"linked_business_id": business_id})

        own = await self._own_created(business_id)
        if own and own["id"] != profile["id"]:
            entry = await self._merge_created(own, profile, business_id, actor)
            d = {**d, "merged_from": [*(d.get("merged_from") or []), entry]}

        now = self.clock().isoformat()

        def link(data: dict) -> str | None:
            m = dict(data.get("marketplace") or {})
            if m.get("directory_profile_id") and m["directory_profile_id"] != profile["id"]:
                return m["directory_profile_id"]
            m["directory_profile_id"] = profile["id"]
            _keep_public_services(m, d)
            data["marketplace"] = m
            # Where the business came from, for analytics only: it never changes what the product shows.
            data.setdefault("acquisition", {"source": "marketplace_claim", "directory_profile_id": profile["id"], "claim_id": claim["id"],
                                            "opportunity_ref": (claim["data"] or {}).get("opportunity_ref"), "at": now})
            return None
        clash = await self.business.mutate(business_id, link)
        if clash:
            raise Conflict("business_already_linked", "That business already has a Marketplace profile.")
        previous = d.get("linked_business_id")
        earlier = [b for b in [*(d.get("previous_business_ids") or []), d.get("linked_business_id")] if b and b != business_id]
        d = {**d, "previous_business_ids": list(dict.fromkeys(earlier))}
        linked = await self.store.update("profiles", profile["id"], {"data": {**d, "linked_business_id": business_id, "claim_state": "verified", "claimed_at": now,
                                                                              "service_tags": d.get("service_tags") or []}, "updated_at": self.clock()},
                                         expect_revision=profile["revision"])
        if linked is None:      # the profile changed underneath: read it again and settle on whoever got there first
            fresh = await self.store.get("profiles", profile["id"])
            if (fresh["data"] or {}).get("linked_business_id") not in (None, business_id, previous):
                await self.business.mutate(business_id, lambda data: (data.get("marketplace") or {}).pop("directory_profile_id", None))
                raise Conflict("already_claimed", "This profile was claimed by another business while your claim was open.")
            await self.store.update("profiles", profile["id"], {"data": {**fresh["data"], "linked_business_id": business_id, "claim_state": "verified", "claimed_at": now}})
        if previous and previous != business_id:
            # A reviewed transfer: the earlier business keeps all its records and loses only control of this profile.
            await self._remove_control(previous, profile, "upheld_challenge")
        saved = await self._move(claim, "verified", actor=actor, method=method, reason=reason, patch={"linked_business_id": business_id, "awaiting": None, "verified_at": now})
        await self._deliver_held(profile["id"], business_id)
        await self.event("BusinessClaimVerified", profile_id=profile["id"], claim_id=claim["id"], business_id=business_id, actor=actor, payload={"method": method})
        await self.event("MarketplaceProfileLinked", profile_id=profile["id"], claim_id=claim["id"], business_id=business_id, actor=actor,
                         payload={"new_business": target == "new", "source": (claim["data"] or {}).get("acquisition_source")})
        return saved

    def _workspace_seed(self, d: dict) -> dict:
        """A new workspace for a claimed business, from what its profile already says."""
        seed = {"workspace_profile": {k: v for k, v in {"company_name": d.get("trading_name") or d.get("name"), "legal_name": d.get("name"),
                                                       "registration_number": d.get("company_number"), "website": d.get("website"), "country": d.get("country"),
                                                       "city": d.get("location"), "primary_industry": d.get("category"), "about_company": d.get("description"), "logo_data_url": d.get("logo_data_url"),
                                                       "services": [{"service_name": t["tag"], "service_category": "other", "description": t["tag"]} for t in d.get("service_tags") or []]}.items() if v not in (None, "")},
                "settings": {"currency": "GBP"}}
        seed["settings"]["currency"] = bz.country_currency(seed) or "GBP"      # a quote to a waiting buyer goes out in the business's own currency
        # Its services are in its Catalogue from the start, as after onboarding: each needs a price, and none is invented.
        from app.modules.workspace_profile.service import catalogue_with_offerings
        seed["catalogue"] = catalogue_with_offerings(None, [t["tag"] for t in d.get("service_tags") or [] if t.get("tag")], self.clock().isoformat())[0]
        return seed

    async def separate_claim(self, user: dict, claim_id: str) -> dict:
        """A business claimed into a workspace that is really another business gets its own: the owner, 5 Nov, "switch to my
        entities". Its Marketplace settings and unanswered requests move with it. The old workspace keeps every record of its
        own, and any request it already answered. Safe to run twice."""
        claim = await self._claim(claim_id, user)
        cd = claim["data"] or {}
        old = cd.get("linked_business_id")
        if claim.get("status") != "verified" or cd.get("self_verify") or cd.get("target") == "new" or not old:
            raise Conflict("not_separable", "This business already has its own workspace, or its claim isn't approved.")
        profile = await self.store.get("profiles", claim["subject_id"])
        d = profile["data"] or {}
        if d.get("linked_business_id") != old or d.get("claim_state") != "verified":
            raise Conflict("not_separable", "This profile can't be moved while it is under review.")
        business_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"enterprateai:claim:{claim['id']}"))
        had = dict((await self.business.load(old)).get("marketplace") or {})
        await self._take_back_held(profile["id"], old)
        moved = ("profile", "opportunity_preferences", "is_active", "published_at", "activated_at", "updated_at")
        seed = self._workspace_seed(d)
        seed["marketplace"] = {**{k: had[k] for k in moved if k in had}, "directory_profile_id": profile["id"]}
        _keep_public_services(seed["marketplace"], d)
        seed["acquisition"] = {"source": "marketplace_claim", "directory_profile_id": profile["id"], "claim_id": claim["id"], "at": self.clock().isoformat()}
        await self.business.create(user["id"], d.get("trading_name") or d.get("name") or "My business", seed, business_id=business_id)
        earlier = list(dict.fromkeys([*(d.get("previous_business_ids") or []), old]))
        await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {**d, "linked_business_id": business_id, "previous_business_ids": earlier}})

        def leave(data: dict) -> None:
            m = {k: v for k, v in (data.get("marketplace") or {}).items() if k not in (*moved, "directory_profile_id")}
            data["marketplace"] = m
        await self.business.mutate(old, leave)
        await self._move(claim, "verified", actor=user["id"], reason="Moved to its own workspace", patch={"target": "new", "linked_business_id": business_id, "separated_from": old})
        await self._deliver_held(profile["id"], business_id)
        await self.event("ClaimedBusinessSeparated", profile_id=profile["id"], claim_id=claim["id"], business_id=business_id, actor=user["id"], payload={"from": old})
        return {"business_id": business_id, "name": d.get("trading_name") or d.get("name")}

    async def cancel_claim(self, user: dict, claim_id: str) -> dict:
        claim = await self._claim(claim_id, user)
        if claim.get("status") not in OPEN_CLAIM_STATES:
            raise Conflict("not_open", "This claim is already closed.")
        was_dispute = claim.get("status") == "disputed"
        saved = await self._move(claim, "cancelled", actor=user["id"], reason="Cancelled by the claimant")
        if was_dispute:
            await self._settle_dispute(claim["subject_id"])
        return await self._public_claim(saved, user)

    async def _settle_dispute(self, profile_id: str) -> None:
        open_ = [c for c in await self.store.list("claims", SCOPE, subject_id=profile_id, limit=50) if c.get("status") == "disputed"]
        if not open_:
            profile = await self.store.get("profiles", profile_id)
            if (profile["data"] or {}).get("claim_state") == "disputed":
                held = profile["data"].get("state_before_dispute") if profile["data"].get("state_before_dispute") in ("created", "verified") else "verified"
                await self.store.update("profiles", profile_id, {"data": {**profile["data"], "claim_state": held if profile["data"].get("linked_business_id") else "unclaimed"}})

    # ── moderation (EnterprateAI staff; audited; never acts commercially for a business) ──

    async def _own_interest(self, admin: dict, *, claim: dict | None = None, profile_id: str | None = None) -> str | None:
        """Whether this reviewer is a party to the case, and how: "claimant" (their own claim),
        "competitor" (they have, or recently had, a claim on the same profile) or "member" (they
        belong to a business that holds, held or is claiming the profile). A party never decides."""
        mine = str(admin.get("email") or "").lower()

        def theirs(c: dict) -> bool:
            return c.get("kind") == admin["id"] or (bool(mine) and str((c["data"] or {}).get("claimant_email") or "").lower() == mine)
        if claim and theirs(claim):
            return "claimant"
        businesses: set = set()
        if claim:
            businesses |= {(claim["data"] or {}).get("target"), (claim["data"] or {}).get("linked_business_id")}
            profile_id = profile_id or claim.get("subject_id")
        if profile_id:
            profile = await self.store.get("profiles", profile_id)
            pd = (profile or {}).get("data") or {}
            businesses |= {pd.get("linked_business_id"), *(pd.get("previous_business_ids") or [])}
            recent = (self.clock() - PARTY_WINDOW).isoformat()
            for other in await self.store.list("claims", SCOPE, subject_id=profile_id, limit=200):
                od = other["data"] or {}
                businesses |= {od.get("target"), od.get("linked_business_id")}      # every business ever tied to this profile
                if theirs(other) and other.get("status") == "verified":
                    return "member"          # they hold the profile: it is their own business's case
                if theirs(other) and (other.get("status") in OPEN_CLAIM_STATES or str(other.get("updated_at") or other.get("created_at")) >= recent):
                    return "competitor"
        for bid in businesses - {None, "", "new"}:
            try:
                await self.business.actor(admin["id"], str(bid), {}, admin.get("email"))
                return "member"
            except Exception:      # noqa: BLE001 - not a member, or the business is gone
                continue
        return None

    async def _second_reviewer_required(self) -> bool:
        """A revocation is confirmed by a second reviewer wherever there is more than one."""
        return bool(_moderators() or await self.team_emails())

    async def _remove_control(self, business_id: str, profile: dict, category: str) -> None:
        """A business loses control of a directory profile. It keeps every record it has; its
        Marketplace listing is unpublished (so no second public profile appears for it) and it is
        told why the next time its owner opens the Marketplace profile page."""
        now = self.clock().isoformat()

        def apply(data: dict) -> None:
            m = dict(data.get("marketplace") or {})
            m.pop("directory_profile_id", None)
            m["is_active"] = False
            m["updated_at"] = now
            m["control_removed"] = {"at": now, "profile_id": profile["id"], "profile_name": (profile["data"] or {}).get("name"), "category": category}
            data["marketplace"] = m
        try:
            await self.business.mutate(business_id, apply)
        except bz.BusinessAccessDenied:      # the business is gone: nothing to tell
            return
        await self.event("MarketplaceProfileUnpublished", profile_id=profile["id"], business_id=business_id, actor="system", payload={"reason": "control_removed", "category": category})

    async def review_queue(self, admin: dict, status: str = "pending") -> dict:
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        claims = [c for c in await self.store.list("claims", SCOPE, limit=500)
                  if (status == "all") or (c.get("status") in ("verification_pending", "disputed") and (c["data"] or {}).get("awaiting") == "review")]
        out = []
        for c in claims:
            profile = await self.store.get("profiles", c["subject_id"])
            own = bool(await self._own_interest(admin, claim=c))
            vs = [] if own else await self.store.list("verifications", SCOPE, subject_id=c["id"], limit=10)      # a party doesn't read the evidence either
            out.append({"needs_another_reviewer": own, "id": c["id"], "status": c.get("status"), "created_at": c.get("created_at"), "claimant_email": (c["data"] or {}).get("claimant_email"),
                        "challenge": bool((c["data"] or {}).get("challenge")), "target": (c["data"] or {}).get("target"),
                        "profile": {"id": profile["id"], "slug": profile["data"].get("slug"), "name": profile["data"].get("name"), "company_number": profile["data"].get("company_number"),
                                    "domain": profile["data"].get("domain"), "claim_state": profile["data"].get("claim_state")},
                        "evidence": [{"id": v["id"], "method": v["kind"], "status": v.get("status"), "note": (v["data"] or {}).get("note"),
                                      "files": [{"name": f["name"], "index": i} for i, f in enumerate((v["data"] or {}).get("files") or [])]} for v in vs],
                        "history": (c["data"] or {}).get("history") or []})
        reports = []
        for r in await self.store.list("reports", SCOPE, limit=200):
            if status != "all" and r.get("status") != "open":
                continue
            party = bool(await self._own_interest(admin, profile_id=r["subject_id"]))
            about = ((await self.store.get("profiles", r["subject_id"])) or {}).get("data") or {}
            reports.append({"id": r["id"], "kind": r["kind"], "status": r.get("status"), "profile_id": r["subject_id"], "message": (r["data"] or {}).get("message"), "created_at": r.get("created_at"),
                            "profile": {"name": about.get("name"), "slug": about.get("slug"), "location": about.get("location")},
                            "reporter_email": None if party else (r["data"] or {}).get("reporter_email"),      # the business a report is about doesn't learn who sent it
                            "needs_another_reviewer": party})
        # Revocations one reviewer asked for and another has to confirm.
        revocations = []
        for c in await self.store.list("claims", SCOPE, limit=500):
            asked = (c["data"] or {}).get("revoke_requested")
            if c.get("status") == "verified" and asked:
                profile = await self.store.get("profiles", c["subject_id"])
                revocations.append({"id": c["id"], "profile": {"name": profile["data"].get("name"), "slug": profile["data"].get("slug")}, "claimant_email": (c["data"] or {}).get("claimant_email"),
                                    "category": asked.get("category"), "category_label": REVOKE_CATEGORIES.get(asked.get("category")), "reason": asked.get("reason"), "requested_at": asked.get("at"),
                                    "requested_by_you": asked.get("by") == admin["id"],
                                    "needs_another_reviewer": asked.get("by") == admin["id"] or bool(await self._own_interest(admin, claim=c))})
        new_listings = []
        for p in await self.store.list("profiles", SCOPE, limit=5000):
            pd = p["data"] or {}
            review = pd.get("review") or {}
            if pd.get("origin") == "created" and review.get("status") == "pending":
                due = (datetime.fromisoformat(str(review.get("requested_at"))) + REVIEW_SLA) if review.get("requested_at") else None
                new_listings.append({"id": p["id"], "slug": pd.get("slug"), "name": pd.get("name"), "category": pd.get("category"), "location": pd.get("location"),
                                     "description": (pd.get("description") or "")[:240], "website": pd.get("website"), "mode": review.get("mode"), "live": pd.get("publication") == "published",
                                     "requested_at": review.get("requested_at"), "due_at": due.isoformat() if due else None, "overdue": bool(due and self.clock() > due),
                                     "needs_another_reviewer": bool(await self._own_interest(admin, profile_id=p["id"]))})
        new_listings.sort(key=lambda x: str(x["requested_at"]))
        return {"claims": out, "reports": reports, "revocations": revocations, "new_listings": new_listings, "self_created_review": self._review_mode(),
                "revoke_categories": [{"key": k, "label": v} for k, v in REVOKE_CATEGORIES.items()], "second_reviewer_required": await self._second_reviewer_required()}

    async def evidence_file(self, admin: dict, verification_id: str, index: int) -> dict:
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        v = await self.store.get("verifications", verification_id)
        files = ((v or {}).get("data") or {}).get("files") or []
        if not v or index < 0 or index >= len(files):
            raise NotFound()
        claim = await self.store.get("claims", v["subject_id"]) if v.get("subject_id") else None
        party = await self._own_interest(admin, claim=claim) if claim else None
        if party:
            raise Forbidden(PARTY_MESSAGE[party])
        content = await self.store.get_file(files[index]["path"])
        if content is None:
            raise NotFound()
        return {"name": files[index]["name"], "content_type": files[index]["content_type"], "content": content}

    async def review_decision(self, admin: dict, claim_id: str, *, decision: str, reason: str, reason_category: str | None = None) -> dict:
        """approve | reject | revoke | keep. A person decides; the reason is kept. An LLM never does.
        Nobody decides a case they are a party to. Revoking a verified claim names a reason category
        and, where there is more than one reviewer, is confirmed by a second."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        claim = await self.store.get("claims", claim_id)
        if not claim:
            raise NotFound()
        party = await self._own_interest(admin, claim=claim)
        if party:
            raise Forbidden(PARTY_MESSAGE[party])
        if len(_text(reason)) < 5:
            raise Invalid({"reason": "Give the reason for this decision. It is kept with the claim."})
        actor = f"moderator:{admin['id']}"
        extra: dict = {}
        if decision == "approve":
            if claim.get("status") not in ("verification_pending", "disputed"):
                raise Conflict("not_reviewable", "This claim isn't waiting for a decision.")
            saved = await self._approve(claim, actor=actor, method="manual_review", reason=_text(reason))
            # Any other open challenge on the same profile ends here.
            for other in await self.store.list("claims", SCOPE, subject_id=claim["subject_id"], limit=50):
                if other["id"] != claim["id"] and other.get("status") == "disputed":
                    moved = await self._move(other, "rejected", actor=actor, method="manual_review", reason="Another claim was upheld", public_reason="The review found in favour of another claimant.")
                    await self._tell_claimant(moved, admin)
        elif decision == "reject":
            if claim.get("status") not in ("verification_pending", "disputed", "claim_started"):
                raise Conflict("not_reviewable", "This claim isn't waiting for a decision.")
            saved = await self._move(claim, "rejected", actor=actor, method="manual_review", reason=_text(reason),
                                     public_reason="We couldn't confirm that you manage this business from what was provided. You can start again with different evidence.")
            await self._settle_dispute(claim["subject_id"])
        elif decision == "revoke":
            if claim.get("status") != "verified":
                raise Conflict("not_verified", "Only a verified claim can be revoked.")
            asked = (claim["data"] or {}).get("revoke_requested")
            category = reason_category or (asked or {}).get("category")
            if category not in REVOKE_CATEGORIES:
                raise Invalid({"reason_category": "Choose why control is being removed: " + ", ".join(REVOKE_CATEGORIES) + "."})
            if await self._second_reviewer_required():
                if not asked:
                    # First reviewer: the request is recorded and nothing changes until someone else confirms it.
                    saved = await self.store.update("claims", claim["id"], {"updated_at": self.clock(), "data": {**claim["data"], "revoke_requested": {
                        "by": admin["id"], "category": category, "reason": _text(reason), "at": self.clock().isoformat()}}}, bump=False) or claim
                    await self.event("claim_revocation_requested", profile_id=claim["subject_id"], claim_id=claim["id"], actor=actor, payload={"category": category})
                    return {"id": claim["id"], "status": "verified", "revocation": "awaiting_second_reviewer"}
                if asked.get("by") == admin["id"]:
                    raise Forbidden("A second reviewer has to confirm this revocation. You asked for it, so someone else needs to confirm.")
            profile = await self.store.get("profiles", claim["subject_id"])
            business_id = (claim["data"] or {}).get("linked_business_id")
            pd = profile["data"] or {}
            if pd.get("linked_business_id") == business_id:
                # Trust is reassessed: the sourced profile goes back to unclaimed. A challenge still open on it stays in the queue.
                earlier = list(dict.fromkeys([*(pd.get("previous_business_ids") or []), business_id]))
                await self.store.update("profiles", profile["id"], {"updated_at": self.clock(), "data": {
                    **pd, "linked_business_id": None, "claim_state": "unclaimed", "state_before_dispute": None, "previous_business_ids": [b for b in earlier if b]}})
                if business_id:
                    # The business and its history stay. Its listing is unpublished and no replacement profile is made for it.
                    await self._remove_control(business_id, profile, category)
                    await self._take_back_held(profile["id"], business_id)
            # A workspace this claim created goes with it. One they already had is theirs, and stays.
            closed = await self._close_workspace(business_id) if business_id and pd.get("linked_business_id") == business_id and (claim["data"] or {}).get("target") == "new" else None
            saved = await self._move(claim, "revoked", actor=actor, method="manual_review", reason=_text(reason), public_reason="Control of this profile was removed after a review.",
                                     patch={"revoke_requested": None, "workspace_hold": closed, "revoked": {"category": category, "requested_by": (asked or {}).get("by") or admin["id"], "confirmed_by": admin["id"],
                                                                                   "at": self.clock().isoformat()}})
            extra = {"revocation": "done"}
        elif decision == "keep":
            if claim.get("status") != "verified" or not (claim["data"] or {}).get("revoke_requested"):
                raise Conflict("nothing_to_keep", "No revocation is waiting on this claim.")
            saved = await self.store.update("claims", claim["id"], {"updated_at": self.clock(), "data": {**claim["data"], "revoke_requested": None}}, bump=False) or claim
            extra = {"revocation": "withdrawn"}
        else:
            raise Invalid({"decision": "Choose approve, reject, revoke or keep."})
        await self.event("claim_review_decision", profile_id=claim["subject_id"], claim_id=claim["id"], actor=actor,
                         payload={"decision": decision, **({"category": reason_category} if decision == "revoke" else {})})
        if decision in ("approve", "reject", "revoke"):
            saved = await self._tell_claimant(saved, admin)
        return {"id": saved["id"], "status": saved.get("status"), **extra}

    async def _close_workspace(self, business_id: str) -> dict:
        now = self.clock()
        try:
            return {**await self.business.close(business_id), "state": "closed", "business_id": business_id, "at": now.isoformat(), "until": (now + WORKSPACE_KEPT).isoformat()}
        except Exception:      # noqa: BLE001 - the revocation stands; the team sees that this part didn't happen
            logger.warning("The workspace of a revoked claim could not be closed", exc_info=True)
            return {"state": "failed", "business_id": business_id, "at": now.isoformat()}

    async def release_workspace(self, business_id: str, *, actor: str) -> None:
        """The owner is deleting this workspace. Its Marketplace profile must not stay held by a business that no longer
        exists: a sourced profile goes back to unclaimed with its unanswered requests, a self-made one comes down."""
        try:
            data = await self.business.load(business_id)
            pid = (data.get("marketplace") or {}).get("directory_profile_id")
            profile = (await self.store.get("profiles", pid) if pid else None) or await self._own_created(business_id, data)
            if not profile or (profile["data"] or {}).get("linked_business_id") != business_id:
                return
            await self._take_back_held(profile["id"], business_id)
            d, now = profile["data"] or {}, self.clock()
            if d.get("origin") == "created":
                await self.store.update("profiles", profile["id"], {"status": "suppressed", "updated_at": now, "data": {**d, "publication": "suppressed", "linked_business_id": None,
                                        "suppressed": {"by": actor, "reason": "The owner deleted the workspace.", "at": now.isoformat(), "was": d.get("publication")}}})
            else:
                earlier = list(dict.fromkeys([*(d.get("previous_business_ids") or []), business_id]))
                await self.store.update("profiles", profile["id"], {"updated_at": now, "data": {**d, "linked_business_id": None, "claim_state": "unclaimed", "state_before_dispute": None, "previous_business_ids": earlier}})
            for claim in await self.store.list("claims", SCOPE, subject_id=profile["id"], limit=50):
                if claim.get("status") == "verified" and (claim["data"] or {}).get("linked_business_id") == business_id:
                    await self._move(claim, "cancelled", actor=actor, reason="The owner deleted the workspace")
            await self.event("MarketplaceProfileReleased", profile_id=profile["id"], business_id=business_id, actor=actor, payload={"reason": "workspace_deleted"})
        except NotSetUp:      # no directory on this server: nothing to release
            return

    async def restore_workspace(self, admin: dict, claim_id: str) -> dict:
        """Undo the closing of a workspace within the 30 days. The claim stays revoked and the profile stays unclaimed."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        claim = await self.store.get("claims", claim_id)
        if not claim:
            raise NotFound()
        party = await self._own_interest(admin, claim=claim)
        if party:
            raise Forbidden(PARTY_MESSAGE[party])
        cd = claim["data"] or {}
        hold = cd.get("workspace_hold") or {}
        if hold.get("state") != "closed":
            raise Conflict("not_closed", "This workspace isn't waiting to be restored.")
        await self.business.reopen(hold["business_id"], hold)
        await self.store.update("claims", claim["id"], {"updated_at": self.clock(), "data": {**cd, "workspace_hold": {**hold, "state": "restored", "members": [], "restored_at": self.clock().isoformat()}}}, bump=False)
        await self.event("ClaimWorkspaceRestored", profile_id=claim["subject_id"], claim_id=claim["id"], business_id=hold["business_id"], actor=f"moderator:{admin['id']}")
        return {"id": claim["id"], "workspace": "restored"}

    async def sweep_closed_workspaces(self) -> int:
        """Delete workspaces closed by a revocation once their 30 days are up, and only those."""
        done = 0
        now = self.clock().isoformat()
        for claim in await self.store.list("claims", SCOPE, limit=5000):
            cd = claim["data"] or {}
            hold = cd.get("workspace_hold") or {}
            if claim.get("status") != "revoked" or hold.get("state") != "closed" or str(hold.get("until") or "9") > now:
                continue
            await self.business.purge(hold["business_id"])
            await self.store.update("claims", claim["id"], {"updated_at": self.clock(), "data": {**cd, "workspace_hold": {**hold, "state": "deleted", "members": [], "deleted_at": now}}}, bump=False)
            await self.event("ClaimWorkspaceDeleted", profile_id=claim["subject_id"], claim_id=claim["id"], business_id=hold["business_id"], actor="system")
            done += 1
        return done

    async def _tell(self, message: dict) -> bool:
        """Email the outcome of a decision. It never undoes the decision: a failure is kept, so the team can see it."""
        if not message.get("to"):
            return False
        if not self._send_decision:
            self.sent_decisions.append(message)
            return True
        try:
            return await self._send_decision(message) is not False
        except Exception:      # noqa: BLE001
            logger.warning("The email about a Marketplace decision could not be sent", exc_info=True)
            return False

    async def _tell_claimant(self, claim: dict, admin: dict) -> dict:
        """The person who was waiting hears the outcome, with only what they are allowed to know: never the reviewer's own notes."""
        cd = claim["data"] or {}
        profile = await self.store.get("profiles", claim["subject_id"])
        d = (profile or {}).get("data") or {}
        status = claim.get("status")
        to = _addresses(cd.get("claimant_email"), cd.get("verified_email"))
        closed = (cd.get("workspace_hold") or {}).get("state") == "closed"
        other_workspace = False
        if closed:
            try:
                other_workspace = bool(await self.business.owned_by(claim["kind"]))
            except Exception:      # noqa: BLE001 - the email still goes; it then suggests creating one
                logger.warning("Could not read the other workspaces of a revoked claimant", exc_info=True)
        went = await self._tell({"to": to, "kind": {"verified": "verification_approved" if cd.get("self_verify") else "claim_approved", "rejected": "claim_rejected", "revoked": "claim_revoked"}[status],
                                 "business_name": d.get("name") or "your business", "link": f"/marketplace/claim/{d.get('slug')}", "reason": cd.get("public_reason"),
                                 "workspace_closed": closed, "other_workspace": other_workspace,
                                 "requests": await self._delivered_count(claim["subject_id"], cd.get("linked_business_id")) if status == "verified" else 0,
                                 "key": f"marketplace-claim-{claim['id']}-{status}"})
        await self.event("marketplace_decision_email", profile_id=claim["subject_id"], claim_id=claim["id"], actor=f"moderator:{admin['id']}", payload={"status": status, "sent": went})
        return await self.store.update("claims", claim["id"], {"data": {**cd, "decided_by_email": admin.get("email"), "decision_email": {"sent": went, "to": to, "at": self.clock().isoformat()}}}, bump=False) or claim

    async def decisions(self, admin: dict) -> dict:
        """What has been decided, newest first: who decided, when and why, and whether the person was told."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profiles = {p["id"]: p for p in await self.store.list("profiles", SCOPE, limit=5000)}
        items = []
        for c in await self.store.list("claims", SCOPE, limit=500):
            if c.get("status") not in ("verified", "rejected", "revoked") or c["subject_id"] not in profiles:
                continue
            cd, pd = c["data"] or {}, profiles[c["subject_id"]]["data"] or {}
            last = next((h for h in reversed(cd.get("history") or []) if h.get("status") == c.get("status")), {})
            by_team = last.get("method") == "manual_review"
            email = cd.get("decision_email")
            # A claim that stands can be taken back from here. A self-made profile's verification has nothing to go back to.
            revocable = c["status"] == "verified" and not cd.get("self_verify")
            asked = cd.get("revoke_requested") if revocable else None
            revoke = {"revocable": revocable, "needs_another_reviewer": revocable and bool(await self._own_interest(admin, claim=c)),
                      "revocation": {"requested_by_you": asked.get("by") == admin["id"], "category_label": REVOKE_CATEGORIES.get(asked.get("category")), "reason": asked.get("reason")} if asked else None}
            hold = cd.get("workspace_hold") or {}
            revoke["workspace"] = {"state": hold.get("state"), "until": hold.get("until")} if hold else None
            items.append({**revoke, "id": c["id"], "type": "verification" if cd.get("self_verify") else "claim", "outcome": {"verified": "approved", "rejected": "rejected", "revoked": "removed"}[c["status"]],
                          "name": pd.get("name"), "slug": pd.get("slug"), "person": ", ".join((email or {}).get("to") or _addresses(cd.get("claimant_email"), cd.get("verified_email"))),
                          "links_to": None if c["status"] != "verified" else "A new business" if cd.get("target") == "new" else "An existing business",
                          "decided_by": cd.get("decided_by_email") or ("A team member" if by_team else "Email code"), "decided_at": last.get("at"), "reason": last.get("reason"),
                          "email": ("sent" if email["sent"] else "failed") if email else ("before_emails" if by_team else "not_needed")})
        for p in profiles.values():
            pd = p["data"] or {}
            review = pd.get("review") or {}
            if pd.get("origin") == "created" and review.get("status") in ("approved", "suppressed"):
                email = review.get("email")
                items.append({"id": p["id"], "type": "listing", "outcome": "approved" if review["status"] == "approved" else "rejected", "name": pd.get("name"), "slug": pd.get("slug"),
                              "person": ", ".join((email or {}).get("to") or []), "links_to": None, "decided_by": review.get("decided_by_email") or "A team member", "decided_at": review.get("decided_at"),
                              "reason": review.get("reason"), "email": ("sent" if email["sent"] else "failed") if email else "before_emails"})
        items.sort(key=lambda x: str(x["decided_at"] or ""), reverse=True)
        return {"items": items, "revoke_categories": [{"key": k, "label": v} for k, v in REVOKE_CATEGORIES.items()], "second_reviewer_required": await self._second_reviewer_required()}

    async def review_listing(self, admin: dict, ref: str, *, decision: str, reason: str = "") -> dict:
        """approve | suppress a newly published self-made profile. Suppressing needs a reason, which
        the owner is shown together with what to do about it."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        d = profile["data"] or {}
        if d.get("origin") != "created" or (d.get("review") or {}).get("status") != "pending":
            raise Conflict("not_waiting", "This listing isn't waiting for review.")
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't decide a listing for a business you belong to. Another reviewer needs to decide it.")
        actor, now = f"moderator:{admin['id']}", self.clock().isoformat()
        business_id = d.get("linked_business_id")
        if decision == "approve":
            waiting = d.get("publication") != "published"

            def go_live(data: dict) -> None:
                m = dict(data.get("marketplace") or {})
                if m.pop("pending_review", None) or waiting:
                    m["is_active"] = True
                    m.setdefault("published_at", now)
                    m.setdefault("activated_at", now)
                m.pop("listing_suppressed", None)
                data["marketplace"] = m
            if business_id:
                await self.business.mutate(business_id, go_live)
            await self.store.update("profiles", profile["id"], {"status": "published", "updated_at": self.clock(), "data": {
                **d, "publication": "published", "suppressed": None, "review": {**d["review"], "status": "approved", "decided_by": actor, "decided_at": now, "reason": _text(reason) or None}}})
        elif decision == "suppress":
            if len(_text(reason)) < 5:
                raise Invalid({"reason": "Say why. The business owner is shown this, so they know what to fix."})

            def take_down(data: dict) -> None:
                m = dict(data.get("marketplace") or {})
                m["is_active"] = False
                m.pop("pending_review", None)
                m["listing_suppressed"] = {"at": now, "reason": _text(reason)}
                data["marketplace"] = m
            if business_id:
                await self.business.mutate(business_id, take_down)
            await self.store.update("profiles", profile["id"], {"status": "suppressed", "updated_at": self.clock(), "data": {
                **d, "publication": "suppressed", "suppressed": {"by": actor, "reason": _text(reason), "at": now, "was": "unpublished"},
                "review": {**d["review"], "status": "suppressed", "decided_by": actor, "decided_at": now, "reason": _text(reason)}}})
        else:
            raise Invalid({"decision": "Choose approve or suppress."})
        await self.event("MarketplaceListingReviewed", profile_id=profile["id"], business_id=business_id, actor=actor, payload={"decision": decision, "mode": (d.get("review") or {}).get("mode")})
        to: list[str] = []
        if business_id:
            try:
                record = await self.business.record(business_id)      # their account, and the business email filled in on their profile
                to = _addresses(await self._email_of(record["owner_id"]) if self._email_of else record["owner_id"], (record["data"].get("workspace_profile") or {}).get("email"))
            except Exception:      # noqa: BLE001 - the decision stands; the team sees the email didn't go
                logger.warning("Could not find who to tell about a listing decision", exc_info=True)
        went = await self._tell({"to": to, "kind": "listing_approved" if decision == "approve" else "listing_suppressed", "business_name": d.get("name") or "your business",
                                 "link": f"/marketplace/profile?business={business_id}", "reason": _text(reason) if decision == "suppress" else None, "requests": 0,
                                 "key": f"marketplace-listing-{profile['id']}-{decision}-{now}"})
        fresh = await self.store.get("profiles", profile["id"])
        await self.store.update("profiles", profile["id"], {"data": {**fresh["data"], "review": {**fresh["data"]["review"], "decided_by_email": admin.get("email"), "email": {"sent": went, "to": to, "at": now}}}}, bump=False)
        return {"id": profile["id"], "slug": d.get("slug"), "decision": decision}

    async def resolve_report(self, admin: dict, report_id: str, *, action: str, reason: str) -> dict:
        """dismiss | suppress (unlist: gone from search, profile pages and outreach)."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        report = await self.store.get("reports", report_id)
        if not report:
            raise NotFound()
        if await self._own_interest(admin, profile_id=report["subject_id"]):
            raise Forbidden("You can't decide a report about a profile your own business manages. Another reviewer needs to decide it.")
        if action not in ("dismiss", "suppress") or len(_text(reason)) < 5:
            raise Invalid({"action": "Choose dismiss or suppress, and give a reason."})
        if action == "suppress":
            await self.suppress(report["subject_id"], actor=f"moderator:{admin['id']}", reason=_text(reason))
        await self.store.update("reports", report["id"], {"status": "resolved", "data": {**report["data"], "action": action, "reason": _text(reason),
                                                                                         "resolved_by": admin["id"], "resolved_at": self.clock().isoformat()}})
        return {"id": report["id"], "status": "resolved", "action": action}

    async def suppress(self, profile_id: str, *, actor: str, reason: str) -> None:
        profile = await self.store.get("profiles", profile_id)
        if not profile:
            raise NotFound()
        await self.store.update("profiles", profile["id"], {"status": "suppressed", "updated_at": self.clock(),
                                                            "data": {**profile["data"], "publication": "suppressed",
                                                                     "suppressed": {"by": actor, "reason": reason, "at": self.clock().isoformat(), "was": profile["data"].get("publication")}}})
        await self.event("DirectoryProfileSuppressed", profile_id=profile["id"], actor=actor, payload={"reason": "moderation"})

    # ── one public profile per business (W12) ─────────────────────────────────

    async def _own_created(self, business_id: str, data: dict | None = None) -> dict | None:
        """The "Created on EnterprateAI" profile this business made for itself, if it has one."""
        if data is None:
            try:
                data = await self.business.load(business_id)
            except Exception:      # noqa: BLE001
                return None
        pid = (data.get("marketplace") or {}).get("directory_profile_id")
        profile = await self.store.get("profiles", pid) if pid else None
        d = (profile or {}).get("data") or {}
        return profile if profile and d.get("linked_business_id") == business_id and d.get("claim_state") == "created" else None

    async def _merge_created(self, own: dict, into: dict, business_id: str, actor: str) -> dict:
        """The business verified a claim on its sourced profile: its self-made one is retired and
        its public address keeps working, pointing at the claimed profile."""
        now = self.clock()
        old_slug = (own["data"] or {}).get("slug")
        await self.store.update("profiles", own["id"], {"key": f"merged:{own['id']}", "status": "merged", "updated_at": now,
                                                        "data": {**own["data"], "publication": "merged", "linked_business_id": None, "merged_into": into["id"]}})
        for row in await self.store.list("identities", SCOPE, subject_id=own["id"], limit=20):
            await self.store.update("identities", row["id"], {"data": {**(row["data"] or {}), "profile_id": into["id"]}}, bump=False)
        if old_slug:
            try:
                await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "identity", "subject_id": into["id"], "status": "active", "revision": 1,
                                                       "key": f"slug:{old_slug}", "data": {"profile_id": into["id"]}, "created_by": actor, "created_at": now, "updated_at": now})
            except Duplicate:
                pass
        await self.business.mutate(business_id, lambda data: (data.get("marketplace") or {}).pop("directory_profile_id", None))
        await self.event("DirectoryProfileMerged", profile_id=into["id"], business_id=business_id, actor=actor, payload={"from": own["id"]})
        # Both histories are kept: the caller records this entry on the profile that remains.
        return {"profile_id": own["id"], "slug": old_slug, "origin": "created", "created_on_platform_at": (own["data"] or {}).get("created_on_platform_at"),
                "review": (own["data"] or {}).get("review"), "merged_at": now.isoformat(), "merged_by": actor}

    async def _sync(self, business_id: str, actor: str, **known) -> dict | None:
        """sync_listing for the saving and publishing paths: a server whose directory tables aren't
        there yet still saves and publishes, as it did before the directory existed."""
        try:
            return await self.sync_listing(business_id, actor=actor, **known)
        except NotSetUp:
            logger.warning("marketplace directory is not set up: %s was not added to it", business_id)
            return None

    @staticmethod
    def _review_mode() -> str:
        try:
            from app.core.config import get_settings
            value = str(get_settings().marketplace_self_created_review or "").strip().lower()
        except Exception:      # noqa: BLE001
            value = ""
        return value if value in REVIEW_MODES else "post_publish"

    async def sync_listing(self, business_id: str, *, actor: str = "system", data: dict | None = None, profile: Any = ..., ensure: bool = False, hold: bool = False) -> dict | None:
        """Keep the business's one public profile in step with its listing. Publishing a business
        that has no directory profile creates one ("Created on EnterprateAI") with a stable
        address; unpublishing takes it out of the directory. A profile that was sourced and
        claimed keeps the address and publication state it already had."""
        if data is None:
            data = (await self.business.record(business_id))["data"] or {}
        m = data.get("marketplace") or {}
        active = bool(m.get("is_active"))
        s = marketplace_settings(data)["profile"]
        wp = data.get("workspace_profile") or {}
        pid = m.get("directory_profile_id")
        if profile is ...:      # the caller hasn't looked it up already
            profile = await self.store.get("profiles", pid) if pid else None
        if profile and (profile["data"] or {}).get("linked_business_id") != business_id:
            profile = None
        if profile is None:      # the pointer was lost: find the profile this business made before
            own = await self.store.find_key("identities", SCOPE, None, f"business:{business_id}")
            profile = await self.store.get("profiles", own["data"]["profile_id"]) if own else None
            if profile and (profile["data"] or {}).get("linked_business_id") != business_id:
                profile = None
        now = self.clock()
        fields = {"name": s["name"] or "Business", "category": wp.get("primary_industry") or None, "country": wp.get("country") or None,
                  "location": s["service_area"] or None, "website": s["website"] or None, "description": s["description"] or None, "domain": domain_of(s["website"])}
        mode = self._review_mode()
        pending = {"status": "pending", "mode": "pre_publish" if hold else mode, "requested_at": now.isoformat()}
        if profile is None:
            if not active and not ensure and not hold:
                return None
            if not real_name(s["name"]):
                return None      # no name yet: nothing to list, and no address to build from a placeholder
            profile_id = new_id()
            slug = slugify(f"{fields['name']} {wp.get('city') or ''}")
            if await self.store.find_key("profiles", SCOPE, None, slug) or await self.store.find_key("identities", SCOPE, None, f"slug:{slug}"):
                slug = f"{slug[:70]}-{_hash(business_id)[:6]}"
            publication = "published" if active and not hold else "unpublished"
            row = {"id": profile_id, "business_id": SCOPE, "kind": "directory_profile", "subject_id": None, "status": publication, "revision": 1, "key": slug,
                   "created_by": actor, "created_at": now, "updated_at": now,
                   "data": {**fields, "slug": slug, "service_tags": [], "provenance": {}, "origin": "created", "publication": publication, "claim_state": "created",
                            "linked_business_id": business_id, "created_on_platform_at": now.isoformat(),
                            # A newly published self-made profile is looked at by a person (unless that is switched off).
                            "review": pending if (hold or (active and mode != "off")) else None}}
            try:
                profile = await self.store.insert("profiles", row)
            except Duplicate:
                row["key"] = row["data"]["slug"] = f"{slug[:60]}-{profile_id[:8]}"
                profile = await self.store.insert("profiles", row)
            # Only its own business id identifies it. A registered number or website it typed in is not
            # proof, so those keys stay free for the sourced record and a verified claim.
            try:
                await self.store.insert("identities", {"id": new_id(), "business_id": SCOPE, "kind": "identity", "subject_id": profile_id, "status": "active", "revision": 1,
                                                       "key": f"business:{business_id}", "data": {"profile_id": profile_id}, "created_by": actor, "created_at": now, "updated_at": now})
            except Duplicate:      # left over from a profile this business no longer holds: point it at the new one
                stale = await self.store.find_key("identities", SCOPE, None, f"business:{business_id}")
                if stale:
                    await self.store.update("identities", stale["id"], {"data": {**(stale["data"] or {}), "profile_id": profile_id}}, bump=False)
            await self.event("DirectoryProfileCreated", profile_id=profile_id, business_id=business_id, actor=actor, payload={"origin": "created"})
        elif (profile["data"] or {}).get("claim_state") == "created" or ((profile["data"] or {}).get("origin") == "created" and (profile["data"] or {}).get("claim_state") == "verified"):
            d = profile["data"]
            unverified = d.get("claim_state") == "created"
            review = d.get("review")
            if hold:      # sent (or sent again) for review before it can be public
                publication, review = "unpublished", pending
            else:
                publication = "suppressed" if d.get("publication") == "suppressed" else "published" if active else "unpublished"
                if active and unverified and mode != "off" and not review and publication == "published":
                    review = pending
                elif not active and (review or {}).get("status") == "pending" and not m.get("pending_review"):
                    review = None      # taken down by its owner before anyone looked: nothing left to review
            if publication != d.get("publication") or review != d.get("review") or any(d.get(k) != v for k, v in fields.items()):      # write only when something changed
                profile = await self.store.update("profiles", profile["id"], {"status": publication, "updated_at": now, "data": {**d, **fields, "publication": publication, "review": review}}) or profile
        if m.get("directory_profile_id") != profile["id"]:
            def point(doc: dict) -> None:
                mk = dict(doc.get("marketplace") or {})
                mk["directory_profile_id"] = profile["id"]
                doc["marketplace"] = mk
            await self.business.mutate(business_id, point)
        return profile

    # ── a business's Marketplace profile and opportunity settings ─────────────

    async def _trust_for(self, business_id: str, data: dict) -> tuple[dict | None, bool]:
        pid = ((data.get("marketplace") or {}).get("directory_profile_id"))
        profile = await self.store.get("profiles", pid) if pid else None
        linked = bool(profile) and (profile["data"] or {}).get("linked_business_id") == business_id
        return (profile if linked else None), linked and (profile["data"] or {}).get("claim_state") == "verified"

    async def business_profile(self, user: dict, business_id: str) -> dict:
        ctx = await self._owner_ctx(user, business_id)
        settings = marketplace_settings(ctx["data"])
        profile, verified = await self._trust_for(business_id, ctx["data"])
        if profile is None and settings["is_published"]:
            # Published before the directory existed (or through the older listing switch): it gets its one public profile now.
            profile = await self._sync(business_id, user["id"], data=ctx["data"])
        return self._view(ctx, business_id, ctx["data"], profile, await self._duplicates(business_id, ctx["data"], profile))

    async def _duplicates(self, business_id: str, data: dict, profile: dict | None) -> list[dict]:
        """Unclaimed sourced profiles that are likely this same business (same registered number or
        website) and that its owner hasn't said aren't theirs. Empty once it holds a sourced profile."""
        if profile and (profile["data"] or {}).get("claim_state") != "created":
            return []
        wp = data.get("workspace_profile") or {}
        saved = (data.get("marketplace") or {}).get("profile") or {}
        answered = {a.get("profile_id") for a in (data.get("marketplace") or {}).get("not_my_profiles") or [] if isinstance(a, dict)}
        keys = identity_keys({"name": "", "website": saved.get("website") or wp.get("website"), "company_number": wp.get("registration_number"), "country": wp.get("country")})
        out, seen = [], set()
        try:
            for key in keys:
                hit = await self.store.find_key("identities", SCOPE, None, key)
                pid = hit["data"]["profile_id"] if hit else None
                if not pid or pid in seen or pid in answered:
                    continue
                seen.add(pid)
                found = await self.store.get("profiles", pid)
                fd = (found or {}).get("data") or {}
                if fd.get("claim_state") == "unclaimed" and fd.get("publication") in ("published", "noindex"):
                    out.append({**self._public(found, None), "matched_on": "registered number" if key.startswith("reg:") else "website"})
        except NotSetUp:
            return []
        return out

    async def answer_duplicate(self, user: dict, business_id: str, profile_ref: str, answer: str = "not_mine") -> dict:
        """The owner says a suggested profile isn't their business. Kept with the business, with who
        said it and when, so the question isn't asked again and the answer can be audited."""
        ctx = await self._owner_ctx(user, business_id, edit=True)
        if answer != "not_mine":
            raise Invalid({"answer": "To link the profile, claim it. The only answer recorded here is not_mine."})
        target = await self._profile(profile_ref)
        now, after = self.clock().isoformat(), {}

        def apply(data: dict) -> None:
            m = dict(data.get("marketplace") or {})
            answers = [a for a in m.get("not_my_profiles") or [] if isinstance(a, dict) and a.get("profile_id") != target["id"]]
            answers.append({"profile_id": target["id"], "answer": "not_mine", "by": user["id"], "by_email": user.get("email"), "at": now})
            m["not_my_profiles"] = answers[-50:]
            data["marketplace"] = m
            after["data"] = copy.deepcopy(data)
        await self.business.mutate(business_id, apply)
        await self.event("marketplace_duplicate_answered", profile_id=target["id"], business_id=business_id, actor=user["id"], payload={"answer": "not_mine"})
        profile, _ = await self._trust_for(business_id, after["data"])
        return self._view(ctx, business_id, after["data"], profile, await self._duplicates(business_id, after["data"], profile))

    def _view(self, ctx: dict, business_id: str, data: dict, profile: dict | None, duplicates: list[dict] | None = None) -> dict:
        """What the owner's settings page shows, from state already in hand (no further reads)."""
        settings = _with_public_services(marketplace_settings(data), profile)
        if profile:
            settings["directory_profile_id"] = profile["id"]
        verified = bool(profile) and (profile["data"] or {}).get("claim_state") == "verified"
        return {
            "business_id": business_id, **settings,
            "directory": ({"id": profile["id"], "slug": profile["data"].get("slug"), "trust": TRUST[profile["data"].get("claim_state") or "unclaimed"],
                           # "created": the business made it; "indexed": sourced, then claimed. "public": its page can be opened now.
                           "origin": "created" if profile["data"].get("claim_state") == "created" or profile["data"].get("origin") == "created" else "indexed",
                           "public": profile["data"].get("publication") in ("published", "noindex") or (
                               profile["data"].get("publication") == "unpublished" and profile["data"].get("claim_state") != "created" and profile["data"].get("origin") != "created"),
                           "legal_identifier": profile["data"].get("company_number"),
                           "sourced": {k: profile["data"].get(k) for k in ("name", "category", "location", "website", "description")},
                           "sourced_tags": [t["tag"] for t in profile["data"].get("service_tags") or []],
                           "frozen": profile["data"].get("claim_state") == "disputed"} if profile else None),
            "activation": activation_of(settings, verified_claim=verified),
            # Likely the same business, already in the directory: claim and link it, or say it isn't yours, before publishing.
            "possible_duplicates": duplicates or [],
            # Control of a claimed profile was removed after a review: the listing was unpublished and the owner is told once.
            "control_removed": (data.get("marketplace") or {}).get("control_removed"),
            # Waiting for a person before it goes public, or taken down by one (with the reason and what to do).
            "review_state": "pending_review" if (data.get("marketplace") or {}).get("pending_review") else None,
            "listing_suppressed": (data.get("marketplace") or {}).get("listing_suppressed"),
            "can_edit": bool(ctx["actor"].is_owner or ctx["actor"].can_send),
            "proposal_modes": [{"key": "general", "label": "Unsolicited"}, {"key": "solicited_general", "label": "Solicited: general"}, {"key": "solicited_specific", "label": "Solicited: specific"}],
        }

    async def _editable(self, business_id: str, data: dict) -> dict | None:
        """The business's directory profile, refusing changes while who manages it is under review."""
        profile, _ = await self._trust_for(business_id, data)
        if profile and (profile["data"] or {}).get("claim_state") == "disputed":
            raise Conflict("disputed", "Who manages this profile is under review, so changes to it are paused until that is settled.")
        return profile

    async def update_profile(self, user: dict, business_id: str, changes: dict, revision: int | None = None, claim_id: str | None = None) -> dict:
        ctx = await self._owner_ctx(user, business_id, edit=True)
        profile = await self._editable(business_id, ctx["data"])
        after: dict = {}
        errors: dict[str, str] = {}
        c = changes or {}
        unknown = sorted(k for k in c if k not in ("description", "website", "service_area", "contact_preference", "public_email", "public_phone", "service_tags", "published_offering_ids"))
        if unknown:
            errors.update({k: f"Unknown field: {k}." for k in unknown})
        if "website" in c and _text(c["website"]) and not domain_of(c["website"]):
            errors["website"] = "Enter a web address like example.co.uk."
        if "contact_preference" in c and c["contact_preference"] not in ("enquiry_form", "email", "phone", "none"):
            errors["contact_preference"] = "Choose how people should contact you."
        if "description" in c and len(_text(c["description"], 4000)) > 2000:
            errors["description"] = "Keep the description under 2,000 characters."
        # A public address or number is shown only when the owner chose that route and entered one for the public.
        current = ((ctx["data"].get("marketplace") or {}).get("profile") or {})
        route = c.get("contact_preference", current.get("contact_preference") or "enquiry_form")
        email = _text(c.get("public_email", current.get("public_email")), 200).lower()
        phone = _text(c.get("public_phone", current.get("public_phone")), 40)
        if (route == "email" or ("public_email" in c and email)) and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            errors["public_email"] = "Enter the business email address to show publicly."
        if (route == "phone" or ("public_phone" in c and phone)) and len(re.sub(r"\D", "", phone)) < 7:
            errors["public_phone"] = "Enter the business phone number to show publicly."
        if errors:
            raise Invalid(errors)
        who, now = user.get("email") or user["id"], self.clock().isoformat()

        def apply(data: dict) -> dict | None:
            m = dict(data.get("marketplace") or {})
            p = dict(m.get("profile") or {})
            if revision is not None and int(p.get("revision") or 0) != int(revision):
                return {"conflict": int(p.get("revision") or 0)}
            for key in ("description", "website", "service_area", "contact_preference", "public_email", "public_phone"):
                if key in c:
                    p[key] = _text(c[key], 2000).lower() if key == "public_email" else _text(c[key], 2000)
            if "service_tags" in c:
                p["service_tags"] = [_text(t, 60) for t in (c["service_tags"] or [])[:20] if _text(t, 60)]
            p.update({"revision": int(p.get("revision") or 0) + 1, "updated_at": now, "updated_by": who})
            m["profile"] = p
            data["marketplace"] = m
            if "published_offering_ids" in c:
                # Offerings are the business's own Catalogue records: publishing marks them, it never copies them.
                wanted = {str(x) for x in c["published_offering_ids"] or []}
                for product in (data.get("catalogue") or {}).get("products") or []:
                    if isinstance(product, dict) and product.get("id") is not None:
                        product["marketplace_listed"] = str(product["id"]) in wanted
            after["data"] = copy.deepcopy(data)
            return None
        clash = await self.business.mutate(business_id, apply)
        if clash:
            raise Conflict("stale_revision", "The profile changed while you were editing. Your changes are still on the page; check the latest and save again.", {"revision": clash["conflict"]})
        if profile and "service_tags" in c:
            # Owner-confirmed tags replace inferred ones on the public profile; where each came from is kept.
            tags = [{"tag": t, "source": "owner", "confirmed": True} for t in [_text(t, 60) for t in (c["service_tags"] or [])[:20] if _text(t, 60)]]
            profile = await self.store.update("profiles", profile["id"], {"data": {**profile["data"], "service_tags": tags,
                                                                                   "sourced_service_tags": profile["data"].get("sourced_service_tags") or profile["data"].get("service_tags")}}) or profile
        profile = await self._sync(business_id, user["id"], data=after["data"], profile=profile) or profile
        await self.event("marketplace_profile_edited", profile_id=profile["id"] if profile else None, business_id=business_id, actor=user["id"], payload={"fields": sorted(c)})
        if claim_id:
            await self._mark_claim(user, claim_id, "profile_reviewed", "profile_review_completed", business_id)
        return self._view(ctx, business_id, after["data"], profile, await self._duplicates(business_id, after["data"], profile))

    async def update_preferences(self, user: dict, business_id: str, changes: dict, claim_id: str | None = None) -> dict:
        ctx = await self._owner_ctx(user, business_id, edit=True)
        profile = await self._editable(business_id, ctx["data"])
        after: dict = {}
        c = changes or {}
        unknown = sorted(k for k in c if k not in (*OPPORTUNITY_TYPES, "notifications"))
        if unknown:
            raise Invalid({k: f"Unknown field: {k}." for k in unknown})
        modes = (c.get("proposals") or {}).get("accepted_modes")
        if modes is not None and (not isinstance(modes, list) or any(m not in ("general", "solicited_general", "solicited_specific", "specific") for m in modes)):
            raise Invalid({"proposals": "Choose from the proposal modes offered."})
        who, now = user.get("email") or user["id"], self.clock().isoformat()

        def apply(data: dict) -> None:
            from app.modules.proposals.service import apply_proposal_preferences
            m = dict(data.get("marketplace") or {})
            prefs = dict(m.get("opportunity_preferences") or {})
            for key in ("enquiries", "rfqs", "partnerships", "subcontracting"):
                if isinstance(c.get(key), dict):
                    entry = dict(prefs.get(key) or {})
                    entry["enabled"] = bool(c[key].get("enabled"))
                    if key == "rfqs":
                        entry["categories"] = [_text(x, 80) for x in (c[key].get("categories") or entry.get("categories") or [])[:20] if _text(x, 80)]
                        entry["service_areas"] = [_text(x, 80) for x in (c[key].get("service_areas") or entry.get("service_areas") or [])[:20] if _text(x, 80)]
                    if key in ("partnerships", "subcontracting"):
                        entry["notes"] = _text(c[key].get("notes", entry.get("notes")), 500)
                    prefs[key] = entry
            if isinstance(c.get("notifications"), dict):
                prefs["notifications"] = {"email": bool(c["notifications"].get("email", True))}
            prefs.update({"version": int(prefs.get("version") or 0) + 1, "updated_at": now, "updated_by": who})
            m["opportunity_preferences"] = prefs
            data["marketplace"] = m
            if isinstance(c.get("proposals"), dict):
                # Proposal settings have one writer and one status model: Proposal Intelligence's.
                apply_proposal_preferences(data, {"enabled": bool(c["proposals"].get("enabled")), **({"accepted_modes": modes} if modes else {})}, now, auto_publish=False)
            after["data"] = copy.deepcopy(data)
        await self.business.mutate(business_id, apply)
        await self.event("MarketplacePreferenceChanged", profile_id=profile["id"] if profile else None, business_id=business_id, actor=user["id"],
                         payload={"changed": sorted(c)})
        if claim_id:
            await self._mark_claim(user, claim_id, "preferences_saved", "opportunity_preferences_saved", business_id)
        return self._view(ctx, business_id, after["data"], profile, await self._duplicates(business_id, after["data"], profile))

    async def _mark_claim(self, user: dict, claim_id: str, flag: str, event: str, business_id: str) -> None:
        try:
            claim = await self._claim(claim_id, user)
        except NotFound:
            return
        if claim.get("status") == "verified" and (claim["data"] or {}).get("linked_business_id") == business_id and not (claim["data"] or {}).get(flag):
            await self.store.update("claims", claim["id"], {"data": {**claim["data"], flag: True}, "updated_at": self.clock()}, bump=False)
            await self.event(event, profile_id=claim["subject_id"], claim_id=claim["id"], business_id=business_id, actor=user["id"])

    async def suggest_services(self, user: dict, business_id: str, draft: dict, writer: Callable[[str], Any]) -> dict:
        """AI fill for "Services": a short list of what the business offers, from what it has on record, for the owner to edit. Nothing is saved."""
        ctx = await self._owner_ctx(user, business_id, edit=True)
        data = ctx["data"]
        profile = data.get("workspace_profile") or {}
        s = marketplace_settings(data)
        said = lambda v, n=300: " ".join(str(v or "").split())[:n]      # noqa: E731
        typed = said((draft or {}).get("description") or s["profile"]["description"], 600)
        facts = {
            "Business name": said(s["profile"]["name"], 160), "Industry": said(profile.get("primary_industry"), 80), "Kind of business": said(profile.get("business_type"), 80),
            "About it": said(profile.get("about_company"), 600), "Public description": typed if real_text(typed, least=10, words=2) else "",
            "Offerings": "; ".join(said(o["name"], 80) for o in s["offerings"])[:600],
        }
        if len([v for v in facts.values() if v]) < 2:
            raise Invalid({"service_tags": "There isn't enough about the business yet to suggest services. Add a description or a Catalogue item, then try again."})
        known = "\n".join(f"{k}: {v}" for k, v in facts.items() if v)
        prompt = ("List the services this business offers, for its profile on a business marketplace.\n"
                  "Use only the facts below. Three to six services, each one to three words, in title case, with no punctuation inside a service.\n\n"
                  f"{known}\n\n" 'Respond in JSON only: {"suggestion": "<services separated by commas>"}')
        raw = said(await writer(prompt), 400)
        tags, seen = [], set()
        for part in re.split(r"[,;\n]", raw):
            tag = part.strip(" .\"'-")
            if 2 <= len(tag) <= 40 and len(tag.split()) <= 4 and tag.lower() not in seen and not re.search(r"(.)\1{4,}", tag):
                seen.add(tag.lower())
                tags.append(tag)
        if not tags:
            raise Invalid({"service_tags": "Services couldn't be suggested just now. Please try again, or type them in."})
        return {"suggestion": ", ".join(tags[:6])}

    async def suggest_description(self, user: dict, business_id: str, draft: dict, writer: Callable[[str], Any]) -> dict:
        """A public description written from what the business has on record, for the owner to edit.
        `writer` turns a prompt into text (the router gives one that uses AI Credits). Nothing is saved:
        the words go into the form, and the owner decides. A reply that isn't real text is not passed on."""
        ctx = await self._owner_ctx(user, business_id, edit=True)
        data = ctx["data"]
        profile = data.get("workspace_profile") or {}
        s = marketplace_settings(data)
        said = lambda v, n=300: " ".join(str(v or "").split())[:n]      # noqa: E731
        typed = said((draft or {}).get("description"), 600)
        facts = {
            "Business name": said(s["profile"]["name"], 160),
            "Industry": said(profile.get("primary_industry"), 80),
            "Kind of business": said(profile.get("business_type"), 80),
            "About it (private notes)": said(profile.get("about_company"), 600),
            "Location or service area": said((draft or {}).get("service_area") or s["profile"]["service_area"], 120),
            "Services": ", ".join(said(t, 60) for t in ((draft or {}).get("service_tags") or s["profile"]["service_tags"])[:12]),
            "Offerings": "; ".join(f"{said(o['name'], 80)}" + (f" ({said(o['description'], 120)})" if real_text(o.get("description"), least=10, words=2) else "")
                                   for o in s["offerings"] if o["published"])[:900],
            "What the owner has typed so far": typed if real_text(typed, least=10, words=2) else "",
        }
        known = "\n".join(f"{k}: {v}" for k, v in facts.items() if v)
        if not real_name(facts["Business name"]) or len([v for v in facts.values() if v]) < 2:
            raise Invalid({"description": "There isn't enough about the business yet to write this for you. Add your services or a few words on what you do, then try again."})
        prompt = ("Write the public description for a business's profile on a business marketplace.\n"
                  "Use only the facts below. Do not invent clients, numbers, awards, years of experience or prices.\n"
                  "Two or three plain sentences, 40 to 70 words, in the first person plural (we). Say what the business does and who it is for.\n"
                  "No headings, no lists, no quotation marks, no exclamation marks, and no em or en dashes.\n\n"
                  f"{known}\n\n"
                  'Respond in JSON only: {"suggestion": "<the description>"}')
        text = said(await writer(prompt), 1200).replace("\u2014", ",").replace("\u2013", "-").strip().strip('"')
        if not real_text(text):
            raise Invalid({"description": "A description couldn't be written just now. Please try again, or write a sentence or two yourself."})
        await self.event("profile_description_suggested", business_id=business_id, actor=user["id"])
        return {"suggestion": text}

    async def suggest_index_description(self, admin: dict, record: dict, writer: Callable[[str], Any]) -> dict:
        """A description for a profile the team is adding or correcting, from what the form holds. Nothing is
        saved, and it is written about the business, not as it: the business hasn't confirmed this profile."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        record = record if isinstance(record, dict) else {}
        said = lambda v, n=300: " ".join(str(v or "").split())[:n]      # noqa: E731
        tags = record.get("service_tags")
        facts = {
            "Business name": said(record.get("trading_name") or record.get("name"), 160),
            "Category": said(record.get("category"), 80),
            "Town or region": said(record.get("location"), 120),
            "Services": ", ".join(said(t, 60) for t in tags[:12]) if isinstance(tags, list) else said(tags, 400),
            "What has been written so far": said(record.get("description"), 600),
        }
        if not real_name(facts["Business name"]) or len([v for v in facts.values() if v]) < 2:
            raise Invalid({"description": "Add the name and category first, then try again."})
        known = "\n".join(f"{k}: {v}" for k, v in facts.items() if v)
        prompt = ("Write the public description for a business's profile on a business marketplace. The business has not confirmed this profile yet.\n"
                  "Use only the facts below. Do not invent services, clients, numbers, awards, years of experience, prices or praise.\n"
                  "One or two plain sentences, 20 to 50 words, in the third person. Say what the business does and where, as far as the facts show.\n"
                  "No headings, no lists, no quotation marks, no exclamation marks, and no em or en dashes.\n\n"
                  f"{known}\n\n"
                  'Respond in JSON only: {"suggestion": "<the description>"}')
        text = said(await writer(prompt), 1200).replace("\u2014", ",").replace("\u2013", "-").strip().strip('"')
        if not real_text(text):
            raise Invalid({"description": "A description couldn't be written just now. Please try again, or write a sentence or two yourself."})
        await self.event("index_description_suggested", actor=f"moderator:{admin['id']}")
        return {"suggestion": text}

    async def suggest_index_services(self, admin: dict, record: dict, writer: Callable[[str], Any]) -> dict:
        """The services a profile lists, so people can choose one when they ask for a quote. Goes into the form; nothing is saved."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        record = record if isinstance(record, dict) else {}
        said = lambda v, n=300: " ".join(str(v or "").split())[:n]      # noqa: E731
        facts = {"Business name": said(record.get("trading_name") or record.get("name"), 160), "Category": said(record.get("category"), 80), "Description": said(record.get("description"), 600)}
        if not real_name(facts["Business name"]) or not (facts["Category"] or facts["Description"]):
            raise Invalid({"service_tags": "Add the name and category first, then try again."})
        known = "\n".join(f"{k}: {v}" for k, v in facts.items() if v)
        prompt = ("List the services this business most plausibly offers, for its profile on a business marketplace. The business has not confirmed this profile yet.\n"
                  "Use only what the facts state or clearly imply. Do not invent specialisms, prices or claims.\n"
                  "Three to six short service names of one to four words, separated by commas.\n\n"
                  f"{known}\n\n"
                  'Respond in JSON only: {"suggestion": "<the services, separated by commas>"}')
        tags, seen = [], set()
        for part in re.split(r"[,;\n]", str(await writer(prompt) or "")):
            tag = part.strip(" .\"'-")
            if 2 <= len(tag) <= 40 and len(tag.split()) <= 4 and tag.lower() not in seen:
                seen.add(tag.lower())
                tags.append(tag)
        if not tags:
            raise Invalid({"service_tags": "Services couldn't be suggested just now. Please try again, or type them in."})
        await self.event("index_services_suggested", actor=f"moderator:{admin['id']}")
        return {"suggestion": ", ".join(tags[:6])}

    async def activate(self, user: dict, business_id: str, *, publish: bool = True) -> dict:
        """Publish (or unpublish) the business's Marketplace profile once the checklist is met."""
        ctx = await self._owner_ctx(user, business_id, edit=True)
        profile = await self._editable(business_id, ctx["data"])
        verified = bool(profile) and (profile["data"] or {}).get("claim_state") == "verified"
        after: dict = {}
        settings = _with_public_services(marketplace_settings(ctx["data"]), profile)
        check = activation_of(settings, verified_claim=verified)
        if publish and not check["ready"]:
            raise Invalid({i["key"]: i.get("fix") or f"Still needed: {i['label']}." for i in check["items"] if not i["done"] and not i.get("optional")})
        # Listing never waits on a claim (the owner, 26 Oct: "users don't need to clear claiming before listing"): a possible
        # duplicate is said on the profile page, to claim or dismiss, never a reason not to publish
        if publish and not settings["is_published"] and not verified:
            same = await self._name_matches(business_id, ctx["data"], profile)
            if same:
                # A profile under another business's exact name can't go live unverified: that guards against impersonation,
                # it is not a claim (kept, 26 Oct)
                raise Conflict("verification_required", f"Another Marketplace profile already uses the name {same[0]['name']}. If it is your business, claim it. "
                               "If it isn't, verify your own business before publishing.", {"profile": same[0], "profiles": same})
        if publish and self._plan_of:
            from app.modules.plans.capabilities import PLAN_LABEL, quota
            plan = await self._plan_of(ctx["owner_id"])
            limit = quota(plan, "marketplace_listings")      # Explorer 1, Starter 10, Decision Engine no limit (the pricing PDF)
            others = [b for b in await self.business.owned_by(ctx["owner_id"]) if b["id"] != business_id and ((b["data"] or {}).get("marketplace") or {}).get("is_active")] if limit is not None else []
            if limit is not None and len(others) >= limit:
                # The claim and the profile stay; only publishing one more listing needs a plan that includes it.
                raise Conflict("entitlement", f"The {PLAN_LABEL.get(plan, 'Explorer')} plan includes {limit} Marketplace listing{'' if limit == 1 else 's'}. "
                               "Unlist another business or upgrade for more. Your profile and settings are saved.")
        now = self.clock().isoformat()
        first = {"value": False}
        pd = (profile or {}).get("data") or {}
        # Not public until a person approves: in pre-publish mode, or when sending again after being suppressed.
        hold = bool(publish) and not verified and (pd.get("review") or {}).get("status") != "approved" and (
            self._review_mode() == "pre_publish" or (pd.get("review") or {}).get("status") == "suppressed" or pd.get("publication") == "suppressed")

        def apply(data: dict) -> None:
            m = dict(data.get("marketplace") or {})
            m["is_active"] = bool(publish) and not hold
            m["updated_at"] = now
            m.pop("pending_review", None)
            if hold:
                m["pending_review"] = {"at": now}
                m.pop("listing_suppressed", None)
            elif publish:
                m.pop("listing_suppressed", None)
                m.pop("control_removed", None)
                m.setdefault("published_at", now)
                if not m.get("activated_at"):
                    m["activated_at"] = now
                    first["value"] = True
            data["marketplace"] = m
            after["data"] = copy.deepcopy(data)
        await self.business.mutate(business_id, apply)
        # One public profile: publishing creates or republishes it, unpublishing takes it out of the directory.
        profile = await self._sync(business_id, user["id"], data=after["data"], profile=profile, hold=hold) or profile
        if hold:
            await self.event("MarketplaceListingSubmitted", profile_id=profile["id"] if profile else None, business_id=business_id, actor=user["id"], payload={"mode": "pre_publish"})
        if publish and first["value"]:
            await self.event("MarketplaceProfileActivated", profile_id=profile["id"] if profile else None, business_id=business_id, actor=user["id"],
                             payload={"verified_claim": verified, "modes": check["enabled_modes"], "activated_claimed_business": check["counts_as_activated_claim"]})
        return self._view(ctx, business_id, after["data"], profile, await self._duplicates(business_id, after["data"], profile))

    async def complete_handoff(self, user: dict, claim_id: str) -> dict:
        """W10/W11: the claim journey is finished; the person goes to the ordinary dashboard."""
        claim = await self._claim(claim_id, user)
        if claim.get("status") != "verified":
            raise Conflict("not_verified", "Finish verifying your claim first.")
        business_id = (claim["data"] or {}).get("linked_business_id")
        if business_id:
            await self._deliver_held(claim["subject_id"], business_id)      # anything an earlier attempt couldn't hand over
        if not (claim["data"] or {}).get("handoff_completed"):
            await self.store.update("claims", claim["id"], {"data": {**claim["data"], "handoff_completed": True}, "updated_at": self.clock()}, bump=False)
            await self.event("dashboard_handoff_completed", profile_id=claim["subject_id"], claim_id=claim["id"], business_id=business_id, actor=user["id"])
        return {"business_id": business_id, "to": "/dashboard"}

    async def claimable(self, user: dict, *, name: str = "", website: str = "", company_number: str = "") -> list[dict]:
        """Unclaimed profiles that may be this person's business (for signup and settings):
        "We found an existing Marketplace profile that may be your business." """
        keys = identity_keys({"name": name, "website": website, "company_number": company_number, "location": ""})
        seen, out = set(), []
        for key in keys[:2]:      # registered number or domain: a name alone is too weak to suggest a match
            if key.startswith("name:"):
                continue
            hit = await self.store.find_key("identities", SCOPE, None, key)
            if hit and hit["data"]["profile_id"] not in seen:
                seen.add(hit["data"]["profile_id"])
                profile = await self.store.get("profiles", hit["data"]["profile_id"])
                d = profile["data"] or {}
                if d.get("claim_state") == "unclaimed" and d.get("publication") in ("published", "noindex"):
                    out.append({**self._public(profile, None), "matched_on": "registered number" if key.startswith("reg:") else "website"})
        return out

    # ── invitations (GTM; sending is behind its own flag) ─────────────────────

    async def _invitation(self, token: str | None) -> dict | None:
        return await self.store.find_key("invitations", SCOPE, None, _hash(token)) if token else None

    async def create_invitation(self, admin: dict, ref: str, *, reason: str = "profile_control", opportunity_ref: str | None = None, send: bool = False,
                                by_hand: bool = False) -> dict:
        """An invitation to claim. An opportunity-led one is allowed only when a real, open,
        eligible request exists: no invented urgency."""
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        profile = await self._profile(ref)
        d = profile["data"] or {}
        if d.get("claim_state") != "unclaimed" or d.get("publication") not in ("published", "noindex"):
            raise Conflict("not_invitable", "Only an unclaimed, listed profile can be invited.")
        if await self._own_interest(admin, profile_id=profile["id"]):
            raise Forbidden("You can't invite for a profile you or your business has a claim on. Another reviewer needs to do it.")
        if d.get("outreach_opt_out"):
            await self.event("ClaimInvitationSuppressed", profile_id=profile["id"], actor=admin["id"], payload={"reason": "opted_out"})
            raise Conflict("suppressed", "This business asked not to be contacted.")
        recent = [i for i in await self.store.list("invitations", SCOPE, subject_id=profile["id"], limit=200)
                  if i.get("kind") in HAND_SENT and str(i.get("created_at")) >= (self.clock() - INVITE_GAP).isoformat()]
        if recent and not (by_hand and not send):      # a link copied to share personally sends nothing, so it isn't held back
            await self.event("ClaimInvitationSuppressed", profile_id=profile["id"], actor=admin["id"], payload={"reason": "frequency"})
            raise Conflict("too_soon", "This business was invited in the last 30 days.")
        if reason == "opportunity":
            held = await self._held_requests(profile["id"])
            if held and not opportunity_ref:      # someone really has asked this business for something
                opportunity_ref = f"held:{held[0]['id']}"
            elif not held or opportunity_ref:
                found = await self._opportunity_lookup(opportunity_ref) if (self._opportunity_lookup and opportunity_ref) else None
                match = match_opportunity({**d, "service_tags": [t["tag"] for t in d.get("service_tags") or []]}, found) if found else None
                if not found or not match["eligible"]:
                    raise Invalid({"opportunity_ref": "There is no open request that this business is eligible for, so an opportunity invitation can't be sent."})
        elif reason != "profile_control":
            raise Invalid({"reason": "Choose profile_control or opportunity."})
        token = secrets.token_urlsafe(24)
        now = self.clock()
        status = "created"
        row = await self.store.insert("invitations", {"id": new_id(), "business_id": SCOPE, "kind": reason, "subject_id": profile["id"], "status": status, "revision": 1,
                                                      "key": _hash(token), "created_by": admin["id"], "created_at": now, "updated_at": now,
                                                      "data": {"reason": reason, "opportunity_ref": opportunity_ref if reason == "opportunity" else None, "channel": "email",
                                                               "has_contact": bool(d.get("contact_email"))}})
        link = f"/marketplace/claim/{d.get('slug')}?invite={token}"
        if send and self._send_invitation and d.get("contact_email"):
            went = await self._send_invitation({"to": d["contact_email"], "business_name": d.get("name"), "reason": reason, "link": link, "opt_out": f"/marketplace/invitations/{token}/opt-out"})
            if went is not False:      # the mailer says False when sending is switched off or the message was refused
                await self.store.update("invitations", row["id"], {"status": "sent", "data": {**row["data"], "sent_at": now.isoformat()}}, bump=False)
                status = "sent"
        # A link made to be shared by hand is "created"; "sent" is recorded only when an email went out.
        await self.event("ClaimInvitationSent" if status == "sent" else "ClaimInvitationCreated", profile_id=profile["id"], actor=admin["id"], payload={"reason": reason, "status": status, "invitation_id": row["id"]})
        return {"id": row["id"], "status": status, "link": link, "reason": reason}

    async def _ensure_first_claim_invite(self, profile: dict) -> bool:
        """Send the first listing email when a profile first becomes eligible; never repeat a successful send."""
        sent = await self.store.list("invitations", SCOPE, subject_id=profile["id"], limit=200)
        if any(i.get("kind") == "listed" and i.get("status") == "sent" for i in sent):
            return False
        return await self._email_claim_invite(profile, "listed")

    async def _email_claim_invite(self, profile: dict, reason: str, *, week: str | None = None) -> bool:
        """Tell a listed business about its profile, including invite-only profiles opened by this link. Only a business
        that is unclaimed, reachable and hasn't asked us to stop. Never a reason for anything else to fail."""
        d = profile["data"] or {}
        try:
            if (not self._send_invitation or not d.get("contact_email") or d.get("outreach_opt_out") or d.get("linked_business_id")
                    or d.get("claim_state") != "unclaimed" or d.get("publication") not in ("published", "noindex")):
                return False
            token = secrets.token_urlsafe(24)
            now = self.clock()
            row = await self.store.insert("invitations", {"id": new_id(), "business_id": SCOPE, "kind": reason, "subject_id": profile["id"], "status": "created", "revision": 1,
                                                          "key": _hash(token), "created_by": "system", "created_at": now, "updated_at": now,
                                                          "data": {"reason": reason, "channel": "email", "has_contact": True, "week": week}})
            went = await self._send_invitation({"to": d["contact_email"], "business_name": d.get("name"), "reason": reason, "requests": len(await self._held_requests(profile["id"])),
                                                "link": f"/marketplace/claim/{d.get('slug')}?invite={token}", "opt_out": f"/marketplace/invitations/{token}/opt-out",
                                                "key": f"claim-{reason}-{profile['id']}-{week or 'first'}"})
            if went is False:
                return False
            await self.store.update("invitations", row["id"], {"status": "sent", "data": {**row["data"], "sent_at": now.isoformat()}}, bump=False)
            await self.event("ClaimInvitationSent", profile_id=profile["id"], actor="system", payload={"reason": reason, "status": "sent", "invitation_id": row["id"]})
            return True
        except Exception:      # noqa: BLE001
            logger.warning("A claim email could not be sent", exc_info=True)
            return False

    async def send_claim_reminders(self, *, pause: float = 0.0) -> int:
        """Every Monday at 7am UK time (either side of the clocks changing), each listed business that hasn't claimed gets one reminder.
        Run often: outside that hour it does nothing, and a business already told this week is skipped, so a restart never sends twice."""
        now = self.clock()
        london = now.astimezone(ZoneInfo("Europe/London"))
        if london.weekday() != 0 or london.hour != 7 or not self._invites_enabled() or not self._reminders_enabled():
            return 0
        import asyncio
        week, done = london.strftime("%G-W%V"), 0
        for profile in await self.store.list("profiles", SCOPE, limit=5000):
            d = profile["data"] or {}
            if not d.get("contact_email") or d.get("linked_business_id"):
                continue
            sent = [i for i in await self.store.list("invitations", SCOPE, subject_id=profile["id"], limit=200) if i.get("status") == "sent" and i.get("kind") in ("listed", "weekly_reminder")]
            # A reminder is a follow-up to the original listing email, never a substitute for one.
            # A created/failed invitation doesn't count: the main email must have been accepted by the mailer.
            if not any(i.get("kind") == "listed" for i in sent):
                continue
            if any((i["data"] or {}).get("week") == week for i in sent) or any(str((i["data"] or {}).get("sent_at") or "") >= (now - REMINDER_GAP).isoformat() for i in sent):
                continue
            if await self._email_claim_invite(profile, "weekly_reminder", week=week):
                done += 1
                if pause:
                    await asyncio.sleep(pause)      # the mail provider's limit
        return done

    async def opt_out(self, token: str) -> dict:
        inv = await self._invitation(token)
        if not inv:
            raise NotFound()
        profile = await self.store.get("profiles", inv["subject_id"])
        await self.store.update("profiles", profile["id"], {"data": {**profile["data"], "outreach_opt_out": {"at": self.clock().isoformat(), "invitation_id": inv["id"]}}})
        await self.store.update("invitations", inv["id"], {"status": "opted_out", "data": {**inv["data"], "opted_out_at": self.clock().isoformat()}}, bump=False)
        await self.event("ClaimInvitationSuppressed", profile_id=profile["id"], payload={"reason": "opted_out", "invitation_id": inv["id"]})
        return {"ok": True, "message": "You won't receive further invitations about this profile. You can still claim or correct it at any time."}

    async def funnel(self, admin: dict) -> dict:
        if not await self.can_moderate(admin):
            raise Forbidden("Not available.")
        counts: dict[str, int] = {}
        for e in await self.store.list("events", SCOPE, limit=5000):
            counts[e["kind"]] = counts.get(e["kind"], 0) + 1
        profiles = await self.store.list("profiles", SCOPE, limit=5000)
        reports = await self.store.list("reports", SCOPE, limit=500)
        try:
            waiting = sum(1 for r in await self.store.list("requests", SCOPE, limit=5000) if r.get("status") == "held")
        except NotSetUp:
            waiting = 0
        return {"events": counts, "requests_waiting": waiting, "reports_open": sum(1 for r in reports if r.get("status") == "open"),
                "profiles": {"total": len(profiles), "suppressed": sum(1 for p in profiles if p["data"].get("publication") == "suppressed"),
                                               "published": sum(1 for p in profiles if p["data"].get("publication") == "published"),
                                               "claimed": sum(1 for p in profiles if p["data"].get("claim_state") == "verified")}}


# ── wiring ────────────────────────────────────────────────────────────────────

def service_for(orch) -> DirectoryService:
    """The directory service that shares the Agent runtime's business gateway and clock."""
    existing = getattr(orch, "_directory", None)
    if existing is not None:
        return existing
    from app.modules.agent.store import MemoryStore as AgentMemoryStore
    from app.modules.readiness.store import SupabaseStore
    memory = isinstance(orch.rt.store, AgentMemoryStore)
    store: Store = MemoryStore(TABLES) if memory else SupabaseStore(TABLES, bucket=FILES_BUCKET)
    svc = DirectoryService(store=store, business=orch.rt.business, clock=orch.rt.clock,
                           send_code=None if memory else _email_code, send_invitation=None if memory else _email_invitation,
                           opportunity_lookup=None if memory else _open_request, plan_of=orch.rt.meter.plan,
                           request_delivered=None if memory else _hand_delivered_request,
                           send_decision=None if memory else _email_decision, email_of=None if memory else _user_email,
                           send_team_invite=None if memory else _email_team_invite)
    orch._directory = svc
    return svc


async def _user_email(user_id: str) -> str | None:
    from app.core.supabase import sb_select
    row = await sb_select("users", filters=[("id", "eq", user_id)], columns="email", single=True)
    return (row or {}).get("email")


async def _email_team_invite(message: dict) -> bool:
    from html import escape
    from app.core.config import get_settings
    from app.shared.email.resend import email_button, send_email_via_resend
    base = str(getattr(get_settings(), "frontend_url", "") or "").split(",")[0].strip().rstrip("/")
    url = f"{base}/marketplace/team-invite?token={message['token']}"
    text = ("You've been invited to help review business profiles and claims on the EnterprateAI Marketplace. "
            "Open the secure link below to verify your email and access Marketplace Claims. The link expires in 48 hours.\n\n"
            f"Verify your email and open Marketplace Claims: {url}\n\nIf you weren't expecting this invitation, you can ignore this email.")
    html = ("<p>You've been invited to help review business profiles and claims on the EnterprateAI Marketplace.</p>"
            "<p>Open the secure link to verify your email and access Marketplace Claims. It expires in 48 hours.</p>"
            + email_button(url, "Verify email and open Claims")
            + f"<p style='font-size:12px;color:#64748b'>Sent to {escape(message['email'])}. If you weren't expecting this, ignore this email.</p>")
    result = await send_email_via_resend(kind="marketplace_team_invite", to_email=message["email"], subject="Your EnterprateAI Marketplace team invitation",
                                         text_content=text, html_content=html, idempotency_key=f"marketplace-team-invite/{message['token']}")
    return bool(getattr(result, "sent", True))


async def _email_decision(message: dict) -> bool:
    """The outcome of a person's review, to whoever was waiting for it. Not marketing, so the invitation switch doesn't apply."""
    from html import escape

    from app.core.config import get_settings
    from app.shared.email.resend import email_button, send_email_via_resend
    name, reason, count = message["business_name"], message.get("reason"), message.get("requests") or 0
    waiting = ""
    if count:
        waiting = f"{count} request{' was' if count == 1 else 's were'} sent to this business before it was claimed. You'll find {'it' if count == 1 else 'them'} with your quote requests in Business Operations."
    subject, lead, step, button = {
        "claim_approved": (f"You now manage {name} on EnterprateAI", f"We've reviewed your claim and you now manage {name} on the EnterprateAI Marketplace.",
                           "Next step: check what the public sees and choose the opportunities you want.", "Finish setting up your profile"),
        "verification_approved": (f"{name} is now verified on EnterprateAI", f"We've reviewed your details and {name} is now owner-verified on the EnterprateAI Marketplace.",
                                  "Next step: open your profile and check what the public sees.", "Open your profile"),
        "claim_rejected": (f"Your claim on {name} wasn't approved", f"We've reviewed your claim on {name} and couldn't approve it.",
                           "Next step: if you do manage this business, start again with different evidence.", "Open your claim"),
        "claim_revoked": (f"Control of {name} was removed", f"After a review, control of {name} on the EnterprateAI Marketplace was removed from your account. Your business and its records stay yours.",
                          "Next step: open the claim to see where it stands.", "Open your claim"),
        "listing_approved": (f"{name} is approved on the Marketplace", f"We've reviewed your Marketplace listing for {name} and it's approved. It's live for customers to find.",
                             "Next step: open your profile and keep it up to date.", "Open your profile"),
        "listing_suppressed": (f"{name} was taken off the Marketplace", f"We've reviewed your Marketplace listing for {name} and taken it down for now.",
                               "Next step: fix what's described above, then publish it again from your profile.", "Open your profile"),
    }[message["kind"]]
    if message["kind"] == "claim_revoked" and message.get("workspace_closed"):
        lead = (f"After a review, control of {name} on the EnterprateAI Marketplace was removed from your account, and the workspace created with that claim has been closed. "
                "If you think this is wrong, email tech.support@enterprateai.com within 30 days and we can look at it again.")
        step, button, link = (("Next step: carry on in your other workspace.", "Open my workspace", "/dashboard") if message.get("other_workspace")
                              else ("Next step: create a new workspace to keep using EnterprateAI.", "Create a new workspace", "/onboarding"))
        message = {**message, "link": link}
    url = str(getattr(get_settings(), "frontend_url", "") or "").split(",")[0].strip().rstrip("/") + message["link"]
    lines = [lead, *([f"Reason: {reason}"] if reason else []), *([waiting] if waiting else []), step]
    text = "\n\n".join([*lines, f"{button}: {url}"])
    html = "".join(f"<p>{escape(line)}</p>" for line in lines) + email_button(url, button)
    result = await send_email_via_resend(kind="claim_decision", to_email=message["to"], subject=subject, text_content=text, html_content=html, idempotency_key=message.get("key"))
    return bool(getattr(result, "sent", True))


async def _hand_delivered_request(business_id: str, request_id: str) -> None:
    """The same step as a request that arrives on a listing: the business's Agent may start on it, if it is set to."""
    from app.modules.marketplace.service import _hand_rfq_to_agent
    await _hand_rfq_to_agent(business_id, request_id)


async def _email_code(address: str, code: str, business_name: str) -> None:
    from app.shared.email.resend import send_email_via_resend
    text = (f"Your EnterprateAI verification code is {code}.\n\nEnter it to confirm that you manage {business_name} on the EnterprateAI Marketplace. "
            "It works for 30 minutes. If you didn't ask for this, you can ignore this email: nothing changes without the code.")
    html = (f"<p>Your EnterprateAI verification code is</p><p style='font-size:28px;font-weight:700;letter-spacing:4px'>{code}</p>"
            f"<p>Enter it to confirm that you manage <strong>{business_name}</strong> on the EnterprateAI Marketplace. It works for 30 minutes.</p>"
            "<p>If you didn't ask for this, you can ignore this email: nothing changes without the code.</p>")
    await send_email_via_resend(kind="claim_code", to_email=address, subject="Your EnterprateAI verification code", text_content=text, html_content=html)


async def _email_invitation(message: dict) -> bool:
    from html import escape

    from app.core.config import get_settings
    from app.shared.email.resend import email_button, send_email_via_resend
    if not get_settings().marketplace_claim_invites_enabled:
        return False
    base = str(getattr(get_settings(), "frontend_url", "") or "").split(",")[0].strip().rstrip("/")
    name, count = message["business_name"], int(message.get("requests") or 0)
    waiting = f"{count} request{' is' if count == 1 else 's are'} waiting for you. " if count else ""
    automatic = {
        "listed": (f"{name} is now listed on the EnterprateAI Marketplace", f"{name} is now listed on the EnterprateAI Marketplace, based on public information. {waiting}Claim it for free to correct the details, reply to customers and choose the work you want."),
        "weekly_reminder": (f"{name} hasn't been claimed yet", f"{name} is listed on the EnterprateAI Marketplace and hasn't been claimed yet. {waiting}Claim it for free to correct the details, reply to customers and choose the work you want."),
    }.get(message["reason"])
    lead = automatic[1] if automatic else ("A current request on the EnterprateAI Marketplace may match your services. Claim your profile to see it and respond."
                                           if message["reason"] == "opportunity" else "Your business is discoverable on EnterprateAI. Claim it to control the profile and choose the opportunities you want.")
    text = f"{lead}\n\nNext step: claim your profile: {base}{message['link']}\n\nNot interested? Stop these emails: {base}{message['opt_out']}"
    html = (f"<p>{escape(lead)}</p>" + email_button(base + message["link"], f"Claim {name}")
            + f"<p style='font-size:12px;color:#64748b;text-align:center'>Not interested? <a href='{escape(base + message['opt_out'], quote=True)}'>Stop these emails</a>.</p>")
    result = await send_email_via_resend(kind="claim_invitation", to_email=message["to"], subject=automatic[0] if automatic else f"{name} on the EnterprateAI Marketplace", text_content=text, html_content=html,
                                         idempotency_key=message.get("key"))
    return bool(getattr(result, "sent", True))


async def _open_request(reference: str) -> dict | None:
    """A published proposal request, reduced to what matching needs. None when it isn't open."""
    try:
        from app.modules.marketplace.service import get_public_proposal_request
        found = await get_public_proposal_request(request_id=reference)
    except Exception:      # noqa: BLE001 - not found, withdrawn or closed
        return None
    if not found:
        return None
    return {"id": reference, "type": "proposals", "status": found.get("status") or "open",
            "categories": [c for c in [found.get("category"), *(found.get("categories") or [])] if c], "location": found.get("location"), "remote_ok": True}
