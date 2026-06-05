import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import html2pdf from "html2pdf.js";
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
  const documentRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [emailRequired, setEmailRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [respondAction, setRespondAction] = useState(null); // "accept" | "reject" | null
  const [respondDone, setRespondDone] = useState(false);
  const [respondError, setRespondError] = useState(null);

  function isEmailGateMessage(message) {
    return (
      message.includes("Email address required for this share link") ||
      message.includes("restricted to a different email address")
    );
  }

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
          setEmailRequired(isEmailGateMessage(msg));
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
    if (markdown) {
      if (looksLikeHtmlDocument(markdown)) {
        const parsed = parseHtmlDocument(markdown);
        return { ...parsed, isFullHtml: true };
      }
      return { bodyHtml: markdownToHtml(markdown), styleHtml: "", isFullHtml: false };
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
      if (isFullHtml && bodyHtml.trim() && documentRef.current) {
        const source = documentRef.current.cloneNode(true);
        const container = document.createElement("div");
        container.appendChild(source);
        container.style.width = "210mm";
        container.style.padding = "12mm";
        container.style.boxSizing = "border-box";
        container.style.fontSize = "14px";
        container.style.lineHeight = "1.5";
        container.style.color = "#0f172a";
        container.style.background = "#ffffff";
        document.body.appendChild(container);
        try {
          await html2pdf()
            .set({
              filename: `${safeTitle}.pdf`,
              margin: [10, 10, 10, 10],
              pagebreak: { mode: ["css", "legacy", "avoid-all"] },
              image: { type: "jpeg", quality: 0.98 },
              html2canvas: {
                scale: 3,
                useCORS: true,
                windowWidth: 794,
                windowHeight: 1123,
                backgroundColor: "#ffffff",
                letterRendering: true,
              },
              jsPDF: { unit: "pt", format: "a4", orientation: "portrait", compress: true },
            })
            .from(container)
            .save();
        } finally {
          document.body.removeChild(container);
        }
        return;
      }
      const suffix = submittedEmail.trim() ? `&email=${encodeURIComponent(submittedEmail.trim())}` : "";
      const res = await fetch(`${getApiBaseUrl()}/blueprint/share/${token}/export?format=pdf${suffix}`);
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

  const isQuotationAcceptance = String(doc?.type || "").startsWith("quotation_acceptance");

  async function handleRespond(action) {
    setRespondAction(action);
    setRespondError(null);
    try {
      await apiRequest(`/blueprint/share/${token}/respond`, "POST", {
        action,
        email: submittedEmail.trim() || null,
      });
      setRespondDone(action);
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : "Failed to submit response.");
    } finally {
      setRespondAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_45%,#f8fafc_100%)]">
      <div className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="flex w-full items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
          <div className="shrink-0">
            <img
              src={enterprateLogo}
              alt="EnterprateAI"
              className="block h-6 w-auto max-w-[72px] object-contain sm:h-8 sm:max-w-[160px]"
            />
          </div>

          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-center text-xs font-semibold text-slate-900 sm:text-sm">{title}</div>
          </div>

          <div className="shrink-0">
            <Button
              variant="secondary"
              disabled={loading || downloading || !bodyHtml.trim()}
              onClick={downloadPdf}
            >
              <span className="hidden sm:inline">{downloading ? "Preparing..." : "Download PDF"}</span>
              <span className="sm:hidden">{downloading ? "..." : "PDF"}</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-24 sm:px-6 sm:pb-12">

        {loading ? (
          <div className="mt-8 flex min-h-[280px] items-center justify-center rounded-[28px] border border-slate-200 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-8 flex min-h-[calc(100vh-180px)] items-start justify-center sm:items-center">
            {emailRequired ? (
              <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_25px_80px_rgba(15,23,42,0.10)] sm:p-8">
                <div className="mx-auto max-w-md text-center">
                  <div className="inline-flex rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">
                    Protected Access
                  </div>
                  <div className="mt-4 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                    Enter the approved email address
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    This shared document is restricted to a specific recipient. Use the approved email to continue.
                  </p>
                </div>
                {submittedEmail.trim() && error ? (
                  <div className="mx-auto mt-5 max-w-md rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}
                <div className="mx-auto mt-6 max-w-md">
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Approved email address
                  </label>
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="recipient@company.com"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                  />
                  <div className="mt-4 flex justify-center sm:justify-start">
                    <Button onClick={() => setSubmittedEmail(shareEmail.trim())} disabled={!shareEmail.trim()}>
                      Continue
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-2xl rounded-[28px] border border-rose-200 bg-white/95 px-5 py-6 text-center shadow-[0_25px_80px_rgba(15,23,42,0.10)] sm:px-8">
                <div className="text-lg font-semibold text-slate-900">Unable to open this document</div>
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              </div>
            )}
          </div>
        ) : bodyHtml.trim() ? (
            <div
              ref={documentRef}
              className={`mt-8 rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)] ${isFullHtml ? "px-2 py-2 sm:px-6 sm:py-6" : "px-5 py-6 sm:px-8"}`}
            >
              {isFullHtml ? <div dangerouslySetInnerHTML={{ __html: styleHtml }} /> : null}
              {!isFullHtml ? (
                <style>{`
                  .shared-doc { max-width: 860px; margin: 0 auto; }
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
            <div className="mt-8 rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-600 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            This share link is valid, but the document is empty.
          </div>
        )}

        {/* Quotation Accept/Reject */}
        {isQuotationAcceptance && !loading && bodyHtml.trim() && (
          <div className="mt-6 rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            {respondDone ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${respondDone === "accept" ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                  {respondDone === "accept" ? (
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                  ) : (
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  )}
                </div>
                <div className="text-[15px] font-bold text-slate-900">
                  {respondDone === "accept" ? "Quotation accepted!" : "Quotation rejected."}
                </div>
                <p className="text-sm text-slate-500">
                  {respondDone === "accept"
                    ? "Your acceptance has been recorded. The business will be in touch to confirm next steps."
                    : "Your rejection has been recorded. Thank you for your response."}
                </p>
              </div>
            ) : (
              <>
                <h3 className="mb-1 text-[15px] font-bold text-slate-900">Respond to this Quotation</h3>
                <p className="mb-4 text-sm text-slate-500">Please review the quotation above and let us know if you accept or reject it.</p>
                {respondError && (
                  <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{respondError}</div>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    disabled={Boolean(respondAction)}
                    onClick={() => handleRespond("accept")}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {respondAction === "accept" ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>}
                    Accept Quotation
                  </button>
                  <button
                    disabled={Boolean(respondAction)}
                    onClick={() => handleRespond("reject")}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {respondAction === "reject" ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>}
                    Reject Quotation
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
