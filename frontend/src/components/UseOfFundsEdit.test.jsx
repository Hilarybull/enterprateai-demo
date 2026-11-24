// The owner's QA (21 Oct): "how can I change marketing now?" Edit on the use of funds shows its lines and opens them on the case.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const RUN = { id: "rr_2", status: "review", items: [
  { id: "u1", criterion: "use_of_funds", derive: "use_of_funds", basis: "calculated", label: "Use of funds", value: "3 lines, £50,000 in all",
    table: [{ line: "Marketing", amount: 35000 }, { line: "Working capital: two months of fixed costs", amount: 10000 }, { line: "Reserve: one month of fixed costs", amount: 5000 }] }] };
vi.mock("../api/client", () => ({ apiRequest: vi.fn(async () => ({ research: RUN })) }));
const { NextSteps, useResearchRun } = await import("./ResultSummary");
afterEach(cleanup);

function Card({ r }) { const run = useResearchRun("ws1", r); return <NextSteps result={r} run={run} businessId="ws1" onDoIt={() => {}} />; }

it("lists each line and links to the case's use of funds", async () => {
  const r = { assessment_type: "funding_readiness_initial", research: { state: "review", run_id: "rr_2" }, criteria: [], strengths: [],
    assessment: { kind: "funding", case_id: "c9" }, premium_next_action: { label: "x", explains: "" },
    blockers: [{ key: "use_of_funds", kind: "unknown", label: "No use of funds yet" }] };
  render(<MemoryRouter><Card r={r} /></MemoryRouter>);
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  const card = document.querySelector("[data-next-step='use_of_funds']");
  await act(async () => { card.querySelector("[data-step-edit]").click(); });
  expect(card.querySelector("[data-step-editor-lines]").textContent).toContain("Marketing");
  expect(card.querySelector("[data-step-editor-lines-link]").getAttribute("href")).toBe("/funding/c9?tab=answers&section=finances&field=use_of_funds");
});
