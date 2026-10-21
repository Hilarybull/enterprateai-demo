// The result's buttons do the work: a task button starts that task (with what the check was told), and after adopting,
// the card says so, offers the funding pack first and no longer offers the research again. Where the case kept its own
// figure, the review says so and lets the owner use the review's.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "/agent/requests") return { kind: "workflow", run: { id: "run-1" } };
    if (path.includes("/agent/price/")) return { capability: path.split("/").pop(), title: "Business Plan Draft", credits: 40 };
    if (path.endsWith("/use-figures")) return { assessment: { kind: "funding", assessment_id: "a2", classification: "insufficient_evidence" } };
    return {};
  }),
}));
vi.mock("../store/workspace", () => ({ useWorkspaceStore: (pick) => pick({ workspaceId: "W1" }) }));

import FirstValueCard from "./FirstValueCard";
import ResearchReview from "./ResearchReview";

afterEach(() => { cleanup(); calls.length = 0; });
const adopted = { assessment_type: "funding_readiness_initial", headline: "Funding readiness", score: 52, evidence_coverage: 70, currency_sign: "£",
  strengths: [], blockers: [], metrics: [], premium_next_action: null, adopted: { version: 3 },
  free_next_actions: [{ label: "Draft my funding pack", capability: "funding_pack_draft" },
    { label: "Write a business plan", capability: "business_plan_draft", params: { answers: { description: "AI adoption framework" } } }] };

describe("the result's next steps", () => {
  it("after adopting: says so, offers the funding pack once, and never the research again", () => {
    render(<MemoryRouter><FirstValueCard result={adopted} /></MemoryRouter>);
    // No version labels on the main view (the owner's brief, 17 Oct); History keeps them.
    expect(document.querySelector("[data-fv-adopted]")).toBeNull();
    expect(document.querySelector("[data-fv-premium]")).toBeNull();
    // One pack button (the owner's QA, 21 Oct): the pack line's, never a second in the footer.
    expect([...document.querySelectorAll("[data-fv-actions] button")].some((b) => /funding pack/i.test(b.textContent))).toBe(false);
  });

  it("a task button starts the task with what the check was told", async () => {
    render(<MemoryRouter><FirstValueCard result={adopted} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Write a business plan" }));
    // F-7: its price first ("Write a business plan. 40 credits."); nothing is asked of the Agent, so nothing is held, until Start.
    await waitFor(() => expect(document.querySelector("[data-price-confirm]")).toBeTruthy());
    expect(document.querySelector("[data-price-line]").textContent).toBe("Write a business plan. 40 credits.");
    expect(calls.some((c) => c.path === "/agent/requests")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(document.querySelector("[data-fv-started]")).toBeTruthy());
    expect(calls.find((c) => c.path === "/agent/requests").body).toMatchObject({ business_id: "W1", capability: "business_plan_draft", params: { answers: { description: "AI adoption framework" } } });
  });
});

describe("a figure the funding case already holds", () => {
  it("is said, and the owner can use the review's instead", async () => {
    const run = { id: "rr_1", status: "adopted", context: { currency: "GBP" }, dataset_version: 2, before: {}, after: {}, items: [],
      assessment: { kind: "funding", assessment_id: "a1", classification: "insufficient_evidence", reactivated: "£25,000 for marketing",
        differences: [{ field: "price", label: "price per sale", case_value: "60", review_value: 65 }] } };
    render(<ResearchReview businessId="W1" run={run} />);
    expect(document.querySelector("[data-case-reactivated]").textContent).toContain("£25,000 for marketing");
    expect(document.querySelector("[data-case-difference=price]").textContent).toContain("£60 a sale");
    fireEvent.click(screen.getByRole("button", { name: "Use £65 a sale in the case" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("now uses £65 a sale"));
    expect(calls.at(-1)).toMatchObject({ path: "/businesses/W1/assessment/funding/use-figures", body: { figures: { price: 65 } } });
  });
});
