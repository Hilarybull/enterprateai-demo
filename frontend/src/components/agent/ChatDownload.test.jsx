import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatDownload from "./ChatDownload";

vi.mock("../../api/client", () => ({ getApiBaseUrl: () => "https://api.example.test" }));
const item = { business_id: "business A", file_id: "file1", name: "Business summary.pdf", format: "pdf" };
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("downloads the saved file through the authenticated business endpoint", async () => {
  localStorage.setItem("ea_token", "signed-in-token");
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["%PDF"]) }));
  vi.stubGlobal("fetch", fetcher);
  const create = vi.fn(() => "blob:summary");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ChatDownload item={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledWith("https://api.example.test/businesses/business%20A/agent/files/file1", { headers: { Authorization: "Bearer signed-in-token" } });
  expect(create).toHaveBeenCalledTimes(1);
});

test("does not fetch private files without sign-in", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<ChatDownload item={{ ...item, format: "xlsx" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Download Excel file" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Sign in to download this file.");
  expect(fetcher).not.toHaveBeenCalled();
});

test("a failed download can be retried without exposing server details", async () => {
  localStorage.setItem("ea_token", "token");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
  render(<ChatDownload item={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Please try again");
  expect(screen.getByRole("button", { name: "Download PDF" }).disabled).toBe(false);
});
