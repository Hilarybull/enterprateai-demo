// The owner (20 Oct 2026): "it's an agent". After research, each next step shows the Agent's draft to review and edit,
// never a "Do it for me" of its own; before research, one press for all, its price first.
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ apiRequest: vi.fn(async () => ({ research: RUN })) }));
const RUN = { id: "rr_1", status: "review", items: [
  { id: "f1", criterion: "financial", derive: "forecast", basis: "calculated", label: "12-month forecast", value: "Cash after 12 months: ₦1,200,000", working: ["Month 1: ₦100,000 in"] },
  { id: "t1", criterion: "team", kind: "question", label: "Team", question: "Who will deliver the plan?" }] };
const { NextSteps, useResearchRun } = await import("./ResultSummary");

const result = (research) => ({ assessment_type: "funding_readiness_initial", research, criteria: [], strengths: [],
  premium_next_action: { label: "Help me become funding-ready", explains: "" },
  blockers: [{ key: "financial", kind: "unknown", label: "No monthly forecast yet" }, { key: "team", kind: "unknown", label: "Who will deliver the plan is not recorded" }] });
const reviewed = vi.fn();
function Card({ r }) { const run = useResearchRun("ws1", r); return <NextSteps result={r} run={run} businessId="ws1" onDoIt={() => {}} onReview={reviewed} />; }
afterEach(cleanup);

describe("the next steps", () => {
  it("after research: the Agent's draft for each, or its one question, and no button of their own", async () => {
    render(<MemoryRouter><Card r={result({ state: "review", run_id: "rr_1", max: 60 })} /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // The draft in its card, with Adopt and Edit (the owner's QA, 21 Oct); the question in its own card, with Save.
    const financial = document.querySelector("[data-next-step='financial']");
    expect(financial.querySelector("[data-step-badge]").textContent).toBe("Draft ready");
    expect(financial.querySelector("[data-step-draft-line]").textContent).toBe("Draft ready: Cash after 12 months: ₦1,200,000");
    expect([...financial.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Adopt", "Edit", "Dismiss"]);
    // Edit opens an editor in the card, with Save and Cancel: never the spending modal or the research (the owner's QA, 21 Oct).
    await act(async () => { financial.querySelector("[data-step-edit]").click(); });
    expect(financial.querySelector("[data-step-editor]")).toBeTruthy();
    expect([...financial.querySelectorAll("[data-step-editor] button")].map((b) => b.textContent)).toEqual(["Save", "Cancel"]);
    expect(reviewed).not.toHaveBeenCalled();
    expect(document.querySelector("[data-premium-confirm]")).toBeNull();
    await act(async () => { financial.querySelector("[data-step-editor-cancel]").click(); });
    expect(financial.querySelector("[data-step-editor]")).toBeNull();
    expect(financial.querySelector("[data-step-mine]")).toBeNull();      // no "I'll do it" while the draft waits
    const team = document.querySelector("[data-next-step='team']");
    expect(team.querySelector("[data-step-question] label").textContent).toBe("Who will deliver the plan?");
    expect(document.querySelector("[data-step-do-it]")).toBeNull();
    expect(document.querySelector("[data-do-all]")).toBeNull();
  });

  it("before research: one button per step and one Do all for me, with its price", () => {
    render(<MemoryRouter><Card r={result({ state: "none", max: 60 })} /></MemoryRouter>);
    expect(document.querySelector("[data-step-do-it]")).toBeNull();      // no button on a card (the owner, 20 Oct)
    expect(document.querySelector("[data-do-all]").textContent).toBe("Do all for me · up to 60 credits")      // funding says its price (26 Oct);
    expect(screen.queryByText(/Help me become funding-ready/)).toBeNull();
  });
});

describe("the other steps (the owner, 20 Oct)", () => {
  it("are one press away, as cards with their drafts", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const r = { ...result({ state: "review", run_id: "rr_1", max: 60 }), blockers: ["purpose", "use_of_funds", "financial", "demand", "team"].map((key) => ({ key, kind: "unknown", label: key })) };
    render(<MemoryRouter><Card r={r} /></MemoryRouter>);
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(document.querySelectorAll("[data-next-step]").length).toBe(3);
    fireEvent.click(document.querySelector("[data-more-steps]"));
    expect(document.querySelectorAll("[data-next-step]").length).toBe(5);
    expect(document.querySelector("[data-next-step='team'] [data-step-question]")).toBeTruthy();
  });
});
