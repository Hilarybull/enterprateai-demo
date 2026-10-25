"""Business gateway + deterministic calculations.

The gateway is the only path from the Agent runtime to authoritative business
records (s13.1). Every call is scoped to one business and checks the actor's
access first (business isolation, AC-01). Calculations here are deterministic
engine results: the LLM may explain them but never produces or overrides them (AC-07).
"""
from __future__ import annotations

import copy
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from app.modules.agent.models import Actor


class BusinessAccessDenied(Exception):
    pass


class Business:
    """Authoritative business records. Implementations must be business-scoped."""
    async def actor(self, user_id: str, business_id: str, policy: dict, email: str | None = None) -> Actor: raise NotImplementedError
    async def load(self, business_id: str) -> dict: raise NotImplementedError
    async def mutate(self, business_id: str, fn: Callable[[dict], Any]) -> Any: raise NotImplementedError
    async def owner_id(self, business_id: str) -> str: raise NotImplementedError

    async def record(self, business_id: str) -> dict:
        """Owner and data together. Implementations should do this in one read."""
        return {"owner_id": await self.owner_id(business_id), "data": await self.load(business_id)}

    async def context(self, user_id: str, business_id: str, email: str | None = None) -> tuple[Actor, dict]:
        """The caller's authority in the business together with its record."""
        return await self.actor(user_id, business_id, {}, email), await self.record(business_id)

    async def find_by_profile(self, *, company_name: str = "", registration_number: str = "") -> list[dict]:
        """Businesses whose own profile has exactly this name or registered number: [{id, name}]."""
        return []

    async def owned_by(self, user_id: str) -> list[dict]:
        """The businesses this user owns: [{"id", "name", "data"}]."""
        raise NotImplementedError

    async def create(self, user_id: str, name: str, data: dict, business_id: str | None = None) -> str:
        """Create a business owned by the user. With `business_id`, creating it twice is the
        same as creating it once (the existing one is returned untouched)."""
        raise NotImplementedError


def _member_has_operations(membership: dict) -> bool:
    perms = membership.get("permissions") or {}
    if membership.get("permission_type") == "module":
        return any(m in (perms.get("modules") or []) for m in ("operations", "financials"))
    feats = perms.get("features") or {}
    return bool(feats.get("operations") or feats.get("financials"))


def build_actor(*, user_id: str, email: str | None, business_id: str, owner_id: str, membership: dict | None, policy: dict) -> Actor:
    """Authority matrix (s24). Owners have full authority; members are scoped."""
    if user_id == owner_id:
        return Actor(user_id=user_id, email=email, business_id=business_id, is_owner=True,
                     can_prepare=True, can_send=True, can_manage_policy=True)
    if not membership:
        raise BusinessAccessDenied("No access to this business.")
    ops = _member_has_operations(membership)
    return Actor(user_id=user_id, email=email, business_id=business_id, is_owner=False,
                 can_prepare=ops, can_send=bool(ops and policy.get("member_can_approve")), can_manage_policy=False)


class MemoryBusiness(Business):
    async def find_by_profile(self, *, company_name="", registration_number=""):
        out = []
        for bid, b in self.businesses.items():
            wp = (b.get("data") or {}).get("workspace_profile") or {}
            if (registration_number and str(wp.get("registration_number") or "").strip() == str(registration_number).strip()) or (
                    company_name and str(wp.get("company_name") or "").strip().lower() == str(company_name).strip().lower()):
                out.append({"id": bid, "name": wp.get("company_name") or ""})
        return out

    """In-memory businesses for tests: {business_id: {"owner": user_id, "data": {...}, "members": {user_id: membership}}}."""

    def __init__(self, businesses: dict[str, dict]):
        self.businesses = businesses

    async def owner_id(self, business_id):
        if business_id not in self.businesses:
            raise BusinessAccessDenied("Business not found.")
        return self.businesses[business_id]["owner"]

    async def actor(self, user_id, business_id, policy, email=None):
        b = self.businesses.get(business_id)
        if not b:
            raise BusinessAccessDenied("Business not found.")
        return build_actor(user_id=user_id, email=email, business_id=business_id, owner_id=b["owner"],
                           membership=(b.get("members") or {}).get(user_id), policy=policy)

    async def load(self, business_id):
        return copy.deepcopy(self.businesses[business_id]["data"])

    async def mutate(self, business_id, fn):
        data = self.businesses[business_id]["data"]
        return fn(data)

    async def owned_by(self, user_id):
        return [{"id": bid, "name": b.get("name") or ((b["data"].get("workspace_profile") or {}).get("company_name")) or bid, "data": copy.deepcopy(b["data"])}
                for bid, b in self.businesses.items() if b["owner"] == user_id]

    async def create(self, user_id, name, data, business_id=None):
        import uuid
        bid = business_id or str(uuid.uuid4())
        if bid not in self.businesses:
            self.businesses[bid] = {"owner": user_id, "name": name, "data": copy.deepcopy(data), "members": {}}
        return bid


class SupabaseBusiness(Business):
    """Workspaces are the business record. Writes are compare-and-swap on updated_at
    so an Agent write can never overwrite a concurrent user edit."""

    async def _row(self, business_id: str) -> dict:
        from app.core.supabase import sb_select
        row = await sb_select("workspaces", filters=[("id", "eq", business_id)], columns="id,user_id,name,data,updated_at", single=True)
        if not row:
            raise BusinessAccessDenied("Business not found.")
        return row

    async def owner_id(self, business_id):
        return str((await self._row(business_id))["user_id"])

    async def actor(self, user_id, business_id, policy, email=None):
        from app.core.supabase import sb_select
        row = await self._row(business_id)
        membership = None
        if str(row["user_id"]) != user_id:
            membership = await sb_select(
                "workspace_members",
                filters=[("workspace_id", "eq", business_id), ("user_id", "eq", user_id)],
                single=True,
            )
        return build_actor(user_id=user_id, email=email, business_id=business_id, owner_id=str(row["user_id"]),
                           membership=membership, policy=policy)

    async def load(self, business_id):
        return (await self._row(business_id)).get("data") or {}

    async def context(self, user_id, business_id, email=None):
        from app.core.supabase import sb_select
        row = await self._row(business_id)      # one read serves both the authority check and the record
        membership = None
        if str(row["user_id"]) != user_id:
            membership = await sb_select("workspace_members", filters=[("workspace_id", "eq", business_id), ("user_id", "eq", user_id)], single=True)
        actor = build_actor(user_id=user_id, email=email, business_id=business_id, owner_id=str(row["user_id"]), membership=membership, policy={})
        return actor, {"owner_id": str(row["user_id"]), "data": row.get("data") or {}}

    async def record(self, business_id):
        row = await self._row(business_id)
        return {"owner_id": str(row["user_id"]), "data": row.get("data") or {}}

    async def find_by_profile(self, *, company_name="", registration_number=""):
        from app.core.supabase import sb_select
        found: dict[str, dict] = {}
        for field, value in (("registration_number", registration_number), ("company_name", company_name)):
            if not str(value or "").strip():
                continue
            rows = await sb_select("workspaces", filters=[("data", "cs", {"workspace_profile": {field: str(value).strip()}})], columns="id,name,data", limit=5) or []
            for r in rows:
                found[str(r["id"])] = {"id": str(r["id"]), "name": ((r.get("data") or {}).get("workspace_profile") or {}).get("company_name") or r.get("name") or ""}
        return list(found.values())

    async def owned_by(self, user_id):
        from app.core.supabase import sb_select
        rows = await sb_select("workspaces", filters=[("user_id", "eq", user_id)], columns="id,name,data", order="updated_at", desc=True) or []
        return [{"id": str(r["id"]), "name": r.get("name") or "", "data": r.get("data") or {}} for r in rows]

    async def create(self, user_id, name, data, business_id=None):
        import uuid
        from app.core.supabase import sb_insert, sb_select
        bid = business_id or str(uuid.uuid4())
        if business_id and await sb_select("workspaces", filters=[("id", "eq", bid)], columns="id", single=True):
            return bid
        now = datetime.now(timezone.utc).isoformat()
        try:
            await sb_insert("workspaces", {"id": bid, "user_id": user_id, "name": name, "data": data, "created_at": now, "updated_at": now})
        except Exception as e:      # noqa: BLE001 - a simultaneous retry created it first
            if "23505" not in f"{getattr(e, 'code', '')} {e}":
                raise
        from app.modules.agent.autostart import off_for_new_workspace
        await off_for_new_workspace(bid, user_id)      # no unasked credit spending in a new workspace
        return bid

    async def mutate(self, business_id, fn):
        import anyio
        from app.core.supabase import _forget_reads, _with_client

        # On a connection that is already open: building a new client for every save cost
        # more than a second each time.
        def _save(client):
            for _attempt in range(6):
                rows = client.table("workspaces").select("id,data,updated_at").eq("id", business_id).limit(1).execute().data
                if not rows:
                    raise BusinessAccessDenied("Business not found.")
                current = rows[0]
                data = copy.deepcopy(current.get("data") or {})
                before = copy.deepcopy(data.get("workspace_profile"))
                result = fn(data)
                if data.get("workspace_profile") != before:
                    # The profile is master data: a change here gets a new revision, so a page holding an older copy can
                    # never save that copy back over it (sb_update keeps the newer revision).
                    data["workspace_profile_updated_at"] = datetime.now(timezone.utc).isoformat()
                q = client.table("workspaces").update({"data": data, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", business_id)
                if current.get("updated_at"):
                    q = q.eq("updated_at", current["updated_at"])
                if q.execute().data:
                    return result
            raise RuntimeError("Business record changed repeatedly while saving; please retry.")

        try:
            return await anyio.to_thread.run_sync(lambda: _with_client(_save))
        finally:
            _forget_reads("workspaces")      # whatever was read before this save is out of date


# ── Record helpers ────────────────────────────────────────────────────────────

def fin(data: dict) -> dict:
    """The financials section, created if missing (for writes)."""
    f = data.get("financials")
    if not isinstance(f, dict):
        f = {}
        data["financials"] = f
    return f


def quotes_key(data: dict) -> str:
    f = data.get("financials") or {}
    return "quotations" if "quotes" not in f and isinstance(f.get("quotations"), list) else "quotes"


def quotes_of(data: dict) -> list[dict]:
    return (data.get("financials") or {}).get(quotes_key(data)) or []


def records(data: dict, key: str) -> list[dict]:
    """A mutable record list inside financials, created if missing (for writes)."""
    f = fin(data)
    if not isinstance(f.get(key), list):
        f[key] = []
    return f[key]


def find(records: list[dict], record_id: str) -> dict | None:
    """A record by id. Records first saved with a browser-made id keep it as `legacy_id`
    when the server gives them a real one, so older references still resolve."""
    wanted = str(record_id)
    return (next((r for r in records or [] if str(r.get("id")) == wanted), None)
            or next((r for r in records or [] if r.get("legacy_id") and str(r["legacy_id"]) == wanted), None))


def status_of(rec: dict | None) -> str:
    return str((rec or {}).get("status") or "").strip().lower()


def money(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def invoice_total(inv: dict) -> float:
    return money(inv.get("total_amount") or inv.get("amount") or inv.get("subtotal_amount"))


def invoice_received(inv: dict) -> float:
    payments = inv.get("payments") or []
    if payments:
        return money(sum(money(p.get("amount")) for p in payments))
    if status_of(inv) == "paid":
        if inv.get("payment_type") == "partial" and inv.get("paid_amount") is not None:
            return money(inv.get("paid_amount"))
        return invoice_total(inv)
    return 0.0


def invoice_credited(inv: dict) -> float:
    """What has been taken off this invoice by credit notes sent to the customer."""
    return money(sum(money(n.get("amount")) for n in inv.get("credit_notes") or [] if isinstance(n, dict)))


def invoice_outstanding(inv: dict) -> float:
    return money(max(0.0, invoice_total(inv) - invoice_received(inv) - invoice_credited(inv)))


def parse_day(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


# C5: a business with no time zone of its own keeps its country's (the main one where a country has several), never the
# zone of whoever's browser opened the settings.
COUNTRY_ZONES = {
    "united kingdom": "Europe/London", "uk": "Europe/London", "gb": "Europe/London", "great britain": "Europe/London", "england": "Europe/London",
    "scotland": "Europe/London", "wales": "Europe/London", "northern ireland": "Europe/London", "ireland": "Europe/Dublin", "ie": "Europe/Dublin",
    "nigeria": "Africa/Lagos", "ng": "Africa/Lagos", "ghana": "Africa/Accra", "gh": "Africa/Accra", "kenya": "Africa/Nairobi", "ke": "Africa/Nairobi",
    "south africa": "Africa/Johannesburg", "za": "Africa/Johannesburg", "egypt": "Africa/Cairo", "uganda": "Africa/Kampala", "rwanda": "Africa/Kigali",
    "tanzania": "Africa/Dar_es_Salaam", "united states": "America/New_York", "usa": "America/New_York", "us": "America/New_York",
    "canada": "America/Toronto", "ca": "America/Toronto", "australia": "Australia/Sydney", "au": "Australia/Sydney", "new zealand": "Pacific/Auckland",
    "india": "Asia/Kolkata", "in": "Asia/Kolkata", "pakistan": "Asia/Karachi", "united arab emirates": "Asia/Dubai", "uae": "Asia/Dubai",
    "singapore": "Asia/Singapore", "germany": "Europe/Berlin", "de": "Europe/Berlin", "france": "Europe/Paris", "fr": "Europe/Paris",
    "spain": "Europe/Madrid", "es": "Europe/Madrid", "italy": "Europe/Rome", "netherlands": "Europe/Amsterdam", "nl": "Europe/Amsterdam",
    "belgium": "Europe/Brussels", "portugal": "Europe/Lisbon", "poland": "Europe/Warsaw", "sweden": "Europe/Stockholm", "jamaica": "America/Jamaica",
}


def zone_of_country(country: str | None) -> str | None:
    key = " ".join(str(country or "").lower().replace(".", "").split())
    return COUNTRY_ZONES.get(key)


def zone_name(data: dict) -> str:
    """The business's time zone by name: its own, else its country's, else UTC."""
    profile = (data or {}).get("workspace_profile") or {}
    own = str(profile.get("timezone") or "").strip()
    return own if own and valid_timezone(own) else (zone_of_country(profile.get("country")) or "UTC")


def business_timezone(data: dict):
    """The business's own time zone (workspace_profile.timezone, an IANA name), else its country's (C5), else UTC."""
    name = zone_name(data)
    if name and name != "UTC":
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(name)
        except Exception:      # noqa: BLE001 - unknown name or no tz database: fall back to UTC
            pass
    return timezone.utc


def local_now(data: dict, now: datetime) -> datetime:
    """`now` on the business's own clock: what "today" is for its documents."""
    return (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(business_timezone(data))


def valid_timezone(name: str) -> bool:
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(str(name))
        return True
    except Exception:      # noqa: BLE001
        return False


# Invoice states in which nothing may be chased: no reminders, and any follow-up pauses.
HOLD_STATES = ("disputed", "voided", "cancelled", "credited")
_HOLD_ALIASES = {"disputed": "disputed", "void": "voided", "voided": "voided", "cancelled": "cancelled",
                 "canceled": "cancelled", "credited": "credited"}
HOLD_REASONS = tuple(f"invoice_{s}" for s in HOLD_STATES)


def invoice_hold(inv: dict | None) -> dict | None:
    """{"state", "reason", "date"} when the invoice is disputed, voided, cancelled or credited."""
    if not inv:
        return None
    state = _HOLD_ALIASES.get(status_of(inv))
    if not state and (inv.get("disputed") or inv.get("dispute_status") in ("open", "disputed")):
        state = "disputed"
    if not state:
        return None
    return {"state": state, "reason": str(inv.get("status_reason") or inv.get("dispute_reason") or "").strip(),
            "date": str(inv.get("status_changed_at") or "")[:10] or None}


def hold_message(hold: dict) -> str:
    return f"Invoice {hold['state']}: {hold['reason']}" if hold.get("reason") else f"Invoice {hold['state']}."


def _moment(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        day = parse_day(value)
        if not day:
            return None
        dt = datetime(day.year, day.month, day.day)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def reminder_gap_days(policy: dict, sent: int) -> int:
    """Days that must pass after reminder number `sent` before the next one: the gap between
    those two cadence stages, and never less than the minimum interval."""
    r = (policy or {}).get("reminders") or {}
    cadence = list(r.get("cadence_days_overdue") or [3, 10, 21])
    floor = r.get("min_interval_days")
    floor = 7 if floor is None else int(floor)
    gap = int(cadence[sent]) - int(cadence[sent - 1]) if 0 < sent < len(cadence) else 0
    return max(floor, gap)


def reminder_not_before(inv: dict, policy: dict) -> datetime | None:
    """The earliest moment the next reminder for this invoice may be prepared, or None if
    none has been sent. Uses the time stored on the invoice at the last send."""
    stored = _moment(inv.get("next_reminder_not_before"))
    sent = [m for m in (_moment(r.get("sent_at")) for r in inv.get("reminders") or []) if m]
    if not sent:
        return stored
    computed = max(sent) + timedelta(days=reminder_gap_days(policy, len(sent)))
    return max(stored, computed) if stored else computed


def followup_skip_reason(inv: dict | None, policy: dict, now: datetime) -> str | None:
    """Why no reminder would go for this invoice right now, or None if one may."""
    reason = reminder_block_reason(inv, now.date())
    if reason:
        return reason
    not_before = reminder_not_before(inv, policy)
    return "reminder_too_soon" if not_before and now < not_before else None


def eligible_for_reminder(data: dict, policy: dict, now: datetime) -> list[dict]:
    invs = (data.get("financials") or {}).get("invoices") or []
    return [i for i in invs if followup_skip_reason(i, policy, now) is None]


def skip_text(reason: str, reference: str | None = None, *, last: Any = None, not_before: Any = None) -> str:
    """One plain sentence for a follow-up that correctly sent nothing."""
    ref = f"invoice {reference}" if reference else "the invoice"
    day = lambda v: (_moment(v).strftime("%d %b %Y").lstrip("0") if _moment(v) else "")      # noqa: E731
    why = {
        "invoice_paid": f"{ref} is already paid",
        "invoice_not_overdue": f"{ref} isn't overdue yet",
        "invoice_no_due_date": f"{ref} has no due date",
        "invoice_draft": f"{ref} hasn't been sent to the customer yet",
        "invoice_archived": f"{ref} is archived",
        "reminder_too_soon": (f"the last reminder for {ref} went on {day(last)}" if day(last) else f"a reminder for {ref} went recently")
                             + (f", and the next can't go before {day(not_before)}" if day(not_before) else ""),
    }.get(reason) or f"{ref} is {reason.replace('invoice_', '').replace('_', ' ')}"
    return f"No reminder sent: {why}."


def reminder_block_reason(inv: dict | None, today: date) -> str | None:
    """Why a payment reminder must NOT be sent for this invoice, or None if eligible (s16.6, AC-23)."""
    if not inv:
        return "invoice_not_found"
    if inv.get("archived"):
        return "invoice_archived"
    hold = invoice_hold(inv)
    if hold:
        return f"invoice_{hold['state']}"
    st = status_of(inv)
    if st in ("written_off", "draft", "refunded", "reversed", "chargeback"):
        return f"invoice_{st}"
    if invoice_outstanding(inv) <= 0:
        return "invoice_paid"
    due = parse_day(inv.get("due_date"))
    if not due:
        return "invoice_no_due_date"
    if due >= today:
        return "invoice_not_overdue"
    return None


def overdue_invoices(data: dict, today: date) -> list[dict]:
    invs = (data.get("financials") or {}).get("invoices") or []
    return [i for i in invs if reminder_block_reason(i, today) is None]


def currency_of(data: dict) -> str:
    """The workspace currency: the saved one; with none saved, its country's ("Nigeria": NGN, the owner's QA, 16 Oct),
    never GBP for a business that says it is elsewhere; GBP only when nothing is known."""
    import re
    saved = str((data.get("settings") or {}).get("currency") or "")
    m = re.search(r"\(([A-Z]{3})\)", saved) or re.match(r"^([A-Z]{3})$", saved.strip().upper())
    if m:
        return m.group(1)
    return country_currency(data) or "GBP"


def known_currency(data: dict) -> str | None:
    """The workspace currency when one is known (saved, or its country's); None when only the GBP fallback would say."""
    import re
    saved = str(((data or {}).get("settings") or {}).get("currency") or "")
    m = re.search(r"\(([A-Z]{3})\)", saved) or re.match(r"^([A-Z]{3})$", saved.strip().upper())
    return m.group(1) if m else country_currency(data)


def country_currency(data: dict) -> str | None:
    """The currency of the country on the workspace profile, or None."""
    country = ((data or {}).get("workspace_profile") or {}).get("country")
    if not country:
        return None
    try:
        from app.modules.agent.credibility import currency_of_country
        return currency_of_country(country)
    except Exception:      # noqa: BLE001
        return None


def save_country_currency(data: dict) -> str | None:
    """With no currency saved and a country on the profile: that country's currency, saved (documents already made keep
    the one they were made in). Returns the code saved, or None."""
    if str((data.get("settings") or {}).get("currency") or "").strip():
        return None
    code = country_currency(data)
    if not code:
        return None
    stamp_document_currencies(data, "GBP")      # made before any currency was saved: GBP, the default they showed in
    data.setdefault("settings", {})["currency"] = code
    return code


DOCUMENT_LISTS = ("invoices", "quotes", "quotations", "receipts", "contracts", "credit_notes", "purchase_orders", "proposals")


def doc_currency(doc: dict | None, default: str | None = None) -> str:
    """A document's own currency, kept for ever (the owner's QA, 16 Oct): what it was created in, never the workspace's
    current one. Only a document that never had one falls back to the default."""
    import re
    cur = str((doc or {}).get("currency") or "").strip().upper()
    m = re.match(r"^([A-Z]{3})$", cur) or re.search(r"\(([A-Z]{3})\)", cur)
    return m.group(1) if m else (default or "GBP")


def fx_rate(data: dict, code: str) -> float | None:
    """The stored rate from one currency to the workspace's (data["fx_rates"], refreshed daily by fx.ensure); 1 for the same
    currency; None when no rate is stored yet."""
    base = currency_of(data)
    if not code or code == base:
        return 1.0
    snap = data.get("fx_rates") or {}
    if snap.get("base") != base:
        return None
    r = (snap.get("rates") or {}).get(code)
    return float(r) if r else None


def convert(data: dict, amount: float | None, frm: str | None, to: str | None) -> float | None:
    """An amount from one currency into another at the stored rates (through the workspace currency); None when a rate
    isn't known yet, never the same figure under another sign (the owner's QA, 21 Oct: £600 shown as ₦600)."""
    if amount is None:
        return None
    frm, to = str(frm or currency_of(data)).upper(), str(to or currency_of(data)).upper()
    if frm == to:
        return float(amount)
    a = float(amount) * r if (r := fx_rate(data, frm)) is not None else None
    if a is None:
        return None
    back = fx_rate(data, to)
    return money(a / back) if back else None


def in_base(data: dict, doc: dict, amount: float) -> float | None:
    """A document's amount in the workspace currency: at the rate pinned on it when it was first converted, else the stored
    rate; None when no rate is known yet."""
    base = currency_of(data)
    pinned = (doc or {}).get("fx") or {}
    if doc_currency(doc, base) != base and pinned.get("to") == base and pinned.get("rate"):
        return money(float(amount or 0) * float(pinned["rate"]))
    r = fx_rate(data, doc_currency(doc, base))
    return money(float(amount or 0) * r) if r is not None else None


def total_of(data: dict, docs: list[dict], amount) -> dict:
    """A total across documents in the workspace currency (the owner's QA, 16 Oct): each converted at the stored rate and
    date, marked converted when any was; one whose rate is not known is left out and named, never added as if it were."""
    base = currency_of(data)
    value, converted, missing = 0.0, False, {}
    for d in docs:
        a = float(amount(d) or 0)
        if not a:
            continue
        cur = doc_currency(d, base)
        v = in_base(data, d, a)
        if v is None:
            missing[cur] = money(missing.get(cur, 0) + a)
            continue
        value += v
        converted = converted or cur != base
    snap = data.get("fx_rates") or {}
    used = sorted({(snap.get("dates") or {}).get(doc_currency(d, base)) or snap.get("date") for d in docs if doc_currency(d, base) != base} - {None})
    return {"value": money(value), "converted": converted, "missing": missing, "rate_date": (used[0] if used else snap.get("date")) if converted else None}


def rate_words(day: str | None, today: date | None = None) -> str:
    """" at 16 Oct rate", or " at 12 Oct rate, which may be out of date" when the rate is more than 2 days old."""
    d = parse_day(day)
    if not d:
        return ""
    today = today or datetime.now(timezone.utc).date()
    label = f"{d.day} {d.strftime('%b')}"
    return f" at {label} rate" + (", which may be out of date" if (today - d).days > 2 else "")


def fmt_total(t: dict, currency: str) -> str:
    """"£3,045.00", or "≈ ₦6,420,000" when other currencies were converted into it, with what could not be converted."""
    from app.modules.agent.documents import fmt_money as _fmt
    shown = ("≈ " if t.get("converted") else "") + _fmt(t["value"], currency) + rate_words(t.get("rate_date") if t.get("converted") else None)
    left = [_fmt(v, c) for c, v in (t.get("missing") or {}).items()]
    return shown + (f" (plus {' and '.join(left)} not converted yet)" if left else "")


def stamp_document_currencies(data: dict, currency: str) -> int:
    """Before the workspace currency changes: every document with no currency of its own gets the one it was made in (the
    workspace's until now), so the change never relabels it. Returns how many were stamped."""
    f = data.get("financials") if isinstance(data.get("financials"), dict) else {}
    n = 0
    for key in DOCUMENT_LISTS:
        for d in f.get(key) or []:
            if isinstance(d, dict) and not str(d.get("currency") or "").strip():
                d["currency"] = currency
                n += 1
    return n


def company_of(data: dict) -> dict:
    """The seller, from the workspace profile. No placeholders: a missing name or email means
    "ask before sending" (see tools._sender)."""
    p = data.get("workspace_profile") or {}
    settings = data.get("settings") or {}
    address = ", ".join(str(x).strip() for x in (p.get("address_line_1"), p.get("address_line_2"), p.get("city"),
                                                 p.get("postcode"), p.get("country")) if str(x or "").strip())
    return {
        "name": str(p.get("company_name") or "").strip(),
        "email": str(p.get("email") or "").strip() or None,
        "phone": str(p.get("phone_number") or "").strip() or None,
        "website": str(p.get("website") or "").strip() or None,
        "address": address or None,
        "vat_number": str(p.get("vat_number") or settings.get("vat_number") or "").strip() or None,
        "registration_number": str(p.get("registration_number") or "").strip() or None,
        "has_logo": str(p.get("logo_data_url") or "").startswith("data:image/"),
    }


def next_reference(prefix: str, records: list[dict], now: datetime) -> str:
    """Same numbering scheme the Business Operations page uses: PREFIX-<n><ddmmyy>."""
    suffix = now.strftime("%d%m%y")
    same_day = sum(1 for r in records or [] if (parse_day(r.get("created_at")) or date.min) == now.date())
    return f"{prefix}-{same_day + 1}{suffix}"


# ── Deterministic engine results used by Agent + dashboard ────────────────────

def revenue_by_customer(data: dict, since: date | None = None) -> dict[str, float]:
    out: dict[str, float] = {}
    for inv in (data.get("financials") or {}).get("invoices") or []:
        if inv.get("archived") or status_of(inv) not in ("paid", "delivered"):
            continue
        d = parse_day(inv.get("paid_at") or inv.get("issued_at") or inv.get("issue_date") or inv.get("created_at"))
        if since and d and d < since:
            continue
        name = str(inv.get("customer_name") or inv.get("recipient") or "Unknown").strip() or "Unknown"
        v = in_base(data, inv, invoice_total(inv))      # in the workspace currency; a document with no rate yet is left out
        if v is not None:
            out[name] = money(out.get(name, 0) + v)
    return out


def concentration(data: dict, alert_pct: float) -> dict[str, Any]:
    """Client concentration from authoritative invoices."""
    by = revenue_by_customer(data)
    total = sum(by.values())
    ranked = sorted(by.items(), key=lambda kv: kv[1], reverse=True)
    top = [{"customer": n, "revenue": v, "share_pct": round(v / total * 100, 1) if total else 0.0} for n, v in ranked[:5]]
    top1 = top[0]["share_pct"] if top else 0.0
    top2 = round(sum(t["share_pct"] for t in top[:2]), 1)
    return {
        "total_revenue": money(total),
        "customer_count": len(by),
        "top_customers": top,
        "top1_share_pct": top1,
        "top2_share_pct": top2,
        "alert": bool(total and len(by) >= 1 and (top1 >= alert_pct or (len(by) >= 2 and top2 >= max(alert_pct, 60)))),
        "threshold_pct": alert_pct,
    }


def cash_position(data: dict, today: date) -> dict[str, Any]:
    f = data.get("financials") or {}
    invs = [i for i in f.get("invoices") or [] if not i.get("archived")]
    exps = [e for e in f.get("expenses") or [] if not e.get("archived")]
    cash_in = sum(in_base(data, i, invoice_received(i)) or 0 for i in invs if status_of(i) == "paid")
    paid_exps = [e for e in exps if status_of(e) == "paid"]
    cash_out = sum(money(e.get("price") or e.get("total_amount")) for e in paid_exps)
    cos = 0.0
    for i in invs:
        if status_of(i) == "paid":
            total = invoice_total(i)
            cos += (in_base(data, i, money(i.get("cost_of_sales"))) or 0) * (invoice_received(i) / total if total else 1)
    cash = money(cash_in - cash_out - cos)
    # Burn = average monthly paid expenses over the last 3 months with any activity.
    since = today - timedelta(days=92)
    recent = [money(e.get("price") or e.get("total_amount")) for e in paid_exps
              if (parse_day(e.get("date") or e.get("expense_date") or e.get("created_at")) or today) >= since]
    burn = money(sum(recent) / 3) if recent else 0.0
    runway = round(cash / burn, 1) if burn > 0 and cash > 0 else None
    # `recorded`: whether any money in or out is on record at all. Without it, 0 is not a cash position (QA P2-5).
    paid_in = any(status_of(i) == "paid" for i in invs)
    return {"cash": cash, "monthly_burn": burn, "runway_months": runway, "recorded": bool(paid_in or paid_exps)}


def simulate(data: dict, scenario: str, params: dict, today: date) -> dict[str, Any]:
    """Deterministic what-if on authoritative records. No LLM involvement. Cash and monthly costs are the shared figures
    (R-4, agent/figures.py): the same the risk check and the dashboard show, the owner's own answers included."""
    from app.modules.agent import figures
    cp = cash_position(data, today)
    f = figures.of(data, today)
    cp = {**cp, "cash": f["cash"] if f["cash"] is not None else cp["cash"], "monthly_burn": money(f["costs_monthly"] or 0)}
    by = revenue_by_customer(data, since=today - timedelta(days=92))
    monthly_rev = money(sum(by.values()) / 3)
    if scenario == "client_loss":
        name = str(params.get("customer") or "").strip()
        match = next((n for n in by if n.lower() == name.lower()), None) or (max(by, key=by.get) if by else None)
        lost = money((by.get(match, 0) / 3) if match else 0)
        new_rev = money(monthly_rev - lost)
        return {"scenario": "client_loss", "customer": match, "monthly_revenue_before": monthly_rev,
                "monthly_revenue_after": new_rev, "monthly_revenue_lost": lost,
                "revenue_drop_pct": round(lost / monthly_rev * 100, 1) if monthly_rev else 0.0,
                "monthly_burn": cp["monthly_burn"], "monthly_net_after": money(new_rev - cp["monthly_burn"])}
    if scenario == "cost_increase":
        pct = float(params.get("pct") or 10)
        # Before any cost is recorded, the scenario uses the planned monthly costs it is given.
        planned = money(params.get("monthly_costs") or 0)
        if planned > 0 and not cp["monthly_burn"]:
            cp = {**cp, "monthly_burn": planned}
        new_burn = money(cp["monthly_burn"] * (1 + pct / 100))
        return {"scenario": "cost_increase", "pct": pct, "monthly_burn_before": cp["monthly_burn"], "basis": "planned" if planned > 0 and cp["monthly_burn"] == planned else "recorded",
                "monthly_burn_after": new_burn, "monthly_revenue": monthly_rev,
                "monthly_net_before": money(monthly_rev - cp["monthly_burn"]),
                "monthly_net_after": money(monthly_rev - new_burn),
                "runway_months_after": round(cp["cash"] / new_burn, 1) if new_burn > 0 and cp["cash"] > 0 else None}
    raise ValueError(f"Unsupported scenario: {scenario}")

