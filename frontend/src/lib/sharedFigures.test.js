import { describe, expect, it } from "vitest";
import { withSharedFigures } from "./sharedFigures";

const insights = { stateSnapshot: { revenue_monthly: 900, costs_monthly: 50, expenses_monthly: 40, cost_of_sales_monthly: 10, starting_cash: 1000, top_client_share_pct: 60 },
  largestClient: { id: "c1", name: "Acme", share: 60 } };
const shared = { revenue_monthly: 150, cash: 381.5, costs_monthly: 300, top_share: 100, clients: 1, customers: [{ name: "Delta Offices Ltd", share: 100 }],
  sources: { costs_monthly: "your usual monthly costs, as you told me" } };

describe("Simulation starts from the shared figures (R-4)", () => {
  it("uses the risk check's customer, share, cash, revenue and the owner's monthly costs", () => {
    const { stateSnapshot: s, largestClient } = withSharedFigures(insights, shared, "Delta Offices Ltd");
    expect(largestClient).toMatchObject({ name: "Delta Offices Ltd", share: 100 });
    expect(s).toMatchObject({ revenue_monthly: 150, starting_cash: 381.5, top_client_share_pct: 100, expenses_monthly: 300, costs_monthly: 310 });
  });
  it("uses recorded costs as the risk check does, and keeps Simulation's own figures when the shared ones are missing", () => {
    const { stateSnapshot: s } = withSharedFigures(insights, { ...shared, costs_monthly: 22.83, sources: { costs_monthly: "2 expenses recorded in the last 3 months" } });
    expect(s).toMatchObject({ expenses_monthly: 22.83, costs_monthly: 32.83 });
    expect(withSharedFigures(insights, { ...shared, costs_monthly: null }).stateSnapshot.costs_monthly).toBe(50);
    expect(withSharedFigures(insights, null)).toEqual({ stateSnapshot: insights.stateSnapshot, largestClient: insights.largestClient });
  });
});
