// §1: an accepted figure saved to an empty Catalogue field can be undone; a different value is asked about, two ways.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordSync } from "./ResearchReview";

afterEach(cleanup);
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("RecordSync", () => {
  it("says what was saved, with Undo, and asks about a different value", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => { calls.push([String(url), init?.method, init?.body]); return json(String(url).includes("undo") ? { undone: true } : { changed: false }); });
    render(<RecordSync businessId="ws1" runId="rr1" sync={{
      saved: [{ field: "cost", record: "Catalogue", name: "Dog grooming", value: 15, undo_id: "u1", message: "Saved to your Catalogue: Dog grooming cost per sale 15.00." }],
      conflicts: [{ field: "price", record: "Catalogue", question: "Update your Catalogue price for Dog grooming from 60.00 to 65.00, or use 65.00 for this launch only?" }] }} />);
    expect(screen.getByText(/Saved to your Catalogue/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(calls[0][0]).toContain("/businesses/ws1/record-changes/u1/undo");
    expect(screen.getByText(/Undone: Dog grooming is back as it was/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "This case only" })); });
    expect(JSON.parse(calls[1][2])).toEqual({ field: "price", choice: "case_only" });
    expect(screen.getByRole("status").textContent).toContain("unchanged");
  });
});
