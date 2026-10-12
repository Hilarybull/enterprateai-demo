// QA U3 (and U2): the whole Brightway quotation, walked as the owner does it in the Agent modal. The question is the
// one the server sends for "I need a quotation for a new customer called Brightway Ltd" with no default VAT rate
// (one dialog: the customer, the items, the extras and the VAT rate, with "Save as my default" beside it).
// The counter never goes up, VAT is asked once, and a VAT rate typed in words reaches the server as typed.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const SUMMARY = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 } };
const CATALOGUE = [{ id: "p1", name: "Office deep clean", unit_price: 150 }, { id: "p2", name: "Window clean", unit_price: 60 }];
const BRIGHTWAY = {
  question: "I found these customer details in the enquiry. Please confirm who the quotation is for.",
  fields: [
    { key: "customer_name", label: "Customer name", type: "text", required: true, default: "Brightway Ltd", hint: "Read from the enquiry text" },
    { key: "customer_email", label: "Customer email", type: "email", required: true, default: "" },
    { key: "items", label: "Items", type: "line_items", required: true, catalogue: CATALOGUE, suggested: [], vat_rate: null },
    { key: "discount", label: "Discount", type: "discount" },
    { key: "valid_until", label: "Valid until", type: "date", default: "2026-11-11" },
    { key: "notes", label: "Notes to the customer", type: "textarea" },
    { key: "vat_rate", label: "VAT rate (%)", type: "number", required: true, default: 0, hint: "Enter 0 if you don't charge VAT. Set a default in Agent settings to skip this question." },
    { key: "save_vat_default", label: "Save as my default VAT rate", type: "checkbox", default: false, companion_of: "vat_rate",
      hint: "You won't be asked again. Change it any time in Agent settings." },
  ],
};

let calls;
let inputReplies;
beforeEach(() => {
  calls = [];
  localStorage.setItem("ea_token", "test");
  sessionStorage.clear();
  useAuthStore.setState({ email: "ada@example.test" });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Apex", workspaceCompanyName: "Apex" });
  inputReplies = [{ run: { id: "run-bw", status: "awaiting_approval", workflow_key: "enquiry_to_quote", credits_used: 2 } }];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    calls.push({ path, method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const out = /\/agent\/requests$/.test(path)
      ? { kind: "workflow", run: { id: "run-bw", status: "running", workflow_key: "enquiry_to_quote", step: { index: 2, total: 5 }, pending_question: BRIGHTWAY } }
      : /\/input$/.test(path) ? inputReplies.shift() || {}
      : { run: { id: "run-bw" }, approvals: [{ status: "pending", tool_id: "send_quotation", payload: { reference: "QUO-31", total: 540, currency: "GBP" } }] };
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter initialEntries={["/dashboard"]}><AgentPanel businessId="ws1" summary={SUMMARY} onChanged={() => {}} /></MemoryRouter>);
const counter = (dialog) => dialog.querySelector("[data-step]")?.textContent || "";
const parse = (text) => { const m = /Question (\d+)(?: of (\d+))?/.exec(text); return m ? { n: Number(m[1]), of: m[2] ? Number(m[2]) : null } : null; };

describe("the Brightway quotation, start to finish (QA U3)", () => {
  it("the counter never goes up, VAT is asked once, and 'standard rate' is sent for the server to read", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "I need a quotation for a new customer called Brightway Ltd" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    const dialog = screen.getByRole("dialog", { name: "A few details" });
    const seen = [];      // every counter shown, and every question asked, in order
    const asked = [];
    const look = () => {
      seen.push(parse(counter(dialog)));
      asked.push(dialog.querySelector("[data-asks]")?.textContent || "");
    };
    const send = async () => { await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Send" })); }); };
    const skip = async () => { await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Skip" })); }); };

    look();
    expect(within(dialog).getByLabelText("Customer name").value).toBe("Brightway Ltd");
    await send();
    look();
    fireEvent.change(within(dialog).getByLabelText("Customer email"), { target: { value: "ops@brightway.test" } });
    await send();
    look();
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p1" } });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "3" } });
    await send();
    look();
    await skip();         // discount
    look();
    await send();         // valid until, filled in from Agent settings
    look();
    await skip();         // notes
    look();
    // U2: a number question is a text box with a number keypad, so words reach the server.
    const vat = within(dialog).getByLabelText("VAT rate (%)");
    expect(vat.getAttribute("type")).toBe("text");
    expect(vat.getAttribute("inputmode")).toBe("decimal");
    expect(dialog.querySelector('[data-companion="save_vat_default"]')).toBeTruthy();      // beside the VAT rate, not a question of its own
    fireEvent.change(vat, { target: { value: "standard rate" } });
    await send();

    // The counter: one total, fixed when the task first asked, and the number counting up through it.
    expect(seen.every(Boolean)).toBe(true);
    expect(seen.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const totals = seen.map((s) => s.of);
    expect(totals.every((t) => t !== null)).toBe(true);
    for (let i = 1; i < totals.length; i += 1) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    expect(totals[0]).toBe(7);
    // VAT asked once: one question about it, and no opening line saying it a second way.
    expect(asked.filter((q) => /VAT/i.test(q))).toEqual(["What VAT rate do you charge?"]);
    expect(dialog.isConnected ? dialog.querySelector("[data-opening]")?.textContent || "" : "").not.toMatch(/VAT/i);

    const answers = calls.filter((c) => c.method === "POST" && /\/input$/.test(c.path));
    expect(answers.length).toBe(1);      // one dialog, one answer
    expect(answers[0].body.answers ?? answers[0].body).toMatchObject({ customer_name: "Brightway Ltd", customer_email: "ops@brightway.test", vat_rate: "standard rate" });
    expect(screen.getByText(/Quotation QUO-31 for £540.00 is ready/)).toBeTruthy();
  });

  it("a question the task asks after all (an address refused) keeps counting on, never raising the total", async () => {
    const again = { run: { id: "run-bw", status: "running", workflow_key: "enquiry_to_quote", pending_question: {
      question: "I need an email address to send the quotation to Brightway Ltd.",
      fields: [{ key: "customer_email", label: "Customer email", type: "email", required: true }] } } };
    inputReplies = [again, { run: { id: "run-bw", status: "awaiting_approval", workflow_key: "enquiry_to_quote" } }];
    mount();
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "I need a quotation for a new customer called Brightway Ltd" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    let dialog = screen.getByRole("dialog", { name: "A few details" });
    const seen = [parse(counter(dialog))];
    const step = async (fn) => { fn?.(); await act(async () => { fireEvent.click(dialog.querySelector('button[type="submit"]')); }); };
    await step();
    fireEvent.change(within(dialog).getByLabelText("Customer email"), { target: { value: "ops@brightway.test" } });
    await step();
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p2" } });
    await step();
    for (let i = 0; i < 4; i += 1) {
      seen.push(parse(counter(dialog)));
      if (within(dialog).queryByLabelText("VAT rate (%)")) fireEvent.change(within(dialog).getByLabelText("VAT rate (%)"), { target: { value: "20%" } });
      await step();
    }
    dialog = screen.getByRole("dialog", { name: "A few details" });
    seen.push(parse(counter(dialog)));
    expect(seen.at(-1).n).toBe(8);                         // counted on from the seven already asked
    expect(seen.at(-1).of).toBeNull();                     // more than was planned: the "of" is dropped, not raised
    const totals = seen.map((s) => s.of).filter((t) => t !== null);
    for (let i = 1; i < totals.length; i += 1) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
  });
});
