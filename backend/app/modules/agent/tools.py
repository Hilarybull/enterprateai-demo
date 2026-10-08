"""Tool registry (s14). The Agent acts on the business only through these
registered, versioned tools. Each declares its effect type, required permission,
approval policy, retry/timeout, idempotency basis and credit feature (s14.1).

Tools that need approval expose a `payload_builder`: it expands the request into
the exact, reviewable action payload from the *current* authoritative records.
Approvals bind to a hash of that payload, so any material change to the source
record after approval invalidates it (AC-09, AC-10).
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from app.modules.agent import business as bz
from app.modules.agent import documents as docs
from app.modules.agent import rfq as rfqs
from app.modules.agent.models import (
    EFFECT_EXTERNAL_COMMITMENT, EFFECT_EXTERNAL_COMMUNICATION, EFFECT_INTERNAL_DRAFT,
    EFFECT_INTERNAL_WRITE, EFFECT_READ_ONLY, Actor, DeliveryUncertain, ToolDefinition, new_id,
)

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ToolStop(Exception):
    """A stop condition detected by a tool (s11 stop conditions). Never retried blindly."""
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code
        self.message = message


class NeedsInformation(Exception):
    """A fact only the user can supply is missing: the run waits for it (s16.9).
    The engine turns this into a waiting_for_information question; nothing is sent."""

    def __init__(self, question: str, fields: list[dict]):
        super().__init__(question)
        self.question = question
        self.fields = fields


class ToolFailed(Exception):
    """The action definitely did not happen; safe to retry."""


@dataclass
class ToolContext:
    rt: Any                      # Runtime
    run: dict
    actor: Actor
    policy: dict
    owner_id: str
    idem_key: str | None = None  # set by the gateway for idempotent tools
    reconciled: dict | None = None      # an earlier, unconfirmed attempt that the provider did deliver
    resend: bool = False                # a person confirmed the earlier attempt never arrived: send as a new message
    _data: dict | None = field(default=None, repr=False)

    @property
    def business_id(self) -> str:
        return self.run["business_id"]

    def now(self) -> datetime:
        return self.rt.clock()

    async def data(self, fresh: bool = False) -> dict:
        if self._data is None or fresh:
            self._data = await self.rt.business.load(self.business_id)
        return self._data

    async def mutate(self, fn: Callable[[dict], Any]) -> Any:
        result = await self.rt.business.mutate(self.business_id, fn)
        self._data = None
        return result

    def provider_key(self) -> str:
        return hashlib.sha256(f"{self.business_id}:{self.idem_key}{':resend' if self.resend else ''}".encode()).hexdigest()

    async def deliver(self, **message: Any) -> dict:
        """Send a message once. If reconciliation found that an earlier attempt was delivered,
        that delivery is the result and nothing is sent again."""
        if self.reconciled:
            return {"status": "sent", "message_id": self.reconciled.get("message_id"), "error": None, "reconciled": True}
        return await self.rt.comms.send(**message, idempotency_key=self.provider_key())


def valid_email(value: Any) -> bool:
    return bool(value and _EMAIL_RE.match(str(value).strip()))


def no_email(tc: "ToolContext", rec: dict, then: str, data: dict | None = None) -> ToolStop:
    """Nothing can be sent without an address. Says whose, and for which document, and notes
    both on the task so the page asking for the address can say the same."""
    who = str(rec.get("customer_name") or rec.get("party_name") or "This customer").strip()
    from app.modules.agent import current
    ref = current.document_number(rec, data or {}, tc.run.get("state") or {})
    tc.run.setdefault("state", {})["email_needed"] = {"customer": who, "reference": ref or None}
    return ToolStop("invalid_customer_destination", f"{who} has no email on record" + (f" for {ref}" if ref else "") + f". Add it and I'll {then}.")


def _customers(data: dict) -> list[dict]:
    return [c for c in (data.get("catalogue") or {}).get("customers") or [] if not c.get("archived")]


def _products(data: dict) -> list[dict]:
    return [p for p in (data.get("catalogue") or {}).get("products") or [] if not p.get("archived") and p.get("name")]


def product_price(p: dict) -> float:
    return bz.money(max(0.0, float(p.get("base_price") or 0) - float(p.get("discount") or 0)))


def product_cost(p: dict) -> float:
    return bz.money(p.get("cost_of_sales") or p.get("unit_cost") or 0)


def _line_items(rec: dict) -> list[dict]:
    items = rec.get("line_items")
    if isinstance(items, list) and items:
        return [{"description": str(i.get("description") or ""), "qty": float(i.get("qty") or 1), "unit_price": bz.money(i.get("unit_price")),
                 **({"price_source": i["price_source"]} if i.get("price_source") else {}),
                 **({"details": str(i["details"])} if i.get("details") else {})} for i in items]
    legacy = rec.get("items")
    if isinstance(legacy, list) and legacy:
        return [{"description": str(i.get("product_name") or i.get("name") or ""), "qty": float(i.get("quantity") or 1), "unit_price": bz.money(i.get("unit_price"))} for i in legacy]
    return [{"description": str(rec.get("description") or rec.get("title") or "Services"), "qty": 1.0, "unit_price": bz.invoice_total(rec)}]


def _amounts(rec: dict) -> dict:
    items = _line_items(rec)
    subtotal = bz.money(sum(i["qty"] * i["unit_price"] for i in items))
    vat_rate = float(rec.get("vat_rate") or 0)
    # A discount comes off before VAT: a percentage of the subtotal, or an amount (never more than the subtotal).
    d = rec.get("discount") if isinstance(rec.get("discount"), dict) else {}
    value = float(d.get("value") or 0)
    discount = bz.money(min(subtotal, subtotal * value / 100 if d.get("type") == "percent" else value)) if value > 0 else 0
    net = bz.money(subtotal - discount)
    vat = bz.money(net * vat_rate / 100)
    out = {"items": items, "subtotal": subtotal, "vat_rate": vat_rate, "vat_amount": vat, "total": bz.money(net + vat)}
    if discount:
        out.update({"discount_amount": discount, "discount": {"type": "percent" if d.get("type") == "percent" else "amount", "value": value},
                    "discount_label": f"Discount ({value:g}%)" if d.get("type") == "percent" else "Discount"})
    return out


async def _online(tc, kind: str, p: dict, *, ref: str | None = None, amount: Any = None, description: str = "") -> str | None:
    """The link to the document online, for its email. Never a reason not to send: with no link the email goes as it is."""
    try:
        items = [{"description": i.get("description") or i.get("name") or "", "qty": i.get("qty") or i.get("quantity") or 1, "unit_price": i.get("unit_price") or 0}
                 for i in p.get("items") or [] if isinstance(i, dict)]
        return await tc.rt.comms.document_link({
            "type": kind, "ref": ref or p.get("reference") or "", "party": p.get("customer_name") or "", "workspaceName": p.get("company") or "",
            "amount": bz.money(amount if amount is not None else p.get("total") or p.get("outstanding") or p.get("amount") or 0), "currency": p.get("currency") or "GBP",
            "issued_at": str(p.get("issued_at") or p.get("paid_at") or tc.now().date().isoformat())[:10],
            "description": description or p.get("description") or p.get("solution") or p.get("reason") or "",
            "payments": [], "payment_terms": p.get("payment_terms") or "", "notes": p.get("notes") or "", "line_items": items,
            "vat_rate": float(p.get("vat_rate") or 0), "due_date": str(p.get("due_date") or "")[:10], "source": "agent"})
    except Exception:      # noqa: BLE001
        logger.warning("could not make the online link for %s %s", kind, p.get("reference"), exc_info=True)
        return None


def _asked_currency(tc, data: dict, customer: str | None = None) -> str:
    """The currency for a new document, in this order: the one the owner chose in the form; the one
    they named in their message ("$50", "50 USD"), whether or not a form was shown; the customer's
    own currency, where the Catalogue records one; the business's default. An amount is never converted."""
    state = tc.run.get("state") or {}
    chosen = str((state.get("answers") or {}).get("currency") or "").strip().upper()
    if re.fullmatch(r"[A-Z]{3}", chosen):
        return chosen
    try:
        from app.modules.agent import said
        text = str((state.get("params") or {}).get("body") or tc.run.get("goal") or "")
        named = str(said.read(text, tc.rt.clock().date()).get("currency") or "").upper() if text.strip() else ""
        if re.fullmatch(r"[A-Z]{3}", named):
            return named
    except Exception:      # noqa: BLE001 - reading the message never stops the document
        pass
    who = " ".join(str(customer or "").lower().split())
    if who:
        for c in (data.get("catalogue") or {}).get("customers") or []:
            if isinstance(c, dict) and " ".join(str(c.get("name") or "").lower().split()) == who:
                theirs = _currency({"currency": c.get("currency")}, {}) if c.get("currency") else ""
                if re.fullmatch(r"[A-Z]{3}", str(theirs or "")):
                    return theirs
    return bz.currency_of(data)


def _currency(rec: dict, data: dict) -> str:
    cur = str(rec.get("currency") or "").strip()
    m = re.search(r"\(([A-Z]{3})\)", cur) or re.match(r"^([A-Z]{3})$", cur.upper())
    return m.group(1) if m else bz.currency_of(data)


def _customer_email(rec: dict, data: dict) -> str | None:
    if valid_email(rec.get("customer_email")):
        return str(rec["customer_email"]).strip()
    name = str(rec.get("customer_name") or rec.get("party_name") or rec.get("recipient") or "").strip().lower()
    cid = rec.get("customer_id")
    for c in _customers(data):
        if (cid and str(c.get("id")) == str(cid)) or (name and str(c.get("name") or "").strip().lower() == name):
            if valid_email(c.get("email")):
                return str(c["email"]).strip()
    return None


def _destination(tc: "ToolContext", rec: dict, data: dict) -> str | None:
    """The address a document goes to: the one on record, or a replacement the user gave for
    this task after the email service refused the original. A refused address is never used again."""
    state = tc.run.get("state") or {}
    refused = {e.lower() for e in state.get("refused_emails") or []}
    for c in _customers(data):      # addresses refused in earlier tasks count too
        refused |= {e.lower() for e in c.get("refused_emails") or []}
    given = str((state.get("answers") or {}).get("customer_email") or "").strip()
    if valid_email(given) and given.lower() not in refused:
        return given
    to = _customer_email(rec, data)
    if to and to.lower() in refused:
        raise NeedsInformation(
            f"{to} can't receive messages, so nothing was sent. What email address should I use for this customer instead?",
            [{"key": "customer_email", "label": "Customer email", "type": "email", "required": True}],
        )
    return to


async def _refused(tc: "ToolContext", to_email: str, message: str):
    """The provider refused the address itself: remember it (on this task and on the
    customer record), and ask for another one. The new address changes the payload, so
    it needs a fresh approval before anything is sent."""
    def _mark(data: dict) -> None:
        for c in (data.get("catalogue") or {}).get("customers") or []:
            if str(c.get("email") or "").lower() == (to_email or "").lower():
                c["refused_emails"] = sorted({*(c.get("refused_emails") or []), to_email})
    try:
        await tc.mutate(_mark)
    except Exception:      # noqa: BLE001 - remembering it on the task is enough to proceed
        pass
    state = tc.run.setdefault("state", {})
    state.setdefault("refused_emails", [])
    if to_email and to_email.lower() not in {e.lower() for e in state["refused_emails"]}:
        state["refused_emails"].append(to_email)
    answers = state.setdefault("answers", {})
    if str(answers.get("customer_email") or "").lower() == (to_email or "").lower():
        answers.pop("customer_email", None)
    return NeedsInformation(
        f"{message} What email address should I use instead?",
        [{"key": "customer_email", "label": "Customer email", "type": "email", "required": True}],
    )


def _terms_text(rec: dict) -> str:
    t = rec.get("payment_terms")
    if t in (None, ""):
        return ""
    return f"Net {int(t)} days" if str(t).strip().isdigit() else str(t)


# ══ Read tools (A1) ═══════════════════════════════════════════════════════════

async def read_catalogue(tc: ToolContext, a: dict) -> dict:
    data = await tc.data()
    return {"products": [{"id": p.get("id"), "name": p["name"], "unit_price": product_price(p), "unit_cost": product_cost(p)} for p in _products(data)]}


async def read_price(tc: ToolContext, a: dict) -> dict:
    data = await tc.data()
    p = bz.find(_products(data), a["product_id"])
    if not p:
        raise ToolStop("product_not_found", "That product is not in the catalogue.")
    return {"product_id": p.get("id"), "name": p["name"], "unit_price": product_price(p), "unit_cost": product_cost(p)}


async def read_customer(tc: ToolContext, a: dict) -> dict:
    c = bz.find(_customers(await tc.data()), a["customer_id"])
    if not c:
        raise ToolStop("customer_not_found", "That customer is not on file.")
    return {"customer": {k: c.get(k) for k in ("id", "name", "email", "phone_number", "address", "payment_terms")}}


_LEGAL_WORDS = {"ltd", "limited", "plc", "llp", "lp", "inc", "llc", "co", "corp", "corporation", "company",
                "group", "holdings", "the", "and", "uk", "gb", "international", "intl"}


def _name_core(name: str) -> list[str]:
    """The distinctive words of a business name: no legal suffixes, punctuation or filler."""
    return [w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in _LEGAL_WORDS]


def similar_names(a: str, b: str) -> bool:
    """A possible (not certain) match between two customer names (s15.5). Sharing only
    suffix-like words such as "Ltd" or "Test Ltd" is not enough: the distinctive part of
    one name must contain the other's, or most of their distinctive words must agree."""
    ca, cb = _name_core(a), _name_core(b)
    if not ca or not cb:
        return False
    ja, jb = " ".join(ca), " ".join(cb)
    if ja == jb:
        return True
    shorter, longer = (ja, jb) if len(ja) <= len(jb) else (jb, ja)
    if len(shorter) >= 4 and re.search(rf"\b{re.escape(shorter)}\b", longer):
        return True
    sa, sb = set(ca), set(cb)
    shared = sa & sb
    return bool(shared) and len(shared) / len(sa | sb) >= 0.5 and (ca[0] in shared or cb[0] in shared)


async def search_customer(tc: ToolContext, a: dict) -> dict:
    """Exact match on email or full name; otherwise potential matches for the user to confirm (s15.5)."""
    name = str(a.get("name") or "").strip().lower()
    email = str(a.get("email") or "").strip().lower()
    exact, potential = None, []
    for c in _customers(await tc.data()):
        cname = str(c.get("name") or "").strip().lower()
        cemail = str(c.get("email") or "").strip().lower()
        slim = {k: c.get(k) for k in ("id", "name", "email", "payment_terms")}
        if (email and cemail == email) or (name and cname == name):
            exact = exact or slim
        elif name and cname and similar_names(name, cname):
            potential.append(slim)
    # A customer the owner named in their own request ("quote Frank for…"): the one on record
    # whose name appears in it. Two that fit equally well are not chosen between.
    named = None
    text = str(a.get("text") or "")
    everyone = [c for c in _customers(await tc.data()) if c.get("id") and str(c.get("name") or "").strip()]
    if text:
        said = " " + " ".join(re.findall(r"[a-z0-9]+", text.lower())) + " "
        hits = []
        for c in everyone:
            core = " ".join(_name_core(str(c.get("name"))))
            full = " ".join(re.findall(r"[a-z0-9]+", str(c.get("name")).lower()))
            if len(core) >= 3 and (f" {core} " in said or f" {full} " in said):
                hits.append((len(core), c))
        hits.sort(key=lambda h: -h[0])
        if hits and (len(hits) == 1 or hits[0][0] > hits[1][0]):
            named = {k: hits[0][1].get(k) for k in ("id", "name", "email", "payment_terms")}
    listed = [{k: c.get(k) for k in ("id", "name", "email")} for c in sorted(everyone, key=lambda c: str(c.get("name")).lower())[:300]] if a.get("all") else []
    return {"exact": exact, "potential": potential[:5], "named": named, "all": listed}


def _public_logo_url(business_id: str) -> str | None:
    """Where email clients can load the business's logo (they don't show embedded images)."""
    from app.core.config import get_settings
    base = (get_settings().backend_url or "").rstrip("/")
    return f"{base}/blueprint/public/logo/{business_id}" if base else None


def _sender(tc: ToolContext, data: dict) -> dict:
    """Who a document is sent from. Never a placeholder: if the business has no name yet
    and the user hasn't given one for this task, the run asks (s11, s16.9)."""
    company = bz.company_of(data)
    answers = (tc.run.get("state") or {}).get("answers") or {}
    if not company["name"] and len(str(answers.get("business_name") or "").strip()) >= 2:
        company["name"] = str(answers["business_name"]).strip()
    if not company["email"] and valid_email(answers.get("business_email")):
        company["email"] = str(answers["business_email"]).strip()
    if company["name"] and company["email"]:
        return company
    # One step for the missing business details: customers must see who it's from, and
    # their replies must reach the business.
    fields = []
    if not company["name"]:
        fields.append({"key": "business_name", "label": "Business name", "type": "text", "required": True})
    if not company["email"]:
        # Offered as the address they signed in with (they have just proved it is theirs): one tap to accept, or change it.
        profile, contact = data.get("workspace_profile") or {}, data.get("contact") if isinstance(data.get("contact"), dict) else {}
        own = next((str(x).strip() for x in (profile.get("contact_email"), profile.get("business_email"), profile.get("support_email"), data.get("email"), contact.get("email"),
                                             getattr(tc.actor, "email", None), tc.run.get("requester_email"), getattr(tc.actor, "user_id", None)) if valid_email(x)), "")
        fields.append({"key": "business_email", "label": "Business email (customers' replies go here)", "type": "email", "required": True,
                       **({"default": own} if valid_email(own) else {})})
    fields[-1]["hint"] = "Saved to your workspace profile, so you won't be asked again."
    missing = " and ".join(f["label"].split(" (")[0].lower() for f in fields)
    raise NeedsInformation(
        f"Before this goes to the customer I need your {missing}. Your workspace profile doesn't have "
        f"{'it' if len(fields) == 1 else 'them'} yet, and I won't send under a placeholder.", fields)


async def read_quotation_status(tc: ToolContext, a: dict) -> dict:
    q = bz.find(bz.quotes_of(await tc.data()), a["quote_id"])
    if not q:
        raise ToolStop("quotation_not_found", "That quotation no longer exists.")
    return {"quote_id": q["id"], "status": bz.status_of(q), "total": bz.invoice_total(q), "reference": q.get("reference") or q.get("quotation_id")}


async def read_contract_status(tc: ToolContext, a: dict) -> dict:
    c = bz.find((await tc.data()).get("financials", {}).get("contracts") or [], a["contract_id"])
    if not c:
        raise ToolStop("contract_not_found", "That contract no longer exists.")
    return {"contract_id": c["id"], "status": bz.status_of(c), "reference": c.get("reference")}


async def read_invoice_status(tc: ToolContext, a: dict) -> dict:
    inv = bz.find((await tc.data()).get("financials", {}).get("invoices") or [], a["invoice_id"])
    if not inv:
        raise ToolStop("invoice_not_found", "That invoice no longer exists.")
    not_before = bz.reminder_not_before(inv, tc.policy)
    log = [r.get("sent_at") for r in inv.get("reminders") or [] if r.get("sent_at")]
    return {"invoice_id": inv["id"], "status": bz.status_of(inv), "due_date": inv.get("due_date"),
            "disputed": bool(inv.get("disputed")), "reference": inv.get("reference") or inv.get("invoice_number"),
            "reminders_sent": len(inv.get("reminders") or []), "hold": bz.invoice_hold(inv),
            "last_reminder_at": max(log) if log else None,
            "next_reminder_at": not_before.isoformat() if not_before else None}


async def read_payment_status(tc: ToolContext, a: dict) -> dict:
    """Payment state from the authoritative invoice record only (s16.7, AC-24)."""
    inv = bz.find((await tc.data(fresh=True)).get("financials", {}).get("invoices") or [], a["invoice_id"])
    if not inv:
        raise ToolStop("invoice_not_found", "That invoice no longer exists.")
    total, received = bz.invoice_total(inv), bz.invoice_received(inv)
    return {"invoice_id": inv["id"], "status": bz.status_of(inv), "total": total, "received": received,
            "currency": _currency(inv, await tc.data()),
            "outstanding": bz.invoice_outstanding(inv), "fully_paid": received >= total > 0,
            "overpaid": received > total + 0.005, "payments": inv.get("payments") or [], "hold": bz.invoice_hold(inv),
            "block_reason": bz.reminder_block_reason(inv, tc.now().date())}


async def read_risk(tc: ToolContext, a: dict) -> dict:
    alert_pct = float((tc.policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    return {"concentration": bz.concentration(await tc.data(), alert_pct)}


async def read_recommendation(tc: ToolContext, a: dict) -> dict:
    data = await tc.data()
    today = tc.now().date()
    return {"overdue_invoices": len(bz.overdue_invoices(data, today)), "cash": bz.cash_position(data, today)}


async def run_simulation(tc: ToolContext, a: dict) -> dict:
    return {"result": bz.simulate(await tc.data(), a["scenario"], a.get("params") or {}, tc.now().date())}


# ══ Customer ══════════════════════════════════════════════════════════════════

async def create_customer_draft(tc: ToolContext, a: dict) -> dict:
    name = str(a["name"]).strip()
    email = str(a.get("email") or "").strip()
    now = tc.now().isoformat()

    def _apply(data: dict) -> dict:
        cat = data.setdefault("catalogue", {})
        customers = cat.setdefault("customers", [])
        for c in customers:      # never create a second record for the same person
            same_name = str(c.get("name") or "").strip().lower() == name.lower()
            # `distinct`: the owner chose a new customer although the address is already on record
            # under another name, so only the same name counts as the same customer.
            if same_name or (not a.get("distinct") and email and str(c.get("email") or "").lower() == email.lower()):
                return {"customer_id": c["id"], "created": False}
        cid = new_id()
        customers.append({"id": cid, "name": name, "email": email, "phone_number": a.get("phone_number") or "",
                          "address": "", "industry": "", "payment_terms": int(tc.policy.get("default_payment_terms_days") or 14),
                          "created_by_agent": True, "agent_run_id": tc.run["id"], "created_at": now})
        return {"customer_id": cid, "created": True}

    return await tc.mutate(_apply)


# ══ Quotation ═════════════════════════════════════════════════════════════════

async def create_quotation_draft(tc: ToolContext, a: dict) -> dict:
    now = tc.now()
    items = a["items"]
    for it in items:
        # Prices come from the approved catalogue or an explicit user answer: never invented.
        if not it.get("price_source") or float(it.get("unit_price") or 0) <= 0:
            raise ToolStop("missing_pricing", f"No approved price for '{it.get('name')}'.")
    vat_rate = a.get("vat_rate")
    validity = int(a.get("validity_days") or tc.policy.get("quote_validity_days") or 30)

    def _apply(data: dict) -> dict:
        key = bz.quotes_key(data)
        quotes = bz.records(data, key)
        existing = next((q for q in quotes if q.get("agent_run_id") == tc.run["id"]), None)
        if existing:
            return {"quote_id": existing["id"], "reference": existing.get("reference"), "created": False}
        line_items = [{"id": new_id()[:8], "description": it["name"], "qty": str(it["quantity"]),
                       "unit_price": str(bz.money(it["unit_price"])), "cost_of_sales": str(bz.money(it.get("unit_cost") or 0)),
                       "product_id": it.get("product_id"), "price_source": it["price_source"]} for it in items]
        subtotal = bz.money(sum(float(i["qty"]) * float(i["unit_price"]) for i in line_items))
        rate = float(vat_rate or 0)
        total = bz.money(subtotal + subtotal * rate / 100)
        qid = new_id()
        ref = bz.next_reference("QUO", quotes, now)
        quote = {
            "id": qid, "reference": ref, "quotation_id": ref,
            "customer_id": a["customer"].get("id"), "customer_name": a["customer"]["name"],
            "customer_email": a["customer"].get("email") or "", "recipient": a["customer"]["name"],
            "line_items": line_items,
            # RFQ-style mirror so the existing quotation PDF and views render it.
            "items": [{"product_id": it.get("product_id") or f"agent-{i}", "product_name": it["name"], "quantity": it["quantity"],
                       "unit_price": bz.money(it["unit_price"]), "unit_cost_of_sales": bz.money(it.get("unit_cost") or 0)}
                      for i, it in enumerate(items)],
            "product_names": [it["name"] for it in items],
            "description": ", ".join(it["name"] for it in items),
            "vat_rate": rate, "vat_configured": vat_rate is not None,
            "subtotal_amount": subtotal, "amount": total, "total_amount": total,
            "cost_of_sales": bz.money(sum(float(i["qty"]) * float(i["cost_of_sales"]) for i in line_items)),
            "currency": _asked_currency(tc, data), "validity_days": validity,
            "valid_until": (now + timedelta(days=validity)).date().isoformat(),
            "payment_terms": a.get("payment_terms") or "",
            "notes": a.get("notes") or "", "status": "draft", "version": 1,
            "contact_name": a["customer"].get("contact_name") or "",
            "source": "EnterprateAI Agent", "agent_run_id": tc.run["id"], "source_enquiry_id": a.get("enquiry_id"),
            "issued_at": now.date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(),
        }
        if a.get("rfq_id"):
            # Linked both ways to the marketplace request it answers. The request itself stays
            # pending until the quotation is actually sent.
            quote["rfq_id"] = a["rfq_id"]
            row = rfqs.find(data, a["rfq_id"])
            if row is not None:
                row["draft_quote_id"] = qid
        quotes.insert(0, quote)
        return {"quote_id": qid, "reference": ref, "created": True, "total": total}

    return await tc.mutate(_apply)


async def update_quotation_draft(tc: ToolContext, a: dict) -> dict:
    allowed = {"notes", "payment_terms", "validity_days", "valid_until", "customer_email", "customer_id", "customer_name", "vat_rate", "items", "discount"}
    patch = {k: v for k, v in (a.get("patch") or {}).items() if k in allowed}
    items = patch.pop("items", None)
    if items is not None:
        for it in items:      # same rule as a new draft: every price has a known source
            # A line may be free (0) when the owner says so; the quotation as a whole must still come to more than 0.
            if not it.get("price_source") or float(it.get("unit_price") or 0) < 0 or float(it.get("quantity") or 0) <= 0:
                raise ToolStop("missing_pricing", f"No valid price or quantity for '{it.get('name')}'.")

    def _apply(data: dict) -> dict:
        q = bz.find(bz.records(data, bz.quotes_key(data)), a["quote_id"])
        if not q:
            raise ToolStop("quotation_not_found", "That quotation no longer exists.")
        if bz.status_of(q) != "draft":
            raise ToolStop("quotation_not_draft", "Only a draft quotation can be changed.")
        q.update(patch)
        q["version"] = int(q.get("version") or 1) + 1
        if items is not None:
            q["line_items"] = [{"id": new_id()[:8], "description": it["name"], "qty": str(it["quantity"]),
                                "unit_price": str(bz.money(it["unit_price"])), "cost_of_sales": str(bz.money(it.get("unit_cost") or 0)),
                                "product_id": it.get("product_id"), "price_source": it["price_source"]} for it in items]
            q["items"] = [{"product_id": it.get("product_id") or f"agent-{i}", "product_name": it["name"], "quantity": it["quantity"],
                           "unit_price": bz.money(it["unit_price"]), "unit_cost_of_sales": bz.money(it.get("unit_cost") or 0)}
                          for i, it in enumerate(items)]
            q["product_names"] = [it["name"] for it in items]
            q["description"] = ", ".join(it["name"] for it in items)
            q["cost_of_sales"] = bz.money(sum(float(it["quantity"]) * float(it.get("unit_cost") or 0) for it in items))
        if "discount" in patch and not patch["discount"]:
            q.pop("discount", None)
        if items is not None or "vat_rate" in patch or "discount" in patch:
            if "vat_rate" in patch:
                q["vat_rate"] = float(patch["vat_rate"] or 0)
                q["vat_configured"] = True
            amounts = _amounts(q)
            q["subtotal_amount"] = amounts["subtotal"]
            q["amount"] = q["total_amount"] = amounts["total"]
        q["updated_at"] = tc.now().isoformat()
        return {"quote_id": q["id"], "updated": sorted([*patch, *(["items"] if items is not None else [])]),
                "total": bz.invoice_total(q)}

    return await tc.mutate(_apply)


async def build_quotation_payload(tc: ToolContext, a: dict) -> tuple[dict, str]:
    data = await tc.data(fresh=True)
    q = bz.find(bz.quotes_of(data), a["quote_id"])
    if not q:
        raise ToolStop("quotation_not_found", "That quotation no longer exists.")
    if bz.status_of(q) not in ("draft", "sent"):
        raise ToolStop("source_state_changed", f"The quotation is already {bz.status_of(q)}; it cannot be sent again.")
    to = _destination(tc, q, data)
    if not to:
        raise no_email(tc, q, "send the quotation", data)
    amounts = _amounts(q)
    if amounts["total"] <= 0:
        raise ToolStop("missing_pricing", "The quotation has no priced items.")
    if q.get("rfq_id"):
        # A marketplace request is answered once: by hand or by the Agent, never both.
        row = rfqs.find(data, q["rfq_id"])
        if not row or (rfqs.status_of(row) != "pending" and row.get("quote_id") != q["id"]):
            raise ToolStop("source_state_changed",
                           "This marketplace request has already been answered, declined or removed, so the quotation was not sent.")
    company = _sender(tc, data)
    ref = q.get("reference") or q.get("quotation_id") or q["id"][:8]
    payload = {
        "quote_id": q["id"], "reference": ref, "company": company["name"], "reply_to": company["email"],
        "company_details": {k: company.get(k) for k in ("email", "phone", "website", "address", "vat_number", "registration_number")},
        "logo_url": _public_logo_url(tc.business_id) if company.get("has_logo") else None,
        "version": int(q.get("version") or 1), "issued_at": str(q.get("issued_at") or q.get("created_at") or "")[:10],
        "contact_name": q.get("contact_name") or "",
        "customer_name": q.get("customer_name") or "Customer", "to_email": to, "channel": "email",
        "currency": _currency(q, data), **amounts,
        "valid_until": q.get("valid_until") or "", "payment_terms": _terms_text(q), "notes": q.get("notes") or "",
        "source_enquiry_id": q.get("source_enquiry_id"),
        **({"rfq_id": q["rfq_id"]} if q.get("rfq_id") else {}),
    }
    return payload, f"Send quotation {ref} to {payload['customer_name']}"


async def _revoke_links(tc: ToolContext, quote: dict, *, link: str | None = None, keep: str | None = None) -> None:
    try:
        await tc.rt.comms.revoke_quotation_links(owner_id=tc.owner_id, business_id=tc.business_id, quote=quote, link=link, keep=keep)
    except Exception:      # noqa: BLE001 - tidying links never decides whether the send succeeded
        logger.warning("could not revoke quotation links for %s", quote.get("id"), exc_info=True)


async def _note_pending_link(tc: ToolContext, quote_id: str, value: dict | None) -> None:
    def _apply(d: dict) -> None:
        q = bz.find(bz.records(d, bz.quotes_key(d)), quote_id)
        if q is None:
            return
        if value:
            q["pending_link"] = value
        else:
            q.pop("pending_link", None)

    await tc.mutate(_apply)


async def _mirror_rfq_answer(tc: ToolContext, quote_id: str, answered: dict) -> None:
    """The buyer's own list of requests they sent shows that this one now has a quotation.
    The same record a reply by hand updates; a failure here never undoes the send."""
    def _apply(d: dict) -> None:
        for r in (d.get("financials") or {}).get("sent_rfqs") or []:
            if isinstance(r, dict) and r.get("id") == answered["id"]:
                r.update({"status": "approved", "quote_id": quote_id, "quote_ref": answered["reference"],
                          "quote_total": answered["total"], "approved_at": answered["at"]})

    try:
        await tc.rt.business.mutate(answered["buyer_business"], _apply)
    except Exception:      # noqa: BLE001
        logger.warning("could not update the buyer's record of request %s", answered["id"], exc_info=True)


async def send_quotation(tc: ToolContext, p: dict) -> dict:
    data = await tc.data()
    quote = bz.find(bz.quotes_of(data), p["quote_id"]) or {}
    logo = str((data.get("workspace_profile") or {}).get("logo_data_url") or "")
    full = {**p, "company_details": {**(p.get("company_details") or {}), **({"logo_data_url": logo} if logo.startswith("data:image/") else {})}}
    # One live customer link per quotation: the one in the latest email that was actually sent.
    # The link is noted on the quotation before sending, so if the outcome is never confirmed
    # (a timeout), the retry reuses the same link instead of orphaning one already delivered.
    version = int(p.get("version") or 1)
    held = quote.get("pending_link") or {}
    if held.get("url") and held.get("version") == version and held.get("to") == p["to_email"]:
        link = held["url"]
    else:
        if held.get("url"):      # from an older version or another address: superseded
            await _revoke_links(tc, quote, link=held["url"])
        link = await tc.rt.comms.quotation_link(
            owner_id=tc.owner_id, business_id=tc.business_id, quote=quote, company=p["company"],
            html=docs.quotation_document_html(full),
        )
        if link:
            await _note_pending_link(tc, p["quote_id"], {"url": link, "version": version, "to": p["to_email"]})
    from app.modules.agent.pdf import quotation_attachment
    attachments = quotation_attachment(full)
    mail = docs.quotation_email({**p, "pdf_attached": bool(attachments)}, link)
    res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"],
                                 sender_name=p["company"], reply_to=p.get("reply_to"),
                                 attachments=attachments)
    if res["status"] == "uncertain":
        raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
    if res["status"] != "sent":
        # Nothing was delivered, so the link made for this attempt must not stay open.
        if link:
            await _revoke_links(tc, quote, link=link)
            await _note_pending_link(tc, p["quote_id"], None)
        if res["status"] == "rejected_recipient":
            # A permanent refusal of the address, not something to retry: ask for another one.
            raise await _refused(tc, p["to_email"], res["error"])
        raise ToolFailed(res.get("error") or "The email could not be sent.")
    now = tc.now().isoformat()

    def _apply(d: dict) -> dict | None:
        q = bz.find(bz.records(d, bz.quotes_key(d)), p["quote_id"])
        if q:
            q.pop("pending_link", None)
            q.update({"status": "sent", "sent_at": now, "sent_to": p["to_email"], "acceptance_link": link,
                      "sent_version": version, "updated_at": now})
        # The marketplace request this answers is marked as responded in the same write as the
        # quotation, so the two can't disagree and the request can't be answered a second time.
        row = rfqs.find(d, (q or {}).get("rfq_id") or "") if (q or {}).get("rfq_id") else None
        if row is not None:
            row.update({"status": "approved", "quote_id": q["id"], "approved_at": row.get("approved_at") or now,
                        "responded_by": "agent", "agent_run_id": tc.run["id"]})
            row.pop("draft_quote_id", None)
            return {"id": row["id"], "buyer_business": row.get("sender_workspace_id"), "reference": p["reference"],
                    "total": bz.invoice_total(q), "at": row["approved_at"]}
        return None

    answered = await tc.mutate(_apply)
    if answered and answered.get("buyer_business"):
        await _mirror_rfq_answer(tc, p["quote_id"], answered)
    if link:      # links from earlier versions and earlier sends stop working
        await _revoke_links(tc, quote, keep=link)
    return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "acceptance_link": link, "reference": p["reference"]}


async def record_quotation_acceptance(tc: ToolContext, a: dict) -> dict:
    """Explicit confirmation by an authorised user. Free text can never do this (s16.1, AC-19)."""
    now = tc.now().isoformat()

    def _apply(data: dict) -> dict:
        q = bz.find(bz.records(data, bz.quotes_key(data)), a["quote_id"])
        if not q:
            raise ToolStop("quotation_not_found", "That quotation no longer exists.")
        if bz.status_of(q) in ("rejected", "declined", "expired", "cancelled"):
            raise ToolStop("source_state_changed", f"The quotation is {bz.status_of(q)}.")
        if bz.status_of(q) not in ("accepted", "won"):
            q.update({"status": "accepted", "responded_at": now, "accepted_confirmed_by": tc.actor.user_id, "updated_at": now})
        return {"quote_id": q["id"], "status": bz.status_of(q)}

    return await tc.mutate(_apply)


# ══ Contract ══════════════════════════════════════════════════════════════════

async def create_contract_draft(tc: ToolContext, a: dict) -> dict:
    now = tc.now()

    def _apply(data: dict) -> dict:
        q = bz.find(bz.quotes_of(data), a["quote_id"])
        if not q:
            raise ToolStop("quotation_not_found", "That quotation no longer exists.")
        contracts = bz.records(data, "contracts")
        existing = next((c for c in contracts if c.get("quote_id") == q["id"] and not c.get("archived")), None)
        if existing:      # one contract per accepted quotation (duplicate protection)
            return {"contract_id": existing["id"], "reference": existing.get("reference"), "created": False}
        cid = new_id()
        ref = bz.next_reference("CON", contracts, now)
        amounts = _amounts(q)
        contracts.append({
            "id": cid, "reference": ref, "party_type": "customer",
            "party_name": q.get("customer_name") or "", "customer_name": q.get("customer_name") or "",
            "customer_email": _customer_email(q, data) or "",
            "description": q.get("description") or ", ".join(i["description"] for i in amounts["items"]),
            "amount": amounts["total"], "total_amount": amounts["total"], "currency": _currency(q, data),
            "payment_terms": q.get("payment_terms") or "", "status": "draft", "source": "Quotation",
            "quote_id": q["id"], "quote_reference": q.get("reference") or q.get("quotation_id"),
            "accepted_quote_version": a.get("accepted_version"), "agent_run_id": tc.run["id"],
            "issued_at": now.date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(),
        })
        return {"contract_id": cid, "reference": ref, "created": True}

    return await tc.mutate(_apply)


async def build_contract_payload(tc: ToolContext, a: dict) -> tuple[dict, str]:
    data = await tc.data(fresh=True)
    c = bz.find((data.get("financials") or {}).get("contracts") or [], a["contract_id"])
    if not c:
        raise ToolStop("contract_not_found", "That contract no longer exists.")
    if bz.status_of(c) not in ("draft", "pending"):
        raise ToolStop("source_state_changed", f"The contract is already {bz.status_of(c)}.")
    to = _destination(tc, c, data)
    if not to:
        raise no_email(tc, c, "send the contract", data)
    company = _sender(tc, data)
    payload = {
        "contract_id": c["id"], "reference": c.get("reference") or c["id"][:8], "company": company["name"],
        "reply_to": company["email"], "customer_name": c.get("party_name") or c.get("customer_name") or "Customer",
        "to_email": to, "channel": "email", "currency": _currency(c, data),
        "description": c.get("description") or "", "total": bz.invoice_total(c),
        "payment_terms": _terms_text(c), "quote_id": c.get("quote_id"), "quote_reference": c.get("quote_reference") or "",
        **({"term": c["term"]} if c.get("term") else {}), **({"start_date": str(c["start_date"])[:10]} if c.get("start_date") else {}),
    }
    return payload, f"Send contract {payload['reference']} to {payload['customer_name']}"


async def send_contract(tc: ToolContext, p: dict) -> dict:
    mail = docs.with_link(docs.contract_email(p), "View contract online", await _online(tc, "contract", p))
    res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"],
                                 sender_name=p["company"], reply_to=p.get("reply_to"))
    if res["status"] == "uncertain":
        raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
    if res["status"] == "rejected_recipient":
        # A permanent refusal of the address, not something to retry: ask for another one.
        raise await _refused(tc, p["to_email"], res["error"])
    if res["status"] != "sent":
        raise ToolFailed(res.get("error") or "The email could not be sent.")
    now = tc.now().isoformat()

    def _apply(d: dict) -> None:
        c = bz.find(bz.records(d, "contracts"), p["contract_id"])
        if c:
            c.update({"status": "pending", "sent_at": now, "sent_to": p["to_email"], "updated_at": now})

    await tc.mutate(_apply)
    return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "reference": p["reference"]}


async def record_contract_acceptance(tc: ToolContext, a: dict) -> dict:
    now = tc.now().isoformat()

    def _apply(data: dict) -> dict:
        c = bz.find(bz.records(data, "contracts"), a["contract_id"])
        if not c:
            raise ToolStop("contract_not_found", "That contract no longer exists.")
        if bz.status_of(c) != "signed":
            c.update({"status": "signed", "signed_at": now, "signed_confirmed_by": tc.actor.user_id, "updated_at": now})
        return {"contract_id": c["id"], "status": "signed"}

    return await tc.mutate(_apply)


# ══ Invoice ═══════════════════════════════════════════════════════════════════

async def create_invoice_draft(tc: ToolContext, a: dict) -> dict:
    now = tc.now()
    # The number comes from the business's invoice sequence (unique per business), reserved
    # before the invoice is written.
    data_now = await tc.data(fresh=True)
    current = data_now.get("financials", {}).get("invoices") or []
    taken = {str(i.get("invoice_number") or i.get("reference") or "") for i in current}
    # Dates and the number's day are the business's own "today", not the server's (UTC).
    local = bz.local_now(data_now, now)
    reserved = await tc.rt.store.next_invoice_number(tc.business_id, local, taken)

    def _apply(data: dict) -> dict:
        q = bz.find(bz.quotes_of(data), a["quote_id"])
        if not q:
            raise ToolStop("quotation_not_found", "That quotation no longer exists.")
        invoices = bz.records(data, "invoices")
        existing = next((i for i in invoices if i.get("quote_id") == q["id"] and not i.get("archived")
                         and bz.status_of(i) not in ("void", "voided", "cancelled", "canceled")), None)
        if existing:      # one invoice per accepted quotation (AC-12)
            return {"invoice_id": existing["id"], "reference": existing.get("reference"), "created": False}
        customer = next((c for c in _customers(data) if str(c.get("id")) == str(q.get("customer_id"))
                         or str(c.get("name") or "").strip().lower() == str(q.get("customer_name") or "").strip().lower()), {})
        terms_days = customer.get("payment_terms") or tc.policy.get("default_payment_terms_days") or 14
        try:
            terms_days = int(terms_days)
        except (TypeError, ValueError):
            terms_days = int(tc.policy.get("default_payment_terms_days") or 14)
        amounts = _amounts(q)
        iid = new_id()
        ref = reserved
        invoices.append({
            "id": iid, "reference": ref, "invoice_number": ref,
            "customer_id": q.get("customer_id"), "customer_name": q.get("customer_name") or "",
            "recipient": q.get("customer_name") or "", "customer_email": _customer_email(q, data) or "",
            "line_items": [{"id": new_id()[:8], "description": i.get("description") or "", "qty": str(i.get("qty") or 1),
                            "unit_price": str(i.get("unit_price") or 0), "cost_of_sales": str(i.get("cost_of_sales") or 0)}
                           for i in (q.get("line_items") or [])] or
                          [{"id": new_id()[:8], "description": i["description"], "qty": str(i["qty"]), "unit_price": str(i["unit_price"]), "cost_of_sales": "0"}
                           for i in amounts["items"]],
            "description": q.get("description") or ", ".join(i["description"] for i in amounts["items"]),
            "vat_rate": amounts["vat_rate"], "subtotal_amount": amounts["subtotal"],
            "amount": amounts["total"], "total_amount": amounts["total"], "cost_of_sales": bz.money(q.get("cost_of_sales")),
            "currency": _currency(q, data), "payment_terms": q.get("payment_terms") or f"Net {terms_days} days",
            **({"discount": q["discount"]} if isinstance(q.get("discount"), dict) and q["discount"].get("value") else {}),      # the invoice bills what was quoted
            "due_date": (local + timedelta(days=terms_days)).date().isoformat(),
            "status": "draft", "payments": [],
            # Commercial lineage (AC-21)
            "quote_id": q["id"], "quote_reference": q.get("reference") or q.get("quotation_id"),
            "contract_id": a.get("contract_id"), "accepted_quote_version": a.get("accepted_version"),
            "source": "EnterprateAI Agent", "agent_run_id": tc.run["id"],
            "issued_at": local.date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(),
        })
        return {"invoice_id": iid, "reference": ref, "created": True, "total": amounts["total"]}

    return await tc.mutate(_apply)


async def create_invoice(tc: ToolContext, a: dict) -> dict:
    """A new invoice from a customer and items, with no quotation behind it. Numbered from the
    business's own sequence; due by the customer's payment terms (or the default)."""
    now = tc.now()
    customer, items = a["customer"], a["items"]
    if not items or any(float(i.get("quantity") or 0) <= 0 or float(i.get("unit_price") or 0) < 0 or not str(i.get("name") or "").strip() for i in items):
        raise ToolStop("missing_pricing", "Each invoice line needs a name, a quantity and a price.")
    data_now = await tc.data(fresh=True)
    current = data_now.get("financials", {}).get("invoices") or []
    mine = next((i for i in current if i.get("agent_run_id") == tc.run["id"] and not i.get("quote_id") and not i.get("archived")), None)
    if mine:      # this task already made its invoice: the same one, never a second
        return {"invoice_id": mine["id"], "reference": mine.get("reference"), "created": False, "total": bz.invoice_total(mine)}
    taken = {str(i.get("invoice_number") or i.get("reference") or "") for i in current}
    local = bz.local_now(data_now, now)
    reserved = await tc.rt.store.next_invoice_number(tc.business_id, local, taken)

    def _apply(data: dict) -> dict:
        invoices = bz.records(data, "invoices")
        on_file = next((c for c in _customers(data) if str(c.get("id")) == str(customer.get("id"))), {})
        try:
            terms_days = int(on_file.get("payment_terms") or tc.policy.get("default_payment_terms_days") or 14)
        except (TypeError, ValueError):
            terms_days = int(tc.policy.get("default_payment_terms_days") or 14)
        rec = {
            "id": new_id(), "reference": reserved, "invoice_number": reserved,
            "customer_id": customer.get("id"), "customer_name": customer.get("name") or "", "recipient": customer.get("name") or "",
            "customer_email": str(customer.get("email") or on_file.get("email") or "").strip(),
            "line_items": [{"id": new_id()[:8], "description": str(i["name"]).strip(), "qty": str(i["quantity"]), "unit_price": str(bz.money(i["unit_price"])),
                            "cost_of_sales": str(bz.money(i.get("unit_cost") or 0)), "product_id": i.get("product_id"),
                            **({"price_source": i["price_source"]} if i.get("price_source") else {})} for i in items],
            "description": ", ".join(str(i["name"]).strip() for i in items), "vat_rate": float(a.get("vat_rate") or 0),
            "cost_of_sales": bz.money(sum(float(i["quantity"]) * float(i.get("unit_cost") or 0) for i in items)),
            "currency": _asked_currency(tc, data, customer.get("name")), "payment_terms": f"Net {terms_days} days", "due_date": (local + timedelta(days=terms_days)).date().isoformat(),
            "status": "draft", "payments": [], "source": "EnterprateAI Agent", "agent_run_id": tc.run["id"],
            "issued_at": local.date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(),
        }
        if isinstance(a.get("discount"), dict) and float(a["discount"].get("value") or 0) > 0:
            rec["discount"] = {"type": "percent" if a["discount"].get("type") == "percent" else "amount", "value": float(a["discount"]["value"])}
        if a.get("due_date"):
            rec["due_date"] = str(a["due_date"])[:10]
        if str(a.get("notes") or "").strip():
            rec["notes"] = str(a["notes"]).strip()[:2000]
        amounts = _amounts(rec)
        if amounts["total"] <= 0:
            raise ToolStop("missing_pricing", "The invoice must come to more than 0.")
        rec.update({"subtotal_amount": amounts["subtotal"], "amount": amounts["total"], "total_amount": amounts["total"]})
        invoices.append(rec)
        return {"invoice_id": rec["id"], "reference": reserved, "created": True, "total": amounts["total"]}

    return await tc.mutate(_apply)


async def create_contract(tc: ToolContext, a: dict) -> dict:
    """A new contract or service agreement from scratch: who with, what is agreed, the price,
    the term and when it starts."""
    now = tc.now()
    customer = a["customer"]
    amount = bz.money(a.get("amount") or 0)
    if amount <= 0 or not str(a.get("description") or "").strip():
        raise ToolStop("missing_information", "A contract needs what is agreed and a price above 0.")

    def _apply(data: dict) -> dict:
        contracts = bz.records(data, "contracts")
        mine = next((c for c in contracts if c.get("agent_run_id") == tc.run["id"] and not c.get("quote_id") and not c.get("archived")), None)
        if mine:
            return {"contract_id": mine["id"], "reference": mine.get("reference"), "created": False}
        on_file = next((c for c in _customers(data) if str(c.get("id")) == str(customer.get("id"))), {})
        ref = bz.next_reference("CON", contracts, now)
        contracts.append({
            "id": new_id(), "reference": ref, "party_type": "customer", "party_name": customer.get("name") or "", "customer_name": customer.get("name") or "",
            "customer_id": customer.get("id"), "customer_email": str(customer.get("email") or on_file.get("email") or "").strip(),
            "description": str(a["description"]).strip(), "amount": amount, "total_amount": amount, "currency": _asked_currency(tc, data),
            "payment_terms": f"Net {int(on_file.get('payment_terms') or tc.policy.get('default_payment_terms_days') or 14)} days",
            "term": str(a.get("term") or "").strip(), "start_date": str(a.get("start_date") or "")[:10], "status": "draft", "source": "EnterprateAI Agent",
            "agent_run_id": tc.run["id"], "issued_at": now.date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(),
        })
        return {"contract_id": contracts[-1]["id"], "reference": ref, "created": True}

    return await tc.mutate(_apply)


async def build_invoice_payload(tc: ToolContext, a: dict) -> tuple[dict, str]:
    data = await tc.data(fresh=True)
    inv = bz.find((data.get("financials") or {}).get("invoices") or [], a["invoice_id"])
    if not inv:
        raise ToolStop("invoice_not_found", "That invoice no longer exists.")
    if bz.status_of(inv) not in ("draft", "sent"):
        raise ToolStop("source_state_changed", f"The invoice is already {bz.status_of(inv)}.")
    to = _destination(tc, inv, data)
    if not to:
        raise no_email(tc, inv, "send the invoice", data)
    amounts = _amounts(inv)
    if amounts["total"] <= 0:
        raise ToolStop("missing_pricing", "The invoice has no priced items.")
    if not bz.parse_day(inv.get("due_date")):
        raise ToolStop("missing_due_date", "The invoice has no due date.")
    company = _sender(tc, data)
    ref = inv.get("reference") or inv.get("invoice_number") or inv["id"][:8]
    quote = bz.find(bz.quotes_of(data), inv.get("quote_id")) if inv.get("quote_id") else None
    quote_total = _amounts(quote)["total"] if quote else None
    payload = {
        "invoice_id": inv["id"], "reference": ref, "company": company["name"], "reply_to": company["email"],
        "customer_name": inv.get("customer_name") or "Customer", "to_email": to, "channel": "email",
        "currency": _currency(inv, data), **amounts, "due_date": str(inv["due_date"])[:10],
        "payment_terms": _terms_text(inv), "quote_id": inv.get("quote_id"), "contract_id": inv.get("contract_id"),
        "quote_reference": (quote or {}).get("reference") or (quote or {}).get("quotation_id"),
        # Material differences from the accepted quotation are surfaced for review, never hidden.
        "quote_total": quote_total,
        "differs_from_quote": bool(quote_total is not None and abs(quote_total - amounts["total"]) > 0.005),
    }
    return payload, f"Send invoice {ref} to {payload['customer_name']}"


async def send_invoice(tc: ToolContext, p: dict) -> dict:
    mail = docs.with_link(docs.invoice_email(p), "View invoice online", await _online(tc, "invoice", p))
    res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"],
                                 sender_name=p["company"], reply_to=p.get("reply_to"))
    if res["status"] == "uncertain":
        raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
    if res["status"] == "rejected_recipient":
        # A permanent refusal of the address, not something to retry: ask for another one.
        raise await _refused(tc, p["to_email"], res["error"])
    if res["status"] != "sent":
        raise ToolFailed(res.get("error") or "The email could not be sent.")
    now = tc.now().isoformat()

    def _apply(d: dict) -> None:
        inv = bz.find(bz.records(d, "invoices"), p["invoice_id"])
        if inv and bz.status_of(inv) == "draft":
            inv.update({"status": "sent", "sent_at": now, "sent_to": p["to_email"], "updated_at": now})

    await tc.mutate(_apply)
    return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "reference": p["reference"]}


# ══ Payment follow-up ═════════════════════════════════════════════════════════

async def build_reminder_payload(tc: ToolContext, a: dict) -> tuple[dict, str]:
    """Rebuilt from the live invoice immediately before any send, so a payment that
    landed minutes ago suppresses the reminder (s11.2)."""
    data = await tc.data(fresh=True)
    inv = bz.find((data.get("financials") or {}).get("invoices") or [], a["invoice_id"])
    today = tc.now().date()
    reason = bz.reminder_block_reason(inv, today)
    # Not due yet is not a reason to refuse when the owner asked for a reminder ahead of the due date.
    upcoming = reason == "invoice_not_overdue" and bool(((tc.run.get("state") or {}).get("params") or {}).get("upcoming"))
    if reason and not upcoming:
        hold = bz.invoice_hold(inv)
        raise ToolStop(reason, bz.hold_message(hold) if hold else f"No reminder can be sent: {reason.replace('_', ' ')}.")
    ref = inv.get("reference") or inv.get("invoice_number") or inv["id"][:8]
    sent = [r for r in inv.get("reminders") or [] if r.get("sent_at")]
    not_before = bz.reminder_not_before(inv, tc.policy)
    if not_before and tc.now() < not_before:
        # The minimum interval, however many cadence thresholds the invoice has passed.
        raise ToolStop("reminder_too_soon", bz.skip_text("reminder_too_soon", ref, last=max(r["sent_at"] for r in sent) if sent else None,
                                                         not_before=not_before))
    to = _destination(tc, inv, data)
    if not to:
        raise no_email(tc, inv, "prepare the reminder", data)
    company = _sender(tc, data)
    due = bz.parse_day(inv["due_date"])
    payload = {
        "invoice_id": inv["id"], "reference": ref, "company": company["name"], "reply_to": company["email"],
        "customer_name": inv.get("customer_name") or "Customer", "to_email": to, "channel": "email",
        "currency": _currency(inv, data), "total": bz.invoice_total(inv), "outstanding": bz.invoice_outstanding(inv),
        "due_date": due.isoformat(), "days_overdue": (today - due).days,
        # Always the next stage in order: one stage per send, never one skipped.
        "stage": len(sent) + 1, "policy_version": int(tc.policy.get("version") or 1),
    }
    # What the owner changed for this reminder while it waited for approval: their own wording,
    # and the amount asked for now (never more than is owed).
    edits = (tc.run.get("state") or {}).get("document_edits") or {}
    if str(edits.get("message") or "").strip():
        payload["message"] = str(edits["message"]).strip()
    asked = float(edits.get("amount_requested") or 0)
    if 0 < asked < payload["outstanding"]:
        payload["amount_requested"] = bz.money(asked)
    if upcoming:
        payload.update({"upcoming": True, "days_overdue": 0, "days_until_due": (due - today).days})
    return payload, f"Send payment reminder for invoice {ref} to {payload['customer_name']}"


async def prepare_payment_reminder(tc: ToolContext, a: dict) -> dict:
    payload, _ = await build_reminder_payload(tc, a)
    mail = docs.reminder_email(payload)
    return {"draft": {"to": payload["to_email"], "subject": mail["subject"], "text": mail["text"]},
            "outstanding": payload["outstanding"], "days_overdue": payload["days_overdue"]}


async def send_payment_reminder(tc: ToolContext, p: dict) -> dict:
    mail = docs.with_link(docs.reminder_email(p), "View invoice online", await _online(tc, "invoice", p, amount=p.get("outstanding")))
    res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"],
                                 sender_name=p["company"], reply_to=p.get("reply_to"))
    if res["status"] == "uncertain":
        raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
    if res["status"] == "rejected_recipient":
        # A permanent refusal of the address, not something to retry: ask for another one.
        raise await _refused(tc, p["to_email"], res["error"])
    if res["status"] != "sent":
        raise ToolFailed(res.get("error") or "The email could not be sent.")
    now = tc.now().isoformat()

    def _apply(d: dict) -> None:
        inv = bz.find(bz.records(d, "invoices"), p["invoice_id"])
        if inv:
            log = inv.setdefault("reminders", [])
            if not any(r.get("stage") == p["stage"] and r.get("policy_version") == p["policy_version"] for r in log):
                log.append({"stage": p["stage"], "policy_version": p["policy_version"], "sent_at": now,
                            "sent_to": p["to_email"], "outstanding": p["outstanding"], "agent_run_id": tc.run["id"],
                            "message_id": res.get("message_id")})
            # Stored on the invoice: no reminder may be prepared for it again before this.
            inv["last_reminder_at"] = now
            inv["next_reminder_not_before"] = (tc.now() + timedelta(days=bz.reminder_gap_days(tc.policy, len(log)))).isoformat()
            inv["updated_at"] = now

    await tc.mutate(_apply)
    return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "stage": p["stage"]}


# ══ Payment + receipt ═════════════════════════════════════════════════════════

async def record_payment_confirmation(tc: ToolContext, a: dict) -> dict:
    """Explicit confirmation by an authorised user (s16.7). The Agent cannot originate this."""
    amount = bz.money(a["amount"])
    if amount <= 0:
        raise ToolStop("invalid_payment_amount", "The payment amount must be greater than zero.")
    now = tc.now().isoformat()

    def _apply(data: dict) -> dict:
        inv = bz.find(bz.records(data, "invoices"), a["invoice_id"])
        if not inv:
            raise ToolStop("invoice_not_found", "That invoice no longer exists.")
        outstanding = bz.invoice_outstanding(inv)
        if amount > outstanding + 0.005:
            raise ToolStop("payment_amount_mismatch", f"The payment is more than the {outstanding:,.2f} outstanding. Confirm how to treat the overpayment.")
        ref = str(a.get("reference") or "").strip()
        payments = inv.setdefault("payments", [])
        if ref and any(str(p.get("reference") or "") == ref for p in payments):
            existing = next(p for p in payments if str(p.get("reference") or "") == ref)
            return {"payment_id": existing["id"], "recorded": False, "outstanding": bz.invoice_outstanding(inv)}
        pid = new_id()
        payments.append({"id": pid, "amount": amount, "paid_at": a.get("paid_at") or now, "reference": ref or None,
                         "note": a.get("note"), "confirmed_by": tc.actor.user_id, "source": "authorised_confirmation"})
        received = bz.invoice_received(inv)
        total = bz.invoice_total(inv)
        inv.update({"paid_amount": received, "payment_type": "full" if received >= total else "partial",
                    "status": "paid", "paid_at": inv.get("paid_at") or a.get("paid_at") or now, "updated_at": now})
        return {"payment_id": pid, "recorded": True, "outstanding": bz.invoice_outstanding(inv)}

    return await tc.mutate(_apply)


async def create_receipt(tc: ToolContext, a: dict) -> dict:
    """A receipt exists only for a confirmed payment event, once (s16.8, AC-26).

    The number comes from the receipt ledger (a counter that only goes up, unique per
    business), never from the receipts currently on the invoices. If the payment's receipt
    record was lost after it was issued or sent, it is put back exactly as it was."""
    now = tc.now()

    def _find(data: dict) -> tuple[dict, dict]:
        inv = bz.find(bz.records(data, "invoices"), a["invoice_id"])
        if not inv:
            raise ToolStop("invoice_not_found", "That invoice no longer exists.")
        payment = bz.find(inv.get("payments") or [], a["payment_id"])
        if not payment:
            raise ToolStop("payment_not_confirmed", "There is no confirmed payment to issue a receipt for.")
        return inv, payment

    inv, payment = _find(await tc.data(fresh=True))
    if (payment.get("receipt") or {}).get("number"):
        return {"receipt_number": payment["receipt"]["number"], "created": False,
                "already_sent": bool(payment["receipt"].get("sent_at")), "sent_to": payment["receipt"].get("sent_to")}
    issued = await tc.rt.store.issue_receipt(
        tc.business_id, a["invoice_id"], a["payment_id"], now,
        {"amount": bz.money(payment.get("amount")), "currency": _currency(inv, await tc.data()), "run_id": tc.run["id"]})

    def _apply(data: dict) -> dict:
        inv, payment = _find(data)
        if not (payment.get("receipt") or {}).get("number"):
            receipt = {"number": issued["number"], "created_at": issued.get("created_at") or now.isoformat(),
                       "agent_run_id": issued.get("run_id") or tc.run["id"]}
            if not issued["created"]:      # put back from the ledger, with what is known about its sending
                receipt["restored_at"] = now.isoformat()
                for k in ("sent_at", "sent_to", "message_id"):
                    if issued.get(k):
                        receipt[k] = issued[k]
            payment["receipt"] = receipt
            inv["updated_at"] = now.isoformat()
        r = payment["receipt"]
        return {"receipt_number": r["number"], "created": bool(issued["created"]), "restored": not issued["created"],
                "already_sent": bool(r.get("sent_at")), "sent_to": r.get("sent_to")}

    return await tc.mutate(_apply)


async def build_receipt_payload(tc: ToolContext, a: dict) -> tuple[dict, str]:
    data = await tc.data(fresh=True)
    inv = bz.find((data.get("financials") or {}).get("invoices") or [], a["invoice_id"])
    if not inv:
        raise ToolStop("invoice_not_found", "That invoice no longer exists.")
    payment = bz.find(inv.get("payments") or [], a["payment_id"])
    if not payment or not payment.get("receipt"):
        raise ToolStop("payment_not_confirmed", "There is no confirmed payment with a receipt to send.")
    if payment["receipt"].get("sent_at"):
        raise ToolStop("receipt_already_sent", "This receipt has already been sent.")
    to = _destination(tc, inv, data)
    if not to:
        raise no_email(tc, inv, "send the receipt", data)
    company = _sender(tc, data)
    payload = {
        "invoice_id": inv["id"], "payment_id": payment["id"], "receipt_number": payment["receipt"]["number"],
        "invoice_reference": inv.get("reference") or inv.get("invoice_number") or inv["id"][:8],
        "company": company["name"], "reply_to": company["email"],
        "customer_name": inv.get("customer_name") or "Customer", "to_email": to, "channel": "email",
        "currency": _currency(inv, data), "amount": bz.money(payment.get("amount")),
        "paid_at": str(payment.get("paid_at") or "")[:10], "payment_reference": payment.get("reference") or "",
        "outstanding": bz.invoice_outstanding(inv),
    }
    note = str(((tc.run.get("state") or {}).get("document_edits") or {}).get("message") or "").strip()
    if note:
        payload["message"] = note      # the owner's own words, added while it waited for approval
    return payload, f"Send receipt {payload['receipt_number']} to {payload['customer_name']}"


async def send_receipt(tc: ToolContext, p: dict) -> dict:
    mail = docs.with_link(docs.receipt_email(p), "View receipt online",
                          await _online(tc, "receipt", p, ref=p.get("receipt_number"), amount=p.get("amount"), description=f"Payment for invoice {p.get('invoice_reference') or ''}".strip()))
    res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"],
                                 sender_name=p["company"], reply_to=p.get("reply_to"))
    if res["status"] == "uncertain":
        raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
    if res["status"] == "rejected_recipient":
        # A permanent refusal of the address, not something to retry: ask for another one.
        raise await _refused(tc, p["to_email"], res["error"])
    if res["status"] != "sent":
        raise ToolFailed(res.get("error") or "The email could not be sent.")
    now = tc.now().isoformat()

    def _apply(d: dict) -> None:
        inv = bz.find(bz.records(d, "invoices"), p["invoice_id"])
        payment = bz.find((inv or {}).get("payments") or [], p["payment_id"])
        if payment and payment.get("receipt"):
            payment["receipt"].update({"sent_at": now, "sent_to": p["to_email"], "message_id": res.get("message_id")})

    await tc.mutate(_apply)
    try:
        await tc.rt.store.mark_receipt_sent(tc.business_id, p["receipt_number"], p["invoice_id"], p["payment_id"],
                                            {"sent_at": now, "sent_to": p["to_email"], "message_id": res.get("message_id")})
    except Exception:      # noqa: BLE001 - the receipt was sent and recorded on the payment
        logger.warning("could not mark receipt %s as sent in the ledger", p["receipt_number"], exc_info=True)
    return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "receipt_number": p["receipt_number"]}


# ══ Proposals, purchase orders and credit notes ═══════════════════════════════
# Three more documents that go out by email after approval. Each is a record in the business's
# own books (financials.proposals / purchase_orders / credit_notes), made once per task.

DOCUMENT_KINDS: dict[str, dict[str, str]] = {
    "proposal": {"collection": "proposals", "id": "proposal_id", "prefix": "PRO", "label": "proposal"},
    "purchase_order": {"collection": "purchase_orders", "id": "purchase_order_id", "prefix": "PO", "label": "purchase order"},
    "credit_note": {"collection": "credit_notes", "id": "credit_note_id", "prefix": "CN", "label": "credit note"},
}


async def create_document(tc: ToolContext, a: dict) -> dict:
    """Make a proposal, a purchase order or a credit note from what the owner gave. Never a second one for the same task."""
    kind = DOCUMENT_KINDS[a["kind"]]
    party, body, now = a["party"], dict(a.get("fields") or {}), tc.now()

    def _apply(data: dict) -> dict:
        records = bz.records(data, kind["collection"])
        mine = next((r for r in records if r.get("agent_run_id") == tc.run["id"] and not r.get("archived")), None)
        if mine:
            return {"document_id": mine["id"], "reference": mine.get("reference"), "created": False}
        rec = {"id": new_id(), "reference": bz.next_reference(kind["prefix"], records, now), "party_id": party.get("id"),
               "party_name": party.get("name") or "", "customer_name": party.get("name") or "", "customer_email": str(party.get("email") or "").strip(),
               "currency": _asked_currency(tc, data), "status": "draft", "source": "EnterprateAI Agent", "agent_run_id": tc.run["id"],
               "issued_at": bz.local_now(data, now).date().isoformat(), "created_at": now.isoformat(), "updated_at": now.isoformat(), **body}
        if a["kind"] == "purchase_order":
            items = body.get("items") or []
            if not items or any(float(i.get("quantity") or 0) <= 0 or float(i.get("unit_price") or 0) < 0 or not str(i.get("name") or "").strip() for i in items):
                raise ToolStop("missing_pricing", "Each line of a purchase order needs a name, a quantity and a price.")
            rec.pop("items", None)
            rec["line_items"] = [{"id": new_id()[:8], "description": str(i["name"]).strip(), "qty": str(i["quantity"]), "unit_price": str(bz.money(i["unit_price"]))} for i in items]
            rec["vat_rate"] = float(body.get("vat_rate") or 0)
            amounts = _amounts(rec)
            rec.update({"subtotal_amount": amounts["subtotal"], "amount": amounts["total"], "total_amount": amounts["total"]})
        else:
            rec["amount"] = rec["total_amount"] = bz.money(body.get("total_amount") or body.get("amount") or 0)
        if bz.invoice_total(rec) <= 0:
            raise ToolStop("missing_pricing", f"The {kind['label']} must come to more than 0.")
        records.append(rec)
        return {"document_id": rec["id"], "reference": rec["reference"], "created": True, "total": bz.invoice_total(rec)}

    return await tc.mutate(_apply)


def _document_builder(name: str):
    kind = DOCUMENT_KINDS[name]

    async def build(tc: ToolContext, a: dict) -> tuple[dict, str]:
        data = await tc.data(fresh=True)
        rec = bz.find((data.get("financials") or {}).get(kind["collection"]) or [], a[kind["id"]])
        if not rec:
            raise ToolStop("document_not_found", f"That {kind['label']} no longer exists.")
        if bz.status_of(rec) != "draft":
            raise ToolStop("source_state_changed", f"The {kind['label']} has already been sent.")
        to = _destination(tc, rec, data)
        if not to:
            raise no_email(tc, rec, f"send the {kind['label']}", data)
        company = _sender(tc, data)
        payload = {kind["id"]: rec["id"], "document": name, "reference": rec["reference"], "company": company["name"], "reply_to": company["email"],
                   "customer_name": rec.get("party_name") or "Customer", "to_email": to, "channel": "email", "currency": _currency(rec, data),
                   "total": bz.invoice_total(rec)}
        if name == "purchase_order":
            payload.update({**_amounts(rec), "delivery_date": str(rec.get("delivery_date") or "")[:10], "notes": rec.get("notes") or ""})
        elif name == "proposal":
            payload.update({k: rec.get(k) or "" for k in ("problem", "solution", "timeline", "notes")})
            payload["valid_until"] = str(rec.get("valid_until") or "")[:10]
        else:
            invoice = bz.find((data.get("financials") or {}).get("invoices") or [], rec.get("invoice_id")) or {}
            if not invoice or bz.invoice_hold(invoice):
                raise ToolStop("source_state_changed", "The invoice this credit note is for can no longer be credited.")
            payload.update({"invoice_id": rec.get("invoice_id"), "invoice_reference": rec.get("invoice_reference") or "", "reason": rec.get("reason") or "",
                            "invoice_total": bz.invoice_total(invoice), "refund_amount": bz.money(rec.get("refund_amount") or 0),
                            "full_credit": bz.money(rec.get("total_amount")) >= bz.invoice_total(invoice) - 0.005})
        payload = {k: v for k, v in payload.items() if v not in ("", None)}
        return payload, f"Send {kind['label']} {rec['reference']} to {payload['customer_name']}"
    return build


def _document_sender(name: str):
    kind = DOCUMENT_KINDS[name]

    async def send(tc: ToolContext, p: dict) -> dict:
        label = kind["label"]
        mail = docs.with_link(docs.document_email(name, p), f"View {label} online", await _online(tc, label, p))
        res = await tc.deliver(to_email=p["to_email"], subject=mail["subject"], text=mail["text"], html=mail["html"], sender_name=p["company"], reply_to=p.get("reply_to"))
        if res["status"] == "uncertain":
            raise DeliveryUncertain(res.get("error") or "Delivery status unknown.")
        if res["status"] == "rejected_recipient":
            raise await _refused(tc, p["to_email"], res["error"])
        if res["status"] != "sent":
            raise ToolFailed(res.get("error") or "The email could not be sent.")
        now = tc.now().isoformat()

        def _apply(d: dict) -> None:
            rec = bz.find(bz.records(d, kind["collection"]), p[kind["id"]])
            if rec:
                rec.update({"status": "sent", "sent_at": now, "sent_to": p["to_email"], "updated_at": now})
            if name == "credit_note":
                # The credit takes effect when the note goes out: in full, the invoice is closed as
                # credited; in part, the amount comes off what is still owed.
                inv = bz.find(bz.records(d, "invoices"), p.get("invoice_id"))
                if inv is not None:
                    notes = inv.setdefault("credit_notes", [])
                    if not any(n.get("id") == p[kind["id"]] for n in notes):
                        notes.append({"id": p[kind["id"]], "reference": p["reference"], "amount": bz.money(p["total"]), "reason": p.get("reason") or "", "at": now})
                    if p.get("full_credit") and not bz.invoice_hold(inv):
                        # The same record a person leaves when they mark an invoice as credited.
                        inv["status_before"] = bz.status_of(inv) or "sent"
                        inv.update({"status": "credited", "status_reason": p.get("reason") or f"Credit note {p['reference']}", "status_date": now[:10],
                                    "status_changed_at": now, "status_changed_by": tc.actor.user_id})
                    inv["updated_at"] = now
        await tc.mutate(_apply)
        return {"sent_to": p["to_email"], "message_id": res.get("message_id"), "reference": p["reference"]}
    return send


# ══ Registry ══════════════════════════════════════════════════════════════════

PAYLOAD_BUILDERS: dict[str, Callable[[ToolContext, dict], Awaitable[tuple[dict, str]]]] = {
    "send_quotation": build_quotation_payload,
    "send_contract": build_contract_payload,
    "send_invoice": build_invoice_payload,
    "send_payment_reminder": build_reminder_payload,
    "send_receipt": build_receipt_payload,
    "send_proposal": _document_builder("proposal"),
    "send_purchase_order": _document_builder("purchase_order"),
    "send_credit_note": _document_builder("credit_note"),
}


def _t(tool_id: str, handler, effect: str, permission: str, required: tuple[str, ...] = (), **kw) -> ToolDefinition:
    return ToolDefinition(tool_id=tool_id, version=1, effect=effect, permission=permission, handler=handler, required=required, **kw)


def _send_key(name: str, id_field: str) -> Callable[[dict], str]:
    # Document version (payload hash is appended by the gateway) + send stage + destination (s21.1).
    return lambda p, run: f"{name}:{p[id_field]}:{p['to_email'].lower()}"


REGISTRY: dict[str, ToolDefinition] = {t.tool_id: t for t in [
    # Customer / catalogue
    _t("read_customer", read_customer, EFFECT_READ_ONLY, "view", ("customer_id",)),
    _t("search_customer", search_customer, EFFECT_READ_ONLY, "view"),
    _t("read_catalogue", read_catalogue, EFFECT_READ_ONLY, "view"),
    _t("read_price", read_price, EFFECT_READ_ONLY, "view", ("product_id",)),
    _t("create_customer_draft", create_customer_draft, EFFECT_INTERNAL_WRITE, "prepare", ("name",),
       idempotency=lambda a, run: (f"customer:{a['name'].strip().lower()}|{(a.get('email') or '').strip().lower()}" if a.get("distinct")
                                   else f"customer:{(a.get('email') or a['name']).strip().lower()}"), audit_class="consequential"),
    # Quotation
    _t("create_quotation_draft", create_quotation_draft, EFFECT_INTERNAL_DRAFT, "prepare", ("customer", "items"),
       idempotency=lambda a, run: f"quotation_draft:{run['id']}", credit_feature="agent_quote_draft"),
    _t("update_quotation_draft", update_quotation_draft, EFFECT_INTERNAL_DRAFT, "prepare", ("quote_id", "patch")),
    _t("read_quotation_status", read_quotation_status, EFFECT_READ_ONLY, "view", ("quote_id",)),
    _t("record_quotation_acceptance", record_quotation_acceptance, EFFECT_INTERNAL_WRITE, "send", ("quote_id",),
       audit_class="consequential"),
    _t("send_quotation", send_quotation, EFFECT_EXTERNAL_COMMUNICATION, "send", ("quote_id",), approval_policy="required",
       idempotency=_send_key("send_quotation", "quote_id"), credit_feature="agent_send", audit_class="consequential", max_retries=0),
    # Contract
    _t("create_contract_draft", create_contract_draft, EFFECT_INTERNAL_DRAFT, "prepare", ("quote_id",),
       idempotency=lambda a, run: f"contract:{a['quote_id']}", credit_feature="agent_contract_draft"),
    _t("send_contract", send_contract, EFFECT_EXTERNAL_COMMITMENT, "send", ("contract_id",), approval_policy="required",
       idempotency=_send_key("send_contract", "contract_id"), credit_feature="agent_send", audit_class="consequential"),
    _t("read_contract_status", read_contract_status, EFFECT_READ_ONLY, "view", ("contract_id",)),
    _t("record_contract_acceptance", record_contract_acceptance, EFFECT_INTERNAL_WRITE, "send", ("contract_id",),
       audit_class="consequential"),
    # Invoice / collection
    _t("create_invoice_draft", create_invoice_draft, EFFECT_INTERNAL_DRAFT, "prepare", ("quote_id",),
       idempotency=lambda a, run: f"invoice:{a['quote_id']}", credit_feature="agent_invoice_draft"),
    _t("create_document", create_document, EFFECT_INTERNAL_DRAFT, "prepare", ("kind", "party"),
       idempotency=lambda a, run: f"new-{a['kind']}:{run['id']}"),
    _t("send_proposal", _document_sender("proposal"), EFFECT_EXTERNAL_COMMUNICATION, "send", ("proposal_id",), approval_policy="required",
       idempotency=_send_key("send_proposal", "proposal_id"), credit_feature="agent_send", audit_class="consequential"),
    _t("send_purchase_order", _document_sender("purchase_order"), EFFECT_EXTERNAL_COMMITMENT, "send", ("purchase_order_id",), approval_policy="required",
       idempotency=_send_key("send_purchase_order", "purchase_order_id"), credit_feature="agent_send", audit_class="consequential"),
    _t("send_credit_note", _document_sender("credit_note"), EFFECT_EXTERNAL_COMMUNICATION, "send", ("credit_note_id",), approval_policy="required",
       idempotency=_send_key("send_credit_note", "credit_note_id"), credit_feature="agent_send", audit_class="consequential"),
    _t("create_invoice", create_invoice, EFFECT_INTERNAL_DRAFT, "prepare", ("customer", "items"),
       idempotency=lambda a, run: f"new-invoice:{run['id']}", credit_feature="agent_invoice_draft"),
    _t("create_contract", create_contract, EFFECT_INTERNAL_DRAFT, "prepare", ("customer", "description", "amount"),
       idempotency=lambda a, run: f"new-contract:{run['id']}", credit_feature="agent_contract_draft"),
    _t("send_invoice", send_invoice, EFFECT_EXTERNAL_COMMUNICATION, "send", ("invoice_id",), approval_policy="required",
       idempotency=_send_key("send_invoice", "invoice_id"), credit_feature="agent_send", audit_class="consequential"),
    _t("read_invoice_status", read_invoice_status, EFFECT_READ_ONLY, "view", ("invoice_id",)),
    _t("prepare_payment_reminder", prepare_payment_reminder, EFFECT_INTERNAL_DRAFT, "prepare", ("invoice_id",)),
    _t("send_payment_reminder", send_payment_reminder, EFFECT_EXTERNAL_COMMUNICATION, "send", ("invoice_id",),
       approval_policy="policy_a4",
       # invoice + reminder stage + policy version (s21.1)
       idempotency=lambda p, run: f"reminder:{p['invoice_id']}:stage{p['stage']}:v{p['policy_version']}",
       credit_feature="agent_reminder", audit_class="consequential"),
    # Payment / receipt
    _t("read_payment_status", read_payment_status, EFFECT_READ_ONLY, "view", ("invoice_id",)),
    _t("record_payment_confirmation", record_payment_confirmation, EFFECT_INTERNAL_WRITE, "send", ("invoice_id", "amount"),
       audit_class="consequential"),
    # No idempotency key: the handler is idempotent through the receipt ledger and must always
    # run, so a receipt record that was lost is restored instead of being reported as "done".
    _t("create_receipt", create_receipt, EFFECT_INTERNAL_WRITE, "prepare", ("invoice_id", "payment_id"),
       credit_feature="agent_receipt", audit_class="consequential"),
    _t("send_receipt", send_receipt, EFFECT_EXTERNAL_COMMUNICATION, "send", ("invoice_id", "payment_id"), approval_policy="required",
       idempotency=lambda p, run: f"send_receipt:{p['invoice_id']}:{p['payment_id']}:{p['to_email'].lower()}",
       credit_feature="agent_send", audit_class="consequential"),
    # Decision intelligence (deterministic engines)
    _t("read_risk", read_risk, EFFECT_READ_ONLY, "view", credit_feature="agent_analyse"),
    _t("read_recommendation", read_recommendation, EFFECT_READ_ONLY, "view"),
    _t("run_simulation", run_simulation, EFFECT_READ_ONLY, "view", ("scenario",), credit_feature="agent_analyse"),
]}


def describe_tools() -> list[dict]:
    """Registry listing for the API/audit surface (no handlers)."""
    return [{"tool_id": t.tool_id, "version": t.version, "effect": t.effect, "permission": t.permission,
             "approval_policy": t.approval_policy, "required": list(t.required), "timeout_s": t.timeout_s,
             "max_retries": t.max_retries, "idempotent": t.idempotency is not None,
             "credit_feature": t.credit_feature, "audit_class": t.audit_class} for t in REGISTRY.values()]
