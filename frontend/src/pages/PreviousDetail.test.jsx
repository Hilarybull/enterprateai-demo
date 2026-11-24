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
    documents: { executive_summary: { preview: { title: "Executive summary v1", dated: "2026-10-01", text: "We wash cars." } } }, evidence: [], set_aside: {}, review: {} }] } };
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
    expect(call).toHaveBeenCalledWith("/businesses/b1/funding-cases/f1/previous-need", "POST", { item: "document:executive_summary", keep: true, need: 0 });
    vi.restoreAllMocks();
  });
});

describe("replaced more than once", () => {
  it("lists what is still to review from every earlier need, grouped, and keeps the right one", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ id: "f1" });
    const subject = { id: "f1", data: { previous_needs: [
      { replaced_at: "2026-10-15", summary: "£250k loan", set_aside: { traction: { summary: "40 paying customers" } }, documents: {}, evidence: [], review: {} },
      { replaced_at: "2026-10-15", summary: "£1.2m equity", set_aside: { market: { location: "UK" } }, evidence: [],
        documents: { forecast: { preview: { title: "Forecast v1", text: "12 months of figures." } }, team_summary: {}, pitch: { preview: { title: "Pitch v1" } } }, review: { "document:team_summary": "removed" } }] } };
    render(<MemoryRouter><PreviousNeed businessId="b1" subject={subject} onChanged={vi.fn()} /></MemoryRouter>);
    expect(document.querySelector("[data-previous-need-line]").textContent).toContain("3 things from your previous funding need");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const groups = [...document.querySelectorAll("[data-previous-group]")].map((g) => g.textContent);
    expect(groups[0]).toContain("£250k loan") && expect(groups[0]).toContain("Traction");
    expect(groups[1]).toContain("£1.2m equity") && expect(groups[1]).toContain("Forecast") && expect(groups[1]).toContain("Market details");
    expect(groups[1]).not.toContain("Team summary");      // already removed
    expect(document.querySelector("[data-empty-previous]").textContent).toContain("1 more had only a title saved (Pitch): nothing to review.");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Forecast" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("/businesses/b1/funding-cases/f1/previous-need", "POST", { item: "document:forecast", keep: true, need: 1 }));
    vi.restoreAllMocks();
  });
});

describe("items with only a title saved", () => {
  it("are not asked about one by one: one line says so, and one press clears them", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ id: "f1" });
    const subject = { id: "f1", data: { previous_needs: [{ replaced_at: "2026-10-15", summary: "£1.2m equity", set_aside: {}, evidence: [], review: {},
      documents: { forecast: { preview: { title: "Forecast v1", dated: "2026-10-01" } }, team_summary: { preview: { reviewed_on: "2026-10-04" } } } },
      { replaced_at: "2026-10-15", summary: "£250k loan", set_aside: { traction: { summary: "No traction yet" } }, documents: {}, evidence: [], review: {} }].reverse() } };
    const onChanged = vi.fn();
    render(<MemoryRouter><PreviousNeed businessId="b1" subject={subject} onChanged={onChanged} /></MemoryRouter>);
    expect(document.querySelector("[data-previous-need-line]").textContent).toContain("3 things from your previous funding need had only a title saved: nothing to review.");
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear them" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(call.mock.calls.map((c) => c[2])).toEqual([{ item: "traction", keep: false, need: 0 }, { item: "document:forecast", keep: false, need: 1 },
      { item: "document:team_summary", keep: false, need: 1 }]);      // "No traction yet" says nothing to keep
    vi.restoreAllMocks();
  });
});
