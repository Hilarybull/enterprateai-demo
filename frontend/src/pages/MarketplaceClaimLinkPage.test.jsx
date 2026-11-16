import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
let reply = null;
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => { calls.push({ path, method, body }); return reply(); }),
}));
const tokenLogin = vi.fn(async () => {});
vi.mock("../store/auth", () => ({ useAuthStore: (pick) => pick({ tokenLogin }) }));
const setWorkspaceId = vi.fn();
vi.mock("../store/workspace", () => ({ useWorkspaceStore: { getState: () => ({ setWorkspaceId }) } }));

import MarketplaceClaimLinkPage from "./MarketplaceClaimLinkPage";

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
const open = (url) => render(<MemoryRouter initialEntries={[url]}><Routes>
  <Route path="/marketplace/claim-link" element={<MarketplaceClaimLinkPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);

afterEach(() => { cleanup(); calls.length = 0; tokenLogin.mockClear(); setWorkspaceId.mockClear(); });

describe("the one-click claim link", () => {
  it("signs them in, opens their new workspace and takes them to their profile", async () => {
    reply = () => ({ access_token: "jwt", email: "hello@northwind.test", business_id: "ws1", slug: "northwind-advisory-ltd-leeds" });
    open("/marketplace/claim-link?token=abc123abc123abc123abc123");
    expect(screen.getByText("Setting up your business")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/marketplace/business/northwind-advisory-ltd-leeds?welcome=1"));
    expect(calls[0]).toEqual({ path: "/auth/marketplace-claim-link", method: "POST", body: { token: "abc123abc123abc123abc123" } });
    expect(tokenLogin).toHaveBeenCalledWith("jwt", "hello@northwind.test");
    expect(setWorkspaceId).toHaveBeenCalledWith("ws1");
  });

  it("says plainly when the business is already claimed, with a way to its profile", async () => {
    reply = () => { const e = new Error("HTTP 409: This business has already been claimed."); e.data = { detail: { message: "This business has already been claimed.", slug: "northwind" } }; throw e; };
    open("/marketplace/claim-link?token=abc123abc123abc123abc123");
    expect(await screen.findByText("This business has already been claimed.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the profile" }).getAttribute("href")).toBe("/marketplace/business/northwind");
    expect(tokenLogin).not.toHaveBeenCalled();
  });
});
