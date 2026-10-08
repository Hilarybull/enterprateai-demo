"""The quotation as a PDF, attached to the customer's email.

Drawn directly with ReportLab from the same payload as the email and the quotation
page, so all three always show the same figures, formatted the same way.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Any

from app.modules.agent.documents import fmt_date, fmt_money, fmt_qty

logger = logging.getLogger(__name__)


def quotation_pdf(p: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    ink, muted, line, brand, soft = (colors.HexColor(c) for c in ("#0f172a", "#64748b", "#e2e8f0", "#4f46e5", "#eef2ff"))
    cur = p["currency"]
    details = p.get("company_details") or {}

    def st(size=10, bold=False, color=ink, align=None, leading=None):
        return ParagraphStyle("s", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size,
                              leading=leading or size * 1.35, textColor=color, **({"alignment": align} if align is not None else {}))

    def para(text: Any, style) -> Paragraph:
        return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"Quotation {p['reference']}", author=p["company"])
    width = A4[0] - 36 * mm
    flow: list = []

    # Header: logo and seller on the left, document facts on the right.
    left: list = []
    logo = details.get("logo_data_url") or ""
    if logo.startswith("data:image/") and ";base64," in logo:
        try:
            img = Image(io.BytesIO(base64.b64decode(logo.split(",", 1)[1])))
            ratio = min(40 * mm / img.imageWidth, 16 * mm / img.imageHeight)
            img.drawWidth, img.drawHeight = img.imageWidth * ratio, img.imageHeight * ratio
            img.hAlign = "LEFT"
            left += [img, Spacer(1, 4)]
        except Exception:      # noqa: BLE001 - a bad logo never blocks the quotation
            pass
    left += [para(p["company"], st(15, True)), para("QUOTATION", st(8.5, True, brand))]
    meta = [("Reference", p["reference"]), ("Version", str(p.get("version") or "")),
            ("Date", fmt_date(p.get("issued_at"))), ("Valid until", fmt_date(p.get("valid_until")))]
    meta_tbl = Table([[para(k, st(9, color=muted)), para(v, st(9, True, align=TA_RIGHT))] for k, v in meta if v],
                     colWidths=[25 * mm, 40 * mm])
    meta_tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("TOPPADDING", (0, 0), (-1, -1), 1)]))
    head = Table([[left, meta_tbl]], colWidths=[width - 66 * mm, 66 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.6, line),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    flow += [head, Spacer(1, 10)]

    # Parties.
    seller_lines = [details.get("address"), details.get("email") or p.get("reply_to"), details.get("phone"),
                    f"VAT {details['vat_number']}" if details.get("vat_number") else ""]
    buyer_lines = [p.get("contact_name"), p.get("to_email")]
    parties = Table([[
        [para("PREPARED FOR", st(7.5, True, muted)), para(p["customer_name"], st(11, True))] + [para(x, st(9, color=muted)) for x in buyer_lines if x],
        [para("FROM", st(7.5, True, muted)), para(p["company"], st(11, True))] + [para(x, st(9, color=muted)) for x in seller_lines if x],
    ]], colWidths=[width / 2, width / 2])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    flow += [parties, Spacer(1, 12)]

    # Items.
    rows = [[para(h, st(8, True, muted, align=None if i == 0 else TA_RIGHT)) for i, h in enumerate(("ITEM", "QTY", "UNIT PRICE", "AMOUNT"))]]
    for i in p["items"]:
        name = [para(i.get("description"), st(10, True))]
        if i.get("details"):
            name.append(para(i["details"], st(8.5, color=muted)))
        amount = float(i.get("qty") or 1) * float(i.get("unit_price") or 0)
        rows.append([name, para(fmt_qty(i.get("qty")), st(10, align=TA_RIGHT)),
                     para(fmt_money(i.get("unit_price"), cur), st(10, align=TA_RIGHT)), para(fmt_money(amount, cur), st(10, True, align=TA_RIGHT))])
    items = Table(rows, colWidths=[width - 85 * mm, 20 * mm, 32 * mm, 33 * mm], repeatRows=1)
    items.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")), ("LINEBELOW", (0, 0), (-1, -1), 0.5, line),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    flow += [items, Spacer(1, 8)]

    # Totals.
    totals = [("Subtotal", fmt_money(p["subtotal"], cur))]
    if p.get("discount_amount"):
        totals.append((p.get("discount_label") or "Discount", "-" + fmt_money(p["discount_amount"], cur)))
    if p.get("vat_rate"):
        totals.append((f"VAT ({p['vat_rate']:g}%)", fmt_money(p["vat_amount"], cur)))
    t_rows = [[para(k, st(10, color=muted)), para(v, st(10, True, align=TA_RIGHT))] for k, v in totals]
    t_rows.append([para("Total", st(12, True, brand)), para(fmt_money(p["total"], cur), st(12, True, brand, align=TA_RIGHT))])
    tot = Table(t_rows, colWidths=[40 * mm, 35 * mm], hAlign="RIGHT")
    tot.setStyle(TableStyle([("BACKGROUND", (0, len(t_rows) - 1), (-1, len(t_rows) - 1), soft), ("TOPPADDING", (0, 0), (-1, -1), 4),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    flow += [tot, Spacer(1, 14)]

    terms = [(k, v) for k, v in (("Payment terms", p.get("payment_terms")), ("Valid until", fmt_date(p.get("valid_until")))) if v]
    if terms:
        flow.append(Table([[para(k.upper(), st(7.5, True, muted)) for k, _ in terms], [para(v, st(10, True)) for _, v in terms]],
                          colWidths=[width / len(terms)] * len(terms), hAlign="LEFT"))
    if p.get("notes"):
        flow += [Spacer(1, 10), para("NOTES", st(7.5, True, muted)), para(p["notes"], st(9.5))]

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(muted)
        contact = " · ".join(x for x in (p["company"], details.get("email") or p.get("reply_to"), details.get("phone")) if x)
        canvas.drawString(18 * mm, 10 * mm, contact[:120])
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Quotation {p['reference']}")
        canvas.restoreState()

    doc.build(flow, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def quotation_attachment(p: dict) -> list[dict] | None:
    """The PDF as an email attachment, or None if it couldn't be made (the email still goes)."""
    try:
        data = quotation_pdf(p)
    except Exception:      # noqa: BLE001
        logger.exception("quotation PDF failed for %s", p.get("reference"))
        return None
    return [{"filename": f"Quotation-{p['reference']}.pdf", "content": base64.b64encode(data).decode()}]
