import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Spinner from "../components/Spinner";
import Button from "../components/Button";
import { apiRequest, getApiBaseUrl } from "../api/client";
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

    if (/^<img\b/i.test(trimmed)) {
      closeList();
      html += trimmed;
      continue;
    }

    const mdImgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (mdImgMatch) {
      closeList();
      const [, alt, src] = mdImgMatch;
      html += `<img class="document-logo" src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}" />`;
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

function looksLikeHtmlDocument(value) {
  const source = String(value || "").trim().toLowerCase();
  return source.startsWith("<!doctype html") || source.startsWith("<html") || source.includes("<body");
}

function looksLikeMarkdownDocument(value) {
  const source = String(value || "").trim();
  if (!source) return false;
  const lower = source.toLowerCase();
  if (lower.includes("<html") || lower.includes("<body")) {
    return false;
  }
  return (
    source.startsWith("# ") ||
    source.startsWith("## ") ||
    source.startsWith("### ") ||
    source.startsWith("![") ||
    source.includes("\n![") ||
    source.startsWith("**") ||
    source.includes("\n# ") ||
    source.includes("\n## ") ||
    source.includes("\n### ") ||
    source.includes("\n**") ||
    source.includes("\n* ") ||
    source.includes("\n- ")
  );
}

function parseHtmlDocument(html) {
  const source = String(html || "").trim();
  if (!source) return { bodyHtml: "", styleHtml: "" };
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(source, "text/html");
    const styleHtml = Array.from(parsed.head?.querySelectorAll("style, link[rel='stylesheet']") || [])
      .map((node) => node.outerHTML)
      .join("\n");
    const bodyHtml = parsed.body?.innerHTML?.trim() || source;
    return { bodyHtml, styleHtml };
  } catch {
    return { bodyHtml: source, styleHtml: "" };
  }
}

export default function SharedBlueprintPage() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [emailRequired, setEmailRequired] = useState(false);
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
        const suffix = submittedEmail.trim() ? `?email=${encodeURIComponent(submittedEmail.trim())}` : "";
        const data = await apiRequest(`/blueprint/share/${token}${suffix}`, "GET");
        if (!cancelled) {
          setDoc(data);
          setEmailRequired(false);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to load shared document.";
        if (!cancelled) {
          setError(msg);
          setEmailRequired(
            msg.includes("Email address required for this share link") ||
            msg.includes("restricted to a different email address")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token, submittedEmail]);

  const title = doc?.title || "Document";
  const renderedDoc = useMemo(() => {
    const html = String(doc?.document_html || "").trim();
    const markdown = String(doc?.document_markdown || "").trim();
    if (markdown) {
      if (looksLikeHtmlDocument(markdown)) {
        const parsed = parseHtmlDocument(markdown);
        return { ...parsed, isFullHtml: true };
      }
      return { bodyHtml: markdownToHtml(markdown), styleHtml: "", isFullHtml: false };
    }
    if (html) {
      if (looksLikeMarkdownDocument(html)) {
        return { bodyHtml: markdownToHtml(html), styleHtml: "", isFullHtml: false };
      }
      if (looksLikeHtmlDocument(html)) {
        const parsed = parseHtmlDocument(html);
        return { ...parsed, isFullHtml: true };
      }
      return { bodyHtml: html, styleHtml: "", isFullHtml: false };
    }
    return { bodyHtml: "", styleHtml: "", isFullHtml: false };
  }, [doc?.document_html, doc?.document_markdown]);
  const bodyHtml = renderedDoc.bodyHtml;
  const styleHtml = renderedDoc.styleHtml;
  const isFullHtml = renderedDoc.isFullHtml;

  async function downloadPdf() {
    if (!token) return;
    setDownloading(true);
    try {
      const safeTitle = String(title || "document")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-_]/g, "") || "document";
      const res = await fetch(`${getApiBaseUrl()}/blueprint/share/${token}/export?format=pdf`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch {
      alert("Unable to generate PDF. Please try again.");
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
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
            {emailRequired ? (
              <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">Enter the approved email address</div>
                <p className="mt-1 text-xs text-slate-500">This document was shared as a specific-email-only link.</p>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="recipient@company.com"
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                />
                <div className="mt-3">
                  <Button onClick={() => setSubmittedEmail(shareEmail.trim())} disabled={!shareEmail.trim()}>
                    Try email
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : bodyHtml.trim() ? (
          <div className={`mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm ${isFullHtml ? "px-3 py-3 sm:px-6 sm:py-6" : "px-6 py-6"}`}>
            {isFullHtml ? <div dangerouslySetInnerHTML={{ __html: styleHtml }} /> : null}
            {!isFullHtml ? (
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
            ) : null}
            <div className={isFullHtml ? "shared-native-doc" : "shared-doc"} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
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
