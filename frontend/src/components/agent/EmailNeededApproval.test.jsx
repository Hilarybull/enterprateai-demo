// The owner's QA (15 Oct): a draft whose recipient has no email reaches Needs Approval; in the drawer the email is entered
// first, Approve and send stays off until it is a valid address, and Approve without sending keeps it unsent.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftDrawer } from "./DraftEditor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const RUN = { run: { id: "r1", status: "awaiting_approval", title: "New invoice" }, can: { approve: true, edit_draft: true },
  approvals: [{ id: "a1", status: "pending", tool_id: "send_invoice", payload: { reference: "INV-1151026", customer_name: "Ebe", to_email: "", total: 200, currency: "GBP",
    email_needed: { customer: "Ebe", reference: "INV-1151026" } } }] };

describe("an invoice with no email in the approval drawer", () => {
  it("asks for Ebe's email first and only then allows Approve and send", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ path: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
      const out = String(url).includes("approve-with-email") ? { run: { ...RUN.run, status: "succeeded" }, message: "Approved and sent." } : RUN;
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<DraftDrawer runId="r1" onClose={() => {}} startEditing={false} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector("[data-email-needed]").textContent).toContain("Ebe's email");
    const send = document.querySelector("[data-approve-and-send]");
    expect(send.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Approve without sending" })).toBeTruthy();
    const box = document.querySelector("[data-email-needed] input");
    fireEvent.change(box, { target: { value: "not an email" } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "ebe@example.test" } });
    expect(send.disabled).toBe(false);
    await act(async () => { fireEvent.click(send); await new Promise((r) => setTimeout(r, 20)); });
    const sent = calls.find((c) => c.path.includes("/approvals/a1/approve-with-email"));
    expect(sent.method).toBe("POST");
    expect(sent.body).toEqual({ email: "ebe@example.test" });
  });
});
