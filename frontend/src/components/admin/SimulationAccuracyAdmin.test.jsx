// Simulation audit, Phase 7: the admin accuracy screen shows the status, alerts and pooled figures.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async () => ({
    status: "review needed", alerts: ["Bias +12% is outside the ±10% review threshold (forecasts too high)."],
    overall: { months: 8, wape_pct: 14.2, bias_pct: 12 }, range_coverage_pct: 88.0, runs_compared: 5, businesses: 3,
    businesses_with_completed_months: 2, by_confidence: { high: { months: 6, wape_pct: 9.1, bias_pct: 5 } },
    by_model_version: { "projection-1.6": { months: 8, wape_pct: 14.2, bias_pct: 12 } },
    thresholds: { wape_pct: 25, bias_pct: 10, min_months: 6, coverage_floor_pct: 80 }, method: "Forecast against recorded revenue.",
  })),
}));

import SimulationAccuracyAdmin from "./SimulationAccuracyAdmin";

afterEach(() => cleanup());

describe("simulation accuracy (admin)", () => {
  it("shows the status, the alerts and the figures", async () => {
    const { container } = render(<SimulationAccuracyAdmin />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const text = container.textContent;
    expect(container.querySelector("[data-accuracy-status]").textContent).toContain("review needed");
    expect(text).toContain("forecasts too high");
    expect(text).toContain("14.2%");
    expect(text).toContain("projection-1.6");
  });
});
