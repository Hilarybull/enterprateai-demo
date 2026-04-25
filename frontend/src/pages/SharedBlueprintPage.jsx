import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Spinner from "../components/Spinner";
import Button from "../components/Button";
import { apiRequest } from "../api/client";
import html2pdf from "html2pdf.js";
import enterprateLogo from "../logo.png";

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

    if (trimmed.startsWith("<p class=\"subject-line\">") && trimmed.endsWith("</p>")) {
      closeList();
      html += trimmed;
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
      line.startsWith("â€¢ ") ? line.slice(2) :
      line.startsWith("â€“ ") ? line.slice(2) :
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

function extractHtmlBody(html) {
  const source = String(html || "").trim();
  if (!source) return "";
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(source, "text/html");
    return parsed.body?.innerHTML?.trim() || source;
  } catch {
    return source;
  }
}

function looksLikeHtmlDocument(value) {
  const source = String(value || "").trim().toLowerCase();
  return source.startsWith("<!doctype html") || source.startsWith("<html") || source.includes("<body");
}

function safeFilename(title) {
  const base = String(title || "document")
    .toLowerCase()
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9\-_]/g, "");
  return base || "document";
}

export default function SharedBlueprintPage() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // The main app uses a fixed-layout shell with `body { overflow-hidden; }`.
    // Shared documents should use normal browser scrolling, so we temporarily
    // override overflow/height for this route.
    const root = document.getElementById("root");
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      htmlHeight: document.documentElement.style.height,
      bodyOverflow: document.body.style.overflow,
      bodyOverflowY: document.body.style.overflowY,
      bodyHeight: document.body.style.height,
      rootHeight: root?.style.height,
      rootMinHeight: root?.style.minHeight,
    };
    document.documentElement.style.overflow = "auto";
    document.documentElement.style.height = "auto";
    document.body.style.overflow = "auto";
    document.body.style.overflowY = "auto";
    document.body.style.height = "auto";
    if (root) {
      root.style.height = "auto";
      root.style.minHeight = "100vh";
    }
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.documentElement.style.height = prev.htmlHeight;
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.overflowY = prev.bodyOverflowY;
      document.body.style.height = prev.bodyHeight;
      if (root) {
        root.style.height = prev.rootHeight || "";
        root.style.minHeight = prev.rootMinHeight || "";
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) {
        setError("Missing share token.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest(`/blueprint/share/${token}`, "GET");
        if (!cancelled) setDoc(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to load shared document.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const title = doc?.title || "Document";
  const bodyHtml = useMemo(() => {
    const html = String(doc?.document_html || "").trim();
    const markdown = String(doc?.document_markdown || "").trim();
    if (html) {
      return looksLikeHtmlDocument(html) ? extractHtmlBody(html) : html;
    }
    if (looksLikeHtmlDocument(markdown)) {
      return extractHtmlBody(markdown);
    }
    return markdownToHtml(markdown);
  }, [doc?.document_html, doc?.document_markdown]);

  async function downloadPdf() {
    if (!bodyHtml.trim()) return;
    setDownloading(true);
    try {
      const container = document.createElement("div");
      const pdfStyles = `
        <style>
          * { box-sizing: border-box; }
          :root { color-scheme: light; }
          body { margin: 0; padding: 0; }
          .pdf-doc { width: 100%; max-width: 190mm; padding: 14mm 10mm; font-family: "Inter", "Segoe UI", Arial, sans-serif; background: #ffffff; margin: 0 auto; box-sizing: border-box; }
          .pdf-doc, .pdf-doc * { color: #0f172a !important; }
          h1 { text-align: center; font-size: 24px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }
          h2 { text-align: center; font-size: 16px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }
          h3 { font-size: 14px; font-weight: 800; margin: 16px 0 6px; }
          p, li { font-size: 12.5px; line-height: 1.7; orphans: 3; widows: 3; }
          ul { margin: 8px 0 0 18px; padding: 0; }
          li { margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0 6px; font-size: 12.5px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-weight: 700; }
          .subject-line { text-align: center; margin: 8px 0 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
          .cover-page { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
          .cover-page p { margin: 6px 0; }
          .page-break { page-break-after: always; break-after: page; height: 1px; }
        </style>
      `;
      container.innerHTML = `${pdfStyles}<div class="pdf-doc">${bodyHtml}</div>`;
      container.style.width = "210mm";
      container.style.padding = "0";
      container.style.boxSizing = "border-box";
      container.style.fontSize = "14px";
      container.style.lineHeight = "1.5";
      container.style.color = "#0f172a";
      container.style.background = "#ffffff";
      container.style.position = "fixed";
      container.style.left = "-99999px";
      container.style.top = "0";
      document.body.appendChild(container);

      await html2pdf()
        .set({
          filename: `${safeFilename(title)}.pdf`,
          margin: [6, 6, 6, 6],
          pagebreak: { mode: ["css", "legacy", "avoid-all"] },
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            windowWidth: 1100,
            windowHeight: 1550,
            backgroundColor: "#ffffff",
            letterRendering: true,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
        })
        .from(container)
        .save();
      document.body.removeChild(container);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="grid w-full grid-cols-[auto,1fr,auto] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-self-start">
            <div className="flex h-10 items-center sm:h-12">
              <img
                src={enterprateLogo}
                alt="EnterprateAI"
                className="block h-8 w-auto max-w-[140px] object-contain sm:h-10 sm:max-w-[220px]"
              />
            </div>
          </div>

          <div className="min-w-0 justify-self-center">
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          </div>

          <div className="justify-self-end">
            <Button variant="secondary" disabled={loading || downloading || !bodyHtml.trim()} onClick={downloadPdf}>
              {downloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-6 pt-24">

        {loading ? (
          <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : doc?.document_markdown ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm">
            <style>{`
              .shared-doc h1 { text-align: center; font-size: 28px; font-weight: 800; margin: 0 0 16px; letter-spacing: -0.02em; }
              .shared-doc h2 { font-size: 18px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }
              .shared-doc h3 { font-size: 15px; font-weight: 800; margin: 16px 0 6px; }
              .shared-doc p, .shared-doc li { font-size: 14.5px; line-height: 1.85; color: #111827; }
              .shared-doc ul { margin: 8px 0 0 20px; padding: 0; }
              .shared-doc li { margin: 6px 0; }
              .shared-doc strong { color: #0f172a; }
              .shared-doc table { width: 100%; border-collapse: collapse; margin: 14px 0 8px; font-size: 14px; }
              .shared-doc th, .shared-doc td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; }
              .shared-doc th { background: #f8fafc; font-weight: 800; }
              .shared-doc .subject-line { text-align: center; margin: 10px 0 14px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
              .shared-doc .cover-page { min-height: 50vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
              .shared-doc .cover-page p { margin: 6px 0; }
              .shared-doc .page-break { height: 1px; margin: 26px 0; background: #e5e7eb; }
            `}</style>
            <div className="shared-doc" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            This share link is valid, but the document is empty.
          </div>
        )}
      </div>
    </div>
  );
}
