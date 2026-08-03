from __future__ import annotations

import base64
from html import escape
from html.parser import HTMLParser
from io import BytesIO
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)


def _inline_format(text: str) -> str:
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text or "")


def _parse_table_row(line: str) -> list[str] | None:
    trimmed = (line or "").strip()
    if "|" not in trimmed:
        return None
    raw_cells = trimmed.removeprefix("|").removesuffix("|").split("|")
    cells = [cell.strip() for cell in raw_cells]
    return cells or None


def _is_table_separator(line: str) -> bool:
    cells = _parse_table_row(line)
    if not cells:
        return False
    return all(re.match(r"^:?-{3,}:?$", cell or "") for cell in cells)


def markdown_to_html(markdown_text: str) -> str:
    lines = str(markdown_text or "").replace("\r\n", "\n").split("\n")
    html: list[str] = []
    in_list = False

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            html.append("</ul>")
            in_list = False

    idx = 0
    while idx < len(lines):
        raw = lines[idx]
        line = raw.rstrip()
        trimmed = line.strip()

        if not trimmed:
            close_list()
            idx += 1
            continue

        if trimmed in {'<div class="cover-page">', "<div class='cover-page'>"}:
            close_list()
            html.append('<div class="cover-page">')
            idx += 1
            continue

        if trimmed == "</div>":
            close_list()
            html.append("</div>")
            idx += 1
            continue

        if trimmed in {'<div class="page-break"></div>', "<div class='page-break'></div>"}:
            close_list()
            html.append('<div class="page-break"></div>')
            idx += 1
            continue

        if trimmed.startswith('<div class="ea-bp-chart"'):
            close_list()
            html.append(trimmed)
            idx += 1
            continue

        if re.match(r"^<img\b", trimmed, re.IGNORECASE):
            close_list()
            html.append(trimmed)
            idx += 1
            continue

        md_img = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", trimmed)
        if md_img:
            close_list()
            alt = md_img.group(1).replace('"', "&quot;")
            src = md_img.group(2).replace('"', "&quot;")
            html.append(f'<img class="document-logo" src="{src}" alt="{alt}" />')
            idx += 1
            continue

        if trimmed.startswith('<p class="subject-line">') and trimmed.endswith("</p>"):
            close_list()
            html.append(trimmed)
            idx += 1
            continue

        if line.startswith("# "):
            close_list()
            html.append(f"<h1>{_inline_format(escape(line[2:].strip()))}</h1>")
            idx += 1
            continue
        if line.startswith("## "):
            close_list()
            html.append(f"<h2>{_inline_format(escape(line[3:].strip()))}</h2>")
            idx += 1
            continue
        if line.startswith("### "):
            close_list()
            html.append(f"<h3>{_inline_format(escape(line[4:].strip()))}</h3>")
            idx += 1
            continue

        header_row = _parse_table_row(line)
        next_line = lines[idx + 1] if idx + 1 < len(lines) else ""
        if header_row and _is_table_separator(next_line):
            close_list()
            html.append("<table><thead><tr>")
            for cell in header_row:
                html.append(f"<th>{_inline_format(escape(cell))}</th>")
            html.append("</tr></thead><tbody>")
            idx += 2
            while idx < len(lines):
                body_line = lines[idx].rstrip()
                if not body_line.strip():
                    break
                body_row = _parse_table_row(body_line)
                if not body_row:
                    break
                html.append("<tr>")
                for cell in body_row:
                    html.append(f"<td>{_inline_format(escape(cell))}</td>")
                html.append("</tr>")
                idx += 1
            html.append("</tbody></table>")
            continue

        bullet = None
        for prefix in ("- ", "* ", "• ", "– "):
            if line.startswith(prefix):
                bullet = line[len(prefix):].strip()
                break
        if bullet is not None:
            if not in_list:
                html.append("<ul>")
                in_list = True
            html.append(f"<li>{_inline_format(escape(bullet))}</li>")
            idx += 1
            continue

        close_list()
        html.append(f"<p>{_inline_format(escape(trimmed))}</p>")
        idx += 1

    close_list()
    return "".join(html)


def _normalize_breaks(html: str) -> str:
    return (html or "").replace('<div class="page-break"></div>', '<div class="page-break"></div>')


def extract_export_body(html: str) -> str:
    source = str(html or "").strip()
    if not source:
        return ""
    body_match = re.search(r"<body[^>]*>(.*)</body>", source, flags=re.IGNORECASE | re.DOTALL)
    if body_match:
        return body_match.group(1).strip()
    return source


def render_export_html(title: str, body_html: str) -> str:
    safe_title = title or "EnterprateAI Document"
    html = _normalize_breaks(body_html or "")
    pages = split_pages(html)
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{safe_title}</title>
    <style>
      body {{
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        background: #ffffff;
        color: #0f172a;
      }}
      .page-wrap {{ padding: 24px; display: flex; flex-direction: column; align-items: center; }}
      .page {{
        width: 210mm;
        min-height: 297mm;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 18mm 16mm;
        page-break-after: always;
        margin: 0 auto;
        box-sizing: border-box;
      }}
      .page:last-child {{ page-break-after: auto; }}
      h1 {{ text-align: center; font-size: 24px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }}
      h2 {{ text-align: center; font-size: 16px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }}
      h3 {{ font-size: 14px; font-weight: 800; margin: 16px 0 6px; }}
      h1, h2, h3 {{ break-after: avoid-page; page-break-after: avoid; }}
      h1 + p, h2 + p, h3 + p, h2 + ul, h3 + ul {{ break-before: avoid-page; page-break-before: avoid; }}
      p, li {{ font-size: 12.5px; line-height: 1.7; color: #1f2937; }}
      p, li {{ orphans: 3; widows: 3; }}
      ul {{ margin: 8px 0 0 18px; padding: 0; }}
      li {{ margin: 6px 0; }}
      strong {{ color: #0f172a; }}
      .subject-line {{ text-align: center; margin: 8px 0 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }}
      table {{ width: 100%; border-collapse: collapse; margin: 12px 0 6px; font-size: 12.5px; }}
      th, td {{ border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }}
      th {{ background: #f8fafc; font-weight: 700; }}
      .cover-page {{
        min-height: 70vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
      }}
      .cover-page p {{ margin: 6px 0; }}
      .document-logo {{ display: block; max-width: 180px; max-height: 90px; width: auto; height: auto; margin: 0 auto 20px; object-fit: contain; }}
      .ea-bp-chart {{ margin-top: 18px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; page-break-inside: avoid; }}
      .ea-bp-chart p {{ text-align: center; font-size: 11px; font-weight: 700; color: #1e293b; margin: 0 0 8px; }}
      .ea-bp-chart svg {{ display: block; width: 100%; max-width: 480px; margin: 0 auto; }}
      @media print {{
        .page-wrap {{ padding: 0; }}
        .page {{ border: none; border-radius: 0; width: auto; min-height: auto; padding: 16mm; }}
      }}
    </style>
  </head>
  <body>
    <div class="page-wrap">
      {pages}
    </div>
  </body>
</html>
"""


def split_pages(body_html: str) -> str:
    parts = re.split(r'<div class="page-break"></div>', body_html or "")
    pages = [p.strip() for p in parts if p.strip()]
    if not pages:
        pages = [body_html or ""]
    return "".join([f'<div class="page">{p}</div>' for p in pages])


def _strip_svg(html: str) -> str:
    """Remove SVG elements so ReportLab doesn't choke on chart markup."""
    return re.sub(r"<svg[\s\S]*?</svg>", "", html or "", flags=re.IGNORECASE)


def render_pdf_html(title: str, body_html: str) -> str:
    safe_title = title or "EnterprateAI Document"
    html = _normalize_breaks(body_html or "")
    html = _strip_svg(html)
    html = html.replace('<div class="page-break"></div>', "<pdf:nextpage/>")
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>{safe_title}</title>
    <style>
      body {{ margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #111827; }}
      h1 {{ text-align: center; font-size: 22px; margin: 0 0 12px; }}
      h2 {{ text-align: center; font-size: 15px; margin: 16px 0 10px; }}
      h3 {{ font-size: 13px; margin: 12px 0 6px; }}
      h1, h2, h3 {{ break-after: avoid-page; page-break-after: avoid; }}
      h1 + p, h2 + p, h3 + p, h2 + ul, h3 + ul {{ break-before: avoid-page; page-break-before: avoid; }}
      p, li {{ font-size: 12px; line-height: 1.6; }}
      p, li {{ orphans: 3; widows: 3; }}
      .subject-line {{ text-align: center; margin: 8px 0 12px; font-weight: bold; letter-spacing: 0.04em; text-transform: uppercase; }}
      ul {{ margin: 6px 0 0 16px; }}
      table {{ width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }}
      th, td {{ border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }}
      th {{ background: #f8fafc; font-weight: bold; }}
      .cover-page {{ text-align: center; margin-top: 180px; }}
      .cover-page p {{ margin: 6px 0; }}
      .document-logo {{ display: block; max-width: 160px; max-height: 80px; width: auto; height: auto; margin: 0 auto 18px; object-fit: contain; }}
    </style>
  </head>
  <body>
    {html}
  </body>
</html>
"""


def html_to_pdf(html: str) -> bytes:
    """Convert HTML (from render_pdf_html) to PDF bytes using ReportLab Platypus."""
    if not html:
        return b""

    margin = 18 * mm
    avail_w = A4[0] - 2 * margin

    def S(**kw: object) -> ParagraphStyle:
        return ParagraphStyle("", **kw)

    sH1  = S(fontSize=20, leading=26, spaceAfter=10, spaceBefore=4,  alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=colors.HexColor("#0f172a"))
    sH2  = S(fontSize=14, leading=20, spaceAfter=8,  spaceBefore=14, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=colors.HexColor("#0f172a"))
    sH3  = S(fontSize=12, leading=16, spaceAfter=5,  spaceBefore=10,                     fontName="Helvetica-Bold", textColor=colors.HexColor("#111827"))
    sP   = S(fontSize=11, leading=18, spaceAfter=5,                                      fontName="Helvetica",      textColor=colors.HexColor("#1f2937"))
    sLI  = S(fontSize=11, leading=16, spaceAfter=3,  leftIndent=12,                      fontName="Helvetica",      textColor=colors.HexColor("#1f2937"))
    sSub = S(fontSize=11, leading=16, spaceAfter=6,  spaceBefore=4,  alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=colors.HexColor("#0f172a"))
    sTH      = S(fontSize=10, leading=14,                                                    fontName="Helvetica-Bold", textColor=colors.HexColor("#111827"))
    sTD      = S(fontSize=10, leading=14,                                                    fontName="Helvetica",      textColor=colors.HexColor("#1f2937"))
    sCoverP  = S(fontSize=11, leading=16, spaceAfter=4,               alignment=TA_CENTER,  fontName="Helvetica",      textColor=colors.HexColor("#374151"))

    class _Parser(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.flows: list = []
            self._block: str | None = None
            self._block_cls = ""
            self._buf: list[str] = []
            self._in_ul = False
            self._li_items: list[str] = []
            self._in_li = False
            self._in_table = False
            self._tbl_rows: list = []
            self._tbl_row: list = []
            self._in_cell = False
            self._cell_buf: list[str] = []
            self._is_th = False
            self._in_cover = False
            self._cover_divs = 0

        def _rl(self, s: str) -> str:
            s = re.sub(r"<strong>(.*?)</strong>", r"<b>\1</b>", s, flags=re.IGNORECASE | re.DOTALL)
            s = re.sub(r"<em>(.*?)</em>", r"<i>\1</i>", s, flags=re.IGNORECASE | re.DOTALL)
            s = re.sub(r"<(?!/?(b|i)>)[^>]+>", "", s)
            return s.strip()

        def handle_starttag(self, tag: str, attrs: list) -> None:
            tag = tag.lower()
            ad = dict(attrs)
            if self._in_cell:
                if tag in ("b", "strong"): self._cell_buf.append("<b>")
                elif tag in ("i", "em"):   self._cell_buf.append("<i>")
                return
            if self._in_table:
                if tag == "tr":
                    self._tbl_row = []
                elif tag in ("th", "td"):
                    self._in_cell = True
                    self._cell_buf = []
                    self._is_th = (tag == "th")
                return
            if tag == "table":
                self._in_table = True
                self._tbl_rows = []
                return
            if self._in_li:
                if tag in ("b", "strong"): self._buf.append("<b>")
                elif tag in ("i", "em"):   self._buf.append("<i>")
                return
            if self._in_ul:
                if tag == "li":
                    self._in_li = True
                    self._buf = []
                return
            if tag == "ul":
                self._in_ul = True
                self._li_items = []
                return
            if self._block:
                if tag in ("b", "strong"): self._buf.append("<b>")
                elif tag in ("i", "em"):   self._buf.append("<i>")
                return
            if tag == "div":
                cls = ad.get("class", "")
                if "cover-page" in cls and not self._in_cover:
                    self._in_cover = True
                    self._cover_divs = 1
                    self.flows.append(Spacer(1, 55 * mm))
                elif self._in_cover:
                    self._cover_divs += 1
                return
            if tag in ("h1", "h2", "h3", "p"):
                self._block = tag
                self._block_cls = ad.get("class", "")
                self._buf = []
            elif tag == "img":
                self._emit_img(ad.get("src", ""))
            elif tag == "hr" and "page-break" in ad.get("class", ""):
                self.flows.append(PageBreak())

        def handle_startendtag(self, tag: str, attrs: list) -> None:
            tag = tag.lower()
            ad = dict(attrs)
            if tag == "img":
                self._emit_img(ad.get("src", ""))
            elif tag == "hr" and "page-break" in ad.get("class", ""):
                self.flows.append(PageBreak())

        def handle_endtag(self, tag: str) -> None:
            tag = tag.lower()
            if self._in_cell:
                if tag in ("th", "td"):
                    text = self._rl("".join(self._cell_buf).strip())
                    self._tbl_row.append((text, self._is_th))
                    self._in_cell = False
                    self._cell_buf = []
                    self._is_th = False
                elif tag in ("b", "strong"): self._cell_buf.append("</b>")
                elif tag in ("i", "em"):     self._cell_buf.append("</i>")
                return
            if self._in_table:
                if tag == "tr":
                    if self._tbl_row:
                        self._tbl_rows.append(self._tbl_row[:])
                    self._tbl_row = []
                elif tag == "table":
                    self._emit_table()
                    self._in_table = False
                    self._tbl_rows = []
                return
            if self._in_li:
                if tag == "li":
                    text = self._rl("".join(self._buf).strip())
                    if text:
                        self._li_items.append(text)
                    self._in_li = False
                    self._buf = []
                elif tag in ("b", "strong"): self._buf.append("</b>")
                elif tag in ("i", "em"):     self._buf.append("</i>")
                return
            if self._in_ul:
                if tag == "ul":
                    self._emit_list()
                    self._in_ul = False
                    self._li_items = []
                return
            if tag == "div" and self._in_cover:
                self._cover_divs -= 1
                if self._cover_divs == 0:
                    self._in_cover = False
                return
            if self._block:
                if tag in ("b", "strong"): self._buf.append("</b>")
                elif tag in ("i", "em"):   self._buf.append("</i>")
                if tag in ("h1", "h2", "h3", "p") and tag == self._block:
                    text = self._rl("".join(self._buf).strip())
                    self._emit_block(self._block, self._block_cls, text)
                    self._block = None
                    self._block_cls = ""
                    self._buf = []

        def handle_data(self, data: str) -> None:
            if self._in_cell:   self._cell_buf.append(data)
            elif self._in_li:   self._buf.append(data)
            elif self._block:   self._buf.append(data)

        def _emit_block(self, tag: str, cls: str, text: str) -> None:
            if not text:
                return
            style_map = {"h1": sH1, "h2": sH2, "h3": sH3}
            if tag in style_map:
                self.flows.append(Paragraph(text, style_map[tag]))
            elif "subject-line" in cls:
                self.flows.append(Paragraph(text, sSub))
            elif self._in_cover:
                self.flows.append(Paragraph(text, sCoverP))
            else:
                self.flows.append(Paragraph(text, sP))

        def _emit_list(self) -> None:
            for item in self._li_items:
                if item:
                    self.flows.append(Paragraph(f"• {item}", sLI))

        def _emit_table(self) -> None:
            rows = self._tbl_rows
            if not rows:
                return
            col_n = max(len(r) for r in rows)
            col_w = avail_w / col_n
            tbl_data = []
            for row in rows:
                cells = [Paragraph(t or "", sTH if h else sTD) for t, h in row]
                while len(cells) < col_n:
                    cells.append(Paragraph("", sTD))
                tbl_data.append(cells)
            tbl = Table(tbl_data, colWidths=[col_w] * col_n, repeatRows=1)
            tbl.setStyle(TableStyle([
                ("GRID",         (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("BACKGROUND",   (0, 0), (-1,  0), colors.HexColor("#f8fafc")),
                ("TOPPADDING",   (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
                ("LEFTPADDING",  (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN",       (0, 0), (-1, -1), "TOP"),
            ]))
            self.flows.extend([Spacer(1, 4), tbl, Spacer(1, 4)])

        def _emit_img(self, src: str) -> None:
            if not src:
                return
            try:
                if src.startswith("data:image/"):
                    _, b64 = src.split(",", 1)
                    img_io = BytesIO(base64.b64decode(b64))
                    img = Image(img_io)
                else:
                    img = Image(src)
                # Scale to full available width, preserving aspect ratio
                iw, ih = img.imageWidth, img.imageHeight
                if iw and ih:
                    img._restrictSize(avail_w, avail_w * ih / iw)
                else:
                    img.drawWidth = avail_w
                    img.drawHeight = 40 * mm
                img.hAlign = "CENTER"
                self.flows.extend([Spacer(1, 6), img, Spacer(1, 10)])
            except Exception:
                pass

    body_m = re.search(r"<body[^>]*>(.*?)</body>", html, re.IGNORECASE | re.DOTALL)
    body = body_m.group(1).strip() if body_m else html.strip()
    body = re.sub(r"<pdf:nextpage\s*/?>", '<hr class="page-break"/>', body, flags=re.IGNORECASE)

    parser = _Parser()
    parser.feed(body)

    flows = parser.flows or [Paragraph("(empty document)", sP)]
    output = BytesIO()
    doc = SimpleDocTemplate(
        output, pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=margin, bottomMargin=margin,
    )
    doc.build(flows)
    return output.getvalue()
