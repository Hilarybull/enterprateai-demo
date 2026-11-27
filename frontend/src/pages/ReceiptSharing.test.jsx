import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareModal, RecordModal } from "./BusinessOperationsPage";
import { useWorkspaceStore } from "../store/workspace";

const record = { id: "inv1", customer_name: "Buyer", currency: "GBP", total_amount: 100,
  payments: [{ id: "p1", amount: 100 }] };
let failStatus, failEmail, requests;
beforeEach(() => {
  failStatus = false; failEmail = false; requests = [];
  useWorkspaceStore.setState({ workspaceId: "A", currency: "GBP" });
  globalThis.fetch = vi.fn(async (url, options) => {
    const path = String(url); const body = options?.body ? JSON.parse(options.body) : null;
    requests.push({ path, body });
    const failed = (path.includes("receipt-sent") && failStatus) || (path.includes("share-invoice") && failEmail);
    return new Response(JSON.stringify(failed ? { detail: "Unavailable" } :
      path.includes("invoice-link") ? { token: "link" } : { sent: true, message_id: "msg1", receipts: [] }),
      { status: failed ? 500 : 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const count = (part) => requests.filter(r => r.path.includes(part)).length;
async function send() {
  fireEvent.change(screen.getByPlaceholderText("email1@co.com, email2@co.com"), { target: { value: "buyer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
}
function mount() {
  render(<ShareModal record={record} type="invoice" receiptMode businessId="A" customers={[]} onClose={() => {}} />);
}
it("records only the payments included in a successfully emailed receipt", async () => {
  mount(); await send();
  await waitFor(() => expect(count("receipt-sent")).toBe(1));
  expect(requests.find(r => r.path.includes("receipt-sent")).body).toMatchObject({ payment_ids: ["p1"], message_id: "msg1" });
});
it("does not mark a receipt sent when email fails", async () => {
  failEmail = true; mount(); await send();
  await screen.findByRole("alert");
  expect(count("receipt-sent")).toBe(0);
});
it("shows a failed status update after email succeeds and retries without resending", async () => {
  failStatus = true; mount(); await send();
  expect((await screen.findByRole("alert")).textContent).toContain("status could not be saved");
  expect(screen.getByText(/Sent to buyer/)).toBeTruthy();
  failStatus = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry status update" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(count("share-invoice")).toBe(1);
  expect(count("receipt-sent")).toBe(2);
});
it("passes workspace information when sharing from View Receipt", async () => {
  render(<RecordModal mode="view" type="invoice" record={record} receiptMode customers={[]}
    workspaceName="Business" businessId="A" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
  await send();
  await waitFor(() => expect(count("receipt-sent")).toBe(1));
  expect(requests.find(r => r.path.includes("receipt-sent")).path).toContain("/businesses/A/");
});
