import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const api = vi.hoisted(() => ({ apiRequest: vi.fn(), invalidateWorkspaceCache: vi.fn() }));
vi.mock("../api/client", async (actual) => ({ ...(await actual()), ...api }));

import AccountPage, { DeleteWorkspaceCard } from "./AccountPage";
import { useWorkspaceStore } from "../store/workspace";

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function mount() {
  render(<MemoryRouter initialEntries={["/account"]}><Where /><Routes><Route path="/account" element={<DeleteWorkspaceCard workspaceId="w1" name="Francal" />} /><Route path="*" element={null} /></Routes></MemoryRouter>);
}

describe("deleting a workspace", () => {
  beforeEach(() => { api.apiRequest.mockReset(); api.invalidateWorkspaceCache.mockReset(); useWorkspaceStore.setState({ workspaceId: "w1", workspaceName: "Francal", isMemberMode: false }); });
  afterEach(cleanup);

  it("needs its name typed, then clears it and moves on, asking the app to open what's left", async () => {
    api.apiRequest.mockResolvedValue(null);
    const refreshed = vi.fn();
    window.addEventListener("ea:workspace:refresh", refreshed);
    mount();
    const button = screen.getByRole("button", { name: "Delete this workspace" });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type Francal to confirm"), { target: { value: "Fran" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type Francal to confirm"), { target: { value: "francal" } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
    expect(api.apiRequest).toHaveBeenCalledWith("/validation/w1/delete", "POST", { confirm: "francal" });
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(api.invalidateWorkspaceCache).toHaveBeenCalled();
    expect(refreshed).toHaveBeenCalled();
    window.removeEventListener("ea:workspace:refresh", refreshed);
  });

  it("keeps everything and says why when it fails", async () => {
    api.apiRequest.mockRejectedValue(new Error("HTTP 403: Only the owner can delete this workspace."));
    mount();
    fireEvent.change(screen.getByLabelText("Type Francal to confirm"), { target: { value: "Francal" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete this workspace" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only the owner can delete this workspace.");
    expect(useWorkspaceStore.getState().workspaceId).toBe("w1");
  });

  it("shows on the real Workspace page, named from the workspace's profile", async () => {
    api.apiRequest.mockImplementation(async (path) => (String(path).startsWith("/workspace/profile") ? { profile: { company_name: "Francal", primary_industry: "Trades" } } : {}));
    render(<MemoryRouter initialEntries={["/account?section=workspace"]}><AccountPage /></MemoryRouter>);
    expect(await screen.findByRole("form", { name: "Delete workspace" })).toBeTruthy();
    expect(screen.getByLabelText("Type Francal to confirm")).toBeTruthy();
  });

  it("isn't offered to a member of someone else's workspace", () => {
    useWorkspaceStore.setState({ isMemberMode: true });
    mount();
    expect(screen.queryByRole("form", { name: "Delete workspace" })).toBeNull();
  });
});
