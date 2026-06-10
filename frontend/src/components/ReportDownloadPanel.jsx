import { useMemo, useState } from "react";
import { generateAndDownloadPdf } from "../lib/reports/index";
import { buildReportSections, buildFullHtml, REPORT_TITLES } from "../lib/reports/report-templates.js";
import { apiRequest } from "../api/client";
import Spinner from "./Spinner";

const REPORT_DEFS = {
  business_health_report: {
    label: "Business Health Report",
    description: "Full assessment — scores, risks, recommendations, and next actions.",
    sections: ["Executive Summary", "Intelligence Scores", "Top Risks", "Recommendations", "Confidence & Data Quality", "Disclaimer"],
  },
  investor_summary: {
    label: "Investor Summary",
    description: "Concise snapshot of scores, classification, and strategic position.",
    sections: ["Executive Summary", "Intelligence Scores", "Strategic Classification", "Confidence & Data Quality", "Disclaimer"],
  },
  scenario_report: {
    label: "Scenario Analysis Report",
    description: "Detailed output from a simulation run — timeline, deltas, and risks.",
    sections: ["Executive Summary", "Scenario Overview", "Scenario Timeline", "Risk Signals", "Recommendations", "Disclaimer"],
  },
  fragility_report: {
    label: "Fragility Report",
    description: "Structural vulnerability, concentration risks, and mitigation plan.",
    sections: ["Executive Summary", "Fragility Index", "Top Risks", "Recommendations", "Disclaimer"],
  },
  stability_report: {
    label: "Stability Report",
    description: "Monthly financials, margin, runway, and stability classification.",
    sections: ["Executive Summary", "Intelligence Scores", "Confidence & Data Quality", "Disclaimer"],
  },
};

const CONFIDENCE_LABELS = {
  HIGH: { label: "High", color: "text-emerald-600" },
  MEDIUM: { label: "Medium", color: "text-amber-600" },
  LOW: { label: "Limited — add more data for best results", color: "text-slate-500" },
};

function PreviewModal({ reportType, output, currency, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  const def = REPORT_DEFS[reportType] || REPORT_DEFS.business_health_report;
  const conf = output?.confidence || {};
  const confLevel = conf.overallLevel || "LOW";
  const confInfo = CONFIDENCE_LABELS[confLevel] || CONFIDENCE_LABELS.LOW;

  // Build the preview HTML synchronously — same HTML that will go into the PDF
  const previewHtml = useMemo(() => {
    if (!output) return "";
    try {
      const cur = currency || output?.business?.currency || "GBP";
      const sections = buildReportSections(reportType, output, cur);
      return buildFullHtml({
        output,
        reportType,
        sections,
        businessName: output?.business?.businessName || "Business",
        reportTitle: REPORT_TITLES[reportType],
        currency: cur,
        companyName: "EnterprateAI",
      });
    } catch {
      return "";
    }
  }, [output, reportType, currency]);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    setProgress("Building report...");
    try {
      await generateAndDownloadPdf({
        output,
        reportType,
        branding: { companyName: "EnterprateAI" },
        onProgress: setProgress,
      });
      apiRequest("/v1/reports/generate", "POST", {
        reportType,
        includeNarratives: true,
        sections: (def.sections || []).map((title, i) => ({
          sectionKey: title.toLowerCase().replace(/\s+/g, "_"),
          title,
          sectionOrder: i,
          dataSource: "narrative",
        })),
        title: null,
      }).catch(() => {});
      onClose();
    } catch (e) {
      setError(e?.message || "Could not generate PDF. Try again.");
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" />
      <div
        className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{def.label}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Preview</span>
                <span>·</span>
                <span className={confInfo.color}>Confidence: {conf.overallLevel || "LOW"}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Report preview iframe */}
        <div className="min-h-0 flex-1 overflow-hidden bg-slate-100 dark:bg-slate-800">
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              title={`Preview: ${def.label}`}
              sandbox="allow-same-origin"
              className="h-full w-full border-0"
              style={{ minHeight: "460px" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center py-12 text-sm text-slate-500">
              Loading preview...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          {error ? (
            <div className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">{error}</div>
          ) : null}
          {progress && !error ? (
            <div className="mb-2 text-xs text-slate-500">{progress}</div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-slate-400">PDF is generated in your browser from saved data. No data is re-calculated.</p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {generating ? <><Spinner size={13} /> {progress || "Generating..."}</> : (
                  <>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    Download PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline panel that shows report type buttons and opens a preview modal.
 *
 * Props:
 *   output       — EnterprateIntelligenceOutput (assembled by parent)
 *   currency     — e.g. "GBP"
 *   reportTypes  — array of report type IDs to show (default: all non-scenario)
 *   compact      — if true, renders a smaller horizontal strip
 *   className    — extra classes on the wrapper
 */
export default function ReportDownloadPanel({
  output,
  currency = "GBP",
  reportTypes,
  compact = false,
  className = "",
}) {
  const [preview, setPreview] = useState(null); // report type id

  const types = reportTypes || ["business_health_report", "investor_summary", "fragility_report", "stability_report"];
  const hasOutput = Boolean(output);

  if (compact) {
    return (
      <>
        <div className={`flex flex-wrap gap-2 ${className}`}>
          {types.map((id) => {
            const def = REPORT_DEFS[id];
            if (!def) return null;
            return (
              <button
                key={id}
                type="button"
                disabled={!hasOutput}
                onClick={() => setPreview(id)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition"
              >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                </svg>
                {def.label}
              </button>
            );
          })}
        </div>
        {preview ? (
          <PreviewModal
            reportType={preview}
            output={output}
            currency={currency}
            onClose={() => setPreview(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className}`}>
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</span>
        </div>
        <div className="space-y-2">
          {types.map((id) => {
            const def = REPORT_DEFS[id];
            if (!def) return null;
            return (
              <button
                key={id}
                type="button"
                disabled={!hasOutput}
                onClick={() => setPreview(id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left hover:border-brand-200 hover:bg-brand-50/60 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60 transition group"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-400">
                    {def.label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{def.description}</div>
                </div>
                <svg className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      {preview ? (
        <PreviewModal
          reportType={preview}
          output={output}
          currency={currency}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
