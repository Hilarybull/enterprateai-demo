"""Plain-text extraction from an uploaded brief (PDF / DOCX / TXT).

Used by POST /proposals/extract-brief to pre-fill a request description.
"""

from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree as ET

_MAX_CHARS = 40_000


def _clip(text: str) -> str:
    text = text.strip()
    return text[:_MAX_CHARS]


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover - dependency missing
        raise RuntimeError("PDF support is not installed on the server.") from exc
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n\n".join(p for p in parts if p.strip())


_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _extract_docx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        with zf.open("word/document.xml") as fh:
            tree = ET.parse(fh)
    root = tree.getroot()
    lines: list[str] = []
    for para in root.iter(f"{_W_NS}p"):
        text = "".join(node.text or "" for node in para.iter(f"{_W_NS}t"))
        if text.strip():
            lines.append(text.strip())
    return "\n".join(lines)


def _extract_txt(data: bytes) -> str:
    return data.decode("utf-8", errors="ignore")


def extract_brief_text(*, filename: str, content_type: str | None, data: bytes) -> str:
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if name.endswith(".pdf") or "pdf" in ctype:
        return _clip(_extract_pdf(data))
    if name.endswith(".docx") or "wordprocessingml" in ctype:
        return _clip(_extract_docx(data))
    if name.endswith(".txt") or ctype.startswith("text/"):
        return _clip(_extract_txt(data))

    raise ValueError("Unsupported file type. Upload a PDF, DOCX, or TXT file.")
