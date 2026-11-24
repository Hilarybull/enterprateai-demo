// Simulation audit, Phase 4: the page's first projection waits for the business's records. It used to run before they
// arrived, showing "Low confidence" and a wrong range for a moment (docs/simulation-audit/07-phase4-changes.md).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const calls = [];
let releaseRecords;
const records = new Promise((resolve) => { releaseRecords = resolve; });

vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path) => {
    calls.push(path);
    if (path.startsWith("/validation/me")) return records;
    if (path.startsWith("/v1/scenario-intelligence/scenario-templates")) return { templates: [] };
    if (path.startsWith("/v1/scenario-intelligence/history")) return { history: [] };
    if (path.startsWith("/v1/scenario-intelligence/do-nothing/run")) return { projection_id: "p1", forecast: [], summary: null };
    return {};
  }),
}));

import SimulationPage from "./SimulationPage";
import { useWorkspaceStore } from "../store/workspace";

afterEach(() => { cleanup(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("first projection", () => {
  it("waits until the business's records have loaded", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    render(<SimulationPage />);
    await flush();
    expect(calls.some((p) => p.startsWith("/validation/me"))).toBe(true);
    expect(calls.some((p) => p.includes("do-nothing/run"))).toBe(false);      // records not back yet: nothing projected

    await act(async () => {
      releaseRecords({ data: { financials: { invoices: [], expenses: [], contracts: [] }, catalogue: {} } });
    });
    await flush();
    expect(calls.some((p) => p.includes("do-nothing/run"))).toBe(true);       // now it runs, from the loaded records
  });
});
