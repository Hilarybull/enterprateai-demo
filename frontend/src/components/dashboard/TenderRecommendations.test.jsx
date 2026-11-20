import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apiRequest } from "../../api/client";
import TenderRecommendations from "./TenderRecommendations";
vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shows real counts, reasons and internal notice links", async () => {
  apiRequest.mockResolvedValue({ workspace_id: "one", open_count: 20, award_count: 4, open: [{ id: "notice:1", title: "Medical assessments", reasons: ["Matches your saved capability: Healthcare"] }], awards: [{ id: "award:1", title: "Healthcare contract", reasons: ["Matches your saved capability: Healthcare"] }] });
  render(<MemoryRouter><TenderRecommendations workspaceId="one" /></MemoryRouter>);
  await screen.findByText(/20 open tenders match/);
  expect(screen.getAllByText(/Matches your saved capability/)).toHaveLength(2);
  expect(screen.getByText("Medical assessments").closest("a").getAttribute("href")).toContain("tender=notice%3A1");
  expect(screen.getByText(/An award does not confirm/)).toBeTruthy();
});
it("never carries recommendations into another workspace", async () => {
  let resolveFirst;
  apiRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValue({ workspace_id: "two", profile_needed: true });
  const view = render(<MemoryRouter><TenderRecommendations workspaceId="one" /></MemoryRouter>);
  view.rerender(<MemoryRouter><TenderRecommendations workspaceId="two" /></MemoryRouter>);
  await screen.findByText(/Add your industry/);
  resolveFirst({ workspace_id: "one", open_count: 99, award_count: 0, open: [], awards: [] });
  await waitFor(() => expect(screen.queryByText(/99 open/)).toBeNull());
});
it("shows a retry instead of claiming zero when unavailable", async () => {
  apiRequest.mockRejectedValue(new Error("HTTP 503"));
  render(<MemoryRouter><TenderRecommendations workspaceId="one" /></MemoryRouter>);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.queryByText(/HTTP 503/)).toBeNull();
});

it("shows two previews and opens all matches with next and previous pages", async () => {
  const item = index => ({ id: `notice-${index}`, title: `Tender ${index}`, reasons: [] });
  apiRequest.mockImplementation(path => {
    const query = new URLSearchParams(path.split("?")[1]);
    if (!query.get("stage")) return Promise.resolve({ workspace_id: "one", open_count: 12, award_count: 0, open: [item(1), item(2), item(3)], awards: [] });
    const page = Number(query.get("page"));
    return Promise.resolve({ workspace_id: "one", total: 12, page, page_size: 10, more: page === 1, items: page === 1 ? Array.from({ length: 10 }, (_, i) => item(i + 1)) : [item(11), item(12)] });
  });
  render(<MemoryRouter><TenderRecommendations workspaceId="one" /></MemoryRouter>);
  await screen.findByText("Tender 1");
  expect(screen.queryByText("Tender 3")).toBeNull();
  expect(screen.queryByText(/awarded contract/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /See more/ }));
  const dialog = within(screen.getByRole("dialog", { name: "Tenders for your business" }));
  await dialog.findByText("Tender 10");
  expect(dialog.getByRole("button", { name: "Previous" }).disabled).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Next" }));
  await dialog.findByText("Tender 12");
  expect(dialog.queryByText("Tender 10")).toBeNull();
  expect(dialog.getByRole("button", { name: "Next" }).disabled).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Previous" }));
  await dialog.findByText("Tender 10");
  fireEvent.click(dialog.getByRole("button", { name: "Close popup" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
