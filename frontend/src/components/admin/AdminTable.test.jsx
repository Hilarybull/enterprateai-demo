import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminTable } from "./AdminUI";

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
    fireEvent.change(within(bar).getByLabelText("Sent"), { target: { value: "30" } });
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
});
