/**
 * EnterprateAI AI Narrative Layer
 *
 * Template-first, deterministic narratives.
 * Uses only the provided EnterprateIntelligenceOutput — never invents scores,
 * risks, percentages, or recommendations.
 *
 * Supported narrative types:
 *   executive_summary | risk_explanation | recommendation_summary |
 *   scenario_explanation | fragility_explanation | pdf_report_section
 */

import { formatCurrency } from "../format.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a narrative from a deterministic intelligence output.
 *
 * @param {{
 *   narrativeType: string,
 *   output: object,
 *   audience?: string,
 *   tone?: string,
 *   currency?: string,
 * }} input
 * @returns {{
 *   narrativeType: string,
 *   headline: string,
 *   narrative: string,
 *   keyPoints: string[],
 *   actionSummary: string[],
 *   confidenceNote: string,
 *   validation: { status: string, issues: string[] },
 *   trace: { promptVersion: string, generatedAt: string },
 * }}
 */
export function generateNarrative(input) {
  const { narrativeType, output, currency = "GBP" } = input;

  let result;
  switch (narrativeType) {
    case "executive_summary":
      result = generateExecutiveSummary(output, currency);
      break;
    case "risk_explanation":
      result = generateRiskExplanation(output, currency);
      break;
    case "recommendation_summary":
      result = generateRecommendationSummary(output);
      break;
    case "scenario_explanation":
      result = generateScenarioExplanation(output, currency);
      break;
    case "fragility_explanation":
      result = generateFragilityExplanation(output);
      break;
    case "pdf_report_section":
      result = generatePdfReportSection(output, currency);
      break;
    default:
      result = generateExecutiveSummary(output, currency);
  }

  const validation = validateNarrative(result, output);
  return {
    ...result,
    narrativeType,
    validation,
    trace: {
      promptVersion: "template_v1.0",
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Narrative generators (one per type)
// ---------------------------------------------------------------------------

function generateExecutiveSummary(output, currency) {
  const ex = output?.executiveSummary || {};
  const scores = output?.scores || {};
  const confidence = output?.confidence || {};
  const bi = scores.businessIntelligenceScore;

  const headline = ex.headline || "Assessment complete.";

  const narrative = [
    ex.summary || "",
    ex.keyStrength ? `Strongest area: ${ex.keyStrength}.` : null,
    ex.keyWeakness ? `Main concern: ${ex.keyWeakness}.` : null,
    ex.strategicPriority ? `Priority: ${ex.strategicPriority}` : null,
    confidence.overallLevel === "LOW"
      ? "Note: confidence is limited due to incomplete data. Add more financial records to improve accuracy."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const keyPoints = [
    bi != null ? `Business intelligence score: ${bi}/100.` : null,
    scores.viabilityScore != null ? `Viability score: ${scores.viabilityScore}/100.` : null,
    scores.survivalScore != null ? `Survival score: ${scores.survivalScore}/100.` : null,
    scores.stabilityScore != null ? `Stability score: ${scores.stabilityScore}/100.` : null,
    scores.fragilityIndex != null ? `Fragility index: ${scores.fragilityIndex}/100.` : null,
    output?.classifications?.label ? `Classification: ${output.classifications.label}.` : null,
  ].filter(Boolean);

  return {
    headline,
    narrative,
    keyPoints,
    actionSummary: ex.nextBestActions || [],
    confidenceNote: buildConfidenceNote(confidence),
  };
}

function generateRiskExplanation(output, currency) {
  const risks = output?.risks || {};
  const topRisks = risks.topRisks || [];

  if (!topRisks.length) {
    return {
      headline: "No significant risks detected.",
      narrative: "Based on current data, no major risk signals have been identified. Continue monitoring as conditions change.",
      keyPoints: [],
      actionSummary: ["Keep financial records up to date to maintain accurate risk detection."],
      confidenceNote: buildConfidenceNote(output?.confidence),
    };
  }

  const critical = topRisks.filter((r) => r.severity === "CRITICAL");
  const high = topRisks.filter((r) => r.severity === "HIGH");

  const headline =
    critical.length
      ? `${critical.length} critical risk${critical.length > 1 ? "s" : ""} detected.`
      : high.length
        ? `${high.length} high-severity risk${high.length > 1 ? "s" : ""} detected.`
        : `${topRisks.length} risk signal${topRisks.length > 1 ? "s" : ""} detected.`;

  const narrative =
    (critical.length ? `The most urgent issue is ${critical[0].explanation.toLowerCase()} ` : "") +
    (high.length && !critical.length ? `The main concern is ${high[0].explanation.toLowerCase()} ` : "") +
    "Addressing these risks before scaling will protect the business from compounding pressure.";

  const keyPoints = topRisks
    .slice(0, 4)
    .map((r) => `[${r.severity}] ${r.explanation}`);

  const actionSummary = topRisks
    .slice(0, 3)
    .map((r) => r.recommendedAction)
    .filter(Boolean);

  return {
    headline,
    narrative,
    keyPoints,
    actionSummary,
    confidenceNote: buildConfidenceNote(output?.confidence),
  };
}

function generateRecommendationSummary(output) {
  const recs = output?.recommendations?.topRecommendations || [];

  if (!recs.length) {
    return {
      headline: "No active recommendations.",
      narrative: "The current data does not generate specific recommendations. Run a simulation or add more data to unlock targeted advice.",
      keyPoints: [],
      actionSummary: [],
      confidenceNote: buildConfidenceNote(output?.confidence),
    };
  }

  const critical = recs.filter((r) => r.priority === "CRITICAL" || r.priority === "HIGH");
  const headline =
    critical.length
      ? `${critical.length} high-priority action${critical.length > 1 ? "s" : ""} recommended.`
      : `${recs.length} recommendation${recs.length > 1 ? "s" : ""} available.`;

  const narrative =
    (critical[0] ? `The immediate priority is: ${critical[0].text.toLowerCase()} ` : "") +
    "These actions are based on current business data and risk signals. Implement in order of priority to have the greatest impact on stability and growth.";

  const keyPoints = recs.slice(0, 4).map((r) => `[${r.priority}] ${r.text}`);
  const actionSummary = recs.slice(0, 3).map((r) => r.text);

  return {
    headline,
    narrative,
    keyPoints,
    actionSummary,
    confidenceNote: buildConfidenceNote(output?.confidence),
  };
}

function generateScenarioExplanation(output, currency) {
  const scenario = output?.scenarios;
  if (!scenario) {
    return {
      headline: "No scenario data available.",
      narrative: "Run a scenario simulation to generate a detailed explanation of the projected impact.",
      keyPoints: [],
      actionSummary: ["Go to Simulation to run a scenario."],
      confidenceNote: "",
    };
  }

  const stab = scenario.deltas?.stabilityDelta;
  const stabText =
    stab == null
      ? ""
      : stab > 0
        ? `stability improves by ${stab.toFixed(1)} points`
        : stab < 0
          ? `stability decreases by ${Math.abs(stab).toFixed(1)} points`
          : "stability is broadly unchanged";

  const timeline = scenario.timelineSummary;
  const cashEnd = timeline?.endCashBalance;
  const profitEnd = timeline?.endProfit;

  const headline =
    stab == null
      ? `Scenario: ${scenario.scenarioName || "simulation"}`
      : stab >= 3
        ? `Scenario improves stability — ${stabText}.`
        : stab <= -3
          ? `Scenario reduces stability — ${stabText}.`
          : `Scenario has a neutral impact on stability.`;

  const narrative = [
    `This scenario (${scenario.scenarioName || scenario.scenarioType || "simulation"}) projects the effect of the selected change on the business.`,
    stabText ? `Compared with the baseline, ${stabText}.` : null,
    cashEnd != null
      ? `Projected cash balance at end of the timeline: ${formatCurrency(cashEnd, currency)}.`
      : null,
    profitEnd != null && profitEnd < 0
      ? "The scenario produces a projected loss at the end of the timeline. Review costs or revenue inputs."
      : null,
    "Use this to inform your decision — Accept, Reject, or Defer in the Simulation module.",
  ]
    .filter(Boolean)
    .join(" ");

  const keyPoints = [
    scenario.scenarioType ? `Scenario type: ${scenario.scenarioType.replace(/_/g, " ")}.` : null,
    stabText ? `Stability impact: ${stabText}.` : null,
    cashEnd != null ? `End cash balance: ${formatCurrency(cashEnd, currency)}.` : null,
    profitEnd != null ? `End profit: ${formatCurrency(profitEnd, currency)}.` : null,
  ].filter(Boolean);

  const actions = scenario.decisionPath?.recommendedActions || [];

  return {
    headline,
    narrative,
    keyPoints,
    actionSummary: actions.length ? actions : ["Review the timeline and decide whether to accept, reject, or defer."],
    confidenceNote: buildConfidenceNote(output?.confidence),
  };
}

function generateFragilityExplanation(output) {
  const fragility = output?.scores?.fragilityIndex;
  const classification = output?.classifications?.fragility;
  const topRisks = (output?.risks?.topRisks || []).filter((r) =>
    ["CLIENT_CONCENTRATION_HIGH", "CAPACITY_OVERLOAD"].includes(r.code)
  );

  if (fragility == null) {
    return {
      headline: "Fragility data not available.",
      narrative: "Add client and revenue data to generate a fragility assessment.",
      keyPoints: [],
      actionSummary: [],
      confidenceNote: buildConfidenceNote(output?.confidence),
    };
  }

  const headline =
    fragility >= 70
      ? "The business has critical structural vulnerabilities."
      : fragility >= 50
        ? "The business has significant fragility factors."
        : "The business shows some structural exposure.";

  const narrative = [
    classification ? `Fragility classification: ${classification.replace(/_/g, " ")}.` : null,
    "Fragility reflects how vulnerable the business is to a single shock — such as losing a key client, a team member leaving, or a cost spike.",
    topRisks[0] ? `The main fragility driver is: ${topRisks[0].explanation.toLowerCase()}` : null,
    fragility >= 70
      ? "This level of fragility means a single adverse event could cause significant disruption."
      : fragility >= 50
        ? "Consider building redundancy in client base, team, and cash position."
        : null,
  ]
    .filter(Boolean)
    .join(" ");

  const keyPoints = [
    `Fragility index: ${fragility}/100.`,
    classification ? `Classification: ${classification.replace(/_/g, " ")}.` : null,
    ...topRisks.slice(0, 2).map((r) => r.explanation),
  ].filter(Boolean);

  return {
    headline,
    narrative,
    keyPoints,
    actionSummary: topRisks.map((r) => r.recommendedAction).filter(Boolean).slice(0, 2),
    confidenceNote: buildConfidenceNote(output?.confidence),
  };
}

function generatePdfReportSection(output, currency) {
  const exec = generateExecutiveSummary(output, currency);
  const risks = generateRiskExplanation(output, currency);
  const recs = generateRecommendationSummary(output);

  return {
    headline: exec.headline,
    narrative: [
      "EXECUTIVE SUMMARY",
      exec.narrative,
      "",
      "KEY RISKS",
      risks.narrative,
      "",
      "RECOMMENDATIONS",
      recs.narrative,
    ].join("\n"),
    keyPoints: [...exec.keyPoints, ...risks.keyPoints.slice(0, 2)],
    actionSummary: recs.actionSummary,
    confidenceNote: exec.confidenceNote,
  };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function validateNarrative(narrative, output) {
  const issues = [];
  const scores = output?.scores || {};
  const confidence = output?.confidence || {};

  if (confidence.overallLevel === "LOW" && !narrative.confidenceNote.includes("confidence")) {
    issues.push("Low confidence output must include a confidence note.");
  }

  if (narrative.keyPoints.some((p) => /\d{2,}\/100/.test(p))) {
    const mentionedScores = (narrative.keyPoints.join(" ").match(/(\d+)\/100/g) || []).map((s) => parseInt(s));
    const knownScores = Object.values(scores).filter((v) => v != null && typeof v === "number");
    for (const ms of mentionedScores) {
      if (!knownScores.some((ks) => Math.abs(ks - ms) < 1)) {
        issues.push(`Score ${ms}/100 mentioned in narrative but not found in output.scores.`);
      }
    }
  }

  return {
    status: issues.length ? "failed" : "passed",
    issues,
  };
}

function buildConfidenceNote(confidence) {
  if (!confidence) return "";
  if (confidence.overallLevel === "LOW") {
    return "Limited data available. These insights are estimates and should be treated with caution.";
  }
  if (confidence.overallLevel === "MEDIUM") {
    return "Based on available data. Accuracy improves with more complete financial records.";
  }
  return "Based on complete data. High confidence in these insights.";
}
