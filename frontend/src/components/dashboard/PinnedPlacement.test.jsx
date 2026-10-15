// Pinned on the dashboard (the owner's QA, 15 Oct): never the result card's case twice (the result card carries the pin);
// one other pinned case is a full-width strip; three are cards on the stage cards' grid.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import FirstResultPanel from "../FirstResultPanel";
import PinnedCards, { usePinned } from "./PinnedCards";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const RESULT = { assessment_type: "funding_readiness_initial", headline: "Funding readiness", score: 30, evidence_coverage: 25, band: "Not ready yet",
  key_numbers: [], gaps: { failed: [], early: [], unknown: [] }, strengths: [], blockers: [], metrics: [], criteria: [], free_next_actions: [], premium_gate: { allowed: true },
  assessment: { assessment_id: "as1", kind: "funding", case_id: "fc1", title: "Pay for new office", classification: "not_ready", score: null, evidence_coverage: 40 } };
const item = (id, title) => ({ id, kind: "funding", label: `Funding readiness · ${title}`, score: null, verdict: "Not ready to approach funders yet",
  pack: { ready: 1, total: 2 }, open: `/funding/${id}?tab=results` });

// The dashboard's own wiring, in small.
function Dashboard() {
  const pinned = usePinned("b1");
  return (
    <MemoryRouter>
      <FirstResultPanel firstResult={{ result: RESULT, premium: vi.fn(), dismiss: vi.fn(), saveForLater: vi.fn() }}
        pinned={pinned.isPinned("fc1") ? { onUnpin: () => pinned.unpin(pinned.items.find((x) => x.id === "fc1")) } : null} />
      <PinnedCards pinned={pinned} excludeId="fc1" />
    </MemoryRouter>
  );
}
const serve = (items) => vi.spyOn(client, "apiRequest").mockImplementation(async (path, method) => (method === "GET" ? { items, more: 0 } : {}));

describe("pinned items on the dashboard", () => {
  it("the same case as the result card is one card, with the filled pin; unpinning keeps the result card", async () => {
    const call = serve([item("fc1", "Pay for new office · £250k loan")]);
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelector("[data-result-pin]")).toBeTruthy());
    expect(container.querySelector("[data-pinned]")).toBeNull();
    expect(container.querySelector("[data-result-title]").textContent).toBe("Funding readiness · Pay for new office");      // the purpose, by name
    expect(container.querySelectorAll("[data-first-result-panel]").length).toBe(1);
    await act(async () => { fireEvent.click(container.querySelector("[data-result-pin]")); });
    expect(call).toHaveBeenCalledWith("/businesses/b1/pinned/fc1/unpin", "POST", {});
    expect(container.querySelector("[data-first-result-panel]")).toBeTruthy();
  });

  it("one other pinned case is a full-width strip: label, status, then the buttons and the pin", async () => {
    serve([item("fc2", "Second site · £80k equity")]);
    const { container } = render(<Dashboard />);
    const strip = await waitFor(() => { const el = container.querySelector("[data-pinned-layout='strip'] [data-pinned-card='fc2']"); expect(el).toBeTruthy(); return el; });
    expect(container.querySelector("[data-result-pin]")).toBeNull();
    expect(strip.textContent).toContain("Pinned ·Funding readiness · Second site · £80k equity");
    expect(strip.querySelector("[data-pinned-score]").textContent).toBe("No score yet · Not ready to approach funders yet · Pack 1 of 2");
    expect(strip.className).toContain("min-h-[72px]");
    expect([...strip.querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["Open funding case", "Run the check again", "Unpin"]);
    expect(strip.textContent).not.toMatch(/[–—]/);
  });

  it("three pinned cards sit on the stage cards' grid, with no empty half-row; more show View all", async () => {
    serve([item("a", "A"), item("b", "B"), item("c", "C"), item("d", "D"), item("fc1", "Result")]);
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll("[data-pinned-grid] [data-pinned-card]").length).toBe(3));
    const grid = container.querySelector("[data-pinned-grid]");
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");
    expect(grid.children[2].className).toContain("md:col-span-2");
    expect(screen.getByRole("button", { name: "View all pinned (4)" })).toBeTruthy();      // the result card's case is not counted
  });
});
