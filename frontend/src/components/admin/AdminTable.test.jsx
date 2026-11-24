import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminTable } from "./AdminUI";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
function range(start, end) {
  fireEvent.click(screen.getByRole("button", { name: /Filter by date:/ }));
  const modal = screen.getByRole("dialog", { name: "Filter by Date" });
  if (start !== undefined) fireEvent.change(within(modal).getByRole("textbox", { name: /Start Date/ }), { target: { value: start } });
  if (end !== undefined) fireEvent.change(within(modal).getByRole("textbox", { name: /End Date/ }), { target: { value: end } });
  fireEvent.click(within(modal).getByRole("button", { name: "Apply Filter" }));
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const rows = [
  { id: 1, email: "old@x.test", status: "accepted", created_at: day(120) },
  { id: 2, email: "new@x.test", status: "pending", created_at: day(1) },
  { id: 3, email: "mid@x.test", status: "revoked", created_at: day(20) },
  { id: 4, email: "aaa@x.test", status: "pending", created_at: day(60) },
];
const columns = [{ key: "email", label: "Email" }, { key: "status", label: "Status" }, { key: "created_at", label: "Sent", render: (r) => r.created_at.slice(0, 10) },
  { key: "actions", label: "", render: () => "..." }];
const emails = () => screen.getAllByRole("row").slice(1).map((r) => r.cells[0].textContent);

afterEach(cleanup);

describe("every admin table", () => {
  it("shows the newest first, sorts by a column, and filters by date and by value", () => {
    render(<AdminTable columns={columns} rows={rows} />);
    expect(emails()).toEqual(["new@x.test", "mid@x.test", "aaa@x.test", "old@x.test"]);
    expect(screen.getByRole("columnheader", { name: /Sent/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Email/ }));
    expect(emails()).toEqual(["aaa@x.test", "mid@x.test", "new@x.test", "old@x.test"]);
    fireEvent.click(screen.getByRole("button", { name: /Sort by Email/ }));
    expect(emails()[0]).toBe("old@x.test");
    const bar = screen.getByRole("group", { name: "Filters" });
    fireEvent.change(within(bar).getByLabelText("Status"), { target: { value: "pending" } });
    expect(emails().sort()).toEqual(["aaa@x.test", "new@x.test"]);
    expect(within(bar).getByText("2 of 4")).toBeTruthy();
    range(day(30).slice(0, 10), day(0).slice(0, 10));
    expect(emails()).toEqual(["new@x.test"]);
    fireEvent.change(within(bar).getByLabelText("Status"), { target: { value: "accepted" } });      // 120 days old: not in the last 30
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(emails().length).toBe(4);
    expect(within(bar).queryByLabelText("Email")).toBeNull();      // every value different: no drop-down for it
  });

  it("keeps the order given when asked to", () => {
    render(<AdminTable columns={columns} rows={rows} defaultSort={null} filters={false} />);
    expect(emails()).toEqual(["old@x.test", "new@x.test", "mid@x.test", "aaa@x.test"]);
    expect(screen.queryByRole("group", { name: "Filters" })).toBeNull();
  });

  it("includes both ends of a date range, supports one bound, and resets pagination", () => {
    const dated = [
      { id: 1, email: "before@x.test", created_at: "2026-11-01T23:59:59Z" },
      { id: 2, email: "first@x.test", created_at: "2026-11-02T00:00:00Z" },
      { id: 3, email: "last@x.test", created_at: "2026-11-03T23:59:59Z" },
      { id: 4, email: "after@x.test", created_at: "2026-11-04T00:00:00Z" },
      { id: 5, email: "undated@x.test", created_at: null },
    ];
    const cols = [{ key: "email", label: "Email" }, { key: "created_at", label: "Joined" }];
    render(<AdminTable columns={cols} rows={dated} pageSize={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    range("02/11/2026", "03/11/2026");
    expect(emails()).toEqual(["last@x.test", "first@x.test"]);
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    range("", undefined);
    expect(emails()).toEqual(["last@x.test", "first@x.test"]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(emails()).toEqual(["before@x.test"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /Filter by date: Joined, Select Date/ })).toBeTruthy();
    expect(emails()).toEqual(["after@x.test", "last@x.test"]);
  });

  it("offers a date range for a table with fewer than four rows", () => {
    render(<AdminTable columns={columns} rows={rows.slice(0, 2)} />);
    fireEvent.click(screen.getByRole("button", { name: /Filter by date:/ }));
    const modal = screen.getByRole("dialog", { name: "Filter by Date" });
    expect(within(modal).getByRole("textbox", { name: /Start Date/ }).placeholder).toBe("dd/mm/yyyy");
    expect(within(modal).getByRole("textbox", { name: /End Date/ }).placeholder).toBe("dd/mm/yyyy");
  });
});
