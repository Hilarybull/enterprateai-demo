/**
 * EnterprateAI Standard Intelligence Output Contract
 *
 * Single unified JSON shape consumed by:
 *  - frontend dashboard
 *  - AI narrative layer
 *  - PDF report generator
 *  - database persistence
 *
 * Rule: This contract only formats saved deterministic outputs.
 * It never recalculates scores or calls any engine.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId() {
  return `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Empty / default builders
// ---------------------------------------------------------------------------

/**
 * @returns {import('./types').EnterprateIntelligenceOutput}
 */
export function emptyOutput(overrides = {}) {
  return {
    meta: {
      outputId: makeId(),
      businessId: "",
      generatedAt: new Date().toISOString(),
      outputType: "assessment",
      rulesetVersion: "v1.0",
      engineVersion: "v1.0",
      source: "manual",
    },
    business: {
      businessName: null,
      sector: null,
      businessStage: null,
      countryCode: "GB",
      currency: "GBP",
    },
    executiveSummary: {
      headline: "Assessment complete.",
      summary: "",
      currentBusinessState: "Unknown",
      keyStrength: "—",
      keyWeakness: "—",
      strategicPriority: "—",
      nextBestActions: [],
    },
    scores: {
      viabilityScore: null,
      survivalScore: null,
      stabilityScore: null,
      growthScore: null,
      businessIntelligenceScore: null,
      fragilityIndex: null,
      scoreTrend: null,
    },
    classifications: {
      primary: null,
      structural: null,
      fragility: null,
      label: "—",
    },
    engineResults: {},
    fragility: null,
    risks: {
      totalRisks: 0,
      criticalRisks: 0,
      highRisks: 0,
      topRisks: [],
      groupedRisks: [],
    },
    recommendations: {
      totalRecommendations: 0,
      topRecommendations: [],
      groupedRecommendations: [],
    },
    scenarios: null,
    adaptiveIntelligence: null,
    narratives: null,
    reportData: null,
    confidence: {
      overallLevel: "LOW",
      overallScore: 0,
      engineConfidence: {},
      dataQualityNotes: [],
    },
    trace: {
      orchestrationSequence: [],
      engineVersions: {},
      rulesetVersion: "v1.0",
      generatedBy: "orchestrator",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Assembler — builds EnterprateIntelligenceOutput from existing app data
//
// Call this with data already loaded from the API; never pass raw API clients.
// ---------------------------------------------------------------------------

/**
 * Assemble a standard intelligence output from the data slices available
 * in the EnterprateAI frontend (workspace store + validation + scenario runs).
 *
 * @param {{
 *   workspaceId: string,
 *   businessName?: string,
 *   currency?: string,
 *   inputs?: object,
 *   ideaValidation?: object,
 *   serviceValidation?: object,
 *   financialInsights?: object,
 *   riskSignals?: Array,
 *   recommendations?: Array,
 *   scenarioRun?: object,
 *   scenarioTimeline?: Array,
 * }} data
 * @returns {import('./types').EnterprateIntelligenceOutput}
 */
export function assembleOutput(data = {}) {
  const {
    workspaceId,
    businessName,
    currency = "GBP",
    inputs = {},
    ideaValidation,
    financialInsights = {},
    riskSignals = [],
    recommendations = [],
    scenarioRun,
    scenarioTimeline = [],
  } = data;

  const snap = financialInsights?.stateSnapshot || {};
  const viability = ideaValidation?.result || ideaValidation || null;
  const viabilityScore = viability?.overall_score ?? viability?.score ?? null;

  // Derive stability from financial insights
  const revenue = Number(snap.revenue_monthly || inputs?.revenue_monthly || 0);
  const costs = Number(snap.costs_monthly || inputs?.costs_monthly || 0);
  const profit = revenue - costs;
  const startingCash = Number(snap.starting_cash || inputs?.starting_cash || 0);
  const runwayMonths = costs > revenue && costs > 0 ? startingCash / Math.abs(profit) : null;
  const stabilityScore = deriveStabilityScore(snap);
  const survivalScore = deriveSurvivalScore({ revenue, costs, startingCash, runwayMonths });
  const bi = deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore });

  // Risk signals → standard risk flags
  const topRisks = riskSignals.map((r) => signalToRiskFlag(r));
  const criticalRisks = topRisks.filter((r) => r.severity === "CRITICAL").length;
  const highRisks = topRisks.filter((r) => r.severity === "HIGH").length;

  // Recommendations → standard format
  const topRecs = recommendations.map((rec) => ({
    id: rec.recommendation_id || rec.scenario_template_id || null,
    type: rec.action_type || rec.scenario_type || "general",
    category: deriveRecCategory(rec),
    priority: rec.priority_text || "MEDIUM",
    text: rec.title || rec.recommendation_text || "Review this area.",
    reason: rec.description || rec.subtitle || humanizeTriggerReason(rec.trigger_reason) || "",
    expectedImpact: rec.expected_impact || null,
    sourceEngines: rec.source_engines || ["stability"],
  }));

  // Scenario block
  const scenarioBlock = scenarioRun ? buildScenarioBlock(scenarioRun, scenarioTimeline) : null;

  // Confidence
  const hasRevenue = revenue > 0;
  const hasValidation = Boolean(viabilityScore);
  const confidenceLevel = hasRevenue && hasValidation ? "MEDIUM" : hasRevenue ? "LOW" : "LOW";
  const confidenceNotes = [];
  if (!hasRevenue) confidenceNotes.push("No revenue data recorded. Scores are estimates only.");
  if (!hasValidation) confidenceNotes.push("No idea validation completed.");
  if (runwayMonths !== null && runwayMonths < 3)
    confidenceNotes.push("Runway is critically short. Scores may shift rapidly.");

  const primary = classifyPrimary(bi, survivalScore);
  const structural = classifyStructural({ viabilityScore, stabilityScore, survivalScore, snap });

  return emptyOutput({
    meta: {
      outputId: makeId(),
      businessId: workspaceId || "",
      generatedAt: new Date().toISOString(),
      outputType: "assessment",
      rulesetVersion: "v1.0",
      engineVersion: "v1.0",
      source: "manual",
    },
    business: {
      businessName: businessName || null,
      currency,
      countryCode: "GB",
    },
    executiveSummary: buildExecutiveSummary({
      viabilityScore,
      stabilityScore,
      survivalScore,
      topRisks,
      topRecs,
      snap,
    }),
    scores: {
      viabilityScore,
      survivalScore,
      stabilityScore,
      growthScore: null,
      businessIntelligenceScore: bi,
      fragilityIndex: snap.top_client_share_pct != null ? Math.min(100, snap.top_client_share_pct + 20) : null,
      scoreTrend: null,
    },
    classifications: {
      primary,
      structural,
      fragility: classifyFragility(snap),
      label: primary ? primary.replace(/_/g, " ") : "—",
    },
    engineResults: {
      stability: {
        engine: "stability",
        score: stabilityScore,
        classification: stabilityScore >= 70 ? "STABLE" : stabilityScore >= 55 ? "TIGHT" : "AT_RISK",
        headline: stabilityScore >= 70 ? "Business is stable." : stabilityScore >= 55 ? "Some stability concerns." : "Stability risk detected.",
        keyMetrics: [
          { name: "Monthly revenue", value: revenue, unit: currency },
          { name: "Monthly costs", value: costs, unit: currency },
          { name: "Monthly profit", value: profit, unit: currency },
          { name: "Starting cash", value: startingCash, unit: currency },
          ...(runwayMonths !== null ? [{ name: "Cash runway", value: Math.round(runwayMonths * 10) / 10, unit: "months" }] : []),
        ],
        riskFlags: topRisks,
        recommendations: topRecs,
        confidence: { level: confidenceLevel, note: confidenceNotes[0] || "" },
      },
      ...(viabilityScore != null
        ? {
            viability: {
              engine: "viability",
              score: viabilityScore,
              classification: viabilityScore >= 70 ? "VIABLE" : viabilityScore >= 45 ? "MARGINAL" : "WEAK",
              headline: viability?.headline || `Viability score: ${viabilityScore}/100.`,
              summary: viability?.summary || "",
              keyMetrics: [],
              riskFlags: [],
              recommendations: [],
              confidence: { level: confidenceLevel, note: "" },
            },
          }
        : {}),
    },
    risks: {
      totalRisks: topRisks.length,
      criticalRisks,
      highRisks,
      topRisks,
      groupedRisks: [],
    },
    recommendations: {
      totalRecommendations: topRecs.length,
      topRecommendations: topRecs,
      groupedRecommendations: [],
    },
    scenarios: scenarioBlock,
    confidence: {
      overallLevel: confidenceLevel,
      overallScore: confidenceLevel === "HIGH" ? 80 : confidenceLevel === "MEDIUM" ? 60 : 35,
      engineConfidence: {
        stability: confidenceLevel,
        viability: hasValidation ? "MEDIUM" : "LOW",
      },
      dataQualityNotes: confidenceNotes,
    },
    trace: {
      orchestrationSequence: ["stability", ...(viabilityScore != null ? ["viability"] : [])],
      engineVersions: { stability: "1.0.0", viability: "1.0.0" },
      rulesetVersion: "v1.0",
      generatedBy: "orchestrator",
    },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function deriveStabilityScore(snap) {
  const revenue = Number(snap.revenue_monthly || 0);
  const costs = Number(snap.costs_monthly || 0);
  const net = revenue - costs;
  const cash = Number(snap.starting_cash || 0);
  const runway = costs > revenue && costs > 0 ? cash / Math.abs(net) : 999;
  let score = 70;
  if (net < 0) score -= 18;
  if (runway < 3) score -= 12;
  if (snap.top_client_share_pct != null && snap.top_client_share_pct > 40) score -= 8;
  if (snap.capacity_utilisation_pct != null && snap.capacity_utilisation_pct > 85) score -= 6;
  return Math.max(0, Math.min(100, score));
}

function deriveSurvivalScore({ revenue, costs, startingCash, runwayMonths }) {
  let score = 60;
  if (revenue > 0) score += 10;
  if (revenue > costs) score += 10;
  if (runwayMonths === null || runwayMonths > 6) score += 10;
  else if (runwayMonths < 2) score -= 20;
  else if (runwayMonths < 3) score -= 10;
  if (startingCash > 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

function deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore }) {
  const scores = [viabilityScore, stabilityScore, survivalScore].filter((s) => s != null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function classifyPrimary(bi, survivalScore) {
  if (bi == null) return null;
  if (bi >= 75) return "HIGH_PERFORMING";
  if (bi >= 60) return "STRONG_BUT_NEEDS_OPTIMISATION";
  if (survivalScore != null && survivalScore < 40) return "CRITICAL";
  return "AT_RISK";
}

function classifyStructural({ viabilityScore, stabilityScore, survivalScore, snap }) {
  const v = viabilityScore;
  const st = stabilityScore;
  const su = survivalScore;
  const conc = snap?.top_client_share_pct;
  if (su != null && su < 40) return "VIABLE_BUT_CASH_CRITICAL";
  if (v != null && v >= 65 && conc != null && conc > 50) return "PROFITABLE_BUT_FRAGILE";
  if (st != null && st >= 70) return "BALANCED_BUSINESS";
  return "WEAK_FOUNDATION";
}

function classifyFragility(snap) {
  const conc = snap?.top_client_share_pct;
  if (conc == null) return null;
  if (conc >= 70) return "CRITICAL_FRAGILITY";
  if (conc >= 50) return "HIGHLY_FRAGILE";
  if (conc >= 40) return "FRAGILE";
  return "STABLE_WITH_EXPOSURE";
}

function signalToRiskFlag(signal) {
  const codeMap = {
    CLIENT_CONCENTRATION_HIGH: "HIGH",
    CAPACITY_OVERLOAD: "HIGH",
    NEGATIVE_MARGIN: "CRITICAL",
    LOW_RUNWAY: "CRITICAL",
    OVERDUE_RECEIVABLES: "HIGH",
    RECEIVABLES_APPROACHING_DUE: "MEDIUM",
    PAYABLE_PRESSURE: "MEDIUM",
    PAYABLES_APPROACHING_DUE: "LOW",
  };
  const severity = codeMap[signal.reason_code] || signal.severity?.toUpperCase() || "MEDIUM";
  return {
    code: signal.reason_code || signal.risk_type || "RISK",
    severity,
    sourceEngines: ["stability"],
    explanation: describeSignal(signal),
    recommendedAction: recommendForSignal(signal),
    priorityScore: severity === "CRITICAL" ? 95 : severity === "HIGH" ? 80 : severity === "MEDIUM" ? 60 : 30,
    confidence: "MEDIUM",
  };
}

function describeSignal(signal) {
  // Prefer the pre-formatted detail string (built by buildFinancialIntelligence)
  if (signal.detail && !String(signal.detail).match(/^[A-Z_\s]+RISK$|^[A-Z_\s]+DEMAND/)) {
    return signal.detail;
  }
  const code = signal.reason_code;
  const v = signal.metric_value;
  if (code === "CLIENT_CONCENTRATION_HIGH") return v != null ? `Largest client contributes about ${v}% of revenue.` : "Client concentration is high.";
  if (code === "NEGATIVE_MARGIN") return "Monthly costs exceed monthly revenue.";
  if (code === "LOW_RUNWAY") return v != null ? `Cash runway is about ${v} months.` : "Cash runway is critically low.";
  if (code === "OVERDUE_RECEIVABLES") return v != null ? `${v} receivable(s) are outside payment terms.` : "Some receivables are overdue.";
  if (code === "RECEIVABLES_APPROACHING_DUE") return "Receivables are nearing their due date.";
  if (code === "PAYABLE_PRESSURE") return "Payables are overdue.";
  if (code === "CAPACITY_OVERLOAD") return v != null ? `Capacity utilisation is around ${v}%.` : "Capacity utilisation is high.";
  if (code === "NO_ACTIVE_REVENUE") return "No active revenue flow — no paid invoices or contracts recorded yet.";
  if (code === "NO_PRODUCTS") return "No products or services saved in the catalogue.";
  if (String(code).startsWith("VALIDATION_")) return signal.title || "A validation risk flag was raised.";
  // Generic fallback — avoid raw flag names like "UNPROVEN DEMAND RISK"
  return signal.title || "A risk was detected in this area.";
}

function recommendForSignal(signal) {
  const code = signal.reason_code;
  if (code === "CLIENT_CONCENTRATION_HIGH") return "Diversify the client base to reduce dependency.";
  if (code === "NEGATIVE_MARGIN") return "Review pricing or reduce costs to restore margin.";
  if (code === "LOW_RUNWAY") return "Prioritise cash inflows and reduce non-essential costs.";
  if (code === "OVERDUE_RECEIVABLES") return "Chase outstanding payments and review credit terms.";
  if (code === "RECEIVABLES_APPROACHING_DUE") return "Follow up on pending invoices before they become overdue.";
  if (code === "PAYABLE_PRESSURE") return "Negotiate extended payment terms with suppliers.";
  if (code === "CAPACITY_OVERLOAD") return "Review team capacity and consider resourcing options.";
  return "Review this area and take corrective action.";
}

function humanizeTriggerReason(code) {
  if (!code) return null;
  const map = {
    CLIENT_CONCENTRATION_HIGH: "High dependency on a single client increases revenue vulnerability.",
    NEGATIVE_MARGIN: "Monthly costs exceed monthly revenue, creating a cash deficit.",
    LOW_RUNWAY: "Cash runway is critically short and needs immediate attention.",
    OVERDUE_RECEIVABLES: "Receivables are outside payment terms and affecting cash flow.",
    RECEIVABLES_APPROACHING_DUE: "Receivables are nearing their due date.",
    PAYABLE_PRESSURE: "Payables are overdue and creating cost pressure.",
    PAYABLES_APPROACHING_DUE: "Payables are approaching their due date.",
    CAPACITY_OVERLOAD: "Capacity utilisation is dangerously high.",
    NO_ACTIVE_REVENUE: "No active revenue has been recorded yet.",
    NO_PRODUCTS: "No products or services are saved in the catalogue.",
  };
  return map[code] || null;
}

function deriveRecCategory(rec) {
  const type = (rec.action_type || rec.scenario_type || "").toLowerCase();
  if (type.includes("payment") || type.includes("receivable")) return "survival";
  if (type.includes("price") || type.includes("revenue")) return "profitability";
  if (type.includes("hire") || type.includes("staff")) return "growth";
  if (type.includes("cost")) return "risk_reduction";
  return "stability";
}

function buildExecutiveSummary({ viabilityScore, stabilityScore, survivalScore, topRisks, topRecs, snap }) {
  const bi = deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore });
  const scores = [viabilityScore, stabilityScore, survivalScore].filter((s) => s != null);
  const maxScore = scores.length ? Math.max(...scores) : null;
  const minScore = scores.length ? Math.min(...scores) : null;
  const scoreNames = { [viabilityScore]: "viability", [stabilityScore]: "stability", [survivalScore]: "survival" };

  const headline =
    bi == null
      ? "Assessment complete. Add more data to improve accuracy."
      : bi >= 70
        ? "The business is in a strong position with manageable risks."
        : bi >= 50
          ? "The business shows potential but has areas needing attention."
          : "The business faces material risks that need to be addressed.";

  const strength = maxScore != null ? `${scoreNames[maxScore] || "—"} (${maxScore}/100)` : "—";
  const weakness = minScore != null ? `${scoreNames[minScore] || "—"} (${minScore}/100)` : "—";

  const priority =
    topRisks.find((r) => r.severity === "CRITICAL")?.recommendedAction ||
    topRisks.find((r) => r.severity === "HIGH")?.recommendedAction ||
    (topRecs[0]?.text || "Review all high-priority risk areas.");

  const nextActions = topRecs.slice(0, 3).map((r) => r.text);
  if (!nextActions.length) nextActions.push("Run a simulation to explore scenario outcomes.");

  return {
    headline,
    summary:
      bi == null
        ? "Add revenue and cost data to generate a full assessment."
        : `Overall business intelligence score: ${bi}/100. ${headline}`,
    currentBusinessState:
      bi == null ? "Unknown" : bi >= 70 ? "Stable and growing" : bi >= 50 ? "Active with risks" : "At risk",
    keyStrength: strength,
    keyWeakness: weakness,
    strategicPriority: priority,
    nextBestActions: nextActions,
  };
}

function buildScenarioBlock(scenarioRun, timeline) {
  const base = scenarioRun.baseline_metrics || {};
  const sim = scenarioRun.scenario_metrics || {};
  const deltas = scenarioRun.deltas || {};
  const lastRow = timeline.length ? timeline[timeline.length - 1] : null;
  return {
    scenarioId: scenarioRun.scenario_run_id,
    scenarioName: scenarioRun.scenario_name,
    scenarioType: scenarioRun.scenario_type,
    baseScores: {
      stability: base.stability_score ?? null,
      viability: null,
      survival: null,
      growth: null,
      businessIntelligence: null,
      fragilityIndex: null,
    },
    simulatedScores: {
      stability: sim.stability_score ?? null,
      viability: null,
      survival: null,
      growth: null,
      businessIntelligence: null,
      fragilityIndex: null,
    },
    deltas: {
      stabilityDelta: deltas.stability_score ?? null,
      viabilityDelta: null,
      survivalDelta: null,
      growthDelta: null,
      businessIntelligenceDelta: null,
      fragilityDelta: null,
    },
    riskChanges: [],
    recommendationChanges: [],
    decisionPath: scenarioRun.state_result
      ? {
          rankingScore: null,
          reason: scenarioRun.state_result,
          recommendedActions: (scenarioRun.recommendations || []).map((r) => r.title).filter(Boolean),
        }
      : null,
    timelineSummary: lastRow
      ? {
          endRevenue: lastRow.revenue,
          endCosts: lastRow.costs,
          endProfit: lastRow.profit,
          endCashBalance: lastRow.cash_balance,
        }
      : null,
  };
}
