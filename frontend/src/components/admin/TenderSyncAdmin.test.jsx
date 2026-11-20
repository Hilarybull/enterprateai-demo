import React from "react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TenderSyncAdmin from "./TenderSyncAdmin";
import { apiRequest } from "../../api/client";

vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));
const health = { scheduled: true, schedule_configurable: true, preferences_configurable: true,
  interval_minutes: 180, import_scope: "suitable", history_available: false };
beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(async (_url, method, body) => method === "PUT" ? { scheduled: body.enabled, ...body } : health);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("saves the administrator's interval and scope together", async () => {
  render(<TenderSyncAdmin />);
  fireEvent.change(await screen.findByLabelText(/Sync interval/), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("New tenders to include"), { target: { value: "all" } });
  fireEvent.click(screen.getByRole("switch"));
  expect(apiRequest).not.toHaveBeenCalledWith(expect.anything(), "PUT", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Save sync settings" }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/public-tenders/admin/schedule", "PUT", {
    enabled: false, interval_minutes: 60, import_scope: "all" }));
  expect(await screen.findByText(/Sync settings saved/)).toBeTruthy();
});

test("status polling keeps unsaved edits", async () => {
  let poll;
  vi.spyOn(globalThis, "setInterval").mockImplementation((fn) => { poll = fn; return 1; });
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  render(<TenderSyncAdmin />);
  const input = await screen.findByLabelText(/Sync interval/);
  fireEvent.change(input, { target: { value: "45" } });
  await poll();
  expect(input.value).toBe("45");
});

test("disables settings when the database upgrade is missing", async () => {
  apiRequest.mockResolvedValue({ ...health, preferences_configurable: false });
  render(<TenderSyncAdmin />);
  expect((await screen.findByRole("button", { name: "Save sync settings" })).disabled).toBe(true);
  expect(screen.getByRole("switch").disabled).toBe(true);
});
