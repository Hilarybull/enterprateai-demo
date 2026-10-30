"""Versioned workflow definitions (s5, s13 WorkflowDefinition).

Each step does one thing and may be re-entered after a wait, an approval or a
crash, so steps are written to be safe to repeat. Steps act only through
`ctx.call(tool, ...)`: the gateway applies the allowlist, permissions,
entitlements, approval binding and idempotency before anything happens.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import timedelta

from app.modules.agent import business as bz
from app.modules.agent import intent
from app.modules.agent.documents import fmt_money
from app.modules.agent.models import (
    A1_ASSIST, A3_EXECUTE_WITH_APPROVAL, Done, Next, StepDefinition, Stop, WaitForEvent, WaitForInput,
    WorkflowDefinition, payload_hash,
)
from app.modules.agent.tools import ToolStop, similar_names, valid_email

logger = logging.getLogger(__name__)

_ENQUIRY_LABELS = {
    "quotation_request": "A request for a quotation",
    "proposal_request": "A request for a proposal",
    "complaint": "A complaint",
    "general_enquiry": "A general enquiry",
}


# ══ Phase 1: Enquiry-to-Quote (s15) ═══════════════════════════════════════════

async def e2q_classify(ctx):
    enquiry = await ctx.enquiry()
    cls = ctx.answers.get("classification") or ctx.state.get("classification")
    method = "user"
    if ctx.params.get("rfq"):
        # A marketplace request is a request for a quotation by definition: nothing to work out.
        # The one exception is a message that plainly says otherwise, and then the owner decides.
        if not cls:
            reads_like = {"complaint": "a complaint", "proposal_request": "a request for a proposal"}.get(
                ctx.params.get("classification_doubt"), "something else")
            return WaitForInput(
                f"This came through the Marketplace as a request for a quotation, but the buyer's message reads like {reads_like}. "
                "How should I treat it?",
                [{"key": "classification", "label": "This request is", "type": "choice", "required": True,
                  "options": [{"value": k, "label": v} for k, v in _ENQUIRY_LABELS.items()]}])
        if not ctx.answers.get("classification"):
            method = "marketplace_rfq"
    elif not cls:
        cls, method = await ctx.classify_enquiry(enquiry.get("body") or "")
    if cls == "uncertain":
        return WaitForInput("I couldn't tell what this enquiry is asking for. How should I treat it?", [{
            "key": "classification", "label": "This enquiry is", "type": "choice",
            "options": [{"value": k, "label": v} for k, v in _ENQUIRY_LABELS.items()],
        }])
    ctx.state["classification"] = cls
    ctx.state["classification_method"] = method
    await ctx.rt.store.update_enquiry(enquiry["id"], {"classification": cls, "status": "classified"})
    ctx.note(f"Classified the enquiry as: {_ENQUIRY_LABELS.get(cls, cls).lower()}.")
    if cls == "complaint":
        return Done("This is a complaint, not a sales enquiry, so I did not prepare a quotation.",
                    next_action="Review the message and reply to the customer yourself.", skipped=True)
    if cls == "proposal_request":
        return Done("This is a request for a proposal rather than a quotation, so I did not price it as one.",
                    next_action="Ask me for a proposal for this customer and I'll prepare it for your approval.", skipped=True)
    if cls == "general_enquiry":
        return Done("This is a general enquiry with nothing to quote for.",
                    next_action="Reply to the customer yourself.", skipped=True)
    return Next()


async def _customer_in_request(ctx, enquiry: dict) -> dict | None:
    """The owner's own request may name a customer already on record ("quote Frank for…")."""
    a = ctx.answers
    if ctx.state.get("customer") or ctx.params.get("rfq") or enquiry.get("source") != "user_request" or enquiry.get("sender_email"):
        return None
    if a.get("customer_id") or a.get("customer_name") or a.get("customer_email"):
        return None
    return (await ctx.call("search_customer", text=enquiry.get("body") or "")).get("named")


async def _rest_of_the_quotation(ctx, enquiry: dict) -> list[dict]:
    """Whatever else the quotation still needs, so it is asked for with the customer in one go:
    the items (unless the request already names priced catalogue items) and the VAT rate
    (only when no default is set)."""
    fields: list[dict] = []
    if not ctx.params.get("rfq") and not ctx.answers.get("items"):
        products = (await ctx.call("read_catalogue"))["products"]
        by_id = {str(p["id"]): p for p in products}
        found = intent.match_items(enquiry.get("body") or "", products)
        if not found or any(not by_id.get(str(m["product_id"]), {}).get("unit_price") for m in found):
            fields.append({
                "key": "items", "label": "Items", "type": "line_items", "required": True,
                "catalogue": [{"id": p["id"], "name": p["name"], "unit_price": p["unit_price"]} for p in products],
                "suggested": [{"product_id": m["product_id"], "name": m["name"], "quantity": m["quantity"],
                               "unit_price": by_id.get(str(m["product_id"]), {}).get("unit_price") or ""} for m in found]
                # Described before sign-up and not in the catalogue: offered as written, for the owner to confirm.
                or ([{"product_id": None, "name": str(said["name"]), "quantity": said.get("quantity") or 1, "unit_price": said.get("unit_price") or ""}]
                    if isinstance((said := (ctx.params.get("prefill") or {}).get("item")), dict) and said.get("name") else []),
                "vat_rate": ctx.policy.get("default_vat_rate")})
            # Filled in from Agent settings, there to change: nothing here has to be typed.
            validity = int(ctx.policy.get("quote_validity_days") or 30)
            fields += [{"key": "discount", "label": "Discount", "type": "discount"},
                       {"key": "valid_until", "label": "Valid until", "type": "date", "default": (ctx.now() + timedelta(days=validity)).date().isoformat()},
                       {"key": "notes", "label": "Notes to the customer", "type": "textarea"}]
    if ctx.policy.get("default_vat_rate") is None and "vat_rate" not in ctx.answers:
        fields.append({"key": "vat_rate", "label": "VAT rate (%)", "type": "number", "required": True, "default": 0,
                       "hint": "Enter 0 if you don't charge VAT. Set a default in Agent settings to skip this question."})
    return fields


async def _ask_who_and_what(ctx, enquiry: dict, name: str = "", email: str = ""):
    """One form for everything still missing: the customer (picked from those on record, or a new
    one), then the items and the VAT rate where they are needed too."""
    everyone = (await ctx.call("search_customer", all=True))["all"]
    only_new = {"show_if": {"customer_id": "new"}} if everyone else {}
    fields: list[dict] = []
    if everyone:
        fields.append({"key": "customer_id", "label": "Customer", "type": "customer", "required": True, "new_label": "+ New customer",
                       "options": [{"value": c["id"], "label": c["name"], "email": c.get("email") or ""} for c in everyone]})
    fields += [{"key": "customer_name", "label": "Customer name", "type": "text", "required": True, "default": name, **only_new},
               {"key": "customer_email", "label": "Customer email", "type": "email", "required": True, "default": email, **only_new}]
    rest = await _rest_of_the_quotation(ctx, enquiry)
    asks_items = any(f["key"] == "items" for f in rest)
    return WaitForInput("Who is this quotation for, and what should it include?" if asks_items else "Who is this quotation for?", fields + rest)


async def e2q_customer(ctx):
    enquiry = await ctx.enquiry()
    a = ctx.answers
    if a.get("customer_id") and a["customer_id"] != "new":
        c = (await ctx.call("read_customer", customer_id=a["customer_id"]))["customer"]
        ctx.state["customer"] = {"id": c["id"], "name": c["name"], "email": c.get("email") or "", "new": False, "source": "customer_record"}
    elif (named := await _customer_in_request(ctx, enquiry)):
        ctx.state["customer"] = {"id": named["id"], "name": named["name"], "email": named.get("email") or "", "new": False, "source": "customer_record"}
    elif not ctx.state.get("customer") or a.get("customer_id") == "new" or a.get("customer_name") or a.get("customer_email"):
        # A marketplace request names its buyer in its own fields; its text is never mined for one.
        rfq = ctx.params.get("rfq") or {}
        found_in_text = {"name": None, "email": None} if rfq else intent.extract_contact(enquiry.get("body") or "")
        if rfq.get("contact_name"):
            ctx.state["customer_contact"] = rfq["contact_name"]
        given = {"name": str(enquiry.get("sender_name") or "").strip(), "email": str(enquiry.get("sender_email") or "").strip()}
        confirmed = bool(a.get("customer_name") or a.get("customer_email"))
        name = str(a.get("customer_name") or given["name"] or found_in_text["name"] or "").strip()
        email = str(a.get("customer_email") or given["email"] or found_in_text["email"] or "").strip()
        # Details read from the enquiry text are a suggestion: pre-filled, and confirmed by the
        # user before they're used (s15.4). Details the user or the sender form supplied are used as given.
        from_text = not confirmed and ((not given["name"] and found_in_text["name"]) or (not given["email"] and found_in_text["email"]))
        if found_in_text.get("person"):
            ctx.state["customer_contact"] = found_in_text["person"]
        if from_text or (not confirmed and len(name) < 2):
            if not from_text:
                return await _ask_who_and_what(ctx, enquiry, name, email)
            ctx.state["customer_suggestion"] = {"name": name, "email": email, "source": "enquiry_text"}
            return WaitForInput(
                "I found these customer details in the enquiry. Please confirm who the quotation is for.",
                [{"key": "customer_name", "label": "Customer name", "type": "text", "required": True, "default": name,
                  **({"hint": "Read from the enquiry text"} if from_text and name else {})},
                 {"key": "customer_email", "label": "Customer email", "type": "email", "required": True, "default": email,
                  **({"hint": "Read from the enquiry text"} if from_text and email else {})},
                 # QA U3: the rest of the quotation in the same dialog, so the task asks each thing once, in one go.
                 *(await _rest_of_the_quotation(ctx, enquiry))])
        found = await ctx.call("search_customer", name=name, email=email)
        c = found["exact"]
        # The address is on record under a different name (a colleague at the same firm, a shared
        # inbox, a new trading name). A quotation is never addressed to a name the buyer didn't
        # give unless the owner says so.
        other_name = bool(c and name and str(c.get("name") or "").strip().lower() != name.lower()
                          and not similar_names(name, str(c.get("name") or "")))
        if c and other_name and a.get("customer_id") != "new":
            return WaitForInput(
                f"{name} wrote from {email or 'an address'} that is on record for {c['name']}. Use {c['name']}, or create {name}?", [{
                    "key": "customer_id", "label": "Customer", "type": "choice", "required": True,
                    "options": [{"value": c["id"], "label": f"Use {c['name']}"},
                                {"value": "new", "label": f"Create {name} as a new customer"}]}])
        if c and not other_name:
            ctx.state["customer"] = {"id": c["id"], "name": c["name"], "email": c.get("email") or email, "new": False, "source": "customer_record"}
        elif c:
            # The owner chose a new customer: a separate record, even though the address is shared.
            ctx.state["customer"] = {"id": None, "name": name, "email": email, "new": True, "distinct": True, "source": "user_confirmed"}
        elif found["potential"] and a.get("customer_id") != "new":
            return WaitForInput(f"Is {name or 'this customer'} one of your existing customers?", [{
                "key": "customer_id", "label": "Customer", "type": "choice",
                "options": [{"value": c["id"], "label": f"{c['name']}{' · ' + c['email'] if c.get('email') else ''}"} for c in found["potential"]]
                + [{"value": "new", "label": f"No, create a new customer{': ' + name if name else ''}"}],
            }])
        else:
            if len(name) < 2:
                return await _ask_who_and_what(ctx, enquiry, name, email)
            ctx.state["customer"] = {"id": None, "name": name, "email": email, "new": True,
                                     "source": "user_confirmed" if confirmed else "enquiry_sender"}
    customer = ctx.state["customer"]
    if not valid_email(customer.get("email")):
        if valid_email(a.get("customer_email")):
            customer["email"] = a["customer_email"].strip()
        elif not a.get("email_later"):      # "I'll add it later": drafted now, the address is asked for when it is sent
            return WaitForInput(f"I need an email address to send the quotation to {customer['name']}.", [
                {"key": "customer_email", "label": "Customer email", "type": "email", "required": True},
                *(await _rest_of_the_quotation(ctx, enquiry))])
    ctx.note(("New customer to be created: " if customer["new"] else "Matched existing customer: ") + customer["name"] + ".")
    return Next()


async def e2q_items(ctx):
    enquiry = await ctx.enquiry()
    products = (await ctx.call("read_catalogue"))["products"]
    by_id = {str(p["id"]): p for p in products}
    priced: list[dict] = []
    unmatched: list[dict] = []
    if isinstance(ctx.answers.get("items"), str) and ctx.answers["items"].strip():
        # Typed as words in one box ("3 x office deep clean at \u00a3150 each"): read into lines, never dropped.
        # Without this the items asked with the customer were asked again here as "Items to quote".
        ctx.answers["items"] = intent.lines_in_text(ctx.answers["items"], products)

    if isinstance(ctx.answers.get("items"), list) and ctx.answers["items"]:
        # Explicit answers from an authorised user: catalogue items keep the catalogue price,
        # custom lines carry the price the user typed.
        for it in ctx.answers["items"]:
            qty = max(1, int(float(it.get("quantity") or 1)))
            # A line typed by name ("end of tenancy clean") is the catalogue item it names, whatever the case (QA R12d).
            p = by_id.get(str(it.get("product_id") or "")) or (intent.catalogue_item_named(it.get("name"), products) if it.get("name") else None)
            typed = float(it.get("unit_price") or 0)
            if p and p["unit_price"] > 0 and (not typed or abs(typed - float(p["unit_price"])) < 0.005):
                priced.append({"product_id": p["id"], "name": p["name"], "quantity": qty, "unit_price": p["unit_price"],
                               "unit_cost": p["unit_cost"], "price_source": "catalogue"})
            elif float(it.get("unit_price") or 0) > 0 and str(it.get("name") or (p or {}).get("name") or "").strip():
                priced.append({"product_id": (p or {}).get("id"), "name": str(it.get("name") or p["name"]).strip(), "quantity": qty,
                               "unit_price": float(it["unit_price"]), "unit_cost": (p or {}).get("unit_cost", 0),
                               "price_source": "user_confirmed"})
            elif str(it.get("name") or "").strip():
                unmatched.append({"name": str(it["name"]).strip(), "quantity": qty})
    else:
        asked = (ctx.params.get("rfq") or {}).get("items")
        if asked is not None:
            # A marketplace request lists what the buyer chose from the listing. Each line is priced
            # only when it names a catalogue item exactly; anything else is asked about.
            by_name = {str(p.get("name") or "").strip().lower(): p for p in products}
            matched = []
            for it in asked:
                p = by_name.get(str(it["name"]).strip().lower())
                same = next((m for m in matched if p and m["product_id"] == p["id"]), None)
                if same:
                    same["quantity"] += it["quantity"]
                elif p:
                    matched.append({"product_id": p["id"], "name": p["name"], "quantity": it["quantity"], "provenance": "marketplace_rfq"})
                else:
                    unmatched.append({"name": it["name"], "quantity": it["quantity"]})
        else:
            matched = intent.match_items(enquiry.get("body") or "", products)
            if not matched:
                candidates = await ctx.extract_items(enquiry.get("body") or "")
                matched, unmatched = intent.match_candidates(candidates, products)
        # A price the request itself states ("20 car washes at ₦15,000 each") is the owner's: it prices a line whose
        # catalogue item has no price yet, and a line not in the catalogue (QA, 16 Oct). Never a guess.
        stated = intent.price_in_request(enquiry.get("body") or "")
        if not matched and not unmatched:
            # Nothing read from the request by the readers above: its one plain line ("20 car washes at ₦15,000 each"),
            # the catalogue item it names when there is one.
            line = intent.line_in_request(enquiry.get("body") or "")
            if line:
                hit = intent.catalogue_item_named(line["name"], products)
                (matched if hit else unmatched).append({**line, **({"product_id": hit["id"], "name": hit["name"]} if hit else {})})
        lines = matched + unmatched
        if stated and len(lines) == 1 and not lines[0].get("unit_price"):
            lines[0]["unit_price"] = stated
        still = []
        for m in matched:
            p = by_id.get(str(m["product_id"]))
            if p and p["unit_price"] > 0:
                priced.append({"product_id": p["id"], "name": p["name"], "quantity": m["quantity"], "unit_price": p["unit_price"],
                               "unit_cost": p["unit_cost"], "price_source": "catalogue", "provenance": m.get("provenance")})
            elif m.get("unit_price"):
                priced.append({"product_id": (p or {}).get("id"), "name": m["name"], "quantity": m["quantity"], "unit_price": float(m["unit_price"]),
                               "unit_cost": (p or {}).get("unit_cost", 0), "price_source": "user_confirmed", "provenance": "said_in_request"})
            else:
                still.append({"name": m["name"], "quantity": m["quantity"]})
        for u in unmatched:
            if u.get("unit_price") and str(u.get("name") or "").strip():
                priced.append({"product_id": None, "name": str(u["name"]).strip(), "quantity": u["quantity"], "unit_price": float(u["unit_price"]),
                               "unit_cost": 0, "price_source": "user_confirmed", "provenance": "said_in_request"})
            else:
                still.append(u)
        unmatched = still

    if not priced or unmatched:
        # Never invent a price or a line item: ask (s15.3, AC-08).
        why = ("I couldn't find an approved price for: " + ", ".join(str(u["name"]) for u in unmatched) + "."
               if unmatched else "I couldn't tell which of your products or services to quote for.")
        return WaitForInput(why + " Choose the items and quantities to quote.", [{
            "key": "items", "label": "Items to quote", "type": "line_items", "required": True,
            "catalogue": [{"id": p["id"], "name": p["name"], "unit_price": p["unit_price"]} for p in products],
            "suggested": [{"product_id": i.get("product_id"), "name": i["name"], "quantity": i["quantity"], "unit_price": i["unit_price"]} for i in priced]
            + [{"product_id": None, "name": u["name"], "quantity": u["quantity"], "unit_price": ""} for u in unmatched],
        }])
    ctx.state["items"] = priced
    ctx.note(pricing_note(priced))
    await ctx.orch._audit(ctx.run, "items_priced", ctx.actor.user_id, {"lines": [
        {"name": i["name"], "quantity": i["quantity"], "unit_price": i["unit_price"], "price_source": i["price_source"]} for i in priced]})
    return Next()


TERMS_FROM_SETTINGS = "from your default settings"      # said beside the terms on the draft (QA P2-4)

_PRICE_SOURCE_TEXT = {
    "catalogue": "your catalogue price",
    "user_confirmed": "the price you entered",
    "user_edited": "the price you entered when editing the draft",
}


def pricing_note(items: list[dict]) -> str:
    """One sentence on what was priced and where each price came from (s22, AC-15)."""
    groups: dict[str, list[str]] = {}
    for i in items:
        groups.setdefault(i.get("price_source") or "unknown", []).append(f"{i['quantity']} × {i['name']}")
    parts = [f"{', '.join(lines)} at {_PRICE_SOURCE_TEXT.get(src, 'a price of unknown origin')}" for src, lines in groups.items()]
    return "Priced " + "; ".join(parts) + "."


async def e2q_draft(ctx):
    vat = ctx.policy.get("default_vat_rate")
    if "vat_rate" in ctx.answers:
        vat = float(ctx.answers["vat_rate"] or 0)
    if vat is None:
        # Tax is a required commercial fact: it is asked for, never assumed.
        return WaitForInput("What VAT rate should this quotation use?", [{
            "key": "vat_rate", "label": "VAT rate (%)", "type": "number", "required": True, "default": 0,
            "hint": "Enter 0 if you don't charge VAT. Set a default in Agent settings to skip this question.",
        }])
    edit = ctx.state.pop("pending_edit", None)
    if edit and ctx.state.get("quote_id"):
        patch = {k: v for k, v in edit.items() if k in ("items", "vat_rate", "notes", "customer_email", "customer_id", "customer_name", "valid_until", "payment_terms", "discount")}
        res = await ctx.call("update_quotation_draft", quote_id=ctx.state["quote_id"], patch=patch)
        if "items" in patch:
            ctx.state["items"] = patch["items"]
            ctx.note(pricing_note(patch["items"]))
        ctx.note(f"Updated draft {ctx.state.get('quote_reference') or ''} ({', '.join(res['updated'])}); it needs approving again.")
        return Next()
    customer = ctx.state["customer"]
    if customer.get("new") and not customer.get("id"):
        created = await ctx.call("create_customer_draft", name=customer["name"], email=customer.get("email") or "",
                                 **({"distinct": True} if customer.get("distinct") else {}))
        customer["id"] = created["customer_id"]
    enquiry = await ctx.enquiry()
    draft = await ctx.call(
        "create_quotation_draft",
        customer={"id": customer["id"], "name": customer["name"], "email": customer.get("email") or "",
                  "contact_name": ctx.state.get("customer_contact") or ""},
        items=ctx.state["items"], vat_rate=vat, enquiry_id=enquiry["id"],
        **({"rfq_id": ctx.state["rfq_id"]} if ctx.state.get("rfq_id") else {}),      # the draft answers this marketplace request
        validity_days=ctx.policy.get("quote_validity_days"),
        payment_terms=f"Net {int(ctx.policy.get('default_payment_terms_days') or 14)} days",
        payment_terms_source=TERMS_FROM_SETTINGS,
    )
    ctx.state["quote_id"] = draft["quote_id"]
    ctx.state["quote_reference"] = draft.get("reference")
    # What the owner set in the form beyond the items: a discount, another valid-until date, a note.
    extras = {}
    given = ctx.answers.get("discount")
    if isinstance(given, dict) and float(given.get("value") or 0) > 0:
        extras["discount"] = {"type": "percent" if given.get("type") == "percent" else "amount", "value": float(given["value"])}
    if str(ctx.answers.get("valid_until") or "").strip():
        extras["valid_until"] = str(ctx.answers["valid_until"])[:10]
    if str(ctx.answers.get("notes") or "").strip():
        extras["notes"] = str(ctx.answers["notes"]).strip()[:2000]
    if extras and not ctx.state.get("form_extras_applied"):
        await ctx.call("update_quotation_draft", quote_id=draft["quote_id"], patch=extras)
        ctx.state["form_extras_applied"] = True
    await ctx.rt.store.update_enquiry(enquiry["id"], {"status": "quoted", "run_id": ctx.run["id"]})
    ctx.note(f"Prepared draft quotation {draft.get('reference')}.")
    return Next()


async def e2q_send(ctx):
    sent = await ctx.call("send_quotation", quote_id=ctx.state["quote_id"])
    return Done(
        f"Quotation {sent['reference']} was sent to {sent['sent_to']}.",
        next_action="When the customer accepts, ask me to turn it into an invoice.",
        outcome={"quote_id": ctx.state["quote_id"], "reference": sent["reference"], "sent_to": sent["sent_to"],
                 "message_id": sent.get("message_id")},
    )


ENQUIRY_TO_QUOTE = WorkflowDefinition(
    workflow_key="enquiry_to_quote", version=1, capability="enquiry_to_quote", family="Sell & Revenue",
    title="Enquiry to Quote", autonomy=A3_EXECUTE_WITH_APPROVAL,
    steps=[
        StepDefinition("classify", "Classify the enquiry", e2q_classify),
        StepDefinition("customer", "Match the customer", e2q_customer),
        StepDefinition("items", "Price the items", e2q_items),
        StepDefinition("draft", "Prepare the quotation", e2q_draft),
        StepDefinition("send", "Send the quotation", e2q_send),
    ],
    tools=("read_customer", "search_customer", "create_customer_draft", "read_catalogue", "read_price",
           "create_quotation_draft", "update_quotation_draft", "read_quotation_status", "send_quotation"),
    triggers=("text", "ui_action", "api", "business_event", "voice", "marketplace_rfq"),
    success_condition="Quotation sent to the customer and delivery confirmed by the provider.",
)


# ══ Phase 2: Quote-to-Cash (s16) ══════════════════════════════════════════════

_NEVER_SENT = ("draft", "pending_approval", "awaiting_approval", "new")


async def q2c_acceptance(ctx):
    q = await ctx.call("read_quotation_status", quote_id=ctx.state["quote_id"])
    ctx.state["quote_reference"] = q.get("reference")
    if q["status"] in _NEVER_SENT and not ctx.answers.get("unsent_quote"):
        # B7: a quotation the customer was never sent can't have been accepted through it: say so, and offer both ways on.
        ref = q.get("reference") or "This quotation"
        return WaitForInput(f"{ref} was never sent to the customer. Should I send it now, or mark it as accepted (they agreed another way)?", [
            {"key": "unsent_quote", "label": "What should happen", "type": "choice", "required": True,
             "options": [{"value": "send", "label": "Send it to the customer"}, {"value": "accepted", "label": "Mark it as accepted"},
                         {"value": "no", "label": "Neither, not yet"}]}])
    if q["status"] in _NEVER_SENT:
        choice = ctx.answers.get("unsent_quote")
        if choice == "send":
            sent = await ctx.call("send_quotation", quote_id=ctx.state["quote_id"])
            return Done(f"Quotation {sent['reference']} was sent to {sent['sent_to']}.",
                        next_action="When the customer accepts, tell me and I'll turn it into an invoice.",
                        outcome={"quote_id": ctx.state["quote_id"], "reference": sent["reference"], "sent_to": sent["sent_to"]})
        if choice == "no":
            return Done("Nothing was sent or invoiced. The quotation is still a draft.", next_action="Ask me again when it should go out.", skipped=True)
        ctx.answers["confirm_acceptance"] = "yes"      # accepted another way, said by the owner
    if q["status"] not in ("accepted", "won"):
        answer = ctx.answers.get("confirm_acceptance")
        if answer == "yes":
            # Explicit confirmation by an authorised user: a trusted acceptance (s16.1).
            await ctx.call("record_quotation_acceptance", quote_id=ctx.state["quote_id"])
        elif answer == "no":
            return Done("The quotation has not been accepted, so nothing was invoiced.",
                        next_action="Ask me again once the customer accepts.", skipped=True)
        else:
            return WaitForInput(
                f"Quotation {q.get('reference') or ''} is not marked as accepted. "
                "I can only invoice once acceptance is confirmed. Has the customer accepted it?",
                [{"key": "confirm_acceptance", "label": "Customer has accepted", "type": "choice", "required": True,
                  "options": [{"value": "yes", "label": "Yes, the customer accepted"}, {"value": "no", "label": "No, not yet"}]}])
        q = await ctx.call("read_quotation_status", quote_id=ctx.state["quote_id"])
    # Snapshot of the accepted commercial version carried downstream as lineage (AC-21).
    ctx.state["accepted_version"] = payload_hash("accepted_quotation", {"quote_id": q["quote_id"], "total": q["total"]})[:16]
    ctx.state["accepted_total"] = q["total"]
    ctx.note(f"Acceptance of quotation {q.get('reference')} confirmed.")
    return Next()


async def q2c_route(ctx):
    route = ctx.answers.get("route") or ctx.state.get("route") or ctx.policy.get("contract_route")
    if route not in ("direct_invoice", "contract_first"):
        # The Agent must not invent a contract requirement (s16.2).
        return WaitForInput("Should this go straight to an invoice, or does it need a contract first?", [{
            "key": "route", "label": "Next step", "type": "choice", "required": True,
            "options": [{"value": "direct_invoice", "label": "Invoice directly"},
                        {"value": "contract_first", "label": "Contract first, then invoice"}],
            "hint": "Set a default in Agent settings to skip this question.",
        }])
    ctx.state["route"] = route
    return Next("contract_draft" if route == "contract_first" else "invoice_draft")


async def q2c_contract_draft(ctx):
    c = await ctx.call("create_contract_draft", quote_id=ctx.state["quote_id"], accepted_version=ctx.state.get("accepted_version"))
    ctx.state["contract_id"] = c["contract_id"]
    ctx.note(f"Prepared draft contract {c.get('reference')}.")
    return Next()


async def q2c_contract_send(ctx):
    status = await ctx.call("read_contract_status", contract_id=ctx.state["contract_id"])
    if status["status"] in ("pending", "signed"):
        return Next()      # already sent in an earlier attempt
    sent = await ctx.call("send_contract", contract_id=ctx.state["contract_id"])
    ctx.note(f"Contract {sent['reference']} sent to {sent['sent_to']}.")
    return Next()


async def q2c_contract_wait(ctx):
    status = await ctx.call("read_contract_status", contract_id=ctx.state["contract_id"])
    if status["status"] != "signed":
        if ctx.answers.pop("contract_signed", None) == "yes":
            await ctx.call("record_contract_acceptance", contract_id=ctx.state["contract_id"])
        elif status["status"] in ("rejected", "cancelled", "canceled", "terminated"):
            return Stop("contract_inconsistency", f"The contract is {status['status']}, so I stopped before invoicing.")
        else:
            return WaitForEvent(
                "Waiting for the customer to sign the contract.",
                wake_at=ctx.now() + timedelta(days=1),
                question="Has the customer signed the contract?",
                fields=[{"key": "contract_signed", "label": "Contract signed", "type": "choice",
                         "options": [{"value": "yes", "label": "Yes, it is signed"}]}],
            )
    ctx.note("Contract signed.")
    return Next()


async def q2c_invoice_draft(ctx):
    q = await ctx.call("read_quotation_status", quote_id=ctx.state["quote_id"])
    if q["status"] not in ("accepted", "won"):
        return Stop("source_state_changed", f"The quotation is now {q['status']}, so I stopped before invoicing.")
    if not ctx.state.get("invoice_id") and abs(float(q["total"]) - float(ctx.state.get("accepted_total") or q["total"])) > 0.005:
        return Stop("changed_commercial_terms",
                    f"The quotation total changed from {fmt_money(ctx.state['accepted_total'], q.get('currency') or 'GBP')} "
                    f"to {fmt_money(q['total'], q.get('currency') or 'GBP')} after it was accepted. "
                    "Confirm the new terms with the customer, then start again.")
    inv = await ctx.call("create_invoice_draft", quote_id=ctx.state["quote_id"], contract_id=ctx.state.get("contract_id"),
                         accepted_version=ctx.state.get("accepted_version"))
    ctx.state["invoice_id"] = inv["invoice_id"]
    ctx.state["invoice_reference"] = inv.get("reference")
    ctx.note(f"Prepared draft invoice {inv.get('reference')}." if inv.get("created") else f"Using existing invoice {inv.get('reference')}.")
    return Next()


async def q2c_invoice_send(ctx):
    status = await ctx.call("read_invoice_status", invoice_id=ctx.state["invoice_id"])
    if status["status"] != "draft":
        return Next()      # already issued
    sent = await ctx.call("send_invoice", invoice_id=ctx.state["invoice_id"])
    ctx.note(f"Invoice {sent['reference']} sent to {sent['sent_to']}.")
    return Next()


def _unreceipted(payments: list[dict]) -> dict | None:
    return next((p for p in payments if not (p.get("receipt") or {}).get("sent_at")), None)


async def q2c_monitor(ctx):
    ps = await ctx.call("read_payment_status", invoice_id=ctx.state["invoice_id"])
    if ps["overpaid"]:
        return Stop("payment_amount_mismatch", "More has been received than the invoice total. Decide how to treat the overpayment.")
    if _unreceipted(ps["payments"]):
        return Next("receipt")
    if ps["fully_paid"]:
        return Next("close")
    if ps.get("hold"):
        # Disputed, voided, cancelled or credited: pause, never chase (s16.6, s16.9).
        return Stop(f"invoice_{ps['hold']['state']}", bz.hold_message(ps["hold"]))
    reason = ps["block_reason"]
    cadence = list((ctx.policy.get("reminders") or {}).get("cadence_days_overdue") or [3, 10, 21])
    max_reminders = min(int((ctx.policy.get("reminders") or {}).get("max_reminders") or 3), len(cadence))
    info = await ctx.call("read_invoice_status", invoice_id=ctx.state["invoice_id"])
    sent = int(info["reminders_sent"])      # from the invoice record, not from memory
    tomorrow = ctx.now() + timedelta(days=1)
    waiting = "Invoice sent. Waiting for payment."
    if ps["received"] > 0 and ps["outstanding"] > 0:
        from app.modules.agent.documents import fmt_money
        waiting = f"{fmt_money(ps['outstanding'], ps.get('currency') or 'GBP')} outstanding. Waiting for the remaining payment."
    if reason in ("invoice_not_overdue", "invoice_no_due_date"):
        return WaitForEvent(waiting, wake_at=tomorrow)
    if reason:
        # Disputed, voided, cancelled, credited...: pause, never chase (s16.6, s16.9).
        return Stop(reason, f"I paused follow-up on this invoice: {reason.replace('_', ' ')}.")
    if sent >= max_reminders:
        return Stop("reminders_exhausted", f"{sent} reminders have been sent and the invoice is still unpaid. This needs your attention.")
    from app.modules.agent.business import parse_day
    days_overdue = (ctx.now().date() - parse_day(info["due_date"])).days
    if days_overdue >= int(cadence[sent]):
        not_before = bz._moment(info.get("next_reminder_at"))
        if not_before and ctx.now() < not_before:
            # Minimum interval since the last reminder, whatever thresholds have passed.
            return WaitForEvent(f"{waiting} The next reminder can go from {not_before.strftime('%d %b %Y').lstrip('0')}.",
                                wake_at=min(tomorrow, not_before) if not_before > ctx.now() else tomorrow)
        ctx.state["reminder_stage"] = sent + 1
        return Next("reminder")
    prefix = f"{waiting} " if ps["received"] > 0 else ""
    return WaitForEvent(f"{prefix}Invoice is {days_overdue} day(s) overdue. Next reminder at {cadence[sent]} days.", wake_at=tomorrow)


async def q2c_reminder(ctx):
    stage = int(ctx.state.get("reminder_stage") or 1)
    try:
        await ctx.call("prepare_payment_reminder", invoice_id=ctx.state["invoice_id"], stage=stage)
        sent = await ctx.call("send_payment_reminder", invoice_id=ctx.state["invoice_id"], stage=stage)
    except ToolStop as stop:
        if stop.reason_code in ("invoice_paid", "invoice_not_overdue"):
            ctx.note("Reminder suppressed: the invoice is no longer overdue.")
            return Next("monitor")
        if stop.reason_code == "reminder_too_soon":
            ctx.note(stop.message)
            return Next("monitor")
        raise
    ctx.note(f"Reminder {stage} sent to {sent['sent_to']}.")
    return Next("monitor")


async def q2c_receipt(ctx):
    ps = await ctx.call("read_payment_status", invoice_id=ctx.state["invoice_id"])
    payment = _unreceipted(ps["payments"])
    if not payment:
        return Next("monitor")
    if not (payment.get("receipt") or {}).get("number"):      # one receipt per payment, created once
        made = await ctx.call("create_receipt", invoice_id=ctx.state["invoice_id"], payment_id=payment["id"])
        if made.get("already_sent"):      # its record had been lost; the customer already has it
            ctx.note(f"Receipt {made['receipt_number']} was already sent to {made.get('sent_to') or 'the customer'}. Its record has been restored.")
            return Next("monitor")
    sent = await ctx.call("send_receipt", invoice_id=ctx.state["invoice_id"], payment_id=payment["id"])
    ctx.note(f"Receipt {sent['receipt_number']} sent to {sent['sent_to']}.")
    return Next("monitor")


async def q2c_close(ctx):
    ps = await ctx.call("read_payment_status", invoice_id=ctx.state["invoice_id"])
    if not ps["fully_paid"] or _unreceipted(ps["payments"]):
        return Next("monitor")      # closure only when settled and receipted (AC-27)
    return Done(
        f"Invoice {ctx.state.get('invoice_reference') or ''} is paid in full and receipted. This sale is closed.",
        outcome={"quote_id": ctx.state["quote_id"], "contract_id": ctx.state.get("contract_id"),
                 "invoice_id": ctx.state["invoice_id"], "received": ps["received"]},
    )


QUOTE_TO_CASH = WorkflowDefinition(
    workflow_key="quote_to_cash", version=1, capability="quote_to_cash", family="Sell & Revenue",
    title="Quote to Cash", autonomy=A3_EXECUTE_WITH_APPROVAL,
    steps=[
        StepDefinition("acceptance", "Confirm quotation acceptance", q2c_acceptance),
        StepDefinition("route", "Choose contract or direct invoice", q2c_route),
        StepDefinition("contract_draft", "Prepare the contract", q2c_contract_draft),
        StepDefinition("contract_send", "Send the contract", q2c_contract_send),
        StepDefinition("contract_wait", "Wait for the contract to be signed", q2c_contract_wait),
        StepDefinition("invoice_draft", "Prepare the invoice", q2c_invoice_draft),
        StepDefinition("invoice_send", "Send the invoice", q2c_invoice_send),
        StepDefinition("monitor", "Monitor payment", q2c_monitor),
        StepDefinition("reminder", "Follow up on payment", q2c_reminder),
        StepDefinition("receipt", "Send the receipt", q2c_receipt),
        StepDefinition("close", "Close the sale", q2c_close),
    ],
    tools=("read_quotation_status", "record_quotation_acceptance", "send_quotation", "create_contract_draft", "send_contract",
           "read_contract_status", "record_contract_acceptance", "create_invoice_draft", "send_invoice",
           "read_invoice_status", "read_payment_status", "prepare_payment_reminder", "send_payment_reminder",
           "create_receipt", "send_receipt"),
    triggers=("text", "ui_action", "api", "business_event", "voice"),
    success_condition="Invoice fully paid from a trusted source and every payment receipted.",
)


# ══ Payment Collection (Phase 2 capability) ═══════════════════════════════════

def _skipped(ctx, reason: str, message: str | None = None, info: dict | None = None):
    """The follow-up ends without sending: succeeded, with nothing done, and says why."""
    text = message if (message and message.startswith("No reminder sent")) else bz.skip_text(
        reason, ctx.state.get("invoice_reference"), last=(info or {}).get("last_reminder_at"), not_before=(info or {}).get("next_reminder_at"))
    return Done(text, skipped=True, outcome={"skipped": True, "reason": reason, "invoice_id": ctx.state["invoice_id"]})


async def pf_check(ctx):
    ps = await ctx.call("read_payment_status", invoice_id=ctx.state["invoice_id"])
    info = await ctx.call("read_invoice_status", invoice_id=ctx.state["invoice_id"])
    ctx.state["invoice_reference"] = info.get("reference")
    if ps.get("hold"):
        # Disputed, voided, cancelled or credited: paused for a person, never reminded.
        return Stop(f"invoice_{ps['hold']['state']}", bz.hold_message(ps["hold"]))
    if ps["block_reason"] and not (ps["block_reason"] == "invoice_not_overdue" and ctx.params.get("upcoming")):
        return _skipped(ctx, ps["block_reason"], info=info)
    reminders = ctx.policy.get("reminders") or {}
    max_reminders = int(reminders.get("max_reminders") or 3)
    if info["reminders_sent"] >= max_reminders:
        return Stop("reminders_exhausted", f"{info['reminders_sent']} reminders have already been sent for this invoice. This needs your attention.")
    not_before = bz._moment(info.get("next_reminder_at"))
    if not_before and ctx.now() < not_before:
        return _skipped(ctx, "reminder_too_soon", info=info)
    ctx.state["reminder_stage"] = info["reminders_sent"] + 1
    return Next()


async def pf_send(ctx):
    stage = int(ctx.state.get("reminder_stage") or 1)
    try:
        await ctx.call("prepare_payment_reminder", invoice_id=ctx.state["invoice_id"], stage=stage)
        sent = await ctx.call("send_payment_reminder", invoice_id=ctx.state["invoice_id"], stage=stage)
    except ToolStop as stop:
        # Revalidated against the live invoice, including at approval time.
        if stop.reason_code in bz.HOLD_REASONS:
            return Stop(stop.reason_code, stop.message)
        if stop.reason_code == "invalid_customer_destination":
            return Stop(stop.reason_code, stop.message)      # names the customer and the invoice
        return _skipped(ctx, stop.reason_code, stop.message)
    return Done(f"Payment reminder for invoice {ctx.state.get('invoice_reference') or ''} sent to {sent['sent_to']}.",
                next_action="I'll flag it again if it is still unpaid.", outcome={"invoice_id": ctx.state["invoice_id"], "stage": stage})


PAYMENT_FOLLOWUP = WorkflowDefinition(
    workflow_key="payment_followup", version=1, capability="payment_followup", family="Sell & Revenue",
    title="Payment Follow-up", autonomy=A3_EXECUTE_WITH_APPROVAL,
    triggers=("text", "ui_action", "business_event"),      # also started when records call for it (automatic starting)
    steps=[StepDefinition("check", "Check the invoice is eligible", pf_check),
           StepDefinition("send", "Send the reminder", pf_send)],
    tools=("read_payment_status", "read_invoice_status", "prepare_payment_reminder", "send_payment_reminder"),
    success_condition="Reminder sent for an eligible overdue invoice, or correctly suppressed.",
)


async def rs_payment(ctx):
    """No payment on record yet: the payment is recorded first, in the same form, and the receipt follows."""
    if ctx.state.get("invoice_id"):
        return Next()
    from app.modules.agent import newdocs
    data = await ctx.rt.business.load(ctx.run["business_id"])
    today = bz.local_now(data, ctx.now()).date().isoformat()
    # A paid invoice whose payment has no receipt yet: offered first, everything else filled from it (the owner, 29 Oct:
    # "Receipts: offer the paid invoices to choose from and fill everything from the invoice")
    paid = [i for i in (data.get("financials") or {}).get("invoices") or [] if isinstance(i, dict) and not i.get("archived")
            and any(not (pm.get("receipt") or {}).get("sent_at") for pm in i.get("payments") or [] if isinstance(pm, dict))]
    chosen = str(ctx.answers.get("paid_invoice_id") or "")
    if chosen and chosen != "new" and any(str(i.get("id")) == chosen for i in paid):
        ctx.state["invoice_id"] = chosen
        return Next()
    if paid and not chosen and not ctx.answers.get("invoice_id"):
        return WaitForInput("Which paid invoice is the receipt for?", [
            {"key": "paid_invoice_id", "label": "Paid invoice", "question": "Which paid invoice is the receipt for?", "type": "choice", "required": True,
             "default": str(paid[0]["id"]) if len(paid) == 1 else "",
             "options": [*({"value": str(i["id"]), "label": newdocs._invoice_label(i, data)} for i in paid[:25]),
                         {"value": "new", "label": "Record a new payment"}]}])
    if not ctx.answers.get("invoice_id"):
        return WaitForInput("No payment is on record yet. Record the payment and I'll prepare the receipt.",
                            newdocs.payment_fields(data, newdocs._said(ctx), today))
    taken = await newdocs.take_payment(ctx, data)
    if not taken:
        return WaitForInput("That invoice is no longer waiting for a payment. Which one was paid?", newdocs.payment_fields(data, newdocs._said(ctx), today))
    ctx.state["invoice_id"] = taken["invoice"]["id"]
    ctx.note(f"Recorded the payment of {fmt_money(taken['amount'], bz.currency_of(data))}.")
    return Next()


async def rs_send(ctx):
    ps = await ctx.call("read_payment_status", invoice_id=ctx.state["invoice_id"])
    payment = _unreceipted(ps["payments"])
    if not payment:
        return Done("Every payment on this invoice already has its receipt.", next_action="Ask me to record a payment when the next one arrives and I'll prepare its receipt.")
    if not (payment.get("receipt") or {}).get("number"):      # one receipt per payment, created once
        made = await ctx.call("create_receipt", invoice_id=ctx.state["invoice_id"], payment_id=payment["id"])
        if made.get("already_sent"):
            return Done(f"Receipt {made['receipt_number']} was already sent to {made.get('sent_to') or 'the customer'}. Its record has been restored.",
                        outcome={"invoice_id": ctx.state["invoice_id"], "receipt_number": made["receipt_number"]})
    sent = await ctx.call("send_receipt", invoice_id=ctx.state["invoice_id"], payment_id=payment["id"])
    return Done(f"Receipt {sent['receipt_number']} sent to {sent['sent_to']}.",
                outcome={"invoice_id": ctx.state["invoice_id"], "receipt_number": sent["receipt_number"]})


RECEIPT_SEND = WorkflowDefinition(
    workflow_key="receipt_send", version=1, capability="receipt_send", family="Sell & Revenue",
    title="Receipt Sending", autonomy=A3_EXECUTE_WITH_APPROVAL,
    triggers=("text", "ui_action", "business_event"),      # also started when records call for it (automatic starting)
    steps=[StepDefinition("payment", "Record the payment", rs_payment), StepDefinition("send", "Create and send the receipt", rs_send)],
    tools=("read_payment_status", "record_payment_confirmation", "create_receipt", "send_receipt"),
    success_condition="Receipt sent for a confirmed payment.",
)


# ══ Decision intelligence helpers (A1: explain only, s17) ═════════════════════

async def risk_explain(ctx):
    c = (await ctx.call("read_risk"))["concentration"]
    if not c["customer_count"]:
        return Done("Customer concentration is measured from paid or delivered invoices, and none is on record yet.",
                    next_action="Ask me for a new invoice, or to record a payment, and I'll measure it from there.", skipped=True)
    top = c["top_customers"][0]
    lines = [f"{t['customer']}: {t['share_pct']}% of revenue" for t in c["top_customers"][:3]]
    verdict = (f"Customer concentration is high: {top['customer']} is {top['share_pct']}% of your revenue"
               + (f", and your top two customers make up {c['top2_share_pct']}%." if c["customer_count"] > 1 else ".")
               if c["alert"] else
               f"Customer concentration is within your {c['threshold_pct']:g}% threshold. Your largest customer, {top['customer']}, is {top['share_pct']}% of revenue.")
    if c["alert"]:
        # Don't send the owner off to ask the obvious next question: answer it here.
        data = await ctx.rt.business.load(ctx.run["business_id"])
        amt = lambda v: fmt_money(v, bz.currency_of(data))      # noqa: E731 - amounts in the business's own currency
        r = bz.simulate(data, "client_loss", {"customer": top["customer"]}, ctx.now().date())
        if r.get("customer"):
            net = r["monthly_net_after"]
            verdict += (f" Losing {top['customer']} would cut monthly revenue by {r['revenue_drop_pct']}%, to {amt(r['monthly_revenue_after'])}, and you would "
                        + (f"clear {amt(net)}" if net >= 0 else f"lose {amt(abs(net))}") + " a month after current costs.")
    return Done(verdict, next_action=f"I'll keep watching {top['customer']}'s share of revenue and flag it if it rises." if c["alert"] else None,
                outcome={"concentration": c, "evidence": lines, "links": [{"label": "Full scenario in Simulation", "to": "/simulation"}]})


RISK_CONCENTRATION = WorkflowDefinition(
    workflow_key="risk_concentration", version=1, capability="risk_concentration", family="Decision Intelligence",
    title="Risk & Concentration", autonomy=A1_ASSIST,
    triggers=("text", "ui_action", "business_event"),      # also run by itself when the alert level is crossed
    steps=[StepDefinition("explain", "Explain customer concentration", risk_explain)],
    tools=("read_risk",), success_condition="Authoritative concentration figures explained.",
)


_BIGGEST = re.compile(r"\b(biggest|largest|top|main|best|key|major|number one)\b", re.I)


def _named_customer(raw: str) -> str:
    """The customer's name out of "…losing Frank then what happens?": the words after the verb,
    up to where the sentence moves on."""
    name = re.split(r"\s+(?:then|what|and|would|will|how|so|does|do|if|is|are)\b|[?,;]|\.(?:\s|$)", str(raw or "").strip(), maxsplit=1)[0]
    for _ in range(3):
        name = re.sub(r"^(?:my|our|the|a|an|client|customer)\s+", "", name.strip(), flags=re.I)
    return name.strip(" ?.'\"")


def _customers_on_record(data: dict) -> list[str]:
    """Every customer name the business has: the customer list, invoices and quotations."""
    fin = data.get("financials") or {}
    names: dict[str, str] = {}
    for row in [*((data.get("catalogue") or {}).get("customers") or []), *(fin.get("invoices") or []), *bz.quotes_of(data)]:
        if isinstance(row, dict):
            name = str(row.get("name") or row.get("customer_name") or "").strip()
            if name:
                names.setdefault(name.lower(), name)
    return sorted(names.values())


def _match_customer(asked: str, names: list[str]) -> list[str]:
    """The exact name if there is one; otherwise every customer whose name contains what was typed as whole words."""
    exact = [n for n in names if n.lower() == asked.lower()]
    if exact:
        return exact[:1]
    words = re.compile(r"\b" + re.escape(asked) + r"\b", re.I)
    return [n for n in names if words.search(n)]


def _open_with(data: dict, customer: str, amt) -> str:
    """What is in progress with a customer who has paid nothing yet, in a few words."""
    same = lambda row: str(row.get("customer_name") or "").strip().lower() == customer.lower()      # noqa: E731
    parts = []
    for q in bz.quotes_of(data):
        if same(q) and bz.status_of(q) in ("draft", "sent", "accepted", "won") and not q.get("archived"):
            parts.append(f"a {amt(bz.invoice_total(q))} {bz.status_of(q)} quote")
    for i in (data.get("financials") or {}).get("invoices") or []:
        if isinstance(i, dict) and same(i) and not i.get("archived") and bz.status_of(i) not in ("paid", "cancelled", "void", "voided") and bz.invoice_outstanding(i) > 0:
            parts.append(f"an unpaid invoice of {amt(bz.invoice_outstanding(i))}")
    return " and ".join(parts[:3])


async def scenario_run(ctx):
    goal = str(ctx.run.get("goal") or "")
    scenario, params = ctx.params.get("scenario"), dict(ctx.params.get("params") or {})
    if not scenario:
        m = re.search(r"(\d{1,3})\s*%", goal)
        lose = re.search(r"\b(?:lose|lost|losing|without)\s+(?:client|customer)?\s*([A-Za-z0-9&.' -]{2,60})", goal, re.I)
        if lose and not re.search(r"cost", goal, re.I):
            scenario, params = "client_loss", {"customer": _named_customer(lose.group(1))}
        else:
            scenario, params = "cost_increase", {"pct": float(m.group(1)) if m else 10.0}
    # Check there is something to model before the scenario runs: a run with nothing in it
    # is not started and uses no AI Credits.
    data = await ctx.rt.business.load(ctx.run["business_id"])
    amt = lambda v: fmt_money(v, bz.currency_of(data))      # noqa: E731 - amounts in the business's own currency
    today = ctx.now().date()
    planned_source = None
    if scenario == "client_loss":
        recent = bz.revenue_by_customer(data, since=today - timedelta(days=92))
        asked = str(ctx.answers.get("customer") or params.get("customer") or "").strip()
        if asked and not _BIGGEST.search(asked):
            # A customer was named: the analysis is for that customer or it isn't run. It is never
            # quietly run for someone else.
            found = _match_customer(asked, _customers_on_record(data))
            if not found:
                return Done(f"“{asked}” isn't one of your customers on record, so I haven't run this for anyone else.",
                            next_action=f"Ask me to add {asked} as a customer, or name one that is on record.", outcome={"reason": "customer_not_found", "asked": asked}, skipped=True)
            if len(found) > 1:
                return WaitForInput(f"“{asked}” matches more than one customer. Which one do you mean?", [{
                    "key": "customer", "label": "Customer", "type": "choice", "required": True,
                    "options": [{"value": n, "label": n} for n in found[:8]]}])
            name = found[0]
            if not recent.get(name):
                ever = bz.revenue_by_customer(data).get(name)
                also = _open_with(data, name, amt)
                return Done((f"{name} has had no paid revenue in the last three months" if ever else f"{name} has no paid revenue on record")
                            + ", so losing them changes nothing today" + (f"; they have {also}." if also else "."),
                            next_action=None, outcome={"reason": "no_customer_revenue", "customer": name}, skipped=True)
            params = {**params, "customer": name}
        else:
            params = {**params, "customer": ""}      # "my biggest client": the largest by revenue
        if not recent:
            return Done("This needs customer revenue from the last three months to model losing, and none is on record.",
                        next_action="Ask me for a new invoice, or to record a payment, and I'll run it from there.",
                        outcome={"reason": "no_revenue", "link": "/operations", "links": [{"label": "Invoices", "to": "/operations?tab=Sales"}]}, skipped=True)
    elif not bz.cash_position(data, today)["monthly_burn"]:
        planned = None
        try:
            from app.modules.readiness.service import service_for
            planned = await service_for(ctx.orch).planned_monthly_costs(ctx.run["business_id"])
        except Exception:      # noqa: BLE001 - the launch plan is optional here
            planned = None
        if not planned:
            # B6: the costs adopted in a review (or planned anywhere) count as planned costs.
            from app.modules.agent import planned as pl
            pm = pl.monthly(data)
            if pm.get("costs"):
                planned = {"amount": pm["costs"], "source": "planned: " + pl.said(pm["sources"], "fixed_costs", "cost", "monthly_sales")}
        if not planned:
            return Done("This needs your costs, and none are recorded or planned yet.",
                        next_action="Ask me to record an expense (or a supplier bill) and I'll run it from there.",
                        outcome={"reason": "no_costs", "link": "/launch", "links": [{"label": "Planned costs", "to": "/launch"}]}, skipped=True)
        params = {**params, "monthly_costs": planned["amount"]}
        planned_source = planned["source"]
    r = (await ctx.call("run_simulation", scenario=scenario, params=params))["result"]
    links = [{"label": "Full scenario in Simulation", "to": "/simulation"}]
    if scenario == "client_loss":
        if not r["customer"]:
            return Done("This needs customer revenue from the last three months to simulate losing, and none is on record.",
                        next_action="Ask me for a new invoice, or to record a payment, and I'll run it from there.", skipped=True)
        # One reply with the whole picture: how exposed the business is, what losing the customer
        # does to revenue and cash, and what to do about it. All from the invoices and expenses on record.
        alert = float((ctx.policy.get("risk") or {}).get("concentration_alert_pct") or 40)
        conc = bz.concentration(data, alert)
        share = next((t["share_pct"] for t in conc["top_customers"] if t["customer"] == r["customer"]), None)
        cash = bz.cash_position(data, today)
        owed = bz.total_of(data, [i for i in (data.get("financials") or {}).get("invoices") or []
                                  if isinstance(i, dict) and str(i.get("customer_name") or "").strip().lower() == r["customer"].lower()
                                  and bz.status_of(i) not in ("paid", "cancelled", "void", "voided", "draft")], lambda i: bz.invoice_outstanding(i))["value"]
        net = r["monthly_net_after"]
        text = (f"If you lost {r['customer']}"
                + (f" ({share:g}% of all your revenue, against your {alert:g}% alert level)" if share is not None else "")
                + f", monthly revenue would fall by {r['revenue_drop_pct']}%, from {amt(r['monthly_revenue_before'])} to {amt(r['monthly_revenue_after'])}. "
                + f"After current costs of {amt(r['monthly_burn'])} a month you would "
                + (f"clear {amt(net)} a month." if net >= 0 else f"lose {amt(abs(net))} a month.")
                + (f" With {amt(cash['cash'])} in hand that is about {cash['cash'] / abs(net):.1f} months of cover." if net < 0 and cash.get("cash", 0) > 0 else ""))
        advice = []
        if share is not None and share >= alert:
            advice.append(f"Win work from other customers until {r['customer']} is under {alert:g}% of revenue.")
        if net < 0:
            advice.append(f"Decide now which {amt(abs(net))} a month of costs you would pause if they left.")
        if owed > 0:
            advice.append(f"Collect what {r['customer']} already owes: {amt(owed)} is outstanding.")
        if len(advice) < 2:
            advice.append(f"Agree a notice period or a retainer with {r['customer']} so a loss isn't sudden.")
        text += " Recommended: " + " ".join(f"({n}) {line}" for n, line in enumerate(advice[:3], 1))
        return Done(text, next_action=(f"I'll keep watching {r['customer']}'s share of revenue and flag it if it rises."),
                    outcome={"simulation": r, "concentration": conc, "recommendations": advice[:3],
                             "links": [*links, {"label": "Customer concentration", "to": "/dashboard"}]})
    elif planned_source:
        text = (f"No costs are recorded yet, so this uses the planned costs from {planned_source}: {amt(r['monthly_burn_before'])} a month. "
                f"A {r['pct']:g}% increase would raise them to {amt(r['monthly_burn_after'])} a month.")
    else:
        text = (f"A {r['pct']:g}% cost increase would raise monthly costs from {amt(r['monthly_burn_before'])} to "
                f"{amt(r['monthly_burn_after'])}, moving your monthly net from {amt(r['monthly_net_before'])} to {amt(r['monthly_net_after'])}.")
    return Done(text, next_action=None, outcome={"simulation": r, "links": links})


SCENARIO_HELP = WorkflowDefinition(
    workflow_key="scenario_help", version=1, capability="scenario_help", family="Decision Intelligence",
    title="Scenario Help", autonomy=A1_ASSIST,
    steps=[StepDefinition("simulate", "Run the scenario", scenario_run)],
    tools=("run_simulation",), success_condition="Deterministic scenario result explained.",
)


# ══ Preparation the Agent does by itself (launch, funding, registration) ══════
# Nothing here leaves the business or changes money: each reads what is on record, prepares a
# draft or a list, and reports it. What only the owner can supply is asked for, never assumed.

_CLASS_WORDS = {"ready": "Ready", "conditionally_ready": "Conditionally ready", "not_ready": "Not ready", "insufficient_evidence": "Not enough evidence yet"}
_PREP_TRIGGERS = ("text", "ui_action", "business_event")


async def _readiness_picks(ctx):
    """The readiness service, and the funding case and launch the dashboard shows for this business."""
    from app.modules.readiness.service import service_for
    svc = service_for(ctx.orch)
    data = await ctx.rt.business.load(ctx.run["business_id"])
    return svc, data, await svc.dashboard_summaries(ctx.run["business_id"], data, ctx.actor, ctx.now())


def _result_words(p: dict) -> str:
    words = _CLASS_WORDS.get(p.get("classification"), "checked")
    return f"{p.get('title') or 'Untitled'}: {words}" + (f", score {p['score']}" if p.get("score") is not None else "")


async def _check(ctx, svc, kind: str, subject_id: str, tag: str) -> None:
    await svc.request_assessment(ctx.actor.user_id, ctx.run["business_id"], kind, subject_id,
                                 idempotency_key=f"agent:{ctx.run['id']}:{tag}", email=ctx.actor.email)


async def _feed_changed_figures(ctx) -> list[dict]:
    """§2: an accepted figure that changed since it went into the launch or funding case (a price given in another tool,
    say) goes in again, where the case still holds the earlier fed value (never over the case's own edit), and the case is
    assessed again. Returns what was fed: [{kind, fields}]."""
    from app.modules.agent import assessment_summary, planned as pl
    data = await ctx.rt.business.load(ctx.run["business_id"])
    fed = data.get("readiness_fed") or {}
    now = {k: v["value"] for k, v in pl.figures(data).items()}
    out = []
    for goal, kind in assessment_summary.KIND_OF_GOAL.items():
        before = fed.get(kind) or {}
        changed = {f: v for f, v in now.items() if f in assessment_summary.FEEDS[kind] and f in before and before[f] != v}
        if changed:
            await assessment_summary.feed(ctx.orch, {"id": ctx.actor.user_id, "email": ctx.actor.email}, ctx.run["business_id"], goal, changed, {},
                                          f"refresh:{ctx.run['id']}:{kind}")
            out.append({"kind": kind, "fields": sorted(changed)})
    return out


async def readiness_refresh_step(ctx):
    from app.modules.readiness import rules as rr
    svc, _data, picks = await _readiness_picks(ctx)
    # B6: asked for by the owner, it runs again whatever the dates say; started by the Agent, only what is out of date.
    asked = ctx.run.get("source_channel") in ("text", "voice", "ui_action")
    redone, links = [], []
    for name, kind, id_key, base in (("funding", rr.FUNDING, "case_id", "/funding"), ("launch", rr.LAUNCH, "initiative_id", "/launch")):
        p = picks.get(name)
        if not p or (p.get("freshness") != "stale" and not asked):
            continue
        await _check(ctx, svc, kind, p[id_key], name)
        links.append({"label": p.get("title") or name.capitalize(), "to": f"{base}/{p[id_key]}?tab=results"})
        redone.append(name)
    reviews = await _feed_changed_figures(ctx)      # §2: accepted figures that changed go into the case, which is assessed again
    if reviews:
        redone = sorted(set(redone) | {r["kind"] for r in reviews})
    if not redone and not reviews:
        return Done("Your readiness checks are up to date: nothing has changed since the last check.",
                    outcome={"reason": "nothing_out_of_date"}, skipped=True)
    after = (await _readiness_picks(ctx))[2] if redone else {}
    said = [_result_words(after[n]) for n in redone if after.get(n)]
    lead = ("Your figures changed, so I ran the check again" if reviews else "I ran the check again" if asked
            else "The details changed, so I ran the check again")
    joined = "; ".join(said)
    return Done(f"{lead}. " + joined[:1].upper() + joined[1:] + ".", next_action="I'll check again whenever the details change.",
                outcome={"refreshed": redone, "fed": reviews, "links": links})


async def launch_gaps_step(ctx):
    from app.modules.readiness import rules as rr
    svc, _data, picks = await _readiness_picks(ctx)
    p = picks.get("launch")
    # §2 (R3): the one launch assessment's own result, never a second engine's.
    if not p:
        return Done("Launch evidence is checked against a launch plan, and you haven't started one yet.", next_action="Start a launch plan in Launch Readiness and I'll list what its evidence is missing.",
                    outcome={"reason": "no_launch", "links": [{"label": "Launch Readiness", "to": "/launch"}]}, skipped=True)
    if not p.get("assessment_id") or p.get("freshness") == "stale":
        await _check(ctx, svc, rr.LAUNCH, p["initiative_id"], "gaps")
        p = (await _readiness_picks(ctx))[2].get("launch") or p
    found = await svc.get_assessment(ctx.actor.user_id, ctx.run["business_id"], rr.LAUNCH, p["initiative_id"], p["assessment_id"], email=ctx.actor.email)
    missing = [str(m.get("label") or "").strip() for m in ((found or {}).get("result") or {}).get("missing") or [] if m.get("label")]
    blockers = [str(b.get("label") or "").strip() for b in p.get("blockers") or [] if b.get("label")]
    links = [{"label": p.get("title") or "Launch", "to": f"/launch/{p['initiative_id']}?tab=evidence"}]
    title = p.get("title") or "your launch"
    if not missing and not blockers:
        return Done(f"Nothing is missing from the evidence for {title}. {_result_words(p)}.",
                    outcome={"gaps": [], "blockers": [], "links": links, "assessment_id": p.get("assessment_id")})

    def listed(items: list[str]) -> str:
        return "; ".join(items[:5]) + (f"; and {len(items) - 5} more" if len(items) > 5 else "")
    parts = []
    if missing:
        parts.append(f"{len(missing)} thing{'s are' if len(missing) != 1 else ' is'} not known yet for {title}: {listed(missing)}.")
    if blockers:
        parts.append(f"{len(blockers)} blocker{'s' if len(blockers) != 1 else ''} stand{'s' if len(blockers) == 1 else ''} in the way: {listed(blockers)}.")
    return Done(" ".join(parts), next_action="I'll check again as soon as any of these is filled in.",
                outcome={"gaps": missing, "blockers": blockers, "links": links, "assessment_id": p.get("assessment_id")})


async def funding_pack_step(ctx):
    from app.modules.readiness import materials
    from app.modules.readiness import rules as rr
    svc, _data, picks = await _readiness_picks(ctx)
    p = picks.get("funding")
    if not p:
        return Done("I need a funding case before the funding pack can be drafted, and there isn't one on record yet.",
                    outcome={"reason": "no_funding_case", "links": [{"label": "Funding Readiness", "to": "/funding"}]}, skipped=True)
    if not p.get("assessment_id") or p.get("freshness") == "stale":
        await _check(ctx, svc, rr.FUNDING, p["case_id"], "pack")
        p = (await _readiness_picks(ctx))[2].get("funding") or p
    made = []
    for kind, title in materials.KINDS[rr.FUNDING].items():
        await svc.generate_material(ctx.actor.user_id, ctx.run["business_id"], rr.FUNDING, p["case_id"], kind,
                                    idempotency_key=f"agent:{ctx.run['id']}:{kind}", email=ctx.actor.email)
        made.append(title)
    return Done(f"Funding pack draft ready for review: {', '.join(made)}. Nothing has been sent to anyone.",
                next_action="I'll redraft it when the funding case changes.",
                outcome={"documents": made, "case_id": p["case_id"], "assessment_id": p.get("assessment_id"),
                         "links": [{"label": "Funding pack", "to": f"/funding/{p['case_id']}?tab=documents"}]})


def registration_number(data: dict) -> str:
    profile = data.get("workspace_profile") or {}
    return str(profile.get("registration_number") or profile.get("company_number") or (data.get("registration") or {}).get("company_number") or "").strip()


async def registration_checklist_step(ctx):
    data = await ctx.rt.business.load(ctx.run["business_id"])
    number = registration_number(data)
    if number:
        return Done(f"Your business is registered (company number {number}), so there is no registration checklist to prepare.",
                    outcome={"reason": "registered"}, skipped=True)
    from app.modules.business_registration.schemas import RegistrationGuideRequest
    from app.modules.business_registration.service import next_steps, readiness_checklist
    profile = data.get("workspace_profile") or {}
    ask = RegistrationGuideRequest(country=str(profile.get("country") or "United Kingdom")[:64] or "United Kingdom", founder_count=1)
    items = [*readiness_checklist(ask), *next_steps(ask)]
    return Done(f"Registration checklist ready: {len(items)} things to have in place. First: {items[0]}; {items[1]}; {items[2]}.",
                next_action="I'll stop showing this once a company number is on your business profile.",
                outcome={"checklist": items, "links": [{"label": "Business Registration", "to": "/registration"}]})


async def _planned(ctx) -> dict:
    """B6: the planned month (planned.monthly) with any planned figure answered in this task kept first in the shared
    store, so every other check and tool reads it too, with where it came from."""
    from app.modules.agent import planned as pl
    given = {k: ctx.answers[k] for k in pl.PLANNED_FIELDS if ctx.answers.get(k) not in (None, "")}
    if given:
        now, words = ctx.now().isoformat(), f"From your {ctx.wf.title.lower()}"

        def _apply(d: dict) -> None:
            shared = d.setdefault("shared_answers", {})
            for k, v in given.items():
                shared[k] = {"value": float(v), "offering": "", "goal": ctx.run.get("workflow_key"), "at": now, "source": words + " (planned)",
                             "state": "accepted", "basis": "forecast"}
        await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    return pl.monthly(await ctx.rt.business.load(ctx.run["business_id"]))


def _ask_planned(intro: str, missing: list[str]):
    from app.modules.agent import planned as pl
    return WaitForInput(intro, pl.ask_fields(missing))


async def price_test_step(ctx):
    """What a 5% and a 10% price rise would do, from the revenue on record and the margins in the
    Catalogue: the extra a month if volume holds, and how much volume could be lost before it stops paying."""
    data = await ctx.rt.business.load(ctx.run["business_id"])
    amt = lambda v: fmt_money(v, bz.currency_of(data))      # noqa: E731
    recent = bz.revenue_by_customer(data, since=ctx.now().date() - timedelta(days=92))
    monthly = bz.money(sum(recent.values()) / 3)
    planned_basis = ""
    if monthly <= 0:
        # B6: no sales yet: the price is tested on the planned figures (adopted in a review, or given here), said as planned.
        from app.modules.agent import planned as pl
        pm = await _planned(ctx)
        fig = pm["figures"]
        if not (fig.get("price") and fig.get("monthly_sales")):
            # Nothing planned either: the pricing check (the homepage's) asks for the planned figures, never a dead end.
            return Done("A price test works from revenue paid in the last three months, and none is on record yet.",
                        next_action="Ask me for a new invoice, or to record a payment, and I'll test the price from there.", outcome={"reason": "no_revenue", "check": "price_offer"}, skipped=True)
        monthly = bz.money(pm["revenue"])
        planned_basis = pl.said(pm["sources"], "price", "monthly_sales", "cost")
        if ctx.answers.get("cost_pct") in (None, "") and pm.get("margin"):
            ctx.answers["cost_pct"] = round((1 - pm["margin"]) * 100, 1)
    priced = [(p_price, p_cost) for p_price, p_cost in ((float(p.get("base_price") or 0), float(p.get("cost_of_sales") or p.get("unit_cost") or 0))
                                                        for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict))
              if p_price > 0 and p_cost > 0]
    given = ctx.answers.get("cost_pct")
    if given not in (None, ""):
        margin = max(0.01, min(0.99, 1 - float(given) / 100))
        basis = "the cost of sales you gave"
    elif priced:
        margin = max(0.01, min(0.99, sum((pr - co) / pr for pr, co in priced) / len(priced)))
        basis = f"the average margin of the {len(priced)} catalogue item{'s' if len(priced) != 1 else ''} with a cost on record"
    else:
        # The one thing only the owner knows; asked for here, never assumed.
        return WaitForInput("What does it cost you to deliver your work, as a percentage of the price? (for example 40)", [{
            "key": "cost_pct", "label": "Cost of sales (% of price)", "type": "number", "required": True,
            "hint": "No cost of sales is recorded on your catalogue items, so I can't work out the margin without it."}])
    lines, results = [], []
    for pct in (5, 10):
        p = pct / 100
        extra = bz.money(monthly * p)
        drop = round(p / (p + margin) * 100, 1)
        results.append({"pct": pct, "extra_monthly": extra, "break_even_volume_drop_pct": drop})
        lines.append(f"+{pct}% price: +{amt(extra)}/month if volume holds; break-even volume drop {drop:g}%.")
    if planned_basis:
        return Done("Planned figures, as there are no sales on record yet. " + " ".join(lines)
                    + f" Worked out from a planned {amt(monthly)} a month and a {margin * 100:.0f}% margin ({planned_basis}).",
                    next_action="Once sales are on record I'll test it on what you actually earn.",
                    outcome={"price_test": results, "monthly_revenue": monthly, "margin_pct": round(margin * 100, 1), "planned": True,
                             "links": [{"label": "Catalogue prices", "to": "/catalogue"}]})
    return Done(" ".join(lines) + f" Worked out from {amt(monthly)} a month of paid revenue and a {margin * 100:.0f}% margin ({basis}).",
                next_action="I'll work it out again next month, or sooner if your prices change.",
                outcome={"price_test": results, "monthly_revenue": monthly, "margin_pct": round(margin * 100, 1),
                         "links": [{"label": "Catalogue prices", "to": "/catalogue"}]})


PRICE_TEST = WorkflowDefinition(workflow_key="price_test", version=1, capability="price_test", family="Decision Intelligence", title="Price Test",
                                autonomy=A1_ASSIST, triggers=("text", "ui_action", "business_event"),
                                steps=[StepDefinition("test", "Test a price change", price_test_step)], tools=(),
                                success_condition="The effect of a price change worked out from the records and reported.")


# ── Idea stage: validation, market size, business plan draft ───────────────────

def carried_answers(data: dict, described: str) -> dict[str, str]:
    """{"customer", "where", "sell"}: what the owner answered on the dashboard's checks, kept for the offering it was about,
    when that is this business's offering (or, with no description on record, the offering they told the check)."""
    from app.modules.agent import answer_memory
    shared = (data or {}).get("shared_answers") or {}
    sell = shared.get("sell") if isinstance(shared.get("sell"), dict) else {}
    offering = described or str(sell.get("value") or "")
    out: dict[str, str] = {}
    if not offering:
        return out
    for field in ("customer", "where", "sell"):
        got = shared.get(field)
        if not isinstance(got, dict) or not str(got.get("value") or "").strip() or got.get("state", "accepted") != "accepted":
            continue
        if answer_memory.same_offering(got.get("offering") or (got.get("value") if field == "sell" else ""), offering):
            out[field] = str(got["value"]).strip()
    return out


def idea_of(data: dict, answers: dict | None = None) -> dict:
    """What the business has said about itself, from its profile and anything it has answered here."""
    a, p = answers or {}, data.get("workspace_profile") or {}
    iv = data.get("idea_validation") or data.get("draft_idea_validation") or {}

    market = data.get("marketplace") or {}
    listing = {}
    for part in (market, market.get("profile") or {}, market.get("listing") or {}, data.get("marketplace_profile") or {}):
        if isinstance(part, dict):
            for key in ("description", "about", "summary", "bio", "tagline", "category", "location"):
                if str(part.get(key) or "").strip() and key not in listing and not isinstance(part.get(key), (dict, list)):
                    listing[key] = part[key]

    def first(*values):
        return next((str(v).strip() for v in values if not isinstance(v, (dict, list)) and str(v or "").strip()), "")

    def worth(value):
        """A description on the profile is used unless it is plainly not words ("MMMMMM", "xx")."""
        text = str(value or "").strip()
        return "" if len(text) < 3 or re.search(r"(.)\1{4,}", text, re.I) else value

    def offered_as(value):
        """The description of last resort, put together from what is sold, is used only when it reads as one:
        "Offers Gooat" is not an idea, so the idea is asked for instead."""
        from app.modules.marketplace.directory import real_text
        return value if real_text(value, least=12, words=3) else ""

    # What it sells, from the profile's services and the catalogue: a description of last resort,
    # and context for the generators either way.
    services = [s for s in p.get("services") or [] if isinstance(s, dict)]
    offered = [str(s.get("service_name") or s.get("name") or "").strip() for s in services] \
        + [str(x.get("name") or "").strip() for x in (data.get("catalogue") or {}).get("products") or [] if isinstance(x, dict)]
    offered = [n for n in dict.fromkeys(offered) if n]
    service_text = first(*[s.get("service_description") for s in services])
    kinds = {"b2b": "Other businesses", "b2c": "Consumers", "b2b2c": "Businesses and their customers", "b2g": "Public sector bodies",
             "businesses": "Other businesses", "consumers": "Consumers", "both": "Businesses and consumers"}
    customer_type = str(p.get("target_customer_type") or "").strip()
    town, country = first(p.get("city"), p.get("location")), first(p.get("country"))
    stated = first(a.get("customer"), p.get("target_customer"), p.get("target_market"), p.get("ideal_customer"), p.get("customers"),
                   iv.get("target_customer"), iv.get("who_affected"))
    # What the owner already answered on the dashboard's check (who it is for, where, what it sells), about this same
    # offering: never asked a second time. An answer about another offering is never carried (answer_memory).
    carried = carried_answers(data, first(a.get("description"), worth(p.get("about_company")), worth(p.get("description")),
                                          worth(p.get("business_description")), worth(p.get("what_we_do"))))
    stated = first(stated, carried.get("customer"))
    # Every place the business has described itself (what was typed here, the profile, the Marketplace):
    # who it is for may be said in any of them.
    about = ". ".join(str(v).strip() for v in (a.get("description"), p.get("about_company"), p.get("description"), p.get("business_description"),
                                               p.get("what_we_do"), listing.get("description"), listing.get("about"), listing.get("summary"), listing.get("bio"))
                      if isinstance(v, str) and v.strip())
    # "…support for small UK service firms": who it is for, read out of the description. A guess, so it is confirmed.
    named = re.search(r"\bfor\s+((?:[a-z0-9&'-]+\s){0,6}(?:firms|businesses|companies|owners|founders|teams|clients|customers|startups|start-ups|shops|cafés|cafes|"
                      r"restaurants|practices|agencies|landlords|charities|schools|families|people|professionals|freelancers|contractors|traders|retailers|studios|clinics|"
                      r"salons|consultants|sellers|makers|farmers|students|parents|homeowners|tenants|drivers|builders|trades|tradespeople|smes))\b", about, re.I)
    guess = (named.group(1).strip()[:1].upper() + named.group(1).strip()[1:]) if named and not stated else ""
    # Said in a launch plan ("Who is this launch for?"): the owner's own words, about one launch,
    # so it is offered for a yes rather than assumed for the whole business.
    launch = data.get("_launch") or {}
    from_launch = bool(launch.get("customer")) and not stated
    if from_launch:
        guess = str(launch["customer"]).strip()
    return {
        "customer_guessed": bool(guess),
        "customer_from": (f"your launch plan “{launch.get('title')}”" if launch.get("title") else "your launch plan") if from_launch else "your description",
        "name": first(p.get("company_name"), p.get("name"), iv.get("business_name")),
        "description": first(a.get("description"), worth(p.get("about_company")), worth(p.get("description")), worth(p.get("business_description")), worth(p.get("what_we_do")),
                             worth(listing.get("description")), worth(listing.get("about")), worth(listing.get("summary")), worth(listing.get("bio")), worth(listing.get("tagline")),
                             worth(iv.get("idea_description")), worth(iv.get("description")), carried.get("sell"), offered_as(service_text), offered_as(f"Offers {', '.join(offered[:6])}" if offered else "")),
        # Where the description came from: only a guess put together from the services list is checked with the owner.
        "description_guessed": not first(a.get("description"), worth(p.get("about_company")), worth(p.get("description")), worth(p.get("business_description")), worth(p.get("what_we_do")),
                                         worth(listing.get("description")), worth(listing.get("about")), worth(listing.get("summary")), worth(listing.get("bio")), worth(listing.get("tagline")),
                                         worth(iv.get("idea_description")), worth(iv.get("description")), carried.get("sell")) and bool(offered_as(service_text) or offered_as(f"Offers {', '.join(offered[:6])}" if offered else "")),
        "customer": first(stated, guess, kinds.get(customer_type.lower(), customer_type.replace("_", " "))),
        "problem": first(a.get("problem"), p.get("problem"), p.get("problem_solved"), iv.get("problem_description"), iv.get("problem"), launch.get("problem")),
        "industry": first(a.get("industry"), p.get("primary_industry_other"), p.get("custom_industry"),
                          "" if str(p.get("primary_industry") or "").lower() == "other" else p.get("primary_industry"), p.get("industry"),
                          listing.get("category")).replace("_", " "),
        "location": first(a.get("location"), ", ".join(x for x in (town, country) if x), carried.get("where"), listing.get("location"), launch.get("location")),
        "services": offered[:12],
        "currency": bz.currency_of(data),
    }


_IDEA_QUESTIONS = {
    "description": ("What does your business do? (1 to 2 sentences)", "What the business does", "textarea"),
    "customer": ("Who is your customer? (for example: independent cafés in Manchester)", "Your customer", "text"),
    "problem": ("What problem does your business solve? (1 to 2 sentences)", "The problem you solve", "textarea"),
    "industry": ("Which industry are you in?", "Industry", "text"),
    "location": ("Where will you sell? (town, region or country)", "Where you sell", "text"),
}


# What the profile says the business does (G1, 23 Oct: a cleaning plan written as "Industry: Pet grooming" from a profile a
# dog-grooming idea had written into)
_PROFILE_ABOUT = ("description", "about_company", "business_description", "what_we_do", "problem", "problem_solved", "target_customer",
                  "target_market", "ideal_customer", "key_offering_focus")
_ABOUT_WORDS = {"business", "company", "limited", "service", "services", "customers", "people", "small", "local", "with", "from", "that",
                "this", "their", "your", "building", "enterprateai", "offer", "offers", "provide", "provides", "help", "helps"}


def _about_words(text) -> set:
    return set(re.findall(r"[a-z]{4,}", str(text or "").lower())) - _ABOUT_WORDS


def profile_conflict(data: dict, said: str) -> dict:
    """The profile fields that speak of something else than what the owner said in this conversation ({field: text}); empty
    when they agree or nothing was said. Only a description-like field naming another offering counts as a clash."""
    p = data.get("workspace_profile") or {}
    # Where the business is ("Leeds") is no sign two descriptions agree: only what they say it does counts
    place = _about_words(" ".join(str(p.get(k) or "") for k in ("city", "country", "state_or_region", "address_line_1", "address_line_2", "location")))
    place |= {"suburbs", "city", "town", "area", "region", "nationwide"}
    mine = _about_words(said) - place
    if not mine:
        return {}
    clash = {k: str(p[k]) for k in _PROFILE_ABOUT if str(p.get(k) or "").strip() and not ((_about_words(p[k]) - place) & mine)}
    return clash if any(k in clash for k in ("description", "key_offering_focus", "business_description", "what_we_do")) else {}


async def _with_owner_words(ctx, data: dict):
    """What the owner said in this conversation wins over the stored profile (G1): a clash is asked about once ("Your
    profile says pet grooming; you said cleaning. Which is right?"); their words chosen, the clashing profile fields are left
    out of this task (the profile itself is changed only by the owner). Returns (data, a question or None)."""
    said = str(ctx.answers.get("description") or "").strip()
    if not said or (ctx.params or {}).get("subject_id") or (ctx.run.get("state") or {}).get("idea_from_message"):
        return data, None      # a launch plan's offering, or a new idea named in the message: its own, not a clash
    clash = profile_conflict(data, said)
    if not clash:
        return data, None
    choice = str(ctx.answers.get("profile_conflict") or "")
    stored = next(clash[k] for k in ("description", "key_offering_focus", "business_description", "what_we_do") if k in clash)
    if not choice:
        return data, WaitForInput(f"Your profile says “{stored[:90]}”; you said “{said[:90]}”. Which is right?", [{
            "key": "profile_conflict", "label": "Which is right?", "type": "choice", "required": True, "default": "said",
            "options": [{"value": "said", "label": f"What I said: {said[:80]}"}, {"value": "profile", "label": f"My profile: {stored[:80]}"}]}])
    if choice == "profile":
        ctx.answers.pop("description", None)
        return data, None
    clean = dict(data)
    clean["workspace_profile"] = {k: v for k, v in (data.get("workspace_profile") or {}).items() if k not in clash}
    return clean, None


async def _business_and_launch(ctx) -> dict:
    """The business record, with what its launch plan says about who it is for alongside it."""
    from app.modules.agent import modules
    data = await ctx.rt.business.load(ctx.run["business_id"])
    data["_launch"] = await modules.launch_facts(ctx.orch, ctx.run["business_id"], (ctx.params or {}).get("subject_id"))
    return data


def _ask_idea(idea: dict, needed: tuple[str, ...]):
    """The first thing still missing, as one question; None when nothing is."""
    if "description" in needed and idea.get("description") and idea.get("description_guessed"):
        # Put together from the services on file: shown for a yes, with the text there to change.
        return WaitForInput(f"Using your profile: {idea['description']}. Is this the idea?", [{
            "key": "description", "label": "What the business does", "type": "textarea", "required": True, "default": idea["description"], "confirm": True,
            "hint": "Taken from your services. Change it if it isn't quite right."}])
    if "customer" in needed and idea.get("customer") and idea.get("customer_guessed"):
        return WaitForInput(f"Is this your customer? “{idea['customer']}”", [{
            "key": "customer", "label": "Your customer", "type": "text", "required": True, "default": idea["customer"], "confirm": True,
            "hint": f"Taken from {idea.get('customer_from') or 'your description'}. Change it if it isn't quite right."}])
    for key in needed:
        if not idea.get(key):
            question, label, kind = _IDEA_QUESTIONS[key]
            return WaitForInput(question, [{"key": key, "label": label, "type": kind, "required": True}])
    return None


async def _studio(ctx, feature: str, call):
    """Run one generator, charged at its price on the price list, and note what it cost on the task. F1: what it made is
    kept on the task at once, so a step tried again (after a restart, a heartbeat or a retry) uses the same document and
    is never charged or filed a second time."""
    # The same task advanced twice at once (four plan drafts in seventy seconds, F1): one generator call at a time per
    # task, and the second reads what the first made from the store before doing anything.
    async with _STUDIO_LOCKS.setdefault((ctx.run["id"], feature), asyncio.Lock()):
        stored = await ctx.rt.store.get_run(ctx.run["id"]) or {}
        earlier = ((stored.get("state") or {}).get("made") or {}).get(feature)
        for k in ("paid", "credits"):
            if (stored.get("state") or {}).get(k) and not ctx.run.setdefault("state", {}).get(k):
                ctx.run["state"][k] = stored["state"][k]
        made = ctx.run.setdefault("state", {}).setdefault("made", {})
        if earlier and not made.get(feature):
            made[feature] = earlier
        if made.get(feature):
            call.close()      # never awaited: the generator is not run again
            return made[feature]
        async with ctx.orch.charge_once(ctx.run, ctx.actor.user_id, feature, f"{feature}:{ctx.run['id']}", feature):
            result = await call
        made[feature] = result
        await ctx.rt.store.update_run(ctx.run["id"], {"state": ctx.run["state"]})
        return result


_STUDIO_LOCKS: dict[tuple[str, str], asyncio.Lock] = {}

# What each generated document is called to the owner, when it can't be written just now.
_WRITES = {"business_plan_full": ("business plan", "business_plan", "Business plan"), "sales_letter_full": ("sales letter", "sales_letter", "Sales letter"),
           "proposal_full": ("proposal", "client_proposal", "Proposal")}


async def _generated(ctx, feature: str, call, inputs: dict | None = None):
    """A generator run through the one AI gateway (with fallback). If every provider fails (the owner's QA, 15 Oct): the
    draft is kept in Business Blueprints with its inputs and its sections "Waiting to write", nothing is charged, and the
    task waits to finish by itself (tried again in 1, 5 and 30 minutes), said once in plain words. Never a raw error."""
    from app.modules.agent.services import InsufficientCredits
    from app.modules.agent.tools import NeedsInformation, ToolStop
    from app.modules.agent.models import SUB_RETRY_AVAILABLE
    word, doc_type, title = _WRITES.get(feature, ("document", "business_plan", "Document"))
    try:
        result = await _studio(ctx, feature, call)
    except (ToolStop, InsufficientCredits, NeedsInformation):
        raise
    except Exception as e:      # noqa: BLE001 - logged in full for the superadmin; the owner reads one plain sentence
        logger.warning("generator %s for run %s could not run: %s: %s", feature, ctx.run["id"], type(e).__name__, str(e)[:500])
        state = ctx.run.setdefault("state", {})
        if not state.get("pending_doc"):
            lines = [f"# {title} (waiting to write)", "", "I've saved your inputs and will write the sections automatically.", "", "## Inputs"]
            lines += [f"- {k.replace('_', ' ').capitalize()}: {v}" for k, v in (inputs or {}).items() if v not in (None, "", [], {})][:20]
            lines += ["", "## Sections", "", "Waiting to write."]
            try:
                state["pending_doc"] = await ctx.rt.studio.file_document(user_id=ctx.actor.user_id, business_id=ctx.run["business_id"], type=doc_type,
                                                                         title=f"{title} (waiting to write)", company=(inputs or {}).get("name") or "",
                                                                         markdown="\n".join(lines))
            except Exception:      # noqa: BLE001 - the task still waits to finish
                logger.warning("the waiting draft for run %s could not be filed", ctx.run["id"], exc_info=True)
            await ctx.rt.store.update_run(ctx.run["id"], {"state": state})
        return Stop("generation_unavailable", f"I couldn't write your {word} just now. I've saved your inputs and will finish it automatically. Nothing was charged.",
                    SUB_RETRY_AVAILABLE)
    pending = (ctx.run.get("state") or {}).pop("pending_doc", None)
    if pending:      # the real draft is written: the waiting one goes
        try:
            from app.modules.blueprint.repository import delete_document
            await delete_document(user_id=ctx.actor.user_id, document_id=str(pending))
        except Exception:      # noqa: BLE001
            logger.info("the waiting draft %s was not removed", pending)
    return result


async def _keep(ctx, key: str, value: dict) -> None:
    def _apply(data: dict) -> None:
        data.setdefault("agent_studio", {})[key] = {**value, "at": ctx.now().isoformat(), "run_id": ctx.run["id"]}
        # PRD 6.1 (QA R1): what the owner answered here, asked about their own business ("Is this your customer?"),
        # is an explicit confirmation: it goes on the profile, with where it came from. Answers carried in from a
        # homepage goal (another idea, perhaps) are not: they are kept as proposals for the owner to confirm.
        from app.modules.agent import profile_proposals
        carried = set((ctx.params.get("answers") or {}) if isinstance(ctx.params.get("answers"), dict) else ())
        from_goal = str(ctx.run.get("source_reference") or "").startswith("goal:")
        source = {"kind": "agent_task", "workflow": ctx.run.get("workflow_key"), "run_id": ctx.run["id"],
                  "offering": str(ctx.answers.get("description") or "")[:200]}      # QA PF5: which offering it was said about
        profile = data.setdefault("workspace_profile", {})
        proposals = {}
        for field, column in (("description", "description"), ("customer", "target_customer"), ("problem", "problem"),
                              ("industry", "primary_industry"), ("location", "location")):
            said = str(ctx.answers.get(field) or "").strip()
            if not said or str(profile.get(column) or "").strip():
                continue
            if from_goal or field in carried:
                proposals["about_company" if column == "description" else column] = said
            else:
                profile[column] = said
                profile.setdefault("provenance", {})[column] = {"source": {**source, "answered_by_owner": True}, "confirmed_at": ctx.now().isoformat()}
        if proposals:
            profile_proposals.propose(data, proposals, {**source, **({"goal_reference": ctx.run.get("source_reference")} if from_goal else {})}, ctx.now())
        if key == "validation" and not (data.get("validation") or {}).get("overall_score"):
            data["validation"] = {**(data.get("validation") or {}), "overall_score": value["score"], "source": "agent"}
    await ctx.rt.business.mutate(ctx.run["business_id"], _apply)


def known_for_validation(data: dict, answers: dict | None = None) -> dict:
    """What the workspace already holds that the Idea Validation wizard asks for, so the Agent's score is built from the
    same information the wizard would have: the stage, the figures (price, cost, fixed costs, capacity, from every check
    and the catalogue), the competitors and the channels. Only what is on record; nothing is guessed."""
    from app.modules.agent import research
    p = data.get("workspace_profile") or {}
    figures = {k: v for k, v in research.inputs_of("test_idea", answers or {}, data).items() if not k.startswith("_") and v not in (None, "")}
    text = lambda *v: next((str(x).strip() for x in v if isinstance(x, str) and x.strip()), "")      # noqa: E731
    return {"stage": text(p.get("operating_stage"), p.get("business_stage")), "competitors": text(p.get("competitors"), p.get("main_competitors")),
            "channels": text(p.get("channels"), p.get("acquisition_channels"), p.get("marketing_channels")),
            "price": figures.get("price"), "cost": figures.get("cost"), "fixed_costs": figures.get("fixed_costs"),
            "capacity": figures.get("capacity"), "monthly_sales": figures.get("monthly_sales")}


async def separate_idea(ctx, data: dict) -> bool:
    """A2: is the idea named in the owner's message a different one from the business's own offer? Decided by the
    understanding layer (the classifier); the same offering said two ways is the business's own. When it can't be told,
    it is kept apart: a new idea never overwrites the business's own validation or borrows its answers."""
    if not (ctx.run.get("state") or {}).get("idea_from_message"):
        return False
    said = str(ctx.answers.get("description") or "").strip()
    own = idea_of(data)
    offer = str(own.get("description") or "").strip()
    if not said or not offer or own.get("description_guessed") and not offer:
        return False      # the business has no offer of its own yet: this is it
    from app.modules.agent import answer_memory
    if answer_memory.same_offering(said, offer):
        return False
    if getattr(ctx.rt.classifier, "available", False):
        try:
            verdict = await ctx.rt.classifier.choose(
                task="Is the idea in the message the business's current offer (same) or a different business idea (different)?",
                text=f"Message: {said}\nThe business's current offer: {offer}", options=["same", "different"], user_id=ctx.actor.user_id)
            if verdict:
                return verdict == "different"
        except Exception:      # noqa: BLE001 - not known: kept apart
            logger.info("idea comparison not available for run %s", ctx.run["id"])
    return True


def plain(text: str) -> str:
    """B5: nothing that reads as code reaches the owner: a dict or list written out ({'..': ..}) is a bug, said plainly."""
    if re.search(r"\{'|':|\[\{|\{\"", str(text or "")):
        logger.error("a summary carried a raw structure: %s", str(text)[:200])
        return re.sub(r"\{[^{}]*\}", "", str(text)).replace("  ", " ").strip()
    return text


def _idea_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:60] or "idea"


async def _keep_separate_idea(ctx, idea: dict, result: dict, plan: dict | None = None) -> None:
    """A separate idea's own record: what it is and its result, beside the business's (which is left exactly as it was).
    `plan`: a business plan made for this idea, linked from its record (F1)."""
    key = _idea_key(idea.get("description"))

    def _apply(data: dict) -> None:
        ideas = data.setdefault("agent_ideas", {})
        record = dict(ideas.get(key) or {})
        record.update({"description": idea.get("description"), "customer": idea.get("customer"), "problem": idea.get("problem"),
                       "updated_at": ctx.now().isoformat(), "run_id": ctx.run["id"]})
        record.setdefault("created_at", ctx.now().isoformat())
        record.setdefault("results", []).append({**result, "at": ctx.now().isoformat(), "run_id": ctx.run["id"]})      # merged, never replaced
        if plan:
            record["plan"] = {**plan, "at": ctx.now().isoformat(), "run_id": ctx.run["id"]}
        ideas[key] = record
    await ctx.rt.business.mutate(ctx.run["business_id"], _apply)


ECONOMICS = (("price", "price per sale"), ("cost", "cost per sale"), ("monthly_sales", "expected sales a month"))


def economics_gaps(idea: dict, answers: dict | None = None) -> list[str]:
    """The figures a viability score rests on (price, cost per sale, expected sales) that are not known yet."""
    known = {**(idea.get("known") or {}), **{k: v for k, v in (answers or {}).items() if k in dict(ECONOMICS)}}
    out = []
    for key, words in ECONOMICS:
        try:
            ok = float(known.get(key)) > 0
        except (TypeError, ValueError):
            ok = False
        if not ok:
            out.append(words)
    return out


def _and_list(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


async def idea_validation_step(ctx):
    data = await _business_and_launch(ctx)
    data, clash = await _with_owner_words(ctx, data)
    if clash:
        return clash
    from_plan = bool((ctx.params or {}).get("subject_id") and (data.get("_launch") or {}).get("offering"))
    separate = (await _idea_for(ctx, data))[1] if from_plan else await separate_idea(ctx, data)
    if from_plan:
        # A launch plan's offering, chosen before it started (23 Oct): its own words, kept apart when it is not the business's own
        idea, _ = await _idea_for(ctx, data)
    elif separate:
        # Only what was said about this idea: nothing from the profile or another plan ("Is this your customer?" from a
        # launch plan for something else), and nothing written back to the business.
        own = idea_of(data, {})
        idea = {k: str(ctx.answers.get(k) or "").strip() for k in ("description", "customer", "problem", "industry", "location")}
        # Where it is unsaid: where the owner is, in their currency (the owner, 26 Oct: GBP and no country for a Nigerian
        # business's idea), never anything else from the business
        from app.modules.agent.research import task_currency
        p = data.get("workspace_profile") or {}
        idea["location"] = idea["location"] or ", ".join(x for x in (str(p.get("city") or "").strip(), str(p.get("country") or "").strip()) if x)
        idea.update({"name": idea["description"][:60], "currency": own.get("currency") or task_currency(data) or "GBP",
                     **({"country": str(p["country"]).strip()} if str(p.get("country") or "").strip() and not ctx.answers.get("location") else {})})
    else:
        idea = idea_of(data, ctx.answers)
    idea = await _fill_idea(ctx, idea) if idea.get("description") else idea
    if idea.pop("_filled", False):
        idea = {**idea, "customer_guessed": False, "description_guessed": False}      # worked out: nothing to confirm
    ask = _ask_idea(idea, ("description", "customer", "problem"))
    if ask:
        return ask
    depth = ctx.params.get("depth") or "basic"
    idea = {**idea, "known": {} if separate else known_for_validation(data, ctx.answers), "depth": depth}
    if economics_gaps(idea, ctx.answers):
        # What the records don't give, estimated for this idea and place, said as estimates and changeable on Idea
        # Validation (the owner, 25 Oct: "agent is supposed to fill and smart populate these"), never left as "still needed"
        idea = await _estimate_economics(ctx, idea)
    # The draft in Idea Validation History, for the owner to accept or reject: one per idea, so a Comprehensive run after
    # an upgrade updates the same draft (with the same answers), never a second one. A separate idea has its own too, so
    # "Open" goes to its result, never the empty start (the owner, 26 Oct: "why is open validation form bringing me here?")
    idea = await _fill_whole_form(ctx, idea)
    import hashlib
    idea["history_id"] = "agent-" + hashlib.sha1(str(idea.get("description") or ctx.run["id"]).strip().lower().encode()).hexdigest()[:12]
    idea["history_business"] = ctx.run["business_id"]      # where its draft is kept, a separate idea's too
    await fill_validation_form(ctx, idea)
    feature = "idea_validation_comprehensive" if depth == "comprehensive" else "idea_validation"
    r = await _studio(ctx, feature, ctx.rt.studio.validate_idea(user_id=ctx.actor.user_id,
                                                                 business_id=None if separate else ctx.run["business_id"], idea=idea))
    # PRD 5.2 (the owner's QA, 16 Oct): with the economics it needs unknown, no score is given, never a low one: what is
    # missing is said instead, and the risks and next steps still are. Said on the saved draft too (the owner's QA, 21 Oct:
    # the results page showed it as 0, "Risky").
    gaps = economics_gaps(idea, ctx.answers)
    if gaps:
        r = {**r, "evidence": "insufficient", "gaps": gaps}
    if separate:
        await _keep_separate_idea(ctx, idea, r)
        await _draft_in_history(ctx, idea, r)
    else:
        await _keep(ctx, "validation", {k: v for k, v in r.items() if k not in ("payload", "quick")})
        await _draft_in_history(ctx, idea, r)
    from app.modules.agent.services import risk_sentence
    risks, steps = [risk_sentence(x) for x in r.get("risks") or []], [str(x) for x in r.get("next_steps") or []]
    guessed = [words for key, words in ECONOMICS if key in (idea.get("estimated") or [])]
    head = ((f"Not enough evidence to score this idea yet. Still needed: {_and_list(gaps)}. "
             f"{len(risks)} risk{'s' if len(risks) != 1 else ''} and {len(steps)} next step{'s' if len(steps) != 1 else ''} found so far.")
            if gaps else
            f"Idea scored {r['score']}/100: {len(risks)} risk{'s' if len(risks) != 1 else ''}, {len(steps)} next step{'s' if len(steps) != 1 else ''}."
            + (f" I estimated the {_and_list(guessed)} ({idea.get('estimate_basis') or 'typical for this kind of business'}): change them on Idea Validation and I'll score it again."
               if guessed else ""))
    summary = (head
               + (f" Biggest risk: {risks[0].rstrip('.')}." if risks else "") + (f" First step: {steps[0].rstrip('.')}." if steps else "")
               + (" The full report, with its research, will be on Idea Validation in a few minutes." if r.get("full_report") == "pending" else ""))
    # The results dashboard, and the form to change the answers (the owner, 26 Oct: "there should be option to load the
    # validation result dashboard")
    saved = f"/validation?history_id={idea['history_id']}&history_type=v4_validation" if idea.get("history_id") else None
    links = ([{"label": "the validation results", "to": f"{saved}&view=results", "primary": True}, {"label": "the Idea Validation form", "to": saved}]
             if saved else [{"label": "the Idea Validation form", "to": "/validation"}])
    if depth == "basic":
        plan = await ctx.rt.meter.plan(ctx.actor.user_id)
        if plan == "explorer":
            summary += (" This is the Basic check, worked out from your numbers (free). Comprehensive validation checks your market, competitors,"
                        " pricing and unit economics. Available on Starter.")
            links += [{"label": "Upgrade to validate fully", "to": "/pricing", "upgrade": True}]
        else:
            summary += " As you asked, I ran the quick Basic check (free). Ask me to validate it fully when you want the market research."
    return Done(plain(summary),
                next_action="I'll score it again when what you've told me about the business changes.",
                outcome={"score": r["score"], "risks": risks, "next_steps": steps, "form_filled": True, "depth": depth, "links": links,
                         # its estimated figures, offered back to the idea for the owner to approve (the owner, 29 Oct)
                         "estimates": {k: (idea.get("known") or {}).get(k) for k in (idea.get("estimated") or []) if (idea.get("known") or {}).get(k) is not None},
                         "estimate_basis": idea.get("estimate_basis")})


async def _as_draft(ctx, kind: str, title: str, tab: str, document_id: str | None, inputs: dict | None = None) -> str:
    """The output as a draft in its module, pending the owner's review, with the link that opens it: counted in Needs
    Approval until it is accepted or rejected (the owner's QA, 15 Oct)."""
    from app.modules.agent import drafts
    to = f"/blueprint?tab={tab}" + (f"&document_id={document_id}" if document_id else "")

    def _apply(data: dict) -> dict:
        return drafts.add(data, kind=kind, title=title, to=to, run_id=ctx.run["id"], ref=str(document_id or ctx.run["id"]), now=ctx.now(), inputs=inputs)
    d = await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    ctx.run.setdefault("state", {})["draft"] = {"id": d["id"], "status": d["status"]}
    return to + f"&review={d['id']}"


async def _draft_in_history(ctx, idea: dict, r: dict) -> None:
    """The Agent's validation as a draft in Idea Validation History: the filled form and its score, pending until the owner
    accepts or rejects it there (as one run from the page is). The full report updates it when it is ready."""
    payload, quick = r.get("payload"), r.get("quick") or {}
    if not payload or not idea.get("history_id"):
        return
    entry = {"id": idea["history_id"], "type": "v4_validation", "title": (payload.get("step1") or {}).get("idea_name") or "Idea Validation",
             "created_at": ctx.now().isoformat(), "status": "pending", "score": r.get("score"), "confidence": r.get("confidence"), "verdict": r.get("verdict"),
             "journey": idea.get("depth") or payload.get("validation_mode") or "basic", "payload": payload, "result": quick, "source": "agent", "run_id": ctx.run["id"],
             "full_report": r.get("full_report") or "pending",
             # not scored: what it still needs, said on the results page instead of a 0 (the owner's QA, 21 Oct)
             **({"evidence": "insufficient", "gaps": r["gaps"], "result": {**quick, "insufficient": True, "gaps": r["gaps"]}} if r.get("gaps") else {})}

    def _apply(data: dict) -> None:
        history = [e for e in data.get("validation_history") or [] if isinstance(e, dict) and e.get("id") != entry["id"]]
        data["validation_history"] = [entry, *history]
    try:
        await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
        from app.modules.agent import drafts
        to = f"/validation?history_id={entry['id']}&history_type=v4_validation"
        d = await ctx.rt.business.mutate(ctx.run["business_id"], lambda data: drafts.add(data, kind="idea_validation", title=entry["title"], to=to,
                                                                                        run_id=ctx.run["id"], ref=entry["id"], now=ctx.now()))
        ctx.run.setdefault("state", {})["draft"] = {"id": d["id"], "status": d["status"]}
    except Exception:      # noqa: BLE001 - the score stands on the task either way
        logger.warning("idea validation draft not saved to History for %s", ctx.run["business_id"], exc_info=True)


async def _fill_whole_form(ctx, idea: dict) -> dict:
    """Every question on the Idea Validation form that is still empty, answered by the Agent (validation_fill), kept on the
    idea so the form the owner opens and the validation that runs are the same (the owner, 26 Oct: "many things are empty")."""
    from app.modules.agent import research, validation_fill
    from app.modules.agent.services import validation_payload
    form = {k: v for k, v in validation_payload(idea, None).items() if k.startswith("step") and isinstance(v, dict)}
    if len(str(idea.get("description") or "").split()) <= 4:      # only its name: the descriptions are the Agent's to write
        for s, f in (("step1", "idea_tagline"), ("step1", "idea_description"), ("step5", "solution_description")):
            (form.get(s) or {}).pop(f, None)
    facts = {k: idea.get(k) for k in ("name", "description", "customer", "problem", "industry", "location", "country", "currency") if idea.get(k)}
    facts.update({k: v for k, v in (idea.get("known") or {}).items() if k in ("price", "cost", "monthly_sales") and v})
    filled, took = await validation_fill.fill(research._default_llm(ctx.actor.user_id), form, facts)
    if not took:
        return idea
    fill: dict = {}
    for key in took:      # only what the Agent answered, never the owner's own words again
        s, f = key.split(".", 1)
        fill.setdefault(s, {})[f] = filled[s][f]
    return {**idea, "form_fill": fill}


async def fill_validation_form(ctx, idea: dict) -> None:
    """The Idea Validation form, filled from what the owner said in the chat (and the records, for their own business):
    the wizard's own steps, the same ones the score is worked out from. The page fills only the fields still empty, once
    per task, and says so; nothing the owner typed there is replaced. Never a reason for the validation not to run."""
    from app.modules.agent.services import validation_payload
    form = {k: v for k, v in validation_payload(idea, None).items() if k.startswith("step") and k != "steps_completed" and isinstance(v, dict)}
    if not form:
        return

    def _apply(data: dict) -> None:
        data["agent_validation_form"] = {"form": form, "run_id": ctx.run["id"], "at": ctx.now().isoformat(),
                                         "idea": str(idea.get("description") or "")[:200]}
    try:
        await ctx.rt.business.mutate(ctx.run["business_id"], _apply)
    except Exception:      # noqa: BLE001
        logger.warning("idea validation form not filled for %s", ctx.run["business_id"], exc_info=True)


async def market_size_step(ctx):
    data = await _business_and_launch(ctx)
    data, clash = await _with_owner_words(ctx, data)
    if clash:
        return clash
    idea, separate = await _idea_for(ctx, data)
    idea = await _fill_idea(ctx, idea) if idea.get("description") else idea
    idea.pop("_filled", None)
    ask = _ask_idea(idea, ("description", "industry", "location"))
    if ask:
        return ask
    # C8: charged only for a market actually sized. The figures are checked inside the charge, so research that comes
    # back with words and no figures ("an active category") is released, not charged. A3: never more than a few minutes.
    r: dict = {}
    try:
        # Charged as the price shown (credit allocation v2: market research is part of the Comprehensive validation).
        async with ctx.orch.charge_once(ctx.run, ctx.actor.user_id, "idea_validation_comprehensive", f"market_size:{ctx.run['id']}", "market_size"):
            r = await asyncio.wait_for(ctx.rt.studio.size_market(user_id=ctx.actor.user_id, business_id=ctx.run["business_id"], idea=idea),
                                       timeout=MARKET_SIZE_SECONDS)
            if not any(_is_figure(r.get(k)) for k in ("tam", "sam", "som")):
                raise _NoFigures()
    except _NoFigures:
        return Done("I couldn't size this market: the research came back without figures I can stand behind. Nothing was charged.",
                    next_action="Tell me the region and who exactly you sell to, and I'll try again.",
                    outcome={"reason": "no_market_figures", "sources": r.get("sources") or []}, skipped=True)
    except asyncio.TimeoutError:
        return Done("I couldn't size this market in time: the research took too long. Nothing was charged.",
                    next_action="Ask me again in a little while.", outcome={"reason": "market_size_timeout"}, skipped=True)
    r = {**r, **{k: (r.get(k) if _is_figure(r.get(k)) else None) for k in ("tam", "sam", "som")}}
    if separate:
        await _keep_separate_idea(ctx, idea, {"kind": "market", **r})
    else:
        await _keep(ctx, "market", r)
    assumed, sources = r.get("assumptions") or [], r.get("sources") or []
    sizing = market_sizing(r)
    sized = "; ".join(f"{s['level']} {s['value']}" for s in sizing if s["value"])
    return Done(plain(f"Market sized (estimated): {sized}. {len(sources)} source{'s' if len(sources) != 1 else ''}, {len(assumed)} assumption{'s' if len(assumed) != 1 else ''}. "
                      "Each figure shows its formula; none is corroborated by checked sources yet, so confirm them before relying on them."),
                next_action=None, outcome={"market": r, "sizing": sizing, "links": [{"label": "Idea Validation", "to": "/validation"}]})


def market_sizing(r: dict) -> list[dict]:
    """§5: TAM, SAM and SOM, each with its formula, inputs and sources, and its label. A figure the research service read
    from search results, with no quote checked on its page, is Estimated; a level with no figure is Missing."""
    from app.modules.agent import credibility
    srcs = [{"title": s.get("title"), "url": s.get("url"), "tier": credibility.tier_of(s.get("url") or ""),
             "publisher": credibility.host_of(s.get("url") or "")} for s in r.get("sources") or [] if isinstance(s, dict) and s.get("url")]
    srcs = [s for s in srcs if s["tier"]]
    assumed = r.get("assumptions") or []
    formulas = {"TAM": r.get("tam_basis") or (assumed[0] if assumed else ""), "SAM": r.get("sam_basis") or (assumed[1] if len(assumed) > 1 else ""),
                "SOM": r.get("som_basis") or (assumed[2] if len(assumed) > 2 else "")}
    out = []
    for key, level in (("tam", "TAM"), ("sam", "SAM"), ("som", "SOM")):
        value = r.get(key)
        out.append({"level": level, "value": value, "label": "Estimated" if value else "Missing", "formula": formulas[level] or "Not stated by the research",
                    "inputs": [a for a in assumed if a], "sources": srcs if value else []})
    return out


MARKET_SIZE_SECONDS = 180


class _NoFigures(Exception):
    pass


def _is_figure(value) -> bool:
    """A market size that is a figure (£2.4bn, 180,000 businesses, $3m), not words about one."""
    return bool(re.search(r"\d", str(value or "")))


_PLAN_LOCKS: dict[tuple[str, str], asyncio.Lock] = {}
REUSE_ASKED_PLAN_SECONDS = 600      # an asked-for plan the same as one made this recently is that one, asked twice


def _plan_on_record(data: dict, key: str | None) -> dict | None:
    """The plan already made for this idea (a separate idea's own record) or for the business itself."""
    plan = ((data.get("agent_ideas") or {}).get(key) or {}).get("plan") if key else (data.get("agent_studio") or {}).get("plan")
    return plan if isinstance(plan, dict) and plan.get("document_id") else None


_OFFERING_STOP = {"business", "businesses", "service", "services", "company", "with", "from", "that", "this", "their", "your", "they", "them", "offer",
                  "offers", "provide", "provides", "small", "local", "help", "helps", "people", "customers", "clients", "quality", "professional"}


# What a service does, said of many offerings alike: "Drone cleaning" and "car cleaning" are not the same offering (the owner,
# 27 Oct: the Drone Cleaning plan was about "car cleaning for busy office workers")
_ACTIVITY = {"cleaning", "clean", "cleaner", "cleaners", "washing", "wash", "repair", "repairs", "delivery", "care", "management", "consulting",
             "consultancy", "installation", "maintenance", "hire", "rental", "sales", "supply", "shop", "store", "and", "the", "for", "our", "mobile",
             "home", "office", "online"}
_WHERE_WHO = re.compile(r"\b(?:in|for|at|to|across|around|near|within|serving)\b.*$", re.I)


def _shares_offering(a: str, b: str) -> bool:
    """Two descriptions of the same offering share a word that says what it is ("car" in "car wash" and "a mobile car wash in
    Abuja"): only what it is counts, never who it is for, where, or what kind of work it is."""
    def words(t: str) -> set[str]:
        core = _WHERE_WHO.sub("", str(t or "").lower())
        return {w for w in re.findall(r"[a-z]{3,}", core) if w not in _OFFERING_STOP and w not in _ACTIVITY}
    return bool(words(a) & words(b))


async def _idea_for(ctx, data: dict) -> tuple[dict, bool]:
    """The idea a task is about, and whether it is a separate one (A2). F1: a plan, a letter or a market size for an idea
    other than the business's own is that idea's: only what was said about it, named for it (never the business's
    name), and kept on its own record."""
    separate = await separate_idea(ctx, data)
    said = owner_said(ctx)
    purpose = (ctx.params or {}).get("purpose")      # who the plan is for, asked before it started
    plan = dict(data.get("_launch") or {})
    if not plan.get("offering") and plan.get("title"):
        plan["offering"] = str(plan["title"]).split(",")[0].strip()      # "Monthly car wash subscription, Abuja, January 2027"
    if (ctx.params or {}).get("subject_id") and plan.get("offering"):
        # Started from a launch plan (the owner's QA, 23 Oct: "it should be about the product, I clicked draft business plan
        # on the launch readiness page"): that plan's offering, customer, problem and place. Another offering than the
        # business's own is a separate idea: nothing of the business's own offer is borrowed.
        from app.modules.agent import answer_memory
        own = idea_of(data, {})
        answers = {k: v for k, v in {"description": plan["offering"], "customer": plan.get("customer"), "problem": plan.get("problem"),
                                     "location": plan.get("location")}.items() if v}
        if not own.get("description") or answer_memory.same_offering(plan["offering"], own.get("description")):
            # The business's own offering: still a plan about the product, named for it, never for the business (the owner, 23 Oct)
            product = str(plan["offering"]).strip()
            return {**idea_of(data, {**ctx.answers, **answers}), "description": product, "name": product[:60], "said": said, "purpose": purpose,
                    "launch_product": True}, False
        idea = {k: str(answers.get(k) or ctx.answers.get(k) or "").strip() for k in ("description", "customer", "problem", "industry", "location")}
        idea.update({"name": idea["description"][:60], "currency": own.get("currency") or "GBP", "said": said, "separate": True, "purpose": purpose})
        return idea, True
    if not separate:
        # Their own words chosen over a profile that speaks of something else (G1): the writer is told so too. So is an
        # offering said for this task that isn't the one the profile describes (the owner, 27 Oct: "Business Plan for Land
        # Clearing" with an executive summary about balcony washing): their words, never the other offering's
        mine = idea_of(data, ctx.answers)
        profiled = idea_of(data, {})
        said_offering = str(ctx.answers.get("description") or "").strip()
        differs = bool(said_offering and profiled.get("description") and not _shares_offering(said_offering, profiled["description"]))
        clash = ctx.answers.get("profile_conflict") == "said" or differs
        return {**mine, "said": said, "purpose": purpose, **({"profile_clash": True} if clash else {})}, False
    own = idea_of(data, {})
    idea = {k: str(ctx.answers.get(k) or "").strip() for k in ("description", "customer", "problem", "industry", "location")}
    idea.update({"name": idea["description"][:60], "currency": own.get("currency") or "GBP", "said": said, "separate": True})
    return idea, True


def owner_said(ctx) -> str:
    """Everything the owner said for this task in the chat, in their own words: the messages before the request, the
    request, and their answers to its questions. The document is written from these first; the profile fills the rest."""
    state = ctx.run.get("state") or {}
    lines = [f"Earlier in the chat: {t}" for t in state.get("said_before") or [] if str(t).strip()]
    if str(ctx.run.get("goal") or "").strip():
        lines.append(f"The request: {str(ctx.run['goal']).strip()}")
    labels = {k: v[1] for k, v in _IDEA_QUESTIONS.items()}
    for key, value in (ctx.answers or {}).items():
        if key in labels and str(value or "").strip():
            lines.append(f"{labels[key]}: {str(value).strip()}")
    return "\n".join(lines)[:3000]


_FILL_SYSTEM = ("You fill in the inputs of a small business's plan from a short description. Reply with JSON only: "
                '{"name": "...", "problem": "...", "customer": "...", "value_prop": "...", "industry": "..."}. name: the idea in two to five words, '
                "spelled correctly, as the owner meant it (for example 'window cleanig' is 'Window cleaning'). problem: the customer problem it solves, one sentence. "
                "customer: who buys it, specific (who and where). value_prop: why they would choose it, one sentence. industry: two or three words "
                "(for example 'Commercial cleaning'). Only about the idea described; never about another business. Plain words, no dashes.")


_ESTIMATE_SYSTEM = ("You estimate the basic figures of a small business idea, for a first viability check. Given the idea, who it is "
                    "for, where and the currency, return JSON only: {\"price\": number, \"cost\": number, \"monthly_sales\": number, "
                    "\"basis\": \"one short phrase on what the estimate rests on\"}. price: what one sale costs a customer; cost: the direct "
                    "cost of delivering one sale (materials, labour, travel); monthly_sales: how many sales a new small business like this "
                    "makes in a month. Typical, conservative figures for that place, in that currency, as plain numbers. Use null for any "
                    "figure you can't estimate sensibly.")


async def _estimate_economics(ctx, idea: dict) -> dict:
    """Price, cost per sale and sales a month, for the ones neither the owner nor the records give: one short model call,
    each checked for sense, marked as estimated. Nothing is estimated without a model; the check then says what is missing."""
    known = dict(idea.get("known") or {})
    want = [k for k, _w in ECONOMICS if not _positive(known.get(k)) and not _positive((ctx.answers or {}).get(k))]
    if not want or not idea.get("description"):
        return idea
    try:
        import json
        from app.modules.agent import research
        llm = research._default_llm(ctx.actor.user_id)
        if llm is None:
            return idea
        facts = {k: idea.get(k) for k in ("description", "customer", "location", "industry", "currency") if idea.get(k)}
        facts.update({k: known[k] for k in ("price", "cost", "monthly_sales") if _positive(known.get(k))})      # what is on record
        res = await asyncio.wait_for(llm.generate_text(system=_ESTIMATE_SYSTEM, prompt="IDEA:\n" + json.dumps(facts, ensure_ascii=False)[:2000],
                                                       feature="agent_plan_inputs", max_tokens=200), timeout=20)
        m = re.search(r"\{.*\}", str(getattr(res, "text", "") or ""), re.S)
        got = json.loads(m.group(0)) if m else {}
    except Exception:      # noqa: BLE001 - said as still needed instead
        logger.info("idea figures not estimated for %s", ctx.run.get("id"), exc_info=True)
        return idea
    price = _num_or_none(got.get("price")) if "price" in want else _num_or_none(known.get("price"))
    took = []
    for k in want:
        v = _num_or_none(got.get(k))
        if v is None or v <= 0:
            continue
        if k == "cost" and price and v >= price * 1.5:
            continue      # a cost far above the price is not an estimate to score from
        if k == "monthly_sales" and v > 100000:
            continue
        known[k] = round(v, 2) if k != "monthly_sales" else round(v)
        took.append(k)
    if not took:
        return idea
    basis = " ".join(str(got.get("basis") or "").split())[:120]
    return {**idea, "known": known, "estimated": took, **({"estimate_basis": basis} if basis else {})}


def _positive(v) -> bool:
    try:
        return float(v) > 0
    except (TypeError, ValueError):
        return False


def _num_or_none(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


async def _fill_idea(ctx, idea: dict) -> dict:
    """The plan's inputs the owner did not give, worked out from what the plan is about (the owner's QA, 23 Oct: a window
    cleaning plan was drafted as "Consulting", with no problem and its name as the value proposition). One short model call;
    what the owner or a launch plan already gave is kept. Changeable afterwards in the plan's inputs."""
    missing = [k for k in ("problem", "customer", "value_prop", "industry") if not str(idea.get(k) or "").strip() or idea.get(f"{k}_guessed")]
    if not idea.get("description"):
        return idea
    try:
        import json
        from app.modules.agent import research
        llm = research._default_llm(ctx.actor.user_id)
        if llm is None:
            return idea
        prompt = "IDEA:\n" + json.dumps({k: idea.get(k) for k in ("description", "customer", "problem", "location", "said") if idea.get(k)}, ensure_ascii=False)[:3000]
        res = await asyncio.wait_for(llm.generate_text(system=_FILL_SYSTEM, prompt=prompt, feature="agent_plan_inputs", max_tokens=400), timeout=25)
        m = re.search(r"\{.*\}", str(getattr(res, "text", "") or ""), re.S)
        got = json.loads(m.group(0)) if m else {}
    except Exception:      # noqa: BLE001 - drafted from what there is
        logger.info("plan inputs not filled for %s", ctx.run.get("id"), exc_info=True)
        return idea
    out = {**idea, "_filled": True}
    for k in missing:
        v = " ".join(str(got.get(k) or "").split())[:400]
        if v and v.lower() not in ("null", "none", "unknown"):
            out[k] = v
    # The idea as the owner meant it, spelling corrected (the owner's QA, 23 Oct: "cos I mean cleaning"): only when it is
    # plainly the same words, never another idea
    name = " ".join(str(got.get("name") or "").split())[:80]
    if name and _same_words(name, str(idea.get("description") or "")):
        if idea.get("separate") or len(str(idea.get("description") or "")) <= 60:
            out["description"] = name if len(str(idea.get("description") or "")) <= 60 else idea["description"]
        out["name"] = name if idea.get("separate") else idea.get("name") or name
    return out


def _same_words(a: str, b: str) -> bool:
    """"Window cleaning" and "window cleanig": the same words, a typo apart."""
    import difflib
    wa, wb = re.findall(r"[a-z]+", a.lower()), re.findall(r"[a-z]+", b.lower())
    if not wa or not wb:
        return False
    return difflib.SequenceMatcher(None, " ".join(wa), " ".join(wb)).ratio() >= 0.75


async def business_plan_step(ctx):
    data = await _business_and_launch(ctx)
    data, clash = await _with_owner_words(ctx, data)
    if clash:
        return clash
    idea, separate = await _idea_for(ctx, data)
    # The Agent fills and drafts (the owner's QA, 23 Oct: "agent should fill all these things, draft the business plan; I can
    # still modify the inputs on Blueprints"): its best reading of who the customer is is used as it is, never asked; a
    # missing one is left to the plan, written from the business. Only an idea with nothing to go on is asked about.
    if not idea.get("description"):
        ask = _ask_idea(idea, ("description",))
        if ask:
            return ask
    idea = await _fill_idea(ctx, {**idea, "customer_guessed": False, "description_guessed": False})
    idea.pop("_filled", None)
    key = _idea_key(idea.get("description")) if separate else None
    import hashlib
    import json as _json
    # What this draft is written from: the idea's fields and the owner's own words (the same request asked twice is the same).
    inputs = hashlib.sha256(_json.dumps({k: idea.get(k) for k in ("description", "customer", "problem", "industry", "location")}, sort_keys=True,
                                        default=str).encode()).hexdigest()[:16]

    def reusable(found: dict | None) -> dict | None:
        """F1: tasks asked twice (or started by the Agent again) share one document. Only an owner's own request for a
        new draft, some time after the last one, makes another."""
        if not found:
            return None
        from app.modules.agent import autostart
        if ctx.run.get("source_channel") == autostart.CHANNEL:
            return found
        if found.get("inputs") and found["inputs"] != inputs:
            return None      # new details from the owner: a new draft from them, never the last one again
        made = bz._moment(found.get("at"))
        return found if made and (ctx.now() - made).total_seconds() < REUSE_ASKED_PLAN_SECONDS else None

    lock = _PLAN_LOCKS.setdefault((ctx.run["business_id"], key or ""), asyncio.Lock())
    async with lock:      # two tasks at once for the same idea: the second waits, then uses the first one's document
        r = reusable(_plan_on_record(await ctx.rt.business.load(ctx.run["business_id"]) or data, key))
        reused = bool(r)
        if not r:
            r = await _generated(ctx, "business_plan_full", ctx.rt.studio.draft_plan(user_id=ctx.actor.user_id, business_id=ctx.run["business_id"], idea=idea), idea)
            if isinstance(r, Stop):
                return r
            r = {**r, "inputs": inputs}
            if separate:
                await _keep_separate_idea(ctx, idea, {"kind": "plan", **r}, plan=r)
            else:
                await _keep(ctx, "plan", r)
            # Named for what it is about: the launch's offering, else the business (the owner's QA, 23 Oct: "Business plan: Business plan")
            # A launch's plan is named for its product (the owner, 23 Oct: "uses the product not the business")
            named = (idea.get("name") if (ctx.params or {}).get("subject_id") else None) or r.get("title") or idea.get("name") or idea.get("description") or "Business plan"
            r["to"] = await _as_draft(ctx, "business_plan", named,
                                      "business-plans", r.get("document_id"),
                                      inputs={"company_name": idea.get("name"), "industry": idea.get("industry"), "problem": idea.get("problem"),
                                              "solution": idea.get("description"), "target_market": idea.get("customer"), "location": idea.get("location"),
                                              "value_prop": idea.get("value_prop"), "subject_id": (ctx.params or {}).get("subject_id"),
                                              "services": [idea["description"]] if idea.get("separate") and idea.get("description") else None})
    if reused:
        return Done("You already have this business plan draft" + (f" ({r['title']})" if r.get("title") else "") + ", so I haven't made another. Nothing was charged.",
                    next_action="Ask me to redraft it when you want a new version.",
                    outcome={"plan": r, "reused": True, "links": [{"label": "Business plan", "to": "/blueprint?tab=business-plans", "primary": True}]}, skipped=True)
    return Done("Your business plan is ready to review" + (f": {r['sections']} sections" if r.get("sections") else "") + ".",
                next_action="Review it: accept it, edit it or reject it.",
                outcome={"plan": r, "links": [{"label": "draft business plan", "to": r.get("to") or "/blueprint?tab=business-plans", "primary": True}]})      # See details opens it (26 Oct)


async def sales_letter_step(ctx):
    data = await _business_and_launch(ctx)
    data, clash = await _with_owner_words(ctx, data)
    if clash:
        return clash
    idea, separate = await _idea_for(ctx, data)
    idea = await _fill_idea(ctx, idea) if idea.get("description") else idea
    if idea.pop("_filled", False):
        idea = {**idea, "customer_guessed": False, "description_guessed": False}
    ask = _ask_idea(idea, ("description", "customer"))
    if ask:
        return ask
    r = await _generated(ctx, "sales_letter_full", ctx.rt.studio.draft_sales_letter(user_id=ctx.actor.user_id, business_id=ctx.run["business_id"], idea=idea), idea)
    if isinstance(r, Stop):
        return r
    if separate:
        await _keep_separate_idea(ctx, idea, {"kind": "sales_letter", **r})
    else:
        await _keep(ctx, "sales_letter", r)
    return Done("Sales letter draft ready for review" + (f": {r['sections']} sections" if r.get("sections") else "") + ". Nothing has been sent to anyone.",
                next_action="Open it in Business Blueprints to edit, copy or download it.",
                outcome={"sales_letter": r, "links": [{"label": "Sales letter", "to": "/blueprint?tab=sales-docs"}]})


# ── Growth stage: capacity, what sells, and growing ────────────────────────────

def _paid(data: dict, since) -> list[dict]:
    out = []
    for inv in (data.get("financials") or {}).get("invoices") or []:
        if not isinstance(inv, dict) or inv.get("archived") or bz.status_of(inv) not in ("paid", "delivered"):
            continue
        d = bz.parse_day(inv.get("paid_at") or inv.get("issued_at") or inv.get("issue_date") or inv.get("created_at"))
        if not d or d >= since:
            out.append(inv)
    return out


async def capacity_check_step(ctx):
    data = await ctx.rt.business.load(ctx.run["business_id"])
    jobs = len(_paid(data, ctx.now().date() - timedelta(days=92)))
    planned_note = ""
    if not jobs:
        # B6: no work paid for yet: checked against the planned sales a month, said as planned.
        from app.modules.agent import planned as pl
        pm = await _planned(ctx)
        fig = pm["figures"]
        stated_cap = ctx.answers.get("capacity") or (data.get("workspace_profile") or {}).get("monthly_capacity") or fig.get("capacity")
        missing = [k for k, have in (("monthly_sales", fig.get("monthly_sales")), ("capacity", stated_cap)) if not have]
        if missing:
            return _ask_planned("No work is paid for yet, so I'll check your capacity against your planned sales. What are they?", missing)
        jobs, planned_note = fig["monthly_sales"] * 3, pl.said(pm["sources"], "monthly_sales", "capacity")
        ctx.answers.setdefault("capacity", stated_cap)
    stated = ctx.answers.get("capacity") or (data.get("workspace_profile") or {}).get("monthly_capacity")
    if stated in (None, ""):
        return WaitForInput("How many jobs can you deliver in a month, at most?", [{
            "key": "capacity", "label": "Jobs a month", "type": "number", "required": True,
            "hint": "I can count what you delivered; only you know how much you could."}])
    capacity, monthly = max(0.0, float(stated)), round(jobs / 3, 1)
    room = round(capacity - monthly, 1)
    used = round(monthly / capacity * 100) if capacity else 0
    text = (f"You delivered about {monthly:g} job{'s' if monthly != 1 else ''} a month against a capacity of {capacity:g}: "
            + (f"room for about {room:g} more ({used}% used)." if room > 0 else f"you are at or over capacity ({used}% used), so more work means more hands or longer lead times."))
    if planned_note:
        text = "Planned figures, as no work is paid for yet. " + text.replace("You delivered about", "You plan about") + f" (Planned: {planned_note}.)"
    return Done(text, next_action="I'll check again next month.", outcome={"jobs_per_month": monthly, "capacity": capacity, "room": room, "used_pct": used,
                                                                          **({"planned": True} if planned_note else {})})


def _what_it_was(inv: dict) -> str:
    names = inv.get("product_names") or [li.get("description") for li in inv.get("line_items") or [] if isinstance(li, dict)]
    return str((names or [inv.get("description") or ""])[0] or "").strip()


async def offer_review_step(ctx):
    data = await ctx.rt.business.load(ctx.run["business_id"])
    amt = lambda v: fmt_money(v, bz.currency_of(data))      # noqa: E731
    sold: dict[str, float] = {}
    for inv in _paid(data, ctx.now().date() - timedelta(days=92)):
        name = _what_it_was(inv)
        if name:
            sold[name] = sold.get(name, 0) + bz.invoice_total(inv)
    if not sold and not _paid(data, ctx.now().date() - timedelta(days=92)):
        # B6: nothing sold yet: the planned offer, with its planned margin, instead of a dead end.
        from app.modules.agent import planned as pl
        pm = await _planned(ctx)
        fig = pm["figures"]
        if fig.get("price") and fig.get("monthly_sales"):      # a plan of the owner's, not only a catalogue price
            offer = str(idea_of(data).get("description") or "Your offer").strip()
            text = (f"Nothing has sold yet, so there is no best seller to name. Planned: {offer[:80]} at {amt(fig['price'])}"
                    + (f", a {round(pm['margin'] * 100)}% margin" if pm.get("margin") else "")
                    + (f", {fig['monthly_sales']:g} sales a month" if fig.get("monthly_sales") else "") + f" ({pl.said(pm['sources'], 'price', 'cost', 'monthly_sales')}).")
            return Done(text, next_action="Once sales are on record I'll show what actually sells.",
                        outcome={"planned": True, "price": fig["price"], "links": [{"label": "Catalogue", "to": "/catalogue"}]})
    if not sold:
        return Done("To review what sells I need invoices that say what they were for, and those paid in the last three months don't.",
                    next_action="Ask me for your next invoice with its items and I'll review what sells from there.", outcome={"reason": "no_item_detail", "check": "more_customers"}, skipped=True)
    total = sum(sold.values())
    best, earned = max(sold.items(), key=lambda kv: kv[1])
    listed = [str(p.get("name") or "").strip() for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict) and p.get("name")]
    quiet = [n for n in listed if n.lower() not in {k.lower() for k in sold}]
    text = f"Your best seller is {best}: {amt(earned)} in three months, {round(earned / total * 100)}% of paid revenue."
    if quiet:
        text += f" {len(quiet)} catalogue item{'s have' if len(quiet) != 1 else ' has'} not sold in that time: {', '.join(quiet[:4])}{' and more' if len(quiet) > 4 else ''}."
    return Done(text, next_action="I'll review it again next month.",
                outcome={"best_seller": best, "revenue": bz.money(earned), "share_pct": round(earned / total * 100), "not_selling": quiet,
                         "links": [{"label": "Catalogue", "to": "/catalogue"}]})


async def expansion_step(ctx):
    data = await ctx.rt.business.load(ctx.run["business_id"])
    amt = lambda v: fmt_money(v, bz.currency_of(data))      # noqa: E731
    today = ctx.now().date()
    monthly = bz.money(sum(bz.revenue_by_customer(data, since=today - timedelta(days=92)).values()) / 3)
    burn = bz.cash_position(data, today)["monthly_burn"]
    planned_note = ""
    if monthly <= 0:
        # B6: no revenue yet: growth is modelled on the planned month, said as planned.
        from app.modules.agent import planned as pl
        pm = await _planned(ctx)
        fig = pm["figures"]
        missing = [k for k in ("price", "monthly_sales") if not fig.get(k)] + (["fixed_costs"] if pm.get("costs") is None and not burn else [])
        if missing:
            return _ask_planned("You have no revenue on record yet, so I'll model growing on your planned figures. What are they?", missing)
        monthly, burn = bz.money(pm["revenue"]), burn or bz.money(pm.get("costs") or 0)
        planned_note = pl.said(pm["sources"], "price", "monthly_sales", "fixed_costs", "cost")
    more, cost = bz.money(monthly * 0.20), bz.money(burn * 0.10)
    before, after = bz.money(monthly - burn), bz.money(monthly + more - burn - cost)
    return Done(("Planned figures, as there is no revenue on record yet. " if planned_note else "")
                + f"Growing revenue by 20% adds {amt(more)} a month. If costs rise 10% with it ({amt(cost)}), you keep {amt(more - cost)} of that: "
                f"monthly net goes from {amt(before)} to {amt(after)}." + (f" (Planned: {planned_note}.)" if planned_note else ""),
                next_action="I'll work it out again next month.",
                outcome={"extra_revenue": more, "extra_cost": cost, "net_before": before, "net_after": after,
                         "links": [{"label": "Full scenario in Simulation", "to": "/simulation"}]})


def _prep(key: str, title: str, step_title: str, handler) -> WorkflowDefinition:
    return WorkflowDefinition(workflow_key=key, version=1, capability=key, family="Launch & Funding", title=title, autonomy=A1_ASSIST,
                              triggers=_PREP_TRIGGERS, steps=[StepDefinition("prepare", step_title, handler)], tools=(),
                              success_condition="Prepared from the records and reported; nothing sent.")


READINESS_REFRESH = _prep("readiness_refresh", "Readiness Refresh", "Run the checks that are out of date", readiness_refresh_step)
LAUNCH_EVIDENCE_GAPS = _prep("launch_evidence_gaps", "Launch Evidence Gaps", "List what the launch evidence is missing", launch_gaps_step)
FUNDING_PACK_DRAFT = _prep("funding_pack_draft", "Funding Pack Draft", "Draft the funding pack", funding_pack_step)
REGISTRATION_CHECKLIST = _prep("registration_checklist", "Registration Checklist", "Prepare the registration checklist", registration_checklist_step)


WORKFLOWS: dict[str, WorkflowDefinition] = {w.workflow_key: w for w in [
    ENQUIRY_TO_QUOTE, QUOTE_TO_CASH, PAYMENT_FOLLOWUP, RECEIPT_SEND, RISK_CONCENTRATION, SCENARIO_HELP,
    READINESS_REFRESH, LAUNCH_EVIDENCE_GAPS, FUNDING_PACK_DRAFT, REGISTRATION_CHECKLIST, PRICE_TEST,
    _prep("idea_validation", "Idea Validation", "Score the idea", idea_validation_step),
    _prep("market_size", "Market Size", "Size the market", market_size_step),
    _prep("business_plan_draft", "Business Plan Draft", "Draft the business plan", business_plan_step),
    _prep("sales_letter_draft", "Sales Letter Draft", "Draft the sales letter", sales_letter_step),
    _prep("capacity_check", "Capacity Check", "Compare work delivered with capacity", capacity_check_step),
    _prep("offer_review", "Offer Review", "Review what sells", offer_review_step),
    _prep("expansion_scenario", "Expansion Scenario", "Model growing the business", expansion_step),
]}


def _register_new_documents() -> None:
    from app.modules.agent import newdocs      # it builds on this module's pieces, so it is added once both are loaded
    for w in newdocs.NEW_WORKFLOWS:
        WORKFLOWS[w.workflow_key] = w
    from app.modules.agent import moredocs
    for w in moredocs.MORE_WORKFLOWS:
        WORKFLOWS[w.workflow_key] = w


_register_new_documents()

# Agent inventory (s5): one Agent, many specialist capabilities. Only those with a
# registered workflow can execute; the rest are declared so routing never invents one.
INVENTORY = [
    {"family": "Sell & Revenue", "capability": "enquiry_to_quote", "label": "Enquiry-to-Quote", "posture": "Phase 1"},
    {"family": "Sell & Revenue", "capability": "quote_to_cash", "label": "Quote-to-Cash", "posture": "Phase 2"},
    {"family": "Sell & Revenue", "capability": "payment_followup", "label": "Payment Collection", "posture": "Phase 2"},
    {"family": "Sell & Revenue", "capability": "receipt_send", "label": "Receipt Sending", "posture": "Phase 2"},
    {"family": "Sell & Revenue", "capability": "proposal", "label": "Proposal", "posture": "Future"},
    {"family": "Sell & Revenue", "capability": "marketplace_rfq", "label": "Marketplace / RFQ", "posture": "Future"},
    {"family": "Plan & Launch", "capability": "business_planning", "label": "Business Planning", "posture": "Future"},
    {"family": "Plan & Launch", "capability": "launch", "label": "Launch", "posture": "Future"},
    {"family": "Plan & Launch", "capability": "funding_readiness", "label": "Funding Readiness", "posture": "Future"},
    {"family": "Decision Intelligence", "capability": "scenario_help", "label": "Scenario & Decision", "posture": "Early helper"},
    {"family": "Decision Intelligence", "capability": "risk_concentration", "label": "Risk & Fragility", "posture": "Early helper"},
    {"family": "Decision Intelligence", "capability": "growth", "label": "Growth", "posture": "Future"},
    {"family": "Decision Intelligence", "capability": "business_health", "label": "Business Health", "posture": "Future"},
    {"family": "Business Operations", "capability": "operational", "label": "Operational", "posture": "Future"},
]


# F4: what the Agent says it is doing, per task, in words that read after "I'm …" ("I'm updating your catalogue item").
DOING: dict[str, str] = {
    "add_catalogue_item": "adding an item to your catalogue", "add_customer": "adding your new customer", "add_vendor": "adding your new supplier",
    "update_record": "updating your records", "new_invoice": "preparing your invoice", "enquiry_to_quote": "preparing your quotation",
    "quote_to_cash": "turning your quotation into an invoice", "receipt_send": "preparing your receipt", "record_payment": "recording your payment",
    "credit_note": "preparing your credit note", "new_purchase_order": "preparing your purchase order", "supplier_bill": "recording your supplier bill",
    "record_expense": "recording your expense", "new_contract": "preparing your contract", "new_proposal": "preparing your proposal",
    "payment_followup": "preparing your payment reminders", "marketplace_profile": "updating your Marketplace profile",
    "marketplace_offering": "listing your item on the Marketplace", "price_test": "testing your prices", "capacity_check": "checking your capacity",
    "scenario_help": "running your scenario", "expansion_scenario": "modelling your expansion", "risk_concentration": "checking your risks",
    "offer_review": "reviewing what you sell", "idea_validation": "scoring your idea", "market_size": "sizing your market",
    "business_plan_draft": "drafting your business plan", "sales_letter_draft": "drafting your sales letter", "funding_pack_draft": "drafting your funding pack",
    "launch_evidence_gaps": "checking what your launch is missing", "readiness_refresh": "refreshing your readiness score",
    "registration_checklist": "preparing your registration checklist",
}
_RECORD_WORDS = {"item": "your catalogue item", "customer": "your customer", "vendor": "your supplier"}


def doing_of(run: dict) -> str:
    """ "updating your catalogue item": the task's own words, with the kind of record when it is a change to one."""
    key = run.get("workflow_key") or ""
    if key == "update_record":
        record = str(((run.get("state") or {}).get("answers") or {}).get("record") or "")
        kind = record.split(":", 1)[0] if ":" in record else ""
        if kind in _RECORD_WORDS:
            return f"updating {_RECORD_WORDS[kind]}"
    return DOING.get(key) or "working on your task"
