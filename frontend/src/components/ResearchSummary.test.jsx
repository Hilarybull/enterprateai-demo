// The one result view after a paid run (the owner's brief, 20 Oct): drafts as rows with Adopt, at most three funding
// options with "Fits", the questions inline, one free "Check my score again".
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import ResearchSummary, { AdoptedBanner, shortMoney } from "./ResearchSummary";

// Toasts said by the one toast system (22 Oct), collected for the checks below
const toasts = [];
window.addEventListener("ea:toast", (e) => toasts.push(e.detail));
const lastToast = () => toasts[toasts.length - 1] || {};


afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const months = Array.from({ length: 12 }, (_, n) => ({ month: n + 1, revenue: 1200000, costs: 650000, profit: 550000, cash: 550000 * (n + 1) }));
const RUN = { id: "rr_1", status: "review", balance: 296, context: { currency: "NGN" }, answers: { amount: 5000000, route: "loan" },
  deliverables: { routes: [{ route: "loan", local: "RAPID programme for nano, micro and small businesses, up to ₦5m.", fits: { fit: "Likely", why: "It is for small businesses like yours", confirmed: "2025-04-07" } }] },
  items: [
    { id: "d1", kind: "estimated", basis: "calculated", derive: "use_of_funds", label: "Use of funds", value: "3 lines, ₦5,000,000 in all",
      table: [{ line: "2 more washing bays", amount: 4400000 }, { line: "Working capital: two months of fixed costs", amount: 400000 }, { line: "Reserve: one month of fixed costs", amount: 200000 }] },
    { id: "d2", kind: "estimated", basis: "calculated", derive: "forecast", label: "12-month forecast", value: "Cash after 12 months: ₦6,600,000", table: months },
    { id: "r1", kind: "researched", topic: "route_loan", label: "Loans", value: "RAPID programme for nano, micro and small businesses, up to ₦5m.",
      sources: [{ title: "Bank of Industry RAPID", url: "https://example.org", date: "2025-04-07", quote: "Up to ₦5m for small businesses." }] },
    { id: "q1", kind: "question", field: "cost", label: "Cost per sale", question: "What does one wash cost you?", money: true },
    { id: "x1", kind: "reused", field: "fixed_costs", label: "Monthly fixed costs", value: 200000 },
  ] };

it("says what was prepared, points to the drafts in the steps, and applies a saved option at once", async () => {
  const calls = [];
  vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, method, body }); return path.endsWith("/review") ? { research: { ...RUN, status: "adopted" }, result: { score: 38, blockers: [] } } : {}; });
  const adopted = vi.fn();
  render(<ResearchSummary businessId="b1" run={RUN} score="22/100" onAdopted={adopted} />);
  // One count everywhere (the owner's QA, 21 Oct): the run's findings, in the header and the cost line alike.
  expect(document.querySelector("[data-summary-head]").textContent).toBe("1 finding for your ₦5m loan.");
  expect(document.querySelector("[data-summary-drafts]").textContent).toBe("2 drafts are ready in your steps below: Use of funds, 12-month cash forecast.");
  expect(document.querySelector("[data-check-again]")).toBeNull();      // no staged batch: each choice applies at once
  const option = document.querySelector("[data-summary-option]");
  expect(option.querySelector("[data-fits]").textContent).toBe("Fits: Likely");
  expect(option.querySelector("[data-option-confirmed]").textContent).toBe("Last confirmed open: 7 Apr 2025");
  await click(within(option).getByRole("button", { name: "Save to my case" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  expect(calls.find((c) => c.path.endsWith("/review")).body.decisions).toEqual({ r1: { decision: "accept", pressed: true } });
  expect(adopted).toHaveBeenCalled();
  expect(lastToast()).toMatchObject({ kind: "success", title: "Saved to your case.", message: "Find it under Funding options." });
  expect(document.body.textContent).not.toMatch(/[–—]/);
});

it("becomes one line once adopted, and says amounts short", () => {
  render(<AdoptedBanner run={{ ...RUN, status: "adopted", adopted_at: "2026-10-20T10:00:00Z", items: RUN.items.map((i) => (i.derive ? { ...i, decision: "accepted" } : i)) }} onOpen={() => {}} />);
  expect(document.querySelector("[data-adopted-banner]").textContent).toBe("You adopted 2 drafts on 20 Oct · See what I did");
  expect([shortMoney(3000000, "NGN"), shortMoney(993397, "NGN"), shortMoney(25000, "GBP")]).toEqual(["₦3m", "₦993K", "£25K"]);
});
