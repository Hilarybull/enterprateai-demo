import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path.startsWith("/admin/emails/audience?source=users")) {
      return { items: [
        { key: "user:1", email: "ada@example.com", name: "Ada", plan: "starter", marketing: "agreed", since: "2026-10-01" },
        { key: "user:2", email: "bo@example.com", name: "Bo", plan: "explorer", marketing: "not_agreed", since: "2026-11-01" },
        { key: "user:3", email: "cy@example.com", name: "Cy", plan: "starter", marketing: "unsubscribed", since: "2026-11-02" },
      ] };
    }
    if (path.startsWith("/admin/emails/audience?source=unclaimed")) {
      return { items: [{ key: "profile:1", email: "hi@blue.test", name: "Blue Shark", category: "Design", location: "Leeds", since: "2026-09-01" },
        { key: "profile:2", email: "", name: "No Mail Co", category: "Legal", location: "York", since: "2026-09-02" }] };
    }
    if (path === "/admin/emails/bulk") return { id: "j1", total: 3, done: 0, sent: 0, failed: 0, opted_out: 0, subject: body.subject, finished_at: null, left_out: { invalid: [], duplicates: 0, unsubscribed: 0 } };
    return {};
  }),
}));

import BulkEmail from "./BulkEmail";

beforeEach(() => { calls.length = 0; });

describe("Bulk email", () => {
  it("filters, picks from users and unclaimed profiles, adds an address by hand and sends once to everyone", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BulkEmail />);
    await screen.findByText("ada@example.com");
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "starter" } });
    expect(screen.queryByText("bo@example.com")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick all 1 shown" }));      // the unsubscribed one can't be picked
    fireEvent.click(screen.getByRole("tab", { name: "Unclaimed profiles" }));
    await screen.findByText("Blue Shark");
    expect(screen.queryByText("No Mail Co")).toBeNull();      // only ones with an email, unless asked
    fireEvent.click(screen.getByRole("button", { name: "Pick all 1 shown" }));
    fireEvent.change(screen.getByLabelText(/Add addresses by hand/), { target: { value: "new@example.com" } });
    expect(screen.getByText("3 people picked")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello {name}" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi {name}, some news." } });
    fireEvent.click(screen.getByRole("button", { name: "Send to 3 people" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/admin/emails/bulk")).toBe(true));
    const sent = calls.find((c) => c.path === "/admin/emails/bulk").body;
    expect(sent.recipients).toEqual([{ email: "ada@example.com", name: "Ada" }, { email: "hi@blue.test", name: "Blue Shark" }, { email: "new@example.com", name: "" }]);
    expect(sent.test).toBe(false);
    expect(await screen.findByText(/Sending "Hello \{name\}": 0 of 3/)).toBeTruthy();
  });
});
