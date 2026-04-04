import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./Button";
import Card from "./Card";
import "./documentEditor.css";

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineFormat(s) {
  return String(s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const rawCells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  const cells = rawCells.map((c) => c.trim());
  if (!cells.length) return null;
  return cells;
}

function isTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function markdownToHtml(md) {
  const lines = String(md || "").replaceAll("\r\n", "\n").split("\n");
  let html = "";
  let inList = false;

  function closeList() {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "<div class=\"cover-page\">" || trimmed === "<div class='cover-page'>") {
      closeList();
      html += `<div class="cover-page">`;
      continue;
    }

    if (trimmed === "</div>") {
      closeList();
      html += `</div>`;
      continue;
    }

    if (trimmed === "<div class=\"page-break\"></div>" || trimmed === "<div class='page-break'></div>") {
      closeList();
      html += `<div class="page-break"></div>`;
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${inlineFormat(escapeHtml(line.slice(2).trim()))}</h1>`;
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${inlineFormat(escapeHtml(line.slice(3).trim()))}</h2>`;
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${inlineFormat(escapeHtml(line.slice(4).trim()))}</h3>`;
      continue;
    }

    const headerRow = parseTableRow(line);
    const nextLine = lines[idx + 1] ?? "";
    if (headerRow && isTableSeparator(nextLine)) {
      closeList();
      html += "<table><thead><tr>";
      for (const cell of headerRow) {
        html += `<th>${inlineFormat(escapeHtml(cell))}</th>`;
      }
      html += "</tr></thead><tbody>";
      let j = idx + 2;
      for (; j < lines.length; j++) {
        const bodyLine = lines[j].trimEnd();
        if (!bodyLine.trim()) break;
        const bodyRow = parseTableRow(bodyLine);
        if (!bodyRow) break;
        html += "<tr>";
        for (const cell of bodyRow) {
          html += `<td>${inlineFormat(escapeHtml(cell))}</td>`;
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      idx = j - 1;
      continue;
    }

    const bullet =
      line.startsWith("- ") ? line.slice(2) :
      line.startsWith("* ") ? line.slice(2) :
      line.startsWith("• ") ? line.slice(2) :
      line.startsWith("– ") ? line.slice(2) :
      null;

    if (bullet != null) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineFormat(escapeHtml(bullet.trim()))}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inlineFormat(escapeHtml(line.trim()))}</p>`;
  }

  closeList();
  return html;
}

function buildPages(bodyHtml) {
  const safeBody = bodyHtml || "";
  const parts = safeBody.split('<div class="page-break"></div>').map((p) => p.trim()).filter(Boolean);
  const pages = parts.length ? parts : [safeBody];
  return pages.map((p) => `<div class="page">${p}</div>`).join("");
}

function buildPreviewFragment({ title, bodyHtml }) {
  const pageHtml = buildPages(bodyHtml);
  return `
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      .page-wrap { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 24px; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
      .page {
        width: 210mm;
        min-height: 297mm;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 18mm 16mm;
        color: #0f172a;
      }
      h1 { text-align: center; font-size: 24px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }
      h2 { text-align: center; font-size: 16px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }
      h3 { font-size: 14px; font-weight: 800; margin: 16px 0 6px; }
      p, li { font-size: 12.5px; line-height: 1.7; color: #1f2937; }
      ul { margin: 8px 0 0 18px; padding: 0; }
      li { margin: 6px 0; }
      strong { color: #0f172a; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0 6px; font-size: 12.5px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
      th { background: #f8fafc; font-weight: 700; }
      .cover-page { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
      .cover-page p { margin: 6px 0; }
    </style>
    <div class="page-wrap" aria-label="${escapeHtml(title || "Document")}">
      ${pageHtml}
    </div>
  `.trim();
}

export default function DocumentEditor({ title = "Document", markdown, initialHtml, onHtmlChange, onDownload, onSave }) {
  const computedInitialHtml = useMemo(() => {
    if (typeof initialHtml === "string" && initialHtml.trim()) return initialHtml;
    return markdownToHtml(markdown);
  }, [initialHtml, markdown]);

  const [html, setHtml] = useState(computedInitialHtml);
  const [showPaginated, setShowPaginated] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState("pdf");
  const [fontSizeInput, setFontSizeInput] = useState("14");
  const ref = useRef(null);
  const savedRangeRef = useRef(null);

  useEffect(() => {
    setHtml(computedInitialHtml);
    if (ref.current) {
      ref.current.innerHTML = computedInitialHtml || "";
    }
    if (typeof onHtmlChange === "function") {
      onHtmlChange(computedInitialHtml);
    }
    savedRangeRef.current = null;
  }, [computedInitialHtml]);

  function saveSelection() {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    savedRangeRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection?.();
    if (!sel) return;
    sel.removeAllRanges();
    if (savedRangeRef.current) sel.addRange(savedRangeRef.current);
  }

  function ensureSelection() {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection?.();
    if (!sel) return;
    const existing = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (existing && el.contains(existing.commonAncestorContainer)) {
      savedRangeRef.current = existing.cloneRange();
      return;
    }
    if (savedRangeRef.current) {
      restoreSelection();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRangeRef.current = range.cloneRange();
  }

  function exec(command, value) {
    const el = ref.current;
    if (!el) return;
    const prevTop = el.scrollTop;
    ensureSelection();
    try {
      document.execCommand(command, false, value);
    } finally {
      const next = ref.current?.innerHTML ?? html;
      setHtml(next);
      saveSelection();
      requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = prevTop;
      });
    }
  }

  useEffect(() => {
    if (typeof onSave !== "function") return;
    const handler = (e) => {
      const isSave =
        (e.ctrlKey || e.metaKey) &&
        String(e.key || "").toLowerCase() === "s";
      if (!isSave) return;
      e.preventDefault();
      onSave();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSave]);

  function applyFontSize(pxValue) {
    const el = ref.current;
    if (!el) return;
    const size = Math.max(8, Math.min(48, parseInt(pxValue, 10) || 14));
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    const prevTop = el.scrollTop;

    const span = document.createElement("span");
    span.style.fontSize = `${size}px`;

    if (range.collapsed) {
      span.appendChild(document.createTextNode("\u200b"));
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span.firstChild, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      newRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    const next = ref.current?.innerHTML ?? html;
    setHtml(next);
    saveSelection();
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = prevTop;
    });
  }

  function getBodyHtml() {
    const fromEditor = ref.current?.innerHTML;
    if (fromEditor && fromEditor.trim()) return fromEditor;
    if (html && html.trim()) return html;
    return markdownToHtml(markdown);
  }

  useEffect(() => {
    setHtml(computedInitialHtml);
  }, [computedInitialHtml]);

  useEffect(() => {
    if (!showPaginated && ref.current) {
      const current = ref.current.innerHTML || "";
      const nextHtml = html || computedInitialHtml || "";
      if (!current.trim() && nextHtml.trim()) {
        ref.current.innerHTML = nextHtml;
      }
    }
  }, [showPaginated, html, computedInitialHtml]);

  const paginatedHtml = useMemo(() => {
    const bodyHtml = getBodyHtml();
    return buildPreviewFragment({ title, bodyHtml });
  }, [html, title, markdown]);

  return (
    <Card className="h-full min-h-0 flex flex-col">
      <div className="-mx-5 -mt-5 mb-4 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur flex-shrink-0 dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="ea-input h-10 w-[150px] shrink-0"
            defaultValue="3"
            onMouseDown={saveSelection}
            onChange={(e) => exec("fontSize", e.target.value)}
            title="Font size"
          >
            <option value="2">Font 12</option>
            <option value="3">Font 14</option>
            <option value="4">Font 16</option>
            <option value="5">Font 18</option>
          </select>
          <input
            type="number"
            min="8"
            max="48"
            value={fontSizeInput}
            onChange={(e) => setFontSizeInput(e.target.value)}
            onBlur={() => applyFontSize(fontSizeInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyFontSize(fontSizeInput);
              }
            }}
            className="ea-input h-10 w-[90px]"
            placeholder="Size"
            title="Type font size (px) and press Enter"
          />

          <div className="h-6 w-px bg-slate-200" />

          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("undo")} title="Undo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h6a7 7 0 1 1 0 14h-4"/><path d="M3 7l4-4M3 7l4 4"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("redo")} title="Redo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7h-6a7 7 0 1 0 0 14h4"/><path d="M21 7l-4-4M21 7l-4 4"/></svg>
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("bold")} title="Bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 5h6a4 4 0 0 1 0 8H7z"/><path d="M7 13h7a4 4 0 1 1 0 8H7z"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("italic")} title="Italic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 4h-6"/><path d="M11 20H5"/><path d="M14 4l-4 16"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("underline")} title="Underline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("insertUnorderedList")} title="Bulleted list">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("justifyLeft")} title="Align left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16"/><path d="M4 10h10"/><path d="M4 14h16"/><path d="M4 18h10"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("justifyCenter")} title="Align center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16"/><path d="M7 10h10"/><path d="M4 14h16"/><path d="M7 18h10"/></svg>
          </button>
          <button type="button" className="ea-icon-btn" onMouseDown={(e) => { saveSelection(); e.preventDefault(); }} onClick={() => exec("justifyRight")} title="Align right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16"/><path d="M10 10h10"/><path d="M4 14h16"/><path d="M10 18h10"/></svg>
          </button>

          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
            <span>Color</span>
            <input
              type="color"
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
              defaultValue="#111827"
              onMouseDown={saveSelection}
              onChange={(e) => exec("foreColor", e.target.value)}
              title="Text color"
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`ea-icon-btn ${showPaginated ? "" : "ea-icon-btn-active"}`}
              onClick={() => setShowPaginated(false)}
              title="Edit mode"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              className={`ea-icon-btn ${showPaginated ? "ea-icon-btn-active" : ""}`}
              onClick={() => {
                const current = ref.current?.innerHTML;
                if (current && current.trim()) {
                  setHtml(current);
                  if (typeof onHtmlChange === "function") onHtmlChange(current);
                }
                setShowPaginated(true);
              }}
              title="Preview mode (read-only)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M8 7h8M8 11h8M8 15h6" />
              </svg>
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {showPaginated ? "Preview mode (read‑only)" : "Edit mode"}
            </span>
          </div>

          <div className="h-6 w-px bg-slate-200" />

          <Button
            variant="secondary"
            onClick={async () => {
              const text = ref.current?.innerText || "";
              await navigator.clipboard.writeText(text);
            }}
          >
            Copy
          </Button>

          <select
            className="ea-input h-10 w-[140px]"
            value={downloadFormat}
            onChange={(e) => setDownloadFormat(e.target.value)}
          >
            <option value="pdf">PDF</option>
            <option value="doc">Word</option>
          </select>

          <Button
            variant="secondary"
            disabled={!onDownload}
            onClick={() => onDownload?.(downloadFormat)}
          >
            Download
          </Button>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 flex-1 min-h-0 dark:bg-slate-900/60 dark:ring-slate-800">
        <div className="h-full min-h-0 overflow-auto rounded-2xl pr-1">
          {showPaginated ? (
            <div
              className="h-full min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700"
              style={{ color: "#0f172a" }}
              dangerouslySetInnerHTML={{ __html: paginatedHtml }}
            />
          ) : (
            <div
              ref={ref}
              className="ea-doc mx-auto w-full max-w-[900px] rounded-xl border border-slate-200 bg-white p-8 shadow-sm outline-none dark:border-slate-700 dark:bg-white"
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                const next = e.currentTarget.innerHTML;
                setHtml(next);
                if (typeof onHtmlChange === "function") onHtmlChange(next);
              }}
              onKeyUp={saveSelection}
              onMouseUp={saveSelection}
              onFocus={saveSelection}
            />
          )}
        </div>
      </div>
    </Card>
  );
}
