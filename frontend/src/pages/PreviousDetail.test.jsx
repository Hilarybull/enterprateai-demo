// What a thing from the previous funding need says, so Keep or Remove is decided on its content, not its title.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import * as client from "../api/client";
import { MemoryRouter } from "react-router-dom";
import { PreviousDetail, PreviousNeed } from "./ReadinessPage";

afterEach(cleanup);
const show = (value) => render(<MemoryRouter><PreviousDetail value={value} /></MemoryRouter>).container.textContent;

describe("the previous need's details", () => {
  it("shows a document's text", () => {
    expect(show({ content: "We are raising £1.2m to hire sales staff.", status: "draft" })).toBe("We are raising £1.2m to hire sales staff.");
    expect(show({ title: "Executive summary v1", text: "We wash cars." })).toBe("Title: Executive summary v1We wash cars.");
  });
  it("shows figures as labelled lines and leaves out internal keys", () => {
    const t = show({ location: "United Kingdom", customers: 40, id: "x1", updated_at: "2026-10-01" });
    expect(t).toContain("Location: United Kingdom");
    expect(t).toContain("Customers: 40");
    expect(t).not.toContain("x1");
  });
  it("never shows the record's own fields (ids, fingerprints, who reviewed it)", () => {
    const t = show({ reviewed: true, evidence_id: "58e2", reviewed_at: "2026-10-04", reviewed_by: "owner@x.test", facts_fingerprint: "921f" });
    expect(t).toBe("Only its title was saved with this, no other details.");
    expect(show({ title: "Executive summary v1", kind: "document", dated: "2026-10-01", checked: "Not checked yet" }))
      .toBe("Title: Executive summary v1Type: documentDated: 2026-10-01Checked: Not checked yet");
  });
  it("lists rows and says so when nothing was saved", () => {
    expect(show([{ item: "Vans", amount: 40000 }])).toContain("Item: Vans · Amount: 40000");
    expect(show({})).toBe("Only its title was saved with this, no other details.");
  });
});

describe("the previous need review", () => {
  const subject = { id: "f1", data: { previous_needs: [{ replaced_at: "2026-10-15", summary: "£1.2m equity",
    documents: { executive_summary: { preview: { title: "Executive summary v1", dated: "2026-10-01" } } }, evidence: [], set_aside: {}, review: {} }] } };
  it("is one line on the page and opens as a popup, with each item's details and Keep or Remove there", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ id: "f1" });
    const onChanged = vi.fn();
    const { container } = render(<MemoryRouter><PreviousNeed businessId="b1" subject={subject} onChanged={onChanged} /></MemoryRouter>);
    expect(container.querySelector("[data-previous-need-line]").textContent).toContain("1 thing from your previous funding need");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Executive summary" }));
    expect(screen.getByRole("dialog").textContent).toContain("Title: Executive summary v1");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith("/businesses/b1/funding-cases/f1/previous-need", "POST", { item: "document:executive_summary", keep: true });
    vi.restoreAllMocks();
  });
});
