// After a rename: the drafts still showing the old name are asked about; nothing changes until Update them.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { RenamedDrafts } from "./AccountPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const renamed = { from: "Apex Consulting Ltd", to: "Alchemy Test", drafts: [{ id: "a1", reference: "INV-1151026" }, { id: "a2", reference: "QUO-1141026" }] };

describe("the question after a rename", () => {
  it("asks first and updates only when told to", async () => {
    const call = vi.spyOn(client, "apiRequest").mockResolvedValue({ updated: ["INV-1151026", "QUO-1141026"], message: "Updated the sender on 2 drafts." });
    render(<MemoryRouter><RenamedDrafts workspaceId="w1" renamed={renamed} onDone={() => {}} /></MemoryRouter>);
    expect(document.querySelector("[data-renamed-drafts]").textContent).toContain("2 unsent drafts still show Apex Consulting Ltd as the sender (INV-1151026, QUO-1141026)");
    expect(call).not.toHaveBeenCalled();      // nothing changed unasked
    fireEvent.click(screen.getByRole("button", { name: "Update them" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Updated the sender on 2 drafts."));
    expect(call).toHaveBeenCalledWith("/businesses/w1/drafts/refresh-sender", "POST", { approval_ids: ["a1", "a2"] });
  });

  it("Leave them changes nothing", () => {
    const call = vi.spyOn(client, "apiRequest");
    const onDone = vi.fn();
    render(<MemoryRouter><RenamedDrafts workspaceId="w1" renamed={renamed} onDone={onDone} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Leave them" }));
    expect(onDone).toHaveBeenCalled() && expect(call).not.toHaveBeenCalled();
  });
});
