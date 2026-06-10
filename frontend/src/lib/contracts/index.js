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
    multiEngineOutput = null,  // optional: output from run_full_engine_suite
  } = data;

  const snap = financialInsights?.stateSnapshot || {};
  const viability = ideaValidation?.result || ideaValidation || null;
  const viabilityScore =
    multiEngineOutput?.viability?.score ??
    multiEngineOutput?.viability?.viability_score ??
    viability?.overall_score ??
    viability?.score ??
    null;

  // Derive stability from financial insights
  const revenue = Number(snap.revenue_monthly || inputs?.revenue_monthly || 0);
  const costs = Number(snap.costs_monthly || inputs?.costs_monthly || 0);
  const profit = revenue - costs;
  const startingCash = Number(snap.starting_cash || inputs?.starting_cash || 0);
  const runwayMonths = costs > revenue && costs > 0 ? startingCash / Math.abs(profit) : null;

  // Prefer engine scores when multi-engine output is available
  const stabilityScore =
    multiEngineOutput?.stability?.scores?.stability_score ??
    multiEngineOutput?.master?.engine_summary?.stability?.score ??
    deriveStabilityScore(snap);
  const survivalScore =
    multiEngineOutput?.survival?.scores?.survival_score ??
    multiEngineOutput?.master?.engine_summary?.survival?.score ??
    deriveSurvivalScore({ revenue, costs, startingCash, runwayMonths });
  const growthScore =
    multiEngineOutput?.growth?.scores?.growth_score ??
    multiEngineOutput?.master?.engine_summary?.growth?.score ??
    null;
  const fragilityIndex =
    multiEngineOutput?.fragility?.scores?.fragility_index ??
    multiEngineOutput?.master?.fragility_index ??
    deriveFragilityIndex(snap);

  const bi =
    multiEngineOutput?.master?.bi_score ??
    deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore, growthScore });

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
  const hasMultiEngine = Boolean(multiEngineOutput);
  const confidenceLevel = hasMultiEngine ? "MEDIUM" : hasRevenue && hasValidation ? "MEDIUM" : hasRevenue ? "LOW" : "LOW";
  const confidenceNotes = [];
  if (!hasRevenue) confidenceNotes.push("No revenue data recorded. Scores are estimates only.");
  if (!hasValidation) confidenceNotes.push("No idea validation completed.");
  if (runwayMonths !== null && runwayMonths < 3)
    confidenceNotes.push("Runway is critically short. Scores may shift rapidly.");

  // Classifications — prefer master aggregator output when available
  const masterOutput = multiEngineOutput?.master || null;
  const structuralFromEngine = masterOutput?.structural_classification?.label || null;
  const fragilityClassFromEngine = multiEngineOutput?.fragility?.classification || null;
  const primary = classifyPrimary(bi, survivalScore, fragilityIndex);
  const structural = structuralFromEngine || classifyStructural({ viabilityScore, stabilityScore, survivalScore, growthScore, fragilityIndex });
  const fragilityClass = fragilityClassFromEngine || classifyFragility(snap);

  // Fragility block — populated from engine output when available
  const fragilityDimensions = multiEngineOutput?.fragility?.dimensions || null;
  const fragilityBlock = fragilityDimensions ? {
    index: fragilityIndex ?? 0,
    classification: fragilityClass,
    dimensions: {
      cashFragility: fragilityDimensions.cash ?? null,
      revenueFragility: fragilityDimensions.revenue ?? null,
      customerFragility: fragilityDimensions.customer ?? null,
      operationalFragility: fragilityDimensions.operational ?? null,
      capacityFragility: fragilityDimensions.capacity ?? null,
      marketFragility: fragilityDimensions.market ?? null,
    },
    topFragilityFactors: multiEngineOutput?.fragility?.risk_flags?.slice(0, 3).map((f) => ({
      factorCode: f.code || f.flag || "UNKNOWN",
      dimension: "operational",
      severity: f.severity || "MEDIUM",
      explanation: f.description || f.message || "",
      mitigationAction: f.recommendation || "",
    })) || [],
    propagationRisks: [],
  } : null;

  // Full engine results block
  const engineResults = buildEngineResults({
    viabilityScore, stabilityScore, survivalScore, growthScore,
    revenue, costs, profit, startingCash, runwayMonths,
    currency, confidenceLevel, confidenceNotes,
    viability, topRisks, topRecs,
    multiEngineOutput,
  });

  // Trace — full orchestration sequence when multi-engine output is available
  const orchestrationSequence = hasMultiEngine
    ? ["viability", "survival", "stability", "growth", "fragility", "master"]
    : ["stability", ...(viabilityScore != null ? ["viability"] : [])];
  const engineVersions = hasMultiEngine
    ? { viability: "1.0.0", survival: "1.0.0", stability: "1.0.0", growth: "1.0.0", fragility: "1.0.0", master: "1.0.0" }
    : { stability: "1.0.0", viability: "1.0.0" };

  return emptyOutput({
    meta: {
      outputId: makeId(),
      businessId: workspaceId || "",
      generatedAt: new Date().toISOString(),
      outputType: scenarioRun ? "simulation" : "assessment",
      rulesetVersion: "v1.0",
      engineVersion: "v1.0",
      source: scenarioRun ? "simulation" : "manual",
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
      masterOutput,
    }),
    scores: {
      viabilityScore,
      survivalScore,
      stabilityScore,
      growthScore,
      businessIntelligenceScore: bi,
      fragilityIndex,
      scoreTrend: null,
    },
    classifications: {
      primary,
      structural,
      fragility: fragilityClass,
      label: structural ? structural.replace(/_/g, " ") : "—",
    },
    engineResults,
    fragility: fragilityBlock,
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
        viability: hasValidation ? "MEDIUM" : "LOW",
        survival: hasMultiEngine ? "MEDIUM" : "LOW",
        stability: confidenceLevel,
        growth: hasMultiEngine ? "MEDIUM" : "LOW",
        fragility: hasMultiEngine ? "MEDIUM" : "LOW",
      },
      dataQualityNotes: confidenceNotes,
    },
    trace: {
      orchestrationSequence,
      engineVersions,
      rulesetVersion: "v1.0",
      generatedBy: scenarioRun ? "scenario_engine" : "orchestrator",
      ...(scenarioRun ? { simulationRunId: scenarioRun.scenario_run_id } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function deriveFragilityIndex(snap) {
  const conc = snap?.top_client_share_pct;
  if (conc == null) return null;
  if (conc >= 70) return 80;
  if (conc >= 50) return 65;
  if (conc >= 30) return 45;
  return 25;
}

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

function deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore, growthScore }) {
  // Blueprint v3 formula: 0.30×V + 0.25×S + 0.20×St + 0.25×G
  const v = viabilityScore;
  const s = survivalScore;
  const st = stabilityScore;
  const g = growthScore;

  if (v != null && s != null && st != null && g != null) {
    return Math.round(0.30 * v + 0.25 * s + 0.20 * st + 0.25 * g);
  }
  // Partial: weighted average of available scores
  const pairs = [[v, 0.30], [s, 0.25], [st, 0.20], [g, 0.25]].filter(([val]) => val != null);
  if (!pairs.length) return null;
  const totalWeight = pairs.reduce((acc, [, w]) => acc + w, 0);
  const weighted = pairs.reduce((acc, [val, w]) => acc + val * w, 0);
  return Math.round(weighted / totalWeight);
}

function classifyPrimary(bi, survivalScore, fragilityIndex) {
  if (bi == null) return null;
  const fi = fragilityIndex ?? 50;
  if (bi < 35 || (survivalScore != null && survivalScore < 25) || fi >= 80) return "CRITICAL";
  if (bi >= 70 && fi <= 40) return "HIGH_PERFORMING";
  if (bi >= 50) return "STRONG_BUT_NEEDS_OPTIMISATION";
  return "AT_RISK";
}

function classifyStructural({ viabilityScore, stabilityScore, survivalScore, growthScore, fragilityIndex }) {
  const bi = deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore, growthScore });
  const fi = fragilityIndex ?? 50;
  const v = viabilityScore ?? 50;
  const s = survivalScore ?? 50;
  const st = stabilityScore ?? 50;
  const g = growthScore ?? 50;

  if (bi == null) return null;

  if (bi < 30 || fi >= 80) return "CRITICAL_BUSINESS_STATE";
  if (bi >= 75 && fi <= 35) return "BALANCED_BUSINESS";
  if (v >= 65 && s < 40) return "VIABLE_BUT_CASH_CRITICAL";
  if (g >= 65 && st < 50) return "GROWTH_READY_BUT_UNSTABLE";
  if (st >= 65 && g < 40) return "STABLE_BUT_STAGNANT";
  if (bi >= 60 && fi >= 60) return "PROFITABLE_BUT_FRAGILE";
  if (g >= 55 && fi >= 50) return "SCALING_WITH_FRAGILITY";
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

function buildExecutiveSummary({ viabilityScore, stabilityScore, survivalScore, topRisks, topRecs, masterOutput }) {
  const bi = masterOutput?.bi_score ?? deriveBusinessIntelligenceScore({ viabilityScore, stabilityScore, survivalScore });
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

  const masterPriority = masterOutput?.priority_recommendations?.[0] || null;
  const priority =
    masterPriority ||
    topRisks.find((r) => r.severity === "CRITICAL")?.recommendedAction ||
    topRisks.find((r) => r.severity === "HIGH")?.recommendedAction ||
    (topRecs[0]?.text || "Review all high-priority risk areas.");

  const masterActions = masterOutput?.priority_recommendations?.slice(0, 3) || [];
  const nextActions = masterActions.length ? masterActions : topRecs.slice(0, 3).map((r) => r.text);
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

function buildEngineResults({ viabilityScore, stabilityScore, survivalScore, growthScore,
    revenue, costs, profit, startingCash, runwayMonths, currency, confidenceLevel,
    confidenceNotes, viability, topRisks, topRecs, multiEngineOutput }) {
  const engConf = () => ({
    level: multiEngineOutput ? "MEDIUM" : confidenceLevel,
    note: multiEngineOutput ? "" : (confidenceNotes[0] || ""),
    penaltyApplied: false,
  });

  const ma = multiEngineOutput?.master?.engine_summary || {};
  const surv = multiEngineOutput?.survival?.scores || {};
  const stab = multiEngineOutput?.stability?.scores || {};
  const grow = multiEngineOutput?.growth?.scores || {};

  const survClass = surv.survival_score != null
    ? surv.survival_score >= 70 ? "RESILIENT" : surv.survival_score >= 50 ? "STABLE" : surv.survival_score >= 35 ? "AT_RISK" : "CRITICAL"
    : null;
  const stabClass = stab.stability_score != null
    ? stab.stability_score >= 70 ? "HIGHLY_STABLE" : stab.stability_score >= 55 ? "STABLE" : "AT_RISK"
    : null;
  const growClass = grow.growth_score != null
    ? grow.growth_score >= 70 ? "HIGH_GROWTH_POTENTIAL" : grow.growth_score >= 50 ? "GROWTH_READY" : "LIMITED_GROWTH"
    : null;

  return {
    stability: {
      engine: "stability",
      score: stabilityScore,
      classification: stabClass || (stabilityScore >= 70 ? "HIGHLY_STABLE" : stabilityScore >= 55 ? "STABLE" : "AT_RISK"),
      headline: stabilityScore >= 70 ? "Business is stable." : stabilityScore >= 55 ? "Some stability concerns." : "Stability risk detected.",
      summary: multiEngineOutput?.stability?.classification || "",
      keyMetrics: [
        { name: "Monthly revenue", value: revenue, unit: currency },
        { name: "Monthly costs", value: costs, unit: currency },
        { name: "Monthly profit", value: profit, unit: currency },
        { name: "Starting cash", value: startingCash, unit: currency },
        ...(runwayMonths !== null ? [{ name: "Cash runway", value: Math.round(runwayMonths * 10) / 10, unit: "months" }] : []),
      ],
      riskFlags: topRisks,
      recommendations: topRecs,
      confidence: engConf(),
    },
    ...(viabilityScore != null ? {
      viability: {
        engine: "viability",
        score: viabilityScore,
        classification: viabilityScore >= 70 ? "VIABLE" : viabilityScore >= 45 ? "MARGINAL" : "WEAK",
        headline: viability?.headline || `Viability score: ${viabilityScore}/100.`,
        summary: viability?.summary || "",
        keyMetrics: [],
        riskFlags: [],
        recommendations: [],
        confidence: engConf(),
      },
    } : {}),
    ...(survivalScore != null && multiEngineOutput ? {
      survival: {
        engine: "survival",
        score: survivalScore,
        classification: survClass,
        headline: ma.survival?.band ? `Survival band: ${ma.survival.band}.` : `Survival score: ${survivalScore}/100.`,
        summary: multiEngineOutput?.survival?.classification || "",
        keyMetrics: [
          { name: "Cash runway", value: surv.cash_runway_months ?? runwayMonths, unit: "months" },
          { name: "Burn rate", value: Math.max(0, costs - revenue), unit: currency },
        ].filter((m) => m.value != null),
        riskFlags: multiEngineOutput?.survival?.risk_flags || [],
        recommendations: multiEngineOutput?.survival?.recommendations || [],
        confidence: engConf(),
      },
    } : {}),
    ...(growthScore != null && multiEngineOutput ? {
      growth: {
        engine: "growth",
        score: growthScore,
        classification: growClass,
        headline: ma.growth?.band ? `Growth band: ${ma.growth.band}.` : `Growth score: ${growthScore}/100.`,
        summary: multiEngineOutput?.growth?.classification || "",
        keyMetrics: [],
        riskFlags: multiEngineOutput?.growth?.risk_flags || [],
        recommendations: multiEngineOutput?.growth?.recommendations || [],
        confidence: engConf(),
      },
    } : {}),
  };
}

function buildScenarioBlock(scenarioRun, timeline) {
  const base = scenarioRun.baseline_metrics || {};
  const sim = scenarioRun.scenario_metrics || {};
  const multiEngine = scenarioRun.multi_engine || {};
  const lastRow = timeline.length ? timeline[timeline.length - 1] : null;

  // Extract all 6 scores from multi-engine output when available
  const baselineStates = multiEngine.baseline_states || {};
  const scenarioStates = multiEngine.scenario_states || {};

  function _eng(states, engine, ...keys) {
    const s = states[engine] || {};
    const scores = s.scores || s;
    for (const k of keys) {
      if (scores[k] != null) return scores[k];
    }
    return null;
  }

  const baseViability  = _eng(baselineStates, "viability",  "score", "viability_score") ?? base.viability_score ?? null;
  const baseSurvival   = _eng(baselineStates, "survival",   "survival_score", "score")  ?? base.survival_score  ?? null;
  const baseStability  = _eng(baselineStates, "stability",  "stability_score", "score") ?? base.stability_score ?? null;
  const baseGrowth     = _eng(baselineStates, "growth",     "growth_score", "score")    ?? base.growth_score    ?? null;
  const baseFragility  = _eng(baselineStates, "fragility",  "fragility_index", "fragility_score") ?? base.fragility_index ?? null;
  const baseBI = deriveBusinessIntelligenceScore({ viabilityScore: baseViability, survivalScore: baseSurvival, stabilityScore: baseStability, growthScore: baseGrowth });

  const simViability  = _eng(scenarioStates, "viability",  "score", "viability_score") ?? sim.viability_score ?? null;
  const simSurvival   = _eng(scenarioStates, "survival",   "survival_score", "score")  ?? sim.survival_score  ?? null;
  const simStability  = _eng(scenarioStates, "stability",  "stability_score", "score") ?? sim.stability_score ?? null;
  const simGrowth     = _eng(scenarioStates, "growth",     "growth_score", "score")    ?? sim.growth_score    ?? null;
  const simFragility  = _eng(scenarioStates, "fragility",  "fragility_index", "fragility_score") ?? sim.fragility_index ?? null;
  const simBI = deriveBusinessIntelligenceScore({ viabilityScore: simViability, survivalScore: simSurvival, stabilityScore: simStability, growthScore: simGrowth });

  function _delta(a, b) { return a != null && b != null ? Math.round((b - a) * 10) / 10 : null; }

  return {
    scenarioId: scenarioRun.scenario_run_id,
    scenarioName: scenarioRun.scenario_name,
    scenarioType: scenarioRun.scenario_type,
    baseScores: {
      viability: baseViability,
      survival: baseSurvival,
      stability: baseStability,
      growth: baseGrowth,
      businessIntelligence: baseBI,
      fragilityIndex: baseFragility,
    },
    simulatedScores: {
      viability: simViability,
      survival: simSurvival,
      stability: simStability,
      growth: simGrowth,
      businessIntelligence: simBI,
      fragilityIndex: simFragility,
    },
    deltas: {
      viabilityDelta:           _delta(baseViability, simViability),
      survivalDelta:            _delta(baseSurvival,  simSurvival),
      stabilityDelta:           _delta(baseStability, simStability),
      growthDelta:              _delta(baseGrowth,    simGrowth),
      businessIntelligenceDelta: _delta(baseBI,       simBI),
      fragilityDelta:           _delta(baseFragility, simFragility),
    },
    riskChanges: [],
    recommendationChanges: (scenarioRun.recommendations || multiEngine.recommendation_delta || [])
      .map((r) => ({ text: r.title, action: r.action_type })).filter((r) => r.text),
    decisionPath: {
      rankingScore: multiEngine.scenario_ranking_score ?? scenarioRun.scenario_ranking_score ?? null,
      reason: scenarioRun.state_result || multiEngine.state_result || "neutral",
      recommendedActions: (scenarioRun.recommendations || []).map((r) => r.title).filter(Boolean),
    },
    timelineSummary: lastRow
      ? {
          endRevenue: lastRow.revenue,
          endCosts: lastRow.costs ?? lastRow.expenses,
          endProfit: lastRow.profit,
          endCashBalance: lastRow.cash_balance,
        }
      : null,
  };
}
