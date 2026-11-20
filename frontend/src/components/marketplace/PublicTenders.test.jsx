import React from "react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PublicTenders from "./PublicTenders";
import { apiRequest } from "../../api/client";

let signedIn = false;
vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));
vi.mock("../../store/auth", () => ({ useAuthStore: selector => selector({ token: signedIn ? "session" : null }) }));
vi.mock("../../store/workspace", () => ({ ensureWorkspaceId: vi.fn(async () => "business"),
  useWorkspaceStore: Object.assign(selector => selector({ workspaceId: "business" }), { getState: () => ({ workspaceId: "business" }) }) }));
vi.mock("./TenderEvaluation", () => ({ default: () => null }));
function Where() { const { pathname, search } = useLocation(); return <p data-testid="location">{pathname + search}</p>; }
const notice = page => ({ id: `notice:${page}`, title: `Tender from page ${page}`, status: "open", amount: null });
function mount() {
  return render(<MemoryRouter initialEntries={["/marketplace?tab=tenders&industry=72&q=security"]}><Routes>
    <Route path="/marketplace" element={<><PublicTenders query="security" /><Where /></>} />
    <Route path="/login" element={<><h1>Sign in</h1><Where /></>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  signedIn = false;
  apiRequest.mockReset();
  apiRequest.mockImplementation(async path => {
    if (path.includes("/watchlist")) return { items: [] };
    const query = new URLSearchParams(path.split("?")[1]);
    const page = Number(query.get("page") || 1);
    return { items: [notice(page)], total: 65, page_size: 24, more: page < 3 };
  });
});
afterEach(cleanup);

test("shows available page numbers, loads a selected page and preserves filters", async () => {
  mount();
  const pagination = within(await screen.findByRole("navigation", { name: "Tender pages" }));
  expect(pagination.getByText("Page 1 of 3")).toBeTruthy();
  expect(pagination.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
  expect(pagination.getByRole("button", { name: "Previous" }).disabled).toBe(true);
  fireEvent.click(pagination.getByRole("button", { name: "Page 3" }));
  await screen.findByText("Tender from page 3");
  const last = within(screen.getByRole("navigation", { name: "Tender pages" }));
  expect(last.getByText("Page 3 of 3")).toBeTruthy();
  expect(last.getByRole("button", { name: "Page 3" }).getAttribute("aria-current")).toBe("page");
  expect(last.getByRole("button", { name: "Next" }).disabled).toBe(true);
  const request = apiRequest.mock.calls.find(([path]) => new URLSearchParams(path.split("?")[1]).get("page") === "3")[0];
  expect(new URLSearchParams(request.split("?")[1]).get("industry")).toBe("72");
  expect(new URLSearchParams(request.split("?")[1]).get("q")).toBe("security");
  fireEvent.change(screen.getByLabelText("Notice status"), { target: { value: "award" } });
  await screen.findByText("Tender from page 1");
});

test("guests see Save to watchlist and open sign in only after clicking", async () => {
  mount();
  const save = await screen.findByRole("button", { name: "Save to watchlist" });
  expect(screen.queryByText("Sign in to save")).toBeNull();
  expect(screen.getByTestId("location").textContent).toContain("/marketplace?");
  fireEvent.click(save);
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  const redirect = new URLSearchParams(screen.getByTestId("location").textContent.split("?")[1]).get("next");
  const context = new URLSearchParams(redirect.split("?")[1]);
  expect(context.get("tender")).toBe("notice:1");
  expect(context.get("industry")).toBe("72");
  expect(apiRequest.mock.calls.some(([, method]) => method === "PUT")).toBe(false);
});

test("signed-in visitors save without leaving the tender list", async () => {
  signedIn = true;
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Save to watchlist" }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/public-tenders/notice%3A1/watchlist?workspace_id=business", "PUT"));
  expect(screen.getByTestId("location").textContent).toContain("/marketplace?");
});
