import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import KpiDetails from "./KpiDetails";

const detail = { explain: "Invoices paid or delivered.", total: 300, link: { label: "Open invoices", to: "/operations" },
  rows: [{ id: "a", party: "Alpha", ref: "INV-1", at: Date.parse("2026-10-01"), amount: 300, note: "Paid" }] };
const open = (props) => render(<MemoryRouter><KpiDetails title="Total Revenue" value="£300.00" currency="GBP" onClose={() => {}} {...props} /></MemoryRouter>);

afterEach(cleanup);

describe("KpiDetails", () => {
  it("lists the records behind the figure on a paid plan", () => {
    open({ detail });
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Open invoices")).toBeTruthy();
  });

  it("shows no records on a free plan, only the way to upgrade", () => {
    open({ detail: null, locked: true });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Upgrade").getAttribute("href")).toBe("/pricing");
  });
});
