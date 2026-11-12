import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path.endsWith("/preview")) return { subject: "Preview", html: "<p>Preview</p>", text: "Preview", errors: {} };
    return {};
  }),
}));
vi.mock("../../lib/dialog", () => ({ confirmDialog: vi.fn(async () => true) }));

import { Wording } from "./EmailsAdmin";

const plain = "{message}\n\n{link}\n\nNot interested? Stop these emails: {opt_out}";
const kind = { key: "claim_invitation", label: "Claim invitation and reminders", subject: "{headline}", body: plain, button_label: "Claim {business_name}",
  variables: ["headline", "message", "business_name", "waiting", "link", "opt_out"], required: ["link", "opt_out"], edited: false,
  default: { subject: "{headline}", body: plain, button_label: "Claim {business_name}" } };

beforeEach(() => { calls.length = 0; });

describe("the wording of a platform email", () => {
  it("opens plain wording in the formatting editor, offers that email's own variables, and saves the formatted message", async () => {
    render(<Wording kind={kind} onSaved={() => {}} onClose={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box.querySelectorAll("p").length).toBe(3);                         // one paragraph per block, as it was written
    expect(box.textContent).toContain("Not interested? Stop these emails: {opt_out}");
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Align center" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Attach files/ })).toBeNull();      // a wording carries no files
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));
    const menu = screen.getByRole("menu", { name: "Variables" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.querySelector("code").textContent))
      .toEqual(["{headline}", "{message}", "{business_name}", "{waiting}", "{link}", "{opt_out}"]);
    box.innerHTML = '<p style="text-align: center;"><b>{message}</b></p><p>{link}</p><p>Stop: {opt_out}</p>';
    fireEvent.input(box);
    fireEvent.click(screen.getByRole("button", { name: "Save wording" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const saved = calls.find((c) => c.method === "PUT");
    expect(saved.path).toBe("/admin/emails/kinds/claim_invitation");
    expect(saved.body.body).toContain("<b>{message}</b>");
    expect(saved.body.body).toContain("text-align: center");
  });
});
