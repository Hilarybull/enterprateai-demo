// F4: "I'm …" says what the task is doing in its own words, and goes once the task is finished.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentPanel from "./AgentPanel";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the line under the greeting while a task runs", () => {
  it("reads naturally and is cleared when the task reaches a final state", async () => {
    vi.useFakeTimers();
    let status = "running";
    globalThis.fetch = vi.fn(async (url) => {
      const path = String(url);
      const body = /workflow-runs\/r5/.test(path) ? { run: { id: "r5", status } }
        : /agent\/briefing/.test(path) ? { done_since_last_visit: { update_record: 1 }, working_on: null }
          : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const summary = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 1, credits: 30 },
      briefing: { done_since_last_visit: {}, working_on: { run_id: "r5", title: "Change a Customer, Supplier or Catalogue Item", doing: "updating your catalogue item" } } };
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    expect(document.body.textContent).toContain("I'm updating your catalogue item. I'll let you know when it's ready.");
    expect(document.body.textContent).not.toContain("working on change");
    status = "succeeded";
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(document.body.textContent).not.toContain("I'm updating your catalogue item");
  });
});
