// The 12-month forecast in the review (the owner's QA, 20 Oct: "what of the forecasting?"): said while it waits for the
// owner's figures, then built live from the answers.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ResearchReview from "./ResearchReview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const q = (field, question) => ({ id: `q_${field}`, kind: "question", criterion: "financial", field, label: field, question, type: "number", for_derive: "forecast" });
const RUN = { id: "rr_f", goal: "need_funding", status: "review", context: { currency: "NGN" }, counts: { researched: 0, estimated: 0, reused: 0, calculated: 0, asked: 4, sources: 0 },
  items: [q("price", "What do you charge per wash?"), q("cost", "What does one wash cost you?"), q("monthly_sales", "How many washes a month?"), q("fixed_costs", "Monthly fixed costs?")] };
const TABLE = Array.from({ length: 12 }, (_, n) => ({ month: n + 1, revenue: 1200000, costs: 650000, profit: 550000, cash: 550000 * (n + 1) }));

it("says what the forecast waits for, then builds it from the answers", async () => {
  let built = false;
  vi.spyOn(client, "apiRequest").mockImplementation(async (path) => (path.endsWith("/preview")
    ? { calculated: built ? [{ id: "calc_forecast", derive: "forecast", label: "12-month forecast", value: "Cash after 12 months: ₦6,600,000", table: TABLE, from_answers: true }] : [] } : {}));
  render(<MemoryRouter><ResearchReview businessId="b1" run={RUN} /></MemoryRouter>);
  expect(document.querySelector("[data-forecast-waiting]").textContent)
    .toBe("I'll build it as soon as you answer your price, your cost per sale, your sales a month and your monthly fixed costs above.");
  built = true;
  for (const [label, v] of [["What do you charge per wash?", "4000"], ["What does one wash cost you?", "1500"], ["How many washes a month?", "300"], ["Monthly fixed costs?", "200000"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  expect(document.querySelector("[data-forecast-value]").textContent).toMatch(/^Cash after 12 months: ₦6,600,000/);
  expect(document.querySelectorAll("[data-forecast-live] tbody tr").length).toBe(12);
});
