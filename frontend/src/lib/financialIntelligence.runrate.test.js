// Simulation audit (F8, Phase 3): the page's monthly figure follows the server's baseline rule.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFinancialIntelligence } from "./financialIntelligence";

const inv = (paid_at, total_amount) => ({ id: paid_at, status: "paid", paid_at, total_amount });

describe("monthly revenue run rate", () => {
  afterEach(() => vi.useRealTimers());

  it("averages the last 3 complete months and leaves out the month in progress", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 17));      // 17 Nov 2026
    const fi = buildFinancialIntelligence({ catalogue: {}, financials: { invoices: [
      inv("2026-08-10", 9000), inv("2026-09-10", 10000), inv("2026-10-10", 11000), inv("2026-11-05", 2000),
    ] } });
    expect(fi.stateSnapshot.revenue_monthly).toBe(10000);      // was 2,000 (November so far)
  });

  it("counts a month with nothing recorded as zero, and uses the month in progress only when nothing is complete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 17));
    const gap = buildFinancialIntelligence({ catalogue: {}, financials: { invoices: [inv("2026-07-10", 6000), inv("2026-10-10", 6000)] } });
    expect(gap.stateSnapshot.revenue_monthly).toBe(2000);
    const young = buildFinancialIntelligence({ catalogue: {}, financials: { invoices: [inv("2026-11-05", 2000)] } });
    expect(young.stateSnapshot.revenue_monthly).toBe(2000);
  });
});
