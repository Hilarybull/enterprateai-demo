// "Ask for what you need, then deliver the thing", on the dashboard: a new document's form opens
// in place with live totals, a record is saved with one confirmation, a "which one?" answer keeps
// what the question was about, and Agent settings list every capability.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import { QuestionForm } from "./AgentBits";
import { CapabilityTable } from "../../pages/AgentCentrePage";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const SUMMARY = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 } };
const CATALOGUE = [{ id: "p4", name: "Bookkeeping", unit_price: 300 }];
const invoiceForm = { question: "What should this invoice include?", fields: [
  { key: "start_from", label: "Start from", type: "choice", required: true, default: "new", options: [{ value: "new", label: "New invoice" }, { value: "q1", label: "From quotation QUO-12 · Frank · £900.00 (accepted)" }] },
  { key: "customer_id", label: "Customer", type: "customer", required: true, new_label: "+ New customer", show_if: { start_from: "new" }, options: [{ value: "c6", label: "QA Round Six Ltd", email: "qa@six.test" }] },
  { key: "customer_name", label: "Customer name", type: "text", required: true, show_if: { start_from: "new", customer_id: "new" } },
  { key: "customer_email", label: "Customer email", type: "email", required: true, show_if: { start_from: "new", customer_id: "new" } },
  { key: "items", label: "Items", type: "line_items", required: true, suggested: [], vat_rate: 20, catalogue: CATALOGUE, show_if: { start_from: "new" } }] };

let calls;
let replies;
beforeEach(() => {
  calls = [];
  replies = { request: {}, input: {}, run: {} };
  localStorage.setItem("ea_token", "test");
  sessionStorage.clear();
  useAuthStore.setState({ email: "ada@example.test" });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Apex", workspaceCompanyName: "Apex" });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    calls.push({ path, method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const out = /\/agent\/requests$/.test(path) ? (typeof replies.request === "function" ? replies.request(calls[calls.length - 1].body) : replies.request)
      : /\/input$/.test(path) ? replies.input : replies.run;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Where() { return <p data-testid="elsewhere">{useLocation().pathname}</p>; }
const mount = () => render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
  <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={SUMMARY} onChanged={() => {}} />} />
  <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
async function type(text) {
  fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}
const posts = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));

describe("a new document, asked for on the dashboard", () => {
  it("'I need a new invoice' opens one form in place: start from, customer, items with live totals; the draft lands in Needs Approval", async () => {
    replies.request = { kind: "workflow", run: { id: "run-i", status: "running", workflow_key: "new_invoice", step: { index: 1, total: 3, doing: "Matching the customer and pricing items…" }, pending_question: invoiceForm } };
    replies.input = { run: { id: "run-i", status: "awaiting_approval", workflow_key: "new_invoice", credits_used: 2 } };
    replies.run = { run: { id: "run-i" }, approvals: [{ status: "pending", tool_id: "send_invoice", payload: { reference: "INV-1071026", total: 720, currency: "GBP" } }] };
    mount();
    await type("I need a new invoice");
    const dialog = screen.getByRole("dialog", { name: "The Agent needs a few details" });
    expect(screen.queryByTestId("elsewhere")).toBeNull();                         // (f) no route change
    expect(within(dialog).getByText("New invoice")).toBeTruthy();                  // "Start from": New, or a quotation on record
    expect(within(dialog).getByText(/From quotation QUO-12/)).toBeTruthy();
    fireEvent.click(within(dialog).getByText("QA Round Six Ltd"));
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p4" } });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "2" } });
    const totals = dialog.querySelector("[data-line-totals]");
    expect([totals.querySelector("[data-subtotal]").textContent, totals.querySelector("[data-vat]").textContent, totals.querySelector("[data-total]").textContent])
      .toEqual(["£600.00", "£120.00", "£720.00"]);                                 // updated as it is typed, VAT from Agent settings
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(posts(/\/workflow-runs\/run-i\/input$/)[0].body.answers).toEqual({ start_from: "new", customer_id: "c6",
      items: [{ product_id: "p4", name: "", quantity: "2", unit_price: 300 }] });
    expect(await screen.findByText("Invoice INV-1071026 for £720.00 is ready. It's in Needs Approval.")).toBeTruthy();
    expect(screen.getByText("Used 2 credits.")).toBeTruthy();                      // every result shows the credits used
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it("choosing a quotation to start from hides everything a new invoice would need", async () => {
    replies.request = { kind: "workflow", run: { id: "run-i", status: "running", workflow_key: "new_invoice", pending_question: invoiceForm } };
    replies.input = { run: { id: "run-i", status: "awaiting_approval", workflow_key: "new_invoice" } };
    mount();
    await type("I need a new invoice");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText(/From quotation QUO-12/));
    expect(within(dialog).queryByLabelText("Search your customers")).toBeNull();
    expect(within(dialog).queryByLabelText("Item")).toBeNull();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(posts(/\/input$/)[0].body.answers).toEqual({ start_from: "q1" });
  });

  it("a fully specified request shows the result with no dialog at all", async () => {
    replies.request = { kind: "workflow", run: { id: "run-i", status: "awaiting_approval", workflow_key: "new_invoice", credits_used: 2 } };
    replies.run = { run: { id: "run-i" }, approvals: [{ status: "pending", tool_id: "send_invoice", payload: { reference: "INV-2", total: 600, currency: "GBP" } }] };
    mount();
    await type("invoice QA Round Six for 2 months bookkeeping");
    expect(await screen.findByText("Invoice INV-2 for £600.00 is ready. It's in Needs Approval.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("records and choices", () => {
  it("a record is shown for a yes and then saved, with the result in place", async () => {
    replies.request = { kind: "workflow", run: { id: "run-c", status: "running", workflow_key: "add_customer", pending_question: { question: "Is this right?", fields: [
      { key: "customer_name", label: "Customer name", type: "text", required: true, default: "Nova Labs", confirm: true },
      { key: "customer_email", label: "Email", type: "email", default: "dana@novalabs.test" }] } } };
    replies.input = { run: { id: "run-c", status: "succeeded", workflow_key: "add_customer", summary: "Saved: Nova Labs is now a customer.", credits_used: 0 } };
    mount();
    await type("add a customer called Nova Labs, dana@novalabs.test");
    const dialog = screen.getByRole("dialog", { name: "Is this right?" });
    expect(within(dialog).getByLabelText("Customer name").value).toBe("Nova Labs");      // filled in from the request, there to correct
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" })); });
    expect(await screen.findByText("Saved: Nova Labs is now a customer.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it("a date is asked for with a date field, filled in with the default", () => {
    render(<QuestionForm question="Which payment should I record?" onSubmit={() => {}} fields={[
      { key: "paid_at", label: "Date received", type: "date", required: true, default: "2026-10-01" }]} />);
    const field = screen.getByLabelText("Date received");
    expect(field.type).toBe("date");
    expect(field.value).toBe("2026-10-01");
  });

  it("the answer to 'which invoice?' keeps what the question was about (a reminder ahead of the due date)", async () => {
    replies.request = (body) => (body.params?.invoice_id
      ? { kind: "workflow", run: { id: "run-r", status: "awaiting_approval", workflow_key: "payment_followup" } }
      : { kind: "needs_input", capability: "payment_followup", message: "Nothing is overdue. Which invoice should I send a reminder for, ahead of its due date?", params: { upcoming: true },
          fields: [{ key: "invoice_id", label: "Invoice", type: "choice", required: true, options: [{ value: "i1", label: "INV-1 · QA Round Six Ltd · due 2026-10-06" }, { value: "i2", label: "INV-2 · BrightTech Ltd · due 2026-10-10" }] }] });
    replies.run = { run: { id: "run-r" }, approvals: [{ status: "pending", tool_id: "send_payment_reminder", payload: { invoice_reference: "INV-1", outstanding: 600, currency: "GBP" } }] };
    mount();
    await type("send a payment reminder");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText(/INV-1 · QA Round Six/));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    const second = posts(/\/agent\/requests$/)[1].body;
    expect(second.capability).toBe("payment_followup");
    expect(second.params).toEqual({ upcoming: true, invoice_id: "i1" });
    expect(await screen.findByText("Payment reminder for INV-1 (£600.00) is ready. It's in Needs Approval.")).toBeTruthy();
  });

  it("when nothing can be done yet, the one step that unblocks it is a button, not a dead end", async () => {
    replies.request = (body) => (body.capability === "new_invoice"
      ? { kind: "workflow", run: { id: "run-i", status: "running", workflow_key: "new_invoice", pending_question: invoiceForm } }
      : { kind: "answer", message: "Nothing is owed right now: every invoice is paid, so there is no one to remind.", actions: [{ label: "Start a new invoice", capability: "new_invoice" }] });
    mount();
    await type("send a payment reminder");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Start a new invoice" })); });
    expect(screen.getByRole("dialog", { name: "The Agent needs a few details" })).toBeTruthy();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });
});

describe("Agent settings", () => {
  it("lists every capability with its plan, credit cost and whether it starts by itself", () => {
    const { container } = render(<CapabilityTable items={{ invoice_overdue: false }} capabilities={[
      { capability: "new_invoice", title: "New Invoice", family: "Sell & Revenue", minimum_plan_label: "Starter", available: true, credits: "2 credits to prepare the invoice, 2 when it is sent", needs_approval: true, automatic: [] },
      { capability: "payment_followup", title: "Payment Follow-up", family: "Sell & Revenue", minimum_plan_label: "Starter", available: true, credits: "2 credits per reminder sent", needs_approval: true, automatic: [{ key: "invoice_overdue", label: "An invoice becomes overdue", on: true }] },
      { capability: "add_customer", title: "Add a Customer", family: "Business Operations", minimum_plan_label: "Starter", available: false, credits: "Free", needs_approval: false, automatic: [] }]} />);
    const row = (key) => container.querySelector(`[data-capability='${key}']`).textContent;
    expect(row("new_invoice")).toContain("New Invoice");
    expect(row("new_invoice")).toContain("Starter");
    expect(row("new_invoice")).toContain("2 credits to prepare the invoice, 2 when it is sent");
    expect(row("new_invoice")).toContain("Only when you ask");
    expect(row("new_invoice")).toContain("waits for your approval");
    expect(row("payment_followup")).toContain("Can, switched off above");      // follows the switch as it stands in the form
    expect(row("add_customer")).toContain("Free");
    expect(row("add_customer")).toContain("Starter (upgrade)");
    expect(container.querySelectorAll("[data-capability]").length).toBe(3);
  });
});

describe("every capability stays on the dashboard", () => {
  const FORM = { question: "A few details", fields: [{ key: "a", label: "First", type: "text", required: true, default: "x" }, { key: "b", label: "Second", type: "text", default: "" }] };
  const OUTGOING = ["enquiry_to_quote", "new_invoice", "quote_to_cash", "new_contract", "new_proposal", "new_purchase_order", "credit_note", "receipt_send", "payment_followup"];
  const RECORDS = ["record_payment", "record_expense", "supplier_bill", "add_customer", "add_vendor", "add_catalogue_item", "update_record", "marketplace_profile", "marketplace_offering"];
  const ANALYSES = ["scenario_help", "risk_concentration", "price_test", "capacity_check", "offer_review", "expansion_scenario", "funding_pack_draft",
    "registration_checklist", "launch_evidence_gaps", "readiness_refresh", "idea_validation", "market_size", "business_plan_draft"];
  const TOOL = { enquiry_to_quote: "send_quotation", new_invoice: "send_invoice", quote_to_cash: "send_invoice", new_contract: "send_contract", new_proposal: "send_proposal",
    new_purchase_order: "send_purchase_order", credit_note: "send_credit_note", receipt_send: "send_receipt", payment_followup: "send_payment_reminder" };

  it.each(OUTGOING)("%s: the form opens in place and the draft is confirmed in place, in Needs Approval", async (capability) => {
    replies.request = { kind: "workflow", run: { id: "run-x", status: "running", workflow_key: capability, pending_question: FORM } };
    replies.input = { run: { id: "run-x", status: "awaiting_approval", workflow_key: capability, credits_used: 2 } };
    replies.run = { run: { id: "run-x" }, approvals: [{ status: "pending", tool_id: TOOL[capability], payload: { reference: "REF-1", receipt_number: "REF-1", invoice_reference: "REF-1", total: 100, currency: "GBP" } }] };
    mount();
    await type("do it");
    const dialog = screen.getByRole("dialog", { name: "The Agent needs a few details" });
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(await screen.findByText(/is ready\. It's in Needs Approval\.$/)).toBeTruthy();
    expect(screen.getByText("Used 2 credits.")).toBeTruthy();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it.each(RECORDS)("%s: confirmed in the dialog, then 'Saved' in place", async (capability) => {
    replies.request = { kind: "workflow", run: { id: "run-x", status: "running", workflow_key: capability, pending_question: FORM } };
    replies.input = { run: { id: "run-x", status: "succeeded", workflow_key: capability, summary: "Saved: done.", credits_used: 0 } };
    mount();
    await type("do it");
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" })); });
    expect(await screen.findByText("Saved: done.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it.each(ANALYSES)("%s: the answer comes back in place with its figures, next step and credits", async (capability) => {
    replies.request = { kind: "workflow", run: { id: "run-x", status: "succeeded", workflow_key: capability, summary: "Monthly net goes from £900 to £1,020.",
      next_action: "I'll work it out again next month.", credits_used: 2 } };
    mount();
    await type("do it");
    expect(await screen.findByText("Monthly net goes from £900 to £1,020.")).toBeTruthy();
    expect(screen.getByText("I'll work it out again next month. Used 2 credits.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See details" })).toBeTruthy();      // the full result is one click away, never forced
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });
});

describe("the from-scratch form's extras", () => {
  it("a discount is optional, comes off the live total before VAT, and is sent only when given", () => {
    const sent = vi.fn();
    const { container } = render(<QuestionForm question="What should this invoice include?" onSubmit={sent} fields={[
      { key: "items", label: "Items", type: "line_items", required: true, vat_rate: 20, catalogue: [{ id: "p4", name: "Bookkeeping", unit_price: 300 }],
        suggested: [{ product_id: "p4", name: "Bookkeeping", quantity: 2, unit_price: 300 }] },
      { key: "discount", label: "Discount", type: "discount" },
      { key: "due_date", label: "Due date", type: "date", default: "2026-10-15" },
      { key: "notes", label: "Notes on the invoice", type: "textarea" }]} />);
    const total = () => container.querySelector("[data-line-totals] [data-total]").textContent;
    expect(total()).toBe("£720.00");
    expect(container.querySelector("[data-line-totals] [data-discount]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(sent.mock.calls[0][0]).toEqual({ items: [{ product_id: "p4", name: "", quantity: 2, unit_price: 300 }], due_date: "2026-10-15" });      // nothing extra had to be typed
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    expect(container.querySelector("[data-line-totals] [data-discount]").textContent).toBe("-£60.00");
    expect(total()).toBe("£648.00");                                              // (600 - 60) + 20%
    fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "amount" } });
    expect(total()).toBe("£708.00");                                              // (600 - 10) + 20%
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(sent.mock.calls[1][0].discount).toEqual({ type: "amount", value: 10 });
  });
});
