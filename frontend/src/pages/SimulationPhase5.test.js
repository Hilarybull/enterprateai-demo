// Simulation audit, Phase 5 (model 1.4): business settings for the further factors, and direct costs as cost of sales.
// docs/simulation-audit/08-phase5-changes.md
import { describe, expect, it } from "vitest";
import { PROJECTION_SETTINGS, SETTING_CHOICES, projectionSettingsForState } from "./SimulationPage";
import { expenseKind, splitDirectCosts } from "../lib/financialIntelligence";

describe("business settings sent with every run", () => {
  it("turns the planned items into the lists the server takes", () => {
    const out = projectionSettingsForState({
      funding_amount: "50000", funding_type: "grant", funding_month: "3",
      equipment_amount: "12000", equipment_month: "2", equipment_life_months: "",
      dividend_amount: "4000", dividend_month: "6",
    });
    expect(out.funding_events).toEqual([{ type: "grant", amount: 50000, month: 3 }]);
    expect(out.capital_purchases).toEqual([{ amount: 12000, month: 2, life_months: 36 }]);
    expect(out.dividends).toEqual([{ amount: 4000, month: 6 }]);
    expect(out.funding_amount).toBeUndefined();      // the row's own fields are not sent
  });

  it("sends choices as text and yes/no as true/false, and leaves blanks out", () => {
    const out = projectionSettingsForState({ tax_country: "GB", profit_tax_regime: "uk_corporation_tax",
      payroll_in_recorded_expenses: "false", payroll_staff_count: "3", owner_drawings_monthly: "", bad_debt_pct: "2" });
    expect(out).toEqual({ tax_country: "GB", profit_tax_regime: "uk_corporation_tax", payroll_in_recorded_expenses: false,
      payroll_staff_count: 3, bad_debt_pct: 2 });
    expect(projectionSettingsForState({ payroll_in_recorded_expenses: "" })).toEqual({});
  });

  it("offers every new setting, with choices where one is chosen", () => {
    const keys = PROJECTION_SETTINGS.map(([k]) => k);
    for (const k of ["tax_country", "profit_tax_regime", "payroll_staff_count", "owner_drawings_monthly", "bad_debt_pct",
      "funding_amount", "equipment_amount", "dividend_amount", "tax_losses_brought_forward"]) expect(keys).toContain(k);
    expect(SETTING_CHOICES.funding_type.map(([v]) => v)).toEqual(["equity", "owner_capital", "grant"]);
  });
});

describe("direct costs", () => {
  it("knows direct, payroll and other expenses by category", () => {
    expect(expenseKind({ category: "Subcontractor" })).toBe("direct");
    expect(expenseKind({ category: "Materials" })).toBe("direct");
    expect(expenseKind({ category: "Salaries" })).toBe("payroll");
    expect(expenseKind({ category: "Rent", description: "Office" })).toBe("other");
  });

  it("moves direct costs to cost of sales month by month, keeping the total", () => {
    const snap = { expenses_by_month: { "2026-09": 5000, "2026-10": 6000 }, cost_of_sales_by_month: {} };
    const out = splitDirectCosts(snap, { "2026-09": 2000, "2026-10": 2500 });
    expect(out.expenses_by_month).toEqual({ "2026-09": 3000, "2026-10": 3500 });
    expect(out.cost_of_sales_by_month).toEqual({ "2026-09": 2000, "2026-10": 2500 });
  });

  it("leaves the history alone when invoices already carry product costs", () => {
    const snap = { expenses_by_month: { "2026-09": 5000 }, cost_of_sales_by_month: { "2026-09": 800 } };
    expect(splitDirectCosts(snap, { "2026-09": 2000 })).toBe(snap);
  });
});
