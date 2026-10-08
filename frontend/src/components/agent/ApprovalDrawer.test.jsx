// The dashboard's Needs Approval: each row is one clickable item that opens the approval in a
// drawer on the right (preview, Approve, Decline, Edit draft). Buttons that lead to an Agent
// task open it in the Agent box. Money fields show the currency sign.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentPanel, { NeedsApprovalPanel, taskIn } from "./AgentPanel";
import DraftEditor from "./DraftEditor";

const payload = { quote_id: "q1", reference: "QUO-12", company: "Apex", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP",
  items: [{ description: "Monthly bookkeeping", qty: 2, unit_price: 375 }], subtotal: 750, vat_rate: 20, vat_amount: 150, total: 900, valid_until: "2026-11-05", payment_terms: "Net 14 days" };
const approval = { id: "a1", status: "pending", tool_id: "send_quotation", title: "Send quotation QUO-12 to Frank", payload_version: 1, payload };
const OPTIONS = { document: "quotation", catalogue: [{ id: "p1", name: "Monthly bookkeeping", unit_price: 375 }], customers: [] };
const page = (approvals, run = {}) => ({ run: { id: "run-1", status: approvals.length ? "awaiting_approval" : "succeeded", workflow_key: "enquiry_to_quote", ...run },
  draft_options: OPTIONS, approvals, steps: [], step_attempts: [], history: [], can: { approve: true, edit_draft: true } });
const SUMMARY = { needs_approval_count: 2, needs_approval: [
  { approval_id: "a1", run_id: "run-1", kind: "quote", tool_id: "send_quotation", title: "Quote #QUO-12", subtitle: "Ready to send to Frank", age: "2m", payload },
  { approval_id: "a9", run_id: "run-9", kind: "receipt", tool_id: "send_receipt", title: "Receipt ready to send", subtitle: "INV-1 – Frank", age: "1h", payload: { amount: 300 } }] };

let calls;
let current;
beforeEach(() => {
  calls = [];
  current = page([approval]);
  localStorage.setItem("ea_token", "test");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    calls.push({ path, method: init.method || "GET" });
    if (/\/approve$/.test(path)) {
      current = page([], { summary: "Quotation QUO-12 was sent to frank@frank.test." });
      return new Response(JSON.stringify({ run: current.run, changed: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Where() { return <p data-testid="elsewhere">{useLocation().pathname}</p>; }
const mount = (onChanged = vi.fn()) => {
  render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
    <Route path="/dashboard" element={<NeedsApprovalPanel businessId="ws1" summary={SUMMARY} onChanged={onChanged} />} />
    <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  return onChanged;
};

describe("Needs Approval on the dashboard", () => {
  it("shows each approval as one clickable row with no Edit button", () => {
    mount();
    const list = screen.getByTestId("needs-approval-list");
    const rows = [...list.querySelectorAll("[data-approval-row]")];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tagName === "BUTTON")).toBe(true);
    expect(within(list).getAllByRole("button").length).toBe(2);                 // the rows themselves, nothing else to press
    expect(within(list).queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(rows[0].textContent).toContain("Quote #QUO-12");
    expect(rows[0].textContent).toContain("Ready to send to Frank");
    expect(rows[0].textContent).toContain("2m");
    expect(rows[0].querySelectorAll("svg").length).toBe(2);                     // the icon and the chevron
  });

  it("opens the approval in a drawer with the document, Approve, Decline and Edit draft, without leaving the page", async () => {
    const onChanged = mount();
    await act(async () => { fireEvent.click(screen.getByText("Quote #QUO-12").closest("button")); });
    const drawer = await screen.findByRole("dialog", { name: "Approval" });
    expect(drawer.className).toContain("max-w-[720px]");
    expect(drawer.className).toContain("max-h-full");                           // as tall as its content, never a full-height panel
    expect(drawer.className.split(" ")).not.toContain("h-full");
    expect(drawer.parentElement.className).toContain("items-start");
    expect(within(drawer).getByText("Send quotation QUO-12 to Frank")).toBeTruthy();      // the document preview
    const actions = drawer.querySelector("[data-drawer-actions]");
    expect(actions.className).toContain("sticky bottom-0");
    expect([...actions.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["See details", "Edit draft", "Decline", "Approve and send"]);
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    // Edit draft swaps the preview for the editor in the same drawer; Cancel comes back to the preview.
    fireEvent.click(within(drawer).getByRole("button", { name: "Edit draft" }));
    expect(within(screen.getByRole("dialog", { name: "Edit draft" })).getByRole("form", { name: "Edit draft" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(screen.getByRole("dialog", { name: "Approval" })).getByRole("button", { name: "Approve and send" })).toBeTruthy();
    // Approving from the drawer sends it and says so; the list is reloaded.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve and send" })); });
    expect(calls.some((c) => c.method === "POST" && /\/workflow-runs\/run-1\/approvals\/a1\/approve$/.test(c.path))).toBe(true);
    expect(await screen.findByText("Quotation QUO-12 was sent to frank@frank.test.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("money fields", () => {
  it("show the currency sign inside the Unit price field, and in the discount field when it is an amount", () => {
    const { container } = render(<DraftEditor approval={approval} options={OPTIONS} onCancel={() => {}} onSave={() => {}} />);
    const sign = (label) => screen.getByLabelText(label).parentElement.querySelector("[data-currency]");
    expect(sign("Unit price").textContent).toBe("£");
    expect(screen.getByLabelText("Unit price").className).toContain("pl-7");     // the figure starts after the sign
    expect(sign("Discount")).toBeNull();                                          // a percentage has no currency sign
    fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "amount" } });
    expect(sign("Discount").textContent).toBe("£");
    cleanup();
    render(<DraftEditor approval={{ ...approval, payload: { ...payload, currency: "USD" } }} options={OPTIONS} onCancel={() => {}} onSave={() => {}} />);
    expect(screen.getByLabelText("Unit price").parentElement.querySelector("[data-currency]").textContent).toContain("$");
    expect(container).toBeTruthy();
  });
});

describe("buttons that lead to an Agent task", () => {
  it("recognise a link to a task", () => {
    expect(taskIn("/agent/runs/18621706-aaaa")).toBe("18621706-aaaa");
    expect(taskIn("/agent/runs/abc?tab=plan")).toBe("abc");
    expect(taskIn("/agent")).toBeNull();
    expect(taskIn("/operations?tab=Sales")).toBeNull();
    expect(taskIn(undefined)).toBeNull();
  });

  it("open the task's dialog on the dashboard instead of its page ('Give the email address')", async () => {
    current = { run: { id: "run-5", status: "failed", reason_code: "invalid_customer_destination", workflow_key: "payment_followup",
      error: "Aftred has no email on record for INV-7. Add it and I'll prepare the reminder.", email_needed: { customer: "Aftred", reference: "INV-7" } }, approvals: [] };
    const summary = { needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 },
      suggestions: [{ key: "stuck", icon: "mail", tone: "amber", mood: "needs_you", text: "Aftred has no email on record for INV-7.", action: { to: "/agent/runs/run-5" } }] };
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
      <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} />} />
      <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText("Aftred has no email on record for INV-7.").closest("button")); });
    const dialog = await screen.findByRole("dialog", { name: "Aftred has no email on record for INV-7" });
    expect(within(dialog).getByLabelText("Email address for Aftred")).toBeTruthy();
    expect(screen.queryByTestId("elsewhere")).toBeNull();                         // still on the dashboard
    fireEvent.click(within(dialog).getByRole("button", { name: "See details" })); // the page opens only when asked for
    expect(screen.getByTestId("elsewhere").textContent).toBe("/agent/runs/run-5");
  });
});
