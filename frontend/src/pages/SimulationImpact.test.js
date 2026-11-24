import { describe, expect, it } from "vitest";
import { highImpact } from "./SimulationPage";

describe("a scenario's impact (the owner, 25 Oct)", () => {
  it("losing half the revenue or more is high impact; a small loss isn't", () => {
    expect(highImpact({ baseline_metrics: { monthly_revenue: 150, stability_score: 77 }, scenario_metrics: { monthly_revenue: 0, stability_score: 62 } })).toBe(true);
    expect(highImpact({ baseline_metrics: { monthly_revenue: 150, stability_score: 77 }, scenario_metrics: { monthly_revenue: 135, stability_score: 77 } })).toBe(false);
  });
});

import { projectionMonthLabel, timelineRowForDisplay, verdictLabel } from "./SimulationPage";
import { readableEngineOutput } from "../lib/contracts/index";

describe("simulation audit, Phase 0 (16 Nov 2026)", () => {
  it("a cash shortfall the change causes is high impact, judged on the projection, not the stability score", () => {
    const run = { state_result: "worse", baseline_metrics: { monthly_revenue: 100, stability_score: 80 },
      scenario_metrics: { monthly_revenue: 95, stability_score: 80, verdict: { cash_shortfall_introduced: true } } };
    expect(highImpact(run)).toBe(true);
    expect(verdictLabel(run)).toBe("High impact: worse than doing nothing");
  });

  it("says the verdict in words, including a trade-off and no material change", () => {
    expect(verdictLabel({ state_result: "improved", scenario_metrics: {} })).toBe("Better than doing nothing");
    expect(verdictLabel({ state_result: "neutral", scenario_metrics: { verdict: { outcome: "mixed" } } })).toBe("Mixed: a trade-off to weigh");
    expect(verdictLabel({ state_result: "neutral", scenario_metrics: { verdict: { outcome: "no_material_change" } } })).toBe("No material change");
  });

  it("shows the server's cash and cumulative profit unchanged (F13)", () => {
    const row = { month_index: 1, revenue: 20000, accruals: 20000, cash_balance: 43000, cumulative_profit: 8000 };
    expect(timelineRowForDisplay(row)).toMatchObject({ _cash: 43000, _cumGross: 8000, receivables: 20000, revenue: 20000 });
  });

  it("labels projection month 1 as the month after the run", () => {
    const label = projectionMonthLabel("2026-11-16T10:00:00Z", 1);
    expect(label).toBe(new Date(2026, 11, 1).toLocaleString(undefined, { month: "short", year: "numeric" }));
  });

  it("counts engine output only when its scores can be read", () => {
    expect(readableEngineOutput({ baseline: {}, scenario: {} })).toBeNull();
    expect(readableEngineOutput({ survival: { scores: { survival_score: 64 } } })).not.toBeNull();
    expect(readableEngineOutput(null)).toBeNull();
  });
});

import { statusOf } from "./SimulationPage";

describe("a month's status in plain words (the owner, 25 Oct)", () => {
  it("says At risk and Under stress, never AT_RISK or STRESS, each with what it means", () => {
    expect(statusOf("at_risk")).toEqual(["At risk", "Cash covers less than one month of costs."]);
    expect(statusOf("at risk")[0]).toBe("At risk");
    expect(statusOf("stress")[0]).toBe("Under stress");
    expect(statusOf("critical")[0]).toBe("Overdrawn");
  });
});

import { projectionChecksText, projectionSettingsForState } from "./SimulationPage";

describe("simulation audit, Phase 1: business settings and checks", () => {
  it("sends only the settings that have a value, as numbers", () => {
    expect(projectionSettingsForState({ profit_tax_rate_pct: "19", sales_tax_rate_pct: "", existing_loan_balance: "12000.5", unknown: "4" }))
      .toEqual({ profit_tax_rate_pct: 19, existing_loan_balance: 12000.5 });
    expect(projectionSettingsForState(null)).toEqual({});
  });

  it("says when every check passed, and names any that failed", () => {
    expect(projectionChecksText({ checks: { cash_reconciles: true, receivables_reconcile: true, balance_sheet_balances: true } }))
      .toMatch(/^Checks passed/);
    expect(projectionChecksText({ checks: { cash_reconciles: true, balance_sheet_balances: false } })).toBe("Check failed: balance sheet. Please report this run.");
    expect(projectionChecksText({})).toBe("");
  });
});

import { confidenceText, rangeOf } from "./SimulationPage";

describe("simulation audit, Phase 2: how sure the result is", () => {
  it("states the confidence level with its reasons", () => {
    expect(confidenceText({ confidence: { level: "low", reasons: ["no history", "terms assumed"] } })).toBe("Low confidence: no history; terms assumed.");
    expect(confidenceText(null)).toBe("");
  });

  it("reads the low, base and high net cash for the side shown", () => {
    const u = { ranges: { cases: { low: { scenario: { net_cash: 1 } }, base: { scenario: { net_cash: 2 }, baseline: { net_cash: 5 } }, high: { scenario: { net_cash: 3 } } } } };
    expect(rangeOf(u, "scenario")).toEqual({ low: 1, base: 2, high: 3 });
    expect(rangeOf(u, "baseline").base).toBe(5);
    expect(rangeOf({}, "scenario")).toBeNull();
  });
});

import { accuracyText } from "./SimulationPage";

describe("simulation audit, Phase 3: accuracy against what happened", () => {
  it("reports tracked accuracy and the backtest against the naive method", () => {
    const lines = accuracyText({
      tracked: { overall: { months: 3, wape_pct: 6.7, bias_pct: 2.1 } },
      backtest: { wape_pct: 1.9, naive_wape_pct: 3.6, skill: "better than the naive method" },
    });
    expect(lines[0]).toBe("Earlier forecasts were off by 6.7% on average over 3 completed months (too high: +2.1%).");
    expect(lines[1]).toMatch(/1.9% against 3.6%.*better than the naive method/);
  });

  it("says what is missing when there is nothing to measure yet", () => {
    const lines = accuracyText({ tracked: { overall: { wape_pct: null }, note: "No earlier forecast has reached a completed month yet." },
      backtest: { wape_pct: null, note: "At least 4 complete months of revenue are needed." } });
    expect(lines).toHaveLength(2);
    expect(accuracyText(null)).toEqual([]);
  });
});
