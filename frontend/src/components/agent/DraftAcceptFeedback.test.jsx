import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
let release;
vi.mock("../../api/client", () => ({ apiRequest: vi.fn(() => new Promise((r) => { release = r; })) }));
import { NeedsApprovalPanel } from "./AgentPanel";

afterEach(cleanup);

describe("Accept in Needs Approval says it is working at once (the owner, 25 Oct)", () => {
  it("a pending toast and Accepting… the moment it is pressed, then Accepted", async () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener("ea:toast", on);
    const summary = { needs_approval: [{ type: "draft", draft_id: "dr-1", title: "Business plan: Balcony Washing", to: "/blueprint?review=dr-1" }] };
    render(<MemoryRouter><NeedsApprovalPanel businessId="b1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Accept"));
    expect(seen[0]).toMatchObject({ kind: "pending", title: "Accepting Business plan: Balcony Washing…" });
    expect(screen.getByText("Accepting…")).toBeTruthy();
    await act(async () => { release({}); });
    await waitFor(() => expect(seen.some((t) => t.kind === "success" && t.id === seen[0].id)).toBe(true));      // the same toast, its result
    window.removeEventListener("ea:toast", on);
  });
});
