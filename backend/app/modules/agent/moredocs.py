"""More that the Agent delivers from scratch, by the same rule as newdocs: ask once for what the
records don't hold, then finish.

Outgoing documents (they wait in Needs Approval, then go by email): proposal, purchase order,
credit note. Records (saved after one confirmation): supplier bill, vendor, a change to an
existing customer, vendor or catalogue item, the Marketplace profile, and listing or unlisting
an offering.
"""
from __future__ import annotations

import re
from datetime import timedelta

from app.modules.agent import business as bz
from app.modules.agent.documents import fmt_money
from app.modules.agent.models import A3_EXECUTE_WITH_APPROVAL, Done, Next, StepDefinition, WaitForInput, WorkflowDefinition, new_id
from app.modules.agent.newdocs import (
    _EMAIL, _TRIGGERS, _amount_in, _customer, _customer_fields, _invoice_named, _new_customer, _prefill, _record, _said,
)
from app.modules.agent.tools import _currency, _customers, _products, product_cost, product_price, valid_email


def _doc(key: str, title: str, noun: str, details, kind: str, send_tool: str, id_key: str, after: str) -> WorkflowDefinition:
    """A document that is worked out, drafted, and sent after approval."""
    async def draft(ctx):
        if ctx.state.get("document_id"):
            return Next()
        party = ctx.state["party"]
        made = await ctx.call("create_document", kind=kind, party={"id": party.get("id"), "name": party["name"], "email": party.get("email") or ""},
                              fields=ctx.state["fields"])
        ctx.state["document_id"], ctx.state["document_reference"] = made["document_id"], made.get("reference")
        ctx.note(f"Prepared {noun} {made.get('reference')}.")
        return Next()

    async def send(ctx):
        sent = await ctx.call(send_tool, **{id_key: ctx.state["document_id"]})
        return Done(f"{noun[0].upper() + noun[1:]} {sent.get('reference')} was sent to {sent['sent_to']}.", next_action=after,
                    outcome={id_key: ctx.state["document_id"], "reference": sent.get("reference")})

    return WorkflowDefinition(
        workflow_key=key, version=1, capability=key, family="Sell & Revenue" if kind != "purchase_order" else "Business Operations", title=title,
        autonomy=A3_EXECUTE_WITH_APPROVAL, triggers=_TRIGGERS,
        steps=[StepDefinition("details", f"Work out the {noun}", details), StepDefinition("draft", f"Prepare the {noun}", draft),
               StepDefinition("send", f"Send the {noun}", send)],
        tools=("read_customer", "search_customer", "create_customer_draft", "create_document", send_tool),
        success_condition=f"{title}: sent after approval.")


# ══ Proposal ══════════════════════════════════════════════════════════════════

async def proposal_details(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    customer = await _customer(ctx, text)
    solution = str(a.get("solution") or "").strip()
    price = float(a.get("total") or 0) or (_amount_in(text) or 0)
    if not customer or not valid_email(customer.get("email")) or not solution or price <= 0:
        solution = solution or str(_prefill(ctx).get("solution") or "")      # said when this was started from the homepage: shown, to confirm
        price = price or float(_prefill(ctx).get("amount") or 0)
        # What the business has already said about the problem it solves (profile, launch plan) is offered, not asked for again.
        from app.modules.agent import modules
        from app.modules.agent.workflows import idea_of
        data["_launch"] = await modules.launch_facts(ctx.orch, ctx.run["business_id"])
        known = idea_of(data)
        validity = int(ctx.policy.get("quote_validity_days") or 30)
        until = (bz.local_now(data, ctx.now()).date() + timedelta(days=validity)).isoformat()
        return WaitForInput("What should this proposal say?", [
            *(await _customer_fields(ctx, customer)),
            {"key": "problem", "label": "What the customer needs", "type": "textarea", "default": str(a.get("problem") or known.get("problem") or ""),
             **({"hint": "From what you've said your business solves. Change it to fit this customer."} if known.get("problem") and not a.get("problem") else {})},
            {"key": "solution", "label": "What you propose", "type": "textarea", "required": True, "default": solution},
            {"key": "total", "label": "Price", "type": "number", "required": True, "default": price or ""},
            {"key": "timeline", "label": "Timeline", "type": "text", "default": str(a.get("timeline") or ""), "hint": "For example: 6 weeks from kick-off."},
            {"key": "valid_until", "label": "Valid until", "type": "date", "default": str(a.get("valid_until") or until)}])
    customer = await _new_customer(ctx, customer)
    ctx.state.update({"party": customer, "fields": {
        "problem": str(a.get("problem") or "").strip()[:4000], "solution": solution[:6000], "total_amount": price,
        "timeline": str(a.get("timeline") or "").strip()[:200], "valid_until": str(a.get("valid_until") or "")[:10]}})
    return Next()


NEW_PROPOSAL = _doc("new_proposal", "New Proposal", "proposal", proposal_details, "proposal", "send_proposal", "proposal_id",
                    "When they say yes, ask me for the contract or the invoice.")


# ══ Purchase order ════════════════════════════════════════════════════════════

def _vendors(data: dict) -> list[dict]:
    return [v for v in (data.get("catalogue") or {}).get("vendors") or [] if isinstance(v, dict) and not v.get("archived") and v.get("id") and str(v.get("name") or "").strip()]


def _named(text: str, records: list[dict]) -> dict | None:
    """The one record whose name appears in the text (the longest, when names overlap)."""
    said = " " + " ".join(re.findall(r"[a-z0-9]+", (text or "").lower())) + " "
    hits = sorted(((len(str(r["name"])), r) for r in records
                   if len(str(r.get("name") or "")) >= 3 and " " + " ".join(re.findall(r"[a-z0-9]+", str(r["name"]).lower())) + " " in said), key=lambda h: -h[0])
    return hits[0][1] if hits and (len(hits) == 1 or hits[0][0] > hits[1][0]) else None


def _vendor(ctx, data: dict, text: str) -> dict | None:
    a = ctx.answers
    if a.get("vendor_id") and a["vendor_id"] != "new":
        v = bz.find(_vendors(data), str(a["vendor_id"]))
        return {"id": v["id"], "name": v["name"], "email": str(a.get("vendor_email") or v.get("email") or "").strip(), "new": False} if v else None
    if str(a.get("vendor_name") or "").strip():
        return {"id": None, "name": str(a["vendor_name"]).strip(), "email": str(a.get("vendor_email") or "").strip(), "new": True}
    v = _named(text, _vendors(data))
    return {"id": v["id"], "name": v["name"], "email": str(a.get("vendor_email") or v.get("email") or "").strip(), "new": False} if v else None


def _vendor_fields(data: dict, vendor: dict | None) -> list[dict]:
    if vendor and valid_email(vendor.get("email")):
        return []
    if vendor:
        return [{"key": "vendor_email", "label": f"Email address for {vendor['name']}", "type": "email", "required": True}]
    known = _vendors(data)
    fields: list[dict] = []
    cond = {}
    if known:
        fields.append({"key": "vendor_id", "label": "Supplier", "type": "customer", "required": True, "new_label": "+ New supplier",
                       "options": [{"value": v["id"], "label": v["name"], "email": v.get("email") or ""} for v in sorted(known, key=lambda v: str(v["name"]).lower())]})
        cond = {"show_if": {"vendor_id": "new"}}
    return fields + [{"key": "vendor_name", "label": "Supplier name", "type": "text", "required": True, **cond},
                     {"key": "vendor_email", "label": "Supplier email", "type": "email", "required": True, **cond}]


def _lines(answers: dict) -> list[dict]:
    out = []
    for it in answers.get("items") or []:
        qty, name = float(it.get("quantity") or 0), str(it.get("name") or "").strip()
        price = float(it.get("unit_price") or 0) if it.get("unit_price") not in (None, "") else -1
        if qty > 0 and price >= 0 and name:
            out.append({"name": name, "quantity": int(qty) if qty.is_integer() else qty, "unit_price": price})
    return out


async def _save_vendor(ctx, vendor: dict) -> dict:
    if not vendor.get("new") or vendor.get("id"):
        return vendor
    now = ctx.now().isoformat()

    def _apply(data: dict) -> str:
        vendors = data.setdefault("catalogue", {}).setdefault("vendors", [])
        for v in vendors:
            if str(v.get("name") or "").strip().lower() == vendor["name"].lower():
                if vendor.get("email") and not v.get("email"):
                    v["email"] = vendor["email"]
                return v["id"]
        vendors.append({"id": new_id(), "name": vendor["name"], "email": vendor.get("email") or "", "phone_number": "", "created_by_agent": True,
                        "agent_run_id": ctx.run["id"], "created_at": now})
        return vendors[-1]["id"]
    vendor["id"] = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return vendor


async def purchase_order_details(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    vendor = _vendor(ctx, data, text)
    lines = _lines(a)
    if not vendor or not valid_email(vendor.get("email")) or not lines:
        return WaitForInput("What should this purchase order be for?", [
            *_vendor_fields(data, vendor),
            *([] if lines else [{"key": "items", "label": "Items to order", "type": "line_items", "required": True, "suggested": [], "catalogue": []}]),
            {"key": "delivery_date", "label": "Deliver by", "type": "date", "default": str(a.get("delivery_date") or "")},
            {"key": "notes", "label": "Notes to the supplier", "type": "textarea", "default": str(a.get("notes") or "")}])
    vendor = await _save_vendor(ctx, vendor)
    ctx.state.update({"party": vendor, "fields": {"items": lines, "delivery_date": str(a.get("delivery_date") or "")[:10], "notes": str(a.get("notes") or "").strip()[:2000]}})
    return Next()


NEW_PURCHASE_ORDER = _doc("new_purchase_order", "New Purchase Order", "purchase order", purchase_order_details, "purchase_order", "send_purchase_order",
                          "purchase_order_id", "When their bill arrives, ask me to record the supplier bill.")


# ══ Credit note: in full or in part, with any refund, sent to the customer ════

def _creditable(data: dict) -> list[dict]:
    return [i for i in (data.get("financials") or {}).get("invoices") or [] if isinstance(i, dict) and not i.get("archived") and not bz.invoice_hold(i)
            and bz.status_of(i) not in ("draft", "void", "voided", "cancelled", "canceled") and bz.invoice_total(i) - bz.invoice_credited(i) > 0]


async def credit_note_details(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    invoices = _creditable(data)
    if not invoices:
        return Done("No invoice has been sent yet, so there is nothing to credit.", next_action="Ask me for a new invoice and I'll prepare it.",
                    skipped=True, outcome={"reason": "no_invoices"})
    inv = bz.find(invoices, str(a.get("invoice_id") or "")) or (None if a.get("invoice_id") else _invoice_named(text, invoices))
    reason = str(a.get("reason") or "").strip()
    problem = ""
    if inv and reason:
        room = bz.money(bz.invoice_total(inv) - bz.invoice_credited(inv))
        amount = bz.money(a["amount"]) if a.get("amount") not in (None, "") else room
        refund = bz.money(a.get("refund_amount") or 0)
        if not 0 < amount <= room + 0.005:
            problem = f"The credit must be above 0 and no more than {fmt_money(room, _currency(inv, data))}. "
        elif refund < 0 or refund > min(amount, bz.invoice_received(inv)) + 0.005:
            problem = f"The refund can't be more than the credit or than the {fmt_money(bz.invoice_received(inv), _currency(inv, data))} they have paid. "
        else:
            ctx.state.update({"party": {"id": inv.get("customer_id"), "name": inv.get("customer_name") or "Customer", "email": str(a.get("customer_email") or inv.get("customer_email") or "")},
                              "fields": {"invoice_id": inv["id"], "invoice_reference": inv.get("reference") or inv.get("invoice_number") or inv["id"][:8],
                                         "reason": reason[:500], "total_amount": amount, "refund_amount": refund}})
            return Next()
    typed = _amount_in(text)
    return WaitForInput(problem + "Which invoice should I credit, by how much, and why?", [
        {"key": "invoice_id", "label": "Invoice", "type": "choice", "required": True, "default": (inv or {}).get("id") or "",
         "options": [{"value": i["id"], "label": f"{i.get('reference') or i.get('invoice_number') or i['id'][:8]} · {i.get('customer_name') or ''} · "
                                                f"{fmt_money(bz.invoice_total(i), _currency(i, data))}"
                                                + (f" ({fmt_money(bz.invoice_credited(i), _currency(i, data))} already credited)" if bz.invoice_credited(i) else "")} for i in invoices[:25]]},
        {"key": "amount", "label": "Amount to credit", "type": "number", "default": a.get("amount") or typed or "", "hint": "Leave blank to credit the invoice in full."},
        {"key": "reason", "label": "Reason", "type": "text", "required": True, "default": reason, "hint": "Shown on the credit note."},
        {"key": "refund_amount", "label": "Amount to refund", "type": "number", "default": a.get("refund_amount") or "",
         "hint": "Only if money they have already paid is going back. You send the refund from your bank; the credit note says it is coming."}])


CREDIT_NOTE = _doc("credit_note", "Credit Note", "credit note", credit_note_details, "credit_note", "send_credit_note", "credit_note_id",
                   "If a refund is due, send it from your bank: the credit note tells them to expect it.")


# ══ Records ═══════════════════════════════════════════════════════════════════

async def supplier_bill_step(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    today = bz.local_now(data, ctx.now()).date()
    lines = _lines(a)
    vendor = str(a.get("vendor_name") or "").strip()
    if not vendor or not lines:
        known = _named(text, _vendors(data))
        m = re.search(r"\b(?:from|by)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})", text)
        typed = _amount_in(text)
        return WaitForInput("What is on the supplier's bill?", [
            {"key": "vendor_name", "label": "Supplier", "type": "text", "required": True, "default": vendor or (known or {}).get("name") or (m.group(1) if m else "")},
            {"key": "reference", "label": "Their bill number", "type": "text", "default": str(a.get("reference") or "")},
            {"key": "items", "label": "What they billed for", "type": "line_items", "required": True, "catalogue": [],
             "suggested": [{"product_id": None, "name": "", "quantity": 1, "unit_price": typed}] if typed else []},
            {"key": "date", "label": "Bill date", "type": "date", "required": True, "default": str(a.get("date") or today.isoformat())},
            {"key": "due_date", "label": "Due date", "type": "date", "default": str(a.get("due_date") or (today + timedelta(days=30)).isoformat())}])
    now = ctx.now()
    total = bz.money(sum(float(i["quantity"]) * float(i["unit_price"]) for i in lines))
    if total <= 0:
        return WaitForInput("The bill must come to more than 0. What did they bill for?", [
            {"key": "items", "label": "What they billed for", "type": "line_items", "required": True, "catalogue": [], "suggested": []}])

    def _apply(d: dict) -> str:
        expenses = bz.records(d, "expenses")
        ref = str(a.get("reference") or "").strip() or bz.next_reference("BILL", expenses, now)
        expenses.append({"id": new_id(), "reference": ref, "vendor_name": vendor, "party_name": vendor, "party_type": "vendor", "kind": "supplier_bill",
                         "description": ", ".join(i["name"] for i in lines), "amount": total, "total_amount": total,
                         "line_items": [{"id": new_id()[:8], "description": i["name"], "qty": str(i["quantity"]), "unit_price": str(bz.money(i["unit_price"]))} for i in lines],
                         "date": str(a.get("date") or today.isoformat())[:10], "due_date": str(a.get("due_date") or "")[:10] or None, "status": "pending",
                         "currency": bz.currency_of(d), "source": "EnterprateAI Agent", "agent_run_id": ctx.run["id"], "created_at": now.isoformat(), "updated_at": now.isoformat()})
        return ref
    ref = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done(f"Saved: supplier bill {ref} from {vendor} for {fmt_money(total, bz.currency_of(data))}, to pay"
                + (f" by {a['due_date']}." if a.get("due_date") else "."),
                next_action="When you've paid it, mark it as paid in Business Operations.",
                outcome={"reference": ref, "amount": total, "links": [{"label": "Supplier bills", "to": "/operations?tab=Procurement"}]})


async def add_vendor_step(ctx):
    text, a = _said(ctx), ctx.answers
    if not a:
        m = re.search(r"\b(?:vendor|supplier)\s*:?\s+(?:called\s+|named\s+)?(.+?)(?:\s*(?:,|\(|\bwith\b|\bemail\b)|$)", text, re.I)
        email = _EMAIL.search(text)
        name = _EMAIL.sub("", m.group(1)).strip(" ,.") if m else ""
        return WaitForInput("Is this right?" if name else "Who is the supplier?", [
            {"key": "vendor_name", "label": "Supplier name", "type": "text", "required": True, "default": name, "confirm": bool(name)},
            {"key": "vendor_email", "label": "Email", "type": "email", "default": email.group(0).rstrip(".") if email else ""},
            {"key": "phone_number", "label": "Phone", "type": "text", "default": ""}])
    name, email = str(a.get("vendor_name") or "").strip(), str(a.get("vendor_email") or "").strip()
    if len(name) < 2 or (email and not valid_email(email)):
        return WaitForInput("I need the supplier's name (and a valid email address, if you give one).", [
            {"key": "vendor_name", "label": "Supplier name", "type": "text", "required": True, "default": name},
            {"key": "vendor_email", "label": "Email", "type": "email", "default": email}])
    now = ctx.now().isoformat()

    def _apply(data: dict) -> str:
        vendors = data.setdefault("catalogue", {}).setdefault("vendors", [])
        for v in vendors:
            if str(v.get("name") or "").strip().lower() == name.lower():
                v.update({k: val for k, val in (("email", email), ("phone_number", str(a.get("phone_number") or "").strip())) if val})
                v["updated_at"] = now
                return "updated"
        vendors.append({"id": new_id(), "name": name, "email": email, "phone_number": str(a.get("phone_number") or "").strip(), "created_by_agent": True,
                        "agent_run_id": ctx.run["id"], "created_at": now})
        return "added"
    how = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done(f"Saved: {name} is {'up to date' if how == 'updated' else 'now a supplier'}.", outcome={"vendor": name, "links": [{"label": "Suppliers", "to": "/catalogue?tab=vendors"}]})


# What can be changed on each kind of record: (field, label, type).
_EDITABLE = {
    "customer": ("customers", "Customer", [("name", "Name", "text"), ("email", "Email", "email"), ("phone_number", "Phone", "text"), ("payment_terms", "Payment terms (days)", "number")]),
    "vendor": ("vendors", "Supplier", [("name", "Name", "text"), ("email", "Email", "email"), ("phone_number", "Phone", "text")]),
    "item": ("products", "Catalogue item", [("name", "Name", "text"), ("base_price", "Price", "number"), ("cost_of_sales", "What it costs you to deliver", "number")]),
}
_KIND_WORDS = (("customer", r"\b(customer|client)s?\b"), ("vendor", r"\b(vendor|supplier)s?\b"), ("item", r"\b(catalogue|catalog|product|service|item|price)s?\b"))


def _all_records(data: dict) -> dict[str, list[dict]]:
    return {"customer": _customers(data), "vendor": _vendors(data), "item": _products(data)}


async def update_record_step(ctx):
    """Pick one and edit it: the record named in the request (or chosen), then its details, filled in, to change."""
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    everything = _all_records(data)
    wanted = [k for k, pattern in _KIND_WORDS if re.search(pattern, text, re.I)] or list(everything)
    kind, rec = None, None
    if a.get("record"):
        kind, _, rid = str(a["record"]).partition(":")
        rec = bz.find(everything.get(kind) or [], rid)
    else:
        for k in wanted:
            rec = _named(text, [r for r in everything[k] if r.get("id")])
            if rec:
                kind = k
                break
    if not rec:
        options = [{"value": f"{k}:{r['id']}", "label": f"{_EDITABLE[k][1]} · {r['name']}"} for k in wanted for r in everything[k] if r.get("id")][:60]
        if not options:
            return Done("There is nothing on record to change yet.", next_action="Ask me to add a customer, a supplier or a catalogue item and I'll save it.",
                        skipped=True, outcome={"reason": "nothing_on_record"})
        return WaitForInput("Which one should I change?", [{"key": "record", "label": "Record", "type": "choice", "required": True, "options": options}])
    collection, label, spec = _EDITABLE[kind]
    current = {"name": rec.get("name"), "email": rec.get("email") or "", "phone_number": rec.get("phone_number") or "", "payment_terms": rec.get("payment_terms") or "",
               "base_price": product_price(rec) if kind == "item" else "", "cost_of_sales": product_cost(rec) if kind == "item" else ""}
    if not any(f in a for f, _l, _t in spec):
        # What the request already says to change is filled in; everything else shows as it stands.
        email, amount = _EMAIL.search(text), _amount_in(text)
        if email and kind != "item":
            current["email"] = email.group(0).rstrip(".")
        if amount is not None and kind == "item":
            current["base_price"] = amount
        return WaitForInput(f"What should change on {rec['name']}?", [
            {"key": f, "label": lab, "type": typ, "required": f == "name", "default": current.get(f) if current.get(f) is not None else ""} for f, lab, typ in spec])
    name = str(a.get("name") or rec.get("name") or "").strip()
    email = str(a.get("email") or "").strip()
    if len(name) < 2 or (email and not valid_email(email)) or (kind == "item" and float(a.get("base_price") or 0) <= 0):
        return WaitForInput("That can't be saved: it needs a name" + (", and a price above 0." if kind == "item" else ", and a valid email address if you give one."), [
            {"key": f, "label": lab, "type": typ, "required": f == "name", "default": a.get(f, current.get(f)) or ""} for f, lab, typ in spec])
    now = ctx.now().isoformat()
    changed: list[str] = []

    def _apply(d: dict) -> None:
        target = bz.find((d.get("catalogue") or {}).get(collection) or [], rec["id"])
        if target is None:
            return
        for f, lab, typ in spec:
            if f not in a:
                continue
            value = (bz.money(a[f]) if f in ("base_price", "cost_of_sales") else int(float(a[f] or 0)) if typ == "number" and a[f] not in (None, "") else str(a[f] or "").strip())
            if value != target.get(f) and not (value in ("", 0) and not target.get(f)):
                target[f] = value
                changed.append(lab.split(" (")[0].lower())
        if changed:
            target["updated_at"] = now
    await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    if not changed:
        return Done(f"Nothing changed on {rec['name']}: it already says that.", outcome={"record": rec["id"]})
    return Done(f"Saved: {name}'s {' and '.join(changed) if len(changed) < 3 else ', '.join(changed[:-1]) + ' and ' + changed[-1]} "
                f"{'is' if len(changed) == 1 else 'are'} updated.", outcome={"record": rec["id"], "changed": changed, "links": [{"label": "Catalogue", "to": "/catalogue"}]})


async def marketplace_profile_step(ctx):
    a = ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    profile = (data.get("marketplace") or {}).get("profile") or {}
    about = (data.get("workspace_profile") or {}).get("about_company") or (data.get("workspace_profile") or {}).get("description") or ""
    if not a:
        return WaitForInput("Here is your Marketplace profile. Change what you'd like and confirm.", [
            {"key": "description", "label": "Description", "type": "textarea", "required": True, "default": profile.get("description") or about,
             **({"hint": "Taken from your business profile, because your Marketplace profile has no description yet."} if not profile.get("description") and about else {})},
            {"key": "service_area", "label": "Where you work", "type": "text", "default": profile.get("service_area") or ""},
            {"key": "website", "label": "Website", "type": "text", "default": profile.get("website") or ""}])
    description = str(a.get("description") or "").strip()[:2000]
    if len(description) < 10:
        return WaitForInput("The description needs at least a sentence.", [
            {"key": "description", "label": "Description", "type": "textarea", "required": True, "default": description}])
    now = ctx.now().isoformat()

    def _apply(d: dict) -> None:
        m = dict(d.get("marketplace") or {})
        p = dict(m.get("profile") or {})
        p.update({"description": description, **({"service_area": str(a["service_area"]).strip()[:2000]} if "service_area" in a else {}),
                  **({"website": str(a["website"]).strip()[:2000]} if "website" in a else {}),
                  "revision": int(p.get("revision") or 0) + 1, "updated_at": now, "updated_by": ctx.actor.email or ctx.actor.user_id})
        m["profile"] = p
        d["marketplace"] = m
    await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done("Saved: your Marketplace profile is updated.", outcome={"links": [{"label": "Marketplace profile", "to": "/marketplace/profile"}]})


async def marketplace_offering_step(ctx):
    text, a = _said(ctx), ctx.answers
    data = await ctx.rt.business.load(ctx.run["business_id"])
    products = [p for p in _products(data) if p.get("id") is not None]
    if not products:
        return Done("Your catalogue is empty, so there is nothing to list on the Marketplace yet.",
                    next_action="Ask me to add a catalogue item (its name and price) and I'll save it, then list it.", skipped=True, outcome={"reason": "no_catalogue"})
    if not a.get("product_id") or a.get("listing") not in ("list", "unlist"):
        named = _named(text, products)
        unlist = bool(re.search(r"\b(unlist|unpublish|remove|hide|take\b.*\boff|take\b.*\bdown)\b", text, re.I))
        return WaitForInput("Is this right?" if named else "Which offering, and should it be listed?", [
            {"key": "product_id", "label": "Offering", "type": "choice", "required": True, "default": str((named or {}).get("id") or ""), "confirm": bool(named),
             "options": [{"value": str(p["id"]), "label": f"{p['name']} · {'listed' if p.get('marketplace_listed', True) else 'not listed'}"} for p in products[:40]]},
            {"key": "listing", "label": "On the Marketplace", "type": "choice", "required": True, "default": "unlist" if unlist else "list",
             "options": [{"value": "list", "label": "List it"}, {"value": "unlist", "label": "Take it off"}]}])
    target = next((p for p in products if str(p["id"]) == str(a["product_id"])), None)
    if not target:
        return Done("That offering is no longer in your catalogue.", skipped=True, outcome={"reason": "not_found"})
    listed = a["listing"] == "list"

    def _apply(d: dict) -> None:
        for p in (d.get("catalogue") or {}).get("products") or []:
            if isinstance(p, dict) and str(p.get("id")) == str(target["id"]):
                p["marketplace_listed"] = listed
                p["updated_at"] = ctx.now().isoformat()
    await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return Done(f"Saved: {target['name']} is {'now listed on' if listed else 'no longer listed on'} the Marketplace.",
                outcome={"product_id": target["id"], "listed": listed, "links": [{"label": "Marketplace profile", "to": "/marketplace/profile"}]})


SUPPLIER_BILL = _record("supplier_bill", "Record a Supplier Bill", "Save the bill", supplier_bill_step)
ADD_VENDOR = _record("add_vendor", "Add a Supplier", "Save the supplier", add_vendor_step)
UPDATE_RECORD = _record("update_record", "Change a Customer, Supplier or Catalogue Item", "Save the change", update_record_step)
MARKETPLACE_PROFILE = _record("marketplace_profile", "Update the Marketplace Profile", "Save the profile", marketplace_profile_step)
MARKETPLACE_OFFERING = _record("marketplace_offering", "List or Unlist an Offering", "Save the listing", marketplace_offering_step)

MORE_WORKFLOWS = [NEW_PROPOSAL, NEW_PURCHASE_ORDER, CREDIT_NOTE, SUPPLIER_BILL, ADD_VENDOR, UPDATE_RECORD, MARKETPLACE_PROFILE, MARKETPLACE_OFFERING]
