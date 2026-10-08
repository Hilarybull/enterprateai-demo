// Long lists come a page at a time: 10 rows, "Showing 1–10 of 21", Previous / Next and page
// numbers; "Load more" on a phone. The page, filter, search and order live in the address, the
// server sends only the page asked for, and the numbers on tabs and filters are always totals.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Pagination, { PAGE_SIZE, pageNumbers, pageSlice } from "./Pagination";
import AgentCentrePage from "../pages/AgentCentrePage";
import { TableSection } from "../pages/BusinessOperationsPage";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }

describe("the pager", () => {
  it("works out the rows a page covers", () => {
    expect(PAGE_SIZE).toBe(10);
    expect(pageSlice(21, 1)).toMatchObject({ pages: 3, page: 1, offset: 0, limit: 10, from: 1, to: 10 });
    expect(pageSlice(21, 3)).toMatchObject({ page: 3, offset: 20, from: 21, to: 21 });
    expect(pageSlice(21, 9).page).toBe(3);                                  // past the end: the last page
    expect(pageSlice(21, "abc").page).toBe(1);
    expect(pageSlice(21, 1, 2)).toMatchObject({ limit: 20, from: 1, to: 20 });      // "Load more" once: ten more showing
    expect(pageSlice(0, 1)).toMatchObject({ pages: 1, from: 0, to: 0 });
    expect(pageNumbers(3, 1)).toEqual([1, 2, 3]);
    expect(pageNumbers(12, 6)).toEqual([1, 2, "…", 5, 6, 7, "…", 11, 12]);
  });

  it("says what is showing, and offers Previous, Next and the page numbers", () => {
    const onPage = vi.fn();
    const { container, rerender } = render(<Pagination total={21} page={1} onPage={onPage} noun="documents" />);
    expect(screen.getByRole("navigation", { name: "Pages of documents" })).toBeTruthy();
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–10 of 21");
    expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage.mock.calls).toEqual([[3], [2]]);
    rerender(<Pagination total={21} page={3} onPage={onPage} />);
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 21–21 of 21");
    expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(true);
    expect(container.querySelector("[data-load-more]")).toBeNull();          // nothing more to load on the last page
  });

  it("on a phone the numbers give way to Load more, which adds the next 10 below", () => {
    const onMore = vi.fn();
    const { container, rerender } = render(<Pagination total={21} page={1} onPage={() => {}} onMore={onMore} />);
    expect(container.querySelector("[data-pages]").className).toMatch(/\bhidden\b.*\bmd:flex\b/);      // numbers from 768px up
    const more = container.querySelector("[data-load-more]");
    expect(more.className).toContain("md:hidden");                          // Load more below 768px only
    expect(more.textContent.trim()).toBe("Load more");
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalledWith(2);
    rerender(<Pagination total={21} page={1} more={2} onPage={() => {}} onMore={onMore} />);
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–20 of 21");
  });

  it("stays out of the way when everything fits on one page", () => {
    const { container } = render(<><Pagination total={10} page={1} onPage={() => {}} /><Pagination total={0} page={1} onPage={() => {}} /></>);
    expect(container.querySelector("[data-pagination]")).toBeNull();
  });
});

describe("the Agent Centre, a page at a time", () => {
  let calls;
  const doc = (n, kind = "invoice") => ({ kind, kind_label: kind === "invoice" ? "Invoice" : "Quotation", id: `${kind}-${n}`, reference: `${kind === "invoice" ? "INV" : "QUO"}-${String(n).padStart(2, "0")}`,
    party: n % 3 ? "Aftred" : "Frank", total: 10 + n, currency: "GBP", status: "sent", status_label: "Sent", date: "2026-10-01", run_id: `run-${n}`, can_edit: false, from_agent: true });
  const task = (n, bucket = "completed") => ({ id: `run-${n}`, title: `Task ${n}`, status: "succeeded", bucket, capability: "new_invoice", summary: `Done ${n}`, created_at: "2026-10-01T10:00:00Z", refs: {} });
  const KINDS = [{ key: "quotation", label: "Quotation" }, { key: "invoice", label: "Invoice" }];
  const COUNTS = { active: 2, needs_approval: 1, needs_attention: 3, completed: 42, history: 48 };

  beforeEach(() => {
    calls = [];
    localStorage.setItem("ea_token", "t");
    useAuthStore.setState({ token: "t", email: "ada@example.test", hydrated: true });
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Alchemy Test" });
    globalThis.fetch = vi.fn(async (url) => {
      const u = new URL(String(url), "http://x");
      const q = Object.fromEntries(u.searchParams);
      calls.push({ path: u.pathname, q });
      let out = {};
      if (/\/agent\/documents$/.test(u.pathname)) {
        const all = [...Array.from({ length: 45 }, (_, i) => doc(i)), ...Array.from({ length: 5 }, (_, i) => doc(i, "quotation"))];
        const match = all.filter((d) => (!q.kind || d.kind === q.kind) && (!q.q || `${d.reference} ${d.party}`.toLowerCase().includes(q.q.toLowerCase())));
        const offset = Number(q.offset || 0);
        out = { items: match.slice(offset, offset + Number(q.limit || 300)), total: match.length, all_total: 50, counts: { invoice: 45, quotation: 5 }, kinds: KINDS };
      } else if (/\/workflow-runs$/.test(u.pathname)) {
        const n = q.bucket === "history" ? 48 : COUNTS[q.bucket] ?? 48;
        const offset = Number(q.offset || 0);
        out = { items: Array.from({ length: n }, (_, i) => task(i, q.bucket === "history" ? "completed" : q.bucket)).slice(offset, offset + Number(q.limit || 500)), total: n, counts: COUNTS };
      } else if (/\/agent\/summary$/.test(u.pathname)) {
        out = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 } };
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });
  const mount = (at) => render(<MemoryRouter initialEntries={[at]}><Routes><Route path="/agent" element={<><AgentCentrePage /><Where /></>} /></Routes></MemoryRouter>);
  const last = (pattern) => [...calls].reverse().find((c) => pattern.test(c.path));
  const tabNumber = (name) => within(screen.getByRole("tab", { name: new RegExp(`^${name}`) })).getByText(/^\d+$/).textContent;

  it("asks the server for one page of documents, and the tab and type numbers are totals", async () => {
    const { container } = mount("/agent?tab=documents");
    await waitFor(() => expect(container.querySelectorAll("[data-document]").length).toBe(10));
    expect(last(/agent\/documents$/).q).toEqual({ limit: "10", offset: "0" });      // not everything: the first 10
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–10 of 50");
    expect(tabNumber("Documents")).toBe("50");                              // the total, not the 10 on the page
    expect(tabNumber("Recently Completed")).toBe("42");
    expect(tabNumber("History")).toBe("48");
    expect(screen.getByRole("option", { name: "All documents (50)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Invoices (45)" })).toBeTruthy();
    // Next page: in the address, and asked of the server.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Page 2" })); });
    await waitFor(() => expect(container.querySelector("[data-showing]").textContent).toBe("Showing 11–20 of 50"));
    expect(screen.getByTestId("where").textContent).toBe("/agent?tab=documents&page=2");
    expect(last(/agent\/documents$/).q).toEqual({ limit: "10", offset: "10" });
    expect(tabNumber("Documents")).toBe("50");
  });

  it("keeps the type, search, order and page in the address, so a refresh lands in the same place", async () => {
    const { container } = mount("/agent?tab=documents&type=invoice&page=2");
    await waitFor(() => expect(container.querySelector("[data-showing]")?.textContent).toBe("Showing 11–20 of 45"));
    expect(last(/agent\/documents$/).q).toEqual({ kind: "invoice", limit: "10", offset: "10" });
    expect(screen.getByLabelText("Document type").value).toBe("invoice");
    expect(screen.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("option", { name: "All documents (50)" })).toBeTruthy();      // totals, whatever the filter
    // Changing what is looked for starts again from page 1.
    await act(async () => { fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "frank" } }); });
    await waitFor(() => expect(last(/agent\/documents$/).q).toEqual({ kind: "invoice", q: "frank", limit: "10", offset: "0" }));
    expect(screen.getByTestId("where").textContent).toBe("/agent?tab=documents&type=invoice&q=frank");
    await waitFor(() => expect(container.querySelector("[data-showing]")?.textContent).toBe("Showing 1–10 of 15"));      // the count is of what matches
    expect(container.querySelectorAll("[data-document]").length).toBe(10);
    await act(async () => { fireEvent.change(screen.getByLabelText("Order by date"), { target: { value: "oldest" } }); });
    await waitFor(() => expect(last(/agent\/documents$/).q).toEqual({ kind: "invoice", q: "frank", order: "oldest", limit: "10", offset: "0" }));
    expect(screen.getByTestId("where").textContent).toBe("/agent?tab=documents&type=invoice&q=frank&sort=oldest");
  });

  it("the task tabs page the same way, with History's filters in the address", async () => {
    const { container } = mount("/agent?tab=completed");
    await waitFor(() => expect(container.querySelector("[data-showing]")?.textContent).toBe("Showing 1–10 of 42"));
    expect(last(/workflow-runs$/).q).toEqual({ bucket: "completed", limit: "10", offset: "0" });
    expect(screen.getAllByText(/^Task \d+$/).length).toBe(10);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next" })); });
    await waitFor(() => expect(last(/workflow-runs$/).q).toEqual({ bucket: "completed", limit: "10", offset: "10" }));
    expect(screen.getByTestId("where").textContent).toBe("/agent?tab=completed&page=2");
    // "Load more" (phone) asks for the next 10 as well, from the same starting point.
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /^History/ })); });
    await waitFor(() => expect(container.querySelector("[data-showing]")?.textContent).toBe("Showing 1–10 of 48"));
    await act(async () => { fireEvent.click(container.querySelector("[data-load-more]")); });
    await waitFor(() => expect(last(/workflow-runs$/).q).toEqual({ bucket: "history", limit: "20", offset: "0" }));
    await waitFor(() => expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–20 of 48"));
    await act(async () => { fireEvent.change(screen.getByLabelText("Status"), { target: { value: "succeeded" } }); });
    await waitFor(() => expect(last(/workflow-runs$/).q).toEqual({ bucket: "history", status: "succeeded", limit: "10", offset: "0" }));
    expect(screen.getByTestId("where").textContent).toBe("/agent?tab=history&status=succeeded");
    expect(tabNumber("Needs You")).toBe("3");
  });
});

describe("Business Operations tables", () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ Customer: i % 3 ? "Aftred" : "Frank", Reference: `INV-${String(i).padStart(2, "0")}`, Status: i % 2 ? "paid" : "sent", _filter: i % 2 ? "paid" : "sent" }));
  const mount = (at = "/operations") => render(<MemoryRouter initialEntries={[at]}><Routes><Route path="/operations" element={<>
    <TableSection title="Invoices" cols={["Customer", "Reference", "Status"]} rows={rows} filterValues={["sent", "paid"]} searchPlaceholder="Search invoices..." /><Where /></>} /></Routes></MemoryRouter>);
  const refs = (c) => [...c.querySelectorAll("tbody tr td:nth-child(2)")].map((td) => td.textContent);

  it("show 10 rows a page with the same pager, and keep the page, search and filter in the address", () => {
    const { container } = mount();
    expect(refs(container).length).toBe(10);
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–10 of 45");
    fireEvent.click(screen.getByRole("button", { name: "Page 5" }));
    expect(refs(container)).toEqual(["INV-40", "INV-41", "INV-42", "INV-43", "INV-44"]);
    expect(screen.getByTestId("where").textContent).toBe("/operations?invoices.page=5");
    // Searching starts again from page 1, and the count is of what matches.
    fireEvent.change(screen.getByPlaceholderText("Search invoices..."), { target: { value: "frank" } });
    expect(refs(container).length).toBe(10);
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–10 of 15");
    expect(screen.getByTestId("where").textContent).toBe("/operations?invoices.q=frank");
    fireEvent.change(screen.getByPlaceholderText("Search invoices..."), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "paid" }));
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–10 of 22");
    expect(screen.getByTestId("where").textContent).toBe("/operations?invoices.filter=paid");
    fireEvent.click(container.querySelector("[data-load-more]"));            // phone: the next ten are added below
    expect(refs(container).length).toBe(20);
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 1–20 of 22");
  });

  it("a refresh or Back lands on the same page of the same table", () => {
    const { container } = mount("/operations?invoices.page=2&invoices.filter=sent");
    expect(container.querySelector("[data-showing]").textContent).toBe("Showing 11–20 of 23");
    expect(refs(container)).toEqual(["INV-20", "INV-22", "INV-24", "INV-26", "INV-28", "INV-30", "INV-32", "INV-34", "INV-36", "INV-38"]);
    expect(screen.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
  });
});
