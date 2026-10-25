import { describe, expect, it } from "vitest";
import { highImpact } from "./SimulationPage";

describe("a scenario's impact (the owner, 25 Oct)", () => {
  it("losing half the revenue or more is high impact; a small loss isn't", () => {
    expect(highImpact({ baseline_metrics: { monthly_revenue: 150, stability_score: 77 }, scenario_metrics: { monthly_revenue: 0, stability_score: 62 } })).toBe(true);
    expect(highImpact({ baseline_metrics: { monthly_revenue: 150, stability_score: 77 }, scenario_metrics: { monthly_revenue: 135, stability_score: 77 } })).toBe(false);
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
