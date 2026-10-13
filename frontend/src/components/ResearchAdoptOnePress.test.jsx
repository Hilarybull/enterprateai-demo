import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResearchReview from "./ResearchReview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = { id: "rr_1", status: "ready", counts: { researched: 1, estimated: 0, reused: 0, calculated: 0, asked: 0, sources: 1 },
  items: [{ id: "r1", kind: "researched", label: "Comparable prices", value: "£40 to £60 an hour", used_for: "Comparable prices", sources: [] },
    { id: "r2", kind: "estimated", basis: "calculated", label: "Margin per sale", value: "£25", used_for: "Margin", working: ["£45 - £20 = £25"] }],
  figures: [{ key: "margin", label: "Margin per sale", value: "£25", working: ["£45 - £20 = £25"] }] };

describe("adopting the research", () => {
  it("is one press under the draft when there is nothing to answer: everything adopted, checked again", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ research: { ...run, status: "adopted", dataset_version: 1, before: { score: 30, evidence_coverage: 50 }, after: { score: 55, evidence_coverage: 80 } } }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const onAdopted = vi.fn();
    render(<ResearchReview businessId="ws1" run={run} onAdopted={onAdopted} />);
    fireEvent.click(screen.getByRole("button", { name: "Adopt all and check again" }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalled());
    expect(calls[0].url).toMatch(/\/businesses\/ws1\/research\/rr_1\/review$/);
    expect(calls[0].body).toEqual({ decisions: { r1: { decision: "accept" }, r2: { decision: "accept" } } });
    expect(document.querySelector("[data-score-change]").textContent).toBe("30 → 55");
  });
});
