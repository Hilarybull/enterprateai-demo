/**
 * HTML templates for PDF report rendering.
 * All templates return HTML strings with inline styles for PDF compatibility.
 * No external stylesheets — everything must be self-contained.
 */

import { formatCurrency } from "../format.js";

const BRAND = {
  primary: "#6366f1",
  accent: "#f43f5e",
  dark: "#0f172a",
  muted: "#64748b",
  light: "#f8fafc",
  border: "#e2e8f0",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
};

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function coverPage({ businessName, reportTitle, reportType, generatedAt, companyName }) {
  const date = generatedAt ? new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `
    <div style="min-height:280px;background:linear-gradient(135deg,${BRAND.primary} 0%,#4f46e5 100%);padding:48px 40px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-bottom:32px;">
        ${companyName || "EnterprateAI"} &nbsp;·&nbsp; Decision-Support Report
      </div>
      <div style="font-size:32px;font-weight:800;color:#ffffff;line-height:1.2;margin-bottom:12px;">
        ${reportTitle || "Business Intelligence Report"}
      </div>
      <div style="font-size:16px;color:rgba(255,255,255,0.85);margin-bottom:32px;">
        ${businessName || "Your Business"}
      </div>
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:6px;padding:8px 16px;font-size:12px;color:rgba(255,255,255,0.9);">
        ${reportType ? reportType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Assessment"} &nbsp;·&nbsp; Generated ${date}
      </div>
    </div>
  `;
}

function scoreCards({ scores, currency }) {
  const cards = [
    { label: "Viability", value: scores?.viabilityScore, unit: "/100" },
    { label: "Stability", value: scores?.stabilityScore, unit: "/100" },
    { label: "Survival", value: scores?.survivalScore, unit: "/100" },
    { label: "Intelligence", value: scores?.businessIntelligenceScore, unit: "/100" },
  ].filter((c) => c.value != null);

  if (!cards.length) return "";

  const cardHtml = cards
    .map((c) => {
      const pct = Math.round(c.value);
      const color = pct >= 70 ? BRAND.green : pct >= 50 ? BRAND.amber : BRAND.red;
      return `
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid ${BRAND.border};border-radius:8px;padding:20px 16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">${c.label}</div>
          <div style="font-size:28px;font-weight:800;color:${color};">${pct}</div>
          <div style="font-size:10px;color:${BRAND.muted};">${c.unit}</div>
          <div style="margin-top:8px;height:4px;background:${BRAND.border};border-radius:2px;">
            <div style="height:4px;width:${pct}%;background:${color};border-radius:2px;"></div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div style="margin-bottom:24px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Intelligence Scores</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${cardHtml}
      </div>
    </div>
  `;
}

function executiveSummarySection({ executiveSummary, classifications }) {
  const ex = executiveSummary || {};
  return `
    <div style="margin-bottom:28px;background:${BRAND.light};border-left:4px solid ${BRAND.primary};border-radius:0 8px 8px 0;padding:20px 24px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.primary};margin-bottom:8px;">Executive Summary</div>
      <div style="font-size:16px;font-weight:700;color:${BRAND.dark};margin-bottom:10px;">${ex.headline || "—"}</div>
      <div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:12px;">${ex.summary || ""}</div>
      ${ex.keyStrength ? `<div style="font-size:12px;color:#374151;margin-bottom:4px;"><strong>Strongest area:</strong> ${ex.keyStrength}</div>` : ""}
      ${ex.keyWeakness ? `<div style="font-size:12px;color:#374151;margin-bottom:4px;"><strong>Main concern:</strong> ${ex.keyWeakness}</div>` : ""}
      ${ex.strategicPriority ? `<div style="font-size:12px;color:#374151;margin-top:8px;"><strong>Strategic priority:</strong> ${ex.strategicPriority}</div>` : ""}
      ${classifications?.label ? `<div style="margin-top:10px;display:inline-block;background:${BRAND.primary};color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;border-radius:20px;">${classifications.label}</div>` : ""}
    </div>
  `;
}

function risksSection({ risks, currency }) {
  const topRisks = risks?.topRisks || [];
  if (!topRisks.length) {
    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Risk Alerts</div>
        <div style="color:${BRAND.muted};font-size:13px;">No risk signals detected.</div>
      </div>
    `;
  }
  const severityColor = { CRITICAL: "#dc2626", HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#6b7280" };
  const rows = topRisks
    .slice(0, 6)
    .map((r) => {
      const color = severityColor[r.severity] || BRAND.muted;
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;font-weight:600;">
            <span style="display:inline-block;background:${color}20;color:${color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;margin-right:6px;">${r.severity}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:#374151;">${r.explanation}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted};">${r.recommendedAction}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Top Risks</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:${BRAND.light};">
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">Severity</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">Risk</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">Recommended Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function recommendationsSection({ recommendations }) {
  const recs = recommendations?.topRecommendations || [];
  if (!recs.length) {
    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Recommendations</div>
        <div style="color:${BRAND.muted};font-size:13px;">No recommendations available yet.</div>
      </div>
    `;
  }
  const priorityColor = { CRITICAL: "#dc2626", HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#6b7280" };
  const rows = recs
    .slice(0, 6)
    .map((r) => {
      const color = priorityColor[r.priority] || BRAND.muted;
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};">
            <span style="display:inline-block;background:${color}20;color:${color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;">${r.priority}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:#374151;">${r.text}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:11px;color:${BRAND.muted};">${r.reason || "—"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Recommendations</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:${BRAND.light};">
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};width:100px;">Priority</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">Action</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">Reason</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function scenarioSection({ scenarios, currency }) {
  if (!scenarios) return "";
  const timeline = scenarios.timelineSummary;
  const deltas = scenarios.deltas || {};

  const statColor = (v) => (v == null ? BRAND.muted : v > 0 ? BRAND.green : v < 0 ? BRAND.red : BRAND.muted);
  const statSign = (v) => (v > 0 ? "+" : "");

  const metrics = [
    { label: "Stability delta", value: deltas.stabilityDelta },
    { label: "End revenue", value: timeline?.endRevenue, currency: true },
    { label: "End profit", value: timeline?.endProfit, currency: true },
    { label: "End cash balance", value: timeline?.endCashBalance, currency: true },
  ].filter((m) => m.value != null);

  const metricCards = metrics
    .map((m) => {
      const formatted = m.currency ? formatCurrency(m.value, currency) : `${statSign(m.value)}${Number(m.value).toFixed(1)}`;
      const color = statColor(m.value);
      return `
        <div style="flex:1;min-width:120px;background:#fff;border:1px solid ${BRAND.border};border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">${m.label}</div>
          <div style="font-size:18px;font-weight:800;color:${color};">${formatted}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Scenario: ${scenarios.scenarioName || "Simulation"}</div>
      <div style="background:${BRAND.light};border:1px solid ${BRAND.border};border-radius:8px;padding:16px;margin-bottom:12px;font-size:12px;color:#374151;">
        Type: ${(scenarios.scenarioType || "—").replace(/_/g, " ")}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">${metricCards}</div>
    </div>
  `;
}

function nextActionsSection({ executiveSummary }) {
  const actions = executiveSummary?.nextBestActions || [];
  if (!actions.length) return "";
  const items = actions
    .map((a, i) => `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid ${BRAND.border};">
        <div style="min-width:24px;height:24px;background:${BRAND.primary};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${i + 1}</div>
        <div style="font-size:13px;color:#374151;">${a}</div>
      </div>
    `)
    .join("");

  return `
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:12px;">Next Best Actions</div>
      ${items}
    </div>
  `;
}

function confidenceSection({ confidence, narratives }) {
  const level = confidence?.overallLevel || "LOW";
  const notes = confidence?.dataQualityNotes || [];
  const color = level === "HIGH" ? BRAND.green : level === "MEDIUM" ? BRAND.amber : BRAND.red;
  const confNarrative = narratives?.confidenceNarrative || "";
  return `
    <div style="margin-bottom:28px;background:${BRAND.light};border:1px solid ${BRAND.border};border-radius:8px;padding:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">Data Confidence</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="display:inline-block;background:${color}20;color:${color};font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;text-transform:uppercase;">${level}</span>
        <span style="font-size:12px;color:#374151;">Overall confidence level</span>
      </div>
      ${confNarrative ? `<div style="font-size:12px;color:#374151;margin-bottom:8px;">${confNarrative}</div>` : ""}
      ${notes.map((n) => `<div style="font-size:11px;color:${BRAND.muted};margin-top:4px;">· ${n}</div>`).join("")}
    </div>
  `;
}

function aiNarrativeSection({ title, narrative }) {
  if (!narrative) return "";

  // Handlers for different object structures from the AI
  const summary = narrative.summary || narrative.readiness_summary || narrative.vulnerability_summary || narrative.resilience_summary || "";
  const subheadline = narrative.headline || "";
  const extra = narrative.risk_assessment || narrative.mitigation_plan || narrative.margin_resilience || narrative.growth_constraints || "";
  const checks = narrative.health_checks || narrative.concentration_risks || narrative.baseline_performance || null;

  return `
    <div style="margin-bottom:28px;background:#fff;border:1px solid ${BRAND.border};border-radius:8px;padding:24px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.primary};margin-bottom:12px;">${title}</div>
      ${subheadline ? `<div style="font-size:16px;font-weight:700;color:${BRAND.dark};margin-bottom:12px;">${subheadline}</div>` : ""}
      <div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:16px;">${summary}</div>
      
      ${extra ? `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid ${BRAND.border};">
          <div style="font-size:11px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;margin-bottom:8px;">Deep Analysis</div>
          <div style="font-size:12px;color:#374151;line-height:1.5;">${extra}</div>
        </div>
      ` : ""}

      ${checks ? `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid ${BRAND.border};">
          <div style="font-size:11px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;margin-bottom:8px;">Specific Factors</div>
          <div style="font-size:12px;color:#374151;">
            ${Array.isArray(checks)
        ? checks.map(c => `· ${c}`).join("<br/>")
        : `· ${checks}`}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function disclaimerSection() {
  return `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid ${BRAND.border};font-size:10px;color:${BRAND.muted};line-height:1.6;">
      <strong>Disclaimer:</strong> This is a decision-support report, not financial advice. All scores and analysis are based on the data you have entered into EnterprateAI. Accuracy depends on the completeness and correctness of that data. Consult a qualified financial adviser before making significant business decisions.
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Report type → section set
// ---------------------------------------------------------------------------

export function buildReportSections(reportType, output, currency) {
  const ex = output?.executiveSummary;
  const sc = output?.scores;
  const ri = output?.risks;
  const re = output?.recommendations;
  const sc2 = output?.scenarios;
  const co = output?.confidence;
  const na = output?.narratives;
  const cl = output?.classifications;

  switch (reportType) {
    case "scenario_report":
      return [
        scenarioSection({ scenarios: sc2, currency }),
        risksSection({ risks: ri, currency }),
        recommendationsSection({ recommendations: re }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");

    case "fragility_report":
      return [
        aiNarrativeSection({ title: "Fragility Analysis", narrative: na?.fragilityAnalysis }),
        executiveSummarySection({ executiveSummary: ex, classifications: cl }),
        risksSection({ risks: ri, currency }),
        recommendationsSection({ recommendations: re }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");

    case "investor_summary":
      return [
        aiNarrativeSection({ title: "Investor Perspective", narrative: na?.investorPerspective }),
        scoreCards({ scores: sc, currency }),
        executiveSummarySection({ executiveSummary: ex, classifications: cl }),
        risksSection({ risks: ri, currency }),
        recommendationsSection({ recommendations: re }),
        nextActionsSection({ executiveSummary: ex }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");

    case "stability_report":
      return [
        aiNarrativeSection({ title: "Stability Outlook", narrative: na?.stabilityOutlook }),
        scoreCards({ scores: sc, currency }),
        executiveSummarySection({ executiveSummary: ex, classifications: cl }),
        risksSection({ risks: ri, currency }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");

    case "business_health_report":
      return [
        aiNarrativeSection({ title: "Health Assessment", narrative: na?.healthAssessment }),
        scoreCards({ scores: sc, currency }),
        executiveSummarySection({ executiveSummary: ex, classifications: cl }),
        risksSection({ risks: ri, currency }),
        recommendationsSection({ recommendations: re }),
        nextActionsSection({ executiveSummary: ex }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");

    default:
      return [
        scoreCards({ scores: sc, currency }),
        executiveSummarySection({ executiveSummary: ex, classifications: cl }),
        risksSection({ risks: ri, currency }),
        recommendationsSection({ recommendations: re }),
        sc2 ? scenarioSection({ scenarios: sc2, currency }) : null,
        nextActionsSection({ executiveSummary: ex }),
        confidenceSection({ confidence: co, narratives: na }),
        disclaimerSection(),
      ].filter(Boolean).join("");
  }
}

// ---------------------------------------------------------------------------
// Full HTML document wrapper
// ---------------------------------------------------------------------------

export function buildFullHtml({ output, reportType, sections, businessName, reportTitle, currency, companyName }) {
  const cover = coverPage({
    businessName: businessName || output?.business?.businessName || "Your Business",
    reportTitle: reportTitle || REPORT_TITLES[reportType] || "Business Intelligence Report",
    reportType,
    generatedAt: output?.meta?.generatedAt,
    companyName: companyName || "EnterprateAI",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${reportTitle || REPORT_TITLES[reportType] || "Report"}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1e293b; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page-break { page-break-after: always; }
}
</style>
</head>
<body>
  <div style="max-width:800px;margin:0 auto;background:#fff;">
    ${cover}
    <div class="page-break"></div>
    <div style="padding:40px;">
      ${sections}
    </div>
  </div>
</body>
</html>`;
}

export const REPORT_TITLES = {
  business_health_report: "Business Health Report",
  viability_report: "Viability Report",
  survival_report: "Survival Report",
  stability_report: "Stability Report",
  growth_report: "Growth Report",
  fragility_report: "Fragility Report",
  scenario_report: "Scenario Analysis Report",
  adaptive_decision_report: "Adaptive Decision Report",
  investor_summary: "Investor Summary",
};
