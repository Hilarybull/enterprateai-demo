/**
 * EnterprateAI PDF Report Generator
 *
 * Uses html2pdf.js (already installed) for browser-side PDF generation.
 * Reports are built from saved EnterprateIntelligenceOutput — no engine recalculation.
 *
 * Usage:
 *   import { generatePdf } from "../lib/reports";
 *   const { blob, fileName } = await generatePdf({ output, reportType: "business_health_report" });
 */

import { buildReportSections, buildFullHtml, REPORT_TITLES } from "./report-templates.js";
import { generateNarrative } from "../narratives/index.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a PDF blob in the browser using html2pdf.js.
 *
 * @param {{
 *   output: object,                      — EnterprateIntelligenceOutput
 *   reportType?: string,                 — one of REPORT_TITLES keys
 *   branding?: { companyName?: string, primaryColor?: string },
 *   onProgress?: (msg: string) => void,
 * }} options
 * @returns {Promise<{ blob: Blob, fileName: string, html: string, sections: Array }>}
 */
export async function generatePdf({ output, reportType = "business_health_report", branding = {}, onProgress } = {}) {
  const notify = onProgress || (() => {});
  const currency = output?.business?.currency || "GBP";
  const businessName = output?.business?.businessName || "Business";

  notify("Building report sections...");

  // Enrich with narratives
  const enrichedOutput = enrichWithNarratives(output, currency);

  // Build HTML sections
  const sections = buildReportSections(reportType, enrichedOutput, currency);
  const reportTitle = REPORT_TITLES[reportType] || "Business Intelligence Report";
  const html = buildFullHtml({
    output: enrichedOutput,
    reportType,
    sections,
    businessName,
    reportTitle,
    currency,
    companyName: branding.companyName || "EnterprateAI",
  });

  notify("Rendering PDF...");

  // Pass the HTML string directly — html2pdf manages its own DOM insertion.
  // Using a DOM element positioned off-screen causes html2canvas to produce a blank canvas.
  const blob = await renderToPdfBlob(html, {
    filename: safeFileName(businessName, reportType),
    margin: [10, 10, 10, 10],
  });

  notify("Done.");

  const fileName = safeFileName(businessName, reportType) + ".pdf";
  return { blob, fileName, html, sections: buildSectionsList(reportType, enrichedOutput) };
}

/**
 * Trigger a download of the generated PDF in the browser.
 */
export function downloadPdf(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Generate and immediately download a PDF.
 */
export async function generateAndDownloadPdf(options) {
  const result = await generatePdf(options);
  downloadPdf(result.blob, result.fileName);
  return result;
}

// ---------------------------------------------------------------------------
// Narrative enrichment
// ---------------------------------------------------------------------------

function enrichWithNarratives(output, currency) {
  if (!output) return output;
  const exec = generateNarrative({ narrativeType: "executive_summary", output, currency });
  const risks = generateNarrative({ narrativeType: "risk_explanation", output, currency });
  const recs = generateNarrative({ narrativeType: "recommendation_summary", output });
  const scenario = output?.scenarios
    ? generateNarrative({ narrativeType: "scenario_explanation", output, currency })
    : null;

  return {
    ...output,
    narratives: {
      executiveNarrative: exec.narrative,
      riskNarrative: risks.narrative,
      recommendationNarrative: recs.narrative,
      scenarioNarrative: scenario?.narrative || null,
      confidenceNarrative: exec.confidenceNote,
    },
  };
}

// ---------------------------------------------------------------------------
// Sections list (for storage / display)
// ---------------------------------------------------------------------------

function buildSectionsList(reportType, output) {
  const base = [
    { sectionKey: "cover", title: "Cover Page", dataSource: "narrative" },
    { sectionKey: "executive_summary", title: "Executive Summary", dataSource: "scores" },
    { sectionKey: "risks", title: "Top Risks", dataSource: "risks" },
    { sectionKey: "recommendations", title: "Recommendations", dataSource: "recommendations" },
    { sectionKey: "confidence", title: "Confidence & Data Quality", dataSource: "narrative" },
    { sectionKey: "disclaimer", title: "Disclaimer", dataSource: "narrative" },
  ];
  if (reportType !== "scenario_report" && output?.scores?.businessIntelligenceScore != null) {
    base.splice(1, 0, { sectionKey: "scores", title: "Intelligence Scores", dataSource: "scores" });
  }
  if (output?.scenarios) {
    base.splice(-2, 0, { sectionKey: "scenarios", title: "Scenario Insights", dataSource: "scenario" });
  }
  return base;
}

// ---------------------------------------------------------------------------
// html2pdf.js renderer
// ---------------------------------------------------------------------------

async function renderToPdfBlob(htmlString, options = {}) {
  let html2pdf;
  try {
    const mod = await import("html2pdf.js");
    html2pdf = mod.default || mod;
  } catch {
    throw new Error("html2pdf.js could not be loaded. Make sure it is installed in dependencies.");
  }

  const opt = {
    margin: options.margin || [10, 10, 10, 10],
    filename: options.filename || "report",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, allowTaint: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };

  // html2pdf accepts an HTML string directly; it handles DOM insertion internally,
  // keeping the temporary element in a position html2canvas can actually render.
  const blob = await html2pdf().set(opt).from(htmlString).outputPdf("blob");
  return blob;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeFileName(businessName, reportType) {
  const name = String(businessName || "business").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 30);
  const type = String(reportType || "report").replace(/_/g, "-");
  const date = new Date().toISOString().slice(0, 10);
  return `${name}-${type}-${date}`;
}

// ---------------------------------------------------------------------------
// Validation Insight PDF
// ---------------------------------------------------------------------------

function buildValidationInsightHtml({ data, title, businessName, type }) {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const name = businessName || "Business";
  const reportTitle = title || (type === "service" ? "Service / Product Insight Report" : "Idea Validation Insight Report");

  const c = {
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

  function card(titleText, body) {
    return `<div style="background:#fff;border:1px solid ${c.border};border-radius:10px;padding:20px 22px;margin-bottom:16px;page-break-inside:avoid;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${c.muted};margin-bottom:12px;">${titleText}</div>
      ${body}
    </div>`;
  }
  function grid2(a, b) {
    return `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">${a}${b}</div>`;
  }
  function cell(label, value) {
    return `<div style="flex:1;min-width:120px;background:${c.light};border-radius:8px;padding:12px 14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${c.muted};margin-bottom:4px;">${label}</div>
      <div style="font-size:13px;font-weight:600;color:${c.dark};">${value || "–"}</div>
    </div>`;
  }
  function pill(text, color = "#e2e8f0", textColor = "#334155") {
    return `<span style="display:inline-block;background:${color};color:${textColor};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;margin:2px 3px 2px 0;">${text}</span>`;
  }
  function list(items) {
    if (!Array.isArray(items) || !items.length) return "";
    return `<ul style="margin:6px 0 0;padding-left:18px;">${items.map((i) => `<li style="font-size:12px;color:#475569;margin-bottom:3px;">${i}</li>`).join("")}</ul>`;
  }
  function kv(label, value) {
    if (!value) return "";
    return `<div style="font-size:12px;color:#475569;margin-bottom:5px;"><span style="font-weight:600;color:${c.dark};">${label}: </span>${value}</div>`;
  }

  const sections = [];

  // Cover
  sections.push(`
    <div style="background:linear-gradient(135deg,${c.primary} 0%,#4f46e5 100%);padding:44px 40px 36px;border-radius:10px 10px 0 0;margin-bottom:0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.65);margin-bottom:24px;">EnterprateAI &nbsp;·&nbsp; Validation Insight Report</div>
      <div style="font-size:28px;font-weight:800;color:#fff;line-height:1.25;margin-bottom:10px;">${reportTitle}</div>
      <div style="font-size:15px;color:rgba(255,255,255,0.85);margin-bottom:24px;">${name}</div>
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:6px;padding:6px 14px;font-size:11px;color:rgba(255,255,255,0.9);">Generated ${date}</div>
    </div>
    <div style="background:#fff;border-left:1px solid ${c.border};border-right:1px solid ${c.border};padding:0;"></div>
  `);

  // Executive Summary
  if (data.executive_summary) {
    sections.push(card("Executive Summary", `<div style="font-size:13px;line-height:1.7;color:#334155;">${data.executive_summary}</div>`));
  }

  // Validation / Viability Result
  if (data.viability_score) {
    const vs = data.viability_score;
    const scoreColor = (vs.label === "Very Strong" || vs.label === "Strong") ? c.green : vs.label === "Weak" ? c.red : c.amber;
    sections.push(card("Viability Score", `
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:12px;">
        <div style="font-size:36px;font-weight:800;color:${scoreColor};">${vs.score ?? "–"}<span style="font-size:16px;font-weight:600;color:${c.muted};">/100</span></div>
        <div>
          <div style="font-size:16px;font-weight:700;color:${c.dark};">${vs.label || ""}</div>
          <div style="font-size:12px;color:${c.muted};margin-top:2px;">${vs.summary || ""}</div>
        </div>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:999px;margin-bottom:12px;">
        <div style="height:6px;background:${scoreColor};border-radius:999px;width:${Math.min(100, vs.score ?? 0)}%;"></div>
      </div>
      <div>
        ${vs.market_demand ? pill(`Demand: ${vs.market_demand}`) : ""}
        ${vs.competition_level ? pill(`Competition: ${vs.competition_level}`) : ""}
        ${vs.pricing_opportunity ? pill(`Pricing: ${vs.pricing_opportunity}`) : ""}
        ${vs.execution_risk ? pill(`Exec risk: ${vs.execution_risk}`) : ""}
      </div>
      ${vs.recommended_action ? `<div style="margin-top:10px;font-size:12px;font-weight:600;color:${c.muted};">Recommended action: ${vs.recommended_action}</div>` : ""}
    `));
  } else if (data.idea_validation_result) {
    const r = data.idea_validation_result;
    sections.push(card("Validation Result", `
      ${grid2(cell("Overall Score", r.overall_score), cell("Recommended Action", r.recommended_action))}
      <div>
        ${r.market_demand ? pill(`Market demand: ${r.market_demand}`) : ""}
        ${r.competition_level ? pill(`Competition: ${r.competition_level}`) : ""}
        ${r.pricing_opportunity ? pill(`Pricing: ${r.pricing_opportunity}`) : ""}
        ${r.execution_risk ? pill(`Execution risk: ${r.execution_risk}`) : ""}
      </div>
    `));
  }

  // Market Opportunity
  if (data.market_opportunity) {
    const mo = data.market_opportunity;
    sections.push(card("Market Opportunity", `
      ${mo.summary ? `<div style="font-size:13px;color:#334155;margin-bottom:12px;">${mo.summary}</div>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        ${cell("Market Size", mo.market_size)}
        ${cell("Growth Rate", mo.growth_rate)}
        ${Array.isArray(mo.key_trends) && mo.key_trends.length ? `<div style="flex:1;min-width:120px;background:${c.light};border-radius:8px;padding:12px 14px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${c.muted};margin-bottom:6px;">Key Trends</div>${list(mo.key_trends)}</div>` : ""}
      </div>
      ${mo.location_opportunity ? `<div style="background:#eef2ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#3730a3;">${mo.location_opportunity}</div>` : ""}
    `));
  }

  // Target Customer + Problem Validation
  const tcBody = data.target_customer ? `
    ${kv("Profile", data.target_customer.profile)}
    ${kv("Willingness to pay", data.target_customer.willingness_to_pay)}
    ${kv("Urgency", data.target_customer.urgency)}
    ${kv("Buying behaviour", data.target_customer.buying_behaviour)}
    ${Array.isArray(data.target_customer.pain_points) ? `<div style="font-size:12px;font-weight:600;color:${c.dark};margin:6px 0 3px;">Pain Points</div>${list(data.target_customer.pain_points)}` : ""}
  ` : null;
  const pvBody = data.problem_validation ? `
    ${data.problem_validation.evidence_strength ? `<div style="display:inline-block;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;margin-bottom:8px;background:#fef3c7;color:#92400e;">Evidence: ${data.problem_validation.evidence_strength}</div>` : ""}
    ${data.problem_validation.frequency_assessment ? `<div style="font-size:12px;color:#475569;margin-bottom:5px;">${data.problem_validation.frequency_assessment}</div>` : ""}
    ${kv("Severity", data.problem_validation.severity)}
    ${list(data.problem_validation.evidence)}
  ` : null;
  if (tcBody || pvBody) {
    sections.push(`<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      ${tcBody ? `<div style="flex:1;min-width:220px;">${card("Target Customer", tcBody)}</div>` : ""}
      ${pvBody ? `<div style="flex:1;min-width:220px;">${card("Problem Validation", pvBody)}</div>` : ""}
    </div>`);
  }

  // Demand Signals
  if (data.demand_signals) {
    const ds = data.demand_signals;
    sections.push(card("Demand Signals", `
      ${ds.search_trend ? pill(`Search: ${ds.search_trend}`) : ""}
      ${list(ds.signals)}
      ${ds.online_discussion ? `<div style="background:${c.light};border-radius:8px;padding:10px 14px;font-size:12px;color:#334155;margin-top:8px;">${ds.online_discussion}</div>` : ""}
    `));
  }

  // Competitor Matrix
  if (Array.isArray(data.competitor_matrix) && data.competitor_matrix.length) {
    const rows = data.competitor_matrix.map((comp) => `
      <tr style="border-bottom:1px solid ${c.border};">
        <td style="padding:8px 10px 8px 0;font-weight:600;font-size:12px;color:${c.dark};vertical-align:top;">${comp.name}</td>
        <td style="padding:8px 10px;font-size:12px;color:#475569;vertical-align:top;">${comp.positioning || "–"}</td>
        <td style="padding:8px 10px;font-size:12px;color:#475569;vertical-align:top;">${Array.isArray(comp.strengths) ? comp.strengths.join(", ") : comp.strengths || "–"}</td>
        <td style="padding:8px 0;font-size:12px;color:#475569;vertical-align:top;">${Array.isArray(comp.weaknesses) ? comp.weaknesses.join(", ") : comp.weaknesses || "–"}</td>
      </tr>
    `).join("");
    sections.push(card("Competitor Matrix", `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid ${c.border};">
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;padding-right:10px;">Competitor</th>
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;padding-right:10px;">Positioning</th>
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;padding-right:10px;">Strengths</th>
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;">Weaknesses</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `));
  }

  // Alternative Solutions
  if (Array.isArray(data.alternative_solutions) && data.alternative_solutions.length) {
    const rows = data.alternative_solutions.map((alt) => `
      <tr style="border-bottom:1px solid ${c.border};">
        <td style="padding:7px 10px 7px 0;font-weight:600;font-size:12px;color:${c.dark};">${alt.name}</td>
        <td style="padding:7px 10px;font-size:12px;color:${c.muted};">${alt.type || "–"}</td>
        <td style="padding:7px 0;font-size:12px;color:#475569;">${alt.weakness || "–"}</td>
      </tr>
    `).join("");
    sections.push(card("Alternative Solutions", `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid ${c.border};">
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;padding-right:10px;">Name</th>
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;padding-right:10px;">Type</th>
          <th style="text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${c.muted};padding-bottom:8px;">Weakness</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `));
  }

  // Pricing Strategy + Price Range
  const psBody = data.pricing_strategy ? `
    ${kv("Recommended model", data.pricing_strategy.recommended_model)}
    ${data.pricing_strategy.rationale ? `<div style="font-size:12px;color:#475569;margin-bottom:5px;">${data.pricing_strategy.rationale}</div>` : ""}
    ${data.pricing_strategy.launch_offer ? `<div style="background:#eef2ff;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:600;color:#3730a3;margin-top:6px;">Launch offer: ${data.pricing_strategy.launch_offer}</div>` : ""}
  ` : null;
  const prBody = data.recommended_price_range ? `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      ${["low", "mid", "premium"].map((k, i) => cell(["Entry", "Mid", "Premium"][i], data.recommended_price_range[k])).join("")}
    </div>
    ${data.recommended_price_range.notes ? `<div style="font-size:11px;color:${c.muted};">${data.recommended_price_range.notes}</div>` : ""}
  ` : null;
  if (psBody || prBody) {
    sections.push(`<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      ${psBody ? `<div style="flex:1;min-width:220px;">${card("Pricing Strategy", psBody)}</div>` : ""}
      ${prBody ? `<div style="flex:1;min-width:220px;">${card("Recommended Price Range", prBody)}</div>` : ""}
    </div>`);
  }

  // Positioning + Go-to-Market
  const posBody = data.positioning ? `
    ${data.positioning.headline_message ? `<div style="background:#eef2ff;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;color:#3730a3;margin-bottom:8px;">"${data.positioning.headline_message}"</div>` : ""}
    ${kv("Value prop", data.positioning.value_proposition)}
    ${kv("Differentiation", data.positioning.differentiation)}
  ` : null;
  const gtmBody = data.go_to_market ? `
    ${Array.isArray(data.go_to_market.primary_channels) ? kv("Primary channels", data.go_to_market.primary_channels.join(", ")) : ""}
    ${data.go_to_market.timeline ? `<div style="background:${c.light};border-radius:8px;padding:8px 12px;font-size:11px;color:#334155;margin-bottom:6px;">${data.go_to_market.timeline}</div>` : ""}
    ${Array.isArray(data.go_to_market.quick_wins) ? `<div style="font-size:12px;font-weight:600;color:${c.dark};margin-bottom:3px;">Quick wins</div>${list(data.go_to_market.quick_wins)}` : ""}
  ` : null;
  if (posBody || gtmBody) {
    sections.push(`<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      ${posBody ? `<div style="flex:1;min-width:220px;">${card("Positioning Recommendation", posBody)}</div>` : ""}
      ${gtmBody ? `<div style="flex:1;min-width:220px;">${card("Go-To-Market Recommendation", gtmBody)}</div>` : ""}
    </div>`);
  }

  // Risks
  if (Array.isArray(data.risks) && data.risks.length) {
    const riskRows = data.risks.map((r) => {
      const sColor = r.severity === "High" ? "#fee2e2" : r.severity === "Medium" ? "#fef3c7" : "#f1f5f9";
      const sTxt = r.severity === "High" ? "#991b1b" : r.severity === "Medium" ? "#92400e" : "#475569";
      return `<div style="border:1px solid ${c.border};border-radius:8px;padding:10px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:600;color:${c.dark};">${r.risk}</span>
          ${r.severity ? `<span style="background:${sColor};color:${sTxt};border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;">${r.severity}</span>` : ""}
        </div>
        ${r.mitigation ? `<div style="font-size:12px;color:#475569;">${r.mitigation}</div>` : ""}
      </div>`;
    }).join("");
    sections.push(card("Risks &amp; Barriers", riskRows));
  }

  // Next Best Actions
  if (Array.isArray(data.next_actions) && data.next_actions.length) {
    const actionRows = data.next_actions.map((a, i) => `
      <div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
        <div style="flex-shrink:0;width:24px;height:24px;background:${c.primary};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">${a.step ?? i + 1}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:${c.dark};">${a.action}</div>
          ${a.why ? `<div style="font-size:12px;color:#475569;margin-top:2px;">${a.why}</div>` : ""}
          ${a.timeframe ? `<div style="display:inline-block;background:${c.light};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;color:${c.muted};margin-top:4px;">${a.timeframe}</div>` : ""}
        </div>
      </div>
    `).join("");
    sections.push(card("Next Best Actions", actionRows));
  }

  // Footer disclaimer
  sections.push(`<div style="margin-top:8px;padding:14px 18px;background:${c.light};border-radius:8px;font-size:10px;color:${c.muted};line-height:1.6;">
    This report was generated by EnterprateAI on ${date} based on the data provided. It is for decision-support purposes only and does not constitute financial or legal advice.
  </div>`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;}
    @media print{body{background:#fff;padding:0;}}
  </style></head><body>
    <div style="max-width:750px;margin:0 auto;">${sections.join("")}</div>
  </body></html>`;
}

export async function generateValidationInsightPdf({ data, title, businessName, type = "business", onProgress } = {}) {
  const notify = onProgress || (() => {});
  notify("Building insight report...");
  const html = buildValidationInsightHtml({ data, title, businessName, type });
  notify("Rendering PDF...");
  const safeName = String(businessName || "insight").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 30);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName}-validation-insight-${date}.pdf`;
  const blob = await renderToPdfBlob(html, { filename: fileName.replace(".pdf", ""), margin: [12, 12, 12, 12] });
  downloadPdf(blob, fileName);
  notify("Done.");
  return { blob, fileName };
}

export { REPORT_TITLES };
