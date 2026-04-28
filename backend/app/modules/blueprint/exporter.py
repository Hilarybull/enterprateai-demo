from __future__ import annotations

from io import BytesIO
from html import escape
import re

from html2text import HTML2Text
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


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

        if re.match(r"^<img\b", trimmed, re.IGNORECASE):
            close_list()
            html.append(trimmed)
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


def render_pdf_html(title: str, body_html: str) -> str:
    safe_title = title or "EnterprateAI Document"
    html = _normalize_breaks(body_html or "")
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
    if not html:
        return b""

    # Replace explicit page-break divs with a marker so we can paginate.
    html = (html or "").replace('<div class="page-break"></div>', "<p>[[PAGE_BREAK]]</p>")

    converter = HTML2Text()
    converter.ignore_links = False
    converter.body_width = 0
    text = converter.handle(html)

    output = BytesIO()
    c = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    left = 18 * mm
    top = height - 18 * mm
    bottom = 18 * mm
    line_height = 12

    c.setFont("Helvetica", 11)
    y = top

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
            y -= line_height
        elif "[[PAGE_BREAK]]" in line:
            c.showPage()
            c.setFont("Helvetica", 11)
            y = top
            continue
        else:
            # Simple wrap based on page width.
            max_chars = int((width - 2 * left) / 6.2)
            parts = [line[i:i + max_chars] for i in range(0, len(line), max_chars)] or [""]
            for part in parts:
                if y <= bottom:
                    c.showPage()
                    c.setFont("Helvetica", 11)
                    y = top
                c.drawString(left, y, part)
                y -= line_height

        if y <= bottom:
            c.showPage()
            c.setFont("Helvetica", 11)
            y = top

    c.save()
    return output.getvalue()
