"""Documents and records the Agent makes from scratch.

The rule these follow: ask for what is needed, then deliver the thing. Each works out what the
request and the records already say (the customer named in it, catalogue items and their prices,
the default VAT rate and payment terms), asks for everything still missing in ONE form, and then
finishes: an outgoing document waits in Needs Approval; a record is saved after one confirmation.

None of them needs a source record. Where one exists (a quotation that could be invoiced) it is
offered as a starting point, never required.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from app.modules.agent import business as bz
from app.modules.agent import intent
from app.modules.agent.documents import fmt_money
from app.modules.agent.models import (
    A1_ASSIST, A3_EXECUTE_WITH_APPROVAL, Done, Next, StepDefinition, WaitForInput, WorkflowDefinition, new_id,
)
from app.modules.agent import workflows as _wf      # the payment-monitoring steps are Quote to Cash's own
from app.modules.agent.tools import _amounts, _currency, _customers, _products, product_cost, product_price, valid_email

_TRIGGERS = ("text", "ui_action", "api", "voice")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_MONEY = re.compile(r"(?:£|\$|€|₦|GBP\s*|USD\s*|EUR\s*)\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:pounds|gbp|dollars|usd|euros?|eur)\b", re.I)


def _said(ctx) -> str:
    """The owner's own words for this task (what they typed), if any."""
    if ctx.run.get("source_channel") not in ("text", "voice"):
        return str(ctx.params.get("body") or "")
    return str(ctx.params.get("body") or ctx.run.get("goal") or "")


def _amount_in(text: str) -> float | None:
    m = _MONEY.search(text or "")
    return float((m.group(1) or m.group(2)).replace(",", "")) if m else None


def _open_quotes(data: dict) -> list[dict]:
    """Quotations that could become an invoice: accepted or sent, not archived, not yet invoiced."""
    invoices = (data.get("financials") or {}).get("invoices") or []
    done = {i.get("quote_id") for i in invoices if i.get("quote_id") and not i.get("archived")}
    return [q for q in bz.quotes_of(data) if bz.status_of(q) in ("accepted", "won", "sent") and q["id"] not in done and not q.get("archived")]


def _quote_label(q: dict, data: dict) -> str:
    ref = q.get("reference") or q.get("quotation_id") or q["id"][:8]
    return f"From quotation {ref} · {q.get('customer_name') or ''} · {fmt_money(bz.invoice_total(q), _currency(q, data))} ({bz.status_of(q)})"


def _quote_named(text: str, quotes: list[dict]) -> dict | None:
    said = (text or "").lower()
    return next((q for q in quotes if str(q.get("reference") or q.get("quotation_id") or "").lower() and
                 str(q.get("reference") or q.get("quotation_id")).lower() in said), None)


async def _customer(ctx, text: str) -> dict | None:
    """The customer this is for, from the answers or the owner's own words; None when still unknown."""
    a = ctx.answers
    if a.get("customer_id") and a["customer_id"] != "new":
        c = (await ctx.call("read_customer", customer_id=a["customer_id"]))["customer"]
        return {"id": c["id"], "name": c["name"], "email": str(a.get("customer_email") or c.get("email") or "").strip(), "new": False}
    if str(a.get("customer_name") or "").strip():
        return {"id": None, "name": str(a["customer_name"]).strip(), "email": str(a.get("customer_email") or "").strip(), "new": True}
    named = (await ctx.call("search_customer", text=text)).get("named") if text else None
    if not named and _prefill(ctx).get("customer_name"):
        # Named before sign-up: if that customer is already on record, it is them.
        named = (await ctx.call("search_customer", name=_prefill(ctx)["customer_name"])).get("exact")
    if named:
        return {"id": named["id"], "name": named["name"], "email": str(a.get("customer_email") or named.get("email") or "").strip(), "new": False}
    return None


def _prefill(ctx) -> dict:
    """What the owner already said when they started this from the homepage (PRD-GO-001): shown filled in."""
    given = ctx.params.get("prefill")
    return given if isinstance(given, dict) else {}


async def _customer_fields(ctx, customer: dict | None, only_if: dict | None = None) -> list[dict]:
    """What to ask about the customer: nothing when known with an address; just the address when
    that is all that's missing; otherwise the picker of customers on record plus "+ New customer"."""
    cond = dict(only_if or {})
    if customer and valid_email(customer.get("email")):
        return []
    if customer:
        return [{"key": "customer_email", "label": f"Email address for {customer['name']}", "type": "email", "required": True, **({"show_if": cond} if cond else {})}]
    everyone = (await ctx.call("search_customer", all=True))["all"]
    said = str(_prefill(ctx).get("customer_name") or "")
    fields: list[dict] = []
    if everyone:
        fields.append({"key": "customer_id", "label": "Customer", "type": "customer", "required": True, "new_label": "+ New customer",
                       "options": [{"value": c["id"], "label": c["name"], "email": c.get("email") or ""} for c in everyone],
                       **({"default": "new"} if said else {}), **({"show_if": cond} if cond else {})})
        cond = {**cond, "customer_id": "new"}
    return fields + [{"key": "customer_name", "label": "Customer name", "type": "text", "required": True, "default": said, **({"show_if": cond} if cond else {})},
                     {"key": "customer_email", "label": "Customer email", "type": "email", "required": True, **({"show_if": cond} if cond else {})}]


async def _items(ctx, text: str) -> tuple[list[dict], list[dict], list[dict]]:
    """(priced lines, suggestions for the form, the catalogue). Priced lines come from the answers,
    or from catalogue items the request names; a price is never invented."""
    products = (await ctx.call("read_catalogue"))["products"]
    by_id = {str(p["id"]): p for p in products}
    priced: list[dict] = []
    given = ctx.answers.get("items")
    if isinstance(given, list) and given:
        for it in given:
            qty = float(it.get("quantity") or 0)
            p = by_id.get(str(it.get("product_id") or ""))
            name = str(it.get("name") or (p or {}).get("name") or "").strip()
            typed = it.get("unit_price")
            price = float(typed) if typed not in (None, "") else float((p or {}).get("unit_price") or 0)
            if qty <= 0 or price < 0 or not name:
                continue
            listed = bool(p) and abs(price - float(p["unit_price"])) < 0.005
            priced.append({"product_id": (p or {}).get("id"), "name": name, "quantity": int(qty) if qty.is_integer() else qty, "unit_price": price,
                           "unit_cost": (p or {}).get("unit_cost", 0), "price_source": "catalogue" if listed else "user_confirmed"})
        return priced, [], products
    found = intent.match_items(text, products) if text else []
    suggested = []
    for m in found:
        p = by_id.get(str(m["product_id"]))
        if p and p["unit_price"] > 0:
            priced.append({"product_id": p["id"], "name": p["name"], "quantity": m["quantity"], "unit_price": p["unit_price"],
                           "unit_cost": p["unit_cost"], "price_source": "catalogue"})
        suggested.append({"product_id": m["product_id"], "name": m["name"], "quantity": m["quantity"], "unit_price": (p or {}).get("unit_price") or ""})
    if any(not by_id.get(str(m["product_id"]), {}).get("unit_price") for m in found):
        priced = []      # something named has no price on record: the owner sets it in the form
    said = _prefill(ctx).get("item")
    if not suggested and isinstance(said, dict) and str(said.get("name") or "").strip():
        # Described before sign-up and not in the catalogue: offered as written, for the owner to confirm.
        suggested = [{"product_id": None, "name": str(said["name"]).strip(), "quantity": said.get("quantity") or 1, "unit_price": said.get("unit_price") or ""}]
    return priced, suggested, products


def _items_field(suggested: list[dict], products: list[dict], vat: float | None, only_if: dict | None = None) -> dict:
    return {"key": "items", "label": "Items", "type": "line_items", "required": True, "suggested": suggested, "vat_rate": vat,
            "catalogue": [{"id": p["id"], "name": p["name"], "unit_price": p["unit_price"]} for p in products],
            **({"show_if": only_if} if only_if else {})}


def _vat(ctx) -> float | None:
    if "vat_rate" in ctx.answers and ctx.answers["vat_rate"] not in (None, ""):
        return float(ctx.answers["vat_rate"])
    rate = ctx.policy.get("default_vat_rate")
    return None if rate is None else float(rate)


_VAT_FIELD = {"key": "vat_rate", "label": "VAT rate (%)", "type": "number", "required": True, "default": 0,
              "hint": "Enter 0 if you don't charge VAT. Set a default in Agent settings to skip this question."}


async def _new_customer(ctx, customer: dict) -> dict:
    if customer.get("new") and not customer.get("id"):
        customer["id"] = (await ctx.call("create_customer_draft", name=customer["name"], email=customer.get("email") or ""))["customer_id"]
    return customer


# ══ Invoice: new, or from a quotation ═════════════════════════════════════════

async def invoice_details(ctx):
    text = _said(ctx)
    data = await ctx.rt.business.load(ctx.run["business_id"])
    quotes = _open_quotes(data)
    source = ctx.answers.get("start_from") or ctx.params.get("quote_id") or (_quote_named(text, quotes) or {}).get("id")
    if source and source != "new":
        if not bz.find(quotes, str(source)):
            return WaitForInput("That quotation can't be invoiced any more. What should this invoice be for?", await _invoice_form(ctx, text, quotes, data))
        ctx.state["quote_id"] = str(source)
        return Next()
    customer = await _customer(ctx, text)
    priced, _suggested, _products_ = await _items(ctx, text)
    vat = _vat(ctx)
    if not customer or not valid_email(customer.get("email")) or not priced or vat is None:
        fields = await _invoice_form(ctx, text, quotes if not ctx.answers else [], data)
        return WaitForInput("What should this invoice include?" if any(f["key"] == "items" for f in fields) else "Who is this invoice for?", fields)
    extras: dict = {}
    given = ctx.answers.get("discount")
    if isinstance(given, dict) and float(given.get("value") or 0) > 0:
        extras["discount"] = {"type": "percent" if given.get("type") == "percent" else "amount", "value": float(given["value"])}
    # The form offers the default due date. It only overrides the customer's own terms when the owner changed it.
    days = int(ctx.policy.get("default_payment_terms_days") or 14)
    offered = (bz.local_now(data, ctx.now()).date() + timedelta(days=days)).isoformat()
    if str(ctx.answers.get("due_date") or "")[:10] not in ("", offered):
        extras["due_date"] = str(ctx.answers["due_date"])[:10]
    if str(ctx.answers.get("notes") or "").strip():
        extras["notes"] = str(ctx.answers["notes"]).strip()
    ctx.state.update({"customer": customer, "items": priced, "vat_rate": vat, "extras": extras})
    return Next()


async def _invoice_form(ctx, text: str, quotes: list[dict], data: dict) -> list[dict]:
    """Everything still missing, in one form: where to start from (when a quotation could be
    invoiced), the customer, the items and the VAT rate."""
    customer = await _customer(ctx, text)
    priced, suggested, products = await _items(ctx, text)
    vat = _vat(ctx)
    fields: list[dict] = []
    only_new = None
    if quotes and not customer and not priced:
        only_new = {"start_from": "new"}
        fields.append({"key": "start_from", "label": "Start from", "type": "choice", "required": True, "default": "new",
                       "options": [{"value": "new", "label": "New invoice"}] + [{"value": q["id"], "label": _quote_label(q, data)} for q in quotes[:12]]})
    fields += await _customer_fields(ctx, customer, only_new)
    if not priced:
        cond = {"show_if": only_new} if only_new else {}
        days = int(ctx.policy.get("default_payment_terms_days") or 14)
        # Filled in from Agent settings, there to change: nothing here has to be typed.
        fields += [_items_field(suggested, products, vat, only_new),
                   {"key": "discount", "label": "Discount", "type": "discount", **cond},
                   {"key": "due_date", "label": "Due date", "type": "date", "default": (bz.local_now(data, ctx.now()).date() + timedelta(days=days)).isoformat(),
                    "hint": f"Your payment terms are {days} days. A customer with their own terms keeps them unless you change this.", **cond},
                   {"key": "notes", "label": "Notes on the invoice", "type": "textarea", **cond}]
    if vat is None:
        fields.append({**_VAT_FIELD, **({"show_if": only_new} if only_new else {})})
    return fields


async def invoice_draft(ctx):
    if ctx.state.get("invoice_id"):
        return Next()
    if ctx.state.get("quote_id"):
        made = await ctx.call("create_invoice_draft", quote_id=ctx.state["quote_id"])
    else:
        customer = await _new_customer(ctx, ctx.state["customer"])
        made = await ctx.call("create_invoice", customer={"id": customer["id"], "name": customer["name"], "email": customer.get("email") or ""},
                              items=ctx.state["items"], vat_rate=ctx.state.get("vat_rate") or 0, **(ctx.state.get("extras") or {}))
    ctx.state["invoice_id"], ctx.state["invoice_reference"] = made["invoice_id"], made.get("reference")
    ctx.note(f"Prepared invoice {made.get('reference')}.")
    return Next()


async def invoice_send(ctx):
    if ctx.state.get("quote_id"):
        # Made from a quotation: after it is sent, the payment is watched exactly as the full
        # quote-to-invoice task watches it (reminders on the business's schedule, a receipt for
        # each payment, and the sale closed once it is paid and receipted).
        status = await ctx.call("read_invoice_status", invoice_id=ctx.state["invoice_id"])
        if status["status"] == "draft":
            sent = await ctx.call("send_invoice", invoice_id=ctx.state["invoice_id"])
            ctx.note(f"Invoice {sent['reference']} sent to {sent['sent_to']}.")
        return Next("monitor")
    sent = await ctx.call("send_invoice", invoice_id=ctx.state["invoice_id"])
    return Done(f"Invoice {sent.get('reference') or ctx.state.get('invoice_reference')} was sent to {sent['sent_to']}.",
                next_action="I'll remind them if it becomes overdue.",
                outcome={"invoice_id": ctx.state["invoice_id"], "reference": sent.get("reference") or ctx.state.get("invoice_reference"),
                         "links": [{"label": "Invoices", "to": "/operations?tab=Sales"}]})


NEW_INVOICE = WorkflowDefinition(
    workflow_key="new_invoice", version=1, capability="new_invoice", family="Sell & Revenue", title="New Invoice", autonomy=A3_EXECUTE_WITH_APPROVAL,
    steps=[StepDefinition("details", "Work out the invoice", invoice_details), StepDefinition("draft", "Prepare the invoice", invoice_draft),
           StepDefinition("send", "Send the invoice", invoice_send),
           # Only reached for an invoice made from a quotation: the same steps, by the same names, as Quote to Cash.
           StepDefinition("monitor", "Monitor payment", _wf.q2c_monitor), StepDefinition("reminder", "Follow up on payment", _wf.q2c_reminder),
           StepDefinition("receipt", "Send the receipt", _wf.q2c_receipt), StepDefinition("close", "Close the sale", _wf.q2c_close)],
    tools=("read_customer", "search_customer", "read_catalogue", "create_customer_draft", "create_invoice", "create_invoice_draft", "send_invoice",
           "read_invoice_status", "read_payment_status", "prepare_payment_reminder", "send_payment_reminder", "create_receipt", "send_receipt"),
    triggers=_TRIGGERS, success_condition="Invoice sent after approval; one made from a quotation is then followed until it is paid and receipted.")


# ══ Contract / service agreement: new, or from an accepted quotation ══════════

def _accepted_quotes(data: dict) -> list[dict]:
    contracts = (data.get("financials") or {}).get("contracts") or []
    done = {c.get("quote_id") for c in contracts if c.get("quote_id") and not c.get("archived")}
    return [q for q in bz.quotes_of(data) if bz.status_of(q) in ("accepted", "won") and q["id"] not in done and not q.get("archived")]


async def contract_details(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    quotes = _accepted_quotes(data)
    source = a.get("start_from") or ctx.params.get("quote_id") or (_quote_named(text, quotes) or {}).get("id")
    if source and source != "new" and bz.find(quotes, str(source)):
        ctx.state["quote_id"] = str(source)
        return Next()
    customer = await _customer(ctx, text)
    scope = str(a.get("description") or "").strip()
    value = float(a.get("total") or 0) or (_amount_in(text) or 0)
    today = bz.local_now(data, ctx.now()).date()
    if not customer or not valid_email(customer.get("email")) or not scope or value <= 0:
        only_new = {"start_from": "new"} if quotes and not a else None
        cond = {"show_if": only_new} if only_new else {}
        fields: list[dict] = []
        if only_new:
            fields.append({"key": "start_from", "label": "Start from", "type": "choice", "required": True, "default": "new",
                           "options": [{"value": "new", "label": "New contract"}] + [{"value": q["id"], "label": _quote_label(q, data)} for q in quotes[:12]]})
        fields += await _customer_fields(ctx, customer, only_new)
        fields += [
            {"key": "description", "label": "What is agreed (scope)", "type": "textarea", "required": True, "default": scope, **cond},
            {"key": "total", "label": "Price", "type": "number", "required": True, "default": value or "", **cond},
            {"key": "term", "label": "Term", "type": "text", "default": str(a.get("term") or ""), "hint": "For example: 12 months, or until the work is delivered.", **cond},
            {"key": "start_date", "label": "Start date", "type": "date", "default": str(a.get("start_date") or today.isoformat()), **cond}]
        return WaitForInput("What should this contract say?", fields)
    ctx.state.update({"customer": customer, "contract": {"description": scope[:4000], "amount": value, "term": str(a.get("term") or "").strip()[:200],
                                                         "start_date": str(a.get("start_date") or today.isoformat())[:10]}})
    return Next()


async def contract_draft(ctx):
    if ctx.state.get("contract_id"):
        return Next()
    if ctx.state.get("quote_id"):
        made = await ctx.call("create_contract_draft", quote_id=ctx.state["quote_id"])
    else:
        customer = await _new_customer(ctx, ctx.state["customer"])
        made = await ctx.call("create_contract", customer={"id": customer["id"], "name": customer["name"], "email": customer.get("email") or ""},
                              **ctx.state["contract"])
    ctx.state["contract_id"] = made["contract_id"]
    ctx.note(f"Prepared contract {made.get('reference')}.")
    return Next()


async def contract_send(ctx):
    sent = await ctx.call("send_contract", contract_id=ctx.state["contract_id"])
    return Done(f"Contract {sent.get('reference') or ''} was sent to {sent['sent_to']}.".replace("  ", " "),
                next_action="When they confirm, ask me for the invoice.",
                outcome={"contract_id": ctx.state["contract_id"], "links": [{"label": "Contracts", "to": "/operations?tab=Contracts"}]})


NEW_CONTRACT = WorkflowDefinition(
    workflow_key="new_contract", version=1, capability="new_contract", family="Sell & Revenue", title="New Contract", autonomy=A3_EXECUTE_WITH_APPROVAL,
    steps=[StepDefinition("details", "Work out the contract", contract_details), StepDefinition("draft", "Prepare the contract", contract_draft),
           StepDefinition("send", "Send the contract", contract_send)],
    tools=("read_customer", "search_customer", "create_customer_draft", "create_contract", "create_contract_draft", "send_contract"),
    triggers=_TRIGGERS, success_condition="Contract sent to the customer after approval.")


# ══ Records: saved after one confirmation, nothing sent ═══════════════════════

def _unpaid(data: dict) -> list[dict]:
    return [i for i in (data.get("financials") or {}).get("invoices") or [] if isinstance(i, dict) and not i.get("archived") and not bz.invoice_hold(i)
            and bz.status_of(i) not in ("draft", "void", "voided", "cancelled", "canceled", "written_off") and bz.invoice_outstanding(i) > 0]


def _invoice_label(i: dict, data: dict) -> str:
    ref = i.get("reference") or i.get("invoice_number") or i["id"][:8]
    return f"{ref} · {i.get('customer_name') or ''} · {fmt_money(bz.invoice_outstanding(i), _currency(i, data))} outstanding"


def _invoice_named(text: str, invoices: list[dict]) -> dict | None:
    said = " " + " ".join(re.findall(r"[a-z0-9-]+", (text or "").lower())) + " "
    for i in invoices:
        ref = str(i.get("reference") or i.get("invoice_number") or "").lower()
        if ref and f" {ref} " in said:
            return i
    named = [i for i in invoices if len(str(i.get("customer_name") or "")) >= 3 and str(i["customer_name"]).lower() in (text or "").lower()]
    return named[0] if len(named) == 1 else None


_METHODS = [{"value": "Bank transfer", "label": "Bank transfer"}, {"value": "Card", "label": "Card"}, {"value": "Cash", "label": "Cash"},
            {"value": "Other", "label": "Other"}]


def payment_fields(data: dict, text: str, today: str, answers: dict | None = None) -> list[dict]:
    """The "Record a payment" form: which invoice, how much, when and how. Prefilled from the request."""
    answers = answers or {}
    unpaid = _unpaid(data)
    named = _invoice_named(text, unpaid)
    amount = answers.get("amount") or _amount_in(text) or (bz.invoice_outstanding(named) if named else "")
    return [
        {"key": "invoice_id", "label": "Invoice", "type": "choice", "required": True, "default": answers.get("invoice_id") or (named or {}).get("id") or (unpaid[0]["id"] if len(unpaid) == 1 else ""),
         "options": [{"value": i["id"], "label": _invoice_label(i, data)} for i in unpaid[:25]]},
        {"key": "amount", "label": "Amount received", "type": "number", "default": amount, "hint": "Leave blank for the full amount outstanding."},
        {"key": "paid_at", "label": "Date received", "type": "date", "required": True, "default": str(answers.get("paid_at") or today)},
        {"key": "method", "label": "How it was paid", "type": "choice", "required": True, "default": answers.get("method") or "Bank transfer", "options": _METHODS}]


async def take_payment(ctx, data: dict) -> dict:
    """Record the payment the owner has just confirmed in the form. Returns the invoice and what was recorded."""
    a = ctx.answers
    inv = bz.find(_unpaid(data), str(a.get("invoice_id") or ""))
    if not inv:
        return {}
    amount = float(a["amount"]) if a.get("amount") not in (None, "") else bz.invoice_outstanding(inv)
    made = await ctx.call("record_payment_confirmation", invoice_id=inv["id"], amount=amount, paid_at=str(a.get("paid_at") or "")[:10] or None,
                          note=str(a.get("method") or ""), reference=f"agent:{ctx.run['id']}")
    return {"invoice": inv, "amount": amount, "outstanding": made.get("outstanding")}


async def record_payment_step(ctx):
    data = await ctx.rt.business.load(ctx.run["business_id"])
    today = bz.local_now(data, ctx.now()).date().isoformat()
    if not _unpaid(data):
        return Done("No invoice is waiting to be paid, so there is nothing to record a payment against.",
                    next_action="Ask me for a new invoice and I'll prepare it.", skipped=True, outcome={"reason": "no_unpaid_invoices"})
    if not ctx.answers.get("invoice_id"):
        return WaitForInput("Which payment should I record?", payment_fields(data, _said(ctx), today))
    taken = await take_payment(ctx, data)
    if not taken:
        return WaitForInput("That invoice is no longer waiting for a payment. Which one is it for?", payment_fields(data, _said(ctx), today))
    inv = taken["invoice"]
    ref = inv.get("reference") or inv.get("invoice_number") or inv["id"][:8]
    left = float(taken.get("outstanding") or 0)
    return Done(f"Saved: {fmt_money(taken['amount'], _currency(inv, data))} received against {ref}. "
                + ("It is now paid in full." if left <= 0 else f"{fmt_money(left, _currency(inv, data))} is still outstanding."),
                next_action="Ask me for the receipt and I'll prepare it for your approval.",
                outcome={"invoice_id": inv["id"], "amount": taken["amount"], "links": [{"label": "Invoices", "to": "/operations?tab=Sales"}]})


async def add_customer_step(ctx):
    text, a = _said(ctx), ctx.answers
    if not a:
        m = re.search(r"\bcustomer\s*:?\s+(?:called\s+|named\s+)?(.+?)(?:\s*(?:,|\(|\bwith\b|\bemail\b|\bat\b\s+\S+@)|$)", text, re.I)
        email = _EMAIL.search(text)
        name = (m.group(1).strip(" .") if m else "")
        name = _EMAIL.sub("", name).strip(" ,.")
        return WaitForInput("Is this right?" if name else "Who is the customer?", [
            {"key": "customer_name", "label": "Customer name", "type": "text", "required": True, "default": name, "confirm": bool(name)},
            {"key": "customer_email", "label": "Email", "type": "email", "default": email.group(0).rstrip(".") if email else ""},
            {"key": "phone_number", "label": "Phone", "type": "text", "default": ""}])
    name, email = str(a.get("customer_name") or "").strip(), str(a.get("customer_email") or "").strip()
    if len(name) < 2 or (email and not valid_email(email)):
        return WaitForInput("I need the customer's name (and a valid email address, if you give one).", [
            {"key": "customer_name", "label": "Customer name", "type": "text", "required": True, "default": name},
            {"key": "customer_email", "label": "Email", "type": "email", "default": email}])
    now = ctx.now().isoformat()

    def _apply(data: dict) -> str:
        customers = data.setdefault("catalogue", {}).setdefault("customers", [])
        for c in customers:
            if str(c.get("name") or "").strip().lower() == name.lower():      # already on record: brought up to date
                c.update({k: v for k, v in (("email", email), ("phone_number", str(a.get("phone_number") or "").strip())) if v})
                c["updated_at"] = now
                return "updated"
        customers.append({"id": new_id(), "name": name, "email": email, "phone_number": str(a.get("phone_number") or "").strip(), "address": "", "industry": "",
                          "payment_terms": int(ctx.policy.get("default_payment_terms_days") or 14), "created_by_agent": True, "agent_run_id": ctx.run["id"], "created_at": now})
        return "added"
    how = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done(f"Saved: {name} is {'up to date' if how == 'updated' else 'now a customer'}.", outcome={"customer": name, "links": [{"label": "Customers", "to": "/catalogue?tab=customers"}]})


async def add_item_step(ctx):
    text, a = _said(ctx), ctx.answers
    if not a:
        m = re.search(r"\b(?:catalogue item|catalog item|product|service|item)\s*:?\s+(?:called\s+|named\s+)?(.+?)(?:\s+(?:at|for|priced at|@)\s+|\s*,|$)", text, re.I)
        name = _MONEY.sub("", m.group(1)).strip(" .,") if m else ""
        price = _amount_in(text)
        return WaitForInput("Is this right?" if name and price else "What should I add to your catalogue?", [
            {"key": "name", "label": "Name", "type": "text", "required": True, "default": name, "confirm": bool(name and price)},
            {"key": "price", "label": "Price", "type": "number", "required": True, "default": price if price is not None else ""},
            {"key": "cost", "label": "What it costs you to deliver", "type": "number", "default": "", "hint": "Used to work out your margin."}])
    name = str(a.get("name") or "").strip()
    price = float(a.get("price") or 0)
    if len(name) < 2 or price <= 0:
        return WaitForInput("I need a name and a price above 0.", [
            {"key": "name", "label": "Name", "type": "text", "required": True, "default": name},
            {"key": "price", "label": "Price", "type": "number", "required": True, "default": price or ""}])
    cost = float(a.get("cost") or 0)
    now = ctx.now().isoformat()

    def _apply(data: dict) -> str:
        products = data.setdefault("catalogue", {}).setdefault("products", [])
        for p in products:
            if str(p.get("name") or "").strip().lower() == name.lower():
                p.update({"base_price": bz.money(price), **({"cost_of_sales": bz.money(cost)} if cost > 0 else {}), "updated_at": now})
                return "updated"
        products.append({"id": new_id(), "name": name, "base_price": bz.money(price), "cost_of_sales": bz.money(cost), "created_by_agent": True,
                         "agent_run_id": ctx.run["id"], "created_at": now})
        return "added"
    how = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    data = await ctx.rt.business.load(ctx.run["business_id"])
    return Done(f"Saved: {name} is {'now priced at' if how == 'updated' else 'in your catalogue at'} {fmt_money(price, bz.currency_of(data))}.",
                outcome={"item": name, "links": [{"label": "Catalogue", "to": "/catalogue"}]})


async def record_expense_step(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    today = bz.local_now(data, ctx.now()).date().isoformat()

    def form(values: dict, question: str):
        return WaitForInput(question, [
            {"key": "vendor_name", "label": "Supplier", "type": "text", "required": True, "default": values.get("vendor_name") or ""},
            {"key": "description", "label": "What it was for", "type": "text", "required": True, "default": values.get("description") or ""},
            {"key": "amount", "label": "Amount", "type": "number", "required": True, "default": values.get("amount") or ""},
            {"key": "date", "label": "Date", "type": "date", "required": True, "default": values.get("date") or today},
            {"key": "paid", "label": "Paid already?", "type": "choice", "required": True, "default": values.get("paid") or "yes",
             "options": [{"value": "yes", "label": "Yes, it has been paid"}, {"value": "no", "label": "No, it is still to pay"}]}])
    if not a:
        vendor = re.search(r"\b(?:from|to|at|with)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})", text)
        what = re.search(r"\bfor\s+([a-z][\w\s-]{2,60}?)(?:\s+(?:from|to|at|on)\b|[,.]|$)", text, re.I)
        return form({"vendor_name": vendor.group(1) if vendor else "", "description": what.group(1).strip() if what else "", "amount": _amount_in(text)},
                    "What should I record?")
    vendor, what, amount = str(a.get("vendor_name") or "").strip(), str(a.get("description") or "").strip(), float(a.get("amount") or 0)
    if not vendor or not what or amount <= 0:
        return form(a, "I need the supplier, what it was for, and an amount above 0.")
    now = ctx.now()

    def _apply(d: dict) -> str:
        expenses = bz.records(d, "expenses")
        ref = bz.next_reference("EXP", expenses, now)
        expenses.append({"id": new_id(), "reference": ref, "vendor_name": vendor, "party_name": vendor, "party_type": "vendor", "description": what,
                         "amount": bz.money(amount), "total_amount": bz.money(amount), "date": str(a.get("date") or today)[:10],
                         "status": "paid" if a.get("paid") != "no" else "pending", "currency": bz.currency_of(d), "source": "EnterprateAI Agent",
                         "agent_run_id": ctx.run["id"], "created_at": now.isoformat(), "updated_at": now.isoformat()})
        return ref
    ref = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done(f"Saved: {fmt_money(amount, bz.currency_of(data))} to {vendor} for {what} ({ref}).",
                outcome={"reference": ref, "amount": amount, "links": [{"label": "Expenses", "to": "/operations?tab=Procurement"}]})


def _record(key: str, title: str, step_title: str, handler, tools: tuple[str, ...] = ()) -> WorkflowDefinition:
    return WorkflowDefinition(workflow_key=key, version=1, capability=key, family="Business Operations", title=title, autonomy=A1_ASSIST,
                              triggers=_TRIGGERS, steps=[StepDefinition("record", step_title, handler)], tools=tools,
                              success_condition="Saved to the business's records after the owner confirmed it; nothing sent.")


RECORD_PAYMENT = _record("record_payment", "Record a Payment", "Record the payment", record_payment_step, ("record_payment_confirmation",))
ADD_CUSTOMER = _record("add_customer", "Add a Customer", "Save the customer", add_customer_step)
ADD_CATALOGUE_ITEM = _record("add_catalogue_item", "Add a Catalogue Item", "Save the item", add_item_step)
RECORD_EXPENSE = _record("record_expense", "Record an Expense", "Save the expense", record_expense_step)
# The credit note itself lives in moredocs (in part or in full, with any refund, sent to the customer).

NEW_WORKFLOWS = [NEW_INVOICE, NEW_CONTRACT, RECORD_PAYMENT, ADD_CUSTOMER, ADD_CATALOGUE_ITEM, RECORD_EXPENSE]
