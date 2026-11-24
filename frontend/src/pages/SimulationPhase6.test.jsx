// Simulation audit, Phase 6 part 2 (model 1.6): settings card with confirmed figures, data check, model-update notice.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path) => {
    if (path.startsWith("/validation/me")) return { data: { financials: { invoices: [], expenses: [] }, catalogue: {} } };
    if (path.startsWith("/v1/scenario-intelligence/scenario-templates")) return { templates: [] };
    if (path.startsWith("/v1/scenario-intelligence/model")) return { version: "projection-1.6", changes: [] };
    if (path.startsWith("/v1/scenario-intelligence/history")) {
      return { history: [{ scenario_run_id: "r1", scenario_name: "Price +5%", scenario_type: "price_change", executed_at: "2026-11-01",
        model_version: "projection-1.4", outcome: "improved" }] };
    }
    if (path.startsWith("/v1/scenario-intelligence/do-nothing/run")) {
      return { projection_id: "p1", forecast: [], summary: {
        checks: { cash_reconciles: true, receivables_reconcile: true, balance_sheet_balances: true },
        data_quality: { summary: "0 serious, 1 to check, 0 for information.", issues: [{ code: "gaps", severity: "warning", what: "No sales recorded in 2026-04.", why: "Empty months pull the average down.", fix: "Record the missing invoices." }] },
        uncertainty: { inputs: [{ input: "Monthly revenue", value: 6000, label: "from your history", source: "average of Aug-Oct" }] },
      } };
    }
    return {};
  }),
}));

import SimulationPage, { PROJECTION_SETTINGS, SETTING_GROUPS, figuresSignature, ScenarioOutput } from "./SimulationPage";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";

afterEach(() => cleanup());
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

describe("business settings in groups", () => {
  it("puts every setting in exactly one group", () => {
    const grouped = SETTING_GROUPS.flatMap(([, keys]) => keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(PROJECTION_SETTINGS.map(([k]) => k).sort());
  });

  it("notices when the figures change after they were confirmed", () => {
    const a = [{ input: "Monthly revenue", value: 6000, label: "from your history" }, { input: "Loan balance", value: null, label: "not set" }];
    const b = [{ input: "Monthly revenue", value: 6100, label: "from your history" }];
    expect(figuresSignature(a)).toBe(JSON.stringify([["Monthly revenue", 6000]]));
    expect(figuresSignature(a)).not.toBe(figuresSignature(b));
  });
});

describe("the simulation dashboard", () => {
  it("keeps Explorer's free baseline without requesting paid recommendations", async () => {
    const previous = useAuthStore.getState();
    useAuthStore.setState({ planKey: "explorer", planStatus: "inactive", platformGrants: [], platformRestrictions: [] });
    useWorkspaceStore.setState({ workspaceId: "ws-explorer", isMemberMode: false });
    const { container } = render(<SimulationPage />);
    try {
      await flush();
      await flush();
      expect(container.querySelector('[data-tour="simulation-baseline"]')).not.toBeNull();
      expect(container.textContent).not.toContain("To use simulation, please upgrade.");
      const { apiRequest } = await import("../api/client");
      expect(apiRequest.mock.calls.filter(([path]) => path.includes("/recommendations/generate"))).toHaveLength(0);
    } finally { useAuthStore.setState(previous); }
  });
  it("shows the settings card, the figures used, the data check and the model notice", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    const { container } = render(<SimulationPage />);
    await flush();
    await flush();
    expect(container.querySelector("[data-business-settings]")).not.toBeNull();
    expect(container.querySelectorAll("[data-settings-group]").length).toBe(5);
    expect(container.querySelector("[data-figures-used]")?.textContent).toContain("Monthly revenue");
    expect(container.querySelector("[data-model-notice]")?.textContent).toContain("earlier model (projection-1.4)");
  });
});


it("keeps the outlook as a table with the current month before forecast months", () => {
  const current = { label: "Nov 2026", recorded_so_far: { revenue: 500, costs: 700, source: "Recorded invoices" }, rest_of_month: { days: 6, revenue: 60, costs: 53.33 }, month_total: { revenue: 560, costs: 753.33, profit: -193.33 }, cash_today: 600, cash_at_month_end: 6068.67, explanation: "Includes the days remaining." };
  const { container } = render(<ScenarioOutput activeRun={{ scenario_type: "do_nothing_projection", scenario_name: "Current outlook", executed_at: "2026-11-24T12:00:00Z", scenario_metrics: { projection: { current_month: current } } }} timeline={[{ month_index: 1, revenue: 300, costs: 267, cash_balance: 5990, cumulative_profit: 40, state_label: "Stable" }]} currency="GBP" hideDecision />);
  const table = container.querySelector('[aria-label="Detailed monthly forecast"] table');
  const rows = table.querySelectorAll("tbody tr");
  expect(rows.length).toBe(2);
  expect(rows[0].textContent).toContain("Nov 2026");
  expect(rows[0].textContent).toContain("Current month");
  expect(rows[0].textContent).toContain("£6,068.67");
  expect(rows[1].textContent).toContain("Dec 2026");
  expect(table.closest("details")).toBeNull();
  expect(container.querySelector("[data-mobile-timeline]")).toBeNull();
});
