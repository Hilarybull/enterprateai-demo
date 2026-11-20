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

test("shows automatic settings only while enabled and saves disabling", async () => {
  apiRequest.mockResolvedValue({ ...health, scheduled: false });
  render(<TenderSyncAdmin />);
  const toggle = await screen.findByRole("switch");
  expect(screen.queryByLabelText(/Sync interval/)).toBeNull();
  expect(screen.queryByLabelText("New tenders to include")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save sync settings" })).toBeNull();
  fireEvent.click(toggle);
  const input = screen.getByLabelText(/Sync interval/);
  fireEvent.change(input, { target: { value: "45" } });
  fireEvent.click(toggle);
  expect(screen.queryByLabelText(/Sync interval/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save sync settings" }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/public-tenders/admin/schedule", "PUT", {
    enabled: false, interval_minutes: 45, import_scope: "suitable" }));
});

test("loads older history on demand and returns to the first page", async () => {
  const first = { attempted_at: "2026-11-20T12:00:00Z", status: "succeeded" };
  const older = { attempted_at: "2026-11-19T12:00:00Z", status: "failed", error: "Source unavailable" };
  apiRequest.mockImplementation(async (url) => url.includes("/history?")
    ? url.includes("before=") ? { items: [older], more: false, next_before: null }
      : { items: [first], more: true, next_before: first.attempted_at }
    : { ...health, history_available: true });
  render(<TenderSyncAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await screen.findByText("Source unavailable")).toBeTruthy();
  expect(screen.getByText("Page 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(true);
  expect(apiRequest).toHaveBeenCalledWith("/public-tenders/admin/history?page_size=10&before=2026-11-20T12%3A00%3A00Z", "GET");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Succeeded")).toBeTruthy();
  expect(screen.getByText("Page 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(true);
});
