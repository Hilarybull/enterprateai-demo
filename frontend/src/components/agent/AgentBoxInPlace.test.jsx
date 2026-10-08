// A task started from the Agent box or the chat stays on the page: questions open in a dialog,
// what it prepares is confirmed in a line and lands in Needs Approval, and nothing changes the route.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import BusinessAssistant from "../BusinessAssistant";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const QUESTION = { question: "Who is this quotation for, and what should it include?", fields: [
  { key: "customer_id", label: "Customer", type: "customer", required: true, new_label: "+ New customer",
    options: [{ value: "c1", label: "QA Round Six Ltd", email: "qa@six.test" }, { value: "c2", label: "Frank", email: "frank@frank.test" }] },
  { key: "customer_name", label: "Customer name", type: "text", required: true, default: "", show_if: { customer_id: "new" } },
  { key: "customer_email", label: "Customer email", type: "email", required: true, default: "", show_if: { customer_id: "new" } },
  { key: "items", label: "Items", type: "line_items", required: true, suggested: [],
    catalogue: [{ id: "p1", name: "Strategy Workshop", unit_price: 1500 }, { id: "p4", name: "Bookkeeping", unit_price: 200 }] }] };
const asking = { id: "run-q", status: "running", substatus: "waiting_for_information", workflow_key: "enquiry_to_quote",
  step: { index: 2, total: 5, title: "Match the customer" }, pending_question: QUESTION };
const ready = { id: "run-q", status: "awaiting_approval", workflow_key: "enquiry_to_quote", summary: "Prepared draft quotation QUO-12.", credits_used: 1 };
const READY_TEXT = "Quotation QUO-12 for £480.00 is ready. It's in Needs Approval.";

let calls;
let started;      // what /agent/requests answers
let reads;        // what GET /workflow-runs/run-q answers, in order (the last repeats)

beforeEach(() => {
  calls = [];
  started = { kind: "workflow", run: asking };
  reads = [{ run: ready, approvals: [{ id: "a1", status: "pending", tool_id: "send_quotation", payload: { reference: "QUO-12", total: 480, currency: "GBP" } }] }];
  localStorage.setItem("ea_token", "test");
  sessionStorage.clear();
  useAuthStore.setState({ email: "ada@example.test" });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Apex", workspaceCompanyName: "Apex" });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    const method = init.method || "GET";
    calls.push({ path, method, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    let out = {};
    if (/\/agent\/requests$/.test(path)) out = started;
    else if (/\/workflow-runs\/run-q\/input$/.test(path)) out = { run: ready };
    else if (/\/workflow-runs\/run-q$/.test(path)) out = reads.length > 1 ? reads.shift() : reads[0];
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const SUMMARY = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 } };
function Where() { return <p data-testid="elsewhere">{useLocation().pathname}</p>; }
function mount(onChanged = vi.fn(), summary = SUMMARY) {
  const tree = (s) => (<MemoryRouter initialEntries={["/dashboard"]}><Routes>
    <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={s} onChanged={onChanged} />} />
    <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  const view = render(tree(summary));
  return { onChanged, show: (s) => view.rerender(tree(s)) };
}
async function type(text) {
  fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}
const onTheDashboard = () => screen.queryByTestId("elsewhere") === null && screen.getByLabelText("Ask the EnterprateAI Agent");
const posts = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));

describe("the Agent box keeps the owner on the dashboard", () => {
  it("'need a quotation' opens the question in place; customer and items answered, the draft is confirmed and is in Needs Approval", async () => {
    const { onChanged } = mount();
    await type("need a quotation");
    const dialog = screen.getByRole("dialog", { name: "The Agent needs a few details" });
    expect(onTheDashboard()).toBeTruthy();                                // no route change
    expect(dialog.querySelector("[data-step]").textContent).toBe("Step 2 of 5");
    expect(within(dialog).getByText(QUESTION.question)).toBeTruthy();
    // Customers on record, searchable, with "+ New customer"; a new customer's fields only once chosen.
    expect(within(dialog).getByLabelText("Search your customers")).toBeTruthy();
    expect(within(dialog).queryByText("Customer email")).toBeNull();
    fireEvent.click(within(dialog).getByLabelText("+ New customer"));
    expect(within(dialog).getByText("Customer email")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Search your customers"), { target: { value: "fra" } });
    expect(within(dialog).queryByText("QA Round Six Ltd")).toBeNull();
    fireEvent.click(within(dialog).getByText("Frank"));
    expect(within(dialog).queryByText("Customer email")).toBeNull();
    // The catalogue item brings its price, which stays editable; "+ Other item" is offered.
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p4" } });
    expect(within(dialog).getByLabelText("Unit price").value).toBe("200");
    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "2" } });
    expect(within(dialog).getByRole("button", { name: "+ Other item" })).toBeTruthy();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(posts(/\/workflow-runs\/run-q\/input$/)[0].body).toEqual({ background: true, answers: { customer_id: "c2",
      items: [{ product_id: "p4", name: "", quantity: "2", unit_price: 200 }] } });
    expect(posts(/\/agent\/requests$/)[0].body.background).toBe(true);      // started by the server, watched here
    expect(await screen.findByText(READY_TEXT)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChanged).toHaveBeenCalled();                                 // Needs Approval reloads at once
    expect(onTheDashboard()).toBeTruthy();
    // The task's page opens only when the owner asks for it.
    fireEvent.click(screen.getByRole("button", { name: "See details" }));
    expect(screen.getByTestId("elsewhere").textContent).toBe("/agent/runs/run-q");
  });

  it("'quote Frank for 2 months bookkeeping' needs no questions: the confirmation appears straight away", async () => {
    started = { kind: "workflow", run: ready };
    mount();
    await type("quote Frank for 2 months bookkeeping");
    expect(await screen.findByText(READY_TEXT)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(/\/input$/).length).toBe(0);
    expect(onTheDashboard()).toBeTruthy();
  });

  it("the Agent card is the same Agent as on the homepage: the shared shell, its turning border and its dark panel", () => {
    mount();
    const card = screen.getByRole("region", { name: "EnterprateAI Agent" });
    expect(card.hasAttribute("data-agent-shell")).toBe(true);
    for (const cls of ["m-agent-card", "rounded-2xl", "p-[2px]", "overflow-hidden", "shadow-[0_20px_60px_rgba(108,92,231,0.25)]"]) expect(card.className.split(" ")).toContain(cls);
    expect(card.querySelector(":scope > .m-agent-border").getAttribute("aria-hidden")).toBe("true");
    const panel = card.querySelector(":scope > [data-agent-panel]");
    for (const cls of ["rounded-[14px]", "bg-gradient-to-br", "from-[#1e1b4b]", "via-[#312e81]", "to-[#4c1d95]"]) expect(panel.className.split(" ")).toContain(cls);
    // Who it is, as on the homepage: the avatar, the name in white, "Online" in words, and the subtitle at 70% white.
    const who = card.querySelector("[data-agent-identity]");
    expect(who.querySelector("[data-agent-avatar]").style.width).toBe("32px");
    expect(who.querySelector("h2").textContent).toBe("EnterprateAI AgentOnline");
    expect(who.querySelector("h2").className).toContain("text-white");
    expect(who.querySelector("[data-agent-subtitle]")).toBeNull();          // on the dashboard the greeting and the briefing take the subtitle's place
    expect(card.querySelector("[data-agent-greeting]").className).toMatch(/\btext-lg\b.*\bsm:text-xl\b/);
    expect(card.querySelector("[data-agent-greeting] span").className).toContain("truncate");      // one line, cut short at the card's width
    for (const cls of ["text-white/75", "line-clamp-2", "lg:line-clamp-1"]) expect(card.querySelector("[data-agent-briefing]").className.split(" ")).toContain(cls);
    // The field is white on the panel, with the solid brand Send button.
    const field = card.querySelector("[data-agent-field]");
    for (const cls of ["bg-white", "border-white"]) expect(field.className.split(" ")).toContain(cls);
    expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-brand-600");
    expect(card.hasAttribute("data-m-idle")).toBe(true);                    // the border rests when the card is off screen or the tab is hidden
    expect(card.className).not.toContain("border-slate-200");
  });

  it("Discard this request cancels the task, so it does not sit in Needs You", async () => {
    const { onChanged } = mount();
    await type("quote for QA Round Six");
    const dialog = screen.getByRole("dialog");
    onChanged.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /^Discard this request/ })); });
    expect(posts(/\/workflow-runs\/run-q\/cancel$/).length).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Discarded. Nothing was sent.")).toBeTruthy();
    expect(screen.queryByText(/I've kept that waiting for your answer/)).toBeNull();
    expect(onChanged).toHaveBeenCalled();
    expect(onTheDashboard()).toBeTruthy();
  });

  it("keeps the dialog open for the next question, and Cancel leaves the task waiting as a tile", async () => {
    const next = { ...asking, step: { index: 4, total: 5 }, pending_question: { question: "What VAT rate should this quotation use?",
      fields: [{ key: "vat_rate", label: "VAT rate (%)", type: "number", required: true, default: 0 }] } };
    globalThis.fetch.mockImplementation(async (url, init = {}) => {
      calls.push({ path: String(url), method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      const out = /\/agent\/requests$/.test(String(url)) ? started : /\/input$/.test(String(url)) ? { run: next } : {};
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { onChanged, show } = mount();
    await type("need a quotation");
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Frank"));
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p1" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    dialog = screen.getByRole("dialog", { name: "The Agent needs one thing from you" });      // same place, next question
    expect(within(dialog).getByText("What VAT rate should this quotation use?")).toBeTruthy();
    expect(dialog.querySelector("[data-step]").textContent).toBe("Step 4 of 5");
    onChanged.mockClear();
    // Cancel asks what should happen to the request, and "Keep for later" leaves it waiting.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const choice = within(dialog).getByRole("group", { name: "What should happen to this request?" });
    expect(within(choice).getAllByRole("button").map((b) => b.textContent.replace(/(Keep for later|Discard this request).*/, "$1"))).toEqual(["Keep for later", "Discard this request", "Back to the form"]);
    fireEvent.click(within(choice).getByRole("button", { name: "Back to the form" }));
    expect(within(dialog).queryByRole("group", { name: "What should happen to this request?" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Keep for later/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(/\/input$/).length).toBe(1);                              // nothing more was answered
    expect(posts(/\/cancel$/).length).toBe(0);                             // and nothing was cancelled
    expect(screen.getByText(/I've kept that waiting for your answer/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(onTheDashboard()).toBeTruthy();
    // The reloaded card shows it as a tile, which opens the same question again.
    const question = { run_id: "run-q", ...next.pending_question };
    show({ ...SUMMARY, suggestions: [{ key: "question:run-q", icon: "chat", tone: "amber", mood: "needs_you", text: "What VAT rate should this quotation use?", question, action: { run_id: "run-q" } }] });
    fireEvent.click(screen.getByText("What VAT rate should this quotation use?").closest("button"));
    expect(within(screen.getByRole("dialog")).getByText("VAT rate (%)")).toBeTruthy();
  });

  it("says 'Working on it…' in place while a task is running, then gives the result", async () => {
    vi.useFakeTimers();
    started = { kind: "workflow", run: { id: "run-q", status: "running", workflow_key: "enquiry_to_quote", step: { index: 2, total: 5, doing: "Matching the customer…" } } };
    reads = [{ run: { id: "run-q", status: "running", workflow_key: "enquiry_to_quote", step: { index: 4, total: 5, doing: "Drafting the quotation…" } } }, reads[0]];
    mount();
    await type("need a quotation for Frank");
    expect(screen.getByText("Working on it… Matching the customer…")).toBeTruthy();      // the step, not only a spinner
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("Working on it… Drafting the quotation…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText(READY_TEXT)).toBeTruthy();
    expect(onTheDashboard()).toBeTruthy();
  });

  it("shows a task that needs attention with its reason and the input it needs, in the same dialog", async () => {
    started = { kind: "workflow", run: { id: "run-q", status: "failed", reason_code: "invalid_customer_destination", workflow_key: "payment_followup",
      error: "Aftred has no email on record for INV-7. Add it and I'll prepare the reminder.", email_needed: { customer: "Aftred", reference: "INV-7" } } };
    globalThis.fetch.mockImplementation(async (url, init = {}) => {
      calls.push({ path: String(url), method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      const out = /\/agent\/requests$/.test(String(url)) ? started
        : /\/customer-email$/.test(String(url)) ? { run: { id: "run-q", status: "awaiting_approval", workflow_key: "payment_followup" } }
        : { run: {}, approvals: [{ status: "pending", tool_id: "send_payment_reminder", payload: { invoice_reference: "INV-7", outstanding: 149, currency: "GBP" } }] };
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    mount();
    await type("chase INV-7");
    const dialog = screen.getByRole("dialog", { name: "Aftred has no email on record for INV-7" });
    expect(within(dialog).getByText(/Add it and I'll prepare the reminder\./)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Email address for Aftred"), { target: { value: "pay@aftred.test" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save and carry on" })); });
    expect(posts(/\/workflow-runs\/run-q\/customer-email$/)[0].body).toEqual({ email: "pay@aftred.test" });
    expect(await screen.findByText("Payment reminder for INV-7 (£149.00) is ready. It's in Needs Approval.")).toBeTruthy();
    expect(onTheDashboard()).toBeTruthy();
  });
});

describe("the chat bubble does the same", () => {
  it("opens a task's question in a dialog and puts the result in the conversation, without leaving the page", async () => {
    const assign = vi.fn();
    const before = window.location.href;
    render(<BusinessAssistant />);
    await act(async () => { fireEvent.click(screen.getAllByRole("button")[0]); });
    fireEvent.change(screen.getByPlaceholderText(/Ask about customers/), { target: { value: "need a quotation" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    const dialog = screen.getByRole("dialog", { name: "The Agent needs a few details" });
    fireEvent.click(within(dialog).getByText("Frank"));
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "p4" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(await screen.findByText(new RegExp(READY_TEXT.replace(/[.£]/g, "\\$&")))).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("See details").getAttribute("href")).toBe("/agent/runs/run-q");      // only on a click
    expect(window.location.href).toBe(before);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("a button elsewhere on the dashboard", () => {
  it("hands its task to the Agent box, which opens the question here", async () => {
    const { followInAgentBox } = await import("./AgentPanel");
    mount();
    await act(async () => { followInAgentBox({ run: asking }); });
    expect(screen.getByRole("dialog", { name: "The Agent needs a few details" })).toBeTruthy();
    expect(onTheDashboard()).toBeTruthy();
  });
});
