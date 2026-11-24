import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
vi.mock("../api/client", () => ({ apiRequest: vi.fn(async () => ({})) }));
import { NextSteps } from "./ResultSummary";

afterEach(cleanup);

describe("steps only the owner can decide (the owner, 25 Oct)", () => {
  const owners = [{ key: "goal.title", title: "Your title says £50,000 but your target is £45,000", ownerOnly: true, field: true },
    { key: "confirm.docs", title: "Mark as reviewed: Business plan", review: ["business_plan"], field: true }];
  it("never offers Do all for me beside title vs target and mark reviewed alone", () => {
    render(<MemoryRouter><NextSteps result={{ assessment_type: "funding_readiness_initial", case_steps: owners }} onDoIt={() => {}} /></MemoryRouter>);
    expect(document.querySelector("[data-do-all]")).toBeNull();
  });
  it("still offers it when a step the Agent can draft is there too", () => {
    const steps = [...owners, { key: "market.differentiation", title: "Say what sets you apart", field: true }];
    render(<MemoryRouter><NextSteps result={{ assessment_type: "funding_readiness_initial", case_steps: steps }} onDoIt={() => {}} /></MemoryRouter>);
    expect(document.querySelector("[data-do-all]")).not.toBeNull();
  });
  it("the AI drafts card says Review them and Accept all (the owner, 25 Oct)", () => {
    const step = { key: "agent.drafts", kind: "unknown", badge: "Draft ready", field: true, title: "Review 4 AI drafts", why: "Do all for me drafted these for you.",
      seeLabel: "Review them", to: "/funding/c1?tab=answers&field=purpose", run: { label: "Accept all", doneLabel: "Accepted", go: () => {} } };
    render(<MemoryRouter><NextSteps result={{ assessment_type: "funding_readiness_initial", case_steps: [step] }} /></MemoryRouter>);
    expect(document.body.textContent).toContain("Review 4 AI drafts");
    expect(document.body.textContent).toContain("Review them");
    expect(document.body.textContent).toContain("Accept all");
  });
});
