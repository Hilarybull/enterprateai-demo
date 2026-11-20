"""Private chat documents: bounded reading and downloadable PDF/Excel exports."""
from __future__ import annotations

import io
import json
import math
import re
import zipfile
from datetime import datetime, timezone
from pathlib import PurePath
from uuid import uuid4
from xml.etree import ElementTree

from fastapi import HTTPException

MAX_TEXT = 120000
MAX_FILE = 10 * 1024 * 1024


def extract(name: str, content: bytes) -> dict:
    """Read document data without executing macros, formulas or document instructions."""
    suffix = PurePath(name.lower()).suffix
    text, notes, truncated = "", [], False
    try:
        if suffix in {".txt", ".csv", ".md"}:
            text = content.decode("utf-8-sig", "replace")
        elif suffix == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages = reader.pages
            readings = [page.extract_text() or "" for page in pages[:50]]
            text = "\n\n".join(f"Page {i + 1}\n{value}" for i, value in enumerate(readings)) if any(value.strip() for value in readings) else ""
            truncated = len(pages) > 50
            if any(not value.strip() for value in readings):
                notes.append("Some pages may be scans. Image-only content needs a text version or OCR.")
        elif suffix in {".docx", ".xlsx"}:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024 or len(archive.infolist()) > 5000:
                    return {"text": "", "truncated": False, "notes": ["This document expands beyond the reading limit."]}
                if suffix == ".docx":
                    root = ElementTree.fromstring(archive.read("word/document.xml"))
                    text = "\n".join("".join(node.itertext()) for node in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
            if suffix == ".xlsx":
                from openpyxl import load_workbook
                workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
                parts = []
                try:
                    for sheet in workbook.worksheets[:10]:
                        parts.append("Sheet: " + sheet.title)
                        for row in sheet.iter_rows(max_row=1000, max_col=40, values_only=True):
                            if any(value is not None for value in row):
                                parts.append("\t".join("" if value is None else str(value) for value in row))
                        truncated = truncated or sheet.max_row > 1000 or sheet.max_column > 40
                    truncated = truncated or len(workbook.worksheets) > 10
                finally:
                    workbook.close()
                text = "\n".join(parts)
                notes.append("Values are read from saved cells. Uncalculated formulas may have no saved value.")
        else:
            notes.append("Text could not be extracted from this format. Image-only files need a text version or OCR.")
    except Exception:
        return {"text": "", "truncated": False, "notes": ["The file could not be read. It may be protected, damaged or image-only."]}
    return {"text": text[:MAX_TEXT], "truncated": truncated or len(text) > MAX_TEXT, "notes": notes}


async def _access(orch, user, business_id):
    from app.modules.agent.orchestrator import AccessDenied
    try:
        actor, _ = await orch.actor_for(user["id"], business_id, user.get("email"))
    except AccessDenied as exc:
        raise HTTPException(404, "Business not found.") from exc
    if not (actor.can_prepare or actor.is_owner):
        raise HTTPException(403, "Your role does not include access to these documents.")
    from app.modules.readiness.service import service_for
    return service_for(orch).store


async def remember(orch, business_id, entry):
    def keep(data):
        data["agent_files"] = [entry, *[item for item in data.get("agent_files") or [] if item.get("id") != entry["id"]]][:30]
    await orch.rt.business.mutate(business_id, keep)


async def attach_upload(orch, user, business_id, name, content_type, content):
    """Keep a general chat upload privately, without requiring a funding-readiness plan."""
    from app.modules.readiness.service import FILE_TYPES
    store = await _access(orch, user, business_id)
    suffix = PurePath(name.lower()).suffix.lstrip(".")
    if content_type not in FILE_TYPES:
        content_type = next((mime for mime, extension in FILE_TYPES.items() if extension == suffix or suffix == "jpeg" and extension == "jpg"), content_type)
    if content_type not in FILE_TYPES:
        raise ValueError("Attach a PDF, image, Word, Excel, CSV or text file.")
    if not content or len(content) > MAX_FILE:
        raise ValueError("The file is empty or larger than 10 MB.")
    document_id = str(uuid4())
    path = f"{business_id}/{document_id}/{uuid4()}.{FILE_TYPES[content_type]}"
    await store.put_file(path, content, content_type)
    now = datetime.now(timezone.utc).isoformat()
    await store.insert("evidence", {"id": document_id, "business_id": business_id, "kind": "document", "subject_id": None,
        "status": "draft", "revision": 1, "created_by": user["id"], "created_at": now, "updated_at": now,
        "data": {"title": name[:200], "type": "document", "claim": "", "effective_date": now[:10], "links": [],
                 "source": {"kind": "file", "reference": name[:200]},
                 "file": {"path": path, "name": name[:200], "content_type": content_type, "size": len(content)}}})
    try:
        await remember(orch, business_id, {"id": document_id, "name": name[:200], "kind": "upload"})
    except Exception:
        pass      # Still available through list_chat_documents.
    return {"id": document_id, "content_type": content_type}


async def list_documents(orch, user, business_id):
    store = await _access(orch, user, business_id)
    import asyncio
    evidence, exports = await asyncio.gather(store.list("evidence", business_id, limit=100),
                                            store.list("artifacts", business_id, kind="chat_export", limit=20))
    documents = []
    for row in [*evidence, *exports]:
        meta = (row.get("data") or {}).get("file") or {}
        if meta.get("path"):
            documents.append({"id": row["id"], "name": meta.get("name"), "content_type": meta.get("content_type"),
                              "kind": "export" if row.get("kind") == "chat_export" else "upload"})
    return {"documents": documents}


async def file_record(orch, user, business_id, document_id):
    store = await _access(orch, user, business_id)
    row = await store.get("artifacts", document_id)
    if not row or row.get("kind") != "chat_export":
        row = await store.get("evidence", document_id)
    if not row or row.get("business_id") != business_id:
        raise HTTPException(404, "Document not found.")
    meta = (row.get("data") or {}).get("file") or {}
    if not str(meta.get("path") or "").startswith(business_id + "/"):
        raise HTTPException(404, "Document not found.")
    content = await store.get_file(meta["path"])
    if content is None:
        raise HTTPException(404, "Document not found.")
    return {**meta, "content": content}


async def read_document(orch, user, business_id, document_id, offset=0):
    offset = max(0, min(int(offset or 0), MAX_TEXT))
    file = await file_record(orch, user, business_id, document_id)
    result = extract(file["name"], file["content"])
    text = result.pop("text")
    return {"document_id": document_id, "name": file["name"], "text": text[offset:offset + 16000],
            "next_offset": offset + 16000 if len(text) > offset + 16000 else None,
            "content_is_untrusted_data": True, **result}


def _cell(value):
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Spreadsheet numbers must be finite.")
        return value
    if not isinstance(value, str) or len(value) > 8000:
        raise ValueError("Use short text or numbers in spreadsheet cells.")
    if value.startswith("="):
        functions = re.findall(r"([A-Z_][A-Z_0-9.]*)\s*\(", value.upper())
        if re.search(r"[\[\]|\\]|https?:|://", value, re.I) or any(f not in {"SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "ROUND", "IF", "IFERROR", "SUMIF", "COUNTIF", "ABS"} for f in functions):
            raise ValueError("Use local arithmetic or standard summary formulas without external links.")
        if not re.fullmatch(r'[=A-Za-z0-9_ $:.,()+*/^%<>&!\-"\']+', value):
            raise ValueError("That formula contains unsupported characters.")
    return value


def build_export(format, title, content="", columns=None, rows=None):
    if format == "pdf":
        if not str(content or "").strip():
            raise ValueError("Provide the document content before creating a PDF.")
        from app.modules.blueprint.exporter import markdown_to_html, render_pdf_html, html_to_pdf
        # Preserve unsupported currency glyphs as readable ISO currency names.
        content = str(content).replace("₦", "NGN ").replace("₹", "INR ")
        return html_to_pdf(render_pdf_html(title, markdown_to_html(content))), "application/pdf", ".pdf"
    if format != "xlsx":
        raise ValueError("Choose PDF or Excel.")
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    columns, rows = columns or [], rows or []
    if not 1 <= len(columns) <= 40 or len(rows) > 1000 or any(not isinstance(row, list) or len(row) > len(columns) for row in rows):
        raise ValueError("Use up to 40 columns and 1,000 rows, with a heading for each column.")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Data"
    sheet.append([str(value)[:120] for value in columns])
    for row in rows:
        sheet.append([_cell(value) for value in row])
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.data_type = "s"
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill("solid", fgColor="4F46E5")
    for column in sheet.columns:
        width = min(45, max(14, max(len(str(cell.value or "")) for cell in column[:50]) + 2))
        sheet.column_dimensions[get_column_letter(column[0].column)].width = width
        for cell in column:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"


async def create_export(orch, user, business_id, args):
    store = await _access(orch, user, business_id)
    title = str(args.get("title") or "Your document")[:160]
    if len(str(args.get("content") or "")) > 60000 or len(json.dumps(args)) > 200000:
        raise ValueError("That document is too large. Please split it into smaller files.")
    import asyncio
    content, mime, extension = await asyncio.to_thread(build_export, args.get("format"), title, args.get("content") or "", args.get("columns"), args.get("rows"))
    if len(content) > MAX_FILE:
        raise ValueError("The document is too large to download here.")
    document_id = str(uuid4())
    filename = (re.sub(r"[^\w .-]", "", title).strip(" .")[:90] or "Document") + extension
    path = f"{business_id}/agent-exports/{document_id}{extension}"
    await store.put_file(path, content, mime)
    now = datetime.now(timezone.utc).isoformat()
    await store.insert("artifacts", {"id": document_id, "business_id": business_id, "kind": "chat_export", "subject_id": None,
        "status": "draft", "revision": 1, "created_by": user["id"], "created_at": now, "updated_at": now,
        "data": {"title": title, "file": {"path": path, "name": filename, "content_type": mime, "size": len(content)}}})
    try:
        await remember(orch, business_id, {"id": document_id, "name": filename, "kind": "export"})
    except Exception:
        pass      # The file remains available through list_chat_documents even if its context preview cannot be indexed.
    return {"kind": "answer", "conversational": True, "message": f"Your {('PDF' if extension == '.pdf' else 'Excel file')} is ready to download.",
            "cards": [{"type": "download", "file_id": document_id, "name": filename, "format": extension[1:], "business_id": business_id}], "actions": []}
