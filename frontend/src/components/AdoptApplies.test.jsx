// Adopt applies at once (the owner's QA, 21 Oct): the card's Adopt saves straight away, the score is checked again, and
// what changed is said by the steps: "Saved. Your score is now 38/100, up from 22." Never a staged batch.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { NextSteps } from "./ResultSummary";

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
  expect(document.querySelector("[data-apply-status]").textContent).toBe("Saved. Your score is now 38/100, up from 22.");
  expect(card.querySelector("[data-step-badge]").textContent).toBe("Done");
});
