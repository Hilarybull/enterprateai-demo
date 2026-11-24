// No forecast saved yet: the form opens filled in from the workspace and research, said so, and is saved only by the owner.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as readiness from "../../lib/readiness";
import ForecastEditor from "./ForecastEditor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("opens on the Agent's draft, labelled, with nothing saved", () => {
  vi.spyOn(readiness, "listForecasts").mockResolvedValue({ items: [] });
  const months = Array.from({ length: 12 }, (_, n) => ({ month: `2026-${String(10 + n).padStart(2, "0")}`.replace(/2026-(1[3-9]|2[0-1])/, (m, x) => `2027-${String(Number(x) - 12).padStart(2, "0")}`), receipts: "1200000", payments: "650000", basis: "forecast" }));
  const subject = { id: "c1", data: { currency: "NGN" }, forecast: null,
    forecast_draft: { currency: "NGN", start_month: "2026-10", months, opening_cash: "300000", opening_cash_as_of: "2026-10-20",
      assumptions: [{ applies_to: "receipts", text: "300 sales a month at ₦4,000 each", source: "From your invoices" }], from: "Filled in by the Agent from your workspace and research" } };
  render(<ForecastEditor businessId="b1" feature="funding" subject={subject} evidence={[]} onSaved={() => {}} />);
  expect(document.querySelector("[data-forecast-drafted]").textContent).toMatch(/^Filled in by the Agent from your workspace and research: 300 sales a month at ₦4,000 each/);
  expect(screen.getByDisplayValue("300,000")).toBeTruthy();
  expect(screen.getAllByDisplayValue("1,200,000").length).toBe(12);
  expect(screen.getByText("Filled in for you. Not saved yet.")).toBeTruthy();
});
