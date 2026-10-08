// The dashboard's Agent card greets the active workspace and says what the Agent did there.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const summary = { suggestions: [], needs_approval: [], needs_approval_count: 2, entitlement: { is_paid: true, agent_tasks: true, allowance_counts: false, credits: 40 } };
const BRIEF = {
  ws1: { done_since_last_visit: { new_invoice: 1, risk_concentration: 1 }, needs_approval_count: 2, needs_input_count: 1, first_visit: false, working_on: null, timezone: "Europe/London", first_name: "Munah" },
  ws2: { done_since_last_visit: {}, needs_approval_count: 0, needs_input_count: 0, first_visit: true, working_on: null, timezone: "Europe/London", first_name: "Munah" },
};
let asked;
beforeEach(() => {
  asked = [];
  useAuthStore.setState({ token: "t", email: "munah@example.test", name: "Munah Okoro", hydrated: true });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const m = String(url).match(/businesses\/(ws\d)\/agent\/briefing/);
    asked.push(`${init.method || "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
    return new Response(JSON.stringify(m ? BRIEF[m[1]] : {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const card = () => screen.getByRole("region", { name: "EnterprateAI Agent" });

describe("the Agent card's greeting and briefing", () => {
  it("greets the workspace by its saved name, on one line with the full name in the tooltip, and says only what the Agent did", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "QA Onboarding Test Ltd" });
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    const greeting = card().querySelector("[data-agent-greeting]");
    expect(greeting.textContent).toMatch(/^Good (morning|afternoon|evening), QA Onboarding Test Ltd$/);
    expect(greeting.getAttribute("title")).toBe(greeting.textContent);
    expect(greeting.textContent).not.toContain("Munah");                    // the workspace, not the person, on this card
    await waitFor(() => expect(card().querySelector("[data-agent-briefing]").textContent).toBe("While you were away I drafted 1 invoice and checked your risks."));
    expect(card().querySelector("[data-agent-briefing]").textContent).not.toMatch(/waiting|approval|question/);      // those are on the tiles and in Needs Approval
    expect(card().querySelector("[data-agent-briefing] button")).toBeNull();
    expect(asked.filter((a) => /agent\/seen/.test(a))).toEqual([]);         // "last here" is not reset on load, so a refresh keeps this line
  });

  it("switching workspace changes the greeting and the briefing at once, with nothing left from the last one", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "QA Onboarding Test Ltd" });
    const { rerender } = render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(card().querySelector("[data-agent-briefing]").textContent).toContain("drafted 1 invoice"));
    await act(async () => { useWorkspaceStore.setState({ workspaceId: "ws2", workspaceName: "Second Shop" }); });
    rerender(<MemoryRouter><AgentPanel businessId="ws2" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    expect(card().querySelector("[data-agent-greeting]").textContent).toMatch(/, Second Shop$/);
    expect(card().querySelector("[data-agent-briefing]").textContent).not.toContain("invoice");      // the last workspace's line is gone before the new one arrives
    await waitFor(() => expect(card().querySelector("[data-agent-briefing]").textContent).toBe("Tell me the first job and I'll get on it."));
    expect(asked.filter((a) => /ws2\/agent\/briefing/.test(a)).length).toBe(1);
  });

  it("a workspace with no name yet is greeted without one, with a way to name the business", () => {
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "My workspace" });
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    expect(card().querySelector("[data-agent-greeting] span").textContent).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(screen.getByRole("button", { name: "Name your business" })).toBeTruthy();
  });
});
