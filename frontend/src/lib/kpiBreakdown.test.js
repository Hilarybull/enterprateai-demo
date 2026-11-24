import { describe, expect, it } from "vitest";
import { buildKpiTrends, kpiBreakdown } from "./dashboardTrends";

const now = Date.parse("2026-10-12T12:00:00Z");
const d = (days) => new Date(now - days * 86400000).toISOString();
const invoices = [
  { id: "a", status: "paid", customer_name: "Alpha", total_amount: 300, cost_of_sales: 60, paid_at: d(10), issue_date: d(20) },
  { id: "b", status: "delivered", customer_name: "Beta", total_amount: 200, delivered_at: d(5), due_date: d(1) },
  { id: "c", status: "sent", customer_name: "Alpha", total_amount: 100, issue_date: d(3), due_date: d(-20) },
  { id: "e", status: "paid", customer_name: "Gamma", total_amount: 50, payment_type: "partial", paid_amount: 20, paid_at: d(200) },
  { id: "x", status: "draft", customer_name: "Delta", total_amount: 999 },
];
const expenses = [
  { id: "p", status: "paid", vendor_name: "Supplier One", price: 40, date: d(7), description: "Tools" },
  { id: "q", status: "pending", vendor_name: "Supplier Two", price: 25, date: d(2) },
];
const toWs = (n) => Number(n || 0);
const args = { invoices, expenses, toWs, rangeKey: "3m", now };

describe("kpiBreakdown", () => {
  const trends = buildKpiTrends(args);
  it.each(["revenue", "cash", "costs", "receivables"])("%s rows add up to the tile figure", (kind) => {
    const b = kpiBreakdown({ ...args, kind });
    expect(b.total).toBeCloseTo(trends[kind].value, 2);
  });

  it("lists receivables with the overdue ones first", () => {
    const b = kpiBreakdown({ ...args, kind: "receivables" });
    expect(b.rows[0]).toMatchObject({ id: "b", overdue: true, note: "Overdue" });
    expect(b.rows.map((r) => r.id)).not.toContain("x");
  });

  it("explains each risk with the records behind it", () => {
    const b = kpiBreakdown({ ...args, kind: "risks" });
    expect(b.risks.length).toBe(trends.risks.value);
    const overdue = b.risks.find((r) => r.key === "overdue");
    expect(overdue.details[0]).toMatch(/Beta/);
    const fromAgent = kpiBreakdown({ ...args, kind: "risks", risks: [{ key: "runway", label: "Less than 3 months of runway", severity: "high" }] });
    expect(fromAgent.risks).toEqual([{ key: "runway", label: "Less than 3 months of runway", severity: "high", details: [] }]);
  });
});
