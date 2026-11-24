import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestCached: vi.fn(), invalidateWorkspaceCache: vi.fn() }));
vi.mock("../api/client", () => client);

import { openWorkspace } from "./workspace";

describe("opening a workspace that may have been closed", () => {
  beforeEach(() => { Object.values(client).forEach((f) => f.mockReset()); });

  it("opens the one they were in when it's still there", async () => {
    client.apiRequestCached.mockResolvedValue({ id: "w1" });
    expect(await openWorkspace("w1")).toEqual({ ws: { id: "w1" }, lost: false });
    expect(client.apiRequest).not.toHaveBeenCalled();
  });

  it("moves to their other workspace when it has gone, reading past the cache", async () => {
    client.apiRequestCached.mockRejectedValue(new Error("HTTP 404: Workspace not found"));
    client.apiRequest.mockResolvedValue({ id: "w2", name: "Other" });
    expect(await openWorkspace("w1")).toEqual({ ws: { id: "w2", name: "Other" }, lost: true });
    expect(client.invalidateWorkspaceCache).toHaveBeenCalled();
    expect(client.apiRequest).toHaveBeenCalledWith("/validation/me");
  });

  it("says so when they have no other workspace", async () => {
    client.apiRequestCached.mockRejectedValue(new Error("HTTP 404: Workspace not found"));
    client.apiRequest.mockResolvedValue(null);
    expect(await openWorkspace("w1")).toEqual({ ws: null, lost: true });
  });

  it("doesn't treat a server or network error as a closed workspace", async () => {
    client.apiRequestCached.mockRejectedValue(new Error("HTTP 500: boom"));
    await expect(openWorkspace("w1")).rejects.toThrow("HTTP 500");
    expect(client.apiRequest).not.toHaveBeenCalled();
  });

  it("with nothing open, uses their most recent one as before", async () => {
    client.apiRequestCached.mockResolvedValue({ id: "w3" });
    expect(await openWorkspace(null)).toEqual({ ws: { id: "w3" }, lost: false });
    expect(client.apiRequestCached).toHaveBeenCalledWith("/validation/me");
  });
});
