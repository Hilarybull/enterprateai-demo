from __future__ import annotations

from io import BytesIO
import re

from markdown import markdown as md
from html2text import HTML2Text
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def markdown_to_html(markdown_text: str) -> str:
    return md(markdown_text or "", extensions=["tables", "sane_lists"])


def _normalize_breaks(html: str) -> str:
    return (html or "").replace('<div class="page-break"></div>', '<div class="page-break"></div>')


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
