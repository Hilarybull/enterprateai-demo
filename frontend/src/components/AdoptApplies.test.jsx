// Adopt applies at once (the owner's QA, 21 Oct): the card's Adopt saves straight away, the score is checked again, and
// what changed is said by the steps: "Saved. Your score is now 38/100, up from 22." Never a staged batch.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { NextSteps } from "./ResultSummary";

// Toasts said by the one toast system (22 Oct), collected for the checks below
const toasts = [];
window.addEventListener("ea:toast", (e) => toasts.push(e.detail));
const lastToast = () => toasts[toasts.length - 1] || {};


afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const RUN = { id: "rr_1", status: "review", context: { currency: "NGN" }, items: [
  { id: "f1", criterion: "financial", derive: "forecast", basis: "calculated", label: "12-month forecast", value: "Cash after 12 months: ₦6,600,000",
    table: [{ month: 1, revenue: 1200000, costs: 650000, profit: 550000, cash: 550000 }] },
  { id: "q1", criterion: "economics", kind: "question", field: "cost", label: "Cost per sale", question: "What does each sale cost you?", money: true, prefill: 6000 }] };
const RESULT = { assessment_type: "funding_readiness_initial", score: 22, criteria: [], strengths: [], premium_next_action: { label: "x" },
  blockers: [{ key: "financial", kind: "unknown", label: "No forecast" }, { key: "economics", kind: "unknown", label: "No cost per sale" }] };

it("applies an Adopt straight away and says the new score", async () => {
  const calls = [];
  vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, body }); return { research: RUN, result: { score: 38 } }; });
  const applied = vi.fn(async () => ({ score: 38, blockers: [] }));
  render(<MemoryRouter><NextSteps result={RESULT} run={RUN} businessId="b1" onApplied={applied} onDoIt={() => {}} onReview={() => {}} /></MemoryRouter>);
  const card = document.querySelector("[data-next-step='financial']");
  expect(card.querySelector("[data-step-draft-line]").textContent).toBe("Draft ready: ₦1.2m in a month. Pays back: cash stays above zero");
  await act(async () => { fireEvent.click(card.querySelector("[data-step-adopt]")); });
  // The question card starts from the launch plan's figure, formatted, and saves on its own (never blocking).
  const q = document.querySelector("[data-next-step='economics'] [data-step-question] input");
  expect(q.value).toBe("6,000");
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  expect(calls.filter((c) => c.path.endsWith("/review")).map((c) => c.body.decisions)).toEqual([{ f1: { decision: "accept", pressed: true } }]);
  expect(applied).toHaveBeenCalled();
  expect(lastToast()).toMatchObject({ kind: "success" });
  expect(lastToast().message).toContain("Score 22 → 38");      // in the toast, never a line in the page
  expect(card.querySelector("[data-step-badge]").textContent).toBe("Done");
});

it("shows your edited version after Edit and Save, and counts it as adopted", async () => {
  // The owner's QA, 23 Oct: edited and saved, the toast said saved, the card still showed the old draft and Adopt.
  const run = { id: "rr_2", status: "review", context: { currency: "NGN" }, items: [
    { id: "d1", criterion: "delivery", kind: "researched", topic: "bench_hours_per_person", label: "Hours each person works a month",
      value: "In Nigeria, the general legal work week is 40 hours.", sources: [{ url: "https://example.org" }] }] };
  const result = { assessment_type: "launch_readiness_initial", score: 15, criteria: [], strengths: [],
    blockers: [{ key: "delivery", kind: "unknown", label: "Delivery capacity" }] };
  vi.spyOn(client, "apiRequest").mockImplementation(async () => ({ research: run, result: { score: 18 } }));
  render(<MemoryRouter><NextSteps result={result} run={run} businessId="b1" onApplied={async () => ({ score: 18 })} /></MemoryRouter>);
  const card = document.querySelector("[data-next-step='delivery']");
  await act(async () => { fireEvent.click(card.querySelector("[data-step-edit]")); });
  const box = card.querySelector("[data-step-editor] textarea");
  await act(async () => { fireEvent.change(box, { target: { value: "Each of us works about 50 hours a week." } }); });
  await act(async () => { fireEvent.click([...card.querySelectorAll("[data-step-editor] button")].find((b) => b.textContent === "Save")); });
  expect(card.querySelector("[data-step-draft-line]").textContent).toBe("Your version: Each of us works about 50 hours a week.");
  expect(card.querySelector("[data-step-badge]").textContent).toBe("Done");
  expect(card.querySelector("[data-step-adopt]").textContent).toBe("Adopted");
});
