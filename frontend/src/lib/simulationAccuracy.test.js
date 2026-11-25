import { describe, it, expect } from "vitest";
import { receivableTiming } from "./receivableTiming";
import { validateSimulationInputs, validateSimulationSettings } from "./simulationValidation";
import { withSharedFigures } from "./sharedFigures";
import { rangeOf, timelineRowForDisplay } from "../pages/SimulationPage";

describe("24 November simulation accuracy acceptance", () => {
  const today = new Date("2026-11-24T12:00:00Z");
  it("separates overdue, approaching, open and settled invoices by date and unpaid balance", () => {
    const inv = { total_amount: 100, status: "sent" };
    expect(receivableTiming({ ...inv, due_date: "2026-11-23" }, today)).toBe("overdue");
    expect(receivableTiming({ ...inv, due_date: "2026-11-24" }, today)).toBe("approaching");
    expect(receivableTiming({ ...inv, due_date: "2026-12-10" }, today)).toBe("open_not_due");
    expect(receivableTiming(inv, today)).toBe("open_not_due");
    expect(receivableTiming({ ...inv, due_date: "2026-11-01", payments: [{ amount: 100 }] }, today)).toBeNull();
  });
  it.each([["timeline_months", ""], ["timeline_months", 25], ["price_change_pct", -51],
    ["revenue_drop_pct", -10], ["cost_increase_pct", 101], ["employee_count", 1.5],
    ["employee_count", 101], ["loan_amount", -10], ["loan_term_months", 361], ["start_month", 7]])(
    "rejects %s=%s without changing the entered number", (key, value) => {
      expect(() => validateSimulationInputs({ timeline_months: 6, [key]: value })).toThrow();
    });
  it("allows a signed price reduction and rejects a missing required figure", () => {
    expect(() => validateSimulationInputs({ price_change_pct: -25 })).not.toThrow();
    expect(() => validateSimulationInputs({}, ["loan_amount"])).toThrow(/loan amount/);
    expect(() => validateSimulationSettings({ bad_debt_pct: -1 }, 6)).toThrow();
  });
  it("uses the server's canonical payment terms, matching revenue and costs and overdue count", () => {
    const shared = { revenue_monthly: 999, simulation_inputs: { revenue_monthly: 1000, cost_of_sales_monthly: 120,
      payment_terms_days: 32, overdue_receivables_count: 3 }, simulation_sources: { payment_terms_days: "weighted invoice terms" } };
    const state = withSharedFigures({ stateSnapshot: { payment_terms_days: 25 } }, shared).stateSnapshot;
    expect(state).toMatchObject(shared.simulation_inputs);
    expect(state.figure_sources.payment_terms_days).toBe("weighted invoice terms");
  });
  it("uses the API table values and exposes separate bank cash and cash after VAT ranges", () => {
    const row = { month_index: 1, revenue: 1000.01, costs: 500.02, profit: 499.99, cash_balance: 1200.03 };
    const display = timelineRowForDisplay(row);
    expect(display).toMatchObject(row);
    expect(display._cash).toBe(row.cash_balance);
    const uncertainty = { ranges: { cases: Object.fromEntries(["low", "base", "high"].map(k => [k,
      { scenario: { closing_cash: 1200.03, cash_after_vat_owed: 1100.03, net_cash: 900.03 } }])) } };
    expect(rangeOf(uncertainty).base).toBe(1200.03);
    expect(rangeOf(uncertainty, "scenario", "cash_after_vat_owed").base).toBe(1100.03);
  });
});
