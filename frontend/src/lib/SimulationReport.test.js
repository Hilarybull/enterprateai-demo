// Simulation audit, Phase 3 (17 Nov 2026): one source of truth. The downloadable report shows the server's verdict,
// confidence and engine scores for a run, the same the Simulation page shows.
import { describe, expect, it } from "vitest";
import { assembleOutput } from "./contracts/index";
import { generateNarrative } from "./narratives/index";

// A saved run as the server returns it (scenario_intelligence service, Phases 0-2)
const RUN = {
  scenario_run_id: "r1",
  scenario_name: "Raise prices 10%",
  scenario_type: "price_change",
  state_result: "improved",
  baseline_metrics: { monthly_revenue: 20000, stability_score: 80 },
  scenario_metrics: {
    monthly_revenue: 20000,
    stability_score: 80,
    verdict: { outcome: "improved", reason: "Profit and/or cash end materially higher than if nothing changes.", months: 6,
      net_cash_change: 2181.81, closing_cash_change: 2181.81, cumulative_profit_change: 2181.81 },
    uncertainty: {
      confidence: { level: "medium", reasons: ["6 complete months of sales on record"] },
      ranges: { robust: false, robustness: "The verdict depends on the assumptions: low case worse than doing nothing.",
        cases: { low: { scenario: { net_cash: 70000 } }, base: { scenario: { net_cash: 80000 } }, high: { scenario: { net_cash: 90000 } } } },
    },
    projection: { assumptions: ["Month 1 is the first full month after today."] },
  },
  multi_engine: {
    basis: "Engine scores at the end of month 6, with and without the change.",
    scenario: { engine_deltas: { survival: { baseline: 70, scenario: 85, change: 15, direction: "better" } } },
  },
};

describe("the report's scenario section uses the server's results", () => {
  const output = assembleOutput({ workspaceId: "w", businessName: "B", scenarioRun: RUN, scenarioTimeline: [{ cash_balance: 80000, profit: 8363.64 }] });

  it("reads engine scores where the server stores them, and nothing else", () => {
    const s = output.scenarios;
    expect(s.baseScores.survival).toBe(70);
    expect(s.simulatedScores.survival).toBe(85);
    expect(s.deltas.survivalDelta).toBe(15);
    expect(s.simulatedScores.stability).toBeNull();      // not assessed by the engines: not the rule-based indicator
  });

  it("carries the verdict, confidence, robustness and range", () => {
    const s = output.scenarios;
    expect(s.verdict.outcome).toBe("improved");
    expect(s.confidence.level).toBe("medium");
    expect(s.netCashRange).toEqual({ low: 70000, base: 80000, high: 90000 });
  });

  it("headlines the verdict, not a stability score", () => {
    const n = generateNarrative({ narrativeType: "scenario_explanation", output, currency: "GBP" });
    expect(n.headline).toBe("Better than doing nothing.");
    expect(n.narrative).toMatch(/depends on the assumptions/);
    expect(n.keyPoints.join(" ")).toMatch(/Confidence: medium/);
    expect(n.headline).not.toMatch(/stability/i);
  });
});
