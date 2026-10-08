"""Deterministic email + document templates.

Every figure comes from the authoritative record snapshot in the approved
payload. Nothing here is LLM-generated, so no commercial fact can be invented
(s11 "no fabricated facts", AC-08).
"""
from __future__ import annotations

from html import escape
from typing import Any

_SYMBOLS = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦", "CAD": "C$", "AUD": "A$", "ZAR": "R", "INR": "₹", "KES": "KSh", "GHS": "GH₵"}


def fmt_money(amount: Any, currency: str = "GBP") -> str:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0.0
    sym = _SYMBOLS.get(str(currency or "GBP").upper())
    return f"{sym}{value:,.2f}" if sym else f"{value:,.2f} {str(currency).upper()}"


# ── Shared look for every document the Agent sends ────────────────────────────
# Emails use tables and inline styles only (what email clients reliably render) and a
# fluid 600px card, so they read well from phones to desktops without media queries.

_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_INK, _MUTED, _LINE, _BRAND, _SOFT = "#0f172a", "#64748b", "#e2e8f0", "#4f46e5", "#f8fafc"
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December")


def fmt_date(value: Any) -> str:
    """2026-11-02 -> 2 November 2026 (en-GB). Anything that isn't an ISO date is shown as given."""
    text = str(value or "").strip()
    try:
        y, m, d = (int(x) for x in text[:10].split("-"))
        return f"{d} {_MONTHS[m - 1]} {y}"
    except (ValueError, IndexError):
        return text


def fmt_qty(value: Any) -> str:
    """2.0 -> 2, 1.5 -> 1.5."""
    try:
        q = float(value if value not in (None, "") else 1)
    except (TypeError, ValueError):
        return str(value)
    return str(int(q)) if q.is_integer() else f"{q:g}"


def _contact_line(details: dict | None, reply_to: str | None = None) -> str:
    d = details or {}
    parts = [d.get("address"), d.get("email") or reply_to, d.get("phone"), d.get("website"),
             f"VAT {d['vat_number']}" if d.get("vat_number") else ""]
    return " · ".join(escape(str(x)) for x in parts if x)


_CTA_SLOT = "<!--view-online-->"      # where a "view online" button goes, for a document that has a link (see with_link)


def _button(label: str, href: str, aside: str = "") -> str:
    extra = f'<td style="padding-left:14px;font-family:{_FONT};font-size:13px;color:{_MUTED};">{escape(aside)}</td>' if aside else ""
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr>'
            f'<td style="border-radius:10px;background:{_BRAND};">'
            f'<a href="{escape(href)}" style="display:inline-block;padding:12px 22px;font-family:{_FONT};font-size:15px;'
            f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">{escape(label)}</a></td>{extra}</tr></table>')


def with_link(mail: dict[str, str], label: str, link: str | None) -> dict[str, str]:
    """The email with a button (and, in the plain-text part, a line) that opens the document
    online: the same link the Share button in Business Operations sends. Without a link the
    email is exactly as it was."""
    if not link:
        return {**mail, "html": mail["html"].replace(_CTA_SLOT, "")}
    html = mail["html"].replace(_CTA_SLOT, _button(label, link), 1) if _CTA_SLOT in mail["html"] else mail["html"]
    line = f"{label}:\n{link}\n"
    text = mail["text"].replace("\nKind regards,", f"\n{line}\nKind regards,", 1) if "\nKind regards," in mail["text"] else mail["text"].rstrip() + f"\n\n{line}"
    return {**mail, "html": html, "text": text}


def _email(*, company: str, preheader: str, title: str, intro: str, blocks: list[str], cta: tuple[str, str] | None = None,
           note: str = "", greeting: str = "", logo_url: str | None = None, details: dict | None = None,
           reply_to: str | None = None, cta_aside: str = "") -> str:
    """A complete, responsive HTML email."""
    button = _button(*cta, aside=cta_aside) if cta else _CTA_SLOT
    brand = (f'<img src="{escape(logo_url)}" alt="{escape(company)}" height="36" '
             f'style="display:block;height:36px;width:auto;max-width:180px;margin:0 0 8px;border:0;">' if logo_url else "")
    contact = _contact_line(details, reply_to)
    return (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{escape(title)}</title></head>'
        f'<body style="margin:0;padding:0;background:#f1f5f9;">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">'
        '<tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="max-width:600px;background:#ffffff;border:1px solid {_LINE};border-radius:16px;">'
        f'<tr><td style="padding:20px 28px;border-bottom:1px solid {_LINE};font-family:{_FONT};font-size:16px;font-weight:700;color:{_INK};">'
        f'{brand}{escape(company)}</td></tr>'
        f'<tr><td style="padding:28px 28px 8px;font-family:{_FONT};color:{_INK};">'
        f'<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:{_INK};">{escape(title)}</h1>'
        + (f'<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#334155;">{greeting}</p>' if greeting else "")
        + f'<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">{intro}</p>'
        + "".join(blocks) + button
        + (f'<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:{_MUTED};">{note}</p>' if note else "")
        + f'<p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#334155;">Kind regards,<br>{escape(company)}</p>'
        '</td></tr>'
        f'<tr><td style="padding:16px 28px 24px;border-top:1px solid {_LINE};font-family:{_FONT};font-size:12px;line-height:1.6;color:#94a3b8;">'
        f'<strong style="color:{_MUTED};">{escape(company)}</strong>' + (f'<br>{contact}' if contact else "")
        + '<br>Questions? Just reply to this email.</td></tr>'
        '</table></td></tr></table></body></html>'
    )


def _summary(pairs: list[tuple[str, str]], emphasis: str | None = None) -> str:
    """Key facts in a soft panel (reference, total, dates)."""
    cells = "".join(
        f'<tr><td style="padding:6px 0;font-family:{_FONT};font-size:14px;color:{_MUTED};">{escape(k)}</td>'
        f'<td align="right" style="padding:6px 0;font-family:{_FONT};font-size:{"17px" if k == emphasis else "14px"};'
        f'font-weight:{"700" if k == emphasis else "600"};color:{_INK};">{escape(v)}</td></tr>'
        for k, v in pairs if v
    )
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="background:{_SOFT};border:1px solid {_LINE};border-radius:12px;margin:0 0 20px;">'
            f'<tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            f'{cells}</table></td></tr></table>')


def _rows(pairs: list[tuple[str, str]], emphasis: str | None = None) -> str:
    def line(k: str) -> str:      # the emphasised (total) row has a rule across its full width
        return f"border-top:1px solid {_LINE};padding-top:12px;" if k == emphasis else ""

    cells = "".join(
        f'<tr><td style="padding:7px 0;font-family:{_FONT};font-size:14px;color:{_MUTED};{line(k)}">{escape(k)}</td>'
        f'<td align="right" style="padding:7px 0;font-family:{_FONT};font-size:{"16px" if k == emphasis else "14px"};'
        f'font-weight:{"700" if k == emphasis else "600"};color:{_INK};{line(k)}">{escape(v)}</td></tr>'
        for k, v in pairs if v
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">{cells}</table>'


def _items_table(items: list[dict], currency: str) -> str:
    th = f"padding:0 0 8px;font-family:{_FONT};font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:{_MUTED};border-bottom:1px solid {_LINE};"
    td = f"padding:10px 0;font-family:{_FONT};font-size:14px;color:{_INK};border-bottom:1px solid {_LINE};vertical-align:top;"
    head = (f'<tr><th align="left" style="{th}">Item</th><th align="right" style="{th}padding-left:8px;">Qty</th>'
            f'<th align="right" style="{th}padding-left:8px;">Price</th><th align="right" style="{th}padding-left:8px;">Amount</th></tr>')
    body = "".join(
        f'<tr><td style="{td}">{escape(str(i.get("description") or ""))}</td>'
        f'<td align="right" style="{td}padding-left:12px;white-space:nowrap;">{fmt_qty(i.get("qty"))}</td>'
        f'<td align="right" style="{td}padding-left:8px;white-space:nowrap;">{fmt_money(i.get("unit_price"), currency)}</td>'
        f'<td align="right" style="{td}padding-left:8px;white-space:nowrap;font-weight:600;">'
        f'{fmt_money(float(i.get("qty") or 1) * float(i.get("unit_price") or 0), currency)}</td></tr>'
        for i in items
    )
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">'
            f'{head}{body}</table>')


def _items_text(items: list[dict], currency: str) -> str:
    return "\n".join(
        f"  - {i.get('description')} x {fmt_qty(i.get('qty'))} @ {fmt_money(i.get('unit_price'), currency)}"
        for i in items
    )


def _discount_row(p: dict) -> list[tuple[str, str]]:
    """The discount line, when there is one: it comes off the subtotal before VAT."""
    if not p.get("discount_amount"):
        return []
    return [(p.get("discount_label") or "Discount", "-" + fmt_money(p["discount_amount"], p["currency"]))]


def _totals(p: dict) -> list[tuple[str, str]]:
    cur = p["currency"]
    rows = [("Subtotal", fmt_money(p["subtotal"], cur)), *_discount_row(p)]
    if p.get("vat_rate"):
        rows.append((f"VAT ({p['vat_rate']:g}%)", fmt_money(p["vat_amount"], cur)))
    rows.append(("Total", fmt_money(p["total"], cur)))
    return rows


_DOC_CSS = """
.eaq{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:880px;margin:0 auto;font-size:14px;line-height:1.55}
.eaq *{box-sizing:border-box}
.eaq-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:22px;border-bottom:1px solid #e2e8f0}
.eaq-brand{display:flex;align-items:center;gap:14px;min-width:0}
.eaq-logo{height:48px;width:auto;max-width:150px;object-fit:contain}
.eaq-company{font-size:21px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
.eaq-kicker{margin-top:3px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#4f46e5}
.eaq-meta{display:grid;grid-template-columns:auto auto;column-gap:18px;row-gap:3px;font-size:13px}
.eaq-meta span{color:#64748b}
.eaq-meta b{text-align:right;font-weight:600}
.eaq-pdf-only{display:none}
.eaq-pdf .eaq-pdf-only{display:revert}
.eaq-parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:22px 0}
.eaq-label{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:6px}
.eaq-party b{display:block;font-size:15.5px;margin-bottom:2px}
.eaq-party div{color:#475569;font-size:13.5px;overflow-wrap:anywhere}
table.eaq-items{width:100%;border-collapse:collapse}
.eaq-items th{padding:11px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap}
.eaq-items th:first-child,.eaq-items td:first-child{text-align:left;padding-left:14px}
.eaq-items th:last-child,.eaq-items td:last-child{padding-right:14px}
.eaq-items td{padding:14px 10px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums}
.eaq-items td:first-child{white-space:normal}
.eaq-item-name{font-weight:600}
.eaq-item-details{margin-top:3px;font-size:13px;color:#64748b;white-space:pre-wrap}
.eaq-items td.eaq-amount{font-weight:600}
.eaq-totals{margin:18px 0 0 auto;width:100%;max-width:340px;font-variant-numeric:tabular-nums}
.eaq-totals div{display:flex;justify-content:space-between;padding:6px 14px;color:#475569}
.eaq-totals div span:last-child{color:#0f172a;font-weight:600}
.eaq-totals .eaq-grand{margin-top:8px;padding:13px 14px;border-radius:12px;background:#eef2ff;color:#312e81;font-size:17px;font-weight:700}
.eaq-totals .eaq-grand span:last-child{color:#312e81;font-weight:800}
.eaq-section{margin-top:26px}
.eaq-terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.eaq-term{padding:13px 15px;border:1px solid #e2e8f0;border-radius:12px}
.eaq-term b{display:block;margin-top:2px;font-size:14.5px}
.eaq-notes{padding:14px 16px;border-radius:12px;background:#f8fafc;color:#334155;white-space:pre-wrap}
@media (max-width:600px){
  .eaq-head{flex-direction:column}
  .eaq-meta{width:100%}
  .eaq-parties{grid-template-columns:1fr;gap:16px}
  .eaq-items thead{display:none}
  .eaq-items,.eaq-items tbody,.eaq-items tr,.eaq-items td{display:block;width:100%}
  .eaq-items tr{padding:12px 0;border-bottom:1px solid #e2e8f0}
  .eaq-items td{display:flex;justify-content:space-between;gap:12px;padding:3px 0!important;border:0;white-space:normal}
  .eaq-items td:first-child{display:block;margin-bottom:6px}
  .eaq-items td[data-label]::before{content:attr(data-label);color:#64748b;font-weight:400}
  .eaq-totals{max-width:none}
}
"""


def _seller_lines(p: dict) -> list[str]:
    d = p.get("company_details") or {}
    return [x for x in (d.get("address"), d.get("email") or p.get("reply_to"), d.get("phone"), d.get("website"),
                        f"VAT number {d['vat_number']}" if d.get("vat_number") else "",
                        f"Company number {d['registration_number']}" if d.get("registration_number") else "") if x]


def quotation_document_html(p: dict) -> str:
    """The customer's quotation page and its PDF: a full HTML document with its own styles.
    Seller and customer blocks, reference, version and dates, line items, totals and terms."""
    cur = p["currency"]
    d = p.get("company_details") or {}
    rows = "".join(
        '<tr><td><div class="eaq-item-name">' + escape(str(i.get("description") or "")) + "</div>"
        + (f'<div class="eaq-item-details">{escape(str(i["details"]))}</div>' if i.get("details") else "")
        + f'</td><td data-label="Qty">{fmt_qty(i.get("qty"))}</td>'
        f'<td data-label="Unit price">{fmt_money(i.get("unit_price"), cur)}</td>'
        f'<td data-label="Amount" class="eaq-amount">{fmt_money(float(i.get("qty") or 1) * float(i.get("unit_price") or 0), cur)}</td></tr>'
        for i in p["items"]
    )
    vat = (f'<div><span>VAT ({p["vat_rate"]:g}%)</span><span>{fmt_money(p["vat_amount"], cur)}</span></div>'
           if p.get("vat_rate") else "")
    meta = "".join(f"<span>{label}</span><b>{escape(value)}</b>" for label, value in (
        ("Reference", p["reference"]), ("Version", str(p.get("version") or "")),
        ("Issue date", fmt_date(p.get("issued_at")))) if value)
    # The page shows the validity once, in its summary bar. A downloaded PDF has no summary
    # bar, so the date is kept here for the PDF only.
    valid = fmt_date(p.get("valid_until"))
    if valid:
        meta += f'<span class="eaq-pdf-only">Valid until</span><b class="eaq-pdf-only">{escape(valid)}</b>'
    logo = d.get("logo_data_url") or ""
    logo_html = f'<img class="eaq-logo" src="{escape(logo)}" alt="">' if logo.startswith("data:image/") else ""
    buyer = "".join(f"<div>{escape(x)}</div>" for x in (p.get("contact_name"), p.get("to_email")) if x)
    seller = "".join(f"<div>{escape(x)}</div>" for x in _seller_lines(p))
    terms = "".join(f'<div class="eaq-term"><div class="eaq-label">{label}</div><b>{escape(value)}</b></div>'
                    for label, value in (("Payment terms", p.get("payment_terms") or ""),
                                         ("Currency", cur)) if value)
    return (
        f'<!doctype html><html><head><meta charset="utf-8"><style>{_DOC_CSS}</style></head><body><div class="eaq">'
        f'<div class="eaq-head"><div class="eaq-brand">{logo_html}<div><div class="eaq-company">{escape(p["company"])}</div>'
        f'<div class="eaq-kicker">Quotation</div></div></div><div class="eaq-meta">{meta}</div></div>'
        f'<div class="eaq-parties">'
        f'<div class="eaq-party"><div class="eaq-label">Prepared for</div><b>{escape(p["customer_name"])}</b>{buyer}</div>'
        f'<div class="eaq-party"><div class="eaq-label">From</div><b>{escape(p["company"])}</b>{seller}</div></div>'
        f'<table class="eaq-items"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
        f'<div class="eaq-totals"><div><span>Subtotal</span><span>{fmt_money(p["subtotal"], cur)}</span></div>'
        + "".join(f'<div><span>{escape(label)}</span><span>{value}</span></div>' for label, value in _discount_row(p))
        + f'{vat}'
        f'<div class="eaq-grand"><span>Total</span><span>{fmt_money(p["total"], cur)}</span></div></div>'
        f'<div class="eaq-section"><div class="eaq-label">Terms</div><div class="eaq-terms">{terms}</div></div>'
        + (f'<div class="eaq-section"><div class="eaq-label">Notes</div><div class="eaq-notes">{escape(p["notes"])}</div></div>'
           if p.get("notes") else "")
        + '</div></body></html>'
    )


def _first_name(p: dict) -> str:
    name = str(p.get("contact_name") or "").strip()
    return name.split()[0] if name else ""


def quotation_email(p: dict, link: str | None) -> dict[str, str]:
    cur = p["currency"]
    first = _first_name(p)
    hello = f"Hi {first}," if first else f"Hi {p['customer_name']},"
    valid = fmt_date(p.get("valid_until"))
    subject = f"Quotation {p['reference']} from {p['company']}"
    details = p.get("company_details") or {}
    contact = " · ".join(x for x in (p["company"], details.get("email") or p.get("reply_to"), details.get("phone")) if x)
    text = (
        f"{hello}\n\nThank you for your enquiry. Please find quotation {p['reference']} below"
        + (" and attached as a PDF" if p.get("pdf_attached") else "") + ".\n\n"
        f"{_items_text(p['items'], cur)}\n\n"
        f"Subtotal: {fmt_money(p['subtotal'], cur)}\n"
        + "".join(f"{label}: {value}\n" for label, value in _discount_row(p))
        + (f"VAT ({p['vat_rate']:g}%): {fmt_money(p['vat_amount'], cur)}\n" if p.get("vat_rate") else "")
        + f"Total: {fmt_money(p['total'], cur)}\n"
        + (f"Valid until: {valid}\n" if valid else "")
        + (f"Payment terms: {p['payment_terms']}\n" if p.get("payment_terms") else "")
        + (f"\nReview and accept the quote (you can also ask a question or decline):\n{link}\n" if link else "")
        + f"\nKind regards,\n{p['company']}\n{contact}\n"
    )
    totals = [("Subtotal", fmt_money(p["subtotal"], cur)), *_discount_row(p)]
    if p.get("vat_rate"):
        totals.append((f"VAT ({p['vat_rate']:g}%)", fmt_money(p["vat_amount"], cur)))
    totals.append(("Total", fmt_money(p["total"], cur)))
    html = _email(
        company=p["company"], title=f"Quotation {p['reference']}", logo_url=p.get("logo_url"),
        details=details, reply_to=p.get("reply_to"),
        preheader=f"Total {fmt_money(p['total'], cur)}" + (f", valid until {valid}" if valid else ""),
        greeting=escape(hello),
        intro="Thank you for your enquiry. Here is your quotation" + (", also attached as a PDF." if p.get("pdf_attached") else "."),
        blocks=[
            _summary([("Total", fmt_money(p["total"], cur)), ("Valid until", valid),
                      ("Payment terms", p.get("payment_terms") or "")], emphasis="Total"),
            _items_table(p["items"], cur),
            _rows(totals, emphasis="Total"),
        ],
        cta=("Review and accept quote", link) if link else None,
        cta_aside=f"Valid until {valid}" if (link and valid) else "",
        note="On the quotation page you can accept it, ask us a question first, or decline it." if link else "",
    )
    return {"subject": subject, "text": text, "html": html}


def contract_email(p: dict) -> dict[str, str]:
    cur = p["currency"]
    subject = f"Contract {p['reference']} from {p['company']}"
    text = (
        f"Hi {p['customer_name']},\n\n"
        + (f"Following your acceptance of quotation {p['quote_reference']}, here is the contract {p['reference']} for your review.\n\n"
           if p.get("quote_reference") else f"Here is the contract {p['reference']} for your review.\n\n")
        +
        f"Scope: {p['description']}\nValue: {fmt_money(p['total'], cur)}\n"
        + (f"Term: {p['term']}\n" if p.get("term") else "") + (f"Start date: {p['start_date']}\n" if p.get("start_date") else "")
        + (f"Payment terms: {p['payment_terms']}\n" if p.get("payment_terms") else "")
        + f"\nPlease reply to confirm your agreement.\n\nKind regards,\n{p['company']}\n"
    )
    html = _email(
        company=p["company"], title=f"Contract {p['reference']}", preheader=f"Value {fmt_money(p['total'], cur)}",
        intro=((f"Hi {escape(p['customer_name'])}, following your acceptance of quotation "
                f"<strong>{escape(p['quote_reference'])}</strong>, here is the contract for your review.") if p.get("quote_reference")
               else f"Hi {escape(p['customer_name'])}, here is the contract for your review."),
        blocks=[_summary([("Reference", p["reference"]), ("Scope", p["description"]), ("Value", fmt_money(p["total"], cur)),
                          ("Term", p.get("term") or ""), ("Start date", fmt_date(p["start_date"]) if p.get("start_date") else ""),
                          ("Payment terms", p.get("payment_terms") or "")], emphasis="Value")],
        note="Please reply to this email to confirm your agreement.",
    )
    return {"subject": subject, "text": text, "html": html}


def invoice_email(p: dict) -> dict[str, str]:
    cur = p["currency"]
    subject = f"Invoice {p['reference']} from {p['company']}"
    text = (
        f"Hi {p['customer_name']},\n\nPlease find invoice {p['reference']}.\n\n"
        f"{_items_text(p['items'], cur)}\n\nTotal due: {fmt_money(p['total'], cur)}\nDue date: {p['due_date']}\n"
        + (f"Payment terms: {p['payment_terms']}\n" if p.get("payment_terms") else "")
        + f"\nKind regards,\n{p['company']}\n"
    )
    totals = [("Subtotal", fmt_money(p["subtotal"], cur)), *_discount_row(p)]
    if p.get("vat_rate"):
        totals.append((f"VAT ({p['vat_rate']:g}%)", fmt_money(p["vat_amount"], cur)))
    totals.append(("Total due", fmt_money(p["total"], cur)))
    html = _email(
        company=p["company"], title=f"Invoice {p['reference']}",
        preheader=f"{fmt_money(p['total'], cur)} due {fmt_date(p['due_date'])}",
        intro=f"Hi {escape(p['customer_name'])}, please find your invoice below.",
        blocks=[_summary([("Total due", fmt_money(p["total"], cur)), ("Due date", fmt_date(p["due_date"])),
                          ("Payment terms", p.get("payment_terms") or "")], emphasis="Total due"),
                _items_table(p["items"], cur), _rows(totals, emphasis="Total due")],
    )
    return {"subject": subject, "text": text, "html": html}


_REMINDER_TONE = {
    1: ("A friendly reminder", "This is a friendly reminder that the invoice below is now past its due date."),
    2: ("Second reminder", "We have not yet received payment for the invoice below, which is now overdue."),
    3: ("Final reminder", "This is a final reminder that the invoice below remains unpaid."),
}


def _own_words(p: dict) -> list[str]:
    """The sender's own message, when they added one."""
    if not p.get("message"):
        return []
    return [f'<p style="margin:0 0 16px;white-space:pre-wrap">{escape(str(p["message"]))}</p>']


def reminder_email(p: dict) -> dict[str, str]:
    cur = p["currency"]
    heading, opening = _REMINDER_TONE.get(int(p.get("stage") or 1), _REMINDER_TONE[3])
    if p.get("upcoming"):      # sent ahead of the due date, at the owner's request
        days = int(p.get("days_until_due") or 0)
        heading = "Payment due soon"
        opening = f"This is a friendly reminder that the invoice below is due {'today' if days <= 0 else 'tomorrow' if days == 1 else f'in {days} days'}."
    subject = f"{heading}: invoice {p['reference']} from {p['company']}"
    is_due = "" if p.get("upcoming") else f" ({p['days_overdue']} days overdue)"
    text = (
        f"Hi {p['customer_name']},\n\n{opening}\n\n"
        + (f"{p['message']}\n\n" if p.get("message") else "")
        + f"Invoice: {p['reference']}\nOutstanding: {fmt_money(p['outstanding'], cur)}\n"
        + (f"Amount requested now: {fmt_money(p['amount_requested'], cur)}\n" if p.get("amount_requested") else "")
        + f"Due date: {p['due_date']}{is_due}\n\n"
        "If you have already paid, please ignore this message and accept our thanks.\n\n"
        f"Kind regards,\n{p['company']}\n"
    )
    html = _email(
        company=p["company"], title=heading, preheader=f"{fmt_money(p['outstanding'], cur)} outstanding on invoice {p['reference']}",
        intro=f"Hi {escape(p['customer_name'])}, {escape(opening[0].lower() + opening[1:])}",
        blocks=[*_own_words(p),
                _summary([("Invoice", p["reference"]), ("Outstanding", fmt_money(p["outstanding"], cur)),
                          *([("Amount requested now", fmt_money(p["amount_requested"], cur))] if p.get("amount_requested") else []),
                          ("Due date", f"{fmt_date(p['due_date'])}{is_due}")], emphasis="Outstanding")],
        note="If you have already paid, please ignore this message and accept our thanks.",
    )
    return {"subject": subject, "text": text, "html": html}


def receipt_email(p: dict) -> dict[str, str]:
    cur = p["currency"]
    subject = f"Receipt {p['receipt_number']} from {p['company']}"
    balance = (f"Balance remaining: {fmt_money(p['outstanding'], cur)}\n" if p.get("outstanding") else "This invoice is now paid in full.\n")
    text = (
        f"Hi {p['customer_name']},\n\nThank you for your payment.\n\n"
        + (f"{p['message']}\n\n" if p.get("message") else "")
        + f"Receipt: {p['receipt_number']}\nInvoice: {p['invoice_reference']}\n"
        f"Amount received: {fmt_money(p['amount'], cur)}\nPayment date: {p['paid_at']}\n"
        + (f"Payment reference: {p['payment_reference']}\n" if p.get("payment_reference") else "")
        + balance + f"\nKind regards,\n{p['company']}\n"
    )
    html = _email(
        company=p["company"], title=f"Receipt {p['receipt_number']}", preheader=f"We received {fmt_money(p['amount'], cur)}. Thank you.",
        intro=f"Hi {escape(p['customer_name'])}, thank you for your payment.",
        blocks=[*_own_words(p), _summary([("Amount received", fmt_money(p["amount"], cur)), ("Receipt", p["receipt_number"]),
                          ("Invoice", p["invoice_reference"]), ("Payment date", fmt_date(p["paid_at"])),
                          ("Payment reference", p.get("payment_reference") or ""),
                          ("Balance remaining", fmt_money(p["outstanding"], cur) if p.get("outstanding") else "Paid in full")],
                         emphasis="Amount received")],
    )
    return {"subject": subject, "text": text, "html": html}


def document_email(kind: str, p: dict) -> dict[str, str]:
    """The email for a proposal, a purchase order or a credit note."""
    cur = p["currency"]
    ref, name, company = p["reference"], p["customer_name"], p["company"]
    if kind == "proposal":
        subject = f"Proposal {ref} from {company}"
        facts = [("Reference", ref), ("Price", fmt_money(p["total"], cur)), ("Timeline", p.get("timeline") or ""),
                 ("Valid until", fmt_date(p["valid_until"]) if p.get("valid_until") else "")]
        text = (f"Hi {name},\n\nThank you for the opportunity. Here is our proposal {ref}.\n\n"
                + (f"What you need\n{p['problem']}\n\n" if p.get("problem") else "")
                + (f"What we propose\n{p['solution']}\n\n" if p.get("solution") else "")
                + f"Price: {fmt_money(p['total'], cur)}\n" + (f"Timeline: {p['timeline']}\n" if p.get("timeline") else "")
                + (f"Valid until: {p['valid_until']}\n" if p.get("valid_until") else "") + (f"\n{p['notes']}\n" if p.get("notes") else "")
                + f"\nReply to this email to go ahead or to ask anything.\n\nKind regards,\n{company}\n")
        blocks = [*(_section("What you need", p["problem"]) if p.get("problem") else []), *(_section("What we propose", p["solution"]) if p.get("solution") else []),
                  _summary([f for f in facts if f[1]], emphasis="Price"), *(_section("Notes", p["notes"]) if p.get("notes") else [])]
        intro, preheader, note = f"Hi {escape(name)}, thank you for the opportunity. Here is our proposal.", f"Proposal {ref}: {fmt_money(p['total'], cur)}", "Reply to this email to go ahead or to ask anything."
    elif kind == "purchase_order":
        subject = f"Purchase order {ref} from {company}"
        totals = [("Subtotal", fmt_money(p["subtotal"], cur)), *([(f"VAT ({p['vat_rate']:g}%)", fmt_money(p["vat_amount"], cur))] if p.get("vat_rate") else []),
                  ("Total", fmt_money(p["total"], cur))]
        text = (f"Hi {name},\n\nPlease supply the following under purchase order {ref}.\n\n{_items_text(p['items'], cur)}\n\n"
                + "".join(f"{k}: {v}\n" for k, v in totals) + (f"Deliver by: {p['delivery_date']}\n" if p.get("delivery_date") else "")
                + (f"\n{p['notes']}\n" if p.get("notes") else "") + f"\nPlease reply to confirm.\n\nKind regards,\n{company}\n")
        blocks = [_summary([("Purchase order", ref), *[(f"{i.get('description')} × {fmt_qty(i.get('qty'))}", fmt_money(float(i.get('qty') or 0) * float(i.get('unit_price') or 0), cur)) for i in p["items"]],
                            *totals, ("Deliver by", fmt_date(p["delivery_date"]) if p.get("delivery_date") else "")], emphasis="Total"),
                  *(_section("Notes", p["notes"]) if p.get("notes") else [])]
        intro, preheader, note = f"Hi {escape(name)}, please supply the following under this purchase order.", f"Purchase order {ref}: {fmt_money(p['total'], cur)}", "Please reply to this email to confirm."
    else:
        subject = f"Credit note {ref} from {company}"
        full = bool(p.get("full_credit"))
        refund = float(p.get("refund_amount") or 0)
        effect = (f"Invoice {p.get('invoice_reference')} is credited in full: nothing more is due on it." if full
                  else f"{fmt_money(p['total'], cur)} has been taken off invoice {p.get('invoice_reference')}.")
        back = f" {fmt_money(refund, cur)} will be refunded to you." if refund > 0 else ""
        text = (f"Hi {name},\n\nPlease find credit note {ref}.\n\n{effect}{back}\n\nInvoice: {p.get('invoice_reference')}\nCredit: {fmt_money(p['total'], cur)}\n"
                + (f"Refund: {fmt_money(refund, cur)}\n" if refund > 0 else "") + (f"Reason: {p['reason']}\n" if p.get("reason") else "") + f"\nKind regards,\n{company}\n")
        blocks = [_summary([("Credit note", ref), ("Invoice", p.get("invoice_reference") or ""), ("Credit", fmt_money(p["total"], cur)),
                            ("Refund", fmt_money(refund, cur) if refund > 0 else ""), ("Reason", p.get("reason") or "")], emphasis="Credit")]
        intro, preheader, note = f"Hi {escape(name)}, {escape(effect[0].lower() + effect[1:])}{escape(back)}", f"Credit note {ref}: {fmt_money(p['total'], cur)}", ""
    html = _email(company=company, title=subject.split(" from ")[0], preheader=preheader, intro=intro, blocks=blocks, note=note)
    return {"subject": subject, "text": text, "html": html}


def _section(title: str, body: str) -> list[str]:
    return [f'<p style="margin:0 0 6px;font-weight:600">{escape(title)}</p><p style="margin:0 0 16px;white-space:pre-wrap">{escape(str(body))}</p>']
