// Render test for Business Operations: the real page with records in every status, clicked
// through every tab. A build can't catch a missing identifier inside markup; this does.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BusinessOperationsPage, { ASSIGNING, LIVE_REFRESH_MS, menuPlacement } from "./BusinessOperationsPage";
import { AGENT_CHANGED_EVENT, approveAction } from "../lib/agent";
import ErrorBoundary, { Guarded } from "../components/ErrorBoundary";
import { useWorkspaceStore } from "../store/workspace";
import { todayLocal } from "../lib/format";

const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
const QUOTE_STATUSES = ["", "draft", "sent", "Sent ", "submitted", "viewed", "negotiation", "in_negotiation", "pending",
  "awaiting_response", "accepted", "won", "rejected", "cancelled", "expired", undefined, null];

const quotes = QUOTE_STATUSES.map((status, i) => ({
  id: `q${i}`, reference: `QUO-${i}`, customer_name: `Customer ${i}`, status, total_amount: 100 + i, currency: "GBP",
  created_at: day(-i), updated_at: day(-i),
  ...(status === "accepted" ? { responded_at: day(-1), acceptance: { name: "Sam Lee", accepted_at: day(-1) } } : {}),
}));

const invoices = [
  { id: "i1", reference: "INV-1", customer_name: "A", status: "draft", total_amount: 100, due_date: day(14).slice(0, 10), created_at: day(-1) },
  { id: "i2", reference: "INV-2", customer_name: "B", status: "sent", total_amount: 288, due_date: day(14).slice(0, 10), created_at: day(-2) },
  { id: "i3", reference: "INV-3", customer_name: "C", status: "sent", total_amount: 50, due_date: day(-5).slice(0, 10), created_at: day(-20) },
  { id: "i4", reference: "INV-4", customer_name: "D", status: "paid", payment_type: "partial", total_amount: 288, due_date: day(10).slice(0, 10),
    created_at: day(-3), payments: [{ id: "p1", amount: 100, paid_at: day(-2), receipt: { number: "REC-1", sent_at: day(-2) } }] },
  { id: "i5", reference: "INV-5", customer_name: "E", status: "paid", payment_type: "full", total_amount: 288, created_at: day(-4),
    payments: [{ id: "p2", amount: 100, paid_at: day(-3), receipt: { number: "REC-2", sent_at: day(-3) } },
               { id: "p3", amount: 188, paid_at: day(-1), receipt: { number: "REC-3" } }] },
  { id: "i6", reference: "INV-6", customer_name: "F", status: "paid", total_amount: 40, paid_at: day(-9), created_at: day(-10) },   // legacy: no payments list
  { id: "i7", reference: "INV-7", customer_name: "G", status: "cancelled", total_amount: 999, due_date: day(-30).slice(0, 10), created_at: day(-40) },
  { id: "i8", customer_name: "H", status: undefined, total_amount: undefined },
];

const workspace = {
  id: "ws1", name: "Alchemy Test",
  data: {
    settings: { currency: "GBP" }, workspace_profile: { company_name: "Alchemy Test" },
    financials: {
      quotes, invoices,
      expenses: [{ id: "e1", vendor_name: "V", price: 20, status: "paid", date: day(-3) }, { id: "e2", price: 5, status: "pending", date: day(-1) }],
      contracts: [{ id: "c1", party_name: "X", status: "active", total_amount: 500 }, { id: "c2", status: "pending" }, { id: "c3" }],
      rfq_requests: [{ id: "r1", status: "pending", customer_name: "Buyer", items: [{ name: "Thing", quantity: 2 }], created_at: day(-1) },
                     { id: "r2", status: "approved", locked: true, created_at: day(-2) }],
    },
    catalogue: { products: [], customers: [{ id: "cu1", name: "Customer 1", email: "c1@x.test" }], vendors: [] },
  },
};

function mount(url = "/operations") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ErrorBoundary label="Business Operations"><BusinessOperationsPage /></ErrorBoundary>
    </MemoryRouter>,
  );
}

const noCrash = () => expect(screen.queryByText(/couldn't be displayed/i)).toBeNull();

let served;      // what the server returns for the workspace; tests change it to imitate the Agent

beforeEach(() => {
  localStorage.setItem("ea_token", "test");
  served = workspace;
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url);
    const body = /\/validation\//.test(path) ? served : /currency-rate/.test(path) ? { rate: 1 } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Alchemy Test", currency: "GBP", wsDoc: workspace });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Business Operations renders with records in every status", () => {
  it("shows every main tab without crashing", async () => {
    await act(async () => { mount(); });
    for (const tab of ["Overview", "Sales", "Procurement", "Contracts", "Transactions", "Reports"]) {
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: tab })[0]); });
      noCrash();
    }
  });

  it("renders the Sales pipeline (the stage that crashed) and counts sent quotes", async () => {
    await act(async () => { mount("/operations?tab=Sales"); });
    expect(screen.getByText("Sales Pipeline")).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
    noCrash();
  });

  it("renders Quotations, Invoices and Receipts", async () => {
    await act(async () => { mount("/operations?tab=Sales"); });
    for (const sub of ["Quotations", "Invoices", "Receipts", "Pipeline"]) {
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: sub })[0]); });
      noCrash();
    }
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Receipts" })[0]); });
    // One row per payment, each with its own receipt number (QA P-2).
    for (const n of ["REC-1", "REC-2", "REC-3"]) expect(screen.getByText(n)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Invoices" })[0]); });
    expect(screen.queryByText("Today")).toBeNull();                 // due dates are dates, never "Today" (QA P-5)
    expect(screen.getAllByText(/overdue/i).length).toBeGreaterThan(0);
  });
});

describe("Inbound marketplace requests and the Agent", () => {
  const withRequests = (agentFor = {}) => {
    const ws = structuredClone(workspace);
    ws.data.financials.rfq_requests = [
      { id: "r1", status: "pending", customer_name: "Buyer One", items: [{ name: "Thing", quantity: 2 }], created_at: day(-1) },
      { id: "r3", status: "pending", customer_name: "Buyer Three", items: [{ name: "Thing", quantity: 1 }], created_at: day(-2) },
      { id: "r4", status: "approved", customer_name: "Buyer Four", quote_id: "q2", items: [{ name: "Thing", quantity: 1 }], created_at: day(-3) },
    ];
    served = ws;
    useWorkspaceStore.setState({ wsDoc: ws });
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const path = String(url);
      calls.push({ path, method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      let body = {};
      if (/\/validation\//.test(path)) body = served;
      else if (/currency-rate/.test(path)) body = { rate: 1 };
      else if (/\/marketplace\/rfq\?workspace_id=ws1/.test(path)) body = { items: ws.data.financials.rfq_requests.map((r) => ({ ...r, agent: agentFor[r.id] || null })), total: 3 };
      else if (/\/agent\/requests$/.test(path)) body = { kind: "workflow", run: { id: "run-9" } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return calls;
  };
  const rowOf = (name) => screen.getByText(name).closest("tr");
  async function openQuotations() {
    await act(async () => { mount("/operations?tab=Sales"); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Quotations" })[0]); });
    await act(async () => {});
  }

  it("each row says where the Agent has got to, with a link to its task", async () => {
    withRequests({ r1: { run_id: "run-1", status: "awaiting_approval", label: "Waiting for your approval", to: "/agent/runs/run-1" },
                   r4: { run_id: "run-4", status: "sent", label: "Sent", to: "/agent/runs/run-4" } });
    await openQuotations();
    const waiting = rowOf("Buyer One").querySelector("a");
    expect(waiting.textContent).toBe("Waiting for your approval");
    expect(waiting.getAttribute("href")).toBe("/agent/runs/run-1");
    expect(rowOf("Buyer Four").querySelector("a").textContent).toBe("Sent");
    expect(rowOf("Buyer Four").querySelector("a").getAttribute("href")).toBe("/agent/runs/run-4");
    expect(rowOf("Buyer Three").querySelector("a")).toBeNull();           // no task for this one
    noCrash();
  });

  it("a pending request with no task offers 'Let the Agent draft this', which starts one for that request", async () => {
    const calls = withRequests({ r1: { run_id: "run-1", status: "drafting", label: "Agent drafting", to: "/agent/runs/run-1" } });
    await openQuotations();
    await act(async () => { fireEvent.click(rowOf("Buyer One").querySelector("td:last-child button")); });
    expect(screen.queryByText("Let the Agent draft this")).toBeNull();    // it already has a task: open that instead
    expect(screen.getByText("Open the Agent's task")).toBeTruthy();
    expect(screen.getByText("Respond with Quote")).toBeTruthy();          // replying by hand is still there
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); fireEvent.mouseDown(document.body); });
    await act(async () => { fireEvent.click(rowOf("Buyer Three").querySelector("td:last-child button")); });
    await act(async () => { fireEvent.click(screen.getByText("Let the Agent draft this")); });
    const sent = calls.find((c) => c.method === "POST" && /\/agent\/requests$/.test(c.path));
    expect(sent.body).toMatchObject({ business_id: "ws1", capability: "enquiry_to_quote", params: { rfq_id: "r3" }, source_channel: "ui_action", source_reference: "rfq:r3" });
  });

  it("reads the Agent's progress again when an Agent action completes", async () => {
    const calls = withRequests();
    await openQuotations();
    const reads = () => calls.filter((c) => /\/marketplace\/rfq\?/.test(c.path)).length;
    const before = reads();
    expect(before).toBeGreaterThan(0);
    await act(async () => { window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT)); });
    expect(reads()).toBe(before + 1);
  });
});

describe("Business Operations stays current with the Agent", () => {
  // INV-2 has one payment with no receipt; then the Agent issues and sends one.
  const unpaid = () => {
    const ws = structuredClone(workspace);
    ws.updated_at = "2026-10-03T22:00:00Z";
    ws.data.financials.invoices = [{ id: "i9", reference: "INV-9", customer_name: "QA Test Ltd", status: "paid", payment_type: "full",
      total_amount: 188, created_at: day(-1), payments: [{ id: "p9", amount: 188, paid_at: day(0) }] }];
    return ws;
  };
  const receipted = () => {
    const ws = unpaid();
    ws.updated_at = "2026-10-03T22:48:09Z";
    ws.data.financials.invoices[0].payments[0].receipt = { number: "REC-3031026", sent_at: day(0), sent_to: "qa@buyer.test" };
    return ws;
  };
  const workspaceReads = () => globalThis.fetch.mock.calls.filter(([u, o]) => /\/validation\//.test(String(u)) && (!o?.method || o.method === "GET")).length;

  async function openReceipts(ws) {
    served = ws;
    useWorkspaceStore.setState({ wsDoc: ws });
    await act(async () => { mount("/operations?tab=Sales"); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Receipts" })[0]); });
  }

  it("shows a receipt as sent once an Agent action completes", async () => {
    await openReceipts(unpaid());
    expect(screen.getByText("Not issued")).toBeTruthy();
    served = receipted();
    await act(async () => { await approveAction("run1", "appr1"); });      // any Agent action announces itself
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText("REC-3031026")).toBeTruthy();
    expect(screen.queryByText("Not issued")).toBeNull();
  });

  it("picks up background Agent work by checking every 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      await openReceipts(unpaid());
      expect(screen.getByText("Not issued")).toBeTruthy();
      served = receipted();
      await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1000); });
      expect(screen.getByText("Not issued")).toBeTruthy();                 // not yet
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.getByText("REC-3031026")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not check while the tab is hidden, and stops when the page is left", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await openReceipts(unpaid());
      const before = workspaceReads();
      await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3); });
      expect(workspaceReads()).toBe(before);
      visibility.mockReturnValue("visible");
      cleanup();
      await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3); });
      window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT));
      expect(workspaceReads()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reloads underneath an open dialog", async () => {
    served = unpaid();
    useWorkspaceStore.setState({ wsDoc: served });
    await act(async () => { mount("/operations?tab=Transactions"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /new invoice/i })); });
    expect(screen.getAllByRole("button", { name: /cancel|close|save/i }).length).toBeGreaterThan(0);      // the dialog is open
    const before = workspaceReads();
    served = receipted();
    await act(async () => { window.dispatchEvent(new CustomEvent(AGENT_CHANGED_EVENT)); await new Promise((r) => setTimeout(r, 0)); });
    expect(workspaceReads()).toBe(before);
  });
});

describe("New invoices (QA round 7)", () => {
  const patches = () => globalThis.fetch.mock.calls
    .filter(([u, o]) => /\/validation\//.test(String(u)) && o?.method === "PATCH").map(([, o]) => JSON.parse(o.body));

  async function openNewInvoice() {
    await act(async () => { mount("/operations?tab=Transactions"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /new invoice/i })); });
  }

  it("leaves the number to the server, defaults the issue date to today here, and uses no local: id", async () => {
    await openNewInvoice();
    const number = screen.getByPlaceholderText("Assigned automatically when saved");
    expect(number.value).toBe("");                                          // no pre-filled (possibly duplicate) number
    expect(document.querySelector('input[type="date"]').value).toBe(todayLocal());
    fireEvent.change(screen.getByPlaceholderText("Customer name"), { target: { value: "QA Test Ltd" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    const sent = patches().at(-1).data.financials.invoices.at(-1);
    expect(sent.number_auto).toBe(true);
    expect(sent.reference).toBe("");
    expect(String(sent.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sent.issued_at).toBe(todayLocal());
  });

  it("keeps a typed number, and reopens the form with the server's message when it is a duplicate", async () => {
    const real = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation(async (url, opts) => {
      if (/\/validation\//.test(String(url)) && opts?.method === "PATCH") {
        return new Response(JSON.stringify({ detail: { code: "duplicate_invoice_number", invoice_number: "INV-1",
          message: "Invoice number INV-1 is already used by another invoice. Enter a different number, or leave it blank to get the next one automatically." } }),
          { status: 409, headers: { "Content-Type": "application/json" } });
      }
      return real(url, opts);
    });
    await openNewInvoice();
    fireEvent.change(screen.getByPlaceholderText("Customer name"), { target: { value: "QA Test Ltd" } });
    fireEvent.change(screen.getByPlaceholderText("Assigned automatically when saved"), { target: { value: "INV-1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); await new Promise((r) => setTimeout(r, 0)); });
    const sent = patches().at(-1).data.financials.invoices.at(-1);
    expect(sent.reference).toBe("INV-1");
    expect(sent.number_auto).toBeUndefined();
    expect(screen.getByText(/INV-1 is already used by another invoice/)).toBeTruthy();      // the form is back, with the reason
    expect(screen.getByPlaceholderText("Customer name").value).toBe("QA Test Ltd");          // and what was typed
    expect(screen.getByDisplayValue("INV-1")).toBeTruthy();
  });

  it("shows 'Assigning…' for the new invoice until the server returns its number, never a guessed one", async () => {
    // An invoice numbered INV-1<today> already exists: the old client-side guess would have reused it.
    const ws = structuredClone(workspace);
    const suffix = todayLocal().replace(/^(\d{2})(\d{2})-(\d{2})-(\d{2})$/, "$4$3$2");
    ws.data.financials.invoices = [{ id: "a", reference: `INV-1${suffix}`, invoice_number: `INV-1${suffix}`, customer_name: "Existing Ltd",
      status: "sent", total_amount: 40, created_at: new Date().toISOString() }];
    served = ws;
    useWorkspaceStore.setState({ wsDoc: ws });
    let finishSave;
    const real = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation((url, opts) => {
      if (/\/validation\//.test(String(url)) && opts?.method === "PATCH") {
        return new Promise((resolve) => { finishSave = () => resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })); });
      }
      return real(url, opts);
    });
    await act(async () => { mount("/operations?tab=Sales"); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Invoices" })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "+ Create" })); });
    fireEvent.change(screen.getByPlaceholderText("Customer name"), { target: { value: "New Customer Ltd" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    expect(screen.getByText(ASSIGNING)).toBeTruthy();                        // while the save is in flight
    expect(screen.getAllByText(`INV-1${suffix}`)).toHaveLength(1);           // only the existing invoice has that number
    expect(screen.queryByText(`INV-2${suffix}`)).toBeNull();                 // and nothing is guessed
    // The server answers with the real number.
    const after = structuredClone(ws);
    after.updated_at = new Date().toISOString();
    after.data.financials.invoices.push({ id: "b", reference: `INV-2${suffix}`, invoice_number: `INV-2${suffix}`, customer_name: "New Customer Ltd",
      status: "draft", total_amount: 0, created_at: new Date().toISOString() });
    served = after;
    await act(async () => { finishSave(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText(ASSIGNING)).toBeNull();
    expect(screen.getByText(`INV-2${suffix}`)).toBeTruthy();
  });

  it("gives today's date in the local time zone, not UTC", () => {
    expect(todayLocal(new Date(2026, 9, 4, 0, 30))).toBe("2026-10-04");     // 00:30 local is still the 4th
    expect(todayLocal(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });
});

describe("Disputed, voided, cancelled and credited invoices", () => {
  const one = (over = {}) => {
    const ws = structuredClone(workspace);
    ws.data.financials.invoices = [{ id: "i1", reference: "INV-1", customer_name: "QA Test Ltd", status: "sent", total_amount: 288,
      description: "Consulting day, October", due_date: day(-9).slice(0, 10), created_at: day(-20), ...over }];
    return ws;
  };
  async function openInvoices(ws) {
    served = ws;
    useWorkspaceStore.setState({ wsDoc: ws });
    await act(async () => { mount("/operations?tab=Sales"); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Invoices" })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "More actions" })); });
  }

  it("records a dispute with a reason and date through the API", async () => {
    await openInvoices(one());
    for (const label of ["Mark as Disputed", "Void Invoice", "Cancel Invoice", "Mark as Credited"]) expect(screen.getByText(label)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Mark as Disputed")); });
    const dialog = screen.getByRole("dialog", { name: "Mark invoice as disputed" });
    // The invoice is named by number, amount and description, not just the customer.
    const about = dialog.querySelector('dl[aria-label="Invoice"]').textContent;
    expect(about).toContain("INV-1");
    expect(about).toMatch(/£288\.00/);
    expect(about).toContain("Consulting day, October");
    const submit = screen.getByRole("button", { name: "Mark as disputed" });
    expect(submit.disabled).toBe(true);                                      // a reason is required
    fireEvent.change(dialog.querySelector("textarea"), { target: { value: "Customer says the hours are wrong" } });
    expect(dialog.querySelector('input[type="date"]').value).toBe(todayLocal());
    await act(async () => { fireEvent.click(submit); await new Promise((r) => setTimeout(r, 0)); });
    const call = globalThis.fetch.mock.calls.find(([u]) => /\/businesses\/ws1\/invoices\/i1\/state$/.test(String(u)));
    expect(JSON.parse(call[1].body)).toEqual({ state: "disputed", reason: "Customer says the hours are wrong", date: todayLocal() });
    expect(screen.queryByRole("dialog", { name: "Mark invoice as disputed" })).toBeNull();
  });

  it("shows the state with its reason and date, offers Reopen, and no Agent follow-up", async () => {
    await openInvoices(one({ status: "disputed", status_reason: "Wrong quantity billed", status_date: "2026-10-02" }));
    // State, its date, the note and the due date are four separate things.
    expect(screen.getAllByText("disputed").length).toBeGreaterThan(0);
    expect(screen.getByText(/on 2 Oct 2026/).textContent).toMatch(/^disputed on 2 Oct 2026$/i);
    const note = screen.getByText("Note:").parentElement;
    expect(note.textContent).toBe("Note: Wrong quantity billed");
    expect(note.textContent).not.toMatch(/2026/);
    const due = screen.getByText("Due", { selector: ".sr-only" }).parentElement;
    expect(due.textContent).not.toMatch(/Wrong quantity|overdue/);
    expect(screen.getByText("Reopen Invoice")).toBeTruthy();
    expect(screen.queryByText("Mark as Disputed")).toBeNull();
    expect(screen.queryByText("Ask Agent: payment follow-up")).toBeNull();   // overdue, but on hold
    await act(async () => { fireEvent.click(screen.getByText("Reopen Invoice")); await new Promise((r) => setTimeout(r, 0)); });
    const call = globalThis.fetch.mock.calls.find(([u]) => /\/invoices\/i1\/state$/.test(String(u)));
    expect(JSON.parse(call[1].body).state).toBe("reopen");
  });
});

describe("Row action menu placement", () => {
  const base = { viewportHeight: 800, menuHeight: 478 };      // the invoice menu: 13 items

  it("opens below the row when there is room", () => {
    expect(menuPlacement({ ...base, rowTop: 200, rowBottom: 232, areaTop: 180 })).toEqual({ top: 236, maxHeight: null, side: "below" });
  });

  it("never rises above the table, so it can't cover the Create button in the page header", () => {
    // A row low on the screen: the old menu flipped up to y=114, over the header (table starts at 300).
    const p = menuPlacement({ ...base, rowTop: 600, rowBottom: 632, areaTop: 300 });
    expect(p.top).toBeGreaterThanOrEqual(300);
    expect(p.top + (p.maxHeight ?? base.menuHeight)).toBeLessThanOrEqual(800);
    expect(p.maxHeight).not.toBeNull();                                      // it scrolls instead of overflowing
  });

  it("flips above only when the whole menu fits between the table top and the row", () => {
    const p = menuPlacement({ viewportHeight: 800, menuHeight: 200, rowTop: 700, rowBottom: 732, areaTop: 100 });
    expect(p).toEqual({ top: 496, maxHeight: null, side: "above" });
    expect(p.top).toBeGreaterThanOrEqual(100);
  });

  it("stays inside the table for every row position", () => {
    for (let rowTop = 310; rowTop <= 760; rowTop += 15) {
      const p = menuPlacement({ ...base, rowTop, rowBottom: rowTop + 32, areaTop: 300 });
      expect(p.top).toBeGreaterThanOrEqual(300);
    }
  });
});

describe("ErrorBoundary", () => {
  it("contains a failing section and leaves the rest of the page standing", () => {
    const boom = () => { throw new ReferenceError("st is not defined"); };
    render(
      <div>
        <p>Still here</p>
        <ErrorBoundary label="Sales"><Guarded render={boom} /></ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("Still here")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Sales section couldn't be displayed/);
  });
});
